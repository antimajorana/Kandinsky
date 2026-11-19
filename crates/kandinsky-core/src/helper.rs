//! A plugin's helper: a program of the plugin's own that stays running (docs/guides/PLUGINS.md "v4").
//! This is what lets a plugin be fast, keep a connection open (mail, SSH, a database) or use
//! compiled code — in any language, because the helper is only spoken to:
//!
//! * one JSON object per line, both ways;
//! * the core writes `{"id": 7, "method": "search", "params": …}` and the helper answers with a
//!   line carrying the same id: `{"id": 7, "result": …}` or `{"id": 7, "error": "why"}`;
//! * a line from the helper **without** an id is an event, `{"event": "new-mail", "data": …}`, sent
//!   on to the page (`kandinsky.helper.on`);
//! * stderr, and any line that is not JSON, go to the plugin's log file.
//!
//! The helper is started by the first call (`[helper] run = "…"` in plugin.toml; cwd = the vault,
//! `$KANDINSKY_ROOT`, `$KANDINSKY_PLUGIN_DIR`, `$KANDINSKY_PLUGIN_CACHE`), in its own process group. When it
//! exits, calls in flight fail and the next call starts it again — unless it has died too often.
use crate::api::Event;
use crate::events::EventBus;
use crate::{plugins, Error, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

/// A call the helper does not answer in this time fails (the helper keeps running).
pub const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// Started this many times within [`CRASH_WINDOW`], it is left stopped until asked to restart.
const CRASH_LIMIT: usize = 5;
const CRASH_WINDOW: Duration = Duration::from_secs(600);
/// The shortest `[helper] idle` honoured: a helper is not started and stopped between two clicks.
const IDLE_FLOOR: Duration = Duration::from_secs(60);
/// How often an idle helper is looked at, at the most.
const IDLE_TICK: Duration = Duration::from_millis(if cfg!(test) { 20 } else { 15_000 });
/// How long a stopping process helper gets after stdin EOF before falling back to process-group kill.
const STOP_GRACE: Duration = Duration::from_millis(250);
const STOP_POLL: Duration = Duration::from_millis(10);
/// A refusal of a helper's program that took about this long was its approval prompt running out unanswered (binary_trust
/// waits 30 s), not the user's Deny.
const APPROVAL_WAIT: Duration = Duration::from_secs(29);
/// After a prompt ran out, a late "Allow" there still starts the helper: looked for this often, for this long.
const LATE_ALLOW_EVERY: Duration = Duration::from_secs(5);
const LATE_ALLOW_FOR: Duration = Duration::from_secs(600);

type Reply = oneshot::Sender<std::result::Result<Value, String>>;

struct PipeExit {
    child: Mutex<Option<tokio::process::Child>>,
    status: Mutex<Option<String>>,
    done: AtomicBool,
    /// what the helper started, ended with it when it exits on stdin EOF and leaves them running
    job: crate::platform::proc::Job,
}

/// Where the core's lines to a helper go: a process's stdin, or a JS helper's context (js_helper.rs).
enum Input {
    Pipe {
        stdin: tokio::sync::Mutex<Option<tokio::process::ChildStdin>>,
        closed: AtomicBool,
        pid: Option<u32>,
        exit: Arc<PipeExit>,
    },
    Js(crate::js_helper::Handle),
}

struct Running {
    input: Input,
    waiting: Mutex<HashMap<u64, Reply>>,
    next: AtomicU64,
    /// plugin.toml's mtime when it started: an update rewrites it, and the next call starts the new helper
    stamp: Option<std::time::SystemTime>,
    /// when a call last went to it or an answer came back (`[helper] idle`)
    used: Mutex<Instant>,
    stopped: AtomicBool,
}

impl Running {
    /// Everyone still waiting is told; nobody is left hanging.
    fn fail_all(&self, why: &str) {
        for (_, tx) in self.waiting.lock().unwrap().drain() {
            let _ = tx.send(Err(why.to_string()));
        }
    }

    fn close_stdin(&self) {
        if let Input::Pipe { stdin, closed, .. } = &self.input {
            closed.store(true, Ordering::Release);
            if let Ok(mut guard) = stdin.try_lock() {
                guard.take();
            }
        }
    }

    fn begin_stop(&self) -> Option<(Option<u32>, &Arc<PipeExit>)> {
        if self.stopped.swap(true, Ordering::AcqRel) {
            return None;
        }
        match &self.input {
            Input::Pipe { pid, exit, .. } => {
                self.close_stdin();
                Some((*pid, exit))
            }
            Input::Js(h) => {
                h.stop();
                None
            }
        }
    }

    fn pipe_exited(pid: Option<u32>, exit: &PipeExit) -> bool {
        if exit.done.load(Ordering::Acquire) {
            return true;
        }
        let mut child_guard = exit.child.lock().unwrap_or_else(|e| e.into_inner());
        match child_guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(st)) => {
                    *exit.status.lock().unwrap_or_else(|e| e.into_inner()) = Some(st.to_string());
                    *child_guard = None;
                    exit.done.store(true, Ordering::Release);
                    true
                }
                Ok(None) => false,
                Err(e) => {
                    *exit.status.lock().unwrap_or_else(|e| e.into_inner()) = Some(e.to_string());
                    *child_guard = None;
                    exit.done.store(true, Ordering::Release);
                    true
                }
            },
            None => exit.done.load(Ordering::Acquire) || pid.is_none_or(|p| !crate::platform::proc::pid_alive(p)),
        }
    }

    fn finish_stop(pid: Option<u32>, exit: &PipeExit) {
        if Self::pipe_exited(pid, exit) {
            // it ended on stdin EOF, but what it started (a worker, a `sh -c` child) may still run
            exit.job.end();
        } else if let Some(pid) = pid {
            // the whole group: a helper started through `sh -c` is the shell's child
            crate::platform::proc::stop_group(pid, crate::platform::proc::Stop::Ask);
        }
    }

    fn kill(&self) {
        let Some((pid, exit)) = self.begin_stop() else { return };
        let deadline = Instant::now() + STOP_GRACE;
        while !Self::pipe_exited(pid, exit) {
            let Some(left) = deadline.checked_duration_since(Instant::now()) else { break };
            std::thread::sleep(left.min(STOP_POLL));
            self.close_stdin();
        }
        Self::finish_stop(pid, exit);
    }

    async fn kill_async(&self) {
        let Some((pid, exit)) = self.begin_stop() else { return };
        let deadline = Instant::now() + STOP_GRACE;
        while !Self::pipe_exited(pid, exit) {
            let Some(left) = deadline.checked_duration_since(Instant::now()) else { break };
            tokio::time::sleep(left.min(STOP_POLL)).await;
            self.close_stdin();
        }
        Self::finish_stop(pid, exit);
    }

    /// One protocol line to the helper.
    async fn send(&self, line: &str) -> std::io::Result<()> {
        match &self.input {
            Input::Pipe { stdin, closed, .. } => {
                let mut guard = stdin.lock().await;
                if closed.load(Ordering::Acquire) {
                    guard.take();
                    return Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "the helper was stopped"));
                }
                let Some(pipe) = guard.as_mut() else {
                    return Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "the helper was stopped"));
                };
                let res = pipe.write_all(format!("{line}\n").as_bytes()).await;
                if closed.load(Ordering::Acquire) {
                    guard.take();
                }
                res
            }
            Input::Js(h) => h.send(line),
        }
    }
}

#[derive(Default)]
struct Slot {
    running: Option<Arc<Running>>,
    starts: Vec<Instant>,
}

/// The helpers of one vault. Cheap to clone.
#[derive(Clone)]
pub struct Helpers {
    root: PathBuf,
    bus: EventBus,
    slots: Arc<Mutex<HashMap<String, Slot>>>,
    /// one start at a time per plugin, without holding `slots` (a start reads the manifest and spawns a process, and
    /// every other plugin's calls go through `slots`); kept apart from the slots, which `stop` removes
    starting: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    /// the vault's routes, answering the helpers' calls back in-process (helper_api.rs); unset where nothing serves the
    /// vault, and a call is then answered 503
    routes: Arc<RwLock<Option<axum::Router>>>,
    /// helpers to start with the vault that could not start before a window was there (one may need the user's
    /// approval of its program): tried again when a window connects ([`Helpers::window_seen`]), until one starts or the
    /// user denies it
    deferred: Arc<Mutex<Vec<String>>>,
}

fn manifest_stamp(root: &Path, id: &str) -> Option<std::time::SystemTime> {
    std::fs::metadata(crate::state_dir::join(root, plugins::PLUGINS_DIR).join(id).join("plugin.toml")).and_then(|m| m.modified()).ok()
}

fn log_file(root: &Path, id: &str) -> std::path::PathBuf {
    crate::state_dir::dir(root).join("cache/plugins").join(format!("{id}.log"))
}

/// A helper's log is kept to about this size: past it, it becomes `<id>.log.1` (the one before is dropped).
const LOG_MAX: u64 = 2 * 1024 * 1024;

/// The log's last lines, for an error that would otherwise only say the helper is gone (a broken pipe). Only its end is
/// read.
fn log_tail(root: &Path, id: &str) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let mut end = Vec::new();
    if let Ok(mut f) = std::fs::File::open(log_file(root, id)) {
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let _ = f.seek(SeekFrom::Start(len.saturating_sub(8192))).and_then(|_| f.read_to_end(&mut end));
    }
    let text = String::from_utf8_lossy(&end);
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(5)..].join(" · ")
}

fn log(root: &Path, id: &str, line: &str) {
    let file = log_file(root, id);
    if std::fs::metadata(&file).is_ok_and(|m| m.len() > LOG_MAX) {
        let _ = crate::vault_write::cache::rename(&file, &file.with_extension("log.1"));
    }
    let _ = crate::vault_write::cache::append(&file, format!("{} {line}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")).as_bytes());
}

impl Helpers {
    pub fn new(root: &Path, bus: EventBus) -> Self {
        Self { root: root.to_path_buf(), bus, slots: Arc::default(), starting: Arc::default(), routes: Arc::default(), deferred: Arc::default() }
    }

    /// The routes the helpers' calls go through (the server, once the vault's router exists).
    pub fn answer_with(&self, routes: axum::Router) {
        *self.routes.write().unwrap_or_else(|e| e.into_inner()) = Some(routes);
    }

    /// Stops all running helpers and clears the router reference so server state can drop without a cycle.
    pub fn shutdown(&self) {
        self.stop_all();
        *self.routes.write().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// `stopped`, `running`, or `crashed` (died too often; `restart` clears it).
    pub fn state(&self, id: &str) -> &'static str {
        let slots = self.slots.lock().unwrap();
        match slots.get(id) {
            Some(s) if s.running.is_some() => "running",
            Some(s) if s.starts.len() >= CRASH_LIMIT => "crashed",
            _ => "stopped",
        }
    }

    pub fn stop(&self, id: &str) {
        // after a start in progress, or it would put its helper back once this is done
        let one = self.starting.lock().unwrap().get(id).cloned();
        let _starting = one.as_ref().map(|m| m.lock().unwrap_or_else(|e| e.into_inner()));
        let taken = self.slots.lock().unwrap().remove(id).and_then(|s| s.running);
        if let Some(r) = taken {
            r.fail_all("the helper was stopped");
            r.kill();
        }
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = self.slots.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.stop(&id);
        }
    }

    /// Starts the helper of `id` if it is not running (`[helper] start = "open"`).
    pub fn start(&self, id: &str) -> Result<()> {
        self.running(id).map(|_| ())
    }

    /// Starts the helpers `ids` as the vault opens. One that does not start yet (its program awaits the user's
    /// approval, and no window is there to ask) is tried again when the first window connects, never refused for good.
    /// Never waits: a start here cannot ask anyone, so it fails at once.
    pub fn start_with_vault(&self, ids: Vec<String>) {
        let cfg = crate::config::Config::load(&self.root).ok();
        for id in ids {
            if cfg.as_ref().is_some_and(|c| c.is_plugin_effectively_off(&id)) {
                log(&self.root, &id, "[kandinsky] switched off or requires Developer mode: not started with the vault");
                continue;
            }
            if let Err(e) = self.start(&id) {
                eprintln!("kandinsky: plugin {id}: its helper did not start with the vault (tried again when a window opens): {e}");
                log(&self.root, &id, &format!("[kandinsky] not started with the vault, tried again when a window opens: {e}"));
                self.deferred.lock().unwrap().push(id);
            }
        }
    }

    /// A window connected (its events socket): the helpers [`Self::start_with_vault`] could not start are started now,
    /// so an approval prompt reaches that window. In the background: a start may wait for the user's answer.
    pub fn window_seen(&self) {
        let ids = std::mem::take(&mut *self.deferred.lock().unwrap());
        if ids.is_empty() {
            return;
        }
        let me = self.clone();
        tokio::spawn(async move {
            for id in ids {
                let one = me.clone();
                let _ = tokio::task::spawn_blocking(move || one.retry(&id)).await;
            }
        });
    }

    /// One helper [`Self::window_seen`] took up: started if it still starts with the vault (switched on, not blocked,
    /// `start = "open"`), and kept for the next window when it did not start for any reason but the user's own Deny.
    fn retry(&self, id: &str) {
        let still = crate::config::Config::load(&self.root).map(|c| {
            if c.is_plugin_effectively_off(id) {
                Vec::new()
            } else {
                plugins::helpers_started_with_vault(&self.root, &c.effective_plugins_off())
            }
        });
        if !still.is_ok_and(|ids| ids.iter().any(|i| i == id)) {
            log(&self.root, id, "[kandinsky] no longer started with the vault (switched off, blocked or changed): not started");
            return;
        }
        let asked = Instant::now();
        let Err(e) = self.start(id) else { return };
        eprintln!("kandinsky: plugin {id}: its helper did not start with the vault: {e}");
        log(&self.root, id, &format!("[kandinsky] did not start with the vault: {e}"));
        // binary_trust says no the same way to a Deny and to a prompt that ran out: only the time taken tells them apart
        let denied = e.to_string().contains("execution denied");
        if denied && asked.elapsed() < APPROVAL_WAIT {
            return; // the user's answer: not asked again this session
        }
        {
            let mut deferred = self.deferred.lock().unwrap();
            if !deferred.iter().any(|d| d == id) {
                deferred.push(id.to_string());
            }
        }
        if denied {
            self.start_when_allowed(id);
        }
    }

    /// The approval prompt for `id`'s helper ran out unanswered: an "Allow" given there later still counts, so the
    /// helper starts once its program is allowed, without waiting for the next window.
    fn start_when_allowed(&self, id: &str) {
        let (me, id) = (self.clone(), id.to_string());
        tokio::spawn(async move {
            let until = Instant::now() + LATE_ALLOW_FOR;
            while Instant::now() < until {
                tokio::time::sleep(LATE_ALLOW_EVERY).await;
                if !me.deferred.lock().unwrap().contains(&id) {
                    return; // a window took it up meanwhile
                }
                let (one, i) = (me.clone(), id.clone());
                if tokio::task::spawn_blocking(move || one.approved_now(&i)).await.unwrap_or(false) {
                    me.deferred.lock().unwrap().retain(|d| *d != id);
                    let _ = tokio::task::spawn_blocking(move || me.retry(&id)).await;
                    return;
                }
            }
        });
    }

    /// Whether `id`'s helper program may run now without asking anyone: allowed earlier, or needing no approval. Asked
    /// on a bus no window listens to, so an unapproved program is refused at once and nobody is prompted.
    fn approved_now(&self, id: &str) -> bool {
        match plugins::helper_program(&self.root, id) {
            Ok(plugins::HelperProgram::Js(_)) => true,
            Ok(plugins::HelperProgram::Command(run)) => {
                let Ok(env) = self.process_env(id) else { return false };
                let Ok(plan) = crate::platform::run_line::plan(&run, &self.root, &crate::env::with_legacy(&env)) else { return false };
                crate::binary_trust::authorize_blocking(&self.root, id, &plan.program, &plan.args, Some(&EventBus::default())).is_ok()
            }
            Err(_) => false,
        }
    }

    /// The running helper of `id`, started now if it is not.
    fn running(&self, id: &str) -> Result<Arc<Running>> {
        if crate::config::Config::load(&self.root).is_ok_and(|c| c.is_plugin_effectively_off(id)) {
            return Err(Error::BadRequest(format!("plugin {id} is switched off or requires Developer mode")));
        }
        let stamp = manifest_stamp(&self.root, id);
        if let Some(r) = self.current(id, stamp) {
            return Ok(r);
        }
        let one = self.starting.lock().unwrap().entry(id.to_string()).or_default().clone();
        let _starting = one.lock().unwrap_or_else(|e| e.into_inner());
        // another call may have started it while this one waited
        if let Some(r) = self.current(id, stamp) {
            return Ok(r);
        }
        let now = Instant::now();
        {
            let mut slots = self.slots.lock().unwrap();
            let slot = slots.entry(id.to_string()).or_default();
            if let Some(old) = slot.running.take() {
                // the plugin was updated under its running helper (`kandinsky plugin update`, a copy): the old one goes
                log(&self.root, id, "[kandinsky] plugin.toml changed: the helper restarts");
                old.fail_all("the plugin was updated: its helper restarted");
                old.kill();
            }
            slot.starts.retain(|t| now.duration_since(*t) < CRASH_WINDOW);
            if slot.starts.len() >= CRASH_LIMIT {
                return Err(Error::CommandFailed(format!(
                    "plugin {id}: its helper stopped {CRASH_LIMIT} times in ten minutes and is left stopped — see .kandinsky/cache/plugins/{id}.log, then restart it"
                )));
            }
        }
        let r = match plugins::helper_program(&self.root, id)? {
            plugins::HelperProgram::Command(run) => self.start_process(id, &run, stamp, now)?,
            plugins::HelperProgram::Js(file) => self.start_js(id, file, stamp, now)?,
        };
        {
            let mut slots = self.slots.lock().unwrap();
            let slot = slots.entry(id.to_string()).or_default();
            slot.running = Some(r.clone());
            slot.starts.push(now);
        }
        match plugins::helper_idle(&self.root, id) {
            Ok(Some(idle)) => self.stop_when_idle(id, &r, idle.max(IDLE_FLOOR)),
            Ok(None) => {}
            Err(why) => log(&self.root, id, &format!("[kandinsky] {why}")),
        }
        Ok(r)
    }

    /// `id`'s running helper, when it was started from the manifest as it is now.
    fn current(&self, id: &str, stamp: Option<std::time::SystemTime>) -> Option<Arc<Running>> {
        self.slots.lock().unwrap().get(id)?.running.as_ref().filter(|r| r.stamp == stamp).cloned()
    }

    /// `[helper] run`: the program, its stdout read for answers, its stderr into the log.
    fn start_process(&self, id: &str, run: &str, stamp: Option<std::time::SystemTime>, now: Instant) -> Result<Arc<Running>> {
        let env = self.process_env(id)?;
        let plan_env = crate::env::with_legacy(&env);
        if let Ok(plan) = crate::platform::run_line::plan(run, &self.root, &plan_env) {
            crate::binary_trust::authorize_blocking(&self.root, id, &plan.program, &plan.args, Some(&self.bus)).map_err(|e| match e {
                // a plugin without its build for this computer says so, as when the spawn itself finds nothing
                Error::NotFound(_) => Error::CommandFailed(format!("plugin {id}: helper: {}", spawn_failed(run, &std::io::ErrorKind::NotFound.into()))),
                e => Error::CommandFailed(format!("plugin {id}: helper: {e}")),
            })?;
        }
        let mut cmd = crate::platform::run_line::command(run, &self.root, &env).map_err(|e| Error::CommandFailed(format!("plugin {id}: helper: {e}")))?;
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        crate::platform::proc::own_group(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| Error::CommandFailed(format!("plugin {id}: helper: {}", spawn_failed(run, &e))))?;
        let (stdin, stdout, stderr) = (child.stdin.take(), child.stdout.take(), child.stderr.take());
        let (Some(stdin), Some(stdout), Some(stderr)) = (stdin, stdout, stderr) else {
            return Err(Error::CommandFailed(format!("plugin {id}: helper: no pipes")));
        };
        let pid = child.id();
        let job = crate::platform::proc::Job::of(&child);
        let exit = Arc::new(PipeExit {
            child: Mutex::new(Some(child)),
            status: Mutex::new(None),
            done: AtomicBool::new(false),
            job,
        });
        let input = Input::Pipe {
            stdin: tokio::sync::Mutex::new(Some(stdin)),
            closed: AtomicBool::new(false),
            pid,
            exit: exit.clone(),
        };
        let r = Arc::new(Running {
            input,
            waiting: Mutex::default(),
            next: AtomicU64::new(1),
            stamp,
            used: Mutex::new(now),
            stopped: AtomicBool::new(false),
        });
        log(&self.root, id, &format!("[kandinsky] helper started: {run}"));

        // stderr → the plugin's log
        let (root, pid) = (self.root.clone(), id.to_string());
        let errs = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                log(&root, &pid, &l);
            }
        });
        // stdout → answers and events; when it ends the helper is gone
        let (me, pid, mine) = (self.clone(), id.to_string(), r.clone());
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                me.incoming(&pid, &mine, &l);
            }
            let taken = exit.child.lock().unwrap_or_else(|e| e.into_inner()).take();
            let status = match taken {
                Some(mut child) => child.wait().await.map(|s| s.to_string()).unwrap_or_else(|e| e.to_string()),
                None => exit
                    .status
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
                    .unwrap_or_else(|| "stopped".to_string()),
            };
            exit.done.store(true, Ordering::Release);
            let _ = tokio::time::timeout(Duration::from_secs(1), errs).await; // its last words logged first
            me.ended(&pid, &mine, &status);
        });
        Ok(r)
    }

    /// The environment `id`'s helper process starts with (its cache folder made).
    fn process_env(&self, id: &str) -> Result<Vec<(String, std::ffi::OsString)>> {
        let dir = crate::state_dir::join(&self.root, plugins::PLUGINS_DIR).join(id);
        let cache = crate::state_dir::dir(&self.root).join("cache/plugins").join(id);
        crate::vault_write::cache::mkdir(&cache)?;
        let mut env = vec![
            ("KANDINSKY_ROOT".to_string(), self.root.clone().into_os_string()),
            ("KANDINSKY_PLUGIN_DIR".to_string(), dir.into_os_string()),
            ("KANDINSKY_PLUGIN_TARGET".to_string(), plugins::target().into()),
            ("KANDINSKY_PLUGIN_CACHE".to_string(), cache.into_os_string()),
        ];
        // the core's address and the plugin's key: helper_api.rs
        env.extend(crate::helper_api::env(&self.root, id).into_iter().map(|(k, v)| (k.to_string(), std::ffi::OsString::from(v))));
        Ok(env)
    }

    /// `[helper] js`: the script in a QuickJS context of its own; its lines read as a process's stdout would be.
    fn start_js(&self, id: &str, file: PathBuf, stamp: Option<std::time::SystemTime>, now: Instant) -> Result<Arc<Running>> {
        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        // the programs it may run (`[permissions] exec`); an unreadable manifest gives it none
        let exec = plugins::tool_parts(&self.root, id).map(|(_, p, _)| p.exec).unwrap_or_default();
        let (handle, mut outs) = crate::js_helper::start(&self.root, id, file, crate::js_helper::LIMITS, exec).map_err(|e| Error::CommandFailed(format!("plugin {id}: helper: {e}")))?;
        let r = Arc::new(Running {
            input: Input::Js(handle),
            waiting: Mutex::default(),
            next: AtomicU64::new(1),
            stamp,
            used: Mutex::new(now),
            stopped: AtomicBool::new(false),
        });
        log(&self.root, id, &format!("[kandinsky] helper started: {name} (JavaScript, in the core)"));
        let (me, pid, mine) = (self.clone(), id.to_string(), r.clone());
        tokio::spawn(async move {
            let mut status = "ended".to_string();
            while let Some(out) = outs.recv().await {
                match out {
                    crate::js_helper::Out::Line(l) => me.incoming(&pid, &mine, &l),
                    crate::js_helper::Out::Log(l) => log(&me.root, &pid, &l),
                    crate::js_helper::Out::Exit(why) => status = why,
                }
            }
            me.ended(&pid, &mine, &status);
        });
        Ok(r)
    }

    /// Helper `r` is gone: its calls fail with the reason, its slot is freed, the page is told.
    fn ended(&self, id: &str, r: &Arc<Running>, status: &str) {
        log(&self.root, id, &format!("[kandinsky] helper exited: {status}"));
        r.fail_all(&format!("the helper exited ({status}) — its log: {}", log_tail(&self.root, id)));
        // only if it is still the one in the slot (a restart may have put a new one there)
        let mut slots = self.slots.lock().unwrap();
        if let Some(s) = slots.get_mut(id) {
            if s.running.as_ref().is_some_and(|cur| Arc::ptr_eq(cur, r)) {
                s.running = None;
            }
        }
        drop(slots);
        self.bus.publish(Event::Plugin { plugin: id.to_string(), event: "helper:exit".into(), data: json!({ "status": status }) });
    }

    /// Stops helper `r` once it has had no call for `idle` and none is waiting; the next call starts it again.
    fn stop_when_idle(&self, id: &str, r: &Arc<Running>, idle: Duration) {
        let (me, id, mine) = (self.clone(), id.to_string(), Arc::downgrade(r));
        tokio::spawn(async move {
            loop {
                tokio::time::sleep((idle / 4).max(IDLE_TICK)).await;
                let Some(r) = mine.upgrade() else { return }; // exited or replaced
                if !r.waiting.lock().unwrap().is_empty() || r.used.lock().unwrap().elapsed() < idle {
                    continue;
                }
                let current = {
                    let mut slots = me.slots.lock().unwrap();
                    let current = slots.get(&id).and_then(|s| s.running.as_ref()).is_some_and(|cur| Arc::ptr_eq(cur, &r));
                    if current {
                        slots.remove(&id); // not a crash: its starts are forgotten with the slot
                    }
                    current
                };
                if current {
                    log(&me.root, &id, &format!("[kandinsky] helper stopped: no call for {}s ([helper] idle)", idle.as_secs()));
                    r.kill_async().await;
                }
                return;
            }
        });
    }

    /// One line from the helper.
    fn incoming(&self, id: &str, r: &Arc<Running>, line: &str) {
        let Ok(Value::Object(mut msg)) = serde_json::from_str::<Value>(line) else {
            log(&self.root, id, line); // not JSON: a print the author left in
            return;
        };
        if let Some(call) = crate::helper_api::Call::parse(&msg) {
            let (routes, id, r) = (self.routes.read().unwrap_or_else(|e| e.into_inner()).clone(), id.to_string(), r.clone());
            tokio::spawn(async move {
                let (n, status, body) = match call {
                    Err((n, why)) => (n, 400, CallReply::Json(json!({ "error": why }))),
                    Ok(c) => {
                        let n = c.n;
                        let (status, body) = answer_call(routes, &id, c).await;
                        (n, status, body)
                    }
                };
                let msg = match body {
                    CallReply::Json(body) => json!({ "reply": n, "status": status, "body": body }),
                    CallReply::Bytes(b) => {
                        use base64::Engine;
                        json!({ "reply": n, "status": status, "bytes": base64::engine::general_purpose::STANDARD.encode(b) })
                    }
                };
                let _ = r.send(&msg.to_string()).await;
            });
        } else if let Some(n) = msg.get("id").and_then(Value::as_u64) {
            let Some(tx) = r.waiting.lock().unwrap().remove(&n) else { return };
            *r.used.lock().unwrap() = Instant::now();
            let answer = match msg.remove("error") {
                Some(Value::Null) | None => Ok(msg.remove("result").unwrap_or(Value::Null)),
                Some(Value::String(s)) => Err(s),
                Some(Value::Object(o)) => Err(o.get("message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| Value::Object(o).to_string())),
                Some(other) => Err(other.to_string()),
            };
            let _ = tx.send(answer);
        } else if let Some(event) = msg.get("event").and_then(Value::as_str).map(str::to_string) {
            self.bus.publish(Event::Plugin { plugin: id.to_string(), event, data: msg.remove("data").unwrap_or(Value::Null) });
        } else {
            log(&self.root, id, line);
        }
    }

    /// Ask the helper of plugin `id` and wait for its answer.
    pub async fn call(&self, id: &str, method: &str, params: Value, timeout: Duration) -> Result<Value> {
        let r = match self.current(id, manifest_stamp(&self.root, id)) {
            Some(r) => r,
            // starting one spawns a program and may wait on another call starting the same helper: not on an async
            // thread the rest of the core needs meanwhile (a current-thread runtime, as in tests, has no other)
            None => match tokio::runtime::Handle::try_current().map(|h| h.runtime_flavor()) {
                Ok(tokio::runtime::RuntimeFlavor::MultiThread) => tokio::task::block_in_place(|| self.running(id))?,
                _ => self.running(id)?,
            },
        };
        *r.used.lock().unwrap() = Instant::now();
        let n = r.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        r.waiting.lock().unwrap().insert(n, tx);
        let wrote = r.send(&json!({ "id": n, "method": method, "params": params }).to_string()).await;
        if let Err(e) = wrote {
            // the helper is gone: its exit, with the log's last lines, comes through `rx` once noticed
            return match tokio::time::timeout(Duration::from_secs(2), rx).await {
                Ok(Ok(Err(why))) => Err(Error::CommandFailed(format!("plugin {id}: {method}: {why}"))),
                _ => {
                    r.waiting.lock().unwrap().remove(&n);
                    Err(Error::CommandFailed(format!("plugin {id}: helper not reachable: {e} — its log: {}", log_tail(&self.root, id))))
                }
            };
        }
        let got = tokio::time::timeout(timeout, rx).await;
        *r.used.lock().unwrap() = Instant::now(); // its idle time counts from the call's end, however long it took
        match got {
            Ok(Ok(Ok(v))) => Ok(v),
            Ok(Ok(Err(why))) => Err(Error::CommandFailed(format!("plugin {id}: {method}: {why}"))),
            Ok(Err(_)) => Err(Error::CommandFailed(format!("plugin {id}: {method}: the helper went away"))),
            Err(_) => {
                r.waiting.lock().unwrap().remove(&n);
                Err(Error::CommandFailed(format!("plugin {id}: {method}: no answer in {}s", timeout.as_secs())))
            }
        }
    }
}

/// One call back from a helper, through the vault's routes as the plugin (the guard reads the [`Caller`] mark).
///
/// [`Caller`]: crate::helper_api::Caller
/// A call's answer on the pipe: JSON (or text) as `body`, anything else (a picture, a PDF) as base64 `bytes`.
enum CallReply {
    Json(Value),
    Bytes(Vec<u8>),
}

async fn answer_call(routes: Option<axum::Router>, id: &str, c: crate::helper_api::Call) -> (u16, CallReply) {
    use tower::ServiceExt;
    let Some(routes) = routes else {
        return (503, CallReply::Json(json!({ "error": "Kandinsky is not serving this vault here (kandinsky mcp started the helper): start Kandinsky to call it back" })));
    };
    use crate::helper_api::CallBody;
    // the URL guard (`may`) cannot see a file route's target: read it here, where the body is at hand
    if c.verb != axum::http::Method::GET {
        let body = if let CallBody::Json(j) = &c.body { Some(j) } else { None };
        if let Err(why) = crate::helper_api::may_write(id, &c.path, body) {
            return (403, CallReply::Json(json!({ "error": why })));
        }
    }
    let kind = if matches!(c.body, CallBody::Bytes(_)) { "application/octet-stream" } else { "application/json" };
    let mut req = axum::http::Request::builder().method(c.verb).uri(&c.path).header("content-type", kind);
    if let Some(ext) = req.extensions_mut() {
        ext.insert(crate::helper_api::Caller(id.to_string()));
    }
    let body = match c.body {
        CallBody::Empty => axum::body::Body::empty(),
        CallBody::Json(j) => axum::body::Body::from(j.to_string()),
        CallBody::Bytes(b) => axum::body::Body::from(b),
    };
    let Ok(req) = req.body(body) else { return (400, CallReply::Json(json!({ "error": format!("not a request: {}", c.path) }))) };
    let Ok(res) = routes.oneshot(req).await; // a Router never fails: its error is Infallible
    let status = res.status().as_u16();
    let bytes = axum::body::to_bytes(res.into_body(), 256 * 1024 * 1024).await.unwrap_or_default();
    // not text (a thumbnail, a raw file): its bytes as they are, which a lossy string would break
    let Ok(text) = std::str::from_utf8(&bytes) else { return (status, CallReply::Bytes(bytes.to_vec())) };
    (status, CallReply::Json(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string())) }))
}

impl Drop for Running {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Why a helper did not start, in words: a missing program is a plugin without its build for this computer, not
/// "No such file or directory (os error 2)".
fn spawn_failed(run: &str, e: &std::io::Error) -> String {
    if e.kind() != std::io::ErrorKind::NotFound {
        return e.to_string();
    }
    let target = plugins::target();
    let line = shell_defaults(&run.replace('"', "")).replace("$KANDINSKY_PLUGIN_DIR/", "").replace("$KANDINSKY_PLUGIN_TARGET", &target).replace("$ATLAS_PLUGIN_DIR/", "").replace("$ATLAS_PLUGIN_TARGET", &target);
    let program = line.split_whitespace().next().unwrap_or_default();
    format!("its program {program} is not on this computer (the plugin has no build for {target}, or was copied without it): reinstall it from Settings → Plugins")
}

/// A run line as a person reads it: every `${NAME:-default}` its default (the variable is unset unless overridden).
fn shell_defaults(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(at) = rest.find("${") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 2..];
        match (after.find(":-"), after.find('}')) {
            (Some(d), Some(end)) if d < end && after[..d].chars().all(|c| c.is_ascii_alphanumeric() || c == '_') => {
                out.push_str(&after[d + 2..end]);
                rest = &after[end + 1..];
            }
            _ => {
                out.push_str("${");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // a helper in ~15 lines of Python: echo, an event, a failure, a crash on demand
    const HELPER: &str = r#"
import json, sys
print("starting up", file=sys.stderr, flush=True)
n = 0
for line in sys.stdin:
    m = json.loads(line); n += 1
    if m["method"] == "echo":
        print(json.dumps({"id": m["id"], "result": {"got": m["params"], "calls": n}}), flush=True)
    elif m["method"] == "notify":
        print(json.dumps({"event": "ping", "data": {"n": n}}), flush=True)
        print(json.dumps({"id": m["id"], "result": None}), flush=True)
    elif m["method"] == "fail":
        print(json.dumps({"id": m["id"], "error": {"message": "no such thing"}}), flush=True)
    elif m["method"] == "die":
        sys.exit(3)
    elif m["method"] == "silent":
        pass
"#;

    #[test]
    fn a_missing_program_is_named_not_an_os_error() {
        let gone = std::io::Error::from(std::io::ErrorKind::NotFound);
        let said = spawn_failed("\"$KANDINSKY_PLUGIN_DIR/bin/$KANDINSKY_PLUGIN_TARGET/email\" --serve", &gone);
        assert!(said.starts_with(&format!("its program bin/{}/email is not on this computer", plugins::target())), "{said}");
        assert!(!said.contains("os error"));
        // a run line with a shell default (the dav and email manifests): the default is what was looked for
        let said = spawn_failed("\"${KANDINSKY_PLUGIN_BIN:-$KANDINSKY_PLUGIN_DIR/bin/$KANDINSKY_PLUGIN_TARGET}/dav\" serve", &gone);
        assert!(said.starts_with(&format!("its program bin/{}/dav is not on this computer", plugins::target())), "{said}");
        assert_eq!(shell_defaults("a ${X} ${Y:-b}/c ${bad name:-z}"), "a ${X} b/c ${bad name:-z}");
        let other = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert_eq!(spawn_failed("x", &other), other.to_string());
    }

    fn vault() -> tempfile::TempDir {
        let t = tempfile::tempdir().unwrap();
        let d = t.path().join(".kandinsky/plugins/h");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("helper.py"), HELPER).unwrap();
        std::fs::write(d.join("plugin.toml"), "title = \"H\"\n[helper]\nrun = \"python3 -u \\\"$KANDINSKY_PLUGIN_DIR/helper.py\\\"\"\n").unwrap();
        t
    }

    #[tokio::test]
    async fn a_helper_stays_alive_between_calls_sends_events_and_is_restarted_after_it_dies() {
        let t = vault();
        let bus = EventBus::default();
        let mut events = bus.subscribe();
        let h = Helpers::new(t.path(), bus);
        assert_eq!(h.state("h"), "stopped");
        let a = h.call("h", "echo", json!({ "x": 1 }), CALL_TIMEOUT).await.unwrap();
        let b = h.call("h", "echo", json!("two"), CALL_TIMEOUT).await.unwrap();
        assert_eq!((a, b), (json!({ "got": { "x": 1 }, "calls": 1 }), json!({ "got": "two", "calls": 2 })), "one process: it counted both calls");
        assert_eq!(h.state("h"), "running");

        h.call("h", "notify", Value::Null, CALL_TIMEOUT).await.unwrap();
        assert_eq!(events.recv().await.unwrap(), Event::Plugin { plugin: "h".into(), event: "ping".into(), data: json!({ "n": 3 }) });

        let e = h.call("h", "fail", Value::Null, CALL_TIMEOUT).await.unwrap_err().to_string();
        assert!(e.contains("no such thing"), "{e}");
        let e = h.call("h", "silent", Value::Null, Duration::from_millis(300)).await.unwrap_err().to_string();
        assert!(e.contains("no answer"), "{e}");

        // it dies in the middle of a call: the call fails, the next one starts a new process
        let e = h.call("h", "die", Value::Null, CALL_TIMEOUT).await.unwrap_err().to_string();
        assert!(e.contains("exited") || e.contains("went away"), "{e}");
        loop {
            if let Event::Plugin { event, .. } = events.recv().await.unwrap() {
                if event == "helper:exit" {
                    break;
                }
            }
        }
        assert_eq!(h.state("h"), "stopped");
        assert_eq!(h.call("h", "echo", json!(1), CALL_TIMEOUT).await.unwrap(), json!({ "got": 1, "calls": 1 }), "a new process, counting from one");

        let log = std::fs::read_to_string(t.path().join(".kandinsky/cache/plugins/h.log")).unwrap();
        assert!(log.contains("starting up") && log.contains("helper exited"), "{log}");
        h.stop("h");
        assert_eq!(h.state("h"), "stopped");
        // no [helper] in the manifest: a clear refusal
        std::fs::write(t.path().join(".kandinsky/plugins/h/plugin.toml"), "title = \"H\"\n").unwrap();
        let e = h.call("h", "echo", Value::Null, CALL_TIMEOUT).await.unwrap_err().to_string();
        assert!(e.contains("[helper]"), "{e}");
    }

    /// `[helper] idle`: stopped after that long with no call (never in the middle of one), started again by the next.
    #[tokio::test]
    async fn an_idle_helper_is_stopped_and_started_again_by_the_next_call() {
        let t = vault();
        let h = Helpers::new(t.path(), EventBus::default());
        h.call("h", "echo", json!(1), CALL_TIMEOUT).await.unwrap();
        let r = h.running("h").unwrap();
        h.stop_when_idle("h", &r, Duration::from_millis(150));
        // a call in flight longer than the idle time keeps it
        let e = h.call("h", "silent", Value::Null, Duration::from_millis(300)).await.unwrap_err().to_string();
        assert!(e.contains("no answer"), "{e}");
        assert_eq!(h.state("h"), "running", "not stopped while a call waited");
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert_eq!(h.state("h"), "stopped");
        assert_eq!(h.call("h", "echo", json!(2), CALL_TIMEOUT).await.unwrap()["calls"], 1, "a new process");
        let log = std::fs::read_to_string(t.path().join(".kandinsky/cache/plugins/h.log")).unwrap();
        assert!(log.contains("[helper] idle"), "{log}");

        std::fs::write(t.path().join(".kandinsky/plugins/h/plugin.toml"), "title = \"H\"\n[helper]\nrun = \"true\"\nidle = \"10m\"\n").unwrap();
        assert_eq!(plugins::helper_idle(t.path(), "h"), Ok(Some(Duration::from_secs(600))));
        std::fs::write(t.path().join(".kandinsky/plugins/h/plugin.toml"), "title = \"H\"\n[helper]\nrun = \"true\"\nidle = \"soon\"\n").unwrap();
        assert!(plugins::helper_idle(t.path(), "h").unwrap_err().contains("not a length"));
    }

    /// `[helper] js`: the same calls, events, failures and idle stop as a process, from a script run in the core.
    #[tokio::test]
    async fn a_js_helper_is_called_like_a_process_and_stopped_when_idle() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path().join(".kandinsky/plugins/j");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("plugin.toml"), "title = \"J\"\n[helper]\njs = \"helper.js\"\n").unwrap();
        std::fs::write(
            d.join("helper.js"),
            r#"let n = 0;
kandinsky.method("echo", (p) => ({ got: p, calls: ++n }));
kandinsky.method("notify", () => { kandinsky.event("ping", { n: ++n }); return null; });
kandinsky.method("fail", () => { throw new kandinsky.KandinskyError("no such thing"); });
kandinsky.method("spin", () => { for (;;) {} });"#,
        )
        .unwrap();
        let bus = EventBus::default();
        let mut events = bus.subscribe();
        let h = Helpers::new(t.path(), bus);
        assert_eq!(h.call("j", "echo", json!(1), CALL_TIMEOUT).await.unwrap(), json!({ "got": 1, "calls": 1 }));
        h.call("j", "notify", Value::Null, CALL_TIMEOUT).await.unwrap();
        assert_eq!(events.recv().await.unwrap(), Event::Plugin { plugin: "j".into(), event: "ping".into(), data: json!({ "n": 2 }) });
        assert!(h.call("j", "fail", Value::Null, CALL_TIMEOUT).await.unwrap_err().to_string().ends_with("plugin j: fail: no such thing"));

        let r = h.running("j").unwrap();
        h.stop_when_idle("j", &r, Duration::from_millis(100));
        drop(r);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(h.state("j"), "stopped");
        assert_eq!(h.call("j", "echo", json!(2), CALL_TIMEOUT).await.unwrap()["calls"], 1, "a new context");
        let log = std::fs::read_to_string(t.path().join(".kandinsky/cache/plugins/j.log")).unwrap();
        assert!(log.contains("helper.js (JavaScript, in the core)") && log.contains("[helper] idle"), "{log}");

        std::fs::write(d.join("plugin.toml"), "title = \"J\"\n[helper]\njs = \"../x.js\"\n").unwrap();
        assert!(h.call("j", "echo", json!(3), CALL_TIMEOUT).await.unwrap_err().to_string().contains("inside the plugin's folder"));
    }

    /// An update rewrites plugin.toml under a running helper: the next call gets the new helper, not the old one.
    #[tokio::test]
    async fn a_helper_is_restarted_once_its_plugin_is_updated() {
        let t = vault();
        let h = Helpers::new(t.path(), EventBus::default());
        h.call("h", "echo", json!(1), CALL_TIMEOUT).await.unwrap();
        assert_eq!(h.call("h", "echo", json!(2), CALL_TIMEOUT).await.unwrap()["calls"], 2);
        let toml = t.path().join(".kandinsky/plugins/h/plugin.toml");
        let f = std::fs::File::options().append(true).open(&toml).unwrap();
        f.set_modified(std::time::SystemTime::now() + Duration::from_secs(5)).unwrap();
        assert_eq!(h.call("h", "echo", json!(3), CALL_TIMEOUT).await.unwrap()["calls"], 1, "a new process, counting from one");
        h.stop("h");
    }

    /// A helper is any program speaking the protocol, not only a script: here one compiled from Rust, found by
    /// `$KANDINSKY_PLUGIN_TARGET` as a plugin carrying builds for several platforms would.
    #[tokio::test]
    async fn a_compiled_helper_runs_like_a_script() {
        let t = vault();
        let d = t.path().join(".kandinsky/plugins/h");
        let src = d.join("helper.rs");
        std::fs::write(&src, r#"use std::io::BufRead;
fn main() {
    for l in std::io::stdin().lock().lines() {
        let l = l.unwrap();
        let id: String = l.split("\"id\":").nth(1).unwrap().chars().take_while(|c| c.is_ascii_digit()).collect();
        println!("{{\"id\":{id},\"result\":\"{}\"}}", std::env::var("KANDINSKY_PLUGIN_TARGET").unwrap());
    }
}"#).unwrap();
        let out = d.join("bin").join(plugins::target());
        std::fs::create_dir_all(&out).unwrap();
        let built = std::process::Command::new(std::env::var("RUSTC").unwrap_or("rustc".into()))
            .arg("-O").arg("-o").arg(out.join(format!("helper{}", std::env::consts::EXE_SUFFIX))).arg(&src).status().unwrap();
        assert!(built.success(), "rustc");
        std::fs::write(d.join("plugin.toml"), "title = \"H\"\n[helper]\nrun = \"\\\"$KANDINSKY_PLUGIN_DIR/bin/$KANDINSKY_PLUGIN_TARGET/helper\\\"\"\n").unwrap();
        let h = Helpers::new(t.path(), EventBus::default());
        assert_eq!(h.call("h", "anything", Value::Null, CALL_TIMEOUT).await.unwrap(), json!(plugins::target()));
        h.stop("h");
    }

    /// A helper that cannot start (its program missing on this machine) says why in the call's error, not a broken pipe.
    #[tokio::test]
    async fn a_helper_that_dies_at_once_tells_why_in_the_error() {
        let t = vault();
        std::fs::write(t.path().join(".kandinsky/plugins/h/plugin.toml"), "title = \"H\"\n[helper]\nrun = \"echo 'bin/x86_64-linux/h: not found' >&2; exit 127\"\n").unwrap();
        let h = Helpers::new(t.path(), EventBus::default());
        let e = h.call("h", "echo", Value::Null, Duration::from_secs(5)).await.unwrap_err().to_string();
        assert!(e.contains("not found"), "{e}");
        h.stop("h");
    }

    #[tokio::test]
    async fn a_helper_that_keeps_dying_is_left_stopped() {
        let t = vault();
        std::fs::write(t.path().join(".kandinsky/plugins/h/plugin.toml"), "title = \"H\"\n[helper]\nrun = \"exit 1\"\n").unwrap();
        let h = Helpers::new(t.path(), EventBus::default());
        let mut last = String::new();
        for _ in 0..CRASH_LIMIT + 2 {
            last = h.call("h", "echo", Value::Null, Duration::from_secs(5)).await.unwrap_err().to_string();
            // let the exit be noticed before asking again
            for _ in 0..200 {
                if h.state("h") != "running" {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
        assert!(last.contains("left stopped"), "{last}");
        assert_eq!(h.state("h"), "crashed");
        h.stop("h"); // "restart": the count is forgotten
        assert_eq!(h.state("h"), "stopped");
    }

    #[tokio::test]
    async fn graceful_stop_closes_stdin_so_helper_exits_cleanly_before_kill_fallback() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path().join(".kandinsky/plugins/g");
        std::fs::create_dir_all(&d).unwrap();
        let out = d.join("bin").join(crate::plugins::target());
        std::fs::create_dir_all(&out).unwrap();
        let src = d.join("helper.rs");
        std::fs::write(
            &src,
            r#"use std::io::BufRead;
fn main() {
    for l in std::io::stdin().lock().lines() {
        let l = l.unwrap();
        let id: String = l.split("\"id\":").nth(1).unwrap().chars().take_while(|c| c.is_ascii_digit()).collect();
        println!("{{\"id\":{id},\"result\":true}}");
    }
    eprintln!("graceful-eof");
}"#,
        )
        .unwrap();
        let built = std::process::Command::new(std::env::var("RUSTC").unwrap_or("rustc".into()))
            .arg("-o")
            .arg(out.join(format!("helper{}", std::env::consts::EXE_SUFFIX)))
            .arg(&src)
            .status()
            .unwrap();
        assert!(built.success(), "rustc");
        std::fs::write(d.join("plugin.toml"), "title = \"G\"\n[helper]\nrun = \"\\\"$KANDINSKY_PLUGIN_DIR/bin/$KANDINSKY_PLUGIN_TARGET/helper\\\"\"\n").unwrap();
        let bus = EventBus::default();
        let mut events = bus.subscribe();
        let h = Helpers::new(t.path(), bus);
        assert_eq!(h.call("g", "ping", Value::Null, CALL_TIMEOUT).await.unwrap(), json!(true));
        h.stop("g");
        loop {
            if let Event::Plugin { event, data, .. } = events.recv().await.unwrap() {
                if event == "helper:exit" {
                    let status = data["status"].as_str().unwrap_or("");
                    assert!(status.ends_with(" 0"), "expected clean exit 0, got {status}");
                    break;
                }
            }
        }
        let log = std::fs::read_to_string(t.path().join(".kandinsky/cache/plugins/g.log")).unwrap();
        assert!(log.contains("graceful-eof"), "helper did not observe stdin EOF before kill: {log}");
    }

    /// Compiles `code` into plugin `id`'s helper in vault `root` (`bin/<target>/helper`), its manifest pointing at it.
    fn compiled_helper(root: &Path, id: &str, code: &str) {
        let d = root.join(".kandinsky/plugins").join(id);
        let out = d.join("bin").join(crate::plugins::target());
        std::fs::create_dir_all(&out).unwrap();
        let src = d.join("helper.rs");
        std::fs::write(&src, code).unwrap();
        let built = std::process::Command::new(std::env::var("RUSTC").unwrap_or("rustc".into()))
            .arg("-o")
            .arg(out.join(format!("helper{}", std::env::consts::EXE_SUFFIX)))
            .arg(&src)
            .status()
            .unwrap();
        assert!(built.success(), "rustc");
        std::fs::write(d.join("plugin.toml"), "title = \"G\"\n[helper]\nrun = \"\\\"$KANDINSKY_PLUGIN_DIR/bin/$KANDINSKY_PLUGIN_TARGET/helper\\\"\"\nstart = \"open\"\n").unwrap();
    }

    const ANSWERS: &str = r#"use std::io::BufRead;
fn main() {
    for l in std::io::stdin().lock().lines() {
        let l = l.unwrap();
        let id: String = l.split("\"id\":").nth(1).unwrap().chars().take_while(|c| c.is_ascii_digit()).collect();
        println!("{{\"id\":{id},\"result\":true}}");
    }
}"#;

    async fn state_soon(h: &Helpers, id: &str, want: &str) -> &'static str {
        for _ in 0..500 {
            if h.state(id) == want {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        h.state(id)
    }

    /// A helper started with the vault that cannot start before a window is there (its program awaits approval) is
    /// not given up: it is tried again as windows connect, until it starts, and only while it still starts with the vault.
    #[tokio::test]
    async fn a_helper_that_could_not_start_with_the_vault_starts_when_a_window_connects() {
        let t = tempfile::tempdir().unwrap();
        compiled_helper(t.path(), "g", ANSWERS);
        let bin = t.path().join(".kandinsky/plugins/g/bin");
        let away = t.path().join("bin-away");
        std::fs::rename(&bin, &away).unwrap(); // its starts fail
        let h = Helpers::new(t.path(), EventBus::default());
        h.start_with_vault(vec!["g".into()]);
        assert_eq!(h.state("g"), "stopped");
        h.window_seen(); // fails again (not the user's Deny): kept for the next window
        for _ in 0..500 {
            if !h.deferred.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(h.deferred.lock().unwrap().as_slice(), ["g"], "kept after a failed retry");
        std::fs::rename(&away, &bin).unwrap();
        h.window_seen();
        assert_eq!(state_soon(&h, "g", "running").await, "running", "started once a window connected");
        assert!(h.deferred.lock().unwrap().is_empty());
        h.stop("g");
        h.window_seen(); // another window: nothing left to start
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(h.state("g"), "stopped", "started once, not at every window");

        // switched off before any window came: never started by one
        std::fs::rename(&bin, &away).unwrap();
        h.start_with_vault(vec!["g".into()]);
        std::fs::rename(&away, &bin).unwrap();
        std::fs::write(t.path().join(".kandinsky/config.toml"), "[plugins]\noff = [\"g\"]\n").unwrap();
        h.window_seen();
        let log = || std::fs::read_to_string(t.path().join(".kandinsky/cache/plugins/g.log")).unwrap_or_default();
        for _ in 0..500 {
            if log().contains("no longer started with the vault") {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(log().contains("no longer started with the vault"), "{}", log());
        assert_eq!(h.state("g"), "stopped", "a switched-off plugin's helper started");
        assert!(h.deferred.lock().unwrap().is_empty(), "dropped, not kept for later");
    }

    /// A helper that exits on stdin EOF but left a process of its own running: the stop still ends that process (a
    /// process group on Unix, a job object on Windows).
    #[tokio::test]
    async fn a_stopped_helper_takes_the_processes_it_left_behind_with_it() {
        let t = tempfile::tempdir().unwrap();
        compiled_helper(
            t.path(),
            "g",
            r#"use std::io::BufRead;
fn main() {
    if std::env::args().nth(1).as_deref() == Some("linger") {
        std::thread::sleep(std::time::Duration::from_secs(120));
        return;
    }
    // started at the first call, as a worker would be
    let mut child = None;
    for l in std::io::stdin().lock().lines() {
        let child = child.get_or_insert_with(|| std::process::Command::new(std::env::current_exe().unwrap()).arg("linger")
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .spawn().unwrap());
        let l = l.unwrap();
        let id: String = l.split("\"id\":").nth(1).unwrap().chars().take_while(|c| c.is_ascii_digit()).collect();
        println!("{{\"id\":{id},\"result\":{}}}", child.id());
    }
}"#,
        );
        let h = Helpers::new(t.path(), EventBus::default());
        let child = h.call("g", "pid", Value::Null, CALL_TIMEOUT).await.unwrap().as_u64().unwrap() as u32;
        assert!(crate::platform::proc::pid_alive(child));
        h.stop("g");
        for _ in 0..500 {
            if !crate::platform::proc::pid_alive(child) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(!crate::platform::proc::pid_alive(child), "the helper's own child outlived its stop");
    }

    /// A call answered with bytes (a thumbnail) reaches the helper as those bytes, not a text that lost them.
    #[tokio::test]
    async fn a_call_answered_with_bytes_keeps_them() {
        let jpg = vec![0xff_u8, 0xd8, 0xff, 0x00, 0x10];
        let body = jpg.clone();
        let routes = axum::Router::new()
            .route("/api/thumb", axum::routing::get(move || async move { body }))
            .route("/api/x", axum::routing::get(|| async { axum::Json(json!({ "a": 1 })) }));
        let call = |path: &str| crate::helper_api::Call::parse(json!({ "call": 1, "verb": "GET", "path": path }).as_object().unwrap()).unwrap().unwrap();
        assert!(matches!(answer_call(Some(routes.clone()), "h", call("/api/thumb")).await, (200, CallReply::Bytes(b)) if b == jpg));
        assert!(matches!(answer_call(Some(routes), "h", call("/api/x")).await, (200, CallReply::Json(v)) if v == json!({ "a": 1 })));
    }
}
