//! Native click-a-day Calendar backend over plain vault Markdown, YAML frontmatter,
//! open tasks, `.base` date views, optional `.ics` feeds, and optional `dav` plugin caches.
use crate::config::Config;
use crate::{capture, frontmatter, paths, vault_write, Error, Result};
use chrono::{Duration, Months, NaiveDate, NaiveDateTime};
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
    links: Vec<String>,
    source: CalendarSource,
    path: Option<String>,
    line: Option<u32>,
    completed: bool,
    editable: bool,
}

pub fn query_range(root: &Path, cfg: &Config, from: NaiveDate, to: NaiveDate) -> Result<CalendarRangeResponse> {
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

    let raw = collect_raw_events(root, cfg);
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
    let has_fm_events = txt.contains("events:");
    has_fm_events || body.lines().any(|l| {
        let t = l.trim();
        !t.is_empty() && !t.starts_with("# ")
    })
}

fn collect_raw_events(root: &Path, cfg: &Config) -> Vec<RawEvent> {
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

    collect_base_events(root, cfg, &mut out);
    collect_ics_feeds(root, cfg, &mut out);
    out
}

fn collect_base_events(root: &Path, cfg: &Config, out: &mut Vec<RawEvent>) {
    let mut seen_notes: HashSet<(String, String)> = HashSet::new();
    for base_rel in &cfg.calendar.bases {
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
    let mut cur = ev.date;
    let mut count = 0usize;
    while cur <= to && count < 400 {
        if cur + Duration::days(span) >= from {
            push_inst(cur);
        }
        count += 1;
        let next = match ev.repeat {
            CalendarRecurrence::Daily => cur + Duration::days(1),
            CalendarRecurrence::Weekly => cur + Duration::days(7),
            CalendarRecurrence::Monthly => ev.date.checked_add_months(Months::new(count as u32)).unwrap_or(to + Duration::days(1)),
            CalendarRecurrence::Yearly => ev.date.checked_add_months(Months::new((count * 12) as u32)).unwrap_or(to + Duration::days(1)),
            CalendarRecurrence::None => break,
        };
        if next <= cur {
            break;
        }
        cur = next;
    }
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
        if let Some(rest) = id.strip_prefix("task:") {
            return reschedule_task(root, rest, date, title);
        }
        if let Some(rest) = id.strip_prefix("base:") {
            return reschedule_base_item(root, rest, date, title);
        }
        if let Some(rest) = id.strip_prefix("ds:") {
            return update_schedule_line(root, rest, title, req);
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
    let rel = if let Some(r) = existing_rel {
        r.to_string()
    } else {
        let dir = cfg.calendar.events_dir.trim().trim_matches('/');
        let stem = crate::notes::file_stem(req.title.trim());
        let stem = if stem.is_empty() { "Event".into() } else { stem };
        let base_name = format!("{} {stem}", date.format("%Y-%m-%d"));
        let mut cand = if dir.is_empty() { format!("{base_name}.md") } else { format!("{dir}/{base_name}.md") };
        let mut n = 2;
        while paths::safe_join(root, &cand)?.exists() {
            cand = if dir.is_empty() { format!("{base_name} {n}.md") } else { format!("{dir}/{base_name} {n}.md") };
            n += 1;
        }
        cand
    };
    write_event_page_at(root, &rel, date, end_date, req)
}

fn write_event_page_at(root: &Path, rel: &str, date: NaiveDate, end_date: NaiveDate, req: &CalendarEventUpsert) -> Result<CalendarEvent> {
    let abs = paths::safe_join(root, rel)?;
    let body_seed = req.notes.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("# {}\n\n{s}\n", req.title.trim())).unwrap_or_else(|| format!("# {}\n", req.title.trim()));
    let initial = if abs.is_file() { std::fs::read_to_string(&abs)? } else { body_seed };
    let mut text = frontmatter::set_property(&initial, "type", &"event".into());
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
        }
        if let Some(e) = req.end.as_deref().and_then(parse_hm) {
            text = frontmatter::set_property(&text, "end", &e.into());
        }
    } else {
        text = frontmatter::remove_property(&text, "start");
        text = frontmatter::remove_property(&text, "end");
    }
    if !req.color.trim().is_empty() {
        text = frontmatter::set_property(&text, "color", &req.color.trim().into());
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
    if !req.links.is_empty() {
        text = frontmatter::set_property(&text, "links", &Value::Sequence(req.links.iter().map(|s| Value::String(s.clone())).collect()));
    } else {
        text = frontmatter::remove_property(&text, "links");
    }
    vault_write::write(&abs, text.as_bytes())?;
    Ok(CalendarEvent {
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
    })
}

fn update_schedule_line(root: &Path, rest: &str, title: &str, req: &CalendarEventUpsert) -> Result<CalendarEvent> {
    let (rel, line_s) = rest.rsplit_once(':').ok_or_else(|| Error::BadRequest("bad schedule id".into()))?;
    let line_no: usize = line_s.parse().map_err(|_| Error::BadRequest("bad line".into()))?;
    let abs = paths::safe_join(root, rel)?;
    let s_t = req.start.as_deref().and_then(parse_hm).unwrap_or_else(|| "09:00".into());
    let e_t = req.end.as_deref().and_then(parse_hm).unwrap_or_else(|| "10:00".into());
    vault_write::modify(&abs, |txt| {
        let mut lines: Vec<String> = txt.lines().map(String::from).collect();
        let idx = line_no.checked_sub(1).ok_or_else(|| Error::BadRequest("bad line".into()))?;
        if idx >= lines.len() {
            return Err(Error::NotFound("line not found".into()));
        }
        lines[idx] = format!("- {s_t}–{e_t} {title}");
        Ok(format!("{}\n", lines.join("\n")))
    })?;
    Ok(CalendarEvent {
        id: format!("ds:{rel}:{line_no}"),
        occurrence_id: format!("ds:{rel}:{line_no}@{}", req.date),
        title: title.to_string(),
        date: req.date.clone(),
        end_date: req.date.clone(),
        start: Some(s_t),
        end: Some(e_t),
        all_day: false,
        color: "green".into(),
        location: String::new(),
        repeat: CalendarRecurrence::None,
        links: Vec::new(),
        source: CalendarSource::DailySchedule,
        path: Some(rel.to_string()),
        line: Some(line_no as u32),
        completed: false,
        editable: true,
    })
}

fn reschedule_task(root: &Path, rest: &str, date: NaiveDate, title: &str) -> Result<CalendarEvent> {
    let (rel, line_s) = rest.rsplit_once(':').ok_or_else(|| Error::BadRequest("bad task id".into()))?;
    let line_no: usize = line_s.parse().map_err(|_| Error::BadRequest("bad line".into()))?;
    let abs = paths::safe_join(root, rel)?;
    let new_d = date.format("%Y-%m-%d").to_string();
    vault_write::modify(&abs, |txt| {
        let mut lines: Vec<String> = txt.lines().map(String::from).collect();
        let idx = line_no.checked_sub(1).ok_or_else(|| Error::BadRequest("bad line".into()))?;
        if idx >= lines.len() {
            return Err(Error::NotFound("task line not found".into()));
        }
        let line = &lines[idx];
        lines[idx] = if let Some((_, i)) = crate::tasks::first_date(line) {
            format!("{}{new_d}{}", &line[..i], &line[i + 10..])
        } else {
            format!("{} 📅 {new_d}", line.trim_end())
        };
        Ok(format!("{}\n", lines.join("\n")))
    })?;
    Ok(CalendarEvent {
        id: format!("task:{rel}:{line_no}"),
        occurrence_id: format!("task:{rel}:{line_no}@{new_d}"),
        title: title.to_string(),
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
        completed: false,
        editable: true,
    })
}

fn reschedule_base_item(root: &Path, rest: &str, date: NaiveDate, title: &str) -> Result<CalendarEvent> {
    let parts: Vec<&str> = rest.splitn(3, ':').collect();
    if parts.len() != 3 {
        return Err(Error::BadRequest("bad base item id".into()));
    }
    let (base_rel, col_key, note_rel) = (parts[0], parts[1], parts[2]);
    let abs = paths::safe_join(root, note_rel)?;
    let new_d = date.format("%Y-%m-%d").to_string();
    vault_write::modify(&abs, |txt| Ok(frontmatter::set_property(txt, col_key, &new_d.clone().into())))?;
    Ok(CalendarEvent {
        id: format!("base:{base_rel}:{col_key}:{note_rel}"),
        occurrence_id: format!("base:{base_rel}:{col_key}:{note_rel}@{new_d}"),
        title: title.to_string(),
        date: new_d.clone(),
        end_date: new_d,
        start: None,
        end: None,
        all_day: true,
        color: "purple".into(),
        location: String::new(),
        repeat: CalendarRecurrence::None,
        links: Vec::new(),
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
            let mut lines: Vec<&str> = txt.lines().collect();
            let idx = line_no.checked_sub(1).ok_or_else(|| Error::BadRequest("bad line".into()))?;
            if idx >= lines.len() {
                return Err(Error::NotFound("line not found".into()));
            }
            lines.remove(idx);
            Ok(format!("{}\n", lines.join("\n")))
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
        links: raw.links.clone(),
        notes: None,
    };
    let ev = write_event_page_in_dir(root, cfg, None, raw.date, raw.end_date, &req)?;
    let _ = delete_event(root, id);
    let path = ev.path.clone().unwrap_or_default();
    Ok(CalendarPromoteResult { path, event: ev })
}

fn parse_ics_dt(val: &str) -> (Option<NaiveDate>, Option<String>, bool) {
    let clean = val.trim().trim_end_matches('Z');
    if clean.len() == 8 {
        let d = NaiveDate::parse_from_str(clean, "%Y%m%d").ok();
        return (d, None, true);
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(clean, "%Y%m%dT%H%M%S") {
        return (Some(dt.date()), Some(dt.format("%H:%M").to_string()), false);
    }
    (None, None, false)
}

fn parse_ics_events(src: &str) -> Vec<RawEvent> {
    let unfolded = ical::unfold(src);
    let mut out = Vec::new();
    let mut in_event = false;
    let mut map: BTreeMap<String, String> = BTreeMap::new();
    for raw in unfolded.lines() {
        let Some(line) = Line::parse(raw.trim()) else { continue };
        match line.name.as_str() {
            "BEGIN" if line.value.eq_ignore_ascii_case("VEVENT") => {
                in_event = true;
                map.clear();
            }
            "END" if line.value.eq_ignore_ascii_case("VEVENT") => {
                if in_event {
                    let (sd, st, all_day) = map.get("DTSTART").map_or((None, None, true), |v| parse_ics_dt(v));
                    let (ed, et, _) = map.get("DTEND").map_or((None, None, true), |v| parse_ics_dt(v));
                    let title = map.get("SUMMARY").map(|s| ical::unescape(s)).unwrap_or_default();
                    if let Some(d) = sd {
                        if !title.is_empty() {
                            let end_date = ed.map(|x| if all_day && x > d { x - Duration::days(1) } else { x }).unwrap_or(d).max(d);
                            out.push(RawEvent {
                                id: String::new(),
                                title,
                                date: d,
                                end_date,
                                start: if all_day { None } else { st },
                                end: if all_day { None } else { et },
                                all_day,
                                color: "blue".into(),
                                location: map.get("LOCATION").map(|s| ical::unescape(s)).unwrap_or_default(),
                                repeat: map
                                    .get("RRULE")
                                    .map(|r| {
                                        if r.contains("FREQ=DAILY") { CalendarRecurrence::Daily }
                                        else if r.contains("FREQ=WEEKLY") { CalendarRecurrence::Weekly }
                                        else if r.contains("FREQ=MONTHLY") { CalendarRecurrence::Monthly }
                                        else if r.contains("FREQ=YEARLY") { CalendarRecurrence::Yearly }
                                        else { CalendarRecurrence::None }
                                    })
                                    .unwrap_or(CalendarRecurrence::None),
                                links: Vec::new(),
                                source: CalendarSource::Ics,
                                path: None,
                                line: None,
                                completed: false,
                                editable: false,
                            });
                        }
                    }
                }
                in_event = false;
                map.clear();
            }
            key if in_event => {
                map.insert(key.to_string(), line.value);
            }
            _ => {}
        }
    }
    out
}

pub fn import_ics(root: &Path, cfg: &Config, req: &IcsImportRequest) -> Result<IcsImportResult> {
    let as_pages = req.as_pages.unwrap_or(true);
    let parsed = parse_ics_events(&req.ics);
    let mut paths = Vec::new();
    for ev in parsed {
        let up = CalendarEventUpsert {
            id: None,
            storage: Some(if as_pages { "page" } else { "inline" }.into()),
            title: ev.title,
            date: ev.date.format("%Y-%m-%d").to_string(),
            end_date: (ev.end_date != ev.date).then(|| ev.end_date.format("%Y-%m-%d").to_string()),
            start: ev.start,
            end: ev.end,
            all_day: ev.all_day,
            color: ev.color,
            location: ev.location,
            repeat: ev.repeat,
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
            lines.push(format!("RRULE:FREQ={}", ev.repeat.as_str().to_ascii_uppercase()));
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
}
