//! Secrets of plugins (a server's token, a password): kept **outside the vault**, so they are never
//! in its git, its sync or its backups by accident. One JSON file per vault,
//! `~/.config/kandinsky/secrets/<vault id>.json` (mode 0600, its folder 0700), holding
//! `{ plugin id: { name: value } }`. The desktop keyring is the better home and can replace this
//! file behind the same three functions; the file is what works everywhere (also headless).
//! A server's host may also mount secrets as read-only files, `$KANDINSKY_SECRET_FILES/<plugin>/<name>`
//! (the Docker/systemd-credentials shape, docs/guides/SERVER.md): they win over the JSON file and cannot be
//! changed from Kandinsky.
use crate::{Error, Result};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

type Table = BTreeMap<String, BTreeMap<String, String>>;

/// Where one vault's secrets are.
#[derive(Debug, Clone)]
pub struct Store {
    file: PathBuf,
    mounted: Option<PathBuf>,
    vault_key: String,
    use_keyring: bool,
}

/// FNV-1a, written out: the id must be the same in every Kandinsky version (std's hasher is not).
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(*b)).wrapping_mul(0x0000_0100_0000_01b3))
}

// `@` and the length: a card's secret is `<field>.<card name>.<key>`, and cards are often named by an address
/// Spaces only inside a name: a record's secrets carry its name (`subscriptions.IQ Calendar.password`).
fn valid(name: &str) -> bool {
    !name.is_empty() && name.len() <= 200 && name.trim() == name && name.chars().all(|c| c.is_ascii_alphanumeric() || "_-.@ ".contains(c))
}

impl Store {
    /// The store of the vault at `root`: `$KANDINSKY_SECRETS_DIR`, else beside the vault list
    /// (`~/.config/kandinsky/secrets/`). The file is named by the vault's folder name and a hash of its
    /// full path, so two vaults called "notes" do not share secrets.
    pub fn for_vault(root: &Path) -> Self {
        let dir = crate::env::var_os("SECRETS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| crate::vaults::list_file().parent().map(Path::to_path_buf).unwrap_or_default().join("secrets"));
        Self {
            mounted: crate::env::var_os("SECRET_FILES").map(PathBuf::from),
            use_keyring: crate::platform::keyring::active_for_vault(),
            ..Self::in_dir(&dir, root)
        }
    }

    pub fn in_dir(dir: &Path, root: &Path) -> Self {
        let full = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        let name: String = full.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(24).collect();
        let vault_key = format!("{name}-{:016x}", fnv1a(full.to_string_lossy().as_bytes()));
        Self { file: dir.join(format!("{vault_key}.json")), mounted: None, vault_key, use_keyring: false }
    }

    /// The file this store keeps its secrets in (named by the vault's path: `platform::dirs_migrate` renames it when
    /// the vault moves with the app's folder).
    pub fn file(&self) -> &Path {
        &self.file
    }

    /// The host's file for `plugin`'s `name`, when one is mounted (names that are not plain never reach the disk).
    fn mounted_file(&self, plugin: &str, name: &str) -> Option<PathBuf> {
        let plain = |s: &str| valid(s) && !s.starts_with('.');
        let f = self.mounted.as_ref()?.join(plugin).join(name);
        (plain(plugin) && plain(name) && f.is_file()).then_some(f)
    }

    fn refuse_mounted(&self, plugin: &str, name: &str) -> Result<()> {
        match self.mounted_file(plugin, name) {
            Some(f) => Err(Error::BadRequest(format!("secret {name:?} is set by the host ({}), not here", f.display()))),
            None => Ok(()),
        }
    }

    fn read(&self) -> Result<Table> {
        match std::fs::read_to_string(&self.file) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| Error::BadRequest(format!("{}: {e}", self.file.display()))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Table::new()),
            Err(e) => Err(e.into()),
        }
    }

    /// Written whole to a temporary file that only the user can read, then renamed over the old one.
    fn write(&self, table: &Table) -> Result<()> {
        let dir = self.file.parent().ok_or_else(|| Error::BadPath(self.file.display().to_string()))?;
        crate::vault_write::outside::mkdir(dir)?; // the secrets folder is never in a vault
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        let text = serde_json::to_string_pretty(table).map_err(|e| Error::Other(e.into()))?;
        crate::vault_write::outside::write_private(&self.file, text.as_bytes())
    }

    pub fn get(&self, plugin: &str, name: &str) -> Result<Option<String>> {
        if let Some(f) = self.mounted_file(plugin, name) {
            return Ok(Some(std::fs::read_to_string(f)?.trim_end_matches(['\n', '\r']).to_string()));
        }
        if self.use_keyring {
            if let Ok(Some(v)) = crate::platform::keyring::get(&self.vault_key, plugin, name) {
                return Ok(Some(v));
            }
            if let Some(legacy) = self.read()?.get(plugin).and_then(|p| p.get(name)).cloned() {
                if crate::platform::keyring::set(&self.vault_key, plugin, name, &legacy).is_ok() {
                    let _ = self.delete_from_file(plugin, name);
                }
                return Ok(Some(legacy));
            }
            return Ok(None);
        }
        Ok(self.read()?.get(plugin).and_then(|p| p.get(name)).cloned())
    }

    /// The names a plugin has stored (never the values).
    pub fn names(&self, plugin: &str) -> Result<Vec<String>> {
        let mut own = self.read()?.remove(plugin).unwrap_or_default();
        if self.use_keyring {
            if let Ok(kr_names) = crate::platform::keyring::list_names(&self.vault_key, plugin) {
                for n in kr_names {
                    own.entry(n).or_default();
                }
            }
        }
        Ok(self.names_in(plugin, &own))
    }

    /// The names in `own` (the file's, for `plugin`) and the host's mounted ones, sorted, once each.
    fn names_in(&self, plugin: &str, own: &BTreeMap<String, String>) -> Vec<String> {
        let mut names: std::collections::BTreeSet<String> = own.keys().cloned().collect();
        if let Some(dir) = self.mounted.as_ref().map(|d| d.join(plugin)) {
            names.extend(std::fs::read_dir(dir).into_iter().flatten().flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| self.mounted_file(plugin, n).is_some()));
        }
        names.into_iter().collect()
    }

    /// `plugin`'s secrets by name, every one (`only` None) or those of `only` it has, with one read of the file.
    pub fn values(&self, plugin: &str, only: Option<&[String]>) -> Result<BTreeMap<String, String>> {
        let mut own = self.read()?.remove(plugin).unwrap_or_default();
        if self.use_keyring {
            if let Ok(kr_names) = crate::platform::keyring::list_names(&self.vault_key, plugin) {
                for n in kr_names {
                    if let Ok(Some(v)) = crate::platform::keyring::get(&self.vault_key, plugin, &n) {
                        own.insert(n, v);
                    }
                }
            }
        }
        let names: Vec<String> = match only {
            Some(names) => names.to_vec(),
            None => self.names_in(plugin, &own),
        };
        let mut out = BTreeMap::new();
        for name in names {
            let v = match self.mounted_file(plugin, &name) {
                Some(f) => Some(std::fs::read_to_string(f)?.trim_end_matches(['\n', '\r']).to_string()),
                None => own.remove(&name).or_else(|| {
                    self.use_keyring.then(|| crate::platform::keyring::get(&self.vault_key, plugin, &name).ok().flatten()).flatten()
                }),
            };
            if let Some(v) = v {
                out.insert(name, v);
            }
        }
        Ok(out)
    }

    /// The table changed by `op` (which says whether it did) and written back, under a lock every Kandinsky process of this
    /// computer takes: a token refresh and a settings save at once, even from two processes, never drop one.
    fn edit(&self, op: impl FnOnce(&mut Table) -> bool) -> Result<bool> {
        crate::vault_write::outside::locked(&self.file, || {
            let mut t = self.read()?;
            let changed = op(&mut t);
            if changed {
                self.write(&t)?;
            }
            Ok(changed)
        })
    }

    pub fn set(&self, plugin: &str, name: &str, value: &str) -> Result<()> {
        if !valid(name) {
            return Err(Error::BadRequest(format!("secret name {name:?}: letters, digits, spaces, - _ . @ (at most 200)")));
        }
        self.refuse_mounted(plugin, name)?;
        if self.use_keyring && crate::platform::keyring::set(&self.vault_key, plugin, name, value).is_ok() {
            let _ = self.delete_from_file(plugin, name);
            return Ok(());
        }
        self.edit(|t| t.entry(plugin.to_string()).or_default().insert(name.to_string(), value.to_string()).as_deref() != Some(value)).map(|_| ())
    }

    /// True when there was one.
    pub fn delete(&self, plugin: &str, name: &str) -> Result<bool> {
        self.refuse_mounted(plugin, name)?;
        let mut had = false;
        if self.use_keyring {
            if let Ok(existed) = crate::platform::keyring::delete(&self.vault_key, plugin, name) {
                had |= existed;
            }
        }
        had |= self.delete_from_file(plugin, name)?;
        Ok(had)
    }

    fn delete_from_file(&self, plugin: &str, name: &str) -> Result<bool> {
        self.edit(|t| {
            let Some(p) = t.get_mut(plugin) else { return false };
            let had = p.remove(name).is_some();
            if p.is_empty() {
                t.remove(plugin);
            }
            had
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_kept_per_vault_and_plugin_in_a_file_only_the_user_can_read() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let s = Store::in_dir(dir.path(), a.path());
        assert_eq!(s.get("mail", "token").unwrap(), None);
        s.set("mail", "token", "s3cret").unwrap();
        s.set("mail", "user", "me").unwrap();
        s.set("links", "token", "other").unwrap();
        assert_eq!(s.get("mail", "token").unwrap().as_deref(), Some("s3cret"));
        assert_eq!(s.names("mail").unwrap(), ["token", "user"]);
        assert_eq!(s.get("links", "token").unwrap().as_deref(), Some("other"), "one plugin does not see another's");
        assert_eq!(Store::in_dir(dir.path(), b.path()).get("mail", "token").unwrap(), None, "nor one vault another's");
        assert_eq!(Store::in_dir(dir.path(), a.path()).get("mail", "token").unwrap().as_deref(), Some("s3cret"), "the same vault finds its file again");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&s.file).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert!(s.delete("mail", "token").unwrap());
        assert!(!s.delete("mail", "token").unwrap());
        assert_eq!(s.names("mail").unwrap(), ["user"]);
        assert!(s.set("mail", "../x", "v").is_err() && s.set("mail", "", "v").is_err());
    }

    #[test]
    fn a_host_mounted_secret_file_wins_and_cannot_be_changed_from_kandinsky() {
        let (dir, vault, host) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::create_dir(host.path().join("finance")).unwrap();
        std::fs::write(host.path().join("finance/bank_key"), "first line\nabc\nlast line\n").unwrap();
        std::fs::write(host.path().join("hidden"), "x").unwrap();
        let s = Store { mounted: Some(host.path().to_path_buf()), ..Store::in_dir(dir.path(), vault.path()) };
        s.set("finance", "other", "v").unwrap();
        assert_eq!(s.get("finance", "bank_key").unwrap().as_deref(), Some("first line\nabc\nlast line"), "read, the final newline dropped");
        assert_eq!(s.names("finance").unwrap(), ["bank_key", "other"], "both stores listed");
        assert!(s.set("finance", "bank_key", "v").is_err() && s.delete("finance", "bank_key").is_err(), "the host's file is read-only");
        assert_eq!(s.get("..", "hidden").unwrap(), None, "no way out of the mounted folder");
        assert_eq!(s.get("finance", "other").unwrap().as_deref(), Some("v"));
        let all = s.values("finance", None).unwrap();
        assert_eq!((all["bank_key"].as_str(), all["other"].as_str()), ("first line\nabc\nlast line", "v"), "every value, the host's too");
        let some = s.values("finance", Some(&["other".into(), "missing".into()])).unwrap();
        assert_eq!(some.into_iter().collect::<Vec<_>>(), [("other".to_string(), "v".to_string())], "only those asked that exist");
    }
}
