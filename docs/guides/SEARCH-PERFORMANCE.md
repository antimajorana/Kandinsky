# Search performance — persistent trigram candidate index

Full-text vault search (`crates/kandinsky-core/src/search.rs`, `search_trigram.rs`) uses a persistent folded-ASCII trigram candidate index so warm queries only run `grep-searcher` over candidate files rather than scanning every note and text file in the vault.

## Architecture

1. **Two persistent binary caches (`KDTG` v2)**:
   - `.kandinsky/cache/search.idx`: vault files walked via `walk::keep` (respecting dot-file rules and `cfg.ignore`, while retaining agent files in `editor.index_exclude` for query-time `o.agent` toggling).
   - `.kandinsky/cache/search-pdf.idx`: extracted PDF text files under `.kandinsky/cache/pdftext/`.
   - Both caches are disposable: deleting `.kandinsky/cache/` causes a transparent rebuild on the next query.
   - Writes are serialized per index path via `vault_write::locked` and persisted atomically with `vault_write::cache::write` (temporary file + `sync_all` + rename) so concurrent processes (`kandinsky` server and `kandinsky mcp`) never observe half-written files.

2. **Compact binary layout & in-process memory cache**:
   - Each indexed document records `(rel, len, mtime, fnv1a_content_hash, is_text, worth_reading, alive)`.
   - Folded pure-ASCII trigrams (`[u8; 3]` packed into `u32`, ASCII lowercased, breaking on NUL/CR/LF and normalizing Unicode simple ASCII folds `U+017F → s` and `U+212A → k`) are stored in a sorted trigram table pointing into a contiguous LEB128 delta-varint posting arena (using a 2 MB `2^24`-bit set for files over 64 KB so indexing stays linear).
   - An in-process LRU memory cache (`MEM_CACHE`, keyed by canonical vault root, index kind, `(file_count, aggregate_stamp)`, and disk index stamp) serves repeated warm queries directly from memory with zero disk reads or deserialization. When a complete filesystem watcher covers the vault (`vault_changes::stamp`, as in the live Kandinsky server), `WALK_CACHE` also reuses the walked file list without re-walking unchanged directory trees (matching `links.rs`), while immediately invalidating on any `vault_write` touch or watcher event.

3. **Incremental reconciliation & racy-mtime freshness**:
   - On each query, walked files are compared by `(rel, len, mtime)` against cached entries: unchanged files incur zero file opens, while transiently locked files are retried on subsequent queries rather than cached as unreadable.
   - Files whose `mtime` falls within the 2-second racy-timestamp window (`RACY_WINDOW`, covering NTFS, FAT/exFAT, and SMB shares) store a sentinel timestamp (`RACY_SENTINEL`) so subsequent queries verify their content hash until the timestamp ages past the window, preventing stale hits on same-tick overwrites.
   - Modified or deleted files tombstone their old document ID and append new postings to an in-memory overlay, which compacts automatically once tombstones or overlay postings cross their thresholds.

4. **Zero-false-negative verification & `search::replace` parity**:
   - The trigram index is strictly a candidate-file filter. Every surviving candidate runs through the exact `grep-searcher` + `grep-regex` (`smart_insensitive`, `word`, `BinaryDetection::quit(0)`) pipeline.
   - Queries whose required pure-ASCII literal run is shorter than 3 bytes (e.g. 1–2 character queries or non-ASCII queries) or regex queries (`o.regex == true`) skip trigram intersection and scan cached text files with zero false negatives.
   - `search::replace` queries all `is_text` candidates (`!NUL`, `<= MAX_FILE`) with trigram filtering and `grep-searcher` verification, preserving exact parity with non-indexed replace across notes, code, SVG, and data files.

5. **Query-time config filtering & fast paths**:
   - `cfg.ignore`, `cfg.editor.index_exclude` (`cfg.is_agent_file`), and `o.agent` are enforced at query time against the candidate set so toggling agent search or changing excludes never invalidates the whole index.
   - `worth_reading` short-circuits `.md` files before opening them for 4 KB binary/numeric-table sniffing (`Searcher` still enforces `BinaryDetection::quit(0)` on NUL bytes).
   - `ui/src/components/Palette.svelte` passes `{ names: true }` to `api.search` in `Ctrl+P` (`files`) mode and for `< 3`-character non-tag queries, skipping content search completely when line hits are not rendered.

## Measured Benchmark Results (1k / 5k / 20k Notes)

Measured back-to-back in release mode (`cargo run --release -p kandinsky-core --example index_probe`) across five queries (`hubbard`, `hubbardish`, `renormalisation`, `quantum`, `condensed matter`), reporting both unwatched CLI runs and watched live-server runs (`events::spawn_watcher` + `vault_changes`), cached PDF text, filename-only mode, and immediate 1-file edit freshness:

| Vault Size | Warm Search p50 ms (Before → Unwatched / Watched) | Warm Search p95 ms (Before → Unwatched / Watched) | First Cold Query ms (Before / Index Build) | Names-Only p50 ms (Before → Unwatched / Watched) | PDF Search p50 ms (Before → After) | 1-File Edit Re-query (ms) | End RSS / Peak Query Heap (MB) |
|---|---|---|---|---|---|---|---|
| 1,000 notes | 159.39 → **106.20** (1.5×) / **6.38** (25.0×) | 178.16 → **172.76** / **7.80** | 226.0 / 224.1 | 69.96 → 68.20 / **0.30** | 18.98 → **16.91** | 88.56 | 13.6 / +3.11 |
| 5,000 notes | 928.38 → **337.26** (2.8×) / **10.09** (92.0×) | 1345.46 → **380.84** / **11.19** | 2077.8 / 858.7 | 317.52 → 310.72 / **1.47** | 57.20 → **48.86** | 339.09 | 27.4 / +17.19 |
| 20,000 notes | 3376.53 → **1322.81** (2.6×) / **28.60** (118.1×) | 27764.92 → **1846.79** / **35.88** | 27286.4 / 3069.9 | 1228.69 → 1262.34 / **6.24** | 192.54 → **178.20** | 1368.84 | 71.5 / +67.11 |
