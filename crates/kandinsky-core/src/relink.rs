//! Links follow a move. Before a file or folder
//! moves, [`plan`] notes which notes link into it (and which notes move); after, [`apply`] rewrites those links for the
//! new place — and a moved note's relative markdown links for its new folder. Obsidian's style is kept: a bare name
//! while it still finds the file, a path otherwise, `#anchor` and `|alias` untouched, `.md` written only if it was.
use crate::config::Config;
use crate::error::Result;
use crate::links::{self, Names};
use crate::vault_write;
use crate::workspace::Workspace;
use std::collections::HashMap;
use std::path::Path;

/// What a move will touch, taken before it.
pub struct Plan {
    /// the files before the move, resolved (shared with the link index)
    old: std::sync::Arc<Names>,
    /// old path → new path of every file that moves
    moved: HashMap<String, String>,
    /// notes (old paths) that may hold a link to rewrite
    sources: Vec<String>,
}

/// What [`apply`] changed: links rewritten, in which notes (their paths after the move).
#[derive(Debug, Default, PartialEq)]
pub struct Relinked {
    pub links: usize,
    pub notes: Vec<String>,
}

/// The move `from` → `to` (a file or a folder) as seen by the links, before it happens.
pub fn plan(root: &Path, cfg: &Config, from: &str, to: &str) -> Plan {
    let snap = links::snapshot(root, cfg);
    let (from, to) = (from.trim_matches('/'), to.trim_matches('/'));
    let moved: HashMap<String, String> = snap
        .files()
        .iter()
        .filter_map(|f| {
            let rest = f.strip_prefix(from).filter(|r| r.is_empty() || r.starts_with('/'))?;
            Some((f.clone(), format!("{to}{rest}")))
        })
        .collect();
    let sources = snap.parsed.keys().filter(|src| moved.contains_key(*src) || snap.targets(src).any(|t| moved.contains_key(&t))).cloned().collect();
    Plan { old: snap.names.clone(), moved, sources }
}

/// After the move: every planned note read again and its links rewritten (written only where one changed). The move
/// is done by then: a note that cannot be rewritten is passed over (and logged), not the end of the others.
pub fn apply(ws: &Workspace, plan: &Plan) -> Result<Relinked> {
    let new_files: Vec<String> = plan.old.files().iter().map(|f| plan.moved.get(f).unwrap_or(f).clone()).collect();
    let new = Names::new(new_files);
    let mut out = Relinked::default();
    for src_old in &plan.sources {
        let src_new = plan.moved.get(src_old).unwrap_or(src_old);
        let Ok(abs) = ws.resolve(src_new) else { continue };
        let mut n = 0;
        let done = vault_write::modify(&abs, |text| {
            let (next, changed) = rewrite(text, src_old, src_new, plan, &new);
            n = changed;
            Ok(next)
        });
        match done {
            Ok(()) if n > 0 => {
                out.links += n;
                out.notes.push(src_new.clone());
            }
            Ok(()) => {}
            Err(e) => eprintln!("kandinsky: the links of {src_new} were not rewritten after the move: {e}"),
        }
    }
    out.notes.sort();
    Ok(out)
}

/// One note's text with its links pointing at the moved files rewritten → (text, links changed).
fn rewrite(text: &str, src_old: &str, src_new: &str, plan: &Plan, new: &Names) -> (String, usize) {
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    links::link_lines(text, |_, offset, line, _| {
        for sp in links::link_spans(line) {
            let written = &line[sp.start..sp.end];
            let Some(was) = plan.old.resolve_target(written, sp.wiki, src_old) else { continue };
            let now = plan.moved.get(&was);
            // a link whose file stays put changes only when it is relative and its note moved
            if now.is_none() && (sp.wiki || src_old == src_new) {
                continue;
            }
            let target = now.unwrap_or(&was);
            let next = if sp.wiki { wiki_target(written, target, src_new, new) } else { markdown_target(written, target, src_new) };
            if next != written {
                edits.push((offset + sp.start, offset + sp.end, next));
            }
        }
    });
    let n = edits.len();
    let mut out = text.to_string();
    for (a, b, t) in edits.into_iter().rev() {
        out.replace_range(a..b, &t);
    }
    (out, n)
}

/// `(base, "#anchor")` of a written target.
fn split_anchor(written: &str) -> (&str, &str) {
    written.find('#').map_or((written, ""), |i| written.split_at(i))
}

/// A wikilink's target for `target`: the bare name when it still finds it from `src` (and the link had no folder), else
/// the path from the vault's top; `.md` only when the link wrote it.
fn wiki_target(written: &str, target: &str, src: &str, new: &Names) -> String {
    let (base, anchor) = split_anchor(written);
    let with_md = base.to_lowercase().ends_with(".md");
    let shown = |p: &str| if !with_md && p.to_lowercase().ends_with(".md") { p[..p.len() - 3].to_string() } else { p.to_string() };
    let name = shown(target.rsplit('/').next().unwrap_or(target));
    // a bare name only when it can mean nothing else: the one file of that name, or the one beside the note (Obsidian's
    // first choice) — a tie between folders is decided by nothing a reader sees
    let file = target.rsplit('/').next().unwrap_or(target);
    let unique = new.sharing(file) == 1 || links::dir_of(target) == links::dir_of(src);
    let by_name = !base.contains('/') && unique && new.resolve_target(&name, true, src).as_deref() == Some(target);
    format!("{}{anchor}", if by_name { name } else { shown(target) })
}

/// A markdown link's target for `target`: relative to `src`'s folder, spaces written as the link wrote them.
fn markdown_target(written: &str, target: &str, src: &str) -> String {
    let (base, anchor) = split_anchor(written);
    let rel = relative(links::dir_of(src), target);
    let rel = if base.contains(' ') { rel } else { rel.replace(' ', "%20") };
    format!("{rel}{anchor}")
}

/// `to` (from the vault's top) as seen from the folder `from_dir`: `a/b` → `a/c/x.md` = `c/x.md`, → `d.md` = `../../d.md`.
fn relative(from_dir: &str, to: &str) -> String {
    let from: Vec<&str> = from_dir.split('/').filter(|s| !s.is_empty()).collect();
    let to_parts: Vec<&str> = to.split('/').collect();
    let common = from.iter().zip(&to_parts).take_while(|(a, b)| a == b).count();
    let mut out: Vec<&str> = vec![".."; from.len() - common];
    out.extend(&to_parts[common..]);
    out.join("/")
}

/// Rewrites `[[from_key]]` (and `[[.../from_key]]`) wikilinks plus `\cite*{...from_key...}` citations across `.md` and
/// `.tex` files when two duplicate references are merged into `to_key`.
pub fn relink_citekey(ws: &Workspace, from_key: &str, to_key: &str) -> Result<Relinked> {
    let (from_key, to_key) = (from_key.trim(), to_key.trim());
    if from_key.is_empty() || to_key.is_empty() || from_key == to_key {
        return Ok(Relinked::default());
    }
    let cfg = ws.config()?;
    let cite_re = regex::Regex::new(r"\\(cite[a-zA-Z]*\*?|parencite\*?|textcite\*?|autocite\*?|footcite\*?)\{([^}]*)\}")
        .expect("valid cite regex");
    let mut out = Relinked::default();
    for (abs, rel) in crate::walk::files(ws.root(), &cfg) {
        if !(rel.ends_with(".md") || rel.ends_with(".tex")) || cfg.is_agent_file(&rel) {
            continue;
        }
        let mut count = 0usize;
        let done = vault_write::modify(&abs, |text| {
            let (t1, c1) = if rel.ends_with(".md") { rewrite_wiki_citekey(text, from_key, to_key) } else { (text.to_string(), 0) };
            let (t2, c2) = rewrite_tex_cite(&t1, &cite_re, from_key, to_key);
            count = c1 + c2;
            Ok(t2)
        });
        if done.is_ok() && count > 0 {
            out.links += count;
            out.notes.push(rel);
        }
    }
    out.notes.sort();
    Ok(out)
}

fn rewrite_wiki_citekey(text: &str, from_key: &str, to_key: &str) -> (String, usize) {
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    links::link_lines(text, |_, offset, line, _| {
        for sp in links::link_spans(line).into_iter().filter(|s| s.wiki) {
            let written = &line[sp.start..sp.end];
            let (base, anchor) = split_anchor(written);
            let bare = base.strip_suffix(".md").unwrap_or(base);
            let next_base = if bare == from_key {
                if base.ends_with(".md") { format!("{to_key}.md") } else { to_key.to_string() }
            } else if let Some(prefix) = bare.strip_suffix(&format!("/{from_key}/{from_key}")) {
                if base.ends_with(".md") { format!("{prefix}/{to_key}/{to_key}.md") } else { format!("{prefix}/{to_key}/{to_key}") }
            } else {
                continue;
            };
            let next = format!("{next_base}{anchor}");
            if next != written {
                edits.push((offset + sp.start, offset + sp.end, next));
            }
        }
    });
    let n = edits.len();
    let mut out = text.to_string();
    for (a, b, rep) in edits.into_iter().rev() {
        out.replace_range(a..b, &rep);
    }
    (out, n)
}

fn rewrite_tex_cite(text: &str, cite_re: &regex::Regex, from_key: &str, to_key: &str) -> (String, usize) {
    let mut count = 0usize;
    let out = cite_re.replace_all(text, |caps: &regex::Captures| {
        let cmd = &caps[1];
        let inner = &caps[2];
        let mut changed = false;
        let parts: Vec<String> = inner
            .split(',')
            .map(|part| {
                let trimmed = part.trim();
                if trimmed == from_key {
                    changed = true;
                    count += 1;
                    part.replacen(from_key, to_key, 1)
                } else {
                    part.to_string()
                }
            })
            .collect();
        if changed { format!("\\{cmd}{{{}}}", parts.join(",")) } else { caps[0].to_string() }
    });
    (out.into_owned(), count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(files: &[(&str, &str)]) -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        for (p, t) in files {
            let abs = dir.path().join(p);
            std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
            std::fs::write(abs, t).unwrap();
        }
        let ws = Workspace::open(dir.path()).unwrap();
        (dir, ws)
    }

    fn mv(ws: &Workspace, from: &str, to: &str) -> Relinked {
        let cfg = ws.config().unwrap();
        let plan = plan(ws.root(), &cfg, from, to);
        let (a, b) = (ws.resolve(from).unwrap(), ws.resolve(to).unwrap());
        std::fs::create_dir_all(b.parent().unwrap()).unwrap();
        std::fs::rename(a, b).unwrap();
        apply(ws, &plan).unwrap()
    }

    fn read(ws: &Workspace, p: &str) -> String {
        std::fs::read_to_string(ws.resolve(p).unwrap()).unwrap()
    }

    #[test]
    fn a_renamed_note_keeps_its_links_by_name_anchor_and_alias() {
        let (_d, ws) = vault(&[
            ("notes/Hubbard.md", "# Hubbard\n"),
            ("notes/a.md", "see [[Hubbard]], [[Hubbard#Phases|the phases]] and ![[Hubbard]]\n```\n[[Hubbard]] in code\n```\n`[[Hubbard]]`\n"),
            ("b.md", "---\nup: \"[[Hubbard]]\"\n---\n[md](notes/Hubbard.md#Phases)\n"),
        ]);
        let r = mv(&ws, "notes/Hubbard.md", "notes/Hubbard model.md");
        assert_eq!(read(&ws, "notes/a.md"), "see [[Hubbard model]], [[Hubbard model#Phases|the phases]] and ![[Hubbard model]]\n```\n[[Hubbard]] in code\n```\n`[[Hubbard]]`\n");
        assert_eq!(read(&ws, "b.md"), "---\nup: \"[[Hubbard model]]\"\n---\n[md](notes/Hubbard%20model.md#Phases)\n");
        assert_eq!(r, Relinked { links: 5, notes: vec!["b.md".into(), "notes/a.md".into()] });
    }

    #[test]
    fn a_moved_folder_takes_path_links_and_its_notes_relative_links_along() {
        let (_d, ws) = vault(&[
            ("old/x.excalidraw", "{}"),
            ("old/note.md", "[up](../top.md) and [[x.excalidraw]]\n"),
            ("top.md", "[[old/x.excalidraw]] and [[note]] and [n](old/note.md)\n"),
        ]);
        let r = mv(&ws, "old", "new/place");
        assert_eq!(read(&ws, "top.md"), "[[new/place/x.excalidraw]] and [[note]] and [n](new/place/note.md)\n");
        assert_eq!(read(&ws, "new/place/note.md"), "[up](../../top.md) and [[x.excalidraw]]\n");
        assert_eq!(r.links, 3);
    }

    #[test]
    fn a_name_that_becomes_ambiguous_gets_its_path() {
        let (_d, ws) = vault(&[("a/Plan.md", ""), ("b/Plan 2.md", ""), ("c.md", "[[Plan 2]]\n")]);
        mv(&ws, "b/Plan 2.md", "b/Plan.md");
        assert_eq!(read(&ws, "c.md"), "[[b/Plan]]\n");
    }

    #[test]
    fn unrelated_notes_are_not_written() {
        let (_d, ws) = vault(&[("x.md", ""), ("y.md", "[[z]]\n")]);
        let r = mv(&ws, "x.md", "w.md");
        assert_eq!(r, Relinked::default());
    }
}
