# Search performance — persistent trigram candidate index

Full-text vault search (`crates/kandinsky-core/src/search.rs`, `search_trigram.rs`) uses a persistent folded-ASCII trigram candidate index so warm queries only run `grep-searcher` over candidate files rather than scanning every note and text file in the vault.

## Architecture

1. **Two persistent binary caches (`KDTG` v1)**:
   - `.kandinsky/cache/search.idx`: vault files walked via `walk::keep` (respecting dot-file rules and `cfg.ignore`, while retaining agent files in `editor.index_exclude` for query-time `o.agent` toggling).
   - `.kandinsky/cache/search-pdf.idx`: extracted PDF text files under `.kandinsky/cache/pdftext/`.
   - Both caches are disposable: deleting `.kandinsky/cache/` causes a transparent rebuild on the next query.
   - Writes are serialized per index path via `vault_write::locked` and persisted atomically with `vault_write::cache::write` (temporary file + `sync_all` + rename) so concurrent processes (`kandinsky` server and `kandinsky mcp`) never observe half-written files.

2. **Compact binary layout & in-process memory cache**:
   - Each indexed document records `(rel, len, mtime, fnv1a_content_hash, worth_reading, alive)`.
   - Folded pure-ASCII trigrams (`[u8; 3]` packed into `u32`, ASCII lowercased, breaking on NUL/CR/LF and normalizing Unicode simple ASCII folds `U+017F → s` and `U+212A → k`) are stored in a sorted trigram table pointing into a contiguous LEB128 delta-varint posting arena.
   - An in-process LRU memory cache (`MEM_CACHE`, keyed by canonical vault root, index kind, `(file_count, aggregate_stamp)`, and disk index stamp) serves repeated warm queries directly from memory with zero disk reads or deserialization.

3. **Incremental reconciliation & zero-stale freshness**:
   - On each query, walked files are compared by `(rel, len, mtime)` against cached entries: unchanged files incur zero file opens.
   - Files whose `mtime` falls within the 100 ms racy-timestamp window (`RACY_WINDOW`) are always re-read and verified by content hash, preventing stale hits even on rapid same-tick, same-byte-length overwrites.
   - Modified or deleted files tombstone their old document ID and append new postings to an in-memory overlay, which compacts automatically once tombstones or overlay postings cross their thresholds.

4. **Zero-false-negative verification & `search::replace` parity**:
   - The trigram index is strictly a candidate-file filter. Every surviving candidate runs through the exact `grep-searcher` + `grep-regex` (`smart_insensitive`, `word`, `BinaryDetection::quit(0)`) pipeline.
   - Queries whose required pure-ASCII literal run is shorter than 3 bytes (e.g. 1–2 character queries or non-ASCII queries) or complex regexes containing `|`, `(`, `)`, or `\Q` skip trigram intersection and scan only cached `worth_reading` files.
   - `search::replace` uses the exact same candidate filter and `grep-searcher` verification, preserving identical line numbers, byte offsets, smart-case rules, and replacement counts.

5. **Query-time config filtering & fast paths**:
   - `cfg.ignore`, `cfg.editor.index_exclude` (`cfg.is_agent_file`), and `o.agent` are enforced at query time against the candidate set so toggling agent search or changing excludes never invalidates the whole index.
   - `worth_reading` short-circuits `.md` files before opening them for 4 KB binary/numeric-table sniffing (`Searcher` still enforces `BinaryDetection::quit(0)` on NUL bytes).
   - `ui/src/components/Palette.svelte` passes `{ names: true }` to `api.search` in `Ctrl+P` (`files`) mode and for `< 3`-character non-tag queries, skipping content search completely when line hits are not rendered.

## Measured Benchmark Results (1k / 5k / 20k Notes)

Measured with `cargo run --release -p kandinsky-core --example index_probe` (`INDEX_PROBE_SEARCH_BENCH`):

| Vault Size | Cold Build (ms) | Warm Search p50 (ms) | Warm Search p95 (ms) | Names-Only p50 (ms) | PDF Search p50 (ms) | 1-File Edit Re-query (ms) | Peak Heap Delta (MB) |
|---|---|---|---|---|---|---|---|
| 1,000 notes | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| 5,000 notes | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| 20,000 notes | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
