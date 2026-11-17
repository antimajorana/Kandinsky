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

fn note_key(rel: &str) -> String {
    let clean = rel.trim().trim_start_matches('/').replace('\\', "/");
    let mut h = Sha256::new();
    h.update(clean.as_bytes());
    format!("{:x}.json", h.finalize())
}

fn file_for(root: &Path, rel: &str) -> PathBuf {
    state_dir::join(root, COMMENTS_DIR).join(note_key(rel))
}

fn now_iso() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}

fn next_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos:x}")
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
}

pub fn moved(root: &Path, from: &str, to: &str) -> Result<()> {
    let old = file_for(root, from);
    if !old.is_file() {
        return Ok(());
    }
    let mut threads = read_file(&old)?;
    for t in &mut threads {
        t.path = to.to_string();
    }
    let dest = file_for(root, to);
    if let Some(dir) = dest.parent() {
        vault_write::mkdir(dir)?;
    }
    let json = serde_json::to_string_pretty(&threads).map_err(|e| Error::Other(e.into()))?;
    vault_write::write(&dest, json.as_bytes())?;
    vault_write::remove_file(&old)?;
    Ok(())
}

pub fn removed(root: &Path, rel: &str) -> Result<()> {
    let old = file_for(root, rel);
    if old.is_file() {
        vault_write::remove_file(&old)?;
    }
    Ok(())
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
}
