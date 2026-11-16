//! Upstream dependency & conventions health (`GET /api/note/upstream`, `kandinsky note-upstream`, and Bases
//! `file.upstreamStatus` / `upstreamStatus()` / `isUpstreamStale()`).
use crate::api::{UpstreamHealth, UpstreamReason, UpstreamState};
use crate::config::Config;
use crate::links::{FileCache, LineKind, Names};
use crate::note_props::{extract_wikilinks_from_yaml, Props};
use chrono::NaiveDateTime;
use serde_yaml::Value;
use std::collections::{HashSet, VecDeque};
use std::path::Path;

/// Frontmatter and inline typed-link keys that declare upstream dependencies or conventions.
pub const UPSTREAM_KEYS: &[&str] = &["depends_on", "up", "conventions"];

const MAX_DEPTH: u8 = 8;

/// Computes upstream staleness and convention/dependency changes for `path` in `root`.
pub fn check_note(root: &Path, cfg: &Config, path: &str) -> UpstreamHealth {
    let snap = crate::links::snapshot(root, cfg);
    let norm = path.trim().trim_start_matches("./").replace('\\', "/");
    let key = if snap.parsed.contains_key(path) { path } else { norm.as_str() };
    let extra = crate::paths::safe_join(root, key)
        .ok()
        .and_then(|abs| std::fs::read_to_string(abs).ok())
        .map(|text| inline_upstream_edges(&text, key, &snap.names))
        .unwrap_or_default();
    if extra.is_empty() {
        return check_in_index(key, &snap.parsed, &snap.names);
    }
    check_with(
        key,
        &extra,
        |p| snap.parsed.get(p).map(|n| &n.props),
        |target, from| snap.names.resolve_target(target, true, from),
    )
}

/// Zero-IO upstream check over an already-loaded `FileCache` + `Names`.
pub(crate) fn check_in_index(path: &str, parsed: &FileCache, names: &Names) -> UpstreamHealth {
    check_with(
        path,
        &[],
        |p| parsed.get(p).map(|n| &n.props),
        |target, from| names.resolve_target(target, true, from),
    )
}

/// Core BFS evaluator shared by `check_note`, `check_in_index`, and Bases `Ctx`.
pub(crate) fn check_with<'a>(
    path: &str,
    extra_edges: &[(String, String)],
    props_of: impl Fn(&str) -> Option<&'a Props>,
    resolve: impl Fn(&str, &str) -> Option<String>,
) -> UpstreamHealth {
    let root_props = props_of(path);
    let down_stamp = root_props.and_then(|p| parse_stamp(p, &["updated", "accepted_date", "created", "date"]));

    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(path.to_string());
    let mut queue: VecDeque<(String, String, u8)> = VecDeque::new();

    if let Some(rp) = root_props {
        for (target, rel) in outgoing_from_props(rp, path, &resolve) {
            if visited.insert(target.clone()) {
                queue.push_back((target, rel, 1));
            }
        }
    }
    for (target, rel) in extra_edges {
        if visited.insert(target.clone()) {
            queue.push_back((target.clone(), rel.clone(), 1));
        }
    }

    let mut reasons = Vec::new();
    while let Some((target_path, relation, depth)) = queue.pop_front() {
        let up_props = props_of(&target_path);
        let status = up_props.and_then(|p| clean_prop_str(p, "status"));
        let is_stale = status.as_deref().is_some_and(|s| s.eq_ignore_ascii_case("stale"));

        if is_stale {
            reasons.push(UpstreamReason {
                detail: format!("{} is marked stale", note_stem(&target_path)),
                target: target_path.clone(),
                relation: relation.clone(),
                state: UpstreamState::Stale,
            });
        } else {
            let up_type = up_props.and_then(|p| clean_prop_str(p, "type"));
            let is_conventions = relation == "conventions"
                || up_type.as_deref().is_some_and(|t| t.eq_ignore_ascii_case("conventions"));
            let is_accepted = status.as_deref().is_some_and(|s| s.eq_ignore_ascii_case("accepted"));
            let is_direct_dep = depth == 1 && matches!(relation.as_str(), "depends_on" | "up");

            if is_conventions || is_accepted || is_direct_dep {
                if let (Some((up_dt, up_raw)), Some((down_dt, down_raw))) =
                    (up_props.and_then(|p| parse_stamp(p, &["updated"])), down_stamp.as_ref())
                {
                    if up_dt > *down_dt {
                        reasons.push(UpstreamReason {
                            detail: format!("{} updated {up_raw} (after {down_raw})", note_stem(&target_path)),
                            target: target_path.clone(),
                            relation: relation.clone(),
                            state: UpstreamState::Changed,
                        });
                    }
                }
            }
        }

        if depth < MAX_DEPTH {
            if let Some(up) = up_props {
                for (next_target, next_rel) in outgoing_from_props(up, &target_path, &resolve) {
                    if visited.insert(next_target.clone()) {
                        queue.push_back((next_target, next_rel, depth + 1));
                    }
                }
            }
        }
    }

    let state = if reasons.iter().any(|r| r.state == UpstreamState::Stale) {
        UpstreamState::Stale
    } else if reasons.iter().any(|r| r.state == UpstreamState::Changed) {
        UpstreamState::Changed
    } else {
        UpstreamState::Ok
    };
    let label = match state {
        UpstreamState::Stale => "Upstream stale".into(),
        UpstreamState::Changed => "Upstream changed".into(),
        UpstreamState::Ok => String::new(),
    };
    UpstreamHealth { state, label, reasons }
}

fn outgoing_from_props(
    props: &Props,
    from_path: &str,
    resolve: &impl Fn(&str, &str) -> Option<String>,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for &key in UPSTREAM_KEYS {
        let Some(val) = props.get(key) else { continue };
        for cand in candidate_targets(val) {
            if let Some(resolved) = resolve(&cand, from_path) {
                if !out.iter().any(|(p, _)| p == &resolved) {
                    out.push((resolved, key.to_string()));
                }
            }
        }
    }
    out
}

fn candidate_targets(val: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let mut push = |raw: &str| {
        let no_head = raw.split('#').next().unwrap_or(raw);
        let clean = no_head.split('^').next().unwrap_or(no_head).trim();
        if !clean.is_empty() && !out.iter().any(|x| x == clean) {
            out.push(clean.to_string());
        }
    };
    let mut visit = |s: &str| {
        let t = s.trim();
        if t.contains("[[") {
            for w in extract_wikilinks_from_yaml(&Value::String(t.to_string())) {
                push(&w);
            }
        } else if !t.is_empty() && !t.contains("://") && !t.starts_with("mailto:") {
            push(t.split('|').next().unwrap_or(t));
        }
    };
    match val {
        Value::String(s) => visit(s),
        Value::Sequence(seq) => {
            for item in seq {
                if let Value::String(s) = item {
                    visit(s);
                }
            }
        }
        Value::Tagged(t) => return candidate_targets(&t.value),
        _ => {}
    }
    out
}

fn inline_upstream_edges(text: &str, from_path: &str, names: &Names) -> Vec<(String, String)> {
    let mut out = Vec::new();
    crate::links::link_lines(text, |_, _, line, kind| {
        if !matches!(kind, LineKind::Text) {
            return;
        }
        let trimmed = line.trim_start();
        let trimmed = trimmed.strip_prefix(['-', '*', '+']).map_or(trimmed, str::trim_start);
        let Some((k, rest)) = trimmed.split_once("::") else { return };
        let key = k.trim();
        if !rest.starts_with([' ', '\t']) || !UPSTREAM_KEYS.contains(&key) {
            return;
        }
        for sp in crate::links::link_spans(line) {
            let raw = &line[sp.start..sp.end];
            let clean = raw.split('^').next().unwrap_or(raw);
            if let Some(resolved) = names.resolve_target(clean, sp.wiki, from_path) {
                if !out.iter().any(|(p, _)| p == &resolved) {
                    out.push((resolved, key.to_string()));
                }
            }
        }
    });
    out
}

fn clean_prop_str(props: &Props, key: &str) -> Option<String> {
    let val = props.get(key)?;
    let raw = match val {
        Value::String(s) => s.as_str(),
        Value::Sequence(seq) => seq.iter().find_map(Value::as_str)?,
        _ => return None,
    };
    let t = raw.trim();
    if let Some(inner) = t.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")).filter(|i| !i.contains("[[")) {
        let before_alias = inner.split('|').next().unwrap_or(inner);
        let before_head = before_alias.split('#').next().unwrap_or(before_alias);
        return Some(before_head.split('^').next().unwrap_or(before_head).trim().to_string());
    }
    (!t.is_empty()).then(|| t.to_string())
}

fn parse_stamp(props: &Props, keys: &[&str]) -> Option<(NaiveDateTime, String)> {
    for &key in keys {
        if let Some(raw) = clean_prop_str(props, key) {
            if let Some(dt) = kandinsky_template::dates::parse(&raw) {
                return Some((dt, raw));
            }
        }
    }
    None
}

fn note_stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_note(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn propagates_direct_and_transitive_staleness_changed_conventions_and_handles_cycles() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write_note(r, "notes/Root Lemma.md", "---\nstatus: \"[[stale]]\"\nupdated: 2026-10-01\n---\n");
        write_note(r, "notes/Mid Lemma.md", "---\nstatus: accepted\nupdated: 2026-10-02\ndepends_on:\n  - \"[[Root Lemma]]\"\n---\n");
        write_note(r, "notes/Theorem.md", "---\nstatus: accepted\naccepted_date: 2026-10-05\ndepends_on:\n  - \"[[Mid Lemma]]\"\n---\n");
        write_note(r, "notes/Units.md", "---\ntype: conventions\nupdated: 2026-10-20\n---\n");
        write_note(r, "notes/Result.md", "---\nstatus: accepted\nupdated: 2026-10-10\nconventions: \"[[Units]]\"\n---\n");
        write_note(r, "notes/Inline.md", "---\ncreated: 2026-10-05\n---\ndepends_on:: [[Root Lemma]]\n");
        write_note(r, "notes/Cycle A.md", "---\nupdated: 2026-10-10\ndepends_on: \"[[Cycle B]]\"\n---\n");
        write_note(r, "notes/Cycle B.md", "---\nupdated: 2026-10-09\ndepends_on: \"[[Cycle A]]\"\n---\n");

        let cfg = Config::default();
        let thm = check_note(r, &cfg, "notes/Theorem.md");
        assert_eq!((thm.state, thm.label.as_str()), (UpstreamState::Stale, "Upstream stale"));
        assert!(thm.reasons.iter().any(|x| x.target == "notes/Root Lemma.md" && x.detail.contains("Root Lemma is marked stale")));
        assert_eq!(check_note(r, &cfg, "notes/Inline.md").state, UpstreamState::Stale, "inline depends_on:: works");

        let res = check_note(r, &cfg, "notes/Result.md");
        assert_eq!((res.state, res.label.as_str()), (UpstreamState::Changed, "Upstream changed"));
        assert!(res.reasons.iter().any(|x| x.target == "notes/Units.md" && x.relation == "conventions"));

        let cyc = check_note(r, &cfg, "notes/Cycle A.md");
        assert_eq!(cyc.state, UpstreamState::Ok);
        assert!(cyc.label.is_empty() && cyc.reasons.is_empty());
    }
}
