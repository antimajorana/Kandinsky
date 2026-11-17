// Oracle Physics Runner helper (QuickJS):
// Executes Jupyter (.ipynb) cells in a stateful Python kernel,
// runs deterministic c_lint checks, and files accepted results via oracle_wiki.py.

const NODE_ORACLE_ENV = `
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ORACLE_HOME = os.homedir();
const ORACLE_RESEARCH_DIR = process.env.ORACLE_RESEARCH_DIR || path.join(ORACLE_HOME, "Documents", "GitHub", "oracle-research");
const PY_BIN = process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python");
const ORACLE_PY = process.env.ORACLE_PYTHON || path.join(ORACLE_RESEARCH_DIR, "env", PY_BIN);
const C_LINT_PY = path.join(ORACLE_RESEARCH_DIR, "framework", "tools", "c_lint.py");
const ORACLE_WIKI_PY = path.join(ORACLE_RESEARCH_DIR, "framework", "tools", "oracle_wiki.py");
const VENV_JUPYTER = path.join(ORACLE_HOME, ".venvs", "jupyter", PY_BIN);
const VENV_JUPYTER314 = path.join(ORACLE_HOME, ".venvs", "jupyter314", PY_BIN);
function isInsideVault(vaultRoot, resolved) {
  const baseCmp = process.platform === "win32" ? path.resolve(vaultRoot).toLowerCase() : path.resolve(vaultRoot);
  const tgtCmp = process.platform === "win32" ? path.resolve(resolved).toLowerCase() : path.resolve(resolved);
  const rel = path.relative(baseCmp, tgtCmp);
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !rel.startsWith("../") && !path.isAbsolute(rel);
}
function resolveInVault(vaultRoot, rawPath) {
  const clean = String(rawPath || "").trim().replace(/\\\\/g, "/").replace(/^\\/+/, "");
  if (!clean) return "";
  const resolved = path.resolve(vaultRoot, clean);
  return isInsideVault(vaultRoot, resolved) ? resolved : "";
}
`.trim();

const JUPYTER_NODE_SCRIPT = `
${NODE_ORACLE_ENV}
const { spawnSync } = require("node:child_process");

const rawIn = fs.readFileSync(0, "utf8");
const req = JSON.parse(rawIn || "{}");
const cells = Array.isArray(req.cells) ? req.cells : [];
const requestedKernel = String(req.kernel || "auto");
const hasTenpyOrQutip = cells.some((c) => /\\b(tenpy|qutip)\\b/.test(String((c && c.source) || "")));
const want314 = requestedKernel === "jupyter314" || (requestedKernel === "auto" && hasTenpyOrQutip);

const candidates = want314
  ? [
      { exe: VENV_JUPYTER314, label: "jupyter314" },
      { exe: VENV_JUPYTER, label: "jupyter" },
      { exe: ORACLE_PY, label: "oracle-env" },
      { exe: "python", label: "python" },
    ]
  : [
      { exe: VENV_JUPYTER, label: "jupyter" },
      { exe: VENV_JUPYTER314, label: "jupyter314" },
      { exe: ORACLE_PY, label: "oracle-env" },
      { exe: "python", label: "python" },
    ];

let picked = candidates[candidates.length - 1];
for (const cand of candidates) {
  if (cand.exe === "python" || fs.existsSync(cand.exe)) {
    picked = cand;
    break;
  }
}

const vaultRoot = process.cwd();
let workCwd = vaultRoot;
if (req.path) {
  const absNb = resolveInVault(vaultRoot, req.path);
  if (absNb) {
    const nbDir = path.dirname(absNb);
    if (isInsideVault(vaultRoot, nbDir) && fs.existsSync(nbDir)) {
      workCwd = nbDir;
    }
  }
}

const pyRunner = [
  "import ast, base64, contextlib, io, json, os, sys, time, traceback",
  "os.environ.setdefault('MPLBACKEND', 'Agg')",
  "payload = json.loads(sys.stdin.read() or '{}')",
  "cells = payload.get('cells') or []",
  "ns = {'__name__': '__main__'}",
  "results = []",
  "exec_count = 0",
  "",
  "def _capture_rich(val):",
  "    items = []",
  "    if val is None:",
  "        return items",
  "    for attr, mime in (('_repr_svg_', 'image/svg+xml'), ('_repr_png_', 'image/png'), ('_repr_latex_', 'text/latex'), ('_repr_markdown_', 'text/markdown')):",
  "        fn = getattr(val, attr, None)",
  "        if callable(fn):",
  "            try:",
  "                out = fn()",
  "                if out is not None:",
  "                    if isinstance(out, tuple):",
  "                        out = out[0]",
  "                    if isinstance(out, bytes):",
  "                        out = base64.b64encode(out).decode('ascii')",
  "                    items.append({'mime': mime, 'data': str(out)})",
  "            except Exception:",
  "                pass",
  "    return items",
  "",
  "def _capture_figures():",
  "    figs = []",
  "    plt = sys.modules.get('matplotlib.pyplot')",
  "    if plt is not None:",
  "        try:",
  "            plt.show = lambda *a, **kw: None",
  "            for num in list(plt.get_fignums()):",
  "                fig = plt.figure(num)",
  "                buf = io.BytesIO()",
  "                fig.savefig(buf, format='png', dpi=144, bbox_inches='tight')",
  "                figs.append({'mime': 'image/png', 'data': base64.b64encode(buf.getvalue()).decode('ascii')})",
  "            plt.close('all')",
  "        except Exception:",
  "            pass",
  "    return figs",
  "",
  "for item in cells:",
  "    idx = item.get('index', 0)",
  "    src = str(item.get('source') or '')",
  "    if not src.strip():",
  "        results.append({'index': idx, 'execution_count': None, 'stdout': '', 'stderr': '', 'result_text': None, 'displays': [], 'error': None, 'ms': 0})",
  "        continue",
  "    exec_count += 1",
  "    out_buf = io.StringIO()",
  "    err_buf = io.StringIO()",
  "    t0 = time.perf_counter()",
  "    err_info = None",
  "    res_text = None",
  "    displays = []",
  "    try:",
  "        with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):",
  "            mod = ast.parse(src, filename=f'<cell-{idx}>', mode='exec')",
  "            last_expr = None",
  "            if mod.body and isinstance(mod.body[-1], ast.Expr):",
  "                last_node = mod.body.pop()",
  "                last_expr = ast.Expression(last_node.value)",
  "                ast.fix_missing_locations(mod)",
  "                ast.fix_missing_locations(last_expr)",
  "            if mod.body:",
  "                exec(compile(mod, f'<cell-{idx}>', 'exec'), ns)",
  "            plt_mod = sys.modules.get('matplotlib.pyplot')",
  "            if plt_mod is not None:",
  "                plt_mod.show = lambda *a, **kw: None",
  "            if last_expr is not None:",
  "                val = eval(compile(last_expr, f'<cell-{idx}>', 'eval'), ns)",
  "                if val is not None:",
  "                    res_text = repr(val)",
  "                    displays.extend(_capture_rich(val))",
  "            displays.extend(_capture_figures())",
  "    except BaseException as exc:",
  "        displays.extend(_capture_figures())",
  "        err_info = {'ename': type(exc).__name__, 'evalue': str(exc), 'traceback': traceback.format_exc()}",
  "    ms = round((time.perf_counter() - t0) * 1000)",
  "    results.append({",
  "        'index': idx,",
  "        'execution_count': exec_count,",
  "        'stdout': out_buf.getvalue(),",
  "        'stderr': err_buf.getvalue(),",
  "        'result_text': res_text,",
  "        'displays': displays,",
  "        'error': err_info,",
  "        'ms': ms,",
  "    })",
  "",
  "sys.stdout.write('__ORACLE_NB_JSON__' + json.dumps({'results': results}, ensure_ascii=False))",
].join("\\n");

const run = spawnSync(picked.exe, ["-X", "utf8", "-c", pyRunner], {
  cwd: workCwd,
  input: JSON.stringify({ cells }),
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true,
});

const rawOut = String(run.stdout || "");
const marker = "__ORACLE_NB_JSON__";
const pos = rawOut.lastIndexOf(marker);
if (pos >= 0) {
  const parsed = JSON.parse(rawOut.slice(pos + marker.length));
  process.stdout.write(JSON.stringify({
    ok: true,
    kernel: picked.label,
    pythonExe: picked.exe,
    results: parsed.results || [],
  }));
} else {
  process.stdout.write(JSON.stringify({
    ok: false,
    kernel: picked.label,
    pythonExe: picked.exe,
    error: String(run.stderr || run.error || "Python kernel failed to return output.").trim(),
    results: [],
  }));
}
`;

async function runJupyterNotebook(params = {}) {
  const cells = Array.isArray(params.cells)
    ? params.cells
    : [{ index: Number(params.index || 0), source: String(params.source || "") }];
  const timeout = Math.min(600, Math.max(30, Number(params.timeout || 180)));
  const r = await kandinsky.exec(
    "node",
    ["-e", JUPYTER_NODE_SCRIPT],
    {
      stdin: JSON.stringify({
        path: params.path || "",
        kernel: params.kernel || "auto",
        cells,
      }),
      timeout,
    },
  );
  if (r.stdout) {
    try {
      return JSON.parse(r.stdout.trim());
    } catch {}
  }
  return {
    ok: false,
    kernel: String(params.kernel || "auto"),
    error: String(r.stderr || (r.timedOut ? "Jupyter execution timed out." : "Jupyter execution failed.")).trim(),
    results: [],
  };
}

async function runJupyterCell(params = {}) {
  const cells = Array.isArray(params.cells)
    ? params.cells
    : [{ index: Number(params.index || 0), source: String(params.source || "") }];
  return runJupyterNotebook({ ...params, cells });
}

const CLINT_NODE_SCRIPT = `
${NODE_ORACLE_ENV}
const { spawnSync } = require("node:child_process");

const req = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const vaultRoot = process.cwd();
const notePath = resolveInVault(vaultRoot, req.path);
const pyExe = fs.existsSync(ORACLE_PY) ? ORACLE_PY : "python";
const cLintPy = C_LINT_PY;

if (!notePath || !fs.existsSync(notePath) || !fs.statSync(notePath).isFile()) {
  process.stdout.write(JSON.stringify({
    clean: false,
    issues: [{ line: 1, code: "MISSING_FILE", severity: "ERROR", message: "Note file not found on disk: " + String(req.path || "") }],
    raw: "File not found: " + String(notePath || req.path || ""),
  }));
  process.exit(0);
}

const args = ["-X", "utf8", cLintPy, "--json"];
if (req.anyLayout !== false) args.push("--any-layout");
if (req.strict === true) args.push("--strict");
args.push(notePath);

const run = spawnSync(pyExe, args, {
  cwd: vaultRoot,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
  windowsHide: true,
});

const rawOut = String(run.stdout || "").trim();
const rawErr = String(run.stderr || "").trim();
let parsed = null;
try {
  parsed = rawOut ? JSON.parse(rawOut) : null;
} catch {}

if (parsed && typeof parsed === "object") {
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const issues = findings.map((f) => ({
    line: typeof f.line === "number" ? f.line : 1,
    code: f.code ? String(f.code) : "LINT",
    severity: f.severity ? String(f.severity) : "ERROR",
    message: String(f.message || ""),
  }));
  const clean = Boolean(parsed.pass) && issues.length === 0 && run.status === 0;
  process.stdout.write(JSON.stringify({
    clean,
    pass: Boolean(parsed.pass),
    issues,
    checks: parsed.checks || null,
    raw: rawOut || rawErr,
  }));
} else {
  const msg = rawErr || rawOut || "c_lint exited unexpectedly.";
  process.stdout.write(JSON.stringify({
    clean: false,
    pass: false,
    issues: [{ line: 1, code: "CLINT_ERR", severity: "ERROR", message: msg }],
    checks: null,
    raw: msg,
  }));
}
`;

async function runCLint(params = {}) {
  const r = await kandinsky.exec(
    "node",
    ["-e", CLINT_NODE_SCRIPT],
    {
      stdin: JSON.stringify({
        path: params.path || "",
        anyLayout: params.anyLayout !== false,
        strict: Boolean(params.strict),
      }),
      timeout: 60,
    },
  );
  if (r.stdout) {
    try {
      return JSON.parse(r.stdout.trim());
    } catch {}
  }
  const fallbackMsg = String(r.stderr || "c_lint execution failed.").trim();
  return {
    clean: false,
    issues: [{ line: 1, code: "EXEC_ERR", severity: "ERROR", message: fallbackMsg }],
    raw: fallbackMsg,
  };
}

const FILE_WIKI_NODE_SCRIPT = `
${NODE_ORACLE_ENV}
const { spawnSync } = require("node:child_process");

const req = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const vaultRoot = process.cwd();
const pyExe = fs.existsSync(ORACLE_PY) ? ORACLE_PY : "python";
const wikiPy = ORACLE_WIKI_PY;

function stripFrontmatter(text) {
  return String(text || "").replace(/^---\\r?\\n[\\s\\S]*?\\r?\\n---(?:\\r?\\n|$)/, "");
}

function sanitizePlainLabel(raw, fallback) {
  let s = String(raw || "").trim().replace(/\\\\/g, "/");
  s = s.replace(/\\.md$/i, "");
  s = s.replace(/[<>:"/\\\\|?*\\[\\]\`|]+/g, " ").replace(/\\s+/g, " ").trim();
  return s || fallback;
}

function extractProblemLabel(rawProb, rawComp) {
  const p = String(rawProb || "").trim().replace(/\\\\/g, "/").replace(/^\\/+|\\/+$/g, "");
  if (p) {
    const parts = p.split("/");
    if (parts[0].toLowerCase() === "problems" && parts.length >= 2) {
      return sanitizePlainLabel(parts[1], "General");
    }
    return sanitizePlainLabel(parts[parts.length - 1], "General");
  }
  const c = String(rawComp || "").trim().replace(/\\\\/g, "/");
  const m = /^problems\\/([^/]+)\\//i.exec(c);
  if (m) return sanitizePlainLabel(m[1], "General");
  return "General";
}

function extractCompLabel(rawComp) {
  const base = path.basename(String(rawComp || "").replace(/\\\\/g, "/")).replace(/\\.md$/i, "");
  const mCnn = /^(C\\d+)\\b/i.exec(base);
  if (mCnn) return mCnn[1].toUpperCase();
  return sanitizePlainLabel(base, "C01");
}

function extractSynthesisBody(noteText, fallbackSummary) {
  const body = stripFrontmatter(noteText).trim();
  if (!body) return String(fallbackSummary || "").trim();
  const kept = [];
  for (const label of ["Result", "What it means"]) {
    const re = new RegExp("^##\\\\s*(?:\\\\d+\\\\.?\\\\s*)?" + label + "\\\\b[^\\\\n]*\\\\n([\\\\s\\\\S]*?)(?=^##\\\\s|(?![\\\\s\\\\S]))", "mi");
    const m = re.exec(body);
    if (m && m[1].trim()) {
      kept.push("## " + label + "\\n\\n" + m[1].trim());
    }
  }
  return kept.length > 0 ? kept.join("\\n\\n") : body;
}

let tmpDir = "";
try {
  const compPathCand = req.computation ? resolveInVault(vaultRoot, req.computation) : "";
  let noteText = "";
  if (compPathCand && fs.existsSync(compPathCand) && fs.statSync(compPathCand).isFile()) {
    noteText = fs.readFileSync(compPathCand, "utf8");
  } else if (req.notePath) {
    const np = resolveInVault(vaultRoot, req.notePath);
    if (np && fs.existsSync(np) && fs.statSync(np).isFile()) {
      noteText = fs.readFileSync(np, "utf8");
    }
  }

  const synthBody = String(req.body || "").trim() || extractSynthesisBody(noteText, req.summary);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-wiki-body-"));
  const bodyFile = path.join(tmpDir, "body.md");
  fs.writeFileSync(bodyFile, (synthBody || String(req.summary || "").trim()) + "\\n", "utf8");

  const problemLabel = extractProblemLabel(req.problem, req.computation);
  const compLabel = extractCompLabel(req.computation);
  const destClean = String(req.dest || "").trim().replace(/\\\\/g, "/").replace(/\\.md$/i, "");

  const args = [
    "-X", "utf8", wikiPy, "file-computation",
    "--vault", vaultRoot,
    "--problem", problemLabel,
    "--computation", compLabel,
    "--dest", destClean,
    "--title", String(req.title || "").trim(),
    "--summary", String(req.summary || "").trim(),
    "--accepted-words", String(req.acceptedWords || "").trim(),
    "--accepted-date", String(req.acceptedDate || "").trim(),
    "--body-file", bodyFile,
  ];
  if (req.type) args.push("--type", String(req.type).trim());
  if (req.replace === true) args.push("--replace");

  const run = spawnSync(pyExe, args, {
    cwd: vaultRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const exitCode = typeof run.status === "number" ? run.status : 1;
  process.stdout.write(JSON.stringify({
    ok: exitCode === 0,
    stdout: String(run.stdout || "").trim(),
    stderr: String(run.stderr || (run.error ? String(run.error) : "")).trim(),
    exitCode,
    destPath: destClean ? destClean + ".md" : "",
  }));
} finally {
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
`;

async function fileToWiki(params = {}) {
  const acceptedWords = String(params.acceptedWords || "").trim();
  const acceptedDate = String(params.acceptedDate || "").trim();
  const dateConfirmed = params.dateConfirmed === true;
  const fail = (stderr) => ({ ok: false, stdout: "", stderr, exitCode: 2 });

  if (!acceptedWords) return fail("Exact acceptance words from the PI are required — never invent acceptance words.");
  if (!dateConfirmed) return fail("Please explicitly confirm the acceptance date before filing to wiki/.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acceptedDate)) return fail("Acceptance date must be in YYYY-MM-DD format.");
  if (!String(params.dest || "").trim() || !String(params.title || "").trim() || !String(params.summary || "").trim()) {
    return fail("Title, destination wiki path (e.g. wiki/concepts/Name), and concise summary are required.");
  }

  const r = await kandinsky.exec("node", ["-e", FILE_WIKI_NODE_SCRIPT], { stdin: JSON.stringify(params), timeout: 180 });
  if (r.stdout) {
    try { return JSON.parse(r.stdout.trim()); } catch {}
  }
  return {
    ok: false,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || (r.timedOut ? "oracle_wiki filing timed out." : "oracle_wiki filing failed.")).trim(),
    exitCode: typeof r.status === "number" ? r.status : 1,
  };
}

kandinsky.methods({ runJupyterCell, runJupyterNotebook, runCLint, fileToWiki });
