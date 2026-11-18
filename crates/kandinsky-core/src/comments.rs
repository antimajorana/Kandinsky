//! Anchored margin comment threads stored cleanly under `.kandinsky/comments/`, keeping Markdown clean.
use crate::{state_dir, vault_write, Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use ts_rs::TS;

const COMMENTS_DIR: &str = ".kandinsky/comments";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommentReply {
    pub id: String,
    pub author: String,
    pub created_at: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommentThread {
    pub id: String,
    pub path: String,
    pub from: u32,
    pub to: u32,
    pub quote: String,
    pub anchor_line: u32,
    pub resolved: bool,
    pub created_at: String,
    pub author: String,
    pub text: String,
    #[serde(default)]
    pub replies: Vec<CommentReply>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum CommentAction {
    Add {
        from: u32,
        to: u32,
        quote: String,
        anchor_line: u32,
        text: String,
        #[serde(default)]
        author: String,
    },
    Reply {
        thread_id: String,
        text: String,
        #[serde(default)]
        author: String,
    },
    Resolve {
        thread_id: String,
        resolved: bool,
    },
    Delete {
        thread_id: String,
    },
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct CommentMutation {
    pub path: String,
    pub action: CommentAction,
}

/// A note path as keys and comparisons read it: forward slashes, no slash at either end, the state folder spelled
/// `.kandinsky` (a note restored from `.atlas/trash/...` is the one trashed to `.kandinsky/trash/...`).
fn clean(rel: &str) -> String {
    let c = rel.trim().replace('\\', "/");
    state_dir::current_rel(c.trim_matches('/')).into_owned()
}

fn note_key(rel: &str) -> String {
    let mut h = Sha256::new();
    h.update(clean(rel).as_bytes());
    format!("{:x}.json", h.finalize())
}

fn file_for(root: &Path, rel: &str) -> PathBuf {
    state_dir::join(root, COMMENTS_DIR).join(note_key(rel))
}

fn now_iso() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn next_id(prefix: &str) -> String {
    static ID_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = ID_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{prefix}-{nanos:x}-{seq:x}")
}

fn read_file(path: &Path) -> Result<Vec<CommentThread>> {
    match std::fs::read_to_string(path) {
        Ok(txt) => serde_json::from_str(&txt).map_err(|e| Error::BadRequest(format!("comments: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn list(root: &Path, rel: &str) -> Result<Vec<CommentThread>> {
    read_file(&file_for(root, rel))
}

pub fn mutate(root: &Path, req: &CommentMutation) -> Result<Vec<CommentThread>> {
    let file = file_for(root, &req.path);
    if let Some(dir) = file.parent() {
        vault_write::mkdir(dir)?;
    }
    vault_write::locked(&file, || {
        let mut threads = read_file(&file)?;
        match &req.action {
            CommentAction::Add { from, to, quote, anchor_line, text, author } => {
                let text = text.trim();
                if text.is_empty() {
                    return Err(Error::BadRequest("comment text cannot be empty".into()));
                }
                threads.push(CommentThread {
                    id: next_id("cmt"),
                    path: req.path.clone(),
                    from: *from,
                    to: (*to).max(*from),
                    quote: quote.clone(),
                    anchor_line: (*anchor_line).max(1),
                    resolved: false,
                    created_at: now_iso(),
                    author: if author.trim().is_empty() { "You".into() } else { author.trim().to_string() },
                    text: text.to_string(),
                    replies: Vec::new(),
                });
            }
            CommentAction::Reply { thread_id, text, author } => {
                let body = text.trim();
                if body.is_empty() {
                    return Err(Error::BadRequest("reply text cannot be empty".into()));
                }
                let t = threads.iter_mut().find(|t| t.id == *thread_id).ok_or_else(|| Error::NotFound("comment thread not found".into()))?;
                t.replies.push(CommentReply {
                    id: next_id("rpl"),
                    author: if author.trim().is_empty() { "You".into() } else { author.trim().to_string() },
                    created_at: now_iso(),
                    text: body.to_string(),
                });
            }
            CommentAction::Resolve { thread_id, resolved } => {
                let t = threads.iter_mut().find(|t| t.id == *thread_id).ok_or_else(|| Error::NotFound("comment thread not found".into()))?;
                t.resolved = *resolved;
            }
            CommentAction::Delete { thread_id } => {
                let len_before = threads.len();
                threads.retain(|t| t.id != *thread_id);
                if threads.len() == len_before {
                    return Err(Error::NotFound("comment thread not found".into()));
                }
            }
        }
        if threads.is_empty() {
            if file.exists() {
                vault_write::remove_file(&file)?;
            }
        } else {
            let json = serde_json::to_string_pretty(&threads).map_err(|e| Error::Other(e.into()))?;
            vault_write::write(&file, json.as_bytes())?;
        }
        Ok(threads)
    })
}

pub fn moved(root: &Path, from: &str, to: &str) -> Result<()> {
    rekey(root, &file_for(root, from), to)
}

/// The folder `from` moved or renamed to `to`: each note under it keeps its threads. A sidecar whose note is not at
/// its new place after the move belongs to a note deleted earlier: it stays put rather than land on a live note.
pub fn moved_tree(root: &Path, from: &str, to: &str) -> Result<()> {
    let to = clean(to);
    // one sidecar that fails to move does not strand the others
    let mut first_err = None;
    for (file, rest) in under(root, from) {
        let dest = format!("{to}/{rest}");
        if !state_dir::join(root, &dest).is_file() {
            continue;
        }
        if let Err(e) = rekey(root, &file, &dest) {
            first_err.get_or_insert(e);
        }
    }
    first_err.map_or(Ok(()), Err)
}

/// The sidecars of the notes under folder `from`, each with its note's path below the folder. A folder has no sidecar
/// of its own, so they are found by the path their threads record; whole segments only (`Proj` never takes `Project`).
fn under(root: &Path, from: &str) -> Vec<(PathBuf, String)> {
    let prefix = format!("{}/", clean(from));
    let Ok(entries) = std::fs::read_dir(state_dir::join(root, COMMENTS_DIR)) else {
        return Vec::new();
    };
    let files = entries.flatten().map(|e| e.path()).filter(|f| f.extension().is_some_and(|x| x == "json"));
    files
        .filter_map(|file| {
            let rest = read_file(&file).ok()?.first().and_then(|t| clean(&t.path).strip_prefix(&prefix).map(str::to_string))?;
            Some((file, rest))
        })
        .collect()
}

/// The threads of the sidecar `old` now belong to the note `to` (merged with any it already has).
fn rekey(root: &Path, old: &Path, to: &str) -> Result<()> {
    let dest = file_for(root, to);
    if old == dest {
        return Ok(());
    }
    let to = clean(to);
    let mut threads = vault_write::locked(old, || {
        if !old.is_file() {
            return Ok(Vec::new());
        }
        let mut threads = read_file(old)?;
        for t in &mut threads {
            t.path = to.clone();
        }
        vault_write::remove_file(old)?;
        Ok(threads)
    })?;
    if threads.is_empty() {
        return Ok(());
    }
    if let Some(dir) = dest.parent() {
        vault_write::mkdir(dir)?;
    }
    vault_write::locked(&dest, || {
        let mut merged = read_file(&dest)?;
        merged.append(&mut threads);
        let json = serde_json::to_string_pretty(&merged).map_err(|e| Error::Other(e.into()))?;
        vault_write::write(&dest, json.as_bytes())
    })
}

pub fn removed(root: &Path, rel: &str) -> Result<()> {
    drop_sidecar(&file_for(root, rel))
}

/// The folder `rel` is gone for good: the threads of every note under it go too.
pub fn removed_tree(root: &Path, rel: &str) -> Result<()> {
    let mut first_err = None;
    for (file, _) in under(root, rel) {
        if let Err(e) = drop_sidecar(&file) {
            first_err.get_or_insert(e);
        }
    }
    first_err.map_or(Ok(()), Err)
}

fn drop_sidecar(old: &Path) -> Result<()> {
    vault_write::locked(old, || {
        if old.is_file() {
            vault_write::remove_file(old)?;
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threads_persist_and_follow_note_rename_then_remove() {
        let d = tempfile::tempdir().unwrap();
        let added = mutate(
            d.path(),
            &CommentMutation {
                path: "notes/A.md".into(),
                action: CommentAction::Add { from: 0, to: 10, quote: "Hello".into(), anchor_line: 1, text: "Check derivation".into(), author: "".into() },
            },
        )
        .unwrap();
        assert_eq!(added.len(), 1);
        moved(d.path(), "notes/A.md", "notes/B.md").unwrap();
        assert!(list(d.path(), "notes/A.md").unwrap().is_empty());
        let after = list(d.path(), "notes/B.md").unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].path, "notes/B.md");
        removed(d.path(), "notes/B.md").unwrap();
        assert!(list(d.path(), "notes/B.md").unwrap().is_empty());
    }

    #[test]
    fn threads_follow_a_folder_rename_and_only_its_notes() {
        let d = tempfile::tempdir().unwrap();
        let add = |path: &str| {
            let action = CommentAction::Add { from: 0, to: 1, quote: "q".into(), anchor_line: 1, text: "t".into(), author: "".into() };
            mutate(d.path(), &CommentMutation { path: path.into(), action }).unwrap();
        };
        for p in ["notes/Proj/A.md", "notes/Proj/sub/B.md", "notes/Proj/Gone.md", "notes/Project.md", "notes/ProjX/C.md"] {
            add(p);
        }
        // the folder as it is after the rename: Gone.md was deleted before it, its sidecar left behind
        for p in ["notes/Q/A.md", "notes/Q/sub/B.md", "notes/Project.md", "notes/ProjX/C.md"] {
            std::fs::create_dir_all(d.path().join(p).parent().unwrap()).unwrap();
            std::fs::write(d.path().join(p), "q").unwrap();
        }
        moved_tree(d.path(), "notes/Proj/", "notes/Q").unwrap();
        assert!(list(d.path(), "notes/Proj/A.md").unwrap().is_empty());
        assert_eq!(list(d.path(), "notes/Q/A.md").unwrap()[0].path, "notes/Q/A.md");
        assert_eq!(list(d.path(), "notes/Q/sub/B.md").unwrap().len(), 1);
        // a sibling whose name only starts the same is not inside the folder
        assert_eq!(list(d.path(), "notes/Project.md").unwrap().len(), 1);
        assert_eq!(list(d.path(), "notes/ProjX/C.md").unwrap().len(), 1);
        // an orphan sidecar does not land on the folder's new place
        assert!(list(d.path(), "notes/Q/Gone.md").unwrap().is_empty());
        assert_eq!(list(d.path(), "notes/Proj/Gone.md").unwrap().len(), 1);
    }

    #[test]
    fn a_folder_removed_for_good_takes_only_its_notes_threads() {
        let d = tempfile::tempdir().unwrap();
        for p in ["notes/Proj/A.md", "notes/Proj/sub/B.md", "notes/Project.md"] {
            let action = CommentAction::Add { from: 0, to: 1, quote: "q".into(), anchor_line: 1, text: "t".into(), author: "".into() };
            mutate(d.path(), &CommentMutation { path: p.into(), action }).unwrap();
        }
        removed_tree(d.path(), "notes/Proj").unwrap();
        assert!(list(d.path(), "notes/Proj/A.md").unwrap().is_empty());
        assert!(list(d.path(), "notes/Proj/sub/B.md").unwrap().is_empty());
        assert_eq!(list(d.path(), "notes/Project.md").unwrap().len(), 1);
    }

    #[test]
    fn concurrent_mutations_keep_all_threads_with_unique_ids() {
        let d = tempfile::tempdir().unwrap();
        let handles: Vec<_> = (0..12)
            .map(|i| {
                let root = d.path().to_path_buf();
                std::thread::spawn(move || {
                    mutate(
                        &root,
                        &CommentMutation {
                            path: "notes/Race.md".into(),
                            action: CommentAction::Add {
                                from: i,
                                to: i + 1,
                                quote: format!("q{i}"),
                                anchor_line: 1,
                                text: format!("comment {i}"),
                                author: "".into(),
                            },
                        },
                    )
                    .unwrap();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let all = list(d.path(), "notes/Race.md").unwrap();
        assert_eq!(all.len(), 12);
        let ids: std::collections::HashSet<_> = all.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids.len(), 12);
    }
}
