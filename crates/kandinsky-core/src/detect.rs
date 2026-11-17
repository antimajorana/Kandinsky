//! Runtime suggestions for settings (shape-based discovery, nothing hardcoded): installed fonts, snippet
//! files, VS Code themes. Shown as choices next to the free-text field. (A plugin's own settings suggest through its
//! helper: `suggest` on a `[[setting]]` — the Claude plugin's commands and accounts.)
use crate::api::{Suggestion, Suggestions};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

/// stdout of a short command, or None if it fails or takes longer than `limit`.
fn quick(cmd: &Path, args: &[&str], limit: Duration) -> Option<String> {
    let mut command = Command::new(cmd);
    crate::platform::proc::no_window(&mut command);
    let mut child = command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait().ok()? {
            Some(st) if st.success() => break,
            Some(_) => return None,
            None if start.elapsed() > limit => {
                let _ = child.kill();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    let mut out = String::new();
    std::io::Read::read_to_string(&mut child.stdout.take()?, &mut out).ok()?;
    Some(out)
}

fn is_visible_family(family: &str) -> bool {
    !family.is_empty() && !family.starts_with('.') && !family.starts_with('@')
}

fn into_family_suggestions(mut fams: Vec<String>) -> Vec<Suggestion> {
    fams.sort_by_key(|f| f.to_lowercase());
    fams.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());
    fams.into_iter().map(|f| Suggestion { value: f.clone(), label: f }).collect()
}

/// Installed font families via `fc-list` when fontconfig is installed; `None` elsewhere.
fn fc_fonts(mono: bool) -> Option<Vec<Suggestion>> {
    let args: &[&str] = if mono { &[":spacing=mono", "family"] } else { &[":", "family"] };
    let text = quick(Path::new("fc-list"), args, Duration::from_secs(4))?;
    let fams: Vec<String> = text
        .lines()
        .filter_map(|l| l.split(',').next())
        .map(str::trim)
        .filter(|f| is_visible_family(f))
        .map(str::to_string)
        .collect();
    Some(into_family_suggestions(fams))
}

fn collect_family_suggestions<'a>(faces: impl IntoIterator<Item = (&'a str, bool)>) -> (Vec<Suggestion>, Vec<Suggestion>) {
    let mut mono = Vec::new();
    let mut all = Vec::new();
    for (raw, is_mono) in faces {
        let family = raw.trim();
        if !is_visible_family(family) {
            continue;
        }
        all.push(family.to_string());
        if is_mono {
            mono.push(family.to_string());
        }
    }
    (into_family_suggestions(mono), into_family_suggestions(all))
}

/// System fonts scanned once via `typst-kit` (`fontdb`), used when `fc-list` is absent (Windows/macOS).
fn scanned_fonts() -> (Vec<Suggestion>, Vec<Suggestion>) {
    static SCANNED: OnceLock<(Vec<Suggestion>, Vec<Suggestion>)> = OnceLock::new();
    SCANNED
        .get_or_init(|| {
            let infos: Vec<_> = typst_kit::fonts::system().map(|(_, info)| info).collect();
            collect_family_suggestions(
                infos.iter().map(|info| (info.family.as_str(), info.flags.contains(typst::text::FontFlags::MONOSPACE))),
            )
        })
        .clone()
}

/// Installed font families (`fc-list` when present, else `typst-kit` system scan), monospace only when `mono`.
pub fn fonts(mono: bool) -> Vec<Suggestion> {
    if let Some(fams) = fc_fonts(mono) {
        return fams;
    }
    let (m, a) = scanned_fonts();
    if mono { m } else { a }
}

/// The serif fonts the interface carries itself (ui/src/main.ts), first for notes: they work on every device.
fn bundled_prose() -> Vec<Suggestion> {
    ["Literata", "Source Serif 4"].into_iter().map(|f| Suggestion { value: f.into(), label: format!("{f} (built in)") }).collect()
}

/// [`suggestions`] reused for 5 minutes: it lists every installed font and snippet file.
pub fn suggestions_cached() -> Suggestions {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<(std::time::Instant, Suggestions)>> = Mutex::new(None);
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, v)) = c.as_ref() {
        if at.elapsed() < Duration::from_secs(300) {
            return v.clone();
        }
    }
    let v = suggestions();
    *c = Some((std::time::Instant::now(), v.clone()));
    v
}

/// Suggestions per dotted setting path, for the Settings pane.
pub fn suggestions() -> Suggestions {
    let ((mono, all), (snip, vars)) = std::thread::scope(|s| {
        let f = s.spawn(|| match (fc_fonts(true), fc_fonts(false)) {
            (Some(m), Some(a)) => (m, a),
            _ => scanned_fonts(),
        });
        let sn = s.spawn(crate::snippets::discover);
        (f.join().unwrap_or_default(), sn.join().unwrap_or_default())
    });
    let mut prose = bundled_prose();
    for item in &all {
        if !prose.iter().any(|p| p.value.to_lowercase() == item.value.to_lowercase()) {
            prose.push(item.clone());
        }
    }
    BTreeMap::from([
        ("latex.snippets_file".to_string(), snip),
        ("latex.variables_file".to_string(), vars),
        ("editor.code_font".to_string(), mono),
        ("ui.ui_font".to_string(), all),
        ("editor.prose_font".to_string(), prose),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn collect_family_suggestions_sorts_dedupes_and_filters_monospace() {
        let (mono, all) = collect_family_suggestions([
            ("", true),
            ("  ", false),
            (".SF NS", false),
            ("@MS Gothic", true),
            ("inter", false),
            ("Inter", false),
            ("JetBrains Mono", true),
            ("jetbrains mono", true),
            ("Consolas", true),
            ("Arial", false),
        ]);
        fn vals(items: &[Suggestion]) -> Vec<&str> {
            items.iter().map(|s| s.value.as_str()).collect()
        }
        assert_eq!(vals(&mono), vec!["Consolas", "JetBrains Mono"]);
        assert_eq!(vals(&all), vec!["Arial", "Consolas", "inter", "JetBrains Mono"]);
    }

    #[test]
    fn suggestions_populates_font_lists_without_duplicate_values() {
        let s = suggestions();
        assert!(!s["ui.ui_font"].is_empty(), "expected detected UI fonts");
        assert!(!s["editor.code_font"].is_empty(), "expected detected monospace fonts");
        assert!(!s["editor.prose_font"].is_empty(), "expected prose fonts");

        for key in ["ui.ui_font", "editor.code_font", "editor.prose_font"] {
            assert!(s[key].iter().all(|item| !item.value.trim().is_empty()), "empty value in {key}");
        }
        let mut seen = HashSet::new();
        for item in &s["editor.prose_font"] {
            assert!(seen.insert(item.value.to_lowercase()), "duplicate prose font value: {}", item.value);
        }
    }
}
