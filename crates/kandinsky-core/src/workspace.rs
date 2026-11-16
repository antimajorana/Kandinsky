//! A workspace is any folder; `.kandinsky/` inside it is optional.
use crate::api::WorkspaceInfo;
use crate::config::Config;
use crate::{paths, Error, Result};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Workspace {
    /// Canonical, so `paths::safe_join`'s prefix check is meaningful.
    root: PathBuf,
}

impl Workspace {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref();
        let root = crate::paths::real(root).map_err(|e| Error::BadPath(format!("{}: {e}", root.display())))?;
        if !root.is_dir() {
            return Err(Error::BadPath(format!("{} is not a directory", root.display())));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn name(&self) -> String {
        self.root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "/".into())
    }

    /// The file is the truth: a call after it changed sees the change (the parse is kept only while it is unchanged).
    pub fn config(&self) -> Result<Config> {
        Ok(Config::load(&self.root)?)
    }

    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        paths::safe_join(&self.root, rel)
    }

    /// Resolves a vault path, or a file inside one of the vault's configured `external_pdf_roots` (for read-only/zero-copy
    /// PDF serving, covers and reveal). Arbitrary `..` outside configured roots is always rejected.
    pub fn resolve_readable(&self, rel: &str) -> Result<PathBuf> {
        match self.resolve(rel) {
            Ok(p) => Ok(p),
            Err(e) => {
                let cfg = self.config()?;
                crate::external_roots::resolve_external_file(&self.root, &cfg, rel).map_err(|_| e)
            }
        }
    }

    pub fn rel(&self, abs: &Path) -> String {
        paths::rel_path(&self.root, abs).unwrap_or_else(|| abs.to_string_lossy().into_owned())
    }

    pub fn info(&self) -> Result<WorkspaceInfo> {
        Ok(WorkspaceInfo { root: self.root.to_string_lossy().into_owned(), name: self.name(), config: self.config()? })
    }

    /// `<state folder>/cache`: `.kandinsky/cache`, or `.atlas/cache` in a vault not yet migrated (`state_dir`).
    pub fn cache_dir(&self) -> PathBuf {
        crate::state_dir::dir(&self.root).join("cache")
    }
}

/// Walk up from `start` to the first folder containing `.kandinsky/` (or `.atlas/`, a vault from before the rename);
/// `None` if there is none.
pub fn find_root(start: &Path) -> Option<PathBuf> {
    start.ancestors().find(|d| is_vault(d)).map(Path::to_path_buf)
}

/// Does `dir` hold a state folder (`.kandinsky/` or the legacy `.atlas/`)?
pub fn is_vault(dir: &Path) -> bool {
    [crate::state_dir::STATE_DIR, crate::legacy::STATE_DIR].iter().any(|n| dir.join(n).is_dir())
}
