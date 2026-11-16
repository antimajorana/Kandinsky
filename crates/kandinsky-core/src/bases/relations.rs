//! Bidirectional `.base` relation synchronization: when a `.base` property declares `back_relation: <paired_prop>`,
//! adding or removing `[[Target]]` links on Note A atomically updates `<paired_prop>` on Note B with strict
//! idempotency and an in-flight cycle guard so file-watcher reloads never loop.
use crate::config::Config;
use crate::note_props::{extract_wikilinks_from_yaml, Props};
use crate::{frontmatter, links, paths, vault_write, walk, Result};
use serde::Deserialize;
use serde_yaml::Value;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

#[derive(Debug, Deserialize, Default)]
struct RelationBaseDoc {
    #[serde(default)]
    properties: BTreeMap<String, RelationPropMeta>,
}

#[derive(Debug, Deserialize, Default)]
struct RelationPropMeta {
    #[serde(default, alias = "backRelation")]
    back_relation: Option<String>,
}

/// Active `(canonical_root, note_a, note_b, prop)` sync edges in flight to prevent re-entrant cycles.
static IN_FLIGHT: LazyLock<Mutex<HashSet<(PathBuf, String, String, String)>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

struct FlightGuard {
    edges: Vec<(PathBuf, String, String, String)>,
}

impl FlightGuard {
    fn acquire(root: &Path, a: &str, prop: &str, b: &str, back_prop: &str) -> Option<Self> {
        let canon = paths::real(root).unwrap_or_else(|_| root.to_path_buf());
        let forward = (canon.clone(), a.to_string(), b.to_string(), back_prop.to_string());
        let reverse = (canon, b.to_string(), a.to_string(), prop.to_string());
        let mut set = IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
        if set.contains(&forward) || set.contains(&reverse) {
            return None;
        }
        set.insert(forward.clone());
        set.insert(reverse.clone());
        Some(Self { edges: vec![forward, reverse] })
    }
}

impl Drop for FlightGuard {
    fn drop(&mut self) {
        let mut set = IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
        for e in &self.edges {
            set.remove(e);
        }
    }
}

fn clean_prop_name(raw: &str) -> Option<String> {
    let bare = raw.trim().strip_prefix("note.").unwrap_or(raw.trim()).trim();
    if bare.is_empty() || bare.starts_with("file.") || bare.starts_with("formula.") {
        return None;
    }
    frontmatter::plain_key(bare).ok().map(str::to_string)
}

/// Collects `(source_prop, target_back_prop)` pairs declared across all `.base` files in `root`.
fn declared_back_relations(root: &Path, cfg: &Config) -> Vec<(String, String)> {
    let mut pairs = BTreeSet::new();
    for (abs, rel) in walk::files(root, cfg) {
        if !rel.ends_with(".base") {
            continue;
        }
        let Ok(src) = std::fs::read_to_string(&abs) else { continue };
        let Ok(doc) = serde_yaml::from_str::<RelationBaseDoc>(&src) else { continue };
        for (col, meta) in doc.properties {
            let Some(back_raw) = meta.back_relation.as_deref() else { continue };
            if let (Some(src_prop), Some(back_prop)) = (clean_prop_name(&col), clean_prop_name(back_raw)) {
                pairs.insert((src_prop, back_prop));
            }
        }
    }
    pairs.into_iter().collect()
}

fn resolve_note_targets(targets: &[String], from_rel: &str, vault: &links::Vault) -> BTreeSet<String> {
    targets
        .iter()
        .filter_map(|t| vault.resolve(t, from_rel))
        .filter(|p| p.ends_with(".md"))
        .collect()
}

fn target_links_to_source(raw_link: &str, target_rel: &str, source_rel: &str, vault: &links::Vault) -> bool {
    if let Some(resolved) = vault.resolve(raw_link, target_rel) {
        return resolved == source_rel;
    }
    let clean = raw_link.split('|').next().unwrap_or(raw_link).split('#').next().unwrap_or(raw_link).trim();
    let clean_no_md = clean.strip_suffix(".md").unwrap_or(clean);
    let src_no_md = source_rel.strip_suffix(".md").unwrap_or(source_rel);
    clean_no_md.eq_ignore_ascii_case(src_no_md) || clean_no_md.eq_ignore_ascii_case(&super::stem(source_rel))
}

fn wikilink_for_source(source_rel: &str, from_target_rel: &str, vault: &links::Vault) -> String {
    let s = super::stem(source_rel);
    if vault.resolve(&s, from_target_rel).as_deref() == Some(source_rel) {
        format!("[[{s}]]")
    } else {
        let full = source_rel.strip_suffix(".md").unwrap_or(source_rel);
        format!("[[{full}]]")
    }
}

/// Synchronizes paired `back_relation` frontmatter properties when `note_rel` changes from `before_text` to `after_text`.
/// Returns the vault-relative paths of target notes whose files were modified.
pub fn sync_back_relations(
    root: &Path,
    cfg: &Config,
    note_rel: &str,
    before_text: &str,
    after_text: &str,
) -> Result<Vec<String>> {
    if !note_rel.ends_with(".md") || before_text == after_text {
        return Ok(Vec::new());
    }
    let pairs = declared_back_relations(root, cfg);
    if pairs.is_empty() {
        return Ok(Vec::new());
    }
    let before_props = Props::from_markdown(before_text);
    let after_props = Props::from_markdown(after_text);
    if pairs.iter().all(|(p, _)| before_props.get(p) == after_props.get(p)) {
        return Ok(Vec::new());
    }

    let vault = links::vault(root, cfg);
    let mut touched = BTreeSet::new();

    for (prop, back_prop) in &pairs {
        if before_props.get(prop) == after_props.get(prop) {
            continue;
        }
        let old_set = resolve_note_targets(&before_props.wikilink_targets(prop), note_rel, &vault);
        let new_set = resolve_note_targets(&after_props.wikilink_targets(prop), note_rel, &vault);

        for added_rel in new_set.difference(&old_set) {
            if added_rel == note_rel && prop == back_prop {
                continue;
            }
            let Some(_guard) = FlightGuard::acquire(root, note_rel, prop, added_rel, back_prop) else {
                continue;
            };
            let Ok(target_abs) = paths::safe_join(root, added_rel) else { continue };
            if !target_abs.is_file() {
                continue;
            }
            let link_str = wikilink_for_source(note_rel, added_rel, &vault);
            let mut changed = false;
            vault_write::modify(&target_abs, |target_text| {
                let t_props = Props::from_markdown(target_text);
                let existing = t_props.wikilink_targets(back_prop);
                if existing.iter().any(|t| target_links_to_source(t, added_rel, note_rel, &vault)) {
                    return Ok(target_text.to_string());
                }
                let next_val = match t_props.get(back_prop) {
                    Some(Value::Sequence(seq)) => {
                        let mut items = seq.clone();
                        items.push(Value::String(link_str.clone()));
                        Value::Sequence(items)
                    }
                    Some(Value::String(s)) if !s.trim().is_empty() => {
                        Value::Sequence(vec![Value::String(s.clone()), Value::String(link_str.clone())])
                    }
                    _ => Value::Sequence(vec![Value::String(link_str.clone())]),
                };
                let updated = frontmatter::set_property(target_text, back_prop, &next_val);
                changed = updated != target_text;
                Ok(updated)
            })?;
            if changed {
                touched.insert(added_rel.clone());
            }
        }

        for removed_rel in old_set.difference(&new_set) {
            if removed_rel == note_rel && prop == back_prop {
                continue;
            }
            let Some(_guard) = FlightGuard::acquire(root, note_rel, prop, removed_rel, back_prop) else {
                continue;
            };
            let Ok(target_abs) = paths::safe_join(root, removed_rel) else { continue };
            if !target_abs.is_file() {
                continue;
            }
            let mut changed = false;
            vault_write::modify(&target_abs, |target_text| {
                let t_props = Props::from_markdown(target_text);
                let existing = t_props.wikilink_targets(back_prop);
                if !existing.iter().any(|t| target_links_to_source(t, removed_rel, note_rel, &vault)) {
                    return Ok(target_text.to_string());
                }
                let next_val = match t_props.get(back_prop) {
                    Some(Value::Sequence(seq)) => {
                        let kept: Vec<Value> = seq
                            .iter()
                            .filter(|item| {
                                !extract_wikilinks_from_yaml(item)
                                    .iter()
                                    .any(|t| target_links_to_source(t, removed_rel, note_rel, &vault))
                            })
                            .cloned()
                            .collect();
                        if kept.is_empty() { Value::Null } else { Value::Sequence(kept) }
                    }
                    Some(Value::String(_)) => {
                        let kept: Vec<Value> = existing
                            .into_iter()
                            .filter(|t| !target_links_to_source(t, removed_rel, note_rel, &vault))
                            .map(|t| Value::String(format!("[[{t}]]")))
                            .collect();
                        if kept.is_empty() { Value::Null } else { Value::Sequence(kept) }
                    }
                    _ => Value::Null,
                };
                let updated = frontmatter::set_property(target_text, back_prop, &next_val);
                changed = updated != target_text;
                Ok(updated)
            })?;
            if changed {
                touched.insert(removed_rel.clone());
            }
        }
    }

    Ok(touched.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_removes_and_stays_idempotent_across_mutual_back_relations() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        std::fs::create_dir_all(r.join("projects")).unwrap();
        std::fs::create_dir_all(r.join("tasks")).unwrap();
        std::fs::write(
            r.join("Projects.base"),
            "properties:\n  tasks:\n    back_relation: project\nviews:\n  - type: table\n",
        )
        .unwrap();
        std::fs::write(
            r.join("Tasks.base"),
            "properties:\n  note.project:\n    backRelation: note.tasks\nviews:\n  - type: table\n",
        )
        .unwrap();
        std::fs::write(r.join("projects/Alpha.md"), "---\ntype: project\n---\n# Alpha\n").unwrap();
        std::fs::write(r.join("projects/Beta.md"), "---\ntype: project\n---\n# Beta\n").unwrap();

        let task_before = "---\ntype: task\n---\n# Fix Bug\n";
        let task_v1 = "---\ntype: task\nproject: '[[Alpha]]'\n---\n# Fix Bug\n";
        std::fs::write(r.join("tasks/Fix Bug.md"), task_v1).unwrap();

        let cfg = Config::default();
        let touched = sync_back_relations(r, &cfg, "tasks/Fix Bug.md", task_before, task_v1).unwrap();
        assert_eq!(touched, vec!["projects/Alpha.md"]);
        let alpha_after = std::fs::read_to_string(r.join("projects/Alpha.md")).unwrap();
        assert!(alpha_after.contains("[[Fix Bug]]"), "{alpha_after}");

        // Simulate watcher reload / reverse sync on Alpha.md -> must be strictly idempotent (zero writes!)
        let reverse_touched = sync_back_relations(r, &cfg, "projects/Alpha.md", "---\ntype: project\n---\n# Alpha\n", &alpha_after).unwrap();
        assert!(reverse_touched.is_empty(), "idempotent: Fix Bug already links to Alpha");

        // Re-running with identical before/after or already-synced target does nothing
        let repeat = sync_back_relations(r, &cfg, "tasks/Fix Bug.md", task_before, task_v1).unwrap();
        assert!(repeat.is_empty(), "idempotent on repeated call");

        // Retarget Fix Bug from Alpha -> Beta
        let task_v2 = "---\ntype: task\nproject: '[[Beta]]'\n---\n# Fix Bug\n";
        std::fs::write(r.join("tasks/Fix Bug.md"), task_v2).unwrap();
        let moved = sync_back_relations(r, &cfg, "tasks/Fix Bug.md", task_v1, task_v2).unwrap();
        assert_eq!(moved, vec!["projects/Alpha.md", "projects/Beta.md"]);
        let alpha_clean = std::fs::read_to_string(r.join("projects/Alpha.md")).unwrap();
        let beta_linked = std::fs::read_to_string(r.join("projects/Beta.md")).unwrap();
        assert!(!alpha_clean.contains("Fix Bug"), "{alpha_clean}");
        assert!(beta_linked.contains("[[Fix Bug]]"), "{beta_linked}");
    }
}
