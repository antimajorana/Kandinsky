//! Direct Python cell execution for `.ipynb` notebooks when `oracle-runner` is unavailable (e.g. default mode).
//! Resolves the vault's Python interpreter, authorizes it through `binary_trust`, and runs cells sequentially.
use crate::config::Config;
use crate::events::EventBus;
use crate::{vault_write, Error, Result};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_SECS: u64 = 120;
const MAX_TIMEOUT_SECS: u64 = 600;
const MAX_OUTPUT: usize = 16 << 20;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NotebookCellInput {
    pub index: usize,
    pub source: String,
}

#[derive(Debug, Deserialize)]
pub struct NotebookRunRequest {
    pub path: Option<String>,
    pub cells: Vec<NotebookCellInput>,
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JupyterDisplayItem {
    pub mime: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JupyterCellError {
    pub ename: String,
    pub evalue: String,
    pub traceback: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JupyterCellRunResult {
    pub index: usize,
    pub execution_count: Option<usize>,
    pub stdout: String,
    pub stderr: String,
    pub result_text: Option<String>,
    pub displays: Vec<JupyterDisplayItem>,
    pub error: Option<JupyterCellError>,
    pub ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JupyterNotebookRunResponse {
    pub ok: bool,
    pub kernel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub python_exe: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub results: Vec<JupyterCellRunResult>,
}

struct TempPayload(PathBuf);

impl Drop for TempPayload {
    fn drop(&mut self) {
        let _ = vault_write::cache::remove_file(&self.0);
    }
}

const RUNNER_PY: &str = r#"import ast, base64, contextlib, io, json, sys, time, traceback

def run_all(payload_path):
    with open(payload_path, "r", encoding="utf-8") as f:
        cells = json.load(f)
    ns = {"__name__": "__main__"}
    results = []
    ok = True
    exec_count = 0
    for cell in cells:
        idx = int(cell.get("index", 0))
        src = cell.get("source", "")
        out_buf = io.StringIO()
        err_buf = io.StringIO()
        result_text = None
        displays = []
        err_obj = None
        exec_count += 1
        t0 = time.perf_counter()
        try:
            with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
                tree = ast.parse(src, filename=f"<cell-{idx}>", mode="exec")
                if tree.body and isinstance(tree.body[-1], ast.Expr):
                    last_expr = ast.Expression(tree.body.pop().value)
                    ast.fix_missing_locations(last_expr)
                    if tree.body:
                        exec(compile(tree, f"<cell-{idx}>", "exec"), ns)
                    val = eval(compile(last_expr, f"<cell-{idx}>", "eval"), ns)
                    if val is not None:
                        result_text = repr(val)
                else:
                    exec(compile(tree, f"<cell-{idx}>", "exec"), ns)
                plt = sys.modules.get("matplotlib.pyplot")
                if plt is not None:
                    fignums = list(plt.get_fignums())
                    for num in fignums:
                        fig = plt.figure(num)
                        buf = io.BytesIO()
                        fig.savefig(buf, format="png", bbox_inches="tight")
                        displays.append({"mime": "image/png", "data": base64.b64encode(buf.getvalue()).decode("ascii")})
                    if fignums:
                        plt.close("all")
        except BaseException as exc:
            ok = False
            err_obj = {
                "ename": type(exc).__name__,
                "evalue": str(exc),
                "traceback": traceback.format_exc(),
            }
        ms = int((time.perf_counter() - t0) * 1000)
        results.append({
            "index": idx,
            "execution_count": exec_count,
            "stdout": out_buf.getvalue(),
            "stderr": err_buf.getvalue(),
            "result_text": result_text,
            "displays": displays,
            "error": err_obj,
            "ms": ms,
        })
        if err_obj is not None:
            break
    return {"ok": ok, "results": results}

if __name__ == "__main__":
    real_out = sys.stdout
    res = run_all(sys.argv[1])
    real_out.write(json.dumps(res) + "\n")
    real_out.flush()
"#;

fn env_bin_dir(env: &Path) -> PathBuf {
    if cfg!(windows) && env.join("Scripts").is_dir() {
        env.join("Scripts")
    } else {
        env.join("bin")
    }
}

fn find_python(cfg: &Config, root: &Path) -> Option<(PathBuf, Vec<(String, OsString)>)> {
    if let Some(env) = crate::python_env::chosen(cfg, root) {
        let bin = env_bin_dir(&env);
        if let Some(exe) = ["python3", "python", "python.exe"].iter().map(|n| bin.join(n)).find(|p| p.is_file()) {
            return Some((exe, crate::python_env::vars(&env)));
        }
    }
    let names: &[&str] = if cfg!(windows) { &["python", "python3"] } else { &["python3", "python"] };
    if crate::platform::host::sandboxed() {
        for name in names {
            if let Some(exe) = crate::platform::host::find(name) {
                return Some((exe, Vec::new()));
            }
        }
        return None;
    }
    let path_var = std::env::var_os("PATH")?;
    for name in names {
        if let Some(exe) = std::env::split_paths(&path_var).find_map(|dir| crate::platform::run_line::executable(&dir.join(name))) {
            return Some((exe, Vec::new()));
        }
    }
    None
}

fn resolve_cwd(root: &Path, path: Option<&str>) -> Result<PathBuf> {
    let Some(rel) = path.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(root.to_path_buf());
    };
    let abs = crate::paths::safe_join(root, rel)?;
    Ok(abs.parent().filter(|d| d.is_dir()).map(Path::to_path_buf).unwrap_or_else(|| root.to_path_buf()))
}

/// Runs notebook cells sequentially using the vault's Python interpreter (or system Python).
pub fn run(root: &Path, req: &NotebookRunRequest, bus: Option<&EventBus>) -> Result<JupyterNotebookRunResponse> {
    let cwd = resolve_cwd(root, req.path.as_deref())?;
    let cfg = Config::load(root)?;
    let Some((exe, env_vars)) = find_python(&cfg, root) else {
        return Ok(JupyterNotebookRunResponse {
            ok: false,
            kernel: "python3".into(),
            python_exe: None,
            error: Some("No Python interpreter found. Configure [lsp] python_env or install Python on PATH.".into()),
            results: Vec::new(),
        });
    };
    let exe_str = exe.to_string_lossy().into_owned();
    let py_args = ["-X".to_string(), "utf8".to_string(), "-u".to_string()];
    crate::binary_trust::authorize_blocking(root, "notebook", &exe, &py_args, bus)?;

    let payload_path = vault_write::cache::unique(&crate::state_dir::dir(root).join("cache/notebook-run")).with_extension("json");
    let payload_bytes = serde_json::to_vec(&req.cells).map_err(|e| Error::Other(e.into()))?;
    vault_write::cache::write(&payload_path, &payload_bytes)?;
    let _cleanup = TempPayload(payload_path.clone());

    let mut cmd = Command::new(&exe);
    cmd.arg("-X").arg("utf8").arg("-u").arg("-").arg(&payload_path).current_dir(&cwd);
    cmd.env("MPLBACKEND", "Agg");
    cmd.env("PYTHONIOENCODING", "utf-8");
    for (k, v) in env_vars {
        cmd.env(k, v);
    }
    let mut cmd = crate::platform::host::std_command(cmd).map_err(|e| Error::CommandFailed(format!("notebook: {e}")))?;
    crate::platform::proc::own_group_blocking(&mut cmd);

    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::CommandFailed(format!("notebook: failed to spawn {exe_str}: {e}")))?;

    let feed = child.stdin.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let _ = pipe.write_all(RUNNER_PY.as_bytes());
        })
    });
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut kept = Vec::new();
            if let Some(mut p) = pipe {
                let mut buf = [0u8; 64 << 10];
                while let Ok(n) = p.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let room = MAX_OUTPUT.saturating_sub(kept.len());
                    kept.extend_from_slice(&buf[..n.min(room)]);
                }
            }
            String::from_utf8_lossy(&kept).into_owned()
        })
    };
    let out_t = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let err_t = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));

    let limit = Duration::from_secs(req.timeout.unwrap_or(DEFAULT_TIMEOUT_SECS).clamp(1, MAX_TIMEOUT_SECS));
    let t0 = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait().map_err(|e| Error::CommandFailed(format!("notebook: {e}")))? {
            Some(s) => break Some(s),
            None if t0.elapsed() > limit => {
                timed_out = true;
                crate::platform::proc::stop_group(child.id(), crate::platform::proc::Stop::Kill);
                let _ = child.wait();
                break None;
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    if let Some(f) = feed {
        let _ = f.join();
    }
    let stdout = out_t.join().unwrap_or_default();
    let stderr = err_t.join().unwrap_or_default();

    if timed_out {
        return Ok(JupyterNotebookRunResponse {
            ok: false,
            kernel: "python3".into(),
            python_exe: Some(exe_str),
            error: Some(format!("Notebook execution timed out after {}s", limit.as_secs())),
            results: Vec::new(),
        });
    }

    #[derive(Deserialize)]
    struct RunnerOut {
        ok: bool,
        results: Vec<JupyterCellRunResult>,
    }

    let last_line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("");
    match serde_json::from_str::<RunnerOut>(last_line) {
        Ok(parsed) => Ok(JupyterNotebookRunResponse {
            ok: parsed.ok,
            kernel: "python3".into(),
            python_exe: Some(exe_str),
            error: None,
            results: parsed.results,
        }),
        Err(e) => {
            let code = status.and_then(|s| s.code()).map_or_else(|| "unknown".to_string(), |c| c.to_string());
            let detail = stderr.trim();
            let msg = if detail.is_empty() {
                format!("Python runner exited ({code}) without valid JSON: {e}")
            } else {
                format!("Python runner exited ({code}): {detail}")
            };
            Ok(JupyterNotebookRunResponse {
                ok: false,
                kernel: "python3".into(),
                python_exe: Some(exe_str),
                error: Some(msg),
                results: Vec::new(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_cwd_rejects_traversal_and_finds_notebook_parent() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("notes/calc")).unwrap();
        assert_eq!(resolve_cwd(&root, None).unwrap(), root);
        assert_eq!(resolve_cwd(&root, Some("notes/calc/demo.ipynb")).unwrap(), root.join("notes/calc"));
        assert!(matches!(resolve_cwd(&root, Some("../outside.ipynb")), Err(Error::BadPath(_))));
    }

    #[test]
    fn runs_python_cells_and_captures_results_and_errors() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        let cfg = Config::default();
        if find_python(&cfg, &root).is_none() {
            eprintln!("skipped: no Python interpreter available");
            return;
        }
        let req = NotebookRunRequest {
            path: None,
            cells: vec![
                NotebookCellInput { index: 0, source: "x = 2\nprint('hi')".into() },
                NotebookCellInput { index: 1, source: "x + 3".into() },
            ],
            timeout: Some(15),
        };
        let resp = run(&root, &req, None).unwrap();
        assert!(resp.ok, "{resp:?}");
        assert_eq!(resp.results.len(), 2);
        assert_eq!(resp.results[0].stdout.trim(), "hi");
        assert_eq!(resp.results[0].result_text, None);
        assert_eq!(resp.results[1].result_text.as_deref(), Some("5"));
        assert_eq!(resp.results[1].execution_count, Some(2));

        let err_req = NotebookRunRequest {
            path: None,
            cells: vec![NotebookCellInput { index: 0, source: "1 / 0".into() }],
            timeout: Some(15),
        };
        let err_resp = run(&root, &err_req, None).unwrap();
        assert!(!err_resp.ok);
        assert_eq!(err_resp.results.len(), 1);
        assert_eq!(err_resp.results[0].error.as_ref().map(|e| e.ename.as_str()), Some("ZeroDivisionError"));
    }
}
