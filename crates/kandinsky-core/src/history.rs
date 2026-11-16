//! Per-page local snapshot history (`.kandinsky/history/`) combined with in-process Git history (`gix`).
use crate::api::{
    FileWrite, HistorySource, Mtime, PageHistoryDetail, PageHistoryEntry, PageHistoryList, PageHistoryRestored,
};
use crate::{files, key_lock::KeyLocks, state_dir, vault_write, Error, Result, Workspace};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const HISTORY_DIR: &str = ".kandinsky/history";
const MAX_SNAPSHOTS: usize = 40;
const COALESCE_MS: u64 = 30_000;
const MAX_GIT_WALK: usize = 250;
const MAX_GIT_COMMITS: usize = 30;

static BUCKET_LOCKS: KeyLocks = KeyLocks::new();

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SnapshotIndex {
    #[serde(default)]
    path: String,
    #[serde(default)]
    entries: Vec<SnapshotMeta>, // oldest first, newest last
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapshotMeta {
    id: String,
    time_ms: u64,
    label: String,
    sha256: String,
    bytes: u64,
    lines: u32,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn count_lines(text: &str) -> u32 {
    if text.is_empty() { 0 } else { text.lines().count() as u32 }
}

fn next_snap_id(time_ms: u64) -> String {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    format!("s-{time_ms}-{}", SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

fn is_safe_snap_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn normalize_rel(ws: &Workspace, rel: &str) -> Result<String> {
    if rel.trim().is_empty() {
        return Err(Error::BadPath("empty path".into()));
    }
    let abs = ws.resolve(rel)?;
    if abs == ws.root() {
        return Err(Error::BadRequest("cannot inspect history of workspace root".into()));
    }
    let norm = ws.rel(&abs);
    if norm.is_empty() || state_dir::is_state_rel(&norm) || files::is_write_tmp(&norm) {
        return Err(Error::BadRequest(format!("history is not tracked for {rel}")));
    }
    Ok(norm)
}

fn history_root(ws: &Workspace) -> PathBuf {
    state_dir::join(ws.root(), HISTORY_DIR)
}

fn bucket_dir(ws: &Workspace, rel: &str) -> PathBuf {
    let file_name = rel.rsplit('/').next().unwrap_or(rel);
    let raw_stem = file_name.rsplit_once('.').map(|(s, _)| s).filter(|s| !s.is_empty()).unwrap_or(file_name);
    let mut stem = String::new();
    for c in raw_stem.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
            stem.push(c);
        } else if !stem.ends_with('-') && !stem.is_empty() {
            stem.push('-');
        }
        if stem.len() >= 40 {
            break;
        }
    }
    let clean_stem = match stem.trim_matches('-') {
        "" => "page",
        s => s,
    };
    let hex16: String = Sha256::digest(rel.as_bytes()).iter().take(8).map(|b| format!("{b:02x}")).collect();
    history_root(ws).join(format!("{clean_stem}-{hex16}"))
}

fn load_index(bucket: &Path) -> SnapshotIndex {
    std::fs::read_to_string(bucket.join("index.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn append_entry(bucket: &Path, index: &mut SnapshotIndex, rel: &str, text: &str, label: &str, desired_ms: u64) -> Result<SnapshotMeta> {
    let min_next = index.entries.last().map_or(0, |e| e.time_ms.saturating_add(1));
    let time_ms = desired_ms.max(min_next);
    let id = next_snap_id(time_ms);
    vault_write::write(&bucket.join(format!("{id}.snap")), text.as_bytes())?;
    let meta = SnapshotMeta {
        id,
        time_ms,
        label: label.to_string(),
        sha256: sha256_hex(text.as_bytes()),
        bytes: text.len() as u64,
        lines: count_lines(text),
    };
    index.path = rel.to_string();
    index.entries.push(meta.clone());
    Ok(meta)
}

fn prune_and_save(bucket: &Path, index: &mut SnapshotIndex) -> Result<()> {
    while index.entries.len() > MAX_SNAPSHOTS {
        let removed = index.entries.remove(0);
        let snap = bucket.join(format!("{}.snap", removed.id));
        if snap.exists() {
            let _ = vault_write::remove_file(&snap);
        }
    }
    let json = serde_json::to_vec_pretty(index).map_err(|e| Error::Other(e.into()))?;
    vault_write::write(&bucket.join("index.json"), &json)
}

fn save_unthrottled(ws: &Workspace, rel: &str, text: &str, label: &str) -> Result<SnapshotMeta> {
    vault_write::ignored_folder(&history_root(ws), "local page history snapshots")?;
    let bucket = bucket_dir(ws, rel);
    let lock = BUCKET_LOCKS.get(&bucket);
    let _held = lock.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = load_index(&bucket);
    let meta = append_entry(&bucket, &mut index, rel, text, label, now_ms())?;
    prune_and_save(&bucket, &mut index)?;
    Ok(meta)
}

fn to_api_entry(m: &SnapshotMeta) -> PageHistoryEntry {
    PageHistoryEntry {
        id: m.id.clone(),
        source: HistorySource::Snapshot,
        time: Mtime(m.time_ms),
        label: m.label.clone(),
        author: None,
        bytes: m.bytes,
        lines: m.lines,
    }
}

pub fn record_edit(ws: &Workspace, rel: &str, before_text: Option<&str>, after_text: &str) -> Result<()> {
    if rel.trim().is_empty() || state_dir::is_state_rel(rel) || files::is_write_tmp(rel) {
        return Ok(());
    }
    let abs = ws.resolve(rel)?;
    if abs == ws.root() {
        return Ok(());
    }
    let rel = ws.rel(&abs);
    if rel.is_empty() || state_dir::is_state_rel(&rel) || files::is_write_tmp(&rel) {
        return Ok(());
    }

    vault_write::ignored_folder(&history_root(ws), "local page history snapshots")?;
    let bucket = bucket_dir(ws, &rel);
    let lock = BUCKET_LOCKS.get(&bucket);
    let _held = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut index = load_index(&bucket);
    index.path = rel.clone();
    let now = now_ms();
    let mut dirty = false;

    if let Some(b) = before_text.filter(|b| !b.is_empty() && *b != after_text) {
        let b_hash = sha256_hex(b.as_bytes());
        let need_baseline = match index.entries.last() {
            None => true,
            Some(last) => last.sha256 != b_hash && now.saturating_sub(last.time_ms) >= COALESCE_MS,
        };
        if need_baseline {
            append_entry(&bucket, &mut index, &rel, b, "Before edit", now.saturating_sub(1))?;
            dirty = true;
        }
    }

    let after_hash = sha256_hex(after_text.as_bytes());
    if index.entries.last().is_some_and(|l| l.sha256 == after_hash) {
        return if dirty { prune_and_save(&bucket, &mut index) } else { Ok(()) };
    }

    let coalesce = index.entries.len() >= 2
        && index.entries.last().is_some_and(|l| l.label == "Auto-saved" && now.saturating_sub(l.time_ms) < COALESCE_MS);
    if coalesce {
        let min_prev = index.entries[index.entries.len() - 2].time_ms.saturating_add(1);
        let last = index.entries.last_mut().expect("len >= 2");
        vault_write::write(&bucket.join(format!("{}.snap", last.id)), after_text.as_bytes())?;
        last.time_ms = now.max(last.time_ms).max(min_prev);
        last.sha256 = after_hash;
        last.bytes = after_text.len() as u64;
        last.lines = count_lines(after_text);
    } else {
        append_entry(&bucket, &mut index, &rel, after_text, "Auto-saved", now)?;
    }
    prune_and_save(&bucket, &mut index)
}

pub fn create_snapshot(ws: &Workspace, rel: &str, label: Option<&str>) -> Result<PageHistoryEntry> {
    let rel = normalize_rel(ws, rel)?;
    let doc = files::read_text(ws, &rel)?;
    let lbl = label.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("Manual snapshot");
    Ok(to_api_entry(&save_unthrottled(ws, &doc.path, &doc.text, lbl)?))
}

fn repo_rel_path(repo: &gix::Repository, ws: &Workspace, rel: &str) -> String {
    if let Some(wd) = repo.workdir() {
        let wd_real = crate::paths::real(wd).unwrap_or_else(|_| wd.to_path_buf());
        if let Some(prefix) = crate::paths::rel_path(&wd_real, ws.root()).filter(|p| !p.is_empty()) {
            return format!("{prefix}/{rel}");
        }
    }
    rel.to_string()
}

fn git_entries(ws: &Workspace, rel: &str) -> (bool, Vec<PageHistoryEntry>) {
    let Ok(repo) = gix::discover(ws.root()) else { return (false, Vec::new()) };
    if repo.workdir().is_none() {
        return (false, Vec::new());
    }
    let Ok(head) = repo.head_id() else { return (true, Vec::new()) };
    let repo_path = repo_rel_path(&repo, ws, rel);
    let Ok(walk) = repo.rev_walk([head]).sorting(gix::revision::walk::Sorting::ByCommitTime(Default::default())).all() else {
        return (true, Vec::new());
    };
    let mut out = Vec::new();
    for info in walk.take(MAX_GIT_WALK) {
        if out.len() >= MAX_GIT_COMMITS {
            break;
        }
        let Some(c) = info.ok().and_then(|i| i.object().ok()) else { continue };
        let Ok(tree) = c.tree() else { continue };
        let Some(blob_id) = tree.lookup_entry_by_path(&repo_path).ok().flatten().map(|e| e.object_id()) else { continue };
        let parent_blob = c
            .parent_ids()
            .next()
            .and_then(|p| p.object().ok()?.try_into_commit().ok()?.tree().ok())
            .and_then(|pt| pt.lookup_entry_by_path(&repo_path).ok().flatten().map(|e| e.object_id()));
        if Some(blob_id) == parent_blob {
            continue;
        }
        let Ok(obj) = repo.find_object(blob_id) else { continue };
        let text = String::from_utf8_lossy(&obj.data);
        let msg = c.message_raw().map(|m| m.to_string()).unwrap_or_default();
        let subject = msg.lines().next().unwrap_or("").trim();
        let label = if subject.is_empty() { "Commit".to_string() } else { subject.to_string() };
        let author = c.author().ok().map(|a| a.name.to_string()).filter(|a| !a.is_empty());
        let secs = c.time().map(|t| t.seconds).unwrap_or(0);
        out.push(PageHistoryEntry {
            id: c.id.to_string(),
            source: HistorySource::Git,
            time: Mtime((secs.max(0) as u64) * 1000),
            label,
            author,
            bytes: obj.data.len() as u64,
            lines: count_lines(&text),
        });
    }
    (true, out)
}

pub fn list(ws: &Workspace, rel: &str) -> Result<PageHistoryList> {
    let rel = normalize_rel(ws, rel)?;
    let bucket = bucket_dir(ws, &rel);
    let snaps: Vec<PageHistoryEntry> = {
        let lock = BUCKET_LOCKS.get(&bucket);
        let _held = lock.lock().unwrap_or_else(|e| e.into_inner());
        load_index(&bucket).entries.iter().rev().map(to_api_entry).collect()
    };
    let (git_repo, git) = git_entries(ws, &rel);
    let mut entries: Vec<PageHistoryEntry> = snaps.into_iter().chain(git).collect();
    entries.sort_by(|a, b| b.time.cmp(&a.time));
    Ok(PageHistoryList { path: rel, git_repo, entries })
}

fn read_historical_text(ws: &Workspace, rel: &str, source: HistorySource, id: &str) -> Result<String> {
    match source {
        HistorySource::Snapshot => {
            if !is_safe_snap_id(id) {
                return Err(Error::BadPath(format!("invalid snapshot id: {id}")));
            }
            let bytes = std::fs::read(bucket_dir(ws, rel).join(format!("{id}.snap")))
                .map_err(|_| Error::NotFound(format!("snapshot {id}")))?;
            String::from_utf8(bytes).map_err(|_| Error::NotText(rel.into()))
        }
        HistorySource::Git => {
            let fail = |e: &dyn std::fmt::Display| Error::BadRequest(format!("git history: {e}"));
            let repo = gix::discover(ws.root()).map_err(|e| fail(&e))?;
            let commit = repo
                .rev_parse_single(id)
                .map_err(|e| Error::NotFound(format!("commit {id}: {e}")))?
                .object()
                .map_err(|e| fail(&e))?
                .try_into_commit()
                .map_err(|e| fail(&e))?;
            let repo_path = repo_rel_path(&repo, ws, rel);
            let entry = commit
                .tree()
                .map_err(|e| fail(&e))?
                .lookup_entry_by_path(&repo_path)
                .map_err(|e| fail(&e))?
                .ok_or_else(|| Error::NotFound(format!("{rel} in commit {id}")))?;
            let obj = repo.find_object(entry.object_id()).map_err(|e| fail(&e))?;
            Ok(String::from_utf8_lossy(&obj.data).into_owned())
        }
    }
}

pub fn entry_detail(ws: &Workspace, rel: &str, source: HistorySource, id: &str) -> Result<PageHistoryDetail> {
    let rel = normalize_rel(ws, rel)?;
    let old_text = read_historical_text(ws, &rel, source, id)?;
    let current_text = match files::read_text(ws, &rel) {
        Ok(doc) => doc.text,
        Err(Error::NotFound(_)) => String::new(),
        Err(e) => return Err(e),
    };
    let diff = similar::TextDiff::from_lines(&old_text, &current_text);
    let added = diff.iter_all_changes().filter(|c| c.tag() == similar::ChangeTag::Insert).count() as u32;
    let removed = diff.iter_all_changes().filter(|c| c.tag() == similar::ChangeTag::Delete).count() as u32;
    let unified_diff = if old_text == current_text {
        String::new()
    } else {
        let body = diff.unified_diff().context_radius(3).header(&format!("a/{rel}"), &format!("b/{rel}")).to_string();
        format!("diff --git a/{rel} b/{rel}\n{body}")
    };
    Ok(PageHistoryDetail { path: rel, id: id.to_string(), source, old_text, current_text, unified_diff, added, removed })
}

pub fn restore(ws: &Workspace, rel: &str, source: HistorySource, id: &str) -> Result<PageHistoryRestored> {
    let rel = normalize_rel(ws, rel)?;
    let old_text = read_historical_text(ws, &rel, source, id)?;
    if let Ok(cur) = files::read_text(ws, &rel) {
        if cur.text != old_text {
            save_unthrottled(ws, &rel, &cur.text, "Before restore")?;
        }
    }
    let req = FileWrite { path: rel.clone(), text: old_text.clone(), base_mtime: None, only_new: false, apply_here: false };
    let written = files::write_text(ws, &req)?;
    save_unthrottled(ws, &rel, &old_text, "Restored")?;
    Ok(PageHistoryRestored { path: rel, text: old_text, mtime: written.mtime })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_baseline_coalescing_git_diff_restore_and_pruning() {
        let d = tempfile::tempdir().unwrap();
        let ws = Workspace::open(d.path()).unwrap();
        std::fs::create_dir_all(d.path().join("notes")).unwrap();
        std::fs::write(d.path().join("notes/plan.md"), "# Plan\nInitial line\n").unwrap();

        if std::process::Command::new("git").arg("--version").output().is_ok() {
            let git = |args: &[&str]| {
                std::process::Command::new("git")
                    .arg("-C")
                    .arg(d.path())
                    .args(["-c", "user.name=Tester", "-c", "user.email=t@example.org"])
                    .args(args)
                    .output()
                    .unwrap()
            };
            git(&["init", "-q", "-b", "main"]);
            git(&["add", "notes/plan.md"]);
            git(&["commit", "-q", "-m", "Add initial plan"]);
        }

        record_edit(&ws, "notes/plan.md", Some("# Plan\nInitial line\n"), "# Plan\nEdit 1\n").unwrap();
        std::fs::write(d.path().join("notes/plan.md"), "# Plan\nEdit 1\n").unwrap();
        let h1 = list(&ws, "notes/plan.md").unwrap();
        let snaps1: Vec<_> = h1.entries.iter().filter(|e| e.source == HistorySource::Snapshot).collect();
        assert_eq!(snaps1.len(), 2);
        assert_eq!((snaps1[0].label.as_str(), snaps1[1].label.as_str()), ("Auto-saved", "Before edit"));
        assert!(d.path().join(".kandinsky/history/.gitignore").exists());

        record_edit(&ws, "notes/plan.md", Some("# Plan\nEdit 1\n"), "# Plan\nEdit 2\nExtra\n").unwrap();
        std::fs::write(d.path().join("notes/plan.md"), "# Plan\nEdit 2\nExtra\n").unwrap();
        let h2 = list(&ws, "notes/plan.md").unwrap();
        let snaps2: Vec<_> = h2.entries.iter().filter(|e| e.source == HistorySource::Snapshot).collect();
        assert_eq!(snaps2.len(), 2, "rapid auto-saves coalesce");
        if h2.git_repo {
            assert!(h2.entries.iter().any(|e| e.source == HistorySource::Git && e.label == "Add initial plan"));
        }

        let manual = create_snapshot(&ws, "notes/plan.md", Some("Milestone 1")).unwrap();
        assert_eq!(manual.label, "Milestone 1");

        let baseline_id = snaps2[1].id.clone();
        let detail = entry_detail(&ws, "notes/plan.md", HistorySource::Snapshot, &baseline_id).unwrap();
        assert!(detail.unified_diff.starts_with("diff --git a/notes/plan.md b/notes/plan.md\n"));
        assert_eq!((detail.added, detail.removed), (2, 1));

        let restored = restore(&ws, "notes/plan.md", HistorySource::Snapshot, &baseline_id).unwrap();
        assert_eq!(restored.text, "# Plan\nInitial line\n");
        assert_eq!(files::read_text(&ws, "notes/plan.md").unwrap().text, "# Plan\nInitial line\n");

        assert!(entry_detail(&ws, "notes/plan.md", HistorySource::Snapshot, "../evil").is_err());
        record_edit(&ws, ".kandinsky/config.toml", None, "x = 1\n").unwrap();

        for i in 0..45 {
            std::fs::write(d.path().join("notes/plan.md"), format!("v{i}\n")).unwrap();
            create_snapshot(&ws, "notes/plan.md", Some(&format!("Snap {i}"))).unwrap();
        }
        let final_snaps = list(&ws, "notes/plan.md").unwrap().entries.into_iter().filter(|e| e.source == HistorySource::Snapshot).count();
        assert_eq!(final_snaps, MAX_SNAPSHOTS);
    }
}
