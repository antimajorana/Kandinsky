//! Persistent folded-ASCII trigram candidate index for vault text and cached PDF text.
//!
//! `.kandinsky/cache/search.idx` and `.kandinsky/cache/search-pdf.idx` store delta-encoded posting lists keyed by
//! relative path, byte length, and mtime. Queries intersect posting lists and verify candidates via `grep-searcher`.
use crate::config::Config;
use crate::{vault_write, walk};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime};
use walkdir::WalkDir;

const MAGIC: &[u8; 4] = b"KDTG";
const VERSION: u32 = 1;
const SEARCH_IDX: &str = ".kandinsky/cache/search.idx";
const PDF_IDX: &str = ".kandinsky/cache/search-pdf.idx";
const WARM_SLOTS: usize = 6;
const IDLE: Duration = Duration::from_secs(30 * 60);
/// Files modified within this window may share a filesystem mtime tick across rapid writes; always re-read them.
const RACY_WINDOW: Duration = Duration::from_millis(100);
const COMPACT_MIN_TOMBSTONES: usize = 256;

#[derive(Clone, Copy, PartialEq, Eq)]
enum IndexKind { Vault, Pdf }

pub(super) struct WalkedFile { pub abs: PathBuf, pub rel: String, pub len: u64, pub modified: Option<SystemTime> }

#[derive(Clone)]
struct DocEntry { rel: String, len: u64, mtime_secs: i64, mtime_nanos: u32, content_hash: u64, worth_reading: bool, alive: bool }

#[derive(Clone, Copy)]
struct TrigramMeta { trigram: u32, offset: u32, byte_len: u32, count: u32, last_doc: u32 }

#[derive(Default)]
struct TrigramIndex {
    docs: Vec<DocEntry>,
    by_rel: HashMap<String, u32>,
    table: Vec<TrigramMeta>,
    arena: Vec<u8>,
    overlay: HashMap<u32, Vec<u32>>,
    tombstones: usize,
    overlay_postings: usize,
}

struct VaultCache {
    canon_root: PathBuf,
    kind: IndexKind,
    used: Instant,
    agg_stamp: Option<(usize, u64)>,
    disk_stamp: Option<(u64, Option<SystemTime>)>,
    index: Arc<RwLock<TrigramIndex>>,
}

static MEM_CACHE: Mutex<Vec<VaultCache>> = Mutex::new(Vec::new());

/// Walk the workspace via `walk::keep` (keeping agent files so `o.agent` filters at query time) with size & mtime.
pub(super) fn walk_vault(root: &Path, cfg: &Config) -> Vec<WalkedFile> {
    let iter = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
        crate::paths::rel_path(root, e.path()).is_some_and(|r| walk::keep(cfg, &r) && !crate::state_dir::names_stale_twin(root, &r))
    });
    collect_walked(root, iter, |_| true)
}

fn collect_walked(root: &Path, iter: impl Iterator<Item = walkdir::Result<walkdir::DirEntry>>, keep_rel: impl Fn(&str) -> bool) -> Vec<WalkedFile> {
    iter.filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()).filter_map(|e| {
        let rel = crate::paths::rel_path(root, e.path()).filter(|r| keep_rel(r))?;
        let meta = e.metadata().ok().or_else(|| std::fs::metadata(e.path()).ok())?;
        Some(WalkedFile { abs: e.into_path(), rel, len: meta.len(), modified: meta.modified().ok() })
    }).collect()
}

/// Candidate `(abs, rel)` pairs for vault content search (`q`, `o`).
pub(super) fn vault_candidates(root: &Path, cfg: &Config, q: &str, o: super::Opts, walked: &[WalkedFile]) -> Vec<(PathBuf, String)> {
    let slot = ensure_index(root, IndexKind::Vault, &crate::state_dir::join(root, SEARCH_IDX), walked, true, |r| !cfg.is_ignored(r));
    let required = required_trigrams(q, o);
    slot.read().unwrap_or_else(|e| e.into_inner())
        .candidates(root, walked, &required, |rel| !cfg.is_ignored(rel) && (o.agent || !cfg.is_agent_file(rel)))
}

/// Candidate `(abs, rel)` pairs inside `.kandinsky/cache/pdftext` using `.kandinsky/cache/search-pdf.idx`.
pub(super) fn pdf_candidates(root: &Path, q: &str, o: super::Opts) -> Vec<(PathBuf, String)> {
    let cache_dir = crate::state_dir::join(root, crate::pdf_text::CACHE);
    if !cache_dir.is_dir() { return Vec::new(); }
    let walked = collect_walked(root, WalkDir::new(&cache_dir).follow_links(false).into_iter(), |r| r.ends_with(".txt"));
    if walked.is_empty() { return Vec::new(); }
    let slot = ensure_index(root, IndexKind::Pdf, &crate::state_dir::join(root, PDF_IDX), &walked, false, |_| true);
    let required = required_trigrams(q, o);
    slot.read().unwrap_or_else(|e| e.into_inner()).candidates(root, &walked, &required, |_| true)
}

fn ensure_index(root: &Path, kind: IndexKind, idx_path: &Path, walked: &[WalkedFile], sniff_non_md: bool, prune_when: impl Fn(&str) -> bool) -> Arc<RwLock<TrigramIndex>> {
    let canon_root = crate::paths::real(root).unwrap_or_else(|_| root.to_path_buf());
    let now_sys = SystemTime::now();
    let (stamp, has_racy) = aggregate_stamp(walked, now_sys);
    let disk_now = file_disk_stamp(idx_path);
    let existing = {
        let mut cache = MEM_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        cache.retain(|w| now.saturating_duration_since(w.used) < IDLE);
        cache.iter_mut().find(|w| w.canon_root == canon_root && w.kind == kind).map(|w| {
            w.used = now;
            (w.agg_stamp == Some(stamp) && !has_racy && disk_now.is_some() && w.disk_stamp == disk_now, w.index.clone())
        })
    };
    let slot = match existing {
        Some((true, hit)) => return hit,
        Some((false, s)) => s,
        None => Arc::new(RwLock::new(TrigramIndex::default())),
    };
    let mut persisted = false;
    let _ = vault_write::locked(idx_path, || {
        let disk_meta = file_disk_stamp(idx_path);
        let mut idx = slot.write().unwrap_or_else(|e| e.into_inner());
        if idx.docs.is_empty() && disk_meta.is_some() {
            if let Some(loaded) = std::fs::read(idx_path).ok().and_then(|b| TrigramIndex::deserialize(&b)) { *idx = loaded; }
        }
        let changed = idx.reconcile(walked, sniff_non_md, now_sys, &prune_when);
        if changed || disk_meta.is_none() {
            if (idx.tombstones >= COMPACT_MIN_TOMBSTONES && idx.tombstones * 5 > idx.docs.len()) || idx.overlay_postings >= 100_000 {
                idx.compact();
            }
            persisted = vault_write::cache::write(idx_path, &idx.serialize()).is_ok();
        } else {
            persisted = true;
        }
        Ok(())
    });
    let final_disk = persisted.then(|| file_disk_stamp(idx_path)).flatten();
    let mut cache = MEM_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    cache.retain(|w| !(w.canon_root == canon_root && w.kind == kind) && now.saturating_duration_since(w.used) < IDLE);
    cache.insert(0, VaultCache { canon_root, kind, used: now, agg_stamp: (!has_racy).then_some(stamp), disk_stamp: final_disk, index: slot.clone() });
    cache.truncate(WARM_SLOTS);
    slot
}

fn file_disk_stamp(path: &Path) -> Option<(u64, Option<SystemTime>)> {
    std::fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| (m.len(), m.modified().ok()))
}
fn aggregate_stamp(walked: &[WalkedFile], now: SystemTime) -> ((usize, u64), bool) {
    let (mut h, mut has_racy) = (0xcbf2_9ce4_8422_2325u64, false);
    for f in walked {
        has_racy |= is_racy(f.modified, now);
        let (secs, nanos) = system_time_parts(f.modified);
        h = fnv_mix(fnv_mix(fnv_mix(fnv_mix(h, f.rel.as_bytes()), &f.len.to_le_bytes()), &secs.to_le_bytes()), &nanos.to_le_bytes());
    }
    ((walked.len(), h), has_racy)
}
fn is_racy(modified: Option<SystemTime>, now: SystemTime) -> bool { modified.is_none_or(|m| now.duration_since(m).is_err_or(|age| age < RACY_WINDOW)) }
fn system_time_parts(t: Option<SystemTime>) -> (i64, u32) {
    match t.map(|t| t.duration_since(SystemTime::UNIX_EPOCH)) {
        Some(Ok(d)) => (d.as_secs() as i64, d.subsec_nanos()),
        Some(Err(e)) => { let d = e.duration(); (-(d.as_secs() as i64) - i64::from(d.subsec_nanos() > 0), (1_000_000_000 - d.subsec_nanos()) % 1_000_000_000) }
        None => (0, 0),
    }
}
#[inline]
fn fnv_mix(mut h: u64, bytes: &[u8]) -> u64 { for &b in bytes { h = (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3); } h }
struct ReadEntry { walked_idx: usize, old_doc_id: Option<u32>, len: u64, mtime_secs: i64, mtime_nanos: u32, content_hash: u64, worth_reading: bool, trigrams: Vec<u32> }
impl ReadEntry {
    fn skipped(walked_idx: usize, old_doc_id: Option<u32>, len: u64, mtime_secs: i64, mtime_nanos: u32) -> Self {
        Self { walked_idx, old_doc_id, len, mtime_secs, mtime_nanos, content_hash: 0, worth_reading: false, trigrams: Vec::new() }
    }
}

impl TrigramIndex {
    fn reconcile(&mut self, walked: &[WalkedFile], sniff_non_md: bool, now_sys: SystemTime, prune_when: &dyn Fn(&str) -> bool) -> bool {
        let (mut seen, mut to_read) = (vec![false; self.docs.len()], Vec::new());
        for (wi, f) in walked.iter().enumerate() {
            let ((secs, nanos), racy) = (system_time_parts(f.modified), is_racy(f.modified, now_sys));
            match self.by_rel.get(&f.rel).copied() {
                Some(id) => {
                    let d = &self.docs[id as usize];
                    seen[id as usize] = true;
                    if !d.alive || d.len != f.len || d.mtime_secs != secs || d.mtime_nanos != nanos || racy { to_read.push((wi, Some(id))); }
                }
                None => to_read.push((wi, None)),
            }
        }
        let mut changed = false;
        for (id, d) in self.docs.iter_mut().enumerate() {
            if d.alive && !seen[id] && prune_when(&d.rel) { d.alive = false; self.by_rel.remove(&d.rel); self.tombstones += 1; changed = true; }
        }
        if to_read.is_empty() { return changed; }
        for item in read_batch_parallel(walked, &to_read, sniff_non_md) {
            let f = &walked[item.walked_idx];
            if let Some(old_id) = item.old_doc_id {
                let old = &mut self.docs[old_id as usize];
                if old.alive && old.content_hash == item.content_hash && old.worth_reading == item.worth_reading && old.len == item.len {
                    if old.mtime_secs != item.mtime_secs || old.mtime_nanos != item.mtime_nanos {
                        (old.mtime_secs, old.mtime_nanos) = (item.mtime_secs, item.mtime_nanos);
                        changed = true;
                    }
                    continue;
                }
                if old.alive { old.alive = false; self.tombstones += 1; }
            }
            let new_id = self.docs.len() as u32;
            self.docs.push(DocEntry { rel: f.rel.clone(), len: item.len, mtime_secs: item.mtime_secs, mtime_nanos: item.mtime_nanos, content_hash: item.content_hash, worth_reading: item.worth_reading, alive: true });
            self.by_rel.insert(f.rel.clone(), new_id);
            for t in item.trigrams { self.overlay.entry(t).or_default().push(new_id); self.overlay_postings += 1; }
            changed = true;
        }
        changed
    }

    fn compact(&mut self) {
        let mut remap = vec![None; self.docs.len()];
        let mut new_docs = Vec::with_capacity(self.docs.len().saturating_sub(self.tombstones));
        let mut new_by_rel = HashMap::with_capacity(new_docs.capacity());
        for (old_id, doc) in self.docs.drain(..).enumerate() {
            if doc.alive {
                let new_id = new_docs.len() as u32;
                remap[old_id] = Some(new_id);
                new_by_rel.insert(doc.rel.clone(), new_id);
                new_docs.push(doc);
            }
        }
        let all = self.sorted_trigrams();
        let (mut new_table, mut new_arena) = (Vec::with_capacity(all.len()), Vec::with_capacity(self.arena.len()));
        for t in all {
            let offset = new_arena.len() as u32;
            let (mut count, mut prev, mut first) = (0u32, 0u32, true);
            for old_id in self.postings(t) {
                let Some(new_id) = remap.get(old_id as usize).copied().flatten() else { continue };
                write_varint(&mut new_arena, if first { first = false; new_id } else { new_id - prev });
                prev = new_id;
                count += 1;
            }
            if count > 0 { new_table.push(TrigramMeta { trigram: t, offset, byte_len: new_arena.len() as u32 - offset, count, last_doc: prev }); }
        }
        (self.docs, self.by_rel, self.table, self.arena) = (new_docs, new_by_rel, new_table, new_arena);
        self.overlay.clear();
        (self.tombstones, self.overlay_postings) = (0, 0);
    }

    fn sorted_trigrams(&self) -> Vec<u32> {
        let mut all = Vec::with_capacity(self.table.len() + self.overlay.len());
        all.extend(self.table.iter().map(|m| m.trigram));
        all.extend(self.overlay.keys().copied());
        all.sort_unstable();
        all.dedup();
        all
    }

    fn postings(&self, trigram: u32) -> impl Iterator<Item = u32> + '_ {
        let base = match self.table.binary_search_by_key(&trigram, |m| m.trigram) {
            Ok(i) => {
                let m = self.table[i];
                VarintIter { bytes: self.arena.get(m.offset as usize..m.offset as usize + m.byte_len as usize).unwrap_or(&[]), pos: 0, prev: 0, first: true, rem: m.count }
            }
            Err(_) => VarintIter { bytes: &[], pos: 0, prev: 0, first: true, rem: 0 },
        };
        base.chain(self.overlay.get(&trigram).map_or(&[][..], Vec::as_slice).iter().copied())
    }

    fn posting_count(&self, trigram: u32) -> usize {
        self.table.binary_search_by_key(&trigram, |m| m.trigram).map_or(0, |i| self.table[i].count as usize) + self.overlay.get(&trigram).map_or(0, Vec::len)
    }

    fn candidates(&self, root: &Path, walked: &[WalkedFile], required: &[u32], allow: impl Fn(&str) -> bool) -> Vec<(PathBuf, String)> {
        if required.is_empty() {
            return walked.iter()
                .filter(|f| f.len <= super::MAX_FILE && allow(&f.rel) && self.by_rel.get(&f.rel).is_none_or(|&id| self.docs[id as usize].worth_reading))
                .map(|f| (f.abs.clone(), f.rel.clone())).collect();
        }
        let mut ranked: Vec<(usize, u32)> = required.iter().map(|&t| (self.posting_count(t), t)).collect();
        if ranked.iter().any(|&(c, _)| c == 0) { return Vec::new(); }
        ranked.sort_unstable_by_key(|&(c, _)| c);
        let mut matched: Vec<u32> = self.postings(ranked[0].1).filter(|&id| {
            self.docs.get(id as usize).is_some_and(|d| d.alive && d.worth_reading && d.len <= super::MAX_FILE && allow(&d.rel))
        }).collect();
        for &(_, t) in &ranked[1..] {
            if matched.is_empty() { break; }
            let mut stream = self.postings(t).peekable();
            matched.retain(|&target| {
                while stream.peek().is_some_and(|&x| x < target) { stream.next(); }
                stream.peek() == Some(&target)
            });
        }
        matched.into_iter().map(|id| (root.join(&self.docs[id as usize].rel), self.docs[id as usize].rel.clone())).collect()
    }

    fn serialize(&self) -> Vec<u8> {
        let all = self.sorted_trigrams();
        let mut out = Vec::with_capacity(64 + self.docs.len() * 64 + all.len() * 16 + self.arena.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&(self.docs.len() as u32).to_le_bytes());
        for d in &self.docs {
            out.extend_from_slice(&(d.rel.len() as u32).to_le_bytes());
            out.extend_from_slice(d.rel.as_bytes());
            out.extend_from_slice(&d.len.to_le_bytes());
            out.extend_from_slice(&d.mtime_secs.to_le_bytes());
            out.extend_from_slice(&d.mtime_nanos.to_le_bytes());
            out.extend_from_slice(&d.content_hash.to_le_bytes());
            out.push(u8::from(d.worth_reading) | (u8::from(d.alive) << 1));
        }
        out.extend_from_slice(&(all.len() as u32).to_le_bytes());
        let table_start = out.len();
        out.resize(table_start + all.len() * 16, 0);
        for (idx, &t) in all.iter().enumerate() {
            let blob_start = out.len();
            let (mut count, mut prev, mut first) = (0u32, 0u32, true);
            if let Some(m) = self.table.binary_search_by_key(&t, |m| m.trigram).ok().map(|i| self.table[i]) {
                if let Some(slice) = self.arena.get(m.offset as usize..m.offset as usize + m.byte_len as usize) {
                    out.extend_from_slice(slice);
                    (count, prev, first) = (m.count, m.last_doc, m.count == 0);
                }
            }
            if let Some(extra) = self.overlay.get(&t) {
                for &id in extra { write_varint(&mut out, if first { first = false; id } else { id - prev }); prev = id; count += 1; }
            }
            let pos = table_start + idx * 16;
            for (k, v) in [t, count, (out.len() - blob_start) as u32, prev].into_iter().enumerate() {
                out[pos + k * 4..pos + k * 4 + 4].copy_from_slice(&v.to_le_bytes());
            }
        }
        out
    }

    fn deserialize(bytes: &[u8]) -> Option<Self> {
        let mut p = 0usize;
        if take::<4>(bytes, &mut p)? != *MAGIC || u32::from_le_bytes(take(bytes, &mut p)?) != VERSION { return None; }
        let doc_count = u32::from_le_bytes(take(bytes, &mut p)?) as usize;
        let (mut docs, mut by_rel, mut tombstones) = (Vec::with_capacity(doc_count.min(1 << 20)), HashMap::with_capacity(doc_count.min(1 << 20)), 0usize);
        for id in 0..doc_count {
            let rel_len = u32::from_le_bytes(take(bytes, &mut p)?) as usize;
            let rel = std::str::from_utf8(bytes.get(p..p.checked_add(rel_len)?)?).ok()?.to_string();
            p += rel_len;
            let len = u64::from_le_bytes(take(bytes, &mut p)?);
            let mtime_secs = i64::from_le_bytes(take(bytes, &mut p)?);
            let mtime_nanos = u32::from_le_bytes(take(bytes, &mut p)?);
            let content_hash = u64::from_le_bytes(take(bytes, &mut p)?);
            let flags = take::<1>(bytes, &mut p)?[0];
            let (worth_reading, alive) = ((flags & 1) != 0, (flags & 2) != 0);
            if alive { by_rel.insert(rel.clone(), id as u32); } else { tombstones += 1; }
            docs.push(DocEntry { rel, len, mtime_secs, mtime_nanos, content_hash, worth_reading, alive });
        }
        let tri_count = u32::from_le_bytes(take(bytes, &mut p)?) as usize;
        let blob_base = p.checked_add(tri_count.checked_mul(16)?)?;
        if blob_base > bytes.len() { return None; }
        let (mut table, mut cursor) = (Vec::with_capacity(tri_count), 0usize);
        for _ in 0..tri_count {
            let (trigram, count, byte_len, last_doc) = (u32::from_le_bytes(take(bytes, &mut p)?), u32::from_le_bytes(take(bytes, &mut p)?), u32::from_le_bytes(take(bytes, &mut p)?), u32::from_le_bytes(take(bytes, &mut p)?));
            if count > 0 && last_doc as usize >= doc_count { return None; }
            let offset = u32::try_from(cursor).ok()?;
            cursor = cursor.checked_add(byte_len as usize)?;
            table.push(TrigramMeta { trigram, offset, byte_len, count, last_doc });
        }
        let arena = bytes.get(blob_base..blob_base.checked_add(cursor)?)?;
        if blob_base + cursor != bytes.len() { return None; }
        Some(Self { docs, by_rel, table, arena: arena.to_vec(), overlay: HashMap::new(), tombstones, overlay_postings: 0 })
    }
}

fn read_batch_parallel(walked: &[WalkedFile], to_read: &[(usize, Option<u32>)], sniff_non_md: bool) -> Vec<ReadEntry> {
    use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
    let (next, results) = (AtomicUsize::new(0), Mutex::new(Vec::with_capacity(to_read.len())));
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(1, 8).min(to_read.len().max(1));
    let (next, results) = (&next, &results);
    std::thread::scope(|s| for _ in 0..workers {
        s.spawn(move || loop {
            let pos = next.fetch_add(1, Relaxed);
            let Some(&(wi, old_id)) = to_read.get(pos) else { break };
            results.lock().unwrap_or_else(|e| e.into_inner()).push((pos, read_one_file(wi, old_id, &walked[wi], sniff_non_md)));
        });
    });
    let mut out = results.into_inner().unwrap_or_else(|e| e.into_inner());
    out.sort_unstable_by_key(|(pos, _)| *pos);
    out.into_iter().map(|(_, e)| e).collect()
}

fn read_one_file(walked_idx: usize, old_doc_id: Option<u32>, f: &WalkedFile, sniff_non_md: bool) -> ReadEntry {
    let (mtime_secs, mtime_nanos) = system_time_parts(f.modified);
    if f.len > super::MAX_FILE { return ReadEntry::skipped(walked_idx, old_doc_id, f.len, mtime_secs, mtime_nanos); }
    let Ok(mut file) = std::fs::File::open(&f.abs) else { return ReadEntry::skipped(walked_idx, old_doc_id, f.len, mtime_secs, mtime_nanos); };
    let mut buf = Vec::new();
    if sniff_non_md && !f.rel.ends_with(".md") {
        let _ = file.by_ref().take(4096).read_to_end(&mut buf);
        if !super::worth_reading_head(&buf, &f.rel) { return ReadEntry::skipped(walked_idx, old_doc_id, f.len, mtime_secs, mtime_nanos); }
    }
    let _ = file.read_to_end(&mut buf);
    if buf.len() as u64 > super::MAX_FILE { return ReadEntry::skipped(walked_idx, old_doc_id, buf.len() as u64, mtime_secs, mtime_nanos); }
    ReadEntry { walked_idx, old_doc_id, len: buf.len() as u64, mtime_secs, mtime_nanos, content_hash: fnv_mix(0xcbf2_9ce4_8422_2325u64, &buf), worth_reading: true, trigrams: extract_unique_trigrams(&buf) }
}

fn extract_unique_trigrams(bytes: &[u8]) -> Vec<u32> {
    let mut out = Vec::with_capacity(bytes.len().min(4096));
    for_each_trigram(bytes, |t| { out.push(t); if out.len() >= 262_144 { out.sort_unstable(); out.dedup(); } });
    out.sort_unstable();
    out.dedup();
    out.shrink_to_fit();
    out
}

/// Extract folded pure-ASCII trigrams (ignoring NUL/CR/LF and normalizing U+017F -> 's', U+212A -> 'k').
fn for_each_trigram(bytes: &[u8], mut emit: impl FnMut(u32)) {
    let (mut w0, mut w1, mut run, mut i) = (0u8, 0u8, 0u8, 0usize);
    while i < bytes.len() {
        let b = bytes[i];
        let folded = if b < 0x80 {
            i += 1;
            if b == 0 || b == b'\n' || b == b'\r' { run = 0; continue; }
            Some(b.to_ascii_lowercase())
        } else if b == 0xC5 && bytes.get(i + 1) == Some(&0xBF) { i += 2; Some(b's') }
        else if b == 0xE2 && bytes.get(i + 1..i + 3) == Some(&[0x84, 0xAA]) { i += 3; Some(b'k') }
        else { i += 1; None };
        if let Some(c) = folded {
            if run >= 2 { emit(((w0 as u32) << 16) | ((w1 as u32) << 8) | (c as u32)); } else { run += 1; }
            (w0, w1) = (w1, c);
        } else { run = 0; }
    }
}

/// Required folded ASCII trigrams for `q` under `o` (empty = cannot pre-filter; search all `worth_reading` files).
fn required_trigrams(q: &str, o: super::Opts) -> Vec<u32> {
    if !o.regex { return extract_unique_trigrams(q.as_bytes()); }
    if q.contains('|') || q.contains('(') || q.contains(')') || q.contains(r"\Q") { return Vec::new(); }
    let (mut out, mut run) = (Vec::new(), Vec::new());
    let flush = |run: &mut Vec<u8>, out: &mut Vec<u32>| { if run.len() >= 3 { for_each_trigram(run, |t| out.push(t)); } run.clear(); };
    let mut chars = q.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                let Some(e) = chars.next() else { flush(&mut run, &mut out); break };
                if !e.is_ascii_alphanumeric() && e.is_ascii() {
                    if matches!(chars.peek(), Some('?' | '*' | '{')) { flush(&mut run, &mut out); } else { run.push(e as u8); }
                } else {
                    flush(&mut run, &mut out);
                    if matches!(e, 'p' | 'P') && chars.peek() == Some(&'{') { for ch in chars.by_ref() { if ch == '}' { break; } } }
                }
            }
            '[' => {
                flush(&mut run, &mut out);
                let (mut ci, mut neg) = (0usize, false);
                while let Some(ch) = chars.next() {
                    if ci == 0 && ch == '^' { neg = true; } else if ch == '\\' { let _ = chars.next(); } else if ch == ']' && ci > usize::from(neg) { break; }
                    ci += 1;
                }
            }
            '{' => { flush(&mut run, &mut out); for ch in chars.by_ref() { if ch == '}' { break; } } }
            '?' | '*' | '.' | '^' | '$' | '+' => flush(&mut run, &mut out),
            _ if matches!(chars.peek(), Some('?' | '*' | '{')) => flush(&mut run, &mut out),
            _ if c.is_ascii() => run.push(c as u8),
            _ => match c.encode_utf8(&mut [0u8; 4]).as_bytes() {
                [0xC5, 0xBF] => run.push(b's'),
                [0xE2, 0x84, 0xAA] => run.push(b'k'),
                _ => flush(&mut run, &mut out),
            },
        }
    }
    flush(&mut run, &mut out);
    out.sort_unstable();
    out.dedup();
    out
}

struct VarintIter<'a> { bytes: &'a [u8], pos: usize, prev: u32, first: bool, rem: u32 }
impl<'a> Iterator for VarintIter<'a> {
    type Item = u32;
    #[inline]
    fn next(&mut self) -> Option<u32> {
        if self.rem == 0 { return None; }
        self.rem -= 1;
        let delta = read_varint(self.bytes, &mut self.pos)?;
        let val = if self.first { self.first = false; delta } else { self.prev.checked_add(delta)? };
        self.prev = val;
        Some(val)
    }
}
#[inline]
fn write_varint(out: &mut Vec<u8>, mut v: u32) { while v >= 0x80 { out.push((v as u8) | 0x80); v >>= 7; } out.push(v as u8); }
#[inline]
fn read_varint(bytes: &[u8], pos: &mut usize) -> Option<u32> {
    let (mut out, mut shift) = (0u32, 0u32);
    loop {
        let b = take::<1>(bytes, pos)?[0];
        out |= u32::from(b & 0x7f).checked_shl(shift)?;
        if b < 0x80 { return Some(out); }
        shift += 7;
        if shift >= 35 { return None; }
    }
}
#[inline]
fn take<const N: usize>(bytes: &[u8], pos: &mut usize) -> Option<[u8; N]> {
    let s = bytes.get(*pos..pos.checked_add(N)?)?;
    *pos += N;
    s.try_into().ok()
}
