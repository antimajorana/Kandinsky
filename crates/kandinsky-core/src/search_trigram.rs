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
/// 3: a note's trigrams are those of its searchable text (search_text.rs), what the search matches.
const VERSION: u32 = 3;
const SEARCH_IDX: &str = ".kandinsky/cache/search.idx";
const PDF_IDX: &str = ".kandinsky/cache/search-pdf.idx";
const WARM_SLOTS: usize = 6;
const IDLE: Duration = Duration::from_secs(30 * 60);
/// Files modified within this window may share a filesystem mtime tick across rapid writes (up to 2 s on FAT/SMB); always re-read them.
const RACY_WINDOW: Duration = Duration::from_secs(2);
const RACY_SENTINEL: i64 = i64::MIN;
const COMPACT_MIN_TOMBSTONES: usize = 256;
const WALK_TRUST: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, PartialEq, Eq)]
enum IndexKind { Vault, Pdf }

pub(super) struct WalkedFile { pub abs: PathBuf, pub rel: String, pub len: u64, pub modified: Option<SystemTime> }

struct WarmWalk {
    root: PathBuf,
    used: Instant,
    walked_at: (crate::vault_changes::Stamp, Instant),
    files: Arc<Vec<WalkedFile>>,
}

#[derive(Clone)]
struct DocEntry { rel: String, len: u64, mtime_secs: i64, mtime_nanos: u32, content_hash: u64, is_text: bool, worth_reading: bool, alive: bool }

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
static WALK_CACHE: Mutex<Vec<WarmWalk>> = Mutex::new(Vec::new());

/// Walk the workspace via `walk::keep` (keeping agent files so `o.agent` filters at query time) with size & mtime.
/// When a complete watcher covers `root` (`vault_changes::stamp`), an unchanged generation reuses the previous walk.
pub(super) fn walk_vault(root: &Path, cfg: &Config) -> Arc<Vec<WalkedFile>> {
    static WALKING: crate::key_lock::KeyLocks = crate::key_lock::KeyLocks::new();
    let lk = WALKING.get(root);
    let _one = lk.lock().unwrap_or_else(|e| e.into_inner());
    let stamp = crate::vault_changes::stamp(root, cfg);
    let now = Instant::now();
    if let Some(s) = stamp {
        let mut warm = WALK_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(i) = warm.iter().position(|w| w.root == root && w.walked_at.0 == s && now.saturating_duration_since(w.walked_at.1) < WALK_TRUST) {
            let mut hit = warm.remove(i);
            hit.used = now;
            let out = hit.files.clone();
            warm.retain(|w| now.saturating_duration_since(w.used) < IDLE);
            warm.insert(0, hit);
            return out;
        }
    }
    let iter = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
        crate::paths::rel_path(root, e.path()).is_some_and(|r| walk::keep(cfg, &r) && !crate::state_dir::names_stale_twin(root, &r))
    });
    let files = Arc::new(collect_walked(root, iter, |_| true));
    let now_sys = SystemTime::now();
    if let Some(s) = stamp.filter(|_| !files.iter().any(|f| is_racy(f.modified, now_sys))) {
        let mut warm = WALK_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        warm.retain(|w| w.root != root && now.saturating_duration_since(w.used) < IDLE);
        warm.insert(0, WarmWalk { root: root.to_path_buf(), used: now, walked_at: (s, now), files: files.clone() });
        warm.truncate(WARM_SLOTS);
    }
    files
}

fn collect_walked(root: &Path, iter: impl Iterator<Item = walkdir::Result<walkdir::DirEntry>>, keep_rel: impl Fn(&str) -> bool) -> Vec<WalkedFile> {
    iter.filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()).filter_map(|e| {
        let rel = crate::paths::rel_path(root, e.path()).filter(|r| keep_rel(r))?;
        let meta = e.metadata().ok().or_else(|| std::fs::metadata(e.path()).ok())?;
        Some(WalkedFile { abs: e.into_path(), rel, len: meta.len(), modified: meta.modified().ok() })
    }).collect()
}

/// Candidate `(abs, rel)` pairs for vault content search (`q`, `o`).
pub(super) fn vault_candidates(root: &Path, cfg: &Config, q: &str, o: super::Opts, walked: &[WalkedFile], require_worth: bool) -> Vec<(PathBuf, String)> {
    let required = required_trigrams(q, o);
    query_index(
        root,
        IndexKind::Vault,
        &crate::state_dir::join(root, SEARCH_IDX),
        walked,
        true,
        require_worth,
        &required,
        |r| !cfg.is_ignored(r),
        |rel| !cfg.is_ignored(rel) && (o.agent || !cfg.is_agent_file(rel)),
    )
}

/// Candidate `(abs, rel)` pairs inside `.kandinsky/cache/pdftext` using `.kandinsky/cache/search-pdf.idx`.
pub(super) fn pdf_candidates(root: &Path, q: &str, o: super::Opts) -> Vec<(PathBuf, String)> {
    let cache_dir = crate::state_dir::join(root, crate::pdf_text::CACHE);
    if !cache_dir.is_dir() { return Vec::new(); }
    let walked = collect_walked(root, WalkDir::new(&cache_dir).follow_links(false).into_iter(), |r| r.ends_with(".txt"));
    if walked.is_empty() { return Vec::new(); }
    let required = required_trigrams(q, o);
    query_index(root, IndexKind::Pdf, &crate::state_dir::join(root, PDF_IDX), &walked, false, true, &required, |_| true, |_| true)
}

#[allow(clippy::too_many_arguments)]
fn query_index(
    root: &Path,
    kind: IndexKind,
    idx_path: &Path,
    walked: &[WalkedFile],
    sniff_non_md: bool,
    require_worth: bool,
    required: &[u32],
    prune_when: impl Fn(&str) -> bool,
    allow: impl Fn(&str) -> bool,
) -> Vec<(PathBuf, String)> {
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
        Some((true, hit)) => {
            let idx = hit.read().unwrap_or_else(|e| e.into_inner());
            return idx.candidates(root, walked, required, require_worth, allow);
        }
        Some((false, s)) => s,
        None => Arc::new(RwLock::new(TrigramIndex::default())),
    };
    let mut persisted = false;
    let mut out = Vec::new();
    let _ = vault_write::cache::locked(idx_path, || {
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
        out = idx.candidates(root, walked, required, require_worth, &allow);
        Ok(())
    });
    let final_disk = persisted.then(|| file_disk_stamp(idx_path)).flatten();
    let mut cache = MEM_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    cache.retain(|w| (w.canon_root != canon_root || w.kind != kind) && now.saturating_duration_since(w.used) < IDLE);
    cache.insert(0, VaultCache { canon_root, kind, used: now, agg_stamp: (!has_racy).then_some(stamp), disk_stamp: final_disk, index: slot });
    cache.truncate(WARM_SLOTS);
    out
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
fn is_racy(modified: Option<SystemTime>, now: SystemTime) -> bool {
    modified.is_none_or(|m| !now.duration_since(m).is_ok_and(|age| age >= RACY_WINDOW))
}
fn system_time_parts(t: Option<SystemTime>) -> (i64, u32) {
    match t.map(|t| t.duration_since(SystemTime::UNIX_EPOCH)) {
        Some(Ok(d)) => (d.as_secs() as i64, d.subsec_nanos()),
        Some(Err(e)) => { let d = e.duration(); (-(d.as_secs() as i64) - i64::from(d.subsec_nanos() > 0), (1_000_000_000 - d.subsec_nanos()) % 1_000_000_000) }
        None => (0, 0),
    }
}
#[inline]
fn fnv_mix(mut h: u64, bytes: &[u8]) -> u64 { for &b in bytes { h = (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3); } h }
struct ReadEntry { walked_idx: usize, old_doc_id: Option<u32>, len: u64, mtime_secs: i64, mtime_nanos: u32, content_hash: u64, is_text: bool, worth_reading: bool, trigrams: Vec<u32> }
impl ReadEntry {
    fn binary_or_huge(walked_idx: usize, old_doc_id: Option<u32>, len: u64, mtime_secs: i64, mtime_nanos: u32) -> Self {
        Self { walked_idx, old_doc_id, len, mtime_secs, mtime_nanos, content_hash: 0, is_text: false, worth_reading: false, trigrams: Vec::new() }
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
        let (entries, failed_existing) = read_batch_parallel(walked, &to_read, sniff_non_md, now_sys);
        for (wi, old_id) in failed_existing {
            if let Some(old) = self.docs.get_mut(old_id as usize).filter(|d| d.alive) {
                old.alive = false;
                self.tombstones += 1;
                changed = true;
            }
            self.by_rel.remove(&walked[wi].rel);
        }
        for item in entries {
            let f = &walked[item.walked_idx];
            if let Some(old_id) = item.old_doc_id {
                let old = &mut self.docs[old_id as usize];
                if old.alive && old.content_hash == item.content_hash && old.is_text == item.is_text && old.worth_reading == item.worth_reading && old.len == item.len {
                    if old.mtime_secs != item.mtime_secs || old.mtime_nanos != item.mtime_nanos {
                        (old.mtime_secs, old.mtime_nanos) = (item.mtime_secs, item.mtime_nanos);
                        changed = true;
                    }
                    continue;
                }
                if old.alive { old.alive = false; self.tombstones += 1; }
            }
            let new_id = self.docs.len() as u32;
            self.docs.push(DocEntry { rel: f.rel.clone(), len: item.len, mtime_secs: item.mtime_secs, mtime_nanos: item.mtime_nanos, content_hash: item.content_hash, is_text: item.is_text, worth_reading: item.worth_reading, alive: true });
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

    fn candidates(&self, root: &Path, walked: &[WalkedFile], required: &[u32], require_worth: bool, allow: impl Fn(&str) -> bool) -> Vec<(PathBuf, String)> {
        let doc_ok = |d: &DocEntry| d.alive && d.is_text && (!require_worth || d.worth_reading) && d.len <= super::MAX_FILE && allow(&d.rel);
        if required.is_empty() {
            return walked.iter()
                .filter(|f| f.len <= super::MAX_FILE && allow(&f.rel) && self.by_rel.get(&f.rel).is_none_or(|&id| doc_ok(&self.docs[id as usize])))
                .map(|f| (f.abs.clone(), f.rel.clone())).collect();
        }
        let mut out: Vec<(PathBuf, String)> = walked.iter()
            .filter(|f| f.len <= super::MAX_FILE && !self.by_rel.contains_key(&f.rel) && allow(&f.rel))
            .map(|f| (f.abs.clone(), f.rel.clone()))
            .collect();
        let mut ranked: Vec<(usize, u32)> = required.iter().map(|&t| (self.posting_count(t), t)).collect();
        if ranked.iter().all(|&(c, _)| c > 0) {
            ranked.sort_unstable_by_key(|&(c, _)| c);
            let mut matched: Vec<u32> = self.postings(ranked[0].1).filter(|&id| {
                self.docs.get(id as usize).is_some_and(doc_ok)
            }).collect();
            for &(_, t) in &ranked[1..] {
                if matched.is_empty() { break; }
                let mut stream = self.postings(t).peekable();
                matched.retain(|&target| {
                    while stream.peek().is_some_and(|&x| x < target) { stream.next(); }
                    stream.peek() == Some(&target)
                });
            }
            out.extend(matched.into_iter().map(|id| (root.join(&self.docs[id as usize].rel), self.docs[id as usize].rel.clone())));
        }
        out
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
            out.push(u8::from(d.worth_reading) | (u8::from(d.alive) << 1) | (u8::from(d.is_text) << 2));
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
            let (worth_reading, alive, is_text) = ((flags & 1) != 0, (flags & 2) != 0, (flags & 4) != 0);
            if alive { by_rel.insert(rel.clone(), id as u32); } else { tombstones += 1; }
            docs.push(DocEntry { rel, len, mtime_secs, mtime_nanos, content_hash, is_text, worth_reading, alive });
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

fn read_batch_parallel(walked: &[WalkedFile], to_read: &[(usize, Option<u32>)], sniff_non_md: bool, now_sys: SystemTime) -> (Vec<ReadEntry>, Vec<(usize, u32)>) {
    use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
    let next = AtomicUsize::new(0);
    let results = Mutex::new(Vec::with_capacity(to_read.len()));
    let failed = Mutex::new(Vec::new());
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get()).clamp(1, 8).min(to_read.len().max(1));
    let (next_ref, results_ref, failed_ref) = (&next, &results, &failed);
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(move || loop {
                let pos = next_ref.fetch_add(1, Relaxed);
                let Some(&(wi, old_id)) = to_read.get(pos) else { break };
                match read_one_file(wi, old_id, &walked[wi], sniff_non_md, now_sys) {
                    Some(entry) => results_ref.lock().unwrap_or_else(|e| e.into_inner()).push((pos, entry)),
                    None => if let Some(id) = old_id { failed_ref.lock().unwrap_or_else(|e| e.into_inner()).push((wi, id)); },
                }
            });
        }
    });
    let mut out = std::mem::take(&mut *results.lock().unwrap_or_else(|e| e.into_inner()));
    out.sort_unstable_by_key(|(pos, _)| *pos);
    let failed_out = std::mem::take(&mut *failed.lock().unwrap_or_else(|e| e.into_inner()));
    (out.into_iter().map(|(_, e)| e).collect(), failed_out)
}

fn read_one_file(walked_idx: usize, old_doc_id: Option<u32>, f: &WalkedFile, sniff_non_md: bool, now_sys: SystemTime) -> Option<ReadEntry> {
    let (raw_secs, mtime_nanos) = system_time_parts(f.modified);
    let mtime_secs = if is_racy(f.modified, now_sys) { RACY_SENTINEL } else { raw_secs };
    if f.len > super::MAX_FILE { return Some(ReadEntry::binary_or_huge(walked_idx, old_doc_id, f.len, mtime_secs, mtime_nanos)); }
    let mut file = std::fs::File::open(&f.abs)
        .or_else(|_| { std::thread::sleep(Duration::from_millis(5)); std::fs::File::open(&f.abs) })
        .ok()?;
    let mut buf = Vec::with_capacity((f.len as usize).min(4096));
    file.by_ref().take(4096).read_to_end(&mut buf).ok()?;
    if buf.contains(&0) { return Some(ReadEntry::binary_or_huge(walked_idx, old_doc_id, f.len, mtime_secs, mtime_nanos)); }
    let worth_reading = !sniff_non_md || f.rel.ends_with(".md") || super::worth_reading_head(&buf, &f.rel);
    file.read_to_end(&mut buf).ok()?;
    if buf.len() as u64 > super::MAX_FILE || buf.contains(&0) {
        return Some(ReadEntry::binary_or_huge(walked_idx, old_doc_id, buf.len() as u64, mtime_secs, mtime_nanos));
    }
    Some(ReadEntry {
        walked_idx,
        old_doc_id,
        len: buf.len() as u64,
        mtime_secs,
        mtime_nanos,
        content_hash: fnv_mix(0xcbf2_9ce4_8422_2325u64, &buf),
        is_text: true,
        worth_reading,
        trigrams: indexed_trigrams(&f.rel, &buf),
    })
}

/// A note is matched as its searchable text (its HTML blanked, entities decoded: search_text.rs), so that is what is
/// indexed; any other file as it is.
fn indexed_trigrams(rel: &str, buf: &[u8]) -> Vec<u32> {
    let note = rel.rsplit_once('.').is_some_and(|(_, e)| e.eq_ignore_ascii_case("md"));
    match std::str::from_utf8(buf) {
        Ok(text) if note => extract_unique_trigrams(crate::search_text::searchable(text).as_bytes()),
        _ => extract_unique_trigrams(buf),
    }
}

fn extract_unique_trigrams(bytes: &[u8]) -> Vec<u32> {
    if bytes.len() <= 65_536 {
        let mut out = Vec::with_capacity(bytes.len().min(4096));
        for_each_trigram(bytes, |t| out.push(t));
        out.sort_unstable();
        out.dedup();
        out.shrink_to_fit();
        return out;
    }
    let mut bits = vec![0u64; 1 << 18]; // 2^24 bits = 2 MB bitset for large files
    for_each_trigram(bytes, |t| bits[(t >> 6) as usize] |= 1u64 << (t & 63));
    let mut out = Vec::new();
    for (wi, &word) in bits.iter().enumerate() {
        let mut w = word;
        while w != 0 {
            let bit = w.trailing_zeros();
            out.push(((wi as u32) << 6) | bit);
            w &= w - 1;
        }
    }
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
        else if b == 0xE2 && bytes.get(i + 1..i + 3) == Some(&[0x84, 0xAA][..]) { i += 3; Some(b'k') }
        else { i += 1; None };
        if let Some(c) = folded {
            if run >= 2 { emit(((w0 as u32) << 16) | ((w1 as u32) << 8) | (c as u32)); } else { run += 1; }
            (w0, w1) = (w1, c);
        } else { run = 0; }
    }
}

/// Required folded ASCII trigrams for `q` under `o` (empty = cannot pre-filter; search all `worth_reading` text files).
fn required_trigrams(q: &str, o: super::Opts) -> Vec<u32> {
    if o.regex {
        return Vec::new();
    }
    extract_unique_trigrams(q.as_bytes())
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
