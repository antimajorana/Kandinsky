//! Local `.base` row automations (Trigger -> Action) and recurring note templates.
use super::{passes, BaseFile, Ctx, Note};
use crate::api::{AutomationAction, AutomationTrigger, BaseAutomation, BaseAutomationRequest, BaseAutomationRun, BaseRecurringTemplate, RecurringCadence};
use crate::config::Config;
use crate::note_props::Props;
use crate::{env, links, notes, paths, vault_write, Error, Result, Workspace};
use chrono::{Datelike, NaiveDate, NaiveDateTime};
use std::collections::{BTreeMap, HashMap, HashSet};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
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

/// The last readable properties seen here per note (root::path), the `before` of a save over a half-typed line. A change
/// made by another program, or a writer that never calls `on_note_saved`, is never an edge: it fires nothing.
static LAST_SEEN: LazyLock<Mutex<HashMap<String, Props>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn last_seen(key: &str) -> Option<Props> {
    LAST_SEEN.lock().ok()?.get(key).cloned()
}

fn remember(key: &str, props: Props) {
    if let Ok(mut map) = LAST_SEEN.lock() {
        map.insert(key.to_string(), props);
    }
}

/// A frontmatter that is there but does not read as a mapping (a half-typed line, a fence not yet closed).
fn unreadable(text: &str) -> bool {
    kandinsky_text::frontmatter::yaml_head(text)
        .is_some_and(|y| !y.trim().is_empty() && serde_yaml::from_str::<serde_yaml::Mapping>(y).is_err())
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

/// `before`: the note's properties before this write (`None`: a new note, or unknown). A property change fires only on
/// the write that changes the value, so later saves of a note already at `to` repeat nothing.
fn trigger_matches(trigger: &AutomationTrigger, before: Option<&Props>, after: &Props, created: bool) -> bool {
    match trigger {
        AutomationTrigger::NoteCreated => created,
        AutomationTrigger::Manual => false,
        AutomationTrigger::PropertyChanged { property, to } => {
            let previous = before.and_then(|b| b.get(property));
            let current = after.get(property);
            let value = scalar_text(current);
            let unchanged = match (scalar_text(previous), value.as_deref()) {
                (Some(was), Some(now)) => was.eq_ignore_ascii_case(now),
                _ => previous == current,
            };
            if unchanged {
                return false;
            }
            match to.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(want) => value.is_some_and(|actual| actual.eq_ignore_ascii_case(want)),
                None => true,
            }
        }
    }
}

/// What the automations of one write did.
#[derive(Debug, Default)]
pub struct Ran {
    /// Workspace-relative paths the actions wrote (the note itself, today's log).
    pub touched: Vec<String>,
    /// The caller's own copy of the note (`held`) with the property edits made to the note, when there were any.
    pub held: Option<String>,
    /// The properties set on the note, and the rule that set the first one (for a notice).
    pub set: Vec<String>,
    pub rule: Option<String>,
    /// An action other than a property edit (a log line) wrote the note itself: `held` lacks that write.
    pub unheld: bool,
}

/// Runs enabled `.base` automations matching `rel_path` after it is created (`created`), or written with its previous
/// text unknown (every property then counts as just set). Returns the paths the actions wrote (the note, today's log).
pub fn on_note_written(ws: &Workspace, rel_path: &str, created: bool) -> Vec<String> {
    run(ws, rel_path, created, None, None).touched
}

/// Runs enabled `.base` automations after `rel_path` was written over `before` (`None`: it did not exist). `held`: the
/// note as a caller that applies the edits itself holds it (an editor); the property edits are made to it as well.
pub fn on_note_saved(ws: &Workspace, rel_path: &str, before: Option<&str>, held: Option<&str>) -> Ran {
    run(ws, rel_path, before.is_none(), before, held)
}

fn run(ws: &Workspace, rel_path: &str, created: bool, before: Option<&str>, held: Option<&str>) -> Ran {
    let ran = Ran::default();
    let Ok(cfg) = ws.config() else { return ran };
    if !rel_path.ends_with(".md") || cfg.index_excluded(rel_path) {
        return ran;
    }
    let bases = collect_bases(ws.root(), &cfg);
    if bases.is_empty() {
        return ran;
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
        return ran;
    }
    let Ok(abs) = ws.resolve(rel_path) else { return ran };
    // the note as written now, not the index's copy, which may not have seen this write yet
    let Ok(text) = std::fs::read_to_string(&abs) else { return ran };
    let mut after = Props::from_markdown(&text);
    // a save made over a half-typed property line has no readable old values: the last ones seen here stand in (taking
    // them as absent would fire again a rule whose value never changed); none seen, every property counts as just set
    let seen_key = format!("{}::{rel_path}", ws.root().display());
    let before = match before {
        Some(b) if unreadable(b) => last_seen(&seen_key),
        b => b.map(Props::from_markdown),
    };
    // this write's values when readable, else the old ones: the next save, over this unreadable text, compares to them
    let readable = !unreadable(&text);
    match (!readable, &before) {
        (false, _) => remember(&seen_key, after.clone()),
        (true, Some(b)) => remember(&seen_key, b.clone()),
        (true, None) => {}
    }
    let own = held.map(str::to_string);
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
        return ran;
    };
    let mut execution = Execution { ws, cfg: &cfg, rel: rel_path, abs: &abs, text, held: own, ran };
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
            if !auto.enabled
                || (!readable && matches!(auto.trigger, AutomationTrigger::PropertyChanged { .. }))
                || !trigger_matches(&auto.trigger, before.as_ref(), &after, created)
            {
                continue;
            }
            execution.run_rule(&base_rel, auto);
            after = Props::from_markdown(&execution.text);
        }
    }
    if !unreadable(&execution.text) {
        remember(&seen_key, after);
    }
    execution.ran.touched.sort();
    execution.ran.touched.dedup();
    execution.ran.held = execution.held.filter(|h| Some(h.as_str()) != held);
    execution.ran
}

struct Execution<'a> {
    ws: &'a Workspace,
    cfg: &'a Config,
    rel: &'a str,
    abs: &'a Path,
    text: String,
    held: Option<String>,
    ran: Ran,
}

impl Execution<'_> {
    fn run_rule(&mut self, base: &str, rule: &BaseAutomation) -> BaseAutomationRun {
        let now = chrono::Local::now();
        let mut entry = BaseAutomationRun {
            rule: rule.name.clone(),
            note: self.rel.to_string(),
            trigger: rule.trigger.clone(),
            at: now.to_rfc3339(),
            files: Vec::new(),
            error: None,
        };
        for step in rule.steps() {
            match self.step(base, &rule.name, step, now.naive_local(), &mut entry.files) {
                Ok(()) => {}
                Err(error) => {
                    entry.error = Some(error.to_string());
                    eprintln!("kandinsky: automation {:?} in {base}: {error}", rule.name);
                    break;
                }
            }
        }
        self.ran.touched.extend(entry.files.iter().cloned());
        if let Err(error) = remember_run(self.ws, base, &entry) {
            eprintln!("kandinsky: could not save automation history for {base}: {error}");
        }
        entry
    }

    fn set_current(&mut self, base: &str, rule: &str, property: &str, value: &serde_yaml::Value) -> Result<bool> {
        let (next, changed) = edit_property(self.abs, property, value)?;
        self.text = next;
        if changed {
            if let Some(held) = self.held.as_mut() {
                *held = crate::frontmatter::set_property(held, property, value);
            }
            if !self.ran.set.iter().any(|key| key == property) {
                self.ran.set.push(property.to_string());
            }
            self.ran.rule.get_or_insert_with(|| format!("{rule} ({base})"));
        }
        Ok(changed)
    }

    fn step(&mut self, base: &str, rule: &str, step: &AutomationAction, now: NaiveDateTime, files: &mut Vec<String>) -> Result<()> {
        let today = now.date().format("%Y-%m-%d").to_string();
        let title = super::stem(self.rel);
        let render = |template: &str| template.replace("{{title}}", &title).replace("{{path}}", self.rel).replace("{{date}}", &today);
        match step {
            AutomationAction::SetProperty { property, value } => {
                let key = crate::frontmatter::plain_key(property)?;
                let value = property_value(value, render(value));
                if self.set_current(base, rule, key, &value)? {
                    record_file(files, self.rel.to_string());
                }
            }
            AutomationAction::AppendLog { text } => {
                let cap = crate::capture::capture_at(self.ws.root(), self.cfg, &render(text), now)?;
                if cap.path == self.rel {
                    // The caller's copy lacks the line and must reload.
                    self.ran.unheld = true;
                    if let Ok(text) = std::fs::read_to_string(self.abs) {
                        self.text = text;
                    }
                }
                record_file(files, cap.path);
            }
            AutomationAction::CreateRow { base, view, title, link_property } => {
                let target = checked_base(self.ws, base)?;
                let src = crate::files::read_text(self.ws, &target)?.text;
                let document: BaseFile = serde_yaml::from_str(&src).map_err(|e| Error::BadRequest(format!("base: {e}")))?;
                if document.views.is_empty()
                    || view.as_deref().is_some_and(|name| !document.views.iter().any(|v| v.name.as_deref().unwrap_or(&v.kind) == name))
                {
                    return Err(Error::BadRequest(format!("no matching view in {target}")));
                }
                let title = title.as_deref().map(render).unwrap_or_default();
                let link = link_property.as_deref().map(|property| {
                    let property = crate::frontmatter::plain_key(property)?;
                    let link = serde_yaml::Value::String(format!("[[{}]]", self.rel));
                    Ok::<_, Error>((property, serde_yaml::Value::Sequence(vec![link])))
                }).transpose()?;
                let init = super::edit::RowInit::automation(&title, link, self.rel);
                let row = super::edit::new_row_with(self.ws.root(), self.cfg, &target, &src, view.as_deref(), init)?;
                let warning = (!row.matches).then(|| format!("{} was created outside the destination view in {target}", row.path));
                record_file(files, row.path);
                if let Some(warning) = warning {
                    return Err(Error::BadRequest(warning));
                }
            }
            AutomationAction::UpdateRelated { base: destination, relation, property, value } => {
                let relation = crate::frontmatter::plain_key(relation)?;
                let key = crate::frontmatter::plain_key(property)?;
                let value = property_value(value, render(value));
                let destination = checked_base(self.ws, destination)?;
                let source = crate::files::read_text(self.ws, &destination)?.text;
                let result = super::evaluate(self.ws.root(), self.cfg, &source, Some(self.rel));
                if let Some(error) = result.error {
                    return Err(Error::BadRequest(error));
                }
                let members: HashSet<_> = result.views.iter().flat_map(|view| view.rows.iter().map(|row| row.path.as_str())).collect();
                let vault = links::vault(self.ws.root(), self.cfg);
                let props = Props::from_markdown(&self.text);
                let targets: std::collections::BTreeSet<_> = props.wikilink_targets(relation).iter()
                    .filter_map(|target| vault.resolve(target, self.rel))
                    .filter(|target| members.contains(target.as_str()))
                    .collect();
                for target in targets {
                    let changed = if target == self.rel {
                        self.set_current(base, rule, key, &value)?
                    } else {
                        edit_property(&self.ws.resolve(&target)?, key, &value)?.1
                    };
                    if changed {
                        record_file(files, target);
                    }
                }
            }
        }
        Ok(())
    }
}

fn property_value(template: &str, rendered: String) -> serde_yaml::Value {
    // A literal value is typed. A filled-in title or path stays text, even `a: b` or `2026`.
    if template.contains("{{") {
        serde_yaml::Value::String(rendered)
    } else {
        serde_yaml::from_str(&rendered).unwrap_or_else(|_| serde_yaml::Value::String(rendered))
    }
}

fn edit_property(abs: &Path, key: &str, value: &serde_yaml::Value) -> Result<(String, bool)> {
    let mut next = String::new();
    let mut changed = false;
    vault_write::modify(abs, |raw| {
        let text = if Props::from_markdown(raw).get(key) == Some(value) {
            raw.to_string()
        } else {
            crate::frontmatter::set_property(raw, key, value)
        };
        changed = text != raw;
        next.clone_from(&text);
        Ok(text)
    })?;
    Ok((next, changed))
}

fn record_file(files: &mut Vec<String>, file: String) {
    if !files.contains(&file) {
        files.push(file);
    }
}

fn checked_base(ws: &Workspace, path: &str) -> Result<String> {
    let path = ws.rel(&ws.resolve(path)?);
    if !path.ends_with(".base") || crate::state_dir::is_state_rel(&path) {
        return Err(Error::BadRequest("choose a Base in the vault".into()));
    }
    Ok(path)
}

pub fn run_manual(ws: &Workspace, req: &BaseAutomationRequest) -> Result<BaseAutomationRun> {
    let base = checked_base(ws, &req.path)?;
    let cfg = ws.config()?;
    let abs = ws.resolve(&req.note)?;
    let note = ws.rel(&abs);
    if !note.ends_with(".md") || cfg.index_excluded(&note) {
        return Err(Error::BadRequest("choose a note in the Base".into()));
    }
    let source = crate::files::read_text(ws, &base)?.text;
    let parsed: BaseFile = serde_yaml::from_str(&source).map_err(|e| Error::BadRequest(format!("base: {e}")))?;
    let rule = parsed.automations.iter().find(|rule| {
        rule.enabled && rule.trigger == AutomationTrigger::Manual && *rule == &req.rule
    }).ok_or_else(|| Error::BadRequest("the manual rule has changed or is disabled".into()))?;
    let _guard = acquire_flight(format!("{}::{base}::{note}", ws.root().display()))
        .ok_or(Error::Conflict { current: None })?;
    let result = super::evaluate(ws.root(), &cfg, &source, req.this.as_deref());
    if !result.views.iter().any(|view| view.rows.iter().any(|row| row.path == note)) {
        return Err(Error::BadRequest("the note is outside the Base's views".into()));
    }
    let text = crate::files::read_text(ws, &note)?.text;
    let mut execution = Execution { ws, cfg: &cfg, rel: &note, abs: &abs, text, held: None, ran: Ran::default() };
    let entry = execution.run_rule(&base, rule);
    if !unreadable(&execution.text) {
        remember(&format!("{}::{note}", ws.root().display()), Props::from_markdown(&execution.text));
    }
    Ok(entry)
}

const HISTORY_LIMIT: usize = 50;

fn history_path(ws: &Workspace, base: &str) -> PathBuf {
    let key = Sha256::digest(base.as_bytes());
    ws.cache_dir().join("base-automation-runs").join(format!("{key:x}.json"))
}

fn read_history(path: &Path) -> Result<Vec<BaseAutomationRun>> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| Error::Other(e.into())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn run_history(ws: &Workspace, base: &str) -> Result<Vec<BaseAutomationRun>> {
    read_history(&history_path(ws, &checked_base(ws, base)?))
}

fn remember_run(ws: &Workspace, base: &str, entry: &BaseAutomationRun) -> Result<()> {
    let path = history_path(ws, base);
    vault_write::cache::locked(&path, || {
        let mut entries = read_history(&path)?;
        entries.insert(0, entry.clone());
        entries.truncate(HISTORY_LIMIT);
        let bytes = serde_json::to_vec(&entries).map_err(|e| Error::Other(e.into()))?;
        vault_write::cache::write(&path, &bytes)?;
        Ok(())
    })
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
    fn manual_rule_creates_a_linked_row_in_another_base_and_records_history() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let source = r#"
filters: 'file.inFolder("Inbox")'
views: [{type: table}]
automations:
  - name: Create follow-up
    trigger: {kind: manual}
    action: {kind: create_row, base: Followups.base, view: Open, title: "Follow up on {{title}}", link_property: source}
"#;
        let write = |path: &str, text: &str| vault_write::write(&d.path().join(path), text.as_bytes()).unwrap();
        write("Inbox/Task.md", "# Task\n");
        write("Other.md", "# Other\n");
        write("Inbox.base", source);
        write("Followups.base", "filters: 'file.inFolder(\"Followups\")'\nviews:\n  - type: table\n    name: Open\n    filters: 'status == \"Open\"'\n");
        let rule = serde_yaml::from_str::<BaseFile>(source).unwrap().automations.remove(0);
        assert!(on_note_written(&ws, "Inbox/Task.md", true).is_empty());
        let mut request = BaseAutomationRequest { path: "Inbox.base".into(), note: "Other.md".into(), rule, this: None };
        assert!(run_manual(&ws, &request).is_err());
        request.note = "Inbox/Task.md".into();
        let run = run_manual(&ws, &request).unwrap();
        assert!(run.error.is_none(), "{:?}", run.error);
        assert_eq!(run.files, ["Followups/Follow up on Task.md"]);
        let text = std::fs::read_to_string(d.path().join(&run.files[0])).unwrap();
        let props = Props::from_markdown(&text);
        assert_eq!(props.wikilink_targets("source"), ["Inbox/Task.md"]);
        assert_eq!(props.get("status").and_then(serde_yaml::Value::as_str), Some("Open"));
        let history = run_history(&Workspace::open(d.path()).unwrap(), "Inbox.base").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].files, run.files);
        assert_eq!(history[0].trigger, AutomationTrigger::Manual);
        assert!(run_history(&ws, "Followups.base").unwrap().is_empty());
        write("Inbox.base", &source.replace("Create follow-up", "Create review"));
        assert!(run_manual(&ws, &request).is_err());
    }

    #[test]
    fn a_related_row_update_writes_only_members_of_the_destination_base() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let write = |path: &str, text: &str| vault_write::write(&d.path().join(path), text.as_bytes()).unwrap();
        let source = r#"
filters: 'file.inFolder("Inbox")'
views: [{type: table}]
automations:
  - name: Mark related
    trigger: {kind: manual}
    action: {kind: update_related, base: Projects.base, relation: projects, property: active, value: "true"}
"#;
        write("Inbox.base", source);
        write("Inbox/Task.md", "---\nprojects: ['[[Projects/A]]', '[[Projects/B]]', '[[Other]]']\n---\n");
        write("Projects.base", "filters: 'file.inFolder(\"Projects\")'\nviews: [{type: table}]\n");
        for path in ["Projects/A.md", "Projects/B.md", "Other.md"] {
            write(path, "# Project\n");
        }
        let rule = serde_yaml::from_str::<BaseFile>(source).unwrap().automations.remove(0);
        let run = run_manual(&ws, &BaseAutomationRequest { path: "Inbox.base".into(), note: "Inbox/Task.md".into(), rule, this: None }).unwrap();
        assert!(run.error.is_none(), "{:?}", run.error);
        assert_eq!(run.files, ["Projects/A.md", "Projects/B.md"]);
        for path in run.files {
            assert!(std::fs::read_to_string(d.path().join(path)).unwrap().contains("active: true"));
        }
        assert_eq!(std::fs::read_to_string(d.path().join("Other.md")).unwrap(), "# Project\n");
    }

    #[test]
    fn history_shows_completed_actions_when_a_later_step_fails() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let source = r#"
views: [{type: table}]
automations:
  - name: Partial run
    trigger: {kind: manual}
    actions:
      - {kind: set_property, property: phase, value: Started}
      - {kind: create_row, base: Reviews.base}
      - {kind: set_property, property: phase, value: Finished}
"#;
        vault_write::write(&d.path().join("Work.base"), source.as_bytes()).unwrap();
        vault_write::write(&d.path().join("Reviews.base"), b"filters:\n  and:\n    - 'file.inFolder(\"Reviews\")'\n    - 'quality > 5'\nviews: [{type: table}]\n").unwrap();
        vault_write::write(&d.path().join("Task.md"), b"# Task\n").unwrap();
        let rule = serde_yaml::from_str::<BaseFile>(source).unwrap().automations.remove(0);
        let run = run_manual(&ws, &BaseAutomationRequest { path: "Work.base".into(), note: "Task.md".into(), rule, this: None }).unwrap();
        assert!(run.error.as_deref().is_some_and(|error| error.contains("outside the destination view in Reviews.base")));
        assert_eq!(run.files, ["Task.md", "Reviews/Untitled.md"]);
        assert!(std::fs::read_to_string(d.path().join("Task.md")).unwrap().contains("phase: Started"));
        assert_eq!(run_history(&ws, "Work.base").unwrap()[0].error, run.error);
    }

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
        let open = "---\ntype: task\nstatus: open\n---\nbody\n";
        let touched = on_note_saved(&ws, "T1.md", Some(open), None).touched;
        assert_eq!(touched, vec!["T1.md"]);
        let text = std::fs::read_to_string(d.path().join("T1.md")).unwrap();
        assert!(text.contains("closed: true"), "{text}");
    }

    #[test]
    fn an_unfiltered_property_trigger_detects_a_list_edit_and_a_removal() {
        let trigger = AutomationTrigger::PropertyChanged { property: "tags".into(), to: None };
        let first = Props::from_markdown("---\ntags: [one, two]\n---\n");
        let updated = Props::from_markdown("---\ntags: [one]\n---\n");
        let cleared = Props::default();
        assert!(trigger_matches(&trigger, Some(&first), &updated, false));
        assert!(trigger_matches(&trigger, Some(&updated), &cleared, false));
        assert!(!trigger_matches(&trigger, Some(&updated), &updated, false));
        assert!(!trigger_matches(&trigger, Some(&cleared), &cleared, false));
    }

    #[test]
    fn an_ordered_rule_applies_every_action_and_returns_merged_editor_text() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("Tasks.base"), r#"
automations:
  - name: Complete task
    trigger: {kind: property_changed, property: status, to: Done}
    actions:
      - {kind: set_property, property: phase, value: pending}
      - {kind: set_property, property: archived, value: "true"}
      - {kind: set_property, property: phase, value: complete}
views:
  - type: table
"#).unwrap();
        let before = "---\nstatus: Open\n---\nKeep this.\n";
        let saved = before.replace("Open", "Done");
        let path = d.path().join("Task.md");
        std::fs::write(&path, &saved).unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let ran = on_note_saved(&ws, "Task.md", Some(before), Some(&saved));
        let disk = std::fs::read_to_string(&path).unwrap();
        assert!(disk.contains("archived: true") && disk.contains("phase: complete") && disk.contains("Keep this."));
        assert_eq!(ran.held.as_deref(), Some(disk.as_str()));
        assert_eq!(ran.set, ["phase", "archived"]);
        assert!(on_note_saved(&ws, "Task.md", Some(&disk), Some(&disk)).touched.is_empty());
    }

    const LOG_DONE: &str = r#"filters: 'type == "task"'
automations:
  - name: Log done
    enabled: true
    trigger:
      kind: property_changed
      property: status
      to: Done
    action:
      kind: append_log
      text: "Finished {{title}}"
views:
  - type: table
"#;

    fn log_lines(d: &Path, touched: &[String]) -> usize {
        let Some(log) = touched.first() else { return 0 };
        std::fs::read_to_string(d.join(log)).unwrap().matches("Finished T1").count()
    }

    #[test]
    fn property_changed_fires_on_the_change_only_not_on_later_saves() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("Tasks.base"), LOG_DONE).unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let open = "---\ntype: task\nstatus: open\n---\nbody\n";
        let done = "---\ntype: task\nstatus: Done\n---\nbody\n";
        std::fs::write(d.path().join("T1.md"), done).unwrap();
        let first = on_note_saved(&ws, "T1.md", Some(open), None).touched;
        assert_eq!(log_lines(d.path(), &first), 1, "{first:?}");

        // a body edit of a note already done, and an edit of another property, repeat nothing
        let typed = "---\ntype: task\nstatus: Done\n---\nbody and more\n";
        std::fs::write(d.path().join("T1.md"), typed).unwrap();
        assert!(on_note_saved(&ws, "T1.md", Some(done), None).touched.is_empty());
        let tagged = "---\ntype: task\nstatus: done\ntags: [x]\n---\nbody and more\n";
        std::fs::write(d.path().join("T1.md"), tagged).unwrap();
        assert!(on_note_saved(&ws, "T1.md", Some(typed), None).touched.is_empty(), "the case of the value is no change");
        let half_typed = "---\ntype: task\nstatus: Done\nprio\n---\nbody and more\n";
        assert!(on_note_saved(&ws, "T1.md", Some(half_typed), None).touched.is_empty(), "an unreadable before is no change");
        assert_eq!(log_lines(d.path(), &first), 1);

        // a note created already done fires once
        assert_eq!(on_note_saved(&ws, "T1.md", None, None).touched, first);
        assert_eq!(log_lines(d.path(), &first), 2);
    }

    #[test]
    fn a_rule_sees_the_value_an_earlier_rule_set_in_the_same_write() {
        let d = tempfile::tempdir().unwrap();
        let base = r#"automations:
  - name: Close done
    enabled: true
    trigger:
      kind: property_changed
      property: status
      to: Done
    action:
      kind: set_property
      property: closed
      value: "true"
  - name: Log closed
    enabled: true
    trigger:
      kind: property_changed
      property: closed
      to: "true"
    action:
      kind: append_log
      text: "Finished {{title}}"
views:
  - type: table
"#;
        std::fs::write(d.path().join("Tasks.base"), base).unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        std::fs::write(d.path().join("T1.md"), "---\nstatus: Done\n---\nbody\n").unwrap();
        let ran = on_note_saved(&ws, "T1.md", Some("---\nstatus: open\n---\nbody\n"), None);
        let log: Vec<String> = ran.touched.iter().filter(|p| *p != "T1.md").cloned().collect();
        assert_eq!(log_lines(d.path(), &log), 1, "{ran:?}");
        // the next save, over the text the rules left, repeats neither
        let now = std::fs::read_to_string(d.path().join("T1.md")).unwrap();
        assert!(on_note_saved(&ws, "T1.md", Some(&now), None).touched.is_empty());
        assert_eq!(log_lines(d.path(), &log), 1);
    }

    #[test]
    fn a_change_saved_over_a_half_typed_line_fires_once() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("Tasks.base"), LOG_DONE).unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let open = "---\ntype: task\nstatus: open\n---\nbody\n";
        let half = "---\ntype: task\nstatus: Done\nprio\n---\nbody\n";
        let typed = "---\ntype: task\nstatus: Done\nprio: high\n---\nbody\n";
        std::fs::write(d.path().join("T1.md"), half).unwrap();
        assert!(on_note_saved(&ws, "T1.md", Some(open), None).touched.is_empty(), "nothing readable to fire on");
        std::fs::write(d.path().join("T1.md"), typed).unwrap();
        let ran = on_note_saved(&ws, "T1.md", Some(half), None).touched;
        assert_eq!(log_lines(d.path(), &ran), 1, "compared to the last readable values (open): {ran:?}");
        assert!(on_note_saved(&ws, "T1.md", Some(typed), None).touched.is_empty());
        assert!(on_note_saved(&ws, "T1.md", Some(half), None).touched.is_empty(), "the last values seen are Done now");
        assert_eq!(log_lines(d.path(), &ran), 1);

        // nothing seen of a note before (a new process): its value counts as just set
        std::fs::write(d.path().join("T2.md"), typed).unwrap();
        let other = on_note_saved(&ws, "T2.md", Some(half), None).touched;
        assert_eq!(other.len(), 1, "{other:?}");
        assert_eq!(std::fs::read_to_string(d.path().join(&other[0])).unwrap().matches("Finished T2").count(), 1);
    }

    #[test]
    fn a_log_line_written_into_the_note_itself_is_not_held() {
        let d = tempfile::tempdir().unwrap();
        let base = r#"automations:
  - name: Mood
    enabled: true
    trigger:
      kind: property_changed
      property: mood
    action:
      kind: append_log
      text: "Mood noted"
views:
  - type: table
"#;
        std::fs::write(d.path().join("Daily.base"), base).unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        let rel = crate::capture::day_log(&ws.config().unwrap(), chrono::Local::now().date_naive());
        let abs = d.path().join(&rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        let text = "---\nmood: good\n---\n# Today\n";
        std::fs::write(&abs, text).unwrap();
        let ran = on_note_saved(&ws, &rel, Some("---\nmood: meh\n---\n# Today\n"), Some(text));
        assert_eq!(ran.touched, vec![rel.clone()]);
        assert!(std::fs::read_to_string(&abs).unwrap().contains("Mood noted"));
        assert!(ran.unheld && ran.held.is_none(), "the editor's copy lacks the line: {ran:?}");
    }

    #[test]
    fn a_filled_in_title_stays_text_and_a_held_copy_gets_the_edit() {
        let d = tempfile::tempdir().unwrap();
        let base = r#"automations:
  - name: Source
    enabled: true
    trigger:
      kind: property_changed
      property: status
      to: Done
    action:
      kind: set_property
      property: source
      value: "{{title}}"
views:
  - type: table
"#;
        std::fs::write(d.path().join("Tasks.base"), base).unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        for stem in ["- draft", "2026", "null"] {
            let rel = format!("{stem}.md");
            let done = "---\nstatus: Done\n---\nbody\n";
            std::fs::write(d.path().join(&rel), done).unwrap();
            let ran = on_note_saved(&ws, &rel, Some("---\nstatus: open\n---\nbody\n"), Some(done));
            assert_eq!(ran.touched, vec![rel.clone()]);
            assert_eq!(ran.set, ["source"]);
            let text = std::fs::read_to_string(d.path().join(&rel)).unwrap();
            let props = Props::from_markdown(&text);
            assert_eq!(props.get("source"), Some(&serde_yaml::Value::String(stem.into())), "{text}");
            assert_eq!(ran.held.as_deref(), Some(text.as_str()), "the editor's copy gets the same edit");
        }
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
