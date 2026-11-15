//! Kandinsky's environment variables: `KANDINSKY_<NAME>`, with the name from before the rename
//! (`ATLAS_<NAME>`, [`crate::legacy::ENV_PREFIX`]) read when the new one is not set, and set beside it for child
//! processes, so scripts, plugins and manifests written for an earlier build keep working.
use std::ffi::OsString;

pub const PREFIX: &str = "KANDINSKY_";

/// `KANDINSKY_<name>`, else `ATLAS_<name>` (set but empty counts as set, as with `std::env::var_os`).
pub fn var_os(name: &str) -> Option<OsString> {
    var_os_with(name, |n| std::env::var_os(n))
}

/// [`var_os`] as text; a value that is not Unicode counts as unset (as `std::env::var(..).ok()`).
pub fn var(name: &str) -> Option<String> {
    var_os(name).and_then(|v| v.into_string().ok())
}

/// [`var_os`] with the lookup given: tests pass a map instead of changing the process's environment.
pub fn var_os_with(name: &str, get: impl Fn(&str) -> Option<OsString>) -> Option<OsString> {
    get(&format!("{PREFIX}{name}")).or_else(|| get(&format!("{}{name}", crate::legacy::ENV_PREFIX)))
}

/// Both names of `name`, the current first: what a child process is given.
pub fn both(name: &str) -> [String; 2] {
    [format!("{PREFIX}{name}"), format!("{}{name}", crate::legacy::ENV_PREFIX)]
}

/// `env` plus, for each `KANDINSKY_<NAME>` in it, `ATLAS_<NAME>` with the same value unless `env` sets that name
/// itself: what a plugin's run line and process see, so `$ATLAS_PLUGIN_DIR` in an installed manifest still expands.
pub fn with_legacy(env: &[(String, OsString)]) -> Vec<(String, OsString)> {
    let mut out = env.to_vec();
    for (k, v) in env {
        if let Some(name) = k.strip_prefix(PREFIX) {
            let old = format!("{}{name}", crate::legacy::ENV_PREFIX);
            if !env.iter().any(|(k2, _)| *k2 == old) {
                out.push((old, v.clone()));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup<'a>(map: &'a HashMap<&'a str, &'a str>) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |n| map.get(n).map(OsString::from)
    }

    #[test]
    fn new_name_wins_old_is_the_fallback() {
        let both = HashMap::from([("KANDINSKY_VAULTS", "/new"), ("ATLAS_VAULTS", "/old")]);
        assert_eq!(var_os_with("VAULTS", lookup(&both)), Some("/new".into()));
        let old = HashMap::from([("ATLAS_VAULTS", "/old")]);
        assert_eq!(var_os_with("VAULTS", lookup(&old)), Some("/old".into()));
        let empty_new = HashMap::from([("KANDINSKY_NO_NOTIFY", ""), ("ATLAS_NO_NOTIFY", "1")]);
        assert_eq!(var_os_with("NO_NOTIFY", lookup(&empty_new)), Some("".into()));
        assert_eq!(var_os_with("VAULTS", lookup(&HashMap::new())), None);
    }

    #[test]
    fn children_get_both_names() {
        assert_eq!(both("ROOT"), ["KANDINSKY_ROOT".to_string(), "ATLAS_ROOT".to_string()]);
        let env = vec![("KANDINSKY_PLUGIN_DIR".to_string(), OsString::from("/p")), ("PATH".to_string(), OsString::from("/bin"))];
        let out = with_legacy(&env);
        assert!(out.contains(&("ATLAS_PLUGIN_DIR".to_string(), OsString::from("/p"))));
        assert_eq!(out.len(), 3);
        // a name set on purpose is left as given
        let given = vec![("KANDINSKY_ROOT".to_string(), OsString::from("/a")), ("ATLAS_ROOT".to_string(), OsString::from("/b"))];
        assert_eq!(with_legacy(&given), given);
    }
}
