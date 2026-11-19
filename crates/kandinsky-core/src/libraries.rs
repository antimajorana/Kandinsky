//! The vault's libraries (`[ui] libraries`): shared types, config deserializer, and ts-rs exports. Query/mutation
//! handlers (`list`, `get`, `add`) are added by `wt-atlas-core`.
use crate::api::Mtime;
use crate::config::{LibraryKind, LibraryLayout, LibrarySpec};
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

/// `[ui] libraries` as written before entries had fields (`["drawings", "references"]`) or with them: a bare string is
/// the entry with that id.
pub fn specs_any<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Vec<LibrarySpec>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Any {
        Id(String),
        Full(LibrarySpec),
    }
    Ok(Vec::<Any>::deserialize(d)?
        .into_iter()
        .map(|a| match a {
            Any::Id(id) => LibrarySpec { id, ..LibrarySpec::default() },
            Any::Full(s) => s,
        })
        .collect())
}

/// Where a library's items come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum LibrarySource {
    Folder,
    Base,
    Given,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LibraryInfo {
    pub id: String,
    pub title: String,
    pub kind: LibraryKind,
    pub icon: String,
    pub source: LibrarySource,
    pub folder: String,
    pub base: String,
    pub sort: String,
    pub layout: LibraryLayout,
    pub hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LibraryThing {
    pub path: String,
    pub note: Option<String>,
    pub title: String,
    pub sub: String,
    pub cover: Option<String>,
    pub progress: Option<f64>,
    pub last_read: Option<Mtime>,
    pub modified: Mtime,
    pub group: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LibraryView {
    pub library: LibraryInfo,
    #[serde(rename = "continue")]
    #[ts(rename = "continue")]
    pub continuing: Vec<LibraryThing>,
    pub items: Vec<LibraryThing>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct LibraryAdd {
    pub folder: String,
    pub base: String,
    pub kind: Option<LibraryKind>,
    pub title: String,
}
