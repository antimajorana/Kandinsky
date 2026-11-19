//! Where a vault's background work runs (docs/design/DESIGN-server-role.md). Shared foundation types exported for
//! config and ts-rs; runtime seat/job helpers are completed by `wt-atlas-core`.
use serde::{Deserialize, Serialize};

/// Where a background job may run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Background {
    /// Every core that serves the vault (the default, and the behaviour before this key existed).
    #[default]
    Any,
    /// The server, when the vault has one: needs an always-on machine or the secrets kept there (bank sync, a feed
    /// poll, push). A vault with no server runs it where it is served.
    Server,
    /// Never a server core: it works with what only a person's device has (an ssh session it may not open itself), or
    /// writes files the person edits at the same time.
    Device,
}

/// What this core is to the vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Seat {
    /// A server core (`kandinsky serve`, the Docker image).
    Server,
    /// A desktop or the phone, the vault having a copy on a server (the vault list's `mirror = …`).
    MirroredDevice,
    /// A desktop or the phone, the vault on no server.
    LoneDevice,
}

impl Background {
    pub fn in_vault(self, chosen: &std::collections::BTreeMap<String, Background>, ids: &[&str]) -> Background {
        ids.iter().find_map(|id| chosen.get(*id).copied()).unwrap_or(self)
    }

    pub fn runs_at(self, seat: Seat) -> bool {
        match (self, seat) {
            (Background::Any, _) => true,
            (Background::Server, Seat::Server | Seat::LoneDevice) => true,
            (Background::Server, Seat::MirroredDevice) => false,
            (Background::Device, Seat::Server) => false,
            (Background::Device, Seat::MirroredDevice | Seat::LoneDevice) => true,
        }
    }

    pub fn words(self) -> &'static str {
        match self {
            Background::Any => "on every computer that serves the vault",
            Background::Server => "on the vault's server (here when it has none)",
            Background::Device => "on the person's devices, never on a server",
        }
    }
}
