// Solver Agent helper (QuickJS): checks local Solver services and launches Start-SolverAgent.ps1 silently (-NoBrowser).

const DEFAULT_UI = "http://localhost:4200";
const DEFAULT_API = "http://127.0.0.1:3000";
const DEFAULT_DIR = "C:/Users/antimajorana/Documents/GitHub/re-Solver-Agent";

function cleanUrl(u, fallback) {
  const s = String(u || fallback).trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(s) ? s : fallback;
}

async function probeWithNode(uiUrl, apiUrl) {
  const script = `
    const ui = process.argv[1], api = process.argv[2];
    const get = async (u) => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 1800);
      try {
        const r = await fetch(u, { signal: c.signal, headers: { Accept: "application/json" } });
        const txt = await r.text();
        let json = null;
        try { json = JSON.parse(txt); } catch {}
        return { ok: r.ok, status: r.status, json };
      } catch (e) {
        return { ok: false, status: 0, error: String(e && e.message || e) };
      } finally { clearTimeout(t); }
    };
    (async () => {
      const [fe, be] = await Promise.all([
        get(ui + "/.solver-launcher/identity"),
        get(api + "/api/health"),
      ]);
      const feFallback = fe.ok ? fe : await get(ui + "/");
      const frontend = Boolean(feFallback.ok);
      const backend = Boolean(be.ok && (!be.json || be.json.status === "ok" || be.json.application));
      process.stdout.write(JSON.stringify({
        running: frontend && backend,
        frontend,
        backend,
        buildId: (fe.json && fe.json.buildId) || (be.json && be.json.buildId) || null,
      }));
    })();
  `;
  const r = await atlas.exec("node", ["-e", script, uiUrl, apiUrl], { timeout: 6 });
  if (r.status === 0 && r.stdout) return JSON.parse(r.stdout.trim());
  throw new Error(r.stderr || "node probe failed");
}

async function probeWithPowerShell(uiUrl, apiUrl) {
  const ps = `
    $ErrorActionPreference = 'SilentlyContinue'
    $fe = $false; $be = $false; $bid = $null
    try {
      $r1 = Invoke-WebRequest -Uri '${uiUrl.replace(/'/g, "''")}/.solver-launcher/identity' -UseBasicParsing -TimeoutSec 2
      if ($r1.StatusCode -ge 200 -and $r1.StatusCode -lt 400) {
        $fe = $true
        $j1 = $r1.Content | ConvertFrom-Json
        if ($j1.buildId) { $bid = $j1.buildId }
      }
    } catch {}
    if (-not $fe) {
      try {
        $r1b = Invoke-WebRequest -Uri '${uiUrl.replace(/'/g, "''")}/' -UseBasicParsing -TimeoutSec 2
        if ($r1b.StatusCode -ge 200 -and $r1b.StatusCode -lt 400) { $fe = $true }
      } catch {}
    }
    try {
      $r2 = Invoke-WebRequest -Uri '${apiUrl.replace(/'/g, "''")}/api/health' -UseBasicParsing -TimeoutSec 2
      if ($r2.StatusCode -ge 200 -and $r2.StatusCode -lt 400) { $be = $true }
    } catch {}
    @{ running = ($fe -and $be); frontend = $fe; backend = $be; buildId = $bid } | ConvertTo-Json -Compress
  `;
  const r = await atlas.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 10 });
  if (r.status === 0 && r.stdout) return JSON.parse(r.stdout.trim());
  return { running: false, frontend: false, backend: false, buildId: null };
}

async function checkStatus(params = {}) {
  const uiUrl = cleanUrl(params.url, DEFAULT_UI);
  const apiUrl = cleanUrl(params.apiUrl, DEFAULT_API);
  try {
    const res = await probeWithNode(uiUrl, apiUrl);
    return { ...res, url: uiUrl, apiUrl };
  } catch {
    const res = await probeWithPowerShell(uiUrl, apiUrl);
    return { ...res, url: uiUrl, apiUrl };
  }
}

async function startServices(params = {}) {
  const uiUrl = cleanUrl(params.url, DEFAULT_UI);
  const apiUrl = cleanUrl(params.apiUrl, DEFAULT_API);
  const current = await checkStatus({ url: uiUrl, apiUrl });
  if (current.running) {
    return { ok: true, alreadyRunning: true, url: uiUrl, status: current };
  }

  const baseDir = String(params.launcherDir || DEFAULT_DIR).trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const scriptPath = `${baseDir}/local-launcher/Start-SolverAgent.ps1`;

  const run = await atlas.exec(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-NoBrowser",
      "-JsonProgress",
    ],
    { timeout: 300 },
  );

  const events = [];
  for (const raw of String(run.stdout || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ phase: "log", message: line });
    }
  }

  const lastError = [...events].reverse().find((e) => e.phase === "error");
  const readyEvent = [...events].reverse().find((e) => e.phase === "ready");
  const after = await checkStatus({ url: uiUrl, apiUrl });

  if (after.running || (run.status === 0 && readyEvent)) {
    return {
      ok: true,
      url: (readyEvent && readyEvent.url) || uiUrl,
      events,
      status: after,
    };
  }

  const why =
    (lastError && lastError.message) ||
    (run.timedOut ? "Solver startup timed out after 5 minutes." : "") ||
    String(run.stderr || "").trim() ||
    `Launcher exited with status ${run.status ?? "unknown"}.`;

  return {
    ok: false,
    url: uiUrl,
    error: why,
    events,
    status: after,
  };
}

atlas.methods({
  status: checkStatus,
  start: startServices,
});
