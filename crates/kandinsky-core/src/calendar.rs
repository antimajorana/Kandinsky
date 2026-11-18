//! Native click-a-day Calendar backend over plain vault Markdown, YAML frontmatter,
//! open tasks, `.base` date views, optional `.ics` feeds, and optional `dav` plugin caches.
use crate::config::Config;
use crate::{capture, frontmatter, paths, vault_write, Error, Result};
use chrono::{Datelike, Days, Duration, Months, NaiveDate, NaiveDateTime, TimeZone};
use kandinsky_text::ical::{self, Line};
use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CalendarSource {
    EventPage,
    DailyFrontmatter,
    DailySchedule,
    Task,
    Base,
    Ics,
    Dav,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum CalendarRecurrence {
    #[default]
    None,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl CalendarRecurrence {
    fn from_str(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "daily" => Self::Daily,
            "weekly" => Self::Weekly,
            "monthly" => Self::Monthly,
            "yearly" => Self::Yearly,
            _ => Self::None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
            Self::Yearly => "yearly",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarEvent {
    pub id: String,
    pub occurrence_id: String,
    pub title: String,
    pub date: String,
    pub end_date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub end: Option<String>,
    pub all_day: bool,
    pub color: String,
    pub location: String,
    pub repeat: CalendarRecurrence,
    pub links: Vec<String>,
    pub source: CalendarSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line: Option<u32>,
    pub completed: bool,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarDaySummary {
    pub day: String,
    pub log_path: String,
    pub has_log: bool,
    pub log_has_content: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarRangeResponse {
    pub from: String,
    pub to: String,
    pub days: Vec<CalendarDaySummary>,
    pub events: Vec<CalendarEvent>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct CalendarEventUpsert {
    #[serde(default)]
    #[ts(optional)]
    pub id: Option<String>,
    /// `"inline"` (default: Daily Note `events:` frontmatter) or `"page"` (`<events_dir>/YYYY-MM-DD <Title>.md`).
    #[serde(default)]
    #[ts(optional)]
    pub storage: Option<String>,
    pub title: String,
    pub date: String,
    #[serde(default)]
    #[ts(optional)]
    pub end_date: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub start: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub end: Option<String>,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub repeat: CalendarRecurrence,
    /// Every `interval`-th day, week, month or year of `repeat` (1 when unset). Left out of an edit, the stored one stays.
    #[serde(default)]
    #[ts(optional)]
    pub interval: Option<u32>,
    /// The last day a repeating event can fall on (`YYYY-MM-DD`, empty for none). Left out of an edit, the stored one stays.
    #[serde(default)]
    #[ts(optional)]
    pub until: Option<String>,
    /// Days (`YYYY-MM-DD`) a repeating event skips. Left out of an edit, the stored ones stay.
    #[serde(default)]
    #[ts(optional)]
    pub except: Option<Vec<String>>,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default)]
    #[ts(optional)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct CalendarPromoteRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct CalendarPromoteResult {
    pub path: String,
    pub event: CalendarEvent,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
pub struct IcsImportRequest {
    pub ics: String,
    #[serde(default)]
    #[ts(optional)]
    pub as_pages: Option<bool>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct IcsImportResult {
    pub imported: u32,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone)]
struct RawEvent {
    id: String,
    title: String,
    date: NaiveDate,
    end_date: NaiveDate,
    start: Option<String>,
    end: Option<String>,
    all_day: bool,
    color: String,
    location: String,
    repeat: CalendarRecurrence,
    series: Series,
    links: Vec<String>,
    source: CalendarSource,
    path: Option<String>,
    line: Option<u32>,
    completed: bool,
    editable: bool,
}

/// What a repeat says beyond its frequency: every `interval`-th period, nothing after `until`, nothing on `except`.
#[derive(Debug, Clone, PartialEq)]
struct Series {
    interval: u32,
    until: Option<NaiveDate>,
    except: Vec<NaiveDate>,
}

impl Default for Series {
    fn default() -> Self {
        Series { interval: 1, until: None, except: Vec::new() }
    }
}

fn parse_day(s: &str) -> Option<NaiveDate> {
    s.trim().get(..10).and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
}

impl Series {
    /// From the `interval`, `until` and `except` properties of a stored event.
    fn from_props<'a>(g: impl Fn(&str) -> Option<&'a Value>) -> Self {
        let interval = match g("interval") {
            Some(Value::Number(n)) => n.as_u64().and_then(|n| u32::try_from(n).ok()),
            Some(Value::String(s)) => s.trim().parse().ok(),
            _ => None,
        };
        let mut except: Vec<NaiveDate> = strings_val(g("except")).iter().filter_map(|s| parse_day(s)).collect();
        except.sort_unstable();
        except.dedup();
        Series { interval: interval.filter(|&i| i > 0).unwrap_or(1), until: parse_day(&str_val(g("until"))), except }
    }

    fn from_req(req: &CalendarEventUpsert) -> Self {
        let mut except: Vec<NaiveDate> = req.except.iter().flatten().filter_map(|s| parse_day(s)).collect();
        except.sort_unstable();
        except.dedup();
        Series { interval: req.interval.filter(|&i| i > 0).unwrap_or(1), until: req.until.as_deref().and_then(parse_day), except }
    }

    /// The properties to store; none for an event that does not repeat or a series that is every period, endless and whole.
    fn props(&self, repeat: CalendarRecurrence) -> [(&'static str, Option<Value>); 3] {
        let on = repeat != CalendarRecurrence::None;
        let day = |d: &NaiveDate| Value::String(d.format("%Y-%m-%d").to_string());
        [
            ("interval", (on && self.interval > 1).then(|| Value::Number(self.interval.into()))),
            ("until", self.until.as_ref().filter(|_| on).map(day)),
            ("except", (on && !self.except.is_empty()).then(|| Value::Sequence(self.except.iter().map(day).collect()))),
        ]
    }
}

pub fn query_range(root: &Path, cfg: &Config, from: NaiveDate, to: NaiveDate) -> Result<CalendarRangeResponse> {
    query_range_with_bases(root, cfg, from, to, None)
}

pub fn query_range_with_bases(
    root: &Path,
    cfg: &Config,
    from: NaiveDate,
    to: NaiveDate,
    bases_filter: Option<&[String]>,
) -> Result<CalendarRangeResponse> {
    let (from, to) = if to < from { (to, from) } else { (from, to) };
    let mut days = Vec::new();
    let mut d = from;
    while d <= to && days.len() < 180 {
        let rel = capture::day_log(cfg, d);
        let abs = paths::safe_join(root, &rel)?;
        let (has_log, log_has_content) = match std::fs::read_to_string(&abs) {
            Ok(txt) => (true, note_has_meaningful_content(&txt)),
            Err(_) => (false, false),
        };
        days.push(CalendarDaySummary { day: d.format("%Y-%m-%d").to_string(), log_path: rel, has_log, log_has_content });
        let Some(next) = d.succ_opt() else { break };
        d = next;
    }

    let raw = collect_raw_events_with_bases(root, cfg, bases_filter);
    let mut events = Vec::new();
    for ev in raw {
        expand_event(&ev, from, to, &mut events);
    }
    events.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| b.all_day.cmp(&a.all_day))
            .then_with(|| a.start.as_deref().unwrap_or("").cmp(b.start.as_deref().unwrap_or("")))
            .then_with(|| a.title.cmp(&b.title))
    });
    Ok(CalendarRangeResponse {
        from: from.format("%Y-%m-%d").to_string(),
        to: to.format("%Y-%m-%d").to_string(),
        days,
        events,
    })
}

fn note_has_meaningful_content(txt: &str) -> bool {
    let (_, body) = frontmatter::split(txt);
    let props = crate::note_props::Props::from_markdown(txt);
    let has_fm_events = props.get("events").and_then(Value::as_sequence).is_some_and(|s| !s.is_empty());
    has_fm_events || body.lines().any(|l| {
        let t = l.trim();
        !t.is_empty() && !t.starts_with("# ")
    })
}

fn collect_raw_events(root: &Path, cfg: &Config) -> Vec<RawEvent> {
    collect_raw_events_with_bases(root, cfg, None)
}

fn collect_raw_events_with_bases(root: &Path, cfg: &Config, bases_filter: Option<&[String]>) -> Vec<RawEvent> {
    let mut out = Vec::new();
    let events_dir = cfg.calendar.events_dir.trim().trim_matches('/');
    let log_prefix = cfg.log_dir.trim_matches('/');
    for (abs, rel) in crate::walk::files(root, cfg) {
        if !rel.ends_with(".md") {
            continue;
        }
        let Ok(txt) = std::fs::read_to_string(&abs) else { continue };
        let props = crate::note_props::Props::from_markdown(&txt);
        let in_events = !events_dir.is_empty() && (rel.starts_with(&format!("{events_dir}/")) || rel == events_dir);
        let is_event_type = props.get("type").and_then(Value::as_str).is_some_and(|t| t.eq_ignore_ascii_case("event"));
        if in_events || is_event_type {
            if let Some(ev) = parse_event_page(&rel, &props) {
                out.push(ev);
            }
        }
        let in_log = !log_prefix.is_empty() && rel.starts_with(&format!("{log_prefix}/"));
        let log_day = in_log.then(|| date_from_filename(&rel)).flatten();
        if let Some(day) = log_day {
            out.extend(parse_daily_frontmatter_events(&rel, day, &props));
            out.extend(parse_daily_schedule_lines(&rel, day, &txt));
        }
        for (idx, line_txt, done) in crate::today::task_lines(txt.lines()) {
            let t = crate::tasks::parse(line_txt);
            if let Some(day) = t.date() {
                let line_no = idx as u32 + 1;
                out.push(RawEvent {
                    id: format!("task:{rel}:{line_no}"),
                    title: if t.title.is_empty() { "Task".into() } else { t.title },
                    date: day,
                    end_date: day,
                    start: None,
                    end: None,
                    all_day: true,
                    color: if done { "default".into() } else { "amber".into() },
                    location: String::new(),
                    repeat: CalendarRecurrence::None,
                    series: Series::default(),
                    links: Vec::new(),
                    source: CalendarSource::Task,
                    path: Some(rel.clone()),
                    line: Some(line_no),
                    completed: done,
                    editable: true,
                });
            }
        }
    }

    collect_base_events(root, cfg, bases_filter, &mut out);
    collect_ics_feeds(root, cfg, &mut out);
    out
}

fn collect_base_events(root: &Path, cfg: &Config, bases_filter: Option<&[String]>, out: &mut Vec<RawEvent>) {
    let mut seen_notes: HashSet<(String, String)> = HashSet::new();
    let active_bases: &[String] = bases_filter.unwrap_or(&cfg.calendar.bases);
    for base_rel in active_bases {
        let Ok(abs) = paths::safe_join(root, base_rel) else { continue };
        let Ok(src) = std::fs::read_to_string(&abs) else { continue };
        let res = crate::bases::evaluate(root, cfg, &src, None);
        let Some(view) = res.views.iter().find(|v| v.kind == "calendar").or_else(|| res.views.first()) else {
            continue;
        };
        let dp = view.date_property.as_deref().unwrap_or("due");
        let date_col = view
            .columns
            .iter()
            .position(|c| c.id == dp || c.key.as_deref() == Some(dp))
            .or_else(|| view.columns.iter().position(|c| matches!(c.key.as_deref(), Some("date" | "due" | "start"))));
        let Some(ci) = date_col else { continue };
        let col_key = view.columns[ci].key.clone().unwrap_or_else(|| view.columns[ci].id.clone());
        let end_col = view
            .end_date_property
            .as_deref()
            .and_then(|ed| view.columns.iter().position(|c| c.id == ed || c.key.as_deref() == Some(ed)));
        for row in &view.rows {
            let Some(date_s) = cell_date_str(row.cells.get(ci)) else { continue };
            let Ok(start_d) = NaiveDate::parse_from_str(&date_s, "%Y-%m-%d") else { continue };
            let end_d = end_col
                .and_then(|ei| cell_date_str(row.cells.get(ei)))
                .and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
                .filter(|&d| d >= start_d)
                .unwrap_or(start_d);
            if !seen_notes.insert((base_rel.clone(), row.path.clone())) {
                continue;
            }
            let title = row.path.rsplit('/').next().unwrap_or(&row.path).trim_end_matches(".md").to_string();
            out.push(RawEvent {
                id: format!("base:{base_rel}:{col_key}:{}", row.path),
                title: title.clone(),
                date: start_d,
                end_date: end_d,
                start: None,
                end: None,
                all_day: true,
                color: "purple".into(),
                location: String::new(),
                repeat: CalendarRecurrence::None,
                series: Series::default(),
                links: vec![format!("[[{title}]]")],
                source: CalendarSource::Base,
                path: Some(row.path.clone()),
                line: None,
                completed: false,
                editable: true,
            });
        }
    }
}

fn cell_date_str(c: Option<&crate::api::BaseCell>) -> Option<String> {
    match c? {
        crate::api::BaseCell::Date { text: value, .. } | crate::api::BaseCell::Text { value } => {
            value.get(..10).filter(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()).map(str::to_string)
        }
        _ => None,
    }
}

fn collect_ics_feeds(root: &Path, cfg: &Config, out: &mut Vec<RawEvent>) {
    for feed in &cfg.calendar.ics_feeds {
        let p = feed.trim();
        if p.is_empty() || p.starts_with("http://") || p.starts_with("https://") {
            continue;
        }
        let Ok(abs) = paths::safe_join(root, p) else { continue };
        let Ok(src) = std::fs::read_to_string(&abs) else { continue };
        for (i, parsed) in parse_ics_events(&src).into_iter().enumerate() {
            out.push(RawEvent {
                id: format!("ics:{p}:{i}"),
                path: Some(p.to_string()),
                source: CalendarSource::Ics,
                editable: false,
                ..parsed
            });
        }
    }
}

fn date_from_filename(rel: &str) -> Option<NaiveDate> {
    let stem = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md");
    stem.get(..10).and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
}

fn parse_hm(raw: &str) -> Option<String> {
    let t = raw.trim();
    let (h, m) = t.split_once(':')?;
    let hh: u8 = h.trim().parse().ok()?;
    let mm: u8 = m.trim().get(..2)?.parse().ok()?;
    (hh < 24 && mm < 60).then(|| format!("{hh:02}:{mm:02}"))
}

fn str_val(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn strings_val(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Sequence(seq)) => seq.iter().filter_map(|i| i.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        Some(Value::String(s)) if !s.trim().is_empty() => vec![s.trim().to_string()],
        _ => Vec::new(),
    }
}

fn parse_event_page(rel: &str, props: &crate::note_props::Props) -> Option<RawEvent> {
    let date_raw = str_val(props.get("date"));
    let date = date_raw
        .get(..10)
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .or_else(|| date_from_filename(rel))?;
    let end_raw = str_val(props.get("end"));
    let end_date_raw = str_val(props.get("end_date"));
    let end_date = end_date_raw
        .get(..10)
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .or_else(|| end_raw.get(..10).and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()))
        .filter(|&ed| ed >= date)
        .unwrap_or(date);
    let start = parse_hm(&str_val(props.get("start")));
    let end = parse_hm(&end_raw);
    let all_day = props.get("all_day").and_then(Value::as_bool).unwrap_or(start.is_none());
    let stem = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md");
    let default_title = if stem.len() > 11 && date_from_filename(rel).is_some() && stem.as_bytes().get(10) == Some(&b' ') {
        stem[11..].to_string()
    } else {
        stem.to_string()
    };
    let title_prop = str_val(props.get("title"));
    let color = str_val(props.get("color"));
    let location = str_val(props.get("location"));
    let repeat = CalendarRecurrence::from_str(&str_val(props.get("repeat")));
    let links = strings_val(props.get("links"));
    Some(RawEvent {
        id: format!("page:{rel}"),
        title: if title_prop.is_empty() { default_title } else { title_prop },
        date,
        end_date,
        start: if all_day { None } else { start },
        end: if all_day { None } else { end },
        all_day,
        color: if color.is_empty() { "blue".into() } else { color },
        location,
        repeat,
        series: Series::from_props(|k| props.get(k)),
        links,
        source: CalendarSource::EventPage,
        path: Some(rel.to_string()),
        line: None,
        completed: false,
        editable: true,
    })
}

fn parse_daily_frontmatter_events(rel: &str, day: NaiveDate, props: &crate::note_props::Props) -> Vec<RawEvent> {
    let Some(Value::Sequence(seq)) = props.get("events") else { return Vec::new() };
    let mut out = Vec::new();
    for (idx, item) in seq.iter().enumerate() {
        let Some(m) = item.as_mapping() else { continue };
        let g = |k: &str| m.get(Value::String(k.into()));
        let title = str_val(g("title"));
        if title.is_empty() {
            continue;
        }
        let d = str_val(g("date"))
            .get(..10)
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .unwrap_or(day);
        let ed = str_val(g("end_date"))
            .get(..10)
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .filter(|&x| x >= d)
            .unwrap_or(d);
        let start = parse_hm(&str_val(g("start")));
        let end = parse_hm(&str_val(g("end")));
        let all_day = g("all_day").and_then(Value::as_bool).unwrap_or(start.is_none());
        let color = str_val(g("color"));
        let location = str_val(g("location"));
        let repeat = CalendarRecurrence::from_str(&str_val(g("repeat")));
        let links = strings_val(g("links"));
        out.push(RawEvent {
            id: format!("dm:{rel}:{idx}"),
            title,
            date: d,
            end_date: ed,
            start: if all_day { None } else { start },
            end: if all_day { None } else { end },
            all_day,
            color: if color.is_empty() { "blue".into() } else { color },
            location,
            repeat,
            series: Series::from_props(g),
            links,
            source: CalendarSource::DailyFrontmatter,
            path: Some(rel.to_string()),
            line: None,
            completed: false,
            editable: true,
        });
    }
    out
}

fn parse_daily_schedule_lines(rel: &str, day: NaiveDate, txt: &str) -> Vec<RawEvent> {
    let mut out = Vec::new();
    let mut fences = kandinsky_text::fence::Fences::default();
    for (idx, raw) in txt.lines().enumerate() {
        if fences.code(raw) {
            continue;
        }
        let trimmed = raw.trim_start();
        let Some(rest) = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")) else {
            continue;
        };
        if rest.starts_with('[') {
            continue;
        }
        let Some((times, title)) = parse_time_range_prefix(rest) else { continue };
        let line_no = idx as u32 + 1;
        out.push(RawEvent {
            id: format!("ds:{rel}:{line_no}"),
            title,
            date: day,
            end_date: day,
            start: Some(times.0),
            end: Some(times.1),
            all_day: false,
            color: "green".into(),
            location: String::new(),
            repeat: CalendarRecurrence::None,
            series: Series::default(),
            links: Vec::new(),
            source: CalendarSource::DailySchedule,
            path: Some(rel.to_string()),
            line: Some(line_no),
            completed: false,
            editable: true,
        });
    }
    out
}

fn parse_time_range_prefix(s: &str) -> Option<((String, String), String)> {
    let (tok, rest) = s.split_once(' ')?;
    let (a, b) = tok.split_once('–').or_else(|| tok.split_once('-'))?;
    let s_t = parse_hm(a)?;
    let e_t = parse_hm(b)?;
    let title = rest.trim();
    if title.is_empty() {
        return None;
    }
    Some(((s_t, e_t), title.to_string()))
}

fn expand_event(ev: &RawEvent, from: NaiveDate, to: NaiveDate, out: &mut Vec<CalendarEvent>) {
    let span = (ev.end_date - ev.date).num_days().max(0);
    let mut push_inst = |occ_start: NaiveDate| {
        let occ_end = occ_start + Duration::days(span);
        if occ_end < from || occ_start > to {
            return;
        }
        let day_str = occ_start.format("%Y-%m-%d").to_string();
        out.push(CalendarEvent {
            id: ev.id.clone(),
            occurrence_id: format!("{}@{day_str}", ev.id),
            title: ev.title.clone(),
            date: day_str,
            end_date: occ_end.format("%Y-%m-%d").to_string(),
            start: ev.start.clone(),
            end: ev.end.clone(),
            all_day: ev.all_day,
            color: ev.color.clone(),
            location: ev.location.clone(),
            repeat: ev.repeat,
            links: ev.links.clone(),
            source: ev.source,
            path: ev.path.clone(),
            line: ev.line,
            completed: ev.completed,
            editable: ev.editable,
        });
    };
    if ev.repeat == CalendarRecurrence::None {
        push_inst(ev.date);
        return;
    }
    let s = &ev.series;
    let nth = |k: u64| nth_occurrence(ev.date, ev.repeat, s.interval, k);
    // skip straight to the last occurrence before the window (a long-running series is not walked from its start)
    let mut k = occurrence_index(ev.date, ev.repeat, s.interval, from - Duration::days(span)).unwrap_or(0);
    let Some(mut cur) = nth(k) else { return };
    let mut shown = 0usize;
    while cur <= to && shown < 400 && s.until.is_none_or(|u| cur <= u) {
        if cur + Duration::days(span) >= from && !s.except.contains(&cur) {
            push_inst(cur);
            shown += 1;
        }
        k += 1;
        match nth(k) {
            Some(next) if next > cur => cur = next,
            _ => break,
        }
    }
}

fn month_index(d: NaiveDate) -> i64 {
    i64::from(d.year()) * 12 + i64::from(d.month0())
}

fn from_month_index(m: i64, day: u32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(i32::try_from(m.div_euclid(12)).ok()?, u32::try_from(m.rem_euclid(12)).ok()? + 1, day)
}

/// The `k`-th occurrence of a series from `start`; months are counted from the start, so the 31st stays the 31st where
/// the month has one (and is the month's last day where it has not).
fn nth_occurrence(start: NaiveDate, repeat: CalendarRecurrence, interval: u32, k: u64) -> Option<NaiveDate> {
    let n = k.checked_mul(u64::from(interval.max(1)))?;
    match repeat {
        CalendarRecurrence::Daily => start.checked_add_days(Days::new(n)),
        CalendarRecurrence::Weekly => start.checked_add_days(Days::new(n.checked_mul(7)?)),
        CalendarRecurrence::Monthly => start.checked_add_months(Months::new(u32::try_from(n).ok()?)),
        CalendarRecurrence::Yearly => start.checked_add_months(Months::new(u32::try_from(n.checked_mul(12)?).ok()?)),
        CalendarRecurrence::None => (k == 0).then_some(start),
    }
}

/// The index of the series' last occurrence on or before `d`; none before its start.
fn occurrence_index(start: NaiveDate, repeat: CalendarRecurrence, interval: u32, d: NaiveDate) -> Option<u64> {
    if d < start {
        return None;
    }
    let step = u64::from(interval.max(1));
    let days = (d - start).num_days() as u64;
    let months = (month_index(d) - month_index(start)) as u64;
    let mut k = match repeat {
        CalendarRecurrence::Daily => days / step,
        CalendarRecurrence::Weekly => days / (7 * step),
        CalendarRecurrence::Monthly => months / step,
        CalendarRecurrence::Yearly => months / (12 * step),
        CalendarRecurrence::None => 0,
    };
    while k > 0 && nth_occurrence(start, repeat, interval, k).is_none_or(|x| x > d) {
        k -= 1;
    }
    Some(k)
}

pub fn upsert_event(root: &Path, cfg: &Config, req: &CalendarEventUpsert) -> Result<CalendarEvent> {
    let title = req.title.trim();
    if title.is_empty() {
        return Err(Error::BadRequest("event title is empty".into()));
    }
    let date = NaiveDate::parse_from_str(req.date.trim(), "%Y-%m-%d")
        .map_err(|_| Error::BadRequest(format!("invalid date `{}` (expected YYYY-MM-DD)", req.date)))?;
    let end_date = match req.end_date.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => NaiveDate::parse_from_str(raw, "%Y-%m-%d")
            .map_err(|_| Error::BadRequest(format!("invalid end_date `{raw}`")))?
            .max(date),
        None => date,
    };

    if let Some(id) = req.id.as_deref().filter(|s| !s.is_empty()) {
        let (id, occ) = split_occurrence(id);
        let stored = stored_event(root, id).filter(|ev| ev.repeat != CalendarRecurrence::None);
        let asked = date;
        // an occurrence id (`<id>@YYYY-MM-DD`) edits a repeating series from one of its later days: the series start
        // moves by as much as that day was moved (not at all for a title or time change), and keeps its length
        let (date, end_date) = match (occ, &stored) {
            (Some(occ), Some(ev)) => {
                let start = shift_series_start(ev.date, occ, date, ev.repeat, ev.series.interval);
                (start, start + (end_date - date))
            }
            _ => (date, end_date),
        };
        // the editor does not send the series' interval, end or skipped days: keep the stored ones, moved with the start
        let mut kept = req.clone();
        if let Some(ev) = stored.filter(|ev| ev.repeat == req.repeat) {
            let moved = |d: NaiveDate| move_with_series(&ev, occ.unwrap_or(ev.date), asked, date, d).format("%Y-%m-%d").to_string();
            kept.interval = kept.interval.or(Some(ev.series.interval));
            kept.until = kept.until.or_else(|| ev.series.until.map(moved));
            kept.except = kept.except.or_else(|| Some(ev.series.except.iter().copied().map(moved).collect()));
        }
        let req = &kept;
        if let Some(rest) = id.strip_prefix("task:") {
            return reschedule_task(root, rest, date, title);
        }
        if let Some(rest) = id.strip_prefix("base:") {
            return reschedule_base_item(root, rest, date, title);
        }
        if let Some(rest) = id.strip_prefix("ds:") {
            return update_schedule_line(root, cfg, rest, date, title, req);
        }
        if let Some(rest) = id.strip_prefix("dm:") {
            return update_inline_fm_event(root, cfg, rest, date, end_date, req);
        }
        if let Some(rel) = id.strip_prefix("page:") {
            return write_event_page_in_dir(root, cfg, Some(rel), date, end_date, req);
        }
    }

    if req.storage.as_deref() == Some("page") || req.notes.as_deref().is_some_and(|n| !n.trim().is_empty()) {
        write_event_page_in_dir(root, cfg, None, date, end_date, req)
    } else {
        insert_inline_fm_event(root, cfg, date, end_date, req)
    }
}

/// `dm:…:0@2026-12-02` → (`dm:…:0`, that day); an id without a day suffix is returned as it is.
fn split_occurrence(id: &str) -> (&str, Option<NaiveDate>) {
    match id.rsplit_once('@') {
        Some((base, day)) if day.len() == 10 => match NaiveDate::parse_from_str(day, "%Y-%m-%d") {
            Ok(d) => (base, Some(d)),
            Err(_) => (id, None),
        },
        _ => (id, None),
    }
}

/// The stored inline event or event page `id`.
fn stored_event(root: &Path, id: &str) -> Option<RawEvent> {
    let rel = match id.strip_prefix("dm:") {
        Some(rest) => rest.rsplit_once(':')?.0,
        None => id.strip_prefix("page:")?,
    };
    let txt = std::fs::read_to_string(paths::safe_join(root, rel).ok()?).ok()?;
    let props = crate::note_props::Props::from_markdown(&txt);
    if id.starts_with("dm:") {
        parse_daily_frontmatter_events(rel, date_from_filename(rel)?, &props).into_iter().find(|e| e.id == id)
    } else {
        parse_event_page(rel, &props)
    }
}

/// The series start after its occurrence `occ` was moved to `to`. A daily or weekly series moves by the days moved; a
/// monthly or yearly one by the months moved, onto the day of the month it was dropped on, so that occurrence lands
/// exactly on `to` (the first month after that has the day, when the start's month has not).
fn shift_series_start(start: NaiveDate, occ: NaiveDate, to: NaiveDate, repeat: CalendarRecurrence, interval: u32) -> NaiveDate {
    if to == occ {
        return start;
    }
    let step = match repeat {
        CalendarRecurrence::Monthly => 1,
        CalendarRecurrence::Yearly => 12,
        _ => return start + (to - occ),
    } * i64::from(interval.max(1));
    let mut m = month_index(start) + month_index(to) - month_index(occ);
    for _ in 0..8 {
        if let Some(d) = from_month_index(m, to.day()) {
            return d;
        }
        m += step;
    }
    start + (to - occ)
}

/// Where the day `d` of the stored series `ev` goes once an occurrence moved from `occ` to `to` and the series starts on
/// `start`: a daily or weekly day by as many days; in a monthly or yearly series, the occurrence on or before `d` moves
/// as many months, onto the moved series' occurrence in that month.
fn move_with_series(ev: &RawEvent, occ: NaiveDate, to: NaiveDate, start: NaiveDate, d: NaiveDate) -> NaiveDate {
    if start == ev.date {
        return d;
    }
    let (repeat, iv) = (ev.repeat, ev.series.interval);
    let step = i64::from(iv.max(1))
        * match repeat {
            CalendarRecurrence::Monthly => 1,
            CalendarRecurrence::Yearly => 12,
            _ => return d + (start - ev.date),
        };
    let by_months = || {
        let old = nth_occurrence(ev.date, repeat, iv, occurrence_index(ev.date, repeat, iv, d)?)?;
        let m = month_index(old) + month_index(to) - month_index(occ) - month_index(start);
        (m >= 0 && m % step == 0).then_some(())?;
        nth_occurrence(start, repeat, iv, u64::try_from(m / step).ok()?)
    };
    by_months().unwrap_or(d + (start - ev.date))
}

fn event_to_yaml(date: NaiveDate, end_date: NaiveDate, req: &CalendarEventUpsert) -> Value {
    let mut m = serde_yaml::Mapping::new();
    m.insert("title".into(), req.title.trim().into());
    if end_date != date {
        m.insert("date".into(), date.format("%Y-%m-%d").to_string().into());
        m.insert("end_date".into(), end_date.format("%Y-%m-%d").to_string().into());
    }
    m.insert("all_day".into(), Value::Bool(req.all_day || req.start.is_none()));
    if !req.all_day {
        if let Some(s) = req.start.as_deref().and_then(parse_hm) {
            m.insert("start".into(), s.into());
        }
        if let Some(e) = req.end.as_deref().and_then(parse_hm) {
            m.insert("end".into(), e.into());
        }
    }
    if !req.color.trim().is_empty() {
        m.insert("color".into(), req.color.trim().into());
    }
    if !req.location.trim().is_empty() {
        m.insert("location".into(), req.location.trim().into());
    }
    if req.repeat != CalendarRecurrence::None {
        m.insert("repeat".into(), req.repeat.as_str().into());
    }
    for (k, v) in Series::from_req(req).props(req.repeat) {
        if let Some(v) = v {
            m.insert(k.into(), v);
        }
    }
    if !req.links.is_empty() {
        m.insert("links".into(), Value::Sequence(req.links.iter().map(|s| Value::String(s.clone())).collect()));
    }
    Value::Mapping(m)
}

fn insert_inline_fm_event(root: &Path, cfg: &Config, date: NaiveDate, end_date: NaiveDate, req: &CalendarEventUpsert) -> Result<CalendarEvent> {
    let now = chrono::Local::now().naive_local();
    let log = capture::ensure_day_log(root, cfg, date, now)?;
    let abs = paths::safe_join(root, &log.path)?;
    let mut new_idx = 0usize;
    let entry = event_to_yaml(date, end_date, req);
    vault_write::modify(&abs, |txt| {
        let props = crate::note_props::Props::from_markdown(txt);
        let mut seq = match props.get("events") {
            Some(Value::Sequence(s)) => s.clone(),
            _ => Vec::new(),
        };
        new_idx = seq.len();
        seq.push(entry);
        Ok(frontmatter::set_property(txt, "events", &Value::Sequence(seq)))
    })?;
    Ok(CalendarEvent {
        id: format!("dm:{}:{new_idx}", log.path),
        occurrence_id: format!("dm:{}:{new_idx}@{}", log.path, date.format("%Y-%m-%d")),
        title: req.title.trim().to_string(),
        date: date.format("%Y-%m-%d").to_string(),
        end_date: end_date.format("%Y-%m-%d").to_string(),
        start: if req.all_day { None } else { req.start.as_deref().and_then(parse_hm) },
        end: if req.all_day { None } else { req.end.as_deref().and_then(parse_hm) },
        all_day: req.all_day || req.start.is_none(),
        color: if req.color.trim().is_empty() { "blue".into() } else { req.color.trim().to_string() },
        location: req.location.trim().to_string(),
        repeat: req.repeat,
        links: req.links.clone(),
        source: CalendarSource::DailyFrontmatter,
        path: Some(log.path),
        line: None,
        completed: false,
        editable: true,
    })
}

fn update_inline_fm_event(
    root: &Path,
    cfg: &Config,
    rest: &str,
    date: NaiveDate,
    end_date: NaiveDate,
    req: &CalendarEventUpsert,
) -> Result<CalendarEvent> {
    let (rel, idx_s) = rest.rsplit_once(':').ok_or_else(|| Error::BadRequest("bad event id".into()))?;
    let idx: usize = idx_s.parse().map_err(|_| Error::BadRequest("bad event index".into()))?;
    let orig_day = date_from_filename(rel);
    if orig_day.is_some_and(|d| d != date) {
        delete_inline_fm_event(root, rest)?;
        return insert_inline_fm_event(root, cfg, date, end_date, req);
    }
    let abs = paths::safe_join(root, rel)?;
    let entry = event_to_yaml(date, end_date, req);
    vault_write::modify(&abs, |txt| {
        let props = crate::note_props::Props::from_markdown(txt);
        let mut seq = match props.get("events") {
            Some(Value::Sequence(s)) => s.clone(),
            _ => return Err(Error::NotFound("event entry not found".into())),
        };
        if idx >= seq.len() {
            return Err(Error::NotFound("event index out of bounds".into()));
        }
        seq[idx] = entry;
        Ok(frontmatter::set_property(txt, "events", &Value::Sequence(seq)))
    })?;
    Ok(CalendarEvent {
        id: format!("dm:{rel}:{idx}"),
        occurrence_id: format!("dm:{rel}:{idx}@{}", date.format("%Y-%m-%d")),
        title: req.title.trim().to_string(),
        date: date.format("%Y-%m-%d").to_string(),
        end_date: end_date.format("%Y-%m-%d").to_string(),
        start: if req.all_day { None } else { req.start.as_deref().and_then(parse_hm) },
        end: if req.all_day { None } else { req.end.as_deref().and_then(parse_hm) },
        all_day: req.all_day || req.start.is_none(),
        color: if req.color.trim().is_empty() { "blue".into() } else { req.color.trim().to_string() },
        location: req.location.trim().to_string(),
        repeat: req.repeat,
        links: req.links.clone(),
        source: CalendarSource::DailyFrontmatter,
        path: Some(rel.to_string()),
        line: None,
        completed: false,
        editable: true,
    })
}

fn delete_inline_fm_event(root: &Path, rest: &str) -> Result<String> {
    let (rel, idx_s) = rest.rsplit_once(':').ok_or_else(|| Error::BadRequest("bad event id".into()))?;
    let idx: usize = idx_s.parse().map_err(|_| Error::BadRequest("bad event index".into()))?;
    let abs = paths::safe_join(root, rel)?;
    vault_write::modify(&abs, |txt| {
        let props = crate::note_props::Props::from_markdown(txt);
        let mut seq = match props.get("events") {
            Some(Value::Sequence(s)) => s.clone(),
            _ => return Err(Error::NotFound("event entry not found".into())),
        };
        if idx >= seq.len() {
            return Err(Error::NotFound("event index out of bounds".into()));
        }
        seq.remove(idx);
        if seq.is_empty() {
            Ok(frontmatter::remove_property(txt, "events"))
        } else {
            Ok(frontmatter::set_property(txt, "events", &Value::Sequence(seq)))
        }
    })?;
    Ok(rel.to_string())
}

pub fn write_event_page_in_dir(
    root: &Path,
    cfg: &Config,
    existing_rel: Option<&str>,
    date: NaiveDate,
    end_date: NaiveDate,
    req: &CalendarEventUpsert,
) -> Result<CalendarEvent> {
    if let Some(r) = existing_rel {
        return write_event_page_at(root, r, true, date, end_date, req);
    }
    let dir = cfg.calendar.events_dir.trim().trim_matches('/');
    let stem = crate::notes::file_stem(req.title.trim());
    let stem = if stem.is_empty() { "Event".into() } else { stem };
    let base_name = format!("{} {stem}", date.format("%Y-%m-%d"));
    let body_seed = req
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("# {}\n\n{s}\n", req.title.trim()))
        .unwrap_or_else(|| format!("# {}\n", req.title.trim()));
    let text = build_event_page_markdown(&body_seed, date, end_date, req);
    let mut n = 1usize;
    let rel = loop {
        let cand = if n == 1 {
            if dir.is_empty() { format!("{base_name}.md") } else { format!("{dir}/{base_name}.md") }
        } else if dir.is_empty() {
            format!("{base_name} {n}.md")
        } else {
            format!("{dir}/{base_name} {n}.md")
        };
        let abs = paths::safe_join(root, &cand)?;
        if vault_write::create(&abs, text.as_bytes())? == vault_write::Created::New {
            break cand;
        }
        n += 1;
    };
    Ok(calendar_event_for_page(&rel, date, end_date, req))
}

fn build_event_page_markdown(initial: &str, date: NaiveDate, end_date: NaiveDate, req: &CalendarEventUpsert) -> String {
    let mut text = frontmatter::set_property(initial, "type", &"event".into());
    text = frontmatter::set_property(&text, "title", &req.title.trim().into());
    text = frontmatter::set_property(&text, "date", &date.format("%Y-%m-%d").to_string().into());
    if end_date != date {
        text = frontmatter::set_property(&text, "end_date", &end_date.format("%Y-%m-%d").to_string().into());
    } else {
        text = frontmatter::remove_property(&text, "end_date");
    }
    text = frontmatter::set_property(&text, "all_day", &Value::Bool(req.all_day || req.start.is_none()));
    if !req.all_day {
        if let Some(s) = req.start.as_deref().and_then(parse_hm) {
            text = frontmatter::set_property(&text, "start", &s.into());
        } else {
            text = frontmatter::remove_property(&text, "start");
        }
        if let Some(e) = req.end.as_deref().and_then(parse_hm) {
            text = frontmatter::set_property(&text, "end", &e.into());
        } else {
            text = frontmatter::remove_property(&text, "end");
        }
    } else {
        text = frontmatter::remove_property(&text, "start");
        text = frontmatter::remove_property(&text, "end");
    }
    if !req.color.trim().is_empty() {
        text = frontmatter::set_property(&text, "color", &req.color.trim().into());
    } else {
        text = frontmatter::remove_property(&text, "color");
    }
    if !req.location.trim().is_empty() {
        text = frontmatter::set_property(&text, "location", &req.location.trim().into());
    } else {
        text = frontmatter::remove_property(&text, "location");
    }
    if req.repeat != CalendarRecurrence::None {
        text = frontmatter::set_property(&text, "repeat", &req.repeat.as_str().into());
    } else {
        text = frontmatter::remove_property(&text, "repeat");
    }
    for (k, v) in Series::from_req(req).props(req.repeat) {
        text = match v {
            Some(v) => frontmatter::set_property(&text, k, &v),
            None => frontmatter::remove_property(&text, k),
        };
    }
    if !req.links.is_empty() {
        text = frontmatter::set_property(&text, "links", &Value::Sequence(req.links.iter().map(|s| Value::String(s.clone())).collect()));
    } else {
        text = frontmatter::remove_property(&text, "links");
    }
    text
}

fn write_event_page_at(root: &Path, rel: &str, expect_existing: bool, date: NaiveDate, end_date: NaiveDate, req: &CalendarEventUpsert) -> Result<CalendarEvent> {
    let abs = paths::safe_join(root, rel)?;
    if expect_existing {
        vault_write::locked(&abs, || {
            if !abs.is_file() {
                return Err(Error::NotFound("event page not found".into()));
            }
            let existing = std::fs::read_to_string(&abs)?;
            let next = build_event_page_markdown(&existing, date, end_date, req);
            if next != existing {
                vault_write::write(&abs, next.as_bytes())?;
            }
            Ok(())
        })?;
    } else {
        let body_seed = req.notes.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("# {}\n\n{s}\n", req.title.trim())).unwrap_or_else(|| format!("# {}\n", req.title.trim()));
        let text = build_event_page_markdown(&body_seed, date, end_date, req);
        vault_write::write(&abs, text.as_bytes())?;
    }
    Ok(calendar_event_for_page(rel, date, end_date, req))
}

fn calendar_event_for_page(rel: &str, date: NaiveDate, end_date: NaiveDate, req: &CalendarEventUpsert) -> CalendarEvent {
    CalendarEvent {
        id: format!("page:{rel}"),
        occurrence_id: format!("page:{rel}@{}", date.format("%Y-%m-%d")),
        title: req.title.trim().to_string(),
        date: date.format("%Y-%m-%d").to_string(),
        end_date: end_date.format("%Y-%m-%d").to_string(),
        start: if req.all_day { None } else { req.start.as_deref().and_then(parse_hm) },
        end: if req.all_day { None } else { req.end.as_deref().and_then(parse_hm) },
        all_day: req.all_day || req.start.is_none(),
        color: if req.color.trim().is_empty() { "blue".into() } else { req.color.trim().to_string() },
        location: req.location.trim().to_string(),
        repeat: req.repeat,
        links: req.links.clone(),
        source: CalendarSource::EventPage,
        path: Some(rel.to_string()),
        line: None,
        completed: false,
        editable: true,
    }
}

fn join_lines_preserving_eol(src: &str, lines: &[String]) -> String {
    let eol = if src.contains("\r\n") { "\r\n" } else { "\n" };
    let trailing = if src.is_empty() || src.ends_with('\n') { eol } else { "" };
    format!("{}{trailing}", lines.join(eol))
}

fn update_schedule_line(root: &Path, cfg: &Config, rest: &str, date: NaiveDate, title: &str, req: &CalendarEventUpsert) -> Result<CalendarEvent> {
    let (rel, line_s) = rest.rsplit_once(':').ok_or_else(|| Error::BadRequest("bad schedule id".into()))?;
    let line_no: usize = line_s.parse().map_err(|_| Error::BadRequest("bad line".into()))?;
    let abs = paths::safe_join(root, rel)?;
    let s_t = req.start.as_deref().and_then(parse_hm).unwrap_or_else(|| "09:00".into());
    let e_t = req.end.as_deref().and_then(parse_hm).unwrap_or_else(|| "10:00".into());
    let new_line = format!("- {s_t}–{e_t} {title}");
    let dest_rel = capture::day_log(cfg, date);
    let idx = line_no.checked_sub(1).ok_or_else(|| Error::BadRequest("bad line".into()))?;

    let (out_rel, out_line) = if dest_rel == rel {
        vault_write::modify(&abs, |txt| {
            let mut lines: Vec<String> = txt.lines().map(String::from).collect();
            if idx >= lines.len() {
                return Err(Error::NotFound("line not found".into()));
            }
            lines[idx] = new_line.clone();
            Ok(join_lines_preserving_eol(txt, &lines))
        })?;
        (rel.to_string(), line_no)
    } else {
        let now = chrono::Local::now().naive_local();
        let dest = capture::ensure_day_log(root, cfg, date, now)?;
        let dest_abs = paths::safe_join(root, &dest.path)?;
        let mut inserted_line = 1usize;
        vault_write::modify(&dest_abs, |txt| {
            let mut lines: Vec<String> = txt.lines().map(String::from).collect();
            lines.push(new_line.clone());
            inserted_line = lines.len();
            Ok(join_lines_preserving_eol(txt, &lines))
        })?;
        if let Err(e) = vault_write::modify(&abs, |txt| {
            let mut lines: Vec<String> = txt.lines().map(String::from).collect();
            if idx >= lines.len() {
                return Err(Error::NotFound("line not found".into()));
            }
            lines.remove(idx);
            Ok(join_lines_preserving_eol(txt, &lines))
        }) {
            // Roll back appended line on destination if source deletion failed.
            let _ = vault_write::modify(&dest_abs, |txt| {
                let mut lines: Vec<String> = txt.lines().map(String::from).collect();
                if lines.last().is_some_and(|l| l == &new_line) {
                    lines.pop();
                }
                Ok(join_lines_preserving_eol(txt, &lines))
            });
            return Err(e);
        }
        (dest.path, inserted_line)
    };
    let out_date = date.format("%Y-%m-%d").to_string();
    Ok(CalendarEvent {
        id: format!("ds:{out_rel}:{out_line}"),
        occurrence_id: format!("ds:{out_rel}:{out_line}@{out_date}"),
        title: title.to_string(),
        date: out_date.clone(),
        end_date: out_date,
        start: Some(s_t),
        end: Some(e_t),
        all_day: false,
        color: "green".into(),
        location: String::new(),
        repeat: CalendarRecurrence::None,
        links: Vec::new(),
        source: CalendarSource::DailySchedule,
        path: Some(out_rel),
        line: Some(out_line as u32),
        completed: false,
        editable: true,
    })
}

/// Where the date the calendar shows a task on (`Task::date`) is written: the date on the line whose swap for a probe
/// changes only that field, so a created or done date, or a date in the title, is never taken for it.
fn task_date_range(line: &str) -> Option<std::ops::Range<usize>> {
    let parse = |l: &str| crate::today::task_lines(std::iter::once(l)).next().map(|(_, body, _)| crate::tasks::parse(body));
    let old = parse(line)?;
    let probe = NaiveDate::from_ymd_opt(1000, 1, 1)?;
    let mut want = old.clone();
    if old.due.is_some() {
        want.due = Some(probe);
    } else if old.scheduled.is_some() {
        want.scheduled = Some(probe);
    } else if old.start.is_some() {
        want.start = Some(probe);
    } else {
        return None;
    }
    let mut from = 0;
    while let Some((_, i)) = crate::tasks::first_date(&line[from..]) {
        let at = from + i;
        if parse(&format!("{}{probe}{}", &line[..at], &line[at + 10..])).as_ref() == Some(&want) {
            return Some(at..at + 10);
        }
        from = at + 10;
    }
    None
}

fn reschedule_task(root: &Path, rest: &str, date: NaiveDate, title: &str) -> Result<CalendarEvent> {
    let (rel, line_s) = rest.rsplit_once(':').ok_or_else(|| Error::BadRequest("bad task id".into()))?;
    let line_no: usize = line_s.parse().map_err(|_| Error::BadRequest("bad line".into()))?;
    let abs = paths::safe_join(root, rel)?;
    let new_d = date.format("%Y-%m-%d").to_string();
    let mut parsed: Option<(String, bool)> = None;
    vault_write::modify(&abs, |txt| {
        let mut lines: Vec<String> = txt.lines().map(String::from).collect();
        let idx = line_no.checked_sub(1).ok_or_else(|| Error::BadRequest("bad line".into()))?;
        if idx >= lines.len() {
            return Err(Error::NotFound("task line not found".into()));
        }
        let updated = {
            let line = &lines[idx];
            if let Some(r) = task_date_range(line) {
                format!("{}{new_d}{}", &line[..r.start], &line[r.end..])
            } else {
                format!("{} 📅 {new_d}", line.trim_end())
            }
        };
        if let Some((_, body, done)) = crate::today::task_lines(std::iter::once(updated.as_str())).next() {
            let t = crate::tasks::parse(body);
            let task_title = if t.title.is_empty() { title.to_string() } else { t.title };
            parsed = Some((task_title, done));
        }
        lines[idx] = updated;
        Ok(join_lines_preserving_eol(txt, &lines))
    })?;
    let (actual_title, completed) = parsed.unwrap_or_else(|| (title.to_string(), false));
    Ok(CalendarEvent {
        id: format!("task:{rel}:{line_no}"),
        occurrence_id: format!("task:{rel}:{line_no}@{new_d}"),
        title: actual_title,
        date: new_d.clone(),
        end_date: new_d,
        start: None,
        end: None,
        all_day: true,
        color: "amber".into(),
        location: String::new(),
        repeat: CalendarRecurrence::None,
        links: Vec::new(),
        source: CalendarSource::Task,
        path: Some(rel.to_string()),
        line: Some(line_no as u32),
        completed,
        editable: true,
    })
}

fn reschedule_base_item(root: &Path, rest: &str, date: NaiveDate, _title: &str) -> Result<CalendarEvent> {
    let parts: Vec<&str> = rest.splitn(3, ':').collect();
    if parts.len() != 3 {
        return Err(Error::BadRequest("bad base item id".into()));
    }
    let (base_rel, col_key, note_rel) = (parts[0], parts[1], parts[2]);
    let abs = paths::safe_join(root, note_rel)?;
    let new_d = date.format("%Y-%m-%d").to_string();
    vault_write::locked(&abs, || {
        if !abs.is_file() {
            return Err(Error::NotFound("base item note not found".into()));
        }
        let txt = std::fs::read_to_string(&abs)?;
        let next = frontmatter::set_property(&txt, col_key, &new_d.clone().into());
        if next != txt {
            vault_write::write(&abs, next.as_bytes())?;
        }
        Ok(())
    })?;
    let actual_title = note_rel.rsplit('/').next().unwrap_or(note_rel).trim_end_matches(".md").to_string();
    Ok(CalendarEvent {
        id: format!("base:{base_rel}:{col_key}:{note_rel}"),
        occurrence_id: format!("base:{base_rel}:{col_key}:{note_rel}@{new_d}"),
        title: actual_title.clone(),
        date: new_d.clone(),
        end_date: new_d,
        start: None,
        end: None,
        all_day: true,
        color: "purple".into(),
        location: String::new(),
        repeat: CalendarRecurrence::None,
        links: vec![format!("[[{actual_title}]]")],
        source: CalendarSource::Base,
        path: Some(note_rel.to_string()),
        line: None,
        completed: false,
        editable: true,
    })
}

pub fn upsert_event_with_dir(root: &Path, cfg: &Config, req: &CalendarEventUpsert) -> Result<CalendarEvent> {
    if req.id.is_none() && (req.storage.as_deref() == Some("page") || req.notes.as_deref().is_some_and(|n| !n.trim().is_empty())) {
        let date = NaiveDate::parse_from_str(req.date.trim(), "%Y-%m-%d")
            .map_err(|_| Error::BadRequest(format!("invalid date `{}`", req.date)))?;
        let end_date = req.end_date.as_deref().map(str::trim).filter(|s| !s.is_empty()).and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()).map_or(date, |d| d.max(date));
        return write_event_page_in_dir(root, cfg, None, date, end_date, req);
    }
    upsert_event(root, cfg, req)
}

pub fn delete_event(root: &Path, id: &str) -> Result<Vec<String>> {
    if let Some(rel) = id.strip_prefix("page:") {
        let abs = paths::safe_join(root, rel)?;
        if abs.exists() {
            vault_write::remove_file(&abs)?;
            return Ok(vec![rel.to_string()]);
        }
        return Err(Error::NotFound("event page not found".into()));
    }
    if let Some(rest) = id.strip_prefix("dm:") {
        return Ok(vec![delete_inline_fm_event(root, rest)?]);
    }
    if let Some(rest) = id.strip_prefix("ds:") {
        let (rel, line_s) = rest.rsplit_once(':').ok_or_else(|| Error::BadRequest("bad id".into()))?;
        let line_no: usize = line_s.parse().map_err(|_| Error::BadRequest("bad line".into()))?;
        let abs = paths::safe_join(root, rel)?;
        vault_write::modify(&abs, |txt| {
            let mut lines: Vec<String> = txt.lines().map(String::from).collect();
            let idx = line_no.checked_sub(1).ok_or_else(|| Error::BadRequest("bad line".into()))?;
            if idx >= lines.len() {
                return Err(Error::NotFound("line not found".into()));
            }
            lines.remove(idx);
            Ok(join_lines_preserving_eol(txt, &lines))
        })?;
        return Ok(vec![rel.to_string()]);
    }
    Err(Error::BadRequest("this calendar source cannot be deleted from Calendar".into()))
}

pub fn promote_inline_to_page(root: &Path, cfg: &Config, id: &str) -> Result<CalendarPromoteResult> {
    let raw = collect_raw_events(root, cfg)
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| Error::NotFound("event not found".into()))?;
    let req = CalendarEventUpsert {
        id: None,
        storage: Some("page".into()),
        title: raw.title.clone(),
        date: raw.date.format("%Y-%m-%d").to_string(),
        end_date: (raw.end_date != raw.date).then(|| raw.end_date.format("%Y-%m-%d").to_string()),
        start: raw.start.clone(),
        end: raw.end.clone(),
        all_day: raw.all_day,
        color: raw.color.clone(),
        location: raw.location.clone(),
        repeat: raw.repeat,
        interval: Some(raw.series.interval),
        until: raw.series.until.map(|d| d.format("%Y-%m-%d").to_string()),
        except: Some(raw.series.except.iter().map(|d| d.format("%Y-%m-%d").to_string()).collect()),
        links: raw.links.clone(),
        notes: None,
    };
    let ev = write_event_page_in_dir(root, cfg, None, raw.date, raw.end_date, &req)?;
    if let Err(e) = delete_event(root, id) {
        if let Some(rel) = &ev.path {
            if let Ok(p) = paths::safe_join(root, rel) {
                let _ = vault_write::remove_file(&p);
            }
        }
        return Err(e);
    }
    let path = ev.path.clone().unwrap_or_default();
    Ok(CalendarPromoteResult { path, event: ev })
}

/// A UTC time (`…T130000Z`) is shown in `tz`; a time without the `Z` is floating and read as written (`export_ics`
/// writes those). A `TZID` time is read as floating too.
fn parse_ics_dt_in<Tz: TimeZone>(val: &str, tz: &Tz) -> (Option<NaiveDate>, Option<String>, bool) {
    let val = val.trim();
    let (clean, utc) = match val.strip_suffix(['Z', 'z']) {
        Some(c) => (c, true),
        None => (val, false),
    };
    if clean.len() == 8 {
        let d = NaiveDate::parse_from_str(clean, "%Y%m%d").ok();
        return (d, None, true);
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(clean, "%Y%m%dT%H%M%S") {
        let dt = if utc { tz.from_utc_datetime(&dt).naive_local() } else { dt };
        return (Some(dt.date()), Some(dt.format("%H:%M").to_string()), false);
    }
    (None, None, false)
}

/// How many periods of a rule are walked at most to find the day its `COUNT` ends on.
const ICS_RULE_PERIODS: u64 = 100_000;

const ICS_WEEKDAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/// The days an RRULE makes from `start`, in order, in the frame `start` is written in: every `interval`-th period, on
/// the weekdays `days` (Monday = 0) of a weekly rule, and never on a day of the month that a month or year lacks.
fn ics_rule_dates(start: NaiveDate, freq: CalendarRecurrence, interval: u32, days: &[u32], wkst: u32) -> impl Iterator<Item = NaiveDate> {
    let week0 = start - Duration::days(i64::from((start.weekday().num_days_from_monday() + 7 - wkst) % 7));
    let mut offsets: Vec<u64> = days.iter().map(|d| u64::from((d + 7 - wkst) % 7)).collect();
    offsets.sort_unstable();
    offsets.dedup();
    (0..ICS_RULE_PERIODS)
        .flat_map(move |k| {
            let n = k * u64::from(interval);
            match freq {
                CalendarRecurrence::Weekly => offsets.iter().filter_map(|o| week0.checked_add_days(Days::new(n * 7 + o))).collect(),
                _ => nth_occurrence(start, freq, 1, n).filter(|d| d.day() == start.day() || freq == CalendarRecurrence::Daily).into_iter().collect::<Vec<_>>(),
            }
        })
        .filter(move |d| *d >= start)
}

/// An `RRULE` as repeating events in the frame `start` is written in (`day` reads an UNTIL in it): (first day, repeat,
/// series), one per weekday of a weekly rule (`BYDAY=MO,WE` gives two), a `COUNT` as the day of the last occurrence, and
/// the `EXDATE`s it skips. A part the model cannot say (`BYDAY=2TU`, `BYSETPOS`) is dropped, so such a rule repeats at
/// its plain frequency.
fn ics_series(
    rule: Option<&str>,
    exdates: &[NaiveDate],
    start: NaiveDate,
    day: impl Fn(&str) -> Option<NaiveDate>,
) -> Vec<(NaiveDate, CalendarRecurrence, Series)> {
    let once = vec![(start, CalendarRecurrence::None, Series::default())];
    let Some(rule) = rule else { return once };
    let parts: BTreeMap<String, String> = rule
        .split(';')
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.trim().to_ascii_uppercase(), v.trim().to_ascii_uppercase()))
        .collect();
    let freq = match parts.get("FREQ").map(String::as_str) {
        Some("DAILY") => CalendarRecurrence::Daily,
        Some("WEEKLY") => CalendarRecurrence::Weekly,
        Some("MONTHLY") => CalendarRecurrence::Monthly,
        Some("YEARLY") => CalendarRecurrence::Yearly,
        _ => return once,
    };
    let interval = parts.get("INTERVAL").and_then(|v| v.parse::<u32>().ok()).filter(|&i| i > 0).unwrap_or(1);
    let weekday = |s: &str| ICS_WEEKDAYS.iter().position(|w| *w == s.trim()).map(|i| i as u32);
    let wkst = parts.get("WKST").and_then(|v| weekday(v)).unwrap_or(0);
    // plain weekdays only; `FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR` is weekly on those days
    let byday = parts.get("BYDAY").and_then(|v| v.split(',').map(weekday).collect::<Option<Vec<u32>>>());
    let (freq, days) = match byday {
        Some(d) if freq == CalendarRecurrence::Weekly || (freq == CalendarRecurrence::Daily && interval == 1) => (CalendarRecurrence::Weekly, d),
        _ => (freq, vec![start.weekday().num_days_from_monday()]),
    };
    let until = parts.get("UNTIL").and_then(|v| day(v));
    let last = match parts.get("COUNT").and_then(|v| v.parse::<usize>().ok()) {
        Some(n) => match ics_rule_dates(start, freq, interval, &days, wkst).take_while(|d| until.is_none_or(|u| *d <= u)).take(n).last() {
            Some(l) => Some(l),
            None => return once,
        },
        None => until,
    };
    let out: Vec<_> = days
        .iter()
        .filter_map(|&day| {
            let first = ics_rule_dates(start, freq, interval, &[day], wkst).next()?;
            if last.is_some_and(|l| first > l) {
                return None;
            }
            let except = exdates
                .iter()
                .copied()
                .filter(|&e| e >= first && last.is_none_or(|l| e <= l) && (freq != CalendarRecurrence::Weekly || e.weekday() == first.weekday()))
                .collect();
            Some((first, freq, Series { interval, until: last, except }))
        })
        .collect();
    if out.is_empty() {
        once
    } else {
        out
    }
}

fn parse_ics_events(src: &str) -> Vec<RawEvent> {
    parse_ics_events_in(src, &chrono::Local)
}

fn parse_ics_events_in<Tz: TimeZone>(src: &str, tz: &Tz) -> Vec<RawEvent> {
    let unfolded = ical::unfold(src);
    let mut out = Vec::new();
    let mut in_event = false;
    // inside a component nested in the event (a VALARM): its SUMMARY or DESCRIPTION is not the event's
    let mut nested = 0usize;
    let mut map: BTreeMap<String, String> = BTreeMap::new();
    for raw in unfolded.lines() {
        let Some(line) = Line::parse(raw.trim()) else { continue };
        match line.name.as_str() {
            "BEGIN" if line.value.eq_ignore_ascii_case("VEVENT") => {
                in_event = true;
                nested = 0;
                map.clear();
            }
            "BEGIN" if in_event => nested += 1,
            // before the nested END: a sub-component left open still ends with its event
            "END" if line.value.eq_ignore_ascii_case("VEVENT") => {
                if in_event {
                    out.extend(ics_vevent(&map, tz));
                }
                in_event = false;
                nested = 0;
                map.clear();
            }
            "END" if in_event && nested > 0 => nested -= 1,
            // every EXDATE line counts, and each may list several dates
            "EXDATE" if in_event && nested == 0 => {
                let v = map.entry("EXDATE".into()).or_default();
                if !v.is_empty() {
                    v.push(',');
                }
                v.push_str(&line.value);
            }
            key if in_event && nested == 0 => {
                map.insert(key.to_string(), line.value);
            }
            _ => {}
        }
    }
    out
}

/// The events of one VEVENT's properties: one, or one per weekday of a weekly rule.
fn ics_vevent<Tz: TimeZone>(map: &BTreeMap<String, String>, tz: &Tz) -> Vec<RawEvent> {
    let (sd, st, all_day) = map.get("DTSTART").map_or((None, None, true), |v| parse_ics_dt_in(v, tz));
    let (ed, et, _) = map.get("DTEND").map_or((None, None, true), |v| parse_ics_dt_in(v, tz));
    let title = map.get("SUMMARY").map(|s| ical::unescape(s)).unwrap_or_default();
    let Some(d) = sd.filter(|_| !title.is_empty()) else { return Vec::new() };
    let end_date = ed.map(|x| if all_day && x > d { x - Duration::days(1) } else { x }).unwrap_or(d).max(d);
    // the rule's days, UNTIL and EXDATEs are read in DTSTART's own frame: UTC for a `Z` time, then all moved to the
    // shown day together; for a floating or TZID time the shown frame itself, where a `Z` UNTIL is converted
    let dtstart_utc = map.get("DTSTART").is_some_and(|v| v.trim().ends_with(['Z', 'z']));
    let read = |v: &str| if dtstart_utc { parse_ics_dt_in(v, &chrono::Utc).0 } else { parse_ics_dt_in(v, tz).0 };
    let written = if dtstart_utc { map.get("DTSTART").and_then(|v| read(v)).unwrap_or(d) } else { d };
    let shift = d - written;
    let exdates: Vec<NaiveDate> = map.get("EXDATE").into_iter().flat_map(|v| v.split(',')).filter_map(read).collect();
    let ev = RawEvent {
        id: String::new(),
        title,
        date: d,
        end_date,
        start: if all_day { None } else { st },
        end: if all_day { None } else { et },
        all_day,
        color: "blue".into(),
        location: map.get("LOCATION").map(|s| ical::unescape(s)).unwrap_or_default(),
        repeat: CalendarRecurrence::None,
        series: Series::default(),
        links: Vec::new(),
        source: CalendarSource::Ics,
        path: None,
        line: None,
        completed: false,
        editable: false,
    };
    ics_series(map.get("RRULE").map(String::as_str), &exdates, written, read)
        .into_iter()
        .map(|(first, repeat, s)| {
            let at = first + shift;
            let series = Series { until: s.until.map(|u| u + shift), except: s.except.iter().map(|&e| e + shift).collect(), ..s };
            RawEvent { date: at, end_date: at + (end_date - d), repeat, series, ..ev.clone() }
        })
        .collect()
}

pub fn import_ics(root: &Path, cfg: &Config, req: &IcsImportRequest) -> Result<IcsImportResult> {
    let as_pages = req.as_pages.unwrap_or(true);
    let parsed = parse_ics_events(&req.ics);
    let mut paths = Vec::new();
    let day = |d: NaiveDate| d.format("%Y-%m-%d").to_string();
    for ev in parsed {
        // a whole series is one event with its interval, end and skipped days, never a page per occurrence
        let up = CalendarEventUpsert {
            id: None,
            storage: Some(if as_pages { "page" } else { "inline" }.into()),
            title: ev.title,
            date: day(ev.date),
            end_date: (ev.end_date != ev.date).then(|| day(ev.end_date)),
            start: ev.start,
            end: ev.end,
            all_day: ev.all_day,
            color: ev.color,
            location: ev.location,
            repeat: ev.repeat,
            interval: Some(ev.series.interval),
            until: ev.series.until.map(day),
            except: Some(ev.series.except.into_iter().map(day).collect()),
            links: Vec::new(),
            notes: None,
        };
        let created = upsert_event(root, cfg, &up)?;
        if let Some(p) = created.path {
            paths.push(p);
        }
    }
    Ok(IcsImportResult { imported: paths.len() as u32, paths })
}

pub fn export_ics(root: &Path, cfg: &Config) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Kandinsky//Native Calendar//EN".to_string(),
    ];
    for ev in collect_raw_events(root, cfg) {
        if matches!(ev.source, CalendarSource::Task | CalendarSource::Ics) {
            continue;
        }
        lines.push("BEGIN:VEVENT".into());
        lines.push(ical::fold(&format!("UID:{}", ev.id.replace(':', "-"))));
        if ev.all_day {
            lines.push(format!("DTSTART;VALUE=DATE:{}", ev.date.format("%Y%m%d")));
            lines.push(format!("DTEND;VALUE=DATE:{}", (ev.end_date + Duration::days(1)).format("%Y%m%d")));
        } else {
            let st = ev.start.as_deref().unwrap_or("09:00").replace(':', "");
            let et = ev.end.as_deref().unwrap_or("10:00").replace(':', "");
            lines.push(format!("DTSTART:{}T{st}00", ev.date.format("%Y%m%d")));
            lines.push(format!("DTEND:{}T{et}00", ev.end_date.format("%Y%m%d")));
        }
        lines.push(ical::fold(&format!("SUMMARY:{}", ical::escape(&ev.title))));
        if !ev.location.is_empty() {
            lines.push(ical::fold(&format!("LOCATION:{}", ical::escape(&ev.location))));
        }
        if ev.repeat != CalendarRecurrence::None {
            let s = &ev.series;
            // UNTIL and EXDATE take the form of DTSTART: a date, or a floating time
            let at = |d: &NaiveDate| match ev.all_day {
                true => d.format("%Y%m%d").to_string(),
                false => format!("{}T{}00", d.format("%Y%m%d"), ev.start.as_deref().unwrap_or("09:00").replace(':', "")),
            };
            let mut rule = format!("RRULE:FREQ={}", ev.repeat.as_str().to_ascii_uppercase());
            if s.interval > 1 {
                rule.push_str(&format!(";INTERVAL={}", s.interval));
            }
            if let Some(u) = s.until {
                rule.push_str(&format!(";UNTIL={}", if ev.all_day { at(&u) } else { format!("{}T235959", u.format("%Y%m%d")) }));
            }
            lines.push(rule);
            if !s.except.is_empty() {
                let days = s.except.iter().map(at).collect::<Vec<_>>().join(",");
                lines.push(ical::fold(&format!("EXDATE{}:{days}", if ev.all_day { ";VALUE=DATE" } else { "" })));
            }
        }
        lines.push("END:VEVENT".into());
    }
    lines.push("END:VCALENDAR".into());
    format!("{}\r\n", lines.join("\r\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inline_event_creates_and_promotes_to_event_page_and_roundtrips_ics() {
        let d = tempfile::tempdir().unwrap();
        let cfg = Config::default();
        let up = CalendarEventUpsert {
            id: None,
            storage: Some("inline".into()),
            title: "Colloquium".into(),
            date: "2026-11-18".into(),
            end_date: None,
            start: Some("14:00".into()),
            end: Some("15:30".into()),
            all_day: false,
            color: "blue".into(),
            location: "Room 301".into(),
            repeat: CalendarRecurrence::Weekly,
            interval: None,
            until: None,
            except: None,
            links: vec!["[[Lab]]".into()],
            notes: None,
        };
        let created = upsert_event(d.path(), &cfg, &up).unwrap();
        assert!(created.id.starts_with("dm:"), "{created:?}");
        let from = NaiveDate::from_ymd_opt(2026, 11, 16).unwrap();
        let to = NaiveDate::from_ymd_opt(2026, 11, 30).unwrap();
        let range = query_range(d.path(), &cfg, from, to).unwrap();
        let hits: Vec<_> = range.events.iter().filter(|e| e.title == "Colloquium").collect();
        assert_eq!(hits.len(), 2, "weekly recurrence expands across 2 weeks: {hits:?}");

        let promoted = promote_inline_to_page(d.path(), &cfg, &created.id).unwrap();
        assert!(promoted.path.starts_with("events/2026-11-18 Colloquium"), "{promoted:?}");
        assert!(d.path().join(&promoted.path).is_file());

        let ics = export_ics(d.path(), &cfg);
        assert!(ics.contains("SUMMARY:Colloquium") && ics.contains("RRULE:FREQ=WEEKLY"), "{ics}");
        let imp_dir = tempfile::tempdir().unwrap();
        let imp = import_ics(imp_dir.path(), &cfg, &IcsImportRequest { ics, as_pages: Some(true) }).unwrap();
        assert_eq!(imp.imported, 1);
    }

    #[test]
    fn meaningful_content_ignores_prose_events_and_ds_move_preserves_crlf() {
        let d = tempfile::tempdir().unwrap();
        let cfg = Config::default();
        assert!(!note_has_meaningful_content("# 2026-11-18\n\n"));
        assert!(note_has_meaningful_content("# 2026-11-18\n\nNotes here\n"));
        assert!(!note_has_meaningful_content("---\ntags: [log]\n---\n# 2026-11-18\n"));
        // Empty frontmatter sequence + heading only -> not meaningful
        assert!(!note_has_meaningful_content("---\nevents: []\n---\n# 2026-11-18\n"));
        // Real frontmatter events entry -> meaningful
        assert!(note_has_meaningful_content("---\nevents:\n  - title: Sync\n---\n# 2026-11-18\n"));

        // Seed a CRLF daily note with a schedule item and move it to the next day.
        let src_log = capture::day_log(&cfg, NaiveDate::from_ymd_opt(2026, 11, 18).unwrap());
        let src_abs = d.path().join(&src_log);
        std::fs::create_dir_all(src_abs.parent().unwrap()).unwrap();
        std::fs::write(&src_abs, "# 2026-11-18\r\n- 09:00–10:00 Standup\r\n").unwrap();

        let moved = upsert_event(
            d.path(),
            &cfg,
            &CalendarEventUpsert {
                id: Some(format!("ds:{src_log}:2")),
                storage: None,
                title: "Standup".into(),
                date: "2026-11-19".into(),
                end_date: None,
                start: Some("10:00".into()),
                end: Some("11:00".into()),
                all_day: false,
                color: "green".into(),
                location: String::new(),
                repeat: CalendarRecurrence::None,
                interval: None,
                until: None,
                except: None,
                links: Vec::new(),
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(moved.date, "2026-11-19");
        let old_txt = std::fs::read_to_string(&src_abs).unwrap();
        assert_eq!(old_txt, "# 2026-11-18\r\n");
        let new_abs = d.path().join(moved.path.as_deref().unwrap());
        let new_txt = std::fs::read_to_string(new_abs).unwrap();
        assert!(new_txt.contains("- 10:00–11:00 Standup"), "{new_txt}");

        // Custom bases filter overrides cfg.calendar.bases (even empty slice omits bases).
        let empty = query_range_with_bases(
            d.path(),
            &cfg,
            NaiveDate::from_ymd_opt(2026, 11, 18).unwrap(),
            NaiveDate::from_ymd_opt(2026, 11, 20).unwrap(),
            Some(&[]),
        )
        .unwrap();
        assert!(empty.events.iter().any(|e| e.title == "Standup"));
    }

    #[test]
    fn missing_event_page_returns_not_found_and_reschedule_keeps_real_fields() {
        let d = tempfile::tempdir().unwrap();
        let cfg = Config::default();
        let err = upsert_event(
            d.path(),
            &cfg,
            &CalendarEventUpsert {
                id: Some("page:events/missing.md".into()),
                storage: None,
                title: "Missing".into(),
                date: "2026-11-20".into(),
                end_date: None,
                start: None,
                end: None,
                all_day: true,
                color: "blue".into(),
                location: String::new(),
                repeat: CalendarRecurrence::None,
                interval: None,
                until: None,
                except: None,
                links: Vec::new(),
                notes: None,
            },
        )
        .unwrap_err();
        assert!(matches!(err, Error::NotFound(_)), "{err:?}");

        std::fs::write(d.path().join("todo.md"), "- [x] Submit abstract 📅 2026-11-18\n").unwrap();
        let moved_task = upsert_event(
            d.path(),
            &cfg,
            &CalendarEventUpsert {
                id: Some("task:todo.md:1".into()),
                storage: None,
                title: "Client stale title".into(),
                date: "2026-11-21".into(),
                end_date: None,
                start: None,
                end: None,
                all_day: true,
                color: "amber".into(),
                location: String::new(),
                repeat: CalendarRecurrence::None,
                interval: None,
                until: None,
                except: None,
                links: Vec::new(),
                notes: None,
            },
        )
        .unwrap();
        assert!(moved_task.completed, "completed task flag must survive reschedule");
        assert_eq!(moved_task.title, "Submit abstract");

        std::fs::write(d.path().join("Real Note.md"), "---\ndue: 2026-11-18\n---\nbody\n").unwrap();
        let moved_base = upsert_event(
            d.path(),
            &cfg,
            &CalendarEventUpsert {
                id: Some("base:Tasks.base:due:Real Note.md".into()),
                storage: None,
                title: "Stale client base title".into(),
                date: "2026-11-22".into(),
                end_date: None,
                start: None,
                end: None,
                all_day: true,
                color: "purple".into(),
                location: String::new(),
                repeat: CalendarRecurrence::None,
                interval: None,
                until: None,
                except: None,
                links: Vec::new(),
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(moved_base.title, "Real Note");
    }

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn event_req(id: &str, title: &str, date: &str, repeat: CalendarRecurrence) -> CalendarEventUpsert {
        CalendarEventUpsert {
            id: Some(id.into()).filter(|s: &String| !s.is_empty()),
            storage: Some("inline".into()),
            title: title.into(),
            date: date.into(),
            end_date: None,
            start: Some("14:00".into()),
            end: Some("15:00".into()),
            all_day: false,
            color: "blue".into(),
            location: String::new(),
            repeat,
            interval: None,
            until: None,
            except: None,
            links: Vec::new(),
            notes: None,
        }
    }

    #[test]
    fn rescheduling_a_task_moves_the_date_the_calendar_shows() {
        let moved = |line: &str| {
            let r = task_date_range(line).expect("a date");
            format!("{}2026-11-22{}", &line[..r.start], &line[r.end..])
        };
        // the created, scheduled or a title date before the due date stays as it is
        assert_eq!(moved("- [ ] Write report ➕ 2026-11-01 📅 2026-11-20"), "- [ ] Write report ➕ 2026-11-01 📅 2026-11-22");
        assert_eq!(moved("- [ ] Plan ⏳ 2026-11-10 📅 2026-11-20"), "- [ ] Plan ⏳ 2026-11-10 📅 2026-11-22");
        assert_eq!(moved("- [ ] Call ➕ 2026-11-01 @2026-11-20"), "- [ ] Call ➕ 2026-11-01 @2026-11-22");
        assert_eq!(moved("- [ ] Review 2026-10-01 minutes 📅 2026-11-20"), "- [ ] Review 2026-10-01 minutes 📅 2026-11-22");
        // no due date: the scheduled one, then the start one
        assert_eq!(moved("- [ ] Read ➕ 2026-11-01 🛫 2026-11-05 ⏳ 2026-11-20"), "- [ ] Read ➕ 2026-11-01 🛫 2026-11-05 ⏳ 2026-11-22");
        assert_eq!(moved("- [x] Read ➕ 2026-11-01 🛫 2026-11-20 ✅ 2026-11-21"), "- [x] Read ➕ 2026-11-01 🛫 2026-11-22 ✅ 2026-11-21");
        for line in ["- [ ] Write report ➕ 2026-11-01 📅 2026-11-20", "- [ ] Plan ⏳ 2026-11-10 📅 2026-11-20"] {
            let body = crate::today::task_lines(std::iter::once(moved(line).as_str())).next().unwrap().1.to_string();
            assert_eq!(crate::tasks::parse(&body).date(), Some(day("2026-11-22")), "{line}");
        }
        // only a created date: no date the calendar shows, so one is added
        assert_eq!(task_date_range("- [ ] Idea ➕ 2026-11-01"), None);

        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("todo.md"), "- [ ] Write report ➕ 2026-11-01 📅 2026-11-20\n").unwrap();
        let mut req = event_req("task:todo.md:1", "Write report", "2026-11-22", CalendarRecurrence::None);
        req.storage = None;
        upsert_event(d.path(), &Config::default(), &req).unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join("todo.md")).unwrap(), "- [ ] Write report ➕ 2026-11-01 📅 2026-11-22\n");
    }

    fn raw(date: &str, end: &str, repeat: CalendarRecurrence) -> RawEvent {
        RawEvent {
            id: "page:e.md".into(),
            title: "E".into(),
            date: day(date),
            end_date: day(end),
            start: None,
            end: None,
            all_day: true,
            color: "blue".into(),
            location: String::new(),
            repeat,
            series: Series::default(),
            links: Vec::new(),
            source: CalendarSource::EventPage,
            path: None,
            line: None,
            completed: false,
            editable: true,
        }
    }

    fn shown(ev: &RawEvent, from: &str, to: &str) -> Vec<String> {
        let mut out = Vec::new();
        expand_event(ev, day(from), day(to), &mut out);
        out.into_iter().map(|e| e.date).collect()
    }

    #[test]
    fn a_long_running_series_still_shows_in_a_late_window() {
        let daily = shown(&raw("2025-09-01", "2025-09-01", CalendarRecurrence::Daily), "2026-10-26", "2026-12-06");
        assert_eq!((daily.len(), daily[0].as_str(), daily[41].as_str()), (42, "2026-10-26", "2026-12-06"));
        // a weekly series keeps its weekday (2016-11-02 is a Wednesday)
        let weekly = shown(&raw("2016-11-02", "2016-11-02", CalendarRecurrence::Weekly), "2026-11-01", "2026-11-30");
        assert_eq!(weekly, ["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
        // the 31st stays the 31st where the month has one
        let monthly = shown(&raw("2020-01-31", "2020-01-31", CalendarRecurrence::Monthly), "2026-10-01", "2026-12-31");
        assert_eq!(monthly, ["2026-10-31", "2026-11-30", "2026-12-31"]);
        let yearly = shown(&raw("1990-03-10", "1990-03-10", CalendarRecurrence::Yearly), "2026-01-01", "2027-12-31");
        assert_eq!(yearly, ["2026-03-10", "2027-03-10"]);
        // a three-day occurrence that began before the window still shows
        let multi = shown(&raw("2020-01-05", "2020-01-07", CalendarRecurrence::Weekly), "2026-11-03", "2026-11-03");
        assert_eq!(multi, ["2026-11-01"]);
    }

    #[test]
    fn editing_a_later_occurrence_keeps_or_moves_the_whole_series() {
        let d = tempfile::tempdir().unwrap();
        let cfg = Config::default();
        let made = upsert_event(d.path(), &cfg, &event_req("", "Colloquium", "2026-11-18", CalendarRecurrence::Weekly)).unwrap();
        let log18 = made.path.clone().unwrap();
        // a title change from the 12-02 occurrence leaves the series where it was
        let occ = format!("{}@2026-12-02", made.id);
        let edited = upsert_event(d.path(), &cfg, &event_req(&occ, "Colloquium (room 3)", "2026-12-02", CalendarRecurrence::Weekly)).unwrap();
        assert_eq!((edited.id.as_str(), edited.date.as_str()), (made.id.as_str(), "2026-11-18"));
        let titles = |from: &str, to: &str| {
            query_range(d.path(), &cfg, day(from), day(to)).unwrap().events.into_iter().map(|e| (e.date, e.title)).collect::<Vec<_>>()
        };
        assert_eq!(titles("2026-11-16", "2026-11-29"), [("2026-11-18".into(), "Colloquium (room 3)".into()), ("2026-11-25".into(), "Colloquium (room 3)".into())]);
        // dragging the 12-02 occurrence one day later moves every occurrence one day later
        let occ = format!("{}@2026-12-02", edited.id);
        let moved = upsert_event(d.path(), &cfg, &event_req(&occ, "Colloquium (room 3)", "2026-12-03", CalendarRecurrence::Weekly)).unwrap();
        assert_eq!(moved.date, "2026-11-19");
        assert!(!std::fs::read_to_string(d.path().join(&log18)).unwrap().contains("Colloquium"));
        assert_eq!(titles("2026-11-16", "2026-11-29").into_iter().map(|e| e.0).collect::<Vec<_>>(), ["2026-11-19", "2026-11-26"]);
        // an event page keeps its `date:` (and its file) when a later occurrence is retitled
        let mut req = event_req("", "Seminar", "2026-11-18", CalendarRecurrence::Weekly);
        req.storage = Some("page".into());
        let page = upsert_event(d.path(), &cfg, &req).unwrap();
        req.id = Some(format!("{}@2026-12-02", page.id));
        req.title = "Seminar (moved room)".into();
        req.date = "2026-12-02".into();
        let edited = upsert_event(d.path(), &cfg, &req).unwrap();
        assert_eq!((edited.id.as_str(), edited.date.as_str()), (page.id.as_str(), "2026-11-18"));
        let text = std::fs::read_to_string(d.path().join(page.path.unwrap())).unwrap();
        assert!(text.contains("date: 2026-11-18") && text.contains("Seminar (moved room)"), "{text}");
        // a monthly series moved by a month keeps its day of the month
        assert_eq!(shift_series_start(day("2026-01-31"), day("2026-03-31"), day("2026-05-31"), CalendarRecurrence::Monthly, 1), day("2026-03-31"));
        assert_eq!(shift_series_start(day("2026-01-15"), day("2026-03-15"), day("2026-04-15"), CalendarRecurrence::Monthly, 1), day("2026-02-15"));
        assert_eq!(split_occurrence("page:events/a@b.md"), ("page:events/a@b.md", None));
    }

    #[test]
    fn ics_utc_times_alarms_and_ending_rules() {
        let cet = chrono::FixedOffset::east_opt(3600).unwrap();
        assert_eq!(parse_ics_dt_in("20261118T130000Z", &cet), (Some(day("2026-11-18")), Some("14:00".into()), false));
        assert_eq!(parse_ics_dt_in("20261118T233000Z", &cet), (Some(day("2026-11-19")), Some("00:30".into()), false));
        assert_eq!(parse_ics_dt_in("20261118T130000", &cet), (Some(day("2026-11-18")), Some("13:00".into()), false), "floating stays");

        let ics = |rule: &str, extra: &str| {
            format!(
                "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261104\r\nSUMMARY:Seminar\r\n{rule}{extra}BEGIN:VALARM\r\nACTION:EMAIL\r\nSUMMARY:Alarm notification\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
            )
        };
        let evs = parse_ics_events(&ics("RRULE:FREQ=WEEKLY;BYDAY=WE\r\n", ""));
        assert_eq!(evs.len(), 1);
        assert_eq!((evs[0].title.as_str(), evs[0].repeat), ("Seminar", CalendarRecurrence::Weekly));
        let utc = chrono::Utc;
        // one event per rule, its end and skipped days kept on it, never a separate event per occurrence
        let one = |rule: &str, extra: &str| {
            let evs = parse_ics_events_in(&ics(rule, extra), &utc);
            assert_eq!(evs.len(), 1, "{rule}");
            let e = &evs[0];
            (e.date, e.repeat, e.series.interval, e.series.until, e.series.except.clone())
        };
        let wk = CalendarRecurrence::Weekly;
        assert_eq!(one("RRULE:FREQ=WEEKLY;COUNT=3\r\n", ""), (day("2026-11-04"), wk, 1, Some(day("2026-11-18")), vec![]));
        assert_eq!(
            one("RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261202T235959Z\r\n", "EXDATE;VALUE=DATE:20261118\r\n"),
            (day("2026-11-04"), wk, 2, Some(day("2026-12-02")), vec![day("2026-11-18")])
        );
        assert_eq!(one("RRULE:FREQ=WEEKLY;INTERVAL=2\r\n", ""), (day("2026-11-04"), wk, 2, None, vec![]));
        assert_eq!(one("RRULE:FREQ=WEEKLY\r\n", "EXDATE;VALUE=DATE:20261118\r\n"), (day("2026-11-04"), wk, 1, None, vec![day("2026-11-18")]));
        // a part the model cannot say repeats at the plain frequency rather than showing once
        assert_eq!(one("RRULE:FREQ=MONTHLY;BYDAY=1WE\r\n", "").1, CalendarRecurrence::Monthly);

        let occ = |src: String, from: &str, to: &str| {
            let mut out: Vec<String> = parse_ics_events_in(&src, &utc).iter().flat_map(|e| shown(e, from, to)).collect();
            out.sort();
            out
        };
        assert_eq!(occ(ics("RRULE:FREQ=WEEKLY;COUNT=3\r\n", ""), "2026-11-01", "2026-12-31"), ["2026-11-04", "2026-11-11", "2026-11-18"]);
        assert_eq!(
            occ(ics("RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261202T235959Z\r\n", "EXDATE;VALUE=DATE:20261118\r\n"), "2026-11-01", "2026-12-31"),
            ["2026-11-04", "2026-12-02"]
        );
        assert_eq!(occ(ics("RRULE:FREQ=WEEKLY;INTERVAL=2\r\n", ""), "2027-01-01", "2027-01-31"), ["2027-01-13", "2027-01-27"]);
        assert_eq!(occ(ics("RRULE:FREQ=WEEKLY\r\n", "EXDATE;VALUE=DATE:20261118\r\n"), "2026-11-01", "2026-11-30"), ["2026-11-04", "2026-11-11", "2026-11-25"]);
        // several weekdays: one series per day, a COUNT ending all of them on the same last day
        assert_eq!(occ(ics("RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\n", ""), "2026-11-01", "2026-11-15"), ["2026-11-04", "2026-11-09", "2026-11-11"]);
        assert_eq!(occ(ics("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3\r\n", ""), "2026-11-01", "2026-12-31"), ["2026-11-04", "2026-11-09", "2026-11-11"]);
        assert_eq!(occ(ics("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE\r\n", ""), "2026-11-01", "2026-11-30"), ["2026-11-04", "2026-11-16", "2026-11-18", "2026-11-30"]);
        assert_eq!(parse_ics_events_in(&ics("RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR\r\n", ""), &utc).len(), 5);
        // COUNT skips the months without the 31st, as RFC 5545 does
        let jan31 = ics("RRULE:FREQ=MONTHLY;COUNT=3\r\n", "").replace("20261104", "20260131");
        assert_eq!(parse_ics_events_in(&jan31, &utc)[0].series.until, Some(day("2026-05-31")));
    }

    #[test]
    fn ics_rule_days_are_read_in_the_frame_dtstart_is_written_in() {
        let ics = |start: &str, rule: &str| {
            format!("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:{start}\r\nSUMMARY:Meeting\r\n{rule}END:VEVENT\r\nEND:VCALENDAR\r\n")
        };
        let occ = |src: String, tz: chrono::FixedOffset, from: &str, to: &str| {
            parse_ics_events_in(&src, &tz)
                .iter()
                .flat_map(|e| shown(e, from, to).into_iter().map(|d| (d, e.start.clone().unwrap_or_default())))
                .collect::<Vec<_>>()
        };
        let at = |d: &str, t: &str| (d.to_string(), t.to_string());
        // Tuesday 02:00 UTC is Monday 18:00 eight hours west: BYDAY=TU names the written day, so the series stays weekly
        let west = chrono::FixedOffset::west_opt(8 * 3600).unwrap();
        assert_eq!(
            occ(ics("20261117T020000Z", "RRULE:FREQ=WEEKLY;BYDAY=TU\r\n"), west, "2026-11-16", "2026-11-29"),
            [at("2026-11-16", "18:00"), at("2026-11-23", "18:00")]
        );
        // Tuesday 23:00 UTC is Wednesday 07:00 eight hours east; UNTIL and EXDATE move to the shown day with it
        let east = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
        let src = ics("20261117T230000Z", "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261201T230000Z\r\nEXDATE:20261124T230000Z\r\n");
        assert_eq!(occ(src, east, "2026-11-01", "2026-12-31"), [at("2026-11-18", "07:00"), at("2026-12-02", "07:00")]);
        let cet = chrono::FixedOffset::east_opt(3600).unwrap();
        let evs = parse_ics_events_in(&ics("20261118T233000Z", "RRULE:FREQ=WEEKLY;BYDAY=WE\r\n"), &cet);
        assert_eq!((evs[0].date, evs[0].repeat), (day("2026-11-19"), CalendarRecurrence::Weekly));
        // a floating or TZID start is read as written, and a `Z` UNTIL is converted to the shown day
        let tokyo = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
        let src = ics("20261118T070000", "RRULE:FREQ=WEEKLY;UNTIL=20261201T220000Z\r\n").replace("DTSTART:", "DTSTART;TZID=Asia/Tokyo:");
        let days = |src: String, tz| occ(src, tz, "2026-11-01", "2026-12-31").into_iter().map(|o| o.0).collect::<Vec<_>>();
        assert_eq!(days(src, tokyo), ["2026-11-18", "2026-11-25", "2026-12-02"]);
        assert_eq!(days(ics("20261118T090000", "RRULE:FREQ=DAILY;UNTIL=20261121T075959Z\r\n"), west), ["2026-11-18", "2026-11-19", "2026-11-20"]);
    }

    #[test]
    fn an_unclosed_component_ends_with_its_event() {
        let src = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261104\r\nSUMMARY:First\r\nBEGIN:VALARM\r\nSUMMARY:Alarm\r\nEND:VEVENT\r\n\
                   BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261105\r\nSUMMARY:Second\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let titles: Vec<_> = parse_ics_events_in(src, &chrono::Utc).into_iter().map(|e| (e.title, e.date)).collect();
        assert_eq!(titles, [("First".to_string(), day("2026-11-04")), ("Second".to_string(), day("2026-11-05"))]);
    }

    #[test]
    fn an_imported_series_is_one_event_that_keeps_its_end_when_edited() {
        let cfg = Config::default();
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261104\r\nSUMMARY:Seminar\r\n\
                   RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=40\r\nEXDATE;VALUE=DATE:20261118\r\nEND:VEVENT\r\n\
                   BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261102\r\nSUMMARY:Standup\r\nRRULE:FREQ=DAILY;UNTIL=20271231\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        for as_pages in [true, false] {
            let d = tempfile::tempdir().unwrap();
            let imp = import_ics(d.path(), &cfg, &IcsImportRequest { ics: ics.into(), as_pages: Some(as_pages) }).unwrap();
            assert_eq!(imp.imported, 2, "{imp:?}");
            let mut files = imp.paths.clone();
            files.sort();
            files.dedup();
            assert_eq!(files.len(), 2, "one page or day-log entry per series, not one per occurrence: {files:?}");
            let seminar = |from: &str, to: &str| {
                let evs = query_range(d.path(), &cfg, day(from), day(to)).unwrap().events;
                evs.into_iter().filter(|e| e.title.starts_with("Seminar")).collect::<Vec<_>>()
            };
            let dates = |from: &str, to: &str| seminar(from, to).into_iter().map(|e| e.date).collect::<Vec<_>>();
            // 40 occurrences two weeks apart end on 2028-05-03; 2026-11-18 is skipped
            assert_eq!(dates("2026-11-01", "2026-12-06"), ["2026-11-04", "2026-12-02"]);
            assert_eq!(dates("2028-04-20", "2028-06-30"), ["2028-05-03"]);
            // retitling from a later occurrence (the editor sends no interval, end or skipped days) keeps them
            let occ = seminar("2026-12-01", "2026-12-06").remove(0);
            let mut req = event_req(&occ.occurrence_id, "Seminar (room 3)", "2026-12-02", CalendarRecurrence::Weekly);
            (req.start, req.end, req.all_day) = (None, None, true);
            let edited = upsert_event(d.path(), &cfg, &req).unwrap();
            assert_eq!(edited.date, "2026-11-04");
            assert_eq!(dates("2026-11-01", "2026-12-06"), ["2026-11-04", "2026-12-02"]);
            assert_eq!(dates("2028-04-20", "2028-06-30"), ["2028-05-03"]);
            // dragging it a day later moves the end and the skipped day with it
            let occ = seminar("2026-12-01", "2026-12-06").remove(0);
            req.id = Some(occ.occurrence_id);
            req.date = "2026-12-03".into();
            upsert_event(d.path(), &cfg, &req).unwrap();
            assert_eq!(dates("2026-11-01", "2026-12-06"), ["2026-11-05", "2026-12-03"]);
            assert_eq!(dates("2028-04-21", "2028-06-30"), ["2028-05-04"]);
            // the export says the same rule
            let out = export_ics(d.path(), &cfg);
            assert!(out.contains("RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20280504") && out.contains("EXDATE;VALUE=DATE:20261119"), "{out}");
        }
    }

    #[test]
    fn moving_an_occurrence_lands_it_where_it_was_dropped() {
        let lands = |start: &str, occ: &str, to: &str, repeat: CalendarRecurrence| {
            let s = shift_series_start(day(start), day(occ), day(to), repeat, 1);
            (s, shown(&raw(&s.to_string(), &s.to_string(), repeat), to, to))
        };
        let m = CalendarRecurrence::Monthly;
        // 07-31 dropped on 08-31: February has no 31st, so the series starts on 03-31 and keeps the 31st
        assert_eq!(lands("2026-01-31", "2026-07-31", "2026-08-31", m), (day("2026-03-31"), vec!["2026-08-31".to_string()]));
        // a new day of the month is kept
        assert_eq!(lands("2026-01-15", "2026-03-15", "2026-03-20", m), (day("2026-01-20"), vec!["2026-03-20".to_string()]));
        // the clamped 11-30 occurrence of a 31st series moved to 12-02
        assert_eq!(lands("2026-01-31", "2026-11-30", "2026-12-02", m), (day("2026-02-02"), vec!["2026-12-02".to_string()]));
        assert_eq!(lands("2024-02-29", "2026-02-28", "2026-03-01", CalendarRecurrence::Yearly).1, ["2026-03-01"]);
        assert_eq!(lands("2026-11-04", "2026-12-02", "2026-12-05", CalendarRecurrence::Weekly), (day("2026-11-07"), vec!["2026-12-05".to_string()]));
        // not moved (a title change opened from a clamped occurrence) leaves the start alone
        assert_eq!(shift_series_start(day("2026-01-31"), day("2026-11-30"), day("2026-11-30"), m, 1), day("2026-01-31"));
        // a skipped day or end moves a month with the occurrences, even when the start had to skip February
        let ev = raw("2026-01-31", "2026-01-31", m);
        let carried = |d: &str| move_with_series(&ev, day("2026-07-31"), day("2026-08-31"), day("2026-03-31"), day(d));
        assert_eq!((carried("2026-10-31"), carried("2026-12-31")), (day("2026-11-30"), day("2027-01-31")));
        let weekly = raw("2026-11-04", "2026-11-04", CalendarRecurrence::Weekly);
        assert_eq!(move_with_series(&weekly, day("2026-12-02"), day("2026-12-05"), day("2026-11-07"), day("2026-12-16")), day("2026-12-19"));
    }

    #[test]
    fn a_series_keeps_its_interval_end_and_skipped_days() {
        let mut ev = raw("2025-01-08", "2025-01-08", CalendarRecurrence::Weekly);
        ev.series.interval = 2;
        assert_eq!(shown(&ev, "2026-11-01", "2026-11-30"), ["2026-11-11", "2026-11-25"]);
        ev.series.until = Some(day("2026-11-20"));
        ev.series.except = vec![day("2026-10-28")];
        assert_eq!(shown(&ev, "2026-10-20", "2026-11-30"), ["2026-11-11"]);
    }
}
