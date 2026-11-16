//! The catalog-papers plugin's engine: the references library moved out of the core
//! (docs/refactor/REFACTOR-references-plugin.md). Entries are notes (entry.rs), the library's operations (refs.rs),
//! shared external PDF pools (external.rs), recursive external root sync (scan_roots.rs), lossless Zotero
//! import (zotero_import.rs), watched inbox & Zoplicate deduplication (inbox_dedupe.rs), INSPIRE-HEP / preprint
//! upgrades / arXiv LaTeX sources (enrich.rs), what the indexes say (remote.rs), the catalog's tools (catalog.rs),
//! and the Zotero Connector (connector.rs).
pub mod catalog;
pub mod connector;
pub mod core_api;
pub mod enrich;
pub mod entry;
pub mod external;
pub mod firstpage;
pub mod inbox_dedupe;
pub mod net;
pub mod refs;
pub mod remote;
pub mod scan_roots;
pub mod settings;
pub mod zotero_import;
