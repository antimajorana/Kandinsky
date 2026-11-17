//! Vault-wide frontmatter schema and typed-link audit (`GET /api/properties/audit`, `kandinsky properties-audit`),
//! plus single-property validation shared with `kandinsky_set_property`.
use crate::api::{PropertiesAuditReport, PropertyIssue, PropertyIssueKind, PropertyKind, PropertySpec, PropertySpecs};
use crate::config::Config;
use crate::note_props::extract_wikilinks_from_yaml;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime};
use serde_yaml::Value;
use std::collections::HashMap;
use std::path::Path;

const BUILTIN_LINK_KEYS: &[&str] = &["up", "conventions", "depends_on", "sources"];
const SYSTEM_KEYS: &[&str] = &["title", "type", "aliases", "tags", "cssclasses", "icon", "cover", "shown"];

/// Audits every indexed Markdown note in `root` against `cfg.editor.properties_spec` and vault link targets.
pub fn audit(root: &Path, cfg: &Config, strict: bool) -> PropertiesAuditReport {
    let specs = crate::property_spec::load(root, &cfg.editor.properties_spec);
    let snap = crate::links::snapshot(root, cfg);
    let mut note_paths: Vec<&String> = snap
        .parsed
        .keys()
        .filter(|r| r.to_ascii_lowercase().ends_with(".md") && !cfg.is_ignored(r) && !cfg.is_agent_file(r) && !cfg.in_templates(r))
        .collect();
    note_paths.sort();

    let mut issues = Vec::new();
    for rel in &note_paths {
        let Some(props) = snap.parsed.get(*rel).and_then(|p| p.props_whole()) else { continue };
        let mut pending: Vec<(String, PropertyIssueKind, String)> = Vec::new();
        let note_type = props.get("type").and_then(Value::as_str).map(clean_scalar_token).filter(|s| !s.is_empty()).map(str::to_string);
        let type_spec = note_type.as_deref().and_then(|nt| {
            specs.types.get(nt).or_else(|| specs.types.iter().find(|(k, _)| k.eq_ignore_ascii_case(nt)).map(|(_, v)| v))
        });

        if let Some(ts) = type_spec {
            let type_name = note_type.as_deref().unwrap_or_default();
            for req in &ts.required {
                if props.get(req).is_none_or(is_empty_yaml) {
                    pending.push((req.clone(), PropertyIssueKind::MissingRequired, format!("missing required property `{req}` for type `{type_name}`")));
                }
            }
        }

        for (key, val) in props.iter() {
            if let Some(Err(msg)) = specs.properties.get(key).map(|spec| validate_property_value(spec, val)) {
                pending.push((key.to_string(), PropertyIssueKind::InvalidValue, format!("`{key}`: {msg}")));
            }
        }

        for (key, val) in props.iter() {
            let spec = specs.properties.get(key);
            let is_builtin = BUILTIN_LINK_KEYS.contains(&key);
            let is_spec_link = spec.is_some_and(|s| matches!(s.kind, PropertyKind::Link | PropertyKind::Links));
            if !is_builtin && !is_spec_link {
                continue;
            }
            for target in link_targets_to_check(key, spec, val) {
                if (!is_builtin && is_suggested_token(spec, &target))
                    || snap.names.resolve_target(&target, true, rel).is_some()
                    || crate::external_roots::resolve_external_file(root, cfg, &target).is_ok_and(|p| p.exists())
                {
                    continue;
                }
                pending.push((key.to_string(), PropertyIssueKind::BrokenLink, format!("broken wikilink [[{target}]] in `{key}`")));
            }
        }

        if strict && specs.found {
            for (key, _) in props.iter() {
                if !is_known_key(key, &specs, type_spec) {
                    pending.push((key.to_string(), PropertyIssueKind::UnknownProperty, format!("unknown property `{key}` not declared in `{}`", specs.path)));
                }
            }
        }

        if !pending.is_empty() {
            let (key_lines, default_line) = read_frontmatter_lines(root, rel);
            for (key, kind, message) in pending {
                let line = key_lines.get(&key).copied().unwrap_or(default_line);
                issues.push(PropertyIssue { path: (*rel).clone(), line, key, kind, message, note_type: note_type.clone() });
            }
        }
    }

    issues.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)).then(a.key.cmp(&b.key)));
    PropertiesAuditReport { spec_path: specs.path, spec_found: specs.found, strict, notes_scanned: note_paths.len() as u32, spec_problems: specs.problems, issues }
}

/// Validates a single YAML property `value` against `spec`. Empty values pass (`type_spec.required` checks presence).
pub fn validate_property_value(spec: &PropertySpec, value: &Value) -> Result<(), String> {
    if let Value::Tagged(tagged) = value {
        return validate_property_value(spec, &tagged.value);
    }
    if is_empty_yaml(value) {
        return Ok(());
    }
    match spec.kind {
        PropertyKind::Enum => validate_enum(spec, value),
        PropertyKind::Number => match value {
            Value::Number(n) if n.as_f64().is_some_and(f64::is_finite) => Ok(()),
            Value::String(s) if s.trim().parse::<f64>().is_ok_and(f64::is_finite) => Ok(()),
            _ => Err(format!("expected a finite number, got {}", describe_value(value))),
        },
        PropertyKind::Bool => match value {
            Value::Bool(_) => Ok(()),
            _ => Err(format!("expected a boolean (true or false), got {}", describe_value(value))),
        },
        PropertyKind::Date => match value {
            Value::String(s) if validate_date_str(s.trim(), spec.format.trim()) => Ok(()),
            _ => Err(format!("expected valid date (YYYY-MM-DD), got {}", describe_value(value))),
        },
        PropertyKind::Datetime => match value {
            Value::String(s) if validate_datetime_str(s.trim(), spec.format.trim()) => Ok(()),
            _ => Err(format!("expected valid datetime (YYYY-MM-DD HH:MM), got {}", describe_value(value))),
        },
        PropertyKind::Text => match value {
            Value::String(_) | Value::Number(_) | Value::Bool(_) => Ok(()),
            _ => Err(format!("expected text scalar, got {}", describe_value(value))),
        },
        PropertyKind::Link => match value {
            Value::String(_) => Ok(()),
            _ => Err(format!("expected link string, got {}", describe_value(value))),
        },
        PropertyKind::Links => match value {
            Value::String(_) => Ok(()),
            Value::Sequence(seq) if seq.iter().all(|v| v.is_null() || v.is_string()) => Ok(()),
            _ => Err(format!("expected link or list of links, got {}", describe_value(value))),
        },
        PropertyKind::List | PropertyKind::Tags => match value {
            Value::String(_) | Value::Number(_) | Value::Bool(_) => Ok(()),
            Value::Sequence(seq) if seq.iter().all(|v| !v.is_mapping() && !v.is_sequence()) => Ok(()),
            _ => Err(format!("expected list of scalars, got {}", describe_value(value))),
        },
    }
}

/// Convenience wrapper for validating a JSON property value (e.g. from MCP or HTTP) against `spec`.
pub fn validate_property_json_value(spec: &PropertySpec, value: &serde_json::Value) -> Result<(), String> {
    let yv = serde_yaml::to_value(value).map_err(|e| e.to_string())?;
    validate_property_value(spec, &yv)
}

fn validate_enum(spec: &PropertySpec, value: &Value) -> Result<(), String> {
    let items: Vec<&Value> = match value {
        Value::Sequence(seq) => seq.iter().filter(|v| !is_empty_yaml(v)).collect(),
        other => vec![other],
    };
    for item in items {
        let Some(raw) = scalar_text(item) else {
            return Err(format!("expected enum scalar, got {}", describe_value(item)));
        };
        if !spec.values.is_empty() {
            let bare = clean_scalar_token(&raw);
            if !spec.values.iter().any(|a| a.trim() == raw || clean_scalar_token(a) == bare) {
                return Err(format!("invalid value `{raw}` (allowed: {})", spec.values.join(", ")));
            }
        }
    }
    Ok(())
}

fn is_empty_yaml(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Sequence(seq) => seq.is_empty() || seq.iter().all(is_empty_yaml),
        Value::Mapping(m) => m.is_empty(),
        Value::Tagged(t) => is_empty_yaml(&t.value),
        _ => false,
    }
}

fn scalar_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Tagged(t) => scalar_text(&t.value),
        _ => None,
    }
}

fn describe_value(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => format!("boolean `{b}`"),
        Value::Number(n) => format!("number `{n}`"),
        Value::String(s) => format!("`{}`", s.trim()),
        Value::Sequence(_) => "a list".into(),
        Value::Mapping(_) => "a mapping".into(),
        Value::Tagged(t) => describe_value(&t.value),
    }
}

fn clean_scalar_token(s: &str) -> &str {
    let t = s.trim();
    if let Some(inner) = t.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")).filter(|i| !i.contains("[[")) {
        let before_alias = inner.split('|').next().unwrap_or(inner);
        return strip_anchor_and_block(before_alias);
    }
    t
}

fn is_valid_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
        && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn valid_time_token(s: &str, with_secs: bool) -> bool {
    let want = if with_secs { 8 } else { 5 };
    let fmt = if with_secs { "%H:%M:%S" } else { "%H:%M" };
    s.len() == want
        && s.bytes().enumerate().all(|(i, c)| if i == 2 || i == 5 { c == b':' } else { c.is_ascii_digit() })
        && NaiveTime::parse_from_str(s, fmt).is_ok()
}

fn is_valid_iso_datetime(s: &str) -> bool {
    if DateTime::parse_from_rfc3339(s).is_ok() {
        return true;
    }
    let b = s.as_bytes();
    if b.len() < 16
        || !s.is_char_boundary(10)
        || !s.is_char_boundary(11)
        || !is_valid_iso_date(&s[..10])
        || !matches!(b[10], b' ' | b'T')
    {
        return false;
    }
    let rest = &s[11..];
    let time_part = if let Some(stripped) = rest.strip_suffix(['Z', 'z']) {
        stripped
    } else if rest.len() > 6
        && rest.is_char_boundary(rest.len() - 6)
        && rest.is_char_boundary(rest.len() - 5)
        && matches!(rest.as_bytes()[rest.len() - 6], b'+' | b'-')
    {
        if !valid_time_token(&rest[rest.len() - 5..], false) {
            return false;
        }
        &rest[..rest.len() - 6]
    } else {
        rest
    };
    let (hms, frac_ok) = match time_part.split_once('.') {
        Some((a, f)) => (a, !f.is_empty() && f.bytes().all(|c| c.is_ascii_digit())),
        None => (time_part, true),
    };
    frac_ok && (valid_time_token(hms, false) || valid_time_token(hms, true))
}

fn moment_to_chrono(fmt: &str) -> String {
    fmt.replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d").replace("HH", "%H").replace("mm", "%M").replace("ss", "%S")
}

fn validate_date_str(s: &str, fmt: &str) -> bool {
    is_valid_iso_date(s)
        || (!fmt.is_empty() && {
            let cf = moment_to_chrono(fmt);
            (is_valid_iso_datetime(s) && fmt.contains(['H', 'h', 'm']))
                || NaiveDate::parse_from_str(s, &cf).is_ok()
                || NaiveDateTime::parse_from_str(s, &cf).is_ok()
        })
}

fn validate_datetime_str(s: &str, fmt: &str) -> bool {
    is_valid_iso_datetime(s)
        || (fmt == "YYYY-MM-DD" && is_valid_iso_date(s))
        || (!fmt.is_empty() && NaiveDateTime::parse_from_str(s, &moment_to_chrono(fmt)).is_ok())
}

fn is_external_ref(s: &str) -> bool {
    let low = s.trim().to_ascii_lowercase();
    ["http://", "https://", "mailto:", "doi:", "arxiv:"].iter().any(|p| low.starts_with(p))
}

fn strip_anchor_and_block(t: &str) -> &str {
    let no_head = t.split('#').next().unwrap_or(t);
    no_head.split('^').next().unwrap_or(no_head).trim()
}

fn link_targets_to_check(key: &str, spec: Option<&PropertySpec>, val: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let mut push = |t: &str| {
        let clean = strip_anchor_and_block(t);
        if !clean.is_empty() && !out.iter().any(|x| x == clean) {
            out.push(clean.to_string());
        }
    };
    let allow_plain = key != "sources" && spec.is_some_and(|s| matches!(s.kind, PropertyKind::Link | PropertyKind::Links));
    let mut visit = |s: &str| {
        let trimmed = s.trim();
        if trimmed.contains("[[") {
            for w in extract_wikilinks_from_yaml(&Value::String(trimmed.to_string())) {
                push(&w);
            }
        } else if !trimmed.is_empty() && allow_plain && !is_external_ref(trimmed) {
            push(trimmed.split('|').next().unwrap_or(trimmed));
        }
    };
    match val {
        Value::String(s) => visit(s),
        Value::Sequence(seq) => seq.iter().filter_map(Value::as_str).for_each(visit),
        Value::Tagged(t) => return link_targets_to_check(key, spec, &t.value),
        _ => {}
    }
    out
}

fn is_suggested_token(spec: Option<&PropertySpec>, target: &str) -> bool {
    let Some(sp) = spec else { return false };
    let wiki = format!("[[{target}]]");
    sp.values.iter().chain(sp.suggest.iter()).any(|v| v.trim() == wiki || v.trim() == target)
}

fn is_known_key(key: &str, specs: &PropertySpecs, type_spec: Option<&crate::api::NoteTypeSpec>) -> bool {
    specs.properties.contains_key(key)
        || SYSTEM_KEYS.contains(&key)
        || type_spec.is_some_and(|ts| ts.required.iter().any(|r| r == key) || ts.optional.iter().any(|o| o == key))
}

fn read_frontmatter_lines(root: &Path, rel: &str) -> (HashMap<String, u32>, u32) {
    let text = crate::paths::safe_join(root, rel).ok().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    let Some(range) = kandinsky_text::frontmatter::yaml_range(&text) else { return (HashMap::new(), 1) };
    let (mut map, mut closing, mut at) = (HashMap::new(), 1, 0);
    for (idx, raw) in text.split_inclusive('\n').enumerate() {
        let (line_no, start) = (idx as u32 + 1, at);
        at += raw.len();
        if start < range.start {
            continue;
        }
        if start >= range.end {
            closing = line_no;
            break;
        }
        let line = raw.trim_end_matches(['\r', '\n']);
        if !line.starts_with([' ', '\t', '-', '#']) {
            if let Some((k, _)) = line.split_once(':') {
                let clean = k.trim().trim_matches(['"', '\'']);
                if !clean.is_empty() {
                    map.entry(clean.to_string()).or_insert(line_no);
                }
            }
        }
    }
    (map, closing)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPEC: &str = "properties:\n  status: {kind: enum, values: [draft, accepted, stale]}\n  created: date\n  updated: datetime\n  confidence: number\n  verified: bool\n  up: links\n  depends_on: links\n  conventions: link\n  sources: links\n  shelf: {kind: link, suggest: [\"[[to-read]]\"]}\ntypes:\n  literature:\n    required: [status, created, sources]\n    optional: [up, custom_note]\n";

    fn write_file(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    #[test]
    fn audits_missing_invalid_broken_links_strict_unknowns_and_exclusions() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_file(root, "templates/properties.yaml", SPEC);
        write_file(root, "templates/literature.md", "---\ntype: literature\nstatus: bogus\n---\n");
        write_file(root, "notes/Hub.md", "---\nstatus: accepted\ncreated: 2026-10-01\nshelf: \"[[to-read]]\"\n---\n");
        write_file(
            root,
            "notes/Paper.md",
            "---\ntype: Literature\nstatus: invalid_state\ncreated: 2026-02-30\nupdated: 2026-10-14\nconfidence: nan_text\nverified: yes_please\nup: \"[[Missing Parent]]\"\nconventions: \"[[Missing Conv^block]]\"\ndepends_on:\n  - \"[[Missing Lemma#Proof]]\"\nsources:\n  - https://doi.org/10.1103/PhysRevB.1.1\n  - arXiv:2501.00001\n  - \"[[Missing Source]]\"\nextra_field: 42\ncustom_note: allowed\n---\n",
        );
        write_file(root, "notes/Incomplete.md", "---\ntype: \"[[literature]]\"\nstatus: \"\"\ncreated: 2026-10-10\n---\n");
        write_file(root, "docs/memory/agent.md", "---\ntype: literature\nstatus: bad_agent\n---\n");
        write_file(root, "scratch/agent_log.md", "---\ntype: literature\nstatus: bad_custom_exclude\n---\n");
        write_file(root, "runs/dump.md", "---\ntype: literature\nstatus: bad_ignored\n---\n");

        let mut cfg = Config::default();
        cfg.editor.index_exclude.push("scratch".into());

        let lax = audit(root, &cfg, false);
        assert!(lax.spec_found && lax.notes_scanned == 3, "Hub, Paper, Incomplete only");
        assert!(lax.issues.iter().all(|i| !i.path.contains("memory") && !i.path.contains("scratch") && !i.path.contains("runs") && !i.path.contains("templates")));
        assert!(lax.issues.iter().all(|i| i.path != "notes/Hub.md"), "suggested shelf token is allowed: {:?}", lax.issues);
        assert!(lax.issues.iter().all(|i| i.kind != PropertyIssueKind::UnknownProperty));

        let strict_rep = audit(root, &cfg, true);
        let paper: Vec<&PropertyIssue> = strict_rep.issues.iter().filter(|i| i.path == "notes/Paper.md").collect();
        for (key, line) in [("status", 3), ("created", 4), ("updated", 5), ("confidence", 6), ("verified", 7)] {
            assert!(paper.iter().any(|i| i.key == key && i.kind == PropertyIssueKind::InvalidValue && i.line == line), "{key}");
        }
        for (key, target) in [("up", "Missing Parent"), ("conventions", "Missing Conv"), ("depends_on", "Missing Lemma"), ("sources", "Missing Source")] {
            assert!(paper.iter().any(|i| i.key == key && i.kind == PropertyIssueKind::BrokenLink && i.message.contains(target)), "{key}");
        }
        assert_eq!(paper.iter().filter(|i| i.key == "sources").count(), 1, "DOI URL and arXiv pass");
        assert!(paper.iter().any(|i| i.key == "extra_field" && i.kind == PropertyIssueKind::UnknownProperty));
        assert!(paper.iter().all(|i| i.key != "custom_note"));

        let inc: Vec<&PropertyIssue> = strict_rep.issues.iter().filter(|i| i.path == "notes/Incomplete.md").collect();
        assert!(inc.iter().any(|i| i.key == "status" && i.kind == PropertyIssueKind::MissingRequired && i.line == 3));
        assert!(inc.iter().any(|i| i.key == "sources" && i.kind == PropertyIssueKind::MissingRequired && i.line == 5));
    }

    #[test]
    fn validates_single_property_values_for_mcp_edits() {
        let specs = crate::property_spec::parse(SPEC);
        assert!(validate_property_value(&specs.properties["updated"], &Value::String("2026-10-14 09:30".into())).is_ok());
        assert!(validate_property_value(&specs.properties["updated"], &Value::String("2026-10-14T09:30:00+02:00".into())).is_ok());
        assert!(validate_property_value(&specs.properties["updated"], &Value::String("2026-10-14".into())).is_err());
        assert!(validate_property_value(&specs.properties["status"], &Value::String("[[accepted]]".into())).is_ok());
        assert!(validate_property_value(&specs.properties["confidence"], &Value::String("3.5".into())).is_ok());
        assert!(validate_property_value(&specs.properties["created"], &Value::Null).is_ok());
    }

    #[test]
    fn rejects_multibyte_utf8_datetimes_without_panicking() {
        for bad in [
            "2026年01月01日 12:00",
            "2026-01-0€ 12:00",
            "2026-01-01€12:00",
            "2026-01-01 12:00+0€:00",
            "2026-01-01 12:00+€00",
            "2026-01-01 12:00+00€",
            "2026-01-01 12:00-0€",
        ] {
            assert!(!is_valid_iso_datetime(bad), "should reject {bad:?}");
        }
        assert!(is_valid_iso_datetime("2026-01-01 12:00+02:00"));
        assert!(is_valid_iso_datetime("2026-01-01T12:00:05Z"));
    }
}
