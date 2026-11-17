//! Local `.base` row automations (Trigger -> Action) and recurring note templates.
use super::{passes, BaseFile, Ctx, Note};
use crate::api::{AutomationAction, AutomationTrigger, BaseRecurringTemplate, RecurringCadence};
use crate::config::Config;
use crate::{env, links, notes, paths, vault_write, Workspace};
use chrono::{Datelike, NaiveDate, NaiveDateTime};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::{LazyLock, Mutex};

static IN_FLIGHT: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

struct FlightGuard(String);
impl Drop for FlightGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = IN_FLIGHT.lock() {
            set.remove(&self.0);
        }
    }
}

fn acquire_flight(key: String) -> Option<FlightGuard> {
    let mut set = IN_FLIGHT.lock().ok()?;
    set.insert(key.clone()).then_some(FlightGuard(key))
}

fn collect_bases(root: &Path, cfg: &Config) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, cfg: &Config, out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for entry in rd.flatten() {
            let p = entry.path();
            let Ok(rel) = p.strip_prefix(root) else { continue };
            let rel_s = rel.to_string_lossy().replace('\\', "/");
            if p.is_dir() {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name.starts_with('.') || cfg.is_ignored(&rel_s) {
                    continue;
                }
                walk(root, &p, cfg, out);
            } else if rel_s.ends_with(".base") {
                out.push(rel_s);
            }
        }
    }
    walk(root, root, cfg, &mut out);
    out.sort();
    out
}

fn scalar_text(v: Option<&serde_yaml::Value>) -> Option<String> {
    match v? {
        serde_yaml::Value::String(s) => Some(s.trim().to_string()),
        serde_yaml::Value::Number(n) => Some(n.to_string()),
        serde_yaml::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn trigger_matches(trigger: &AutomationTrigger, props: &crate::note_props::Props, created: bool) -> bool {
    match trigger {
        AutomationTrigger::NoteCreated => created,
        AutomationTrigger::PropertyChanged { property, to } => {
            let val = scalar_text(props.get(property.as_str()));
            match (val, to.as_deref().map(str::trim).filter(|s| !s.is_empty())) {
                (Some(actual), Some(want)) => actual.eq_ignore_ascii_case(want),
                (Some(actual), None) => !actual.is_empty(),
                _ => false,
            }
        }
    }
}

/// Runs enabled `.base` automations matching `rel_path` after it is written or created.
/// Returns additional workspace-relative paths modified by actions (such as today's log).
pub fn on_note_written(ws: &Workspace, rel_path: &str, created: bool) -> Vec<String> {
    let Ok(cfg) = ws.config() else { return Vec::new() };
    if !rel_path.ends_with(".md") || cfg.index_excluded(rel_path) {
        return Vec::new();
    }
    let bases = collect_bases(ws.root(), &cfg);
    if bases.is_empty() {
        return Vec::new();
    }
    let mut parsed_bases = Vec::new();
    for base_rel in bases {
        let Ok(base_abs) = paths::safe_join(ws.root(), &base_rel) else { continue };
        let Ok(base_src) = std::fs::read_to_string(base_abs) else { continue };
        let Ok(base) = serde_yaml::from_str::<BaseFile>(&base_src) else { continue };
        if base.automations.iter().any(|a| {
            a.enabled
                && ((created && matches!(a.trigger, AutomationTrigger::NoteCreated))
                    || matches!(a.trigger, AutomationTrigger::PropertyChanged { .. }))
        }) {
            parsed_bases.push((base_rel, base));
        }
    }
    if parsed_bases.is_empty() {
        return Vec::new();
    }
    let vault = links::vault(ws.root(), &cfg);
    let none: Vec<String> = Vec::new();
    let notes_vec: Vec<Note> = vault
        .notes
        .iter()
        .map(|(path, data, out)| Note {
            path,
            name: super::stem(path),
            data,
            out,
            incoming: vault.incoming.get(path.as_str()).map_or(none.as_slice(), Vec::as_slice),
            upstream: std::cell::OnceCell::new(),
        })
        .collect();
    let by_path: std::collections::HashMap<&str, &Note> = notes_vec.iter().map(|n| (n.path, n)).collect();
    let Some(target) = by_path.get(rel_path).copied() else {
        return Vec::new();
    };
    let mut touched = Vec::new();
    for (base_rel, base) in parsed_bases {
        let ctx = Ctx {
            note: target,
            this: None,
            notes_by_path: &by_path,
            vault: &vault,
            base_props: &base.properties,
            props: target.props(),
            formulas: BTreeMap::new(),
        };
        if !base.filters.as_ref().is_none_or(|f| passes(f, &ctx)) {
            continue;
        }
        let Some(_guard) = acquire_flight(format!("{}::{base_rel}::{rel_path}", ws.root().display())) else { continue };
        for auto in &base.automations {
            if !auto.enabled || !trigger_matches(&auto.trigger, &target.data.props, created) {
                continue;
            }
            match &auto.action {
                AutomationAction::SetProperty { property, value } => {
                    let today_s = chrono::Local::now().format("%Y-%m-%d").to_string();
                    let rendered = value
                        .replace("{{title}}", &target.name)
                        .replace("{{path}}", rel_path)
                        .replace("{{date}}", &today_s);
                    let current = scalar_text(target.data.props.get(property.as_str()));
                    if current.as_deref() == Some(rendered.trim()) {
                        continue;
                    }
                    let Ok(abs) = ws.resolve(rel_path) else { continue };
                    let yval = serde_yaml::from_str::<serde_yaml::Value>(&rendered)
                        .unwrap_or_else(|_| serde_yaml::Value::String(rendered.clone()));
                    if vault_write::modify(&abs, |raw| Ok(crate::frontmatter::set_property(raw, property, &yval))).is_ok() {
                        touched.push(rel_path.to_string());
                    }
                }
                AutomationAction::AppendLog { text } => {
                    let now = chrono::Local::now().naive_local();
                    let today_s = now.date().format("%Y-%m-%d").to_string();
                    let msg = text
                        .replace("{{title}}", &target.name)
                        .replace("{{path}}", rel_path)
                        .replace("{{date}}", &today_s);
                    if let Ok(cap) = crate::capture::capture_at(ws.root(), &cfg, &msg, now) {
                        touched.push(cap.path);
                    }
                }
            }
        }
    }
    touched.sort();
    touched.dedup();
    touched
}

fn is_due(t: &BaseRecurringTemplate, today: NaiveDate) -> bool {
    if !t.enabled {
        return false;
    }
    let Ok(last) = NaiveDate::parse_from_str(t.last_run.trim(), "%Y-%m-%d") else {
        return true;
    };
    match t.cadence {
        RecurringCadence::Daily => last < today,
        RecurringCadence::Weekly => (today - last).num_days() >= 7 || today.iso_week() != last.iso_week() && today > last,
        RecurringCadence::Monthly => (today.year(), today.month()) > (last.year(), last.month()),
    }
}

/// Runs due recurring templates on `base_rel` (or every `.base` when `None`).
pub fn run_recurring(ws: &Workspace, base_rel: Option<&str>) -> crate::Result<Vec<String>> {
    run_recurring_at(ws, base_rel, chrono::Local::now().naive_local())
}

/// Evaluates recurring templates passively only when `KANDINSKY_NO_SCHEDULE` is not set.
pub fn run_due_passive(ws: &Workspace, base_rel: &str) -> Vec<String> {
    if env::var_os("KANDINSKY_NO_SCHEDULE").is_some() {
        return Vec::new();
    }
    run_recurring(ws, Some(base_rel)).unwrap_or_default()
}

pub fn run_recurring_at(ws: &Workspace, base_rel: Option<&str>, now: NaiveDateTime) -> crate::Result<Vec<String>> {
    let cfg = ws.config()?;
    let today = now.date();
    let today_s = today.format("%Y-%m-%d").to_string();
    let targets = match base_rel {
        Some(p) => vec![p.to_string()],
        None => collect_bases(ws.root(), &cfg),
    };
    let mut created_paths = Vec::new();
    for rel in targets {
        let abs = paths::safe_join(ws.root(), &rel)?;
        let did_write = vault_write::locked(&abs, || -> crate::Result<bool> {
            let Ok(src) = std::fs::read_to_string(&abs) else { return Ok(false) };
            let Ok(base) = serde_yaml::from_str::<BaseFile>(&src) else { return Ok(false) };
            let mut ran_indices = Vec::new();
            for (idx, item) in base.recurring.iter().enumerate() {
                if !is_due(item, today) {
                    continue;
                }
                let pattern = if item.title_pattern.trim().is_empty() { "{{name}} {{date}}" } else { item.title_pattern.trim() };
                let title = pattern
                    .replace("{{date}}", &today_s)
                    .replace("{{name}}", &item.name)
                    .replace("{{title}}", &item.name);
                let dir = (!item.folder.trim().is_empty()).then(|| item.folder.trim().to_string());
                let template = (!item.template.trim().is_empty()).then(|| item.template.trim().to_string());
                let req = crate::api::NewNote { template, title, dir, near: None, text: None, values: None };
                if let Ok(r) = notes::new_note_at(ws.root(), &cfg, &req, now) {
                    created_paths.push(r.path);
                    ran_indices.push(idx);
                }
            }
            if ran_indices.is_empty() {
                return Ok(false);
            }
            let next = stamp_recurring_last_run(&src, &ran_indices, &today_s, today)?;
            if next != src {
                vault_write::write(&abs, next.as_bytes())?;
            }
            Ok(true)
        })?;
        if did_write {
            created_paths.push(rel);
        }
    }
    Ok(created_paths)
}

fn stamp_recurring_last_run(latest: &str, ran_indices: &[usize], today_s: &str, today: chrono::NaiveDate) -> crate::Result<String> {
    if let Some(updated) = stamp_recurring_last_run_in_lines(latest, ran_indices, today_s, today) {
        return Ok(updated);
    }
    let mut doc = serde_yaml::from_str::<serde_yaml::Value>(latest)
        .map_err(|e| crate::Error::BadRequest(e.to_string()))?;
    if let Some(seq) = doc.get_mut("recurring").and_then(serde_yaml::Value::as_sequence_mut) {
        for &idx in ran_indices {
            if let Some(m) = seq.get_mut(idx).and_then(serde_yaml::Value::as_mapping_mut) {
                m.insert("last_run".into(), today_s.to_string().into());
            }
        }
    }
    serde_yaml::to_string(&doc).map_err(|e| crate::Error::BadRequest(e.to_string()))
}

fn split_yaml_comment(rest: &str) -> &str {
    let mut quote: Option<u8> = None;
    let mut prev_space = false;
    let bytes = rest.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        match (quote, b) {
            (None, b'\'' | b'"') => {
                quote = Some(b);
                prev_space = false;
            }
            (Some(b'\''), b'\'') => {
                if bytes.get(i + 1) == Some(&b'\'') {
                    i += 1;
                } else {
                    quote = None;
                }
            }
            (Some(b'"'), b'\\') => {
                i += 1;
            }
            (Some(b'"'), b'"') => quote = None,
            (None, b'#') if prev_space => {
                let start = rest[..i].trim_end_matches([' ', '\t']).len();
                return &rest[start..];
            }
            (None, b' ' | b'\t') => prev_space = true,
            (None, _) => prev_space = false,
            _ => {}
        }
        i += 1;
    }
    ""
}

fn stamp_recurring_last_run_in_lines(
    latest: &str,
    ran_indices: &[usize],
    today_s: &str,
    today: chrono::NaiveDate,
) -> Option<String> {
    let eol = if latest.contains("\r\n") { "\r\n" } else { "\n" };
    let trailing_nl = latest.ends_with('\n');
    let mut lines: Vec<String> = latest
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();
    if trailing_nl && lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    let rec_line = lines.iter().position(|l| {
        if l.starts_with([' ', '\t']) {
            return false;
        }
        let Some(after) = l.strip_prefix("recurring:") else { return false };
        let r = after.trim();
        r.is_empty() || r.starts_with('#')
    })?;

    let mut item_indent: Option<usize> = None;
    let mut items: Vec<(usize, usize)> = Vec::new();
    for (j, line) in lines.iter().enumerate().skip(rec_line + 1) {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if line.starts_with('\t') {
            return None;
        }
        let indent = line.bytes().take_while(|&b| b == b' ').count();
        if indent == 0 {
            break;
        }
        let rest = &line[indent..];
        let is_dash = rest == "-" || rest.starts_with("- ");
        match item_indent {
            None => {
                if !is_dash {
                    return None;
                }
                if rest[1..].trim_start().starts_with(['{', '[']) {
                    return None;
                }
                item_indent = Some(indent);
                items.push((j, j));
            }
            Some(ii) if indent == ii && is_dash => {
                if rest[1..].trim_start().starts_with(['{', '[']) {
                    return None;
                }
                items.push((j, j));
            }
            Some(ii) if indent < ii => return None,
            Some(_) => {
                if let Some(last) = items.last_mut() {
                    last.1 = j;
                }
            }
        }
    }

    let ii = item_indent?;
    let mut sorted = ran_indices.to_vec();
    sorted.sort_unstable();
    sorted.dedup();
    for &idx in sorted.iter().rev() {
        let &(start, end) = items.get(idx)?;
        let after_dash = lines[start][ii..].strip_prefix('-')?;
        let ws = after_dash.bytes().take_while(|&b| b == b' ').count();
        let key_indent = if !after_dash[ws..].is_empty() && ws > 0 {
            ii + 1 + ws
        } else {
            let mut found = None;
            for l in &lines[(start + 1)..=end] {
                if l.trim().is_empty() || l.trim_start().starts_with('#') {
                    continue;
                }
                found = Some(l.bytes().take_while(|&b| b == b' ').count());
                break;
            }
            found?
        };

        let mut updated_line = None;
        for (offset, l) in lines[start..=end].iter().enumerate() {
            let k = start + offset;
            if k == start {
                if l.len() > key_indent && l[key_indent..].starts_with("last_run:") {
                    updated_line = Some(k);
                    break;
                }
            } else if l.bytes().take_while(|&b| b == b' ').count() == key_indent
                && l[key_indent..].starts_with("last_run:")
            {
                updated_line = Some(k);
                break;
            }
        }
        if let Some(k) = updated_line {
            let after_key = &lines[k][key_indent + "last_run:".len()..];
            let trimmed_val = after_key.trim_start();
            if trimmed_val.starts_with(['|', '>', '[', '{']) {
                return None;
            }
            for next_l in &lines[(k + 1)..=end] {
                if next_l.trim().is_empty() || next_l.trim_start().starts_with('#') {
                    continue;
                }
                if next_l.bytes().take_while(|&b| b == b' ').count() > key_indent {
                    return None;
                }
                break;
            }
            let comment = split_yaml_comment(after_key);
            lines[k] = format!("{}last_run: \"{today_s}\"{comment}", &lines[k][..key_indent]);
        } else {
            lines.insert(end + 1, format!("{}last_run: \"{today_s}\"", " ".repeat(key_indent)));
        }
    }

    let mut out = lines.join(eol);
    if trailing_nl && !out.is_empty() {
        out.push_str(eol);
    }
    let reparsed = serde_yaml::from_str::<BaseFile>(&out).ok()?;
    for &idx in &sorted {
        let item = reparsed.recurring.get(idx)?;
        if is_due(item, today) {
            return None;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_changed_automation_sets_target_and_guards_loops() {
        let d = tempfile::tempdir().unwrap();
        let base = r#"filters: 'type == "task"'
automations:
  - name: Timestamp done
    enabled: true
    trigger:
      kind: property_changed
      property: status
      to: Done
    action:
      kind: set_property
      property: closed
      value: "true"
views:
  - type: table
"#;
        std::fs::write(d.path().join("Tasks.base"), base).unwrap();
        std::fs::write(d.path().join("T1.md"), "---\ntype: task\nstatus: Done\n---\nbody\n").unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let touched = on_note_written(&ws, "T1.md", false);
        assert_eq!(touched, vec!["T1.md"]);
        let text = std::fs::read_to_string(d.path().join("T1.md")).unwrap();
        assert!(text.contains("closed: true"), "{text}");
    }

    #[test]
    fn recurring_template_creates_note_and_stamps_last_run() {
        let d = tempfile::tempdir().unwrap();
        let base = r#"recurring:
  - name: Weekly Review
    enabled: true
    cadence: weekly
    folder: reviews
    title_pattern: "Review {{date}}"
views:
  - type: table
"#;
        std::fs::write(d.path().join("Reviews.base"), base).unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let day = chrono::NaiveDate::from_ymd_opt(2026, 11, 16).unwrap().and_hms_opt(9, 0, 0).unwrap();
        let first = run_recurring_at(&ws, Some("Reviews.base"), day).unwrap();
        assert!(first.contains(&"reviews/Review 2026-11-16.md".to_string()), "{first:?}");
        assert!(run_recurring_at(&ws, Some("Reviews.base"), day).unwrap().is_empty(), "idempotent same day");
    }

    #[test]
    fn append_log_and_set_property_substitute_date_template() {
        let d = tempfile::tempdir().unwrap();
        let base = r#"filters: 'type == "task"'
automations:
  - name: Log review
    enabled: true
    trigger:
      kind: property_changed
      property: status
      to: Done
    action:
      kind: append_log
      text: "Completed {{title}} on {{date}}"
views:
  - type: table
"#;
        std::fs::write(d.path().join("Tasks.base"), base).unwrap();
        std::fs::write(d.path().join("T1.md"), "---\ntype: task\nstatus: Done\n---\nbody\n").unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let touched = on_note_written(&ws, "T1.md", false);
        assert_eq!(touched.len(), 1);
        let log_txt = std::fs::read_to_string(d.path().join(&touched[0])).unwrap();
        let today_s = chrono::Local::now().format("%Y-%m-%d").to_string();
        assert!(log_txt.contains(&format!("Completed T1 on {today_s}")), "{log_txt}");
    }

    #[test]
    fn on_note_written_skips_when_only_note_created_on_edit_and_run_recurring_preserves_comments() {
        let d = tempfile::tempdir().unwrap();
        let base = r#"# Base header comment
recurring:
  # Keep my comment here
  - name: Weekly note
    enabled: true
    cadence: weekly
    folder: reviews
    title_pattern: "{{date}} Weekly"
    template: ""
    last_run: ""
automations:
  - name: Only on creation
    enabled: true
    trigger:
      kind: note_created
    action:
      kind: set_property
      property: flagged
      value: "true"
views:
  - type: table
"#;
        std::fs::write(d.path().join("Weekly.base"), base).unwrap();
        std::fs::write(d.path().join("Note.md"), "---\nstatus: open\n---\nbody\n").unwrap();
        let ws = Workspace::open(d.path()).unwrap();

        // `created = false` with only `note_created` automation skips without modifying Note.md.
        assert!(on_note_written(&ws, "Note.md", false).is_empty());
        assert!(!std::fs::read_to_string(d.path().join("Note.md")).unwrap().contains("flagged"));

        // Concurrent recurring runs share the per-.base lock cleanly and preserve YAML comments.
        let now = chrono::NaiveDate::from_ymd_opt(2026, 11, 18).unwrap().and_hms_opt(9, 0, 0).unwrap();
        let ws_ref = &ws;
        let (a, b) = std::thread::scope(|s| {
            let h1 = s.spawn(move || run_recurring_at(ws_ref, Some("Weekly.base"), now).unwrap());
            let h2 = s.spawn(move || run_recurring_at(ws_ref, Some("Weekly.base"), now).unwrap());
            (h1.join().unwrap(), h2.join().unwrap())
        });
        let total_non_empty = usize::from(!a.is_empty()) + usize::from(!b.is_empty());
        assert_eq!(total_non_empty, 1, "only one concurrent runner may execute: a={a:?}, b={b:?}");
        let after = std::fs::read_to_string(d.path().join("Weekly.base")).unwrap();
        assert!(after.contains("# Base header comment") && after.contains("# Keep my comment here"), "{after}");
        assert!(after.contains("last_run: \"2026-11-18\""), "{after}");
    }
}
