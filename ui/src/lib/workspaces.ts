// Layouts & Research Workspaces (docs/guides/SHELL.md):
//   .kandinsky/cache/layout.json        current window layout, autosaved and restored on start
//   .kandinsky/workspaces/<name>.json   named multi-pane workspace arrangement + shell visibility
//   .kandinsky/workspaces.json          per-vault index of saved workspaces & active layout metadata
// Plus 3 built-in 1-click Bauhaus Research Workspace Presets:
//   1. Research Quad     (● Cobalt)   — PDF + Markdown Note + Solver + Antigravity (2×2)
//   2. Derivation Studio (● Ochre)    — Markdown Note + Jupyter/WLJS Notebook + Terminal below
//   3. Focus Sheet       (◎ Viridian) — Distraction-free centered sheet (folds sidebars & terminal)
import { errText } from "./text";
import type { Action } from "./actions";
import { api, apiBase, vaultScoped } from "./api";
import { reloadOnChange } from "./reload-on-change";
import { applyLayout, currentLayout, focusPanel, getDock, migrateLayout, nextTerminalN, onLayoutChange, open } from "./dock";
import { panelZone, zoneGroup } from "./dock-instance";
import { hidePanel, placeTerminalPanel, reveal } from "./dock-panels";
import { findTargetMarkdownEditor } from "./editor-insert-bus";
import { agentsOn } from "./agents";
import { fullscreen } from "./fullscreen.svelte";
import { keysOf, setCommands } from "./keymap.svelte";
import { popMenu } from "./menu";
import { pick } from "./palette.svelte";
import { paneId, type IconName, type PaneSpec } from "./panes";
import { load, drop, KEYS } from "./prefs";
import { recentFiles } from "./recent";
import { parkAll } from "./registry";
import { settings } from "./settings.svelte";
import { showSide, sideInBar, sidePanel, SIDE_KINDS, type SideId } from "./side-panel.svelte";
import { toast } from "./state.svelte";
import { isPinned, setSidebarWidth, tabs, toggleSidebar, unsplit } from "./tabs.svelte";
import { exists, readText } from "./vault-files";
import type { MenuItem } from "../components/ContextMenu.svelte";

const CURRENT = ".kandinsky/cache/layout.json";
const SESSION = vaultScoped("kandinsky.session");
const OWN = vaultScoped("kandinsky.layout.window");
const ownLayout = (): unknown | null => {
  try { const t = sessionStorage.getItem(OWN); return t ? JSON.parse(t) : null; } catch { return null; }
};
const DIR = ".kandinsky/workspaces";
const STATE_FOLDER = ".kandinsky";
const INDEX_FILE = ".kandinsky/workspaces.json";
const SCRATCH_NOTEBOOK = ".kandinsky/derivation-scratch.ipynb";
const fileOf = (name: string) => `${DIR}/${name}.json`;
const cleanName = (raw: string) => raw.trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);

export type WorkspacePresetId = "research-quad" | "derivation-studio" | "focus-sheet";

export interface WorkspaceShellState {
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  sidePanelVisible?: boolean;
  sidePanelKind?: SideId;
  terminalVisible?: boolean;
  preserveTerminalSplit?: boolean;
}

export interface SavedWorkspaceRecord {
  version: 2;
  name: string;
  updatedAt: string;
  dock: unknown;
  shell: WorkspaceShellState;
}

interface WorkspacesIndexFile {
  version: 1;
  active?: string;
  updatedAt: string;
  workspaces: Record<string, SavedWorkspaceRecord>;
}

import { workspaceState } from "./workspace-state.svelte";
export { workspaceState };

const PRESETS: { id: WorkspacePresetId; cmd: string; label: string; detail: string; icon: IconName }[] = [
  { id: "research-quad", cmd: "ui.workspace.preset.quad", label: "● Research Quad", detail: "PDF + Note + Solver + Antigravity", icon: "grid" },
  { id: "derivation-studio", cmd: "ui.workspace.preset.derivation", label: "● Derivation Studio", detail: "Note + Notebook + Terminal", icon: "sigma" },
  { id: "focus-sheet", cmd: "ui.workspace.preset.focus", label: "◎ Focus Sheet", detail: "Distraction-free centered writing", icon: "file-text" },
];

const STARTER_IPYNB = JSON.stringify({
  cells: [
    { cell_type: "markdown", metadata: {}, source: ["# Derivation Scratchpad\n", "Symbolic & numerical checks beside your Kandinsky note.\n"] },
    { cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: ["import sympy as sp\n", "x, k = sp.symbols('x k', real=True)\n"] },
  ],
  metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
}, null, 2);

async function readJson(path: string): Promise<unknown | null> {
  const text = await readText(path);
  try { return text === null ? null : JSON.parse(text); } catch { return null; }
}

function sameSession(): boolean {
  try { const s = sessionStorage.getItem(SESSION) === "1"; sessionStorage.setItem(SESSION, "1"); return s; } catch { return false; }
}

export async function restoreLayout(acrossSessions: boolean): Promise<boolean> {
  const reload = sameSession();
  const legacy = load<unknown>(KEYS.layout, null);
  drop(KEYS.layout);
  if (!acrossSessions && !reload) return false;
  const saved = (reload ? ownLayout() : null) ?? (await readJson(CURRENT)) ?? legacy;
  return saved ? applyLayout(saved) : false;
}

export function autosaveLayout(): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  let last = "";
  let dirty = false;
  const put = (text: string, keepalive: boolean) =>
    fetch(`${apiBase()}/api/file`, { method: "PUT", keepalive, headers: { "x-kandinsky": "1", "content-type": "application/json" }, body: JSON.stringify({ path: CURRENT, text }) });
  const write = () => {
    clearTimeout(t);
    if (!dirty || fullscreen.on) return;
    dirty = false;
    const text = JSON.stringify(currentLayout());
    if (text === last) return;
    last = text;
    try { sessionStorage.setItem(OWN, text); } catch { /* file still has it */ }
    void put(text, true).catch(() => put(text, false)).catch((e) => console.warn("[kandinsky] layout not saved", e));
  };
  const off = onLayoutChange(() => { dirty = true; clearTimeout(t); t = setTimeout(write, 400); });
  const leave = () => write();
  window.addEventListener("pagehide", leave);
  return () => { off(); clearTimeout(t); window.removeEventListener("pagehide", leave); };
}

function captureShellState(): WorkspaceShellState {
  const dock = getDock(), bottom = zoneGroup("bottom"), sideGrp = zoneGroup("side"), inBar = sideInBar();
  const rightTerm = settings.config?.terminal.position === "right";
  const preserveTerminalSplit = Boolean(
    dock && bottom?.api.isVisible && (rightTerm ? bottom.api.height < dock.height - 16 : bottom.api.width < dock.width - 16)
  );
  return {
    sidebarCollapsed: tabs.sidebar.collapsed,
    sidebarWidth: tabs.sidebar.width,
    sidePanelVisible: inBar ? sidePanel.visible : Boolean(sideGrp?.api.isVisible),
    sidePanelKind: sidePanel.kind,
    terminalVisible: Boolean(bottom?.api.isVisible),
    ...(preserveTerminalSplit ? { preserveTerminalSplit: true } : {}),
  };
}

function applyShellState(shell?: WorkspaceShellState): void {
  if (!shell) return;
  if (typeof shell.sidebarWidth === "number") setSidebarWidth(shell.sidebarWidth);
  if (typeof shell.sidebarCollapsed === "boolean" && tabs.sidebar.collapsed !== shell.sidebarCollapsed) toggleSidebar();
  if (typeof shell.sidePanelVisible === "boolean") {
    if (sideInBar()) {
      if (shell.sidePanelVisible) {
        const k = shell.sidePanelKind && ((SIDE_KINDS as readonly string[]).includes(shell.sidePanelKind) || shell.sidePanelKind.startsWith("tool:"))
          ? shell.sidePanelKind : sidePanel.kind;
        showSide(k);
      } else sidePanel.visible = false;
    } else {
      const sg = zoneGroup("side");
      if (sg) { if (shell.sidePanelVisible) reveal(sg); else hidePanel(sg); }
    }
  }
  if (typeof shell.terminalVisible === "boolean") {
    const bg = zoneGroup("bottom");
    if (bg) { if (shell.terminalVisible) reveal(bg); else hidePanel(bg); }
  }
}

// --- Named Workspaces & `.kandinsky/workspaces.json` Persistence -------------------------------------

async function readIndex(): Promise<WorkspacesIndexFile> {
  const p = (await readJson(INDEX_FILE)) as Partial<WorkspacesIndexFile> | null;
  if (p && typeof p === "object" && p.workspaces && typeof p.workspaces === "object") {
    return {
      version: 1,
      active: typeof p.active === "string" ? p.active : undefined,
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
      workspaces: { ...p.workspaces },
    };
  }
  return { version: 1, updatedAt: new Date().toISOString(), workspaces: {} };
}

async function writeIndex(idx: WorkspacesIndexFile): Promise<void> {
  try {
    if (!(await exists(STATE_FOLDER))) await api.mkdir(STATE_FOLDER).catch(() => {});
    idx.updatedAt = new Date().toISOString();
    await api.putFile(INDEX_FILE, JSON.stringify(idx, null, 2));
  } catch (e) { console.warn("[kandinsky] could not sync .kandinsky/workspaces.json", e); }
}

function unwrapWorkspaceRecord(name: string, raw: unknown): SavedWorkspaceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version === 2 && "dock" in obj && obj.dock) {
    return {
      version: 2,
      name: typeof obj.name === "string" ? obj.name : name,
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
      dock: obj.dock,
      shell: (obj.shell && typeof obj.shell === "object" ? obj.shell : {}) as WorkspaceShellState,
    };
  }
  return { version: 2, name, updatedAt: new Date().toISOString(), dock: raw, shell: {} };
}

export async function listWorkspaces(): Promise<string[]> {
  const [dirEntries, indexed] = await Promise.all([
    exists(DIR).then((ok) => (ok ? api.tree(DIR).catch(() => []) : [])),
    readIndex(),
  ]);
  const set = new Set<string>();
  for (const e of dirEntries) if (e.kind === "file" && e.name.endsWith(".json")) set.add(e.name.replace(/\.json$/, ""));
  for (const k of Object.keys(indexed.workspaces)) if (k.trim()) set.add(k);
  const sorted = [...set].sort((a, b) => a.localeCompare(b));
  workspaceState.saved = sorted;
  if (!workspaceState.active && indexed.active) workspaceState.active = indexed.active;
  return sorted;
}

export async function saveWorkspace(name: string, silentToast = false): Promise<void> {
  const clean = cleanName(name);
  if (!clean) return;
  const record: SavedWorkspaceRecord = {
    version: 2, name: clean, updatedAt: new Date().toISOString(), dock: currentLayout(), shell: captureShellState(),
  };
  try {
    await api.putFile(fileOf(clean), JSON.stringify(record, null, 2));
    const idx = await readIndex();
    idx.workspaces[clean] = record;
    idx.active = clean;
    await writeIndex(idx);
    workspaceState.active = clean;
    await syncCommands();
    if (!silentToast) toast(`Workspace “${clean}” saved`, `Synced to ${INDEX_FILE}`, "success");
  } catch (e) { toast("Workspace not saved", errText(e), "error"); }
}

export async function updateWorkspace(name: string): Promise<void> {
  const clean = cleanName(name);
  if (!clean) return;
  await saveWorkspace(clean, true);
  toast(`Workspace “${clean}” updated`, "Overwrote saved workspace with current split layout.", "success");
}

export async function renameWorkspace(oldName: string, newName: string): Promise<void> {
  const from = cleanName(oldName), to = cleanName(newName);
  if (!from || !to || from === to) return;
  try {
    const idx = await readIndex();
    const record = unwrapWorkspaceRecord(to, (await readJson(fileOf(from))) ?? idx.workspaces[from] ?? null);
    if (!record) return void toast(`No workspace “${from}”`, "Could not read saved workspace to rename.", "error");
    record.name = to;
    record.updatedAt = new Date().toISOString();
    await api.putFile(fileOf(to), JSON.stringify(record, null, 2));
    if (await exists(fileOf(from))) await api.trash(fileOf(from)).catch(() => {});
    delete idx.workspaces[from];
    idx.workspaces[to] = record;
    if (idx.active === from) idx.active = to;
    await writeIndex(idx);
    if (workspaceState.active === from) workspaceState.active = to;
    await syncCommands();
    toast(`Renamed to “${to}”`, `Was “${from}”`, "success");
  } catch (e) { toast("Could not rename workspace", errText(e), "error"); }
}

export async function deleteWorkspace(name: string): Promise<void> {
  const clean = cleanName(name);
  if (!clean) return;
  try {
    if (await exists(fileOf(clean))) await api.trash(fileOf(clean));
    const idx = await readIndex();
    delete idx.workspaces[clean];
    if (idx.active === clean) delete idx.active;
    await writeIndex(idx);
    if (workspaceState.active === clean) workspaceState.active = "";
    await syncCommands();
    toast(`Deleted workspace “${clean}”`, "Moved layout file to .kandinsky/trash/", "info");
  } catch (e) { toast("Could not delete workspace", errText(e), "error"); }
}

export async function switchWorkspace(name: string): Promise<void> {
  const raw = (await readJson(fileOf(name))) ?? (await readIndex()).workspaces[name] ?? null;
  const record = unwrapWorkspaceRecord(name, raw);
  if (!record?.dock) return void toast(`No workspace “${name}”`, `${fileOf(name)} is missing or not valid JSON.`, "error");
  await settleUnsaved();
  if (!applyLayout(record.dock)) return void toast(`Workspace “${name}” could not be opened`, "Its file does not describe a valid layout.", "error");
  if (record.shell?.preserveTerminalSplit) {
    const dock = getDock();
    try {
      dock?.fromJSON(migrateLayout(structuredClone(record.dock)) as Parameters<NonNullable<typeof dock>["fromJSON"]>[0]);
      window.dispatchEvent(new Event("kandinsky-layout"));
    } catch { /* fallback already applied */ }
  }
  applyShellState(record.shell);
  workspaceState.active = name;
  void readIndex().then((idx) => { idx.active = name; return writeIndex(idx); });
}

// --- 3 Built-in 1-Click Research Workspace Presets -----------------------------------------------

const settleUnsaved = () => Promise.race([Promise.allSettled(parkAll()), new Promise((r) => setTimeout(r, 1800))]);

async function firstRecentMatching(re: RegExp): Promise<string | null> {
  for (const c of [...recentFiles(), ...(await api.recent(25).catch(() => []))]) {
    if (re.test(c) && (await exists(c))) return c;
  }
  return null;
}

async function pickBestMarkdownSpec(): Promise<PaneSpec> {
  const target = findTargetMarkdownEditor();
  if (target?.handle.path) return { kind: "editor", path: target.handle.path };
  for (const p of getDock()?.panels ?? []) {
    const s = p.params as PaneSpec | undefined;
    if (s?.kind === "editor" && /\.(md|markdown)$/i.test(s.path)) return { kind: "editor", path: s.path };
  }
  const rec = await firstRecentMatching(/\.(md|markdown)$/i);
  if (rec) return { kind: "editor", path: rec };
  const allMd = (await api.files({ index: true }).catch(() => [])).filter((f) => /\.(md|markdown)$/i.test(f));
  const preferred = allMd.find((f) => /^(FOCUS|wiki\/overview|README)\.md$/i.test(f)) ?? allMd[0];
  return preferred ? { kind: "editor", path: preferred } : { kind: "today" };
}

async function pickBestPdfSpec(): Promise<PaneSpec> {
  const dock = getDock();
  const activeSpec = dock?.activePanel?.params as PaneSpec | undefined;
  if (activeSpec?.kind === "pdf") return activeSpec;
  for (const p of dock?.panels ?? []) {
    const s = p.params as PaneSpec | undefined;
    if (s?.kind === "pdf") return s;
  }
  const rec = await firstRecentMatching(/\.pdf$/i);
  if (rec) return { kind: "pdf", path: rec };
  const paperFiles = (await exists("zAI/papers"))
    ? (await api.files({ under: "zAI/papers" }).catch(() => [])).filter((f) => /\.pdf$/i.test(f)) : [];
  if (paperFiles.length) return { kind: "pdf", path: paperFiles[0] };
  const vaultPdfs = (await api.files().catch(() => [])).filter((f) => /\.pdf$/i.test(f));
  if (vaultPdfs.length) return { kind: "pdf", path: vaultPdfs[0] };
  return { kind: "explorer", source: "vault", place: "", ...((await exists("zAI/papers")) ? { path: "zAI/papers" } : {}) };
}

async function pickBestNotebookSpec(): Promise<PaneSpec> {
  for (const p of getDock()?.panels ?? []) {
    const s = p.params as PaneSpec | undefined;
    if (s?.kind === "notebook") return s;
  }
  const rec = await firstRecentMatching(/\.(ipynb|wln)$/i);
  if (rec) return { kind: "notebook", path: rec };
  const nbs = (await api.files().catch(() => [])).filter((f) => /\.(ipynb|wln)$/i.test(f));
  if (nbs.length) return { kind: "notebook", path: nbs[0] };
  try {
    if (!(await exists(STATE_FOLDER))) await api.mkdir(STATE_FOLDER).catch(() => {});
    if (!(await exists(SCRATCH_NOTEBOOK))) await api.createFile(SCRATCH_NOTEBOOK, STARTER_IPYNB);
    return { kind: "notebook", path: SCRATCH_NOTEBOOK };
  } catch { return { kind: "explorer", source: "vault", place: "" }; }
}

async function clearMainExcept(keepIds: Set<string>): Promise<void> {
  await settleUnsaved();
  const dock = getDock();
  if (!dock) return;
  if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup();
  for (const p of [...dock.panels]) if (panelZone(p) === "main" && !isPinned(p.id) && !keepIds.has(p.id)) p.api.close();
}

function resolveAgyModelSlug(): string {
  try {
    const stored = localStorage.getItem("kandinsky.agy.modelSlug")?.trim();
    if (stored) return stored;
    const m = localStorage.getItem("kandinsky.agy.model")?.trim();
    if (m === "argon") return "gemini-4-argon-high";
    if (m === "hydrogen") return "gemini-4-hydrogen-high";
    if (m === "flash") return "gemini-3.8-flash-high";
  } catch { /* ignore */ }
  return "gemini-4-carbon-high";
}

export async function applyWorkspacePreset(preset: WorkspacePresetId): Promise<void> {
  const dock = getDock();
  if (!dock) return;

  if (preset === "focus-sheet") {
    const noteSpec = await pickBestMarkdownSpec();
    await settleUnsaved();
    if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup();
    open(noteSpec);
    unsplit("main");
    if (!tabs.sidebar.collapsed) toggleSidebar();
    if (sideInBar()) sidePanel.visible = false;
    else { const sg = zoneGroup("side"); if (sg?.api.isVisible) hidePanel(sg); }
    const bg = zoneGroup("bottom");
    if (bg?.api.isVisible) hidePanel(bg);
    focusPanel(paneId(noteSpec));
    workspaceState.active = "Focus Sheet";
    window.dispatchEvent(new Event("kandinsky-layout"));
    toast("◎ Focus Sheet", "Distraction-free writing sheet — sidebars & terminal folded cleanly.", "info");
    return;
  }

  if (preset === "derivation-studio") {
    const [noteSpec, nbSpec] = await Promise.all([pickBestMarkdownSpec(), pickBestNotebookSpec()]);
    const existingShell = dock.panels.find((p) => {
      const s = p.params as PaneSpec | undefined;
      return s?.kind === "terminal" && s.preset === "shell" && !s.agent;
    });
    const shellSpec: PaneSpec = existingShell
      ? (existingShell.params as PaneSpec)
      : { kind: "terminal", preset: "shell", n: nextTerminalN(), title: "Shell · Wolfram" };

    await clearMainExcept(new Set([paneId(noteSpec), paneId(nbSpec), paneId(shellSpec)]));
    open(noteSpec);
    open(nbSpec);
    const leftP = dock.getPanel(paneId(noteSpec)), rightP = dock.getPanel(paneId(nbSpec));
    if (leftP && rightP && leftP.id !== rightP.id) rightP.api.moveTo({ group: leftP.group, position: "right" });
    open(shellSpec);
    const termP = dock.getPanel(paneId(shellSpec));
    if (termP) {
      reveal(termP.group);
      placeTerminalPanel("bottom", Math.round(Math.max(230, (dock.height || 820) * 0.3)));
    }
    focusPanel(paneId(noteSpec));
    workspaceState.active = "Derivation Studio";
    window.dispatchEvent(new Event("kandinsky-layout"));
    toast("● Derivation Studio", "Markdown Note + Computational Notebook + Terminal docked below.", "success");
    return;
  }

  // preset === "research-quad"
  const [pdfSpec, noteSpec] = await Promise.all([pickBestPdfSpec(), pickBestMarkdownSpec()]);
  const solverSpec: PaneSpec = { kind: "plugin", id: "solver", title: "Solver", icon: "sigma" };
  const existingAgy = dock.panels.find((p) => {
    const s = p.params as PaneSpec | undefined;
    return s?.kind === "terminal" && (Boolean(s.agent?.startsWith("antigravity")) || /antigravity|^agy\b/i.test(s.title ?? "") || /^agy\b/i.test(s.command ?? ""));
  });
  const agyDecl = agentsOn().find((a) => a.plugin === "antigravity" || a.id === "agy" || a.ref.startsWith("antigravity/"));
  const agySpec: PaneSpec = existingAgy
    ? (existingAgy.params as PaneSpec)
    : agyDecl
      ? { kind: "terminal", preset: "shell", n: nextTerminalN(), title: "Antigravity", agent: agyDecl.ref }
      : { kind: "terminal", preset: "shell", n: nextTerminalN(), title: "Antigravity", command: `agy --model ${resolveAgyModelSlug()}` };

  const agyId = existingAgy?.id ?? paneId(agySpec);
  await clearMainExcept(new Set([paneId(pdfSpec), paneId(noteSpec), paneId(solverSpec), agyId]));
  open(pdfSpec);
  open(noteSpec);
  open(solverSpec);
  open(agySpec);

  const tl = dock.getPanel(paneId(pdfSpec)), tr = dock.getPanel(paneId(noteSpec));
  const bl = dock.getPanel(paneId(solverSpec)), br = dock.getPanel(agyId);
  if (br) reveal(br.group);
  if (tl && tr && tl.id !== tr.id) tr.api.moveTo({ group: tl.group, position: "right" });
  if (tl && bl && tl.id !== bl.id) bl.api.moveTo({ group: tl.group, position: "bottom" });
  if (tr && br && tr.id !== br.id) br.api.moveTo({ group: tr.group, position: "bottom" });

  focusPanel(paneId(noteSpec));
  workspaceState.active = "Research Quad";
  window.dispatchEvent(new Event("kandinsky-layout"));
  toast("● Research Quad", "PDF (top-left) · Note (top-right) · Solver (bottom-left) · Antigravity (bottom-right)", "success");
}

// --- Command Palette Pickers & Sidebar Header Menu -----------------------------------------------

export function askSaveWorkspace(): void {
  pick({
    placeholder: "Name this workspace layout (e.g. Chiral Anomaly Quad)…",
    tag: "Save workspace",
    icon: "panel-left",
    items: async () => (await listWorkspaces()).map((n) => ({
      value: n, title: `Overwrite “${n}”`, detail: "Update saved layout & sidebar state", icon: "check" as const, section: "Saved Workspaces",
    })),
    typed: (t) => (t.trim() ? `Save current layout as “${t.trim()}”` : null),
    onpick: (v) => saveWorkspace(v),
  });
}

function askRenameWorkspace(oldName: string): void {
  pick({
    placeholder: `New name for “${oldName}”…`, tag: "Rename workspace", icon: "edit", seed: oldName, items: [],
    typed: (t) => { const c = cleanName(t); return c && c !== oldName ? `Rename “${oldName}” → “${c}”` : null; },
    typedAs: { section: "Rename", icon: "edit" },
    onpick: (v) => renameWorkspace(oldName, v),
  });
}

export function askManageWorkspaces(): void {
  pick({
    placeholder: "Choose a 1-click preset or load / manage saved workspaces…", tag: "Workspaces", icon: "grid",
    items: async () => {
      const names = await listWorkspaces();
      return [
        ...PRESETS.map((p) => ({ value: `preset:${p.id}`, title: p.label, detail: p.detail, icon: p.icon, section: "1-Click Research Presets" })),
        ...names.map((n) => ({ value: `load:${n}`, title: n, detail: workspaceState.active === n ? "Active · click to reload" : "Load saved workspace", icon: "panel-left" as const, section: "Saved Workspaces" })),
        { value: "action:save", title: "Save current layout as workspace…", detail: "Persist multi-pane Dockview split & sidebar state", icon: "plus" as const, section: "Manage" },
        ...names.flatMap((n) => [
          { value: `update:${n}`, title: `Overwrite “${n}” with current layout`, icon: "check" as const, section: "Manage" },
          { value: `rename:${n}`, title: `Rename “${n}”…`, icon: "edit" as const, section: "Manage" },
          { value: `delete:${n}`, title: `Delete “${n}”`, icon: "trash" as const, section: "Manage" },
        ]),
      ];
    },
    onpick: (val) => {
      if (val.startsWith("preset:")) return applyWorkspacePreset(val.slice(7) as WorkspacePresetId);
      if (val === "action:save") return void askSaveWorkspace();
      const idx = val.indexOf(":");
      if (idx < 0) return;
      const [op, name] = [val.slice(0, idx), val.slice(idx + 1)];
      if (op === "load") return switchWorkspace(name);
      if (op === "update") return updateWorkspace(name);
      if (op === "rename") return void askRenameWorkspace(name);
      if (op === "delete") return deleteWorkspace(name);
    },
  });
}

function openManageSubmenu(x: number, y: number, names: string[], onclose?: () => void): void {
  const items: MenuItem[] = names.flatMap((n, i): MenuItem[] => [
    ...(i > 0 ? ["sep" as const] : []),
    { info: n, detail: workspaceState.active === n ? "Active workspace" : "Saved workspace", icon: "panel-left" },
    { label: `Load “${n}”`, icon: "arrow-right", run: () => void switchWorkspace(n) },
    { label: `Overwrite “${n}” with current layout`, icon: "check", run: () => void updateWorkspace(n) },
    { label: `Rename “${n}”…`, icon: "edit", run: () => askRenameWorkspace(n) },
    { label: `Delete “${n}”`, icon: "trash", danger: true, run: () => void deleteWorkspace(n) },
  ]);
  popMenu({ x, y, items }, onclose);
}

export async function openWorkspacesMenu(e: MouseEvent, onclose?: () => void): Promise<void> {
  const target = e.currentTarget as HTMLElement | null;
  const r = target ? target.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
  const x = r.left, y = r.bottom + 4;
  const names = await listWorkspaces();
  const items: MenuItem[] = [
    ...PRESETS.map((p): MenuItem => ({ label: p.label, detail: p.detail, icon: p.icon, hint: keysOf(p.cmd), run: () => void applyWorkspacePreset(p.id) })),
    "sep",
    ...names.map((n): MenuItem => ({ label: n, detail: workspaceState.active === n ? "Active · click to reload" : "Saved workspace", icon: "panel-left", hint: keysOf(`workspace.${n}`), run: () => void switchWorkspace(n) })),
    ...(names.length ? ["sep" as const] : []),
    ...(workspaceState.active && names.includes(workspaceState.active)
      ? [{ label: `Update “${workspaceState.active}”`, detail: "Overwrite with current layout", icon: "check" as const, run: () => void updateWorkspace(workspaceState.active) }] : []),
    ...(names.length
      ? [{ label: "Manage saved workspaces…", detail: "Overwrite, rename, or delete", icon: "sliders" as const, run: () => setTimeout(() => openManageSubmenu(x, y, names, onclose), 0) }] : []),
    "sep",
    { label: "Save current layout as workspace…", icon: "plus", hint: keysOf("ui.workspace.save"), run: () => askSaveWorkspace() },
  ];
  popMenu({ x, y, items }, onclose);
}

const PREFIX = "workspace.";
async function syncCommands(): Promise<void> {
  const names = await listWorkspaces();
  setCommands(PREFIX, names.map((n): Action => ({ id: `${PREFIX}${n}`, title: `Workspace: ${n}`, run: () => switchWorkspace(n) })));
}

export function initWorkspaces(): () => void {
  void syncCommands();
  return reloadOnChange(() => void syncCommands(), { wait: 0, wants: (p) => p.startsWith(`${DIR}/`) || p === INDEX_FILE });
}
