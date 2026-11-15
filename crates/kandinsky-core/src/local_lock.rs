//! The local core closed to other programs (docs/design/DESIGN-local-lock.md): with the lock on, a request to 127.0.0.1 must
//! carry this run's key — as `Authorization: Bearer`, `x-kandinsky-token`, or the HttpOnly cookie a window gets by opening a
//! one-time link. On a phone every app shares the loopback interface, so without it any app could read the vault.
use axum::http::{header, HeaderMap};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const COOKIE: &str = "kandinsky_local";
/// How long a one-time link may wait before it is opened.
const CODE_LIFE: Duration = Duration::from_secs(120);

/// Whether a local core is locked. A closed choice, made where the core is started.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Lock {
    /// Only the Host / `x-kandinsky: 1` checks against web pages (any program on the machine gets in).
    Open,
    /// A key per run; `fixed` names it (tests), else it is random.
    Locked { fixed: Option<String> },
}

impl Lock {
    /// `KANDINSKY_LOCAL_LOCK=1` turns it on for `kandinsky serve` and the desktop app; `KANDINSKY_LOCAL_KEY` fixes the key.
    pub fn from_env() -> Self {
        match crate::env::var("LOCAL_LOCK").as_deref() {
            Some("1" | "on" | "true") => Lock::Locked { fixed: crate::env::var("LOCAL_KEY").filter(|k| !k.is_empty()) },
            _ => Lock::Open,
        }
    }

    /// The desktop app's core: locked unless `KANDINSKY_LOCAL_LOCK=0`. `kandinsky serve` and the tests keep [`Lock::from_env`]'s opt-in.
    pub fn desktop() -> Self {
        match crate::env::var("LOCAL_LOCK").as_deref() {
            Some("0" | "off" | "false") => Lock::Open,
            _ => Lock::Locked { fixed: crate::env::var("LOCAL_KEY").filter(|k| !k.is_empty()) },
        }
    }
}

pub struct LocalLock {
    key: crate::auth::LocalKeyFile,
    codes: Mutex<HashMap<String, Instant>>,
}

impl LocalLock {
    /// A lock for the core on `port`; the key is written owner-only where this machine's `kandinsky` CLI looks for it
    /// ([`crate::auth::local_key_file`]), so the CLI and `kandinsky mcp` need nothing more.
    pub fn new(port: u16, fixed: Option<String>) -> anyhow::Result<Self> {
        let key = fixed.unwrap_or_else(|| format!("atl_{}", crate::auth::random_hex(32)));
        Ok(LocalLock { key: crate::auth::LocalKeyFile::write(port, key)?, codes: Mutex::default() })
    }

    pub fn key(&self) -> &str {
        self.key.key()
    }

    /// The request carries this run's key, by any of its three ways.
    pub fn admits(&self, h: &HeaderMap) -> bool {
        let bearer = h.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
        let token = crate::auth::header(h, crate::auth::TOKEN_HEADER).and_then(|v| v.to_str().ok());
        let cookie = crate::auth::cookie(h, COOKIE);
        let found = [bearer, token, cookie.as_deref()].into_iter().flatten().any(|k| same(k.trim(), self.key()));
        found
    }

    /// A code that opens one window once: `/?k=<code>` sets the cookie and goes on to the page.
    pub fn code(&self) -> String {
        let code = crate::auth::random_hex(16);
        let mut codes = self.codes.lock().unwrap();
        codes.retain(|_, made| made.elapsed() < CODE_LIFE);
        codes.insert(code.clone(), Instant::now());
        code
    }

    /// True once per code, within its life.
    pub fn redeem(&self, code: &str) -> bool {
        self.codes.lock().unwrap().remove(code).is_some_and(|made| made.elapsed() < CODE_LIFE)
    }

    /// The cookie a redeemed code sets: the key itself, out of the page's scripts' reach, never sent to another site.
    pub fn cookie(&self) -> String {
        format!("{COOKIE}={}; Path=/; HttpOnly; SameSite=Strict", self.key())
    }
}

/// Equal without telling, by its timing, how much of a guess was right.
pub(crate) fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn lock() -> LocalLock {
        LocalLock { key: crate::auth::LocalKeyFile::unwritten("atl_k"), codes: Mutex::default() }
    }
    fn with(name: &str, value: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(), HeaderValue::from_str(value).unwrap());
        h
    }

    #[test]
    fn the_key_is_taken_three_ways_and_nothing_else() {
        let l = lock();
        assert!(l.admits(&with("authorization", "Bearer atl_k")));
        assert!(l.admits(&with("x-kandinsky-token", "atl_k")));
        assert!(l.admits(&with("cookie", "a=b; kandinsky_local=atl_k")));
        assert!(!l.admits(&with("x-kandinsky", "1")), "the old header alone is not a credential");
        assert!(!l.admits(&with("authorization", "Bearer atl_x")));
        assert!(!l.admits(&with("cookie", "kandinsky_local=atl_kk")));
        assert!(!l.admits(&HeaderMap::new()));
    }

    #[test]
    fn a_code_opens_once() {
        let l = lock();
        let c = l.code();
        assert!(l.redeem(&c));
        assert!(!l.redeem(&c), "used");
        assert!(!l.redeem("not-a-code"));
    }
}
