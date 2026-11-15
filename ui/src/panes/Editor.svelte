<script lang="ts">
  // Editor pane: load, autosave (600 ms, base_mtime → 409 conflict banner), reload on fs events. Code files
  // are saved only by Ctrl+S (`[editor] autosave_code`, off); their unsaved text is kept meanwhile in a
  // recovery copy (.kandinsky/cache/recovery/<path>), offered back when the file is opened again.
  import { errText } from "../lib/text";
  import { inPhoneApp } from "../lib/eink";
  import { shownName, shownPath } from "../lib/paths";
  import { keepRecovery as rescueCopy, recoveryPath } from "../lib/recovery";
  import { openLintPanel } from "@codemirror/lint";
  import { workspaceSymbols } from "../lib/editor/lsp";
  import { settings, setPropertiesView } from "../lib/settings.svelte";
  import { fileIcon } from "../lib/panes";
  import Icon from "../components/Icon.svelte";
  import { mount, onMount, unmount } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import { api, ApiError } from "../lib/api";
  import { diff, editFrontmatter } from "../lib/frontmatter-edit";
  import { on, touches } from "../lib/bus";
  import { app, toast } from "../lib/state.svelte";
  import { setDirty, closePanel, open, openPath } from "../lib/dock";
  import { openHome } from "../lib/actions";
  import { editors, noteEditorActive, openIntent } from "../lib/registry";
  import { createEditor, isMarkdown, type KandinskyEditor } from "../lib/editor/create";
  import FormatBar from "../components/FormatBar.svelte";
  import NoteHero from "../components/NoteHero.svelte";
  import OracleBar from "../components/OracleBar.svelte";
  import SyncCopies from "../components/SyncCopies.svelte";
  import { refreshGitGutter } from "../lib/editor/git-gutter";
  import CodeBar from "../components/CodeBar.svelte";
  import { openWikilink } from "../lib/links";
  import { loadMath } from "../lib/math";
  import { applyMove } from "../lib/section-move";
  import { vaultReady } from "../lib/vault";
  import type { PaneProps } from "../lib/dock";
  import { setSelection } from "../lib/context.svelte";
  import Backlinks from "../components/Backlinks.svelte";
  import PropertiesPanel from "../components/PropertiesPanel.svelte";
  import { propsPanel, toggleProperties } from "../lib/properties-panel.svelte";
  import { isNotionShell } from "../lib/shell-mode.svelte";
  import { isFileStarred, toggleFileStar } from "../lib/bookmarks.svelte";
  import { copyPath, tabs, toggleSidebar } from "../lib/tabs.svelte";
  import { phone } from "../lib/phone.svelte";
  import { nativeShell } from "../lib/native-shell.svelte";
  import { frontmatterOf } from "../lib/property-model";
  import { noteViewFor, shownAsNote } from "../lib/note-views.svelte";
  import type { LiveNote } from "../lib/note-live";
  import { hostOf, mirrorState, signInToMirror, type MirrorState } from "../lib/mirror";
  import { below, popMenu } from "../lib/menu";
  import { chooseVault } from "../lib/vaults";
  import { readText } from "../lib/vault-files";
  import type { Text } from "@codemirror/state";
  import type { Problems } from "../lib/state.svelte";
  import { noteHeadings } from "../lib/note-anchor";
  import { mapHeadings } from "../lib/editor/heading-map";
  /** Vim, as the setting says — never in the mobile apps or on a phone's screen: a touch keyboard has no Escape, and normal mode ate the taps. */
  const vimHere = () => app.vimEnabled && !nativeShell.on && !phone.on;

  let { spec, panel }: PaneProps<"editor"> = $props();
  // svelte-ignore state_referenced_locally -- a pane's spec is fixed for its lifetime
  const path = spec.path;

  let host: HTMLDivElement;
  let ed: KandinskyEditor | null = null;
  // the last headings() answer and the text it was read from (one scan per version of the text)
  let headCache: { doc: Text; heads: { level: number; text: string; line: number }[] } | null = null;
  let status = $state<"loading" | "ready" | "error">("loading");
  let loadError = $state("");
  let conflict = $state(false);
  let isNew = $state(false);
  let problems = $state<Problems | null>(null); // this file's counts, for its own code bar (app.problems: the focused file's)
  let docText = $state(""); // what the properties panel reads; set on every change of the text
  let live: LiveNote | null = null; // the note shared with the other devices that have it open (lib/note-live.ts)
  let livePeers = $state<string[]>([]);
  /** This vault's mirror (lib/mirror.ts): the note is saved here, and its live room is the server's (core server.rs
   *  live_ws); null when none is linked. Shown as the `⇄ host` chip. */
  let mirror = $state<{ host: string; address: string; state: MirrorState } | null>(null);
  const askMirror = () => { if (isMarkdown(path)) void mirrorState().then((m) => { if (!disposed) mirror = m && { host: hostOf(m.address), address: m.address, state: m.state }; }, () => {}); };
  /** The chip says what the mirror is and what it is doing, then offers what can be done about it. */
  function mirrorMenu(e: MouseEvent) {
    const m = mirror;
    if (!m) return;
    const status = m.state === "online"
      ? { label: "Connected", detail: writesHere ? "this device is the one writing this note" : "another device is writing this note; its saves arrive here" }
      : m.state === "signin"
        ? { label: "Not signed in", detail: "saves stay on this device until you sign in; differences are merged then" }
        : { label: "Server unreachable", detail: "notes are saved on this device only; differences are merged when it is back" };
    popMenu(below(e, [
      { info: `This vault is also on ${m.host}`, detail: "Notes are saved in this folder first. The server lets one device write a note at a time, so the two copies never clash.", icon: "server" },
      { info: status.label, detail: status.detail, icon: m.state === "online" ? "check" : "warning" },
      "sep",
      ...(m.state === "signin" ? [{ label: "Sign in to the server…", icon: "user" as const, run: () => void signInToMirror() }] : []),
      { label: "Open this vault on the server", icon: "external-link", run: () => void import("../lib/web-links").then((w) => w.openWeb(m.address)) },
      { label: "Mirror settings…", detail: "the server's address, or stop mirroring", icon: "settings", run: () => void chooseVault({ linkMirror: true }) },
    ], 4));
  }
  /** Who saves the note while it is shared live (lib/live.ts writes()); read again as the room changes. */
  const writesHere = $derived.by(() => { void livePeers; return live?.writes() ?? true; });
  const writerName = $derived.by(() => { void livePeers; return live?.writerName() ?? null; });
  let disposed = false;

  let mtime = $state<number | undefined>(undefined);
  let nowTick = $state(Date.now());
  let saved = ""; // text as last known on disk
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> | null = null;
  let behindTries = 0; // a writer's saves refused while its copy is behind (save)

  // Line endings: the editor's lines are "\n"-joined, so a CRLF file's save (even of no change) rewrote every ending.
  // Everything here is "\n" text (saved, current, templates, recovery); the file's own endings go back only on writing it.
  let crlf = false;
  const lf = (t: string) => t.replace(/\r\n/g, "\n");
  /** A text read from the file: its endings remembered, given as "\n" text. */
  const fromDisk = (t: string) => { const nl = t.indexOf("\n"); crlf = nl > 0 && t[nl - 1] === "\r"; return crlf ? lf(t) : t; };
  const toDisk = (t: string) => (crlf ? t.replace(/\n/g, "\r\n") : t);
  const current = () => ed?.view.state.doc.toString() ?? saved;
  const markDirty = (text = current()) => setDirty(panel.id, text !== saved);
  // "dont autosave code files, but keep a temporary one just in case"
  const autosave = () => isMarkdown(path) || (settings.config?.editor.autosave_code ?? false);
  const RECOVERY = recoveryPath(path);
  let parked = false; // the tab is going away with unsaved text (park)
  let trashed = false; // guard so closing a trashed note does not save it back
  let blameOn = $state(false); // git blame shown beside the lines (toggleBlame)
  let rawSource = $state(false); // raw Markdown source mode (Ctrl+E)
  let localFullWidth = $state<boolean | null>(null);
  let rescued = false; // text that could not be saved was put in the recovery copy (rescue)
  let recovered = $state<string | null>(null); // a recovery copy that differs from the file, offered back
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  // an empty copy means none: the API has no delete outside the trash, and a saved file needs no copy
  const keepRecovery = (now = false) => {
    clearTimeout(recoveryTimer);
    const write = () => void api.putFile(RECOVERY, current() === saved ? "" : current()).catch(() => {});
    if (now) write(); else recoveryTimer = setTimeout(write, 600);
  };

  /** `closing`: the tab's last text, the editor already gone — saved all the same, or kept (rescue), never dropped. */
  async function save(force = false, closing?: string): Promise<void> {
    if (trashed) return;
    clearTimeout(timer);
    while (inflight) await inflight; // the text is read after: what was typed meanwhile goes too
    const text = closing ?? (ed ? current() : null);
    if (text === null || (text === saved && !isNew)) return;
    if (conflict && !force) { if (closing !== undefined) rescue(text); return; }
    // in a room with another device that writes: it saves the shared text, which comes back here through Syncthing
    if (live && !live.writes() && !force) return;
    let again = false;
    inflight = (async () => {
      try {
        const res = await api.putFile(path, toDisk(text), force || isNew ? undefined : mtime, true);
        mtime = res.mtime;
        saved = text;
        if (res.template?.text !== undefined) void applyTemplate(res.template.template, res.template.added, lf(res.template.text), text);
        if (!autosave()) keepRecovery(true);
        else if (rescued) { rescued = false; void api.putFile(RECOVERY, "").catch(() => {}); }
        if (ed) void refreshGitGutter(ed.view, path); // what differs from git changed with this save
        isNew = false;
        conflict = false;
        behindTries = 0;
      } catch (err) {
        // the room's writer, whose copy is not the last version yet (the writer before it saved, Syncthing has not brought
        // it): the shared text goes on top once it has — asked again each second, a while (core mirror_guard.rs)
        if (err instanceof ApiError && err.status === 409 && live && live.others() > 0 && behindTries++ < 30) {
          await new Promise((r) => setTimeout(r, 1000));
          const f = await api.file(path).catch(() => null);
          if (f) { mtime = f.mtime; again = true; return; }
        }
        // the file was only touched (Syncthing rewrote what we last saved, a new mtime on the same text): ours goes on top
        if (err instanceof ApiError && err.status === 409) {
          const f = await api.file(path).catch(() => null);
          if (f && lf(f.text) === saved) { mtime = f.mtime; again = true; return; }
          conflict = true;
        } else toast(`Could not save ${shownPath(path)}`, errText(err), "error");
        if (closing !== undefined) rescue(text);
      } finally {
        inflight = null;
        markDirty();
      }
    })();
    await inflight;
    if (again) return save(force, closing);
  }

  /** A template this save brought (a property set to a value a template applies to, core template_apply.rs), merged
   *  in as one change of the editor's own — undo and the autosave as typing. Typed in meanwhile: merged again into
   *  what is there now, and given up when typing goes on. */
  async function applyTemplate(name: string, added: string[], merged: string, base: string): Promise<void> {
    if (!ed) return;
    if (current() !== base) {
      base = current();
      const again = await api.mergeTemplate(path, name, base).catch(() => null);
      if (!again?.text || !ed || current() !== base) return;
      merged = lf(again.text);
    }
    const change = diff(base, merged);
    if (!change) return;
    ed.view.dispatch({ changes: change, userEvent: "input.template" });
    toast(`Template “${name}” applied`, `Added ${added.join(", ")}`, "info", 9000, { label: "Undo", run: () => {
      if (!ed || current() !== merged) return;
      const back = diff(merged, base);
      if (back) ed.view.dispatch({ changes: back, userEvent: "input.template" });
    } });
  }

  /** The tab closed with text that could not be saved: kept in the recovery copy, offered back when the note opens. */
  function rescue(text: string) {
    rescued = true;
    void rescueCopy(path, text, "Its text is kept: open the note again to get it back.");
  }

  /** Shared live with the other devices that open the note (in a mirrored vault, the core splices the room to the server's). */
  function startLive() {
    if (!isMarkdown(path) || !(settings.config?.editor.live ?? true)) return;
    void import("../lib/note-live").then((m) => { if (!disposed && ed && !live) live = m.liveNote(path, ed.view, (n) => (livePeers = n), () => void save()); });
  }

  // On each change: the unsaved dot at once (cheap); the text itself — the properties panel's, the exact dirty check
  // — once typing pauses. Building a big note's text twice per key (4.5 MB, pictures inlined) was most of a key's cost.
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  function schedule(text?: string, typed = false, keys = false) {
    if (text !== undefined) docText = text;
    window.dispatchEvent(new CustomEvent("kandinsky-doc-change", { detail: panel.id }));
    if (typed) setDirty(panel.id, true); // the user's change: unsaved at once — not a load or a reload, which may leave it as saved
    if (keys) {
      // keys: the text read when typing pauses (a big note's text is not free to build on every key)
      clearTimeout(textTimer);
      textTimer = setTimeout(() => { if (disposed) return; docText = current(); markDirty(docText); }, 120);
    } else {
      // anything else (a panel's edit, a paste, a load) is read at once: what made it reads it back
      clearTimeout(textTimer);
      if (text === undefined) docText = current();
      markDirty(docText);
    }
    if (!autosave()) return keepRecovery();
    clearTimeout(timer);
    timer = setTimeout(() => void save(), 600);
  }

  async function reloadFromDisk() {
    try {
      const f = await api.file(path);
      mtime = f.mtime;
      saved = fromDisk(f.text);
      ed?.setDoc(saved);
      conflict = false;
      markDirty();
    } catch (err) {
      toast(`Could not reload ${shownPath(path)}`, String(err), "error");
    }
  }

  function openLink(target: string, opts?: { beside?: boolean }) {
    void openWikilink(target, path, opts); // a PDF link keeps its #page=… (lib/pdf-place.ts)
  }

  // a note a plugin draws its own way (a mail note as the mail): drawn over the editor, which stays loaded underneath
  const noteProps = $derived(isMarkdown(path) && status === "ready" ? frontmatterOf(docText)?.data : null);
  const isFullWidth = $derived(isMarkdown(path) ? (localFullWidth ?? (noteProps?.width === "full")) : Boolean(localFullWidth));
  const starred = $derived(isFileStarred(path));
  const pathSegments = $derived(path.split("/"));
  const folderSegments = $derived(pathSegments.slice(0, -1));
  const editedLabel = $derived.by(() => {
    if (!mtime) return isNew ? "New file" : "";
    const diffSec = Math.max(0, Math.floor((nowTick - mtime) / 1000));
    if (diffSec < 120) return "Edited just now";
    if (diffSec < 3600) return `Edited ${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `Edited ${Math.floor(diffSec / 3600)}h ago`;
    const days = Math.floor(diffSec / 86400);
    if (days < 7) return `Edited ${days}d ago`;
    return `Edited ${new Date(mtime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  });

  function toggleSource(): void {
    if (!ed || !isMarkdown(path)) return;
    rawSource = ed.toggleSourceMode();
  }

  async function toggleFullWidth(): Promise<void> {
    const next = !isFullWidth;
    localFullWidth = next;
    if (isMarkdown(path) && ed) {
      try {
        await editFrontmatter(ed.view, next ? { op: "set", key: "width", value: "full" } : { op: "remove", key: "width" });
        localFullWidth = null;
      } catch {
        /* keep localFullWidth fallback */
      }
    }
    requestAnimationFrame(() => ed?.view.requestMeasure());
  }

  function handleToggleProperties(): void {
    if (settings.config?.editor.properties === "panel") {
      setPropertiesView("inline");
      toggleProperties(false);
    } else {
      toggleProperties();
    }
  }

  async function trashThisNote(): Promise<void> {
    if (trashed) return;
    clearTimeout(timer);
    trashed = true;
    try {
      const res = await api.trash(path);
      saved = current();
      isNew = false;
      setDirty(panel.id, false);
      const undoAct = res.to.startsWith(".kandinsky/")
        ? [{ label: "Undo", run: () => void api.move(res.to, path).then(() => openPath(path)) }]
        : undefined;
      toast("Moved to Trash", `${shownPath(path)} → ${res.to}`, "info", 7000, undoAct);
      await closePanel(panel);
    } catch (err) {
      trashed = false;
      toast(`Could not move ${shownPath(path)} to Trash`, errText(err), "error");
    }
  }

  async function copyText(val: string, msg: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(val);
      toast(msg, shownName(path));
    } catch {
      toast("Could not copy to clipboard", "", "error");
    }
  }

  let oracleSlotEl = $state<HTMLSpanElement>();

  function triggerOracleButton(index: 0 | 1): void {
    const sel = index === 0 ? ".clint-pill" : ".wiki-btn";
    const direct = oracleSlotEl?.querySelector<HTMLButtonElement>(sel);
    if (direct) {
      direct.click();
      return;
    }
    const btns = oracleSlotEl?.querySelectorAll<HTMLButtonElement>(".oracle-bar button");
    btns?.[index]?.click();
  }

  function openPageMenu(e: MouseEvent): void {
    popMenu(
      below(e, [
        ...(isMarkdown(path)
          ? [
              { label: isFullWidth ? "Standard reading width (740px)" : "Full width page", icon: "maximize" as const, run: () => void toggleFullWidth() },
              { label: rawSource ? "Live preview mode" : "Source mode (raw Markdown)", hint: "Ctrl+E", icon: "code" as const, run: toggleSource },
              { label: "Toggle Properties panel", icon: "table" as const, run: handleToggleProperties },
              "sep" as const,
              { label: "Run c_lint verification", icon: "check" as const, run: () => triggerOracleButton(0) },
              { label: "File computation to Oracle Wiki…", icon: "bookmark" as const, run: () => triggerOracleButton(1) },
              "sep" as const,
            ]
          : []),
        { label: blameOn ? "Hide Git blame" : "Git blame (line history)", icon: "clock" as const, run: () => void editors.get(panel.id)?.toggleBlame() },
        "sep",
        { label: isMarkdown(path) ? "Move note to Trash" : "Move file to Trash", icon: "trash" as const, danger: true, run: () => void trashThisNote() },
      ], 4),
    );
  }

  function openShareMenu(e: MouseEvent): void {
    popMenu(
      below(e, [
        { label: isMarkdown(path) ? "Copy Markdown" : "Copy file contents", icon: "copy", run: () => void copyText(current(), isMarkdown(path) ? "Markdown copied" : "Contents copied") },
        ...(isMarkdown(path) ? [{ label: "Copy [[wikilink]]", icon: "link" as const, run: () => void copyText(`[[${shownName(path)}]]`, "Wikilink copied") }] : []),
        { label: "Copy file path", icon: "file-text", run: () => void copyPath(path) },
        { label: "Export / Print…", icon: "external-link", run: () => window.print() },
      ], 4),
    );
  }

  const heroProps = $state({
    path,
    noteProps: null as Record<string, unknown> | null,
    view: (): EditorView | null => ed?.view ?? null,
    isFullWidth: false,
    onToggleWidth: () => void toggleFullWidth(),
    onToggleProperties: () => handleToggleProperties(),
  });

  $effect(() => {
    heroProps.noteProps = noteProps ?? null;
    heroProps.isFullWidth = isFullWidth;
  });

  onMount(() => {
    let heroSlot: HTMLDivElement | null = null;
    let heroInst: Record<string, unknown> | null = null;
    const tickInterval = setInterval(() => { nowTick = Date.now(); }, 30_000);
    const onToggleSource = () => {
      if (panel.isActive && ed && isMarkdown(path)) rawSource = ed.toggleSourceMode();
    };
    window.addEventListener("kandinsky-toggle-source", onToggleSource);

    (async () => {
      let text = "";
      askMirror();
      try {
        // links, embeds, and KaTeX resolve before the first render so inline math never paints unhydrated
        const [f] = await Promise.all([
          api.file(path),
          vaultReady(),
          ...(isMarkdown(path) ? [loadMath().catch(() => null)] : []),
        ]);
        text = fromDisk(f.text);
        mtime = f.mtime;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          isNew = true;
          if (isMarkdown(path)) await loadMath().catch(() => null);
        } else { status = "error"; loadError = errText(err); return; }
      }
      if (disposed) return;
      saved = text;
      docText = text;
      ed = createEditor({
        parent: host,
        doc: text,
        path,
        vim: vimHere(),
        line: spec.line,
        onChange: (typed, keys, edit) => {
          if (headCache?.doc === edit.before) {
            const heads = mapHeadings(headCache.heads, edit.before, edit.changes, edit.after);
            headCache = heads && { doc: edit.after, heads };
          }
          schedule(undefined, typed, keys);
        },
        onVimMode: (m) => { if (panel.isActive) app.vimMode = m; },
        onFocus: () => { app.vimMode = ed?.vimMode() ?? ""; app.problems = ed?.problems() ?? null; noteEditorActive(panel.id); },
        onProblems: (p) => { problems = p; if (panel.isActive) app.problems = p; },
        onSelection: (s) => {
          // the section around the caret: the last heading at or above it (shared context, R3)
          const h = editors.get(panel.id)?.headings().filter((x) => x.line <= s.from_line).pop();
          setSelection({ path, ...s }, h ? { path, heading: h.text, line: h.line } : undefined);
        },
        onSave: () => void save(),
        onQuit: () => void closePanel(panel),
        onOpenLink: openLink,
      });
      if (isMarkdown(path)) {
        heroSlot = document.createElement("div");
        heroSlot.className = "cm-note-hero-slot";
        ed.view.scrollDOM.prepend(heroSlot);
        heroInst = mount(NoteHero, { target: heroSlot, props: heroProps });
        requestAnimationFrame(() => ed?.view.requestMeasure());
      }
      status = "ready";
      void refreshGitGutter(ed.view, path);
      // a note is shared live with the other devices that open it (on by default; `[editor] live = false` turns it off)
      startLive();
      // unsaved text kept from last time (a code file's, or a note's that could not be saved: rescue); asked through the
      // listings, as most notes have none (a 404 on every open is logged as an error)
      void readText(RECOVERY).then((r) => { if (!disposed && r && r !== text) { recovered = r; rescued = true; } });
      // the line was a one-shot jump; don't replay it on every layout restore
      if (spec.line !== undefined) panel.updateParameters({ line: undefined });
      editors.set(panel.id, {
        path,
        gotoLine: (n) => ed?.gotoLine(n),
        focus: () => ed?.view.focus(),
        insertBlock: (text) => {
          if (!ed) return;
          const { state } = ed.view, at = state.doc.lineAt(state.selection.main.head).to;
          const insert = `\n\n${text.replace(/\n+$/, "")}\n`;
          ed.view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, scrollIntoView: true, userEvent: "input" });
        },
        flush: () => save(),
        park: async () => { if (!trashed && autosave()) await save(); else if (!trashed && current() !== saved) parked = true; },
        vimMode: () => ed?.vimMode() ?? "",
        snapshot: () => ({ text: ed?.view.state.doc.toString() ?? "", ranges: ed?.view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to })) ?? [] }),
        showProblems: () => (ed?.problems() ? openLintPanel(ed.view) : false),
        symbols: () => (ed ? workspaceSymbols(ed.view) : false),
        toggleBlame: async () => {
          if (!ed) return null;
          if (blameOn) { ed.setBlame(null, () => {}); blameOn = false; return false; }
          if (autosave()) await save(); // blame reads the file on disk
          const b = await api.gitBlame(path).catch((e) => { toast("No blame", errText(e), "error"); return null; });
          if (!b || !ed) return null;
          if (!b.lines.length) { toast("No history for this file", "Git has no commit of it (outside a repository, or never committed)."); return null; }
          ed.setBlame(b, (hash, subject) => open({ kind: "commit", hash, subject }));
          blameOn = true;
          return true;
        },
        moveSection: (m) => {
          if (!ed) return;
          const doc = ed.view.state.doc, { lo, hi, text, head } = applyMove((n) => doc.line(n).text, m);
          const from = doc.line(lo).from;
          ed.view.dispatch({ changes: { from, to: doc.line(hi - 1).to, insert: text }, selection: { anchor: from + head }, scrollIntoView: true, userEvent: "move.section" });
        },
        headings: () => {
          if (!ed) return [];
          // asked on every caret move: scanned once per version of the text (a doc is immutable, so its identity is
          // the version)
          const doc = ed.view.state.doc;
          if (headCache?.doc !== doc) headCache = { doc, heads: scanHeadings(doc) };
          return headCache.heads.slice();
        },
      });
      window.dispatchEvent(new CustomEvent("kandinsky-doc-change", { detail: panel.id }));
      function scanHeadings(doc: Text): { level: number; text: string; line: number }[] {
        const out: { level: number; text: string; line: number }[] = [];
        if (/\.tex$/i.test(path)) {
          // LaTeX sectioning → outline levels (\part = 1 … \subparagraph = 7)
          const LV: Record<string, number> = { part: 1, chapter: 2, section: 3, subsection: 4, subsubsection: 5, paragraph: 6, subparagraph: 7 };
          for (let i = 1; i <= doc.lines; i++) {
            const m = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\{(.*)\}/.exec(doc.line(i).text);
            if (m) out.push({ level: LV[m[1]], text: m[2].trim(), line: i });
          }
          return out;
        }
        if (!isMarkdown(path)) return [];
        return noteHeadings(doc.iterLines()).map((h) => ({ level: h.level, text: h.text, line: h.i + 1 }));
      }
      if (panel.isActive) {
        // loaded late (the home note at startup): take the focus only if nobody else has it — the
        // palette or a search box opened meanwhile keeps its keys (vim would read them as commands)
        const a = document.activeElement;
        const asked = openIntent.path === path && Date.now() - openIntent.t < 5000;
        // the app on a phone or a Boox: a note opens to be read; the keyboard comes with a tap in the text (it covered
        // half the screen at every open)
        // asked for, it still leaves a menu or a dialog the user opened while its code loaded
        const elsewhere = a instanceof HTMLElement && !!a.closest('[role="menu"], [role="dialog"]');
        if (!inPhoneApp() && ((asked && !elsewhere) || !a || a === document.body || host.contains(a))) ed.view.focus();
        app.vimMode = ed.vimMode();
        noteEditorActive(panel.id);
      }
    })();

    const offFs = on("fs", (e) => {
      if (!touches(e.paths, (p) => p === path || p.endsWith(`/${path}`))) return;
      if (inflight || !ed) return;
      // shared live: the others' edits arrive as edits, not as a reload of the file under the shared text
      if (live && live.others() > 0) { void api.file(path).then((f) => { mtime = f.mtime; saved = lf(f.text) === current() ? lf(f.text) : saved; markDirty(); }, () => {}); return; }
      const dirty = current() !== saved;
      void api.file(path).then((f) => {
        if (f.mtime === mtime || lf(f.text) === current()) { mtime = f.mtime; return; }
        if (dirty) { conflict = true; return; } // our next save would 409 anyway: say so now
        mtime = f.mtime;
        saved = fromDisk(f.text);
        ed?.setDoc(saved);
        markDirty();
      }, () => {});
    });
    // linked, unlinked or linked elsewhere in the vault switcher: the chip follows
    window.addEventListener("kandinsky-mirror-unlinked", askMirror);
    const offActive = panel.onDidActiveChange((e) => {
      if (e.isActive && ed) { app.vimMode = ed.vimMode(); app.problems = ed.problems(); if (!inPhoneApp()) requestAnimationFrame(() => ed?.view.focus()); }
    });

    return () => {
      disposed = true;
      clearInterval(tickInterval);
      window.removeEventListener("kandinsky-toggle-source", onToggleSource);
      offFs();
      offActive.dispose();
      const pending = current() !== saved ? current() : null; // read now: the editor goes below
      // read now too: the room goes below, and out of it this pane would count as the writer
      if (!trashed && pending !== null && autosave() && (live?.writes() ?? true)) void save(false, pending);
      if (!trashed && pending !== null && !autosave()) {
        keepRecovery(true);
        // closed by hand: say where the changes went (a reload or the window closing reopens it with the offer)
        if (parked) toast(`${shownPath(path)} was not saved`, "Its changes are kept: open it again to restore them.", "info");
      }
      clearTimeout(recoveryTimer);
      clearTimeout(textTimer);
      live?.close();
      window.removeEventListener("kandinsky-mirror-unlinked", askMirror);
      editors.delete(panel.id);
      setDirty(panel.id, false);
      if (heroInst) { void unmount(heroInst); heroInst = null; }
      heroSlot?.remove();
      heroSlot = null;
      ed?.destroy();
      ed = null;
    };
  });

  const noteView = $derived(noteViewFor(noteProps));
  const drawn = $derived(!!noteView && !shownAsNote.has(path));
  let viewHost = $state<HTMLDivElement>();
  $effect(() => {
    if (!drawn || !viewHost || !noteView) return;
    const off = noteView.render(viewHost, { path, text: docText, props: noteProps ?? {}, showNote: () => shownAsNote.add(path) });
    return () => { if (typeof off === "function") off(); viewHost?.replaceChildren(); };
  });

  // live vim toggle from the palette / status bar
  $effect(() => {
    const on = vimHere();
    ed?.setVim(on);
  });
</script>

<div class="editor-pane" class:is-md={isMarkdown(path)} class:full-width={isFullWidth} class:drawn>
  {#if noteView}
    <button class="note-view-switch" onclick={() => (drawn ? shownAsNote.add(path) : shownAsNote.delete(path))}
      title={drawn ? "The note's markdown, to edit" : `Drawn as ${noteView.title.toLowerCase()}`}>{drawn ? "Show as note" : `Show as ${noteView.title.toLowerCase()}`}</button>
  {/if}
  {#if isNotionShell() || (settings.config?.editor.breadcrumbs ?? true)}
    <header class="topbar" aria-label="Path">
      <div class="breadcrumbs">
        {#if isNotionShell() && tabs.sidebar.collapsed}
          <button type="button" class="icon-btn expand-sb" onclick={toggleSidebar} title="Expand sidebar (Super+S)" aria-label="Expand sidebar">
            <Icon name="panel-left" size={15} />
          </button>
        {/if}
        <button type="button" class="seg vault" onclick={() => void openHome()} title="Open vault Home">
          {app.workspace?.name ?? "Workspace"}
        </button>
        <span class="sep">›</span>
        {#if folderSegments.length > 0}
          <span class="folder-trail">
            {#each folderSegments as seg, i}
              {#if i > 0}<span class="sub-sep">/</span>{/if}
              <button type="button" class="seg" title="Show {folderSegments.slice(0, i + 1).join('/')} in the explorer"
                onclick={() => open({ kind: "explorer", source: "vault", place: "", path: folderSegments.slice(0, i + 1).join("/"), select: pathSegments[i + 1] })}>{seg}</button>
            {/each}
          </span>
          <span class="sep">›</span>
        {/if}
        <strong class="doc-crumb">
          {#if !isMarkdown(path)}<Icon name={fileIcon(path)} size={13} />{/if}
          {shownName(path)}
        </strong>
        {#if rawSource}
          <button type="button" class="source-chip" onclick={toggleSource} title="Switch back to Live Preview (Ctrl+E)">SOURCE</button>
        {/if}
      </div>
      <div class="top-actions">
        {#if editedLabel}<span class="edited-lbl">{editedLabel}</span>{/if}
        {#if isMarkdown(path) && status === "ready"}
          <span class="oracle-slot" class:notion-quiet={isNotionShell()} bind:this={oracleSlotEl}>
            <OracleBar {path} flush={() => save(false)} gotoLine={(line) => ed?.gotoLine(line)} />
          </span>
        {/if}
        <button type="button" class="top-pill star-pill" class:starred={starred}
          onclick={() => toggleFileStar(path, shownName(path))}
          title={starred ? "Remove from Favorites" : "Add to Favorites"}>
          {starred ? "★ Starred" : "★ Star"}
        </button>
        <button type="button" class="top-link" onclick={() => open({ kind: "git" })} title="Version history & Git diff">History</button>
        <button type="button" class="top-more" aria-label="Page actions" title="Page actions" onclick={openPageMenu}>···</button>
        <button type="button" class="top-pill" onclick={openShareMenu} title="Copy or export note">Share</button>
        <button type="button" class="icon-btn trash-btn" title="Move to Trash" aria-label="Move to Trash" onclick={() => void trashThisNote()}>
          <Icon name="trash" size={14} />
        </button>
      </div>
    </header>
  {:else if isMarkdown(path) && status === "ready"}
    <header class="topbar compact">
      <div class="top-actions" style="margin-left: auto;">
        <OracleBar {path} flush={() => save(false)} gotoLine={(line) => ed?.gotoLine(line)} />
      </div>
    </header>
  {/if}
  {#if conflict}
    <div class="banner banner-warn" role="alert">
      <span><strong>{shownPath(path)}</strong> changed on disk while you were editing.</span>
      <span class="banner-actions">
        <button class="btn btn-ghost" onclick={reloadFromDisk}>Load disk version</button>
        <button class="btn primary" onclick={() => save(true)}>Keep mine (overwrite)</button>
      </span>
    </div>
  {/if}
  {#if isMarkdown(path)}<SyncCopies {path} mine={current} take={(text) => { ed?.setDoc(text, { keepUndo: true }); markDirty(); schedule(text); }} />{/if}
  {#if recovered !== null}
    <div class="banner banner-warn" role="alert">
      <span>Unsaved changes to <strong>{shownPath(path)}</strong> were kept from last time.</span>
      <span class="banner-actions">
        <button class="btn btn-ghost" onclick={() => { recovered = null; rescued = false; void api.putFile(RECOVERY, "").catch(() => {}); }}>Discard them</button>
        <button class="btn primary" onclick={() => { ed?.setDoc(recovered ?? "", { keepUndo: true }); recovered = null; markDirty(); }}>Restore</button>
      </span>
    </div>
  {/if}
  {#if status === "error"}
    <div class="pane-empty"><p class="muted">Could not open <code>{path}</code></p><p class="faint small">{loadError}</p></div>
  {/if}
  <!-- who has the note and who saves it; the mirror only when something is wrong with it (all is well: nothing to say) -->
  {#if livePeers.length}<div class="live-chip" title="These devices have this note open: their edits and cursors show here as they type. {writerName ? `${writerName} saves the file; your edits reach it as you type.` : 'This device saves the file.'}">Live · {[...new Set(livePeers)].join(", ")} · {writerName ? `${writerName} writes` : "you write"}</div>
  {:else if mirror && mirror.state !== "online"}<button class="live-chip mirror-chip down" onclick={mirrorMenu}
    title="{mirror.host} {mirror.state === 'signin' ? 'wants a sign-in' : 'is unreachable'}: this note is saved on this device only, and merged with the server's copy later. Click for more">{mirror.state === "signin" ? `Sign in to ${mirror.host}` : `${mirror.host} offline · saved here`}</button>{/if}
  {#if isNew && status === "ready"}
    <div class="new-file-hint">New file — it is created on the first save.</div>
  {/if}
  {#if !isMarkdown(path) && status === "ready" && (settings.config?.editor.code_bar ?? true)}<CodeBar view={() => ed?.view ?? null} {path} {problems} />{/if}
  {#if drawn}<div class="note-view" bind:this={viewHost}></div>{/if}
  <!-- the format bar heads the note's column only: the Properties panel beside it runs the full height, its edge the
       one line between them -->
  <div class="editor-row">
    <div class="editor-col">
      {#if isMarkdown(path) && status !== "error" && (settings.config?.editor.format_bar ?? false)}<FormatBar view={() => ed?.view ?? null} />{/if}
      <div class="editor-host" bind:this={host}></div>
    </div>
    {#if isMarkdown(path) && status === "ready" && (settings.config?.editor.properties === "panel" || propsPanel.open)}
      <PropertiesPanel text={docText} view={() => ed?.view ?? null} onopen={openLink} closable={settings.config?.editor.properties !== "panel"} />
    {/if}
  </div>
  {#if isMarkdown(path) && status !== "error" && (settings.config?.editor.backlinks ?? true)}<Backlinks {path} />{/if}
</div>

<style>
  .editor-pane { height: 100%; display: flex; flex-direction: column; background: var(--bg); position: relative; }
  .note-view { flex: 1; min-height: 0; overflow: auto; }
  .live-chip { position: absolute; z-index: 3; bottom: 10px; right: 14px; padding: 3px 10px; border-radius: 999px; pointer-events: none;
    background: var(--accent); color: var(--accent-fg, #fff); font-size: calc(12px * var(--ui-scale, 1)); }
  .mirror-chip { pointer-events: auto; /* the Live badge lets clicks through; this one is a button */ background: var(--bg-elev); color: var(--text-muted); border: 1px solid var(--border); opacity: .85; font: inherit; cursor: pointer; }
  .mirror-chip:hover { opacity: 1; color: var(--text); }
  .mirror-chip.down { color: var(--text-faint); border-style: dashed; }
  .drawn .editor-row, .drawn :global(.format-bar) { display: none; }
  .note-view-switch { position: absolute; top: 46px; right: 14px; z-index: 4; padding: 2px 9px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--bg); color: var(--text-muted); font-size: calc(12px * var(--ui-scale, 1)); }
  .note-view-switch:hover { color: var(--text); background: var(--bg-hover); }
  .editor-row { flex: 1; min-height: 0; display: flex; position: relative; } /* the phone's properties sheet covers it */
  .editor-col { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .editor-host { flex: 1; min-width: 0; min-height: 0; }

  .topbar {
    flex: none; height: 40px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between;
    gap: 12px; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text-muted);
    border-bottom: 1px solid var(--border); background: var(--bg); position: relative; z-index: 5; white-space: nowrap;
  }
  .topbar.compact { height: 32px; padding: 0 14px; }
  .breadcrumbs { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .expand-sb { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 5px; color: var(--text-muted); flex: none; margin-right: 2px; }
  .expand-sb:hover { background: var(--bg-hover); color: var(--text); }
  .breadcrumbs .seg { padding: 2px 5px; border-radius: 4px; color: var(--text-muted); font: inherit; }
  .breadcrumbs button.seg:hover { background: var(--bg-hover); color: var(--text); }
  .breadcrumbs .folder-trail { display: inline-flex; align-items: center; gap: 1px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .breadcrumbs .sub-sep { color: var(--text-faint); padding: 0 1px; }
  .breadcrumbs .sep { color: var(--text-faint); opacity: .75; }
  .breadcrumbs .doc-crumb { display: inline-flex; align-items: center; gap: 5px; color: var(--heading); font-weight: 500; overflow: hidden; text-overflow: ellipsis; padding: 0 2px; }
  .source-chip { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: .04em; padding: 1px 6px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent); margin-left: 4px; cursor: pointer; }
  .source-chip:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }

  .top-actions { display: inline-flex; align-items: center; gap: 10px; flex: none; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-faint); }
  .top-actions :global(.oracle-bar) { margin-left: 0; }
  .oracle-slot { display: inline-flex; align-items: center; }
  /* In Notion shell mode, keep a calm, discoverable 22px ◎ Run c_lint trigger visible at rest
     and smoothly reveal File to Wiki… on topbar hover, focus, or active c_lint / Wiki modal state. */
  .oracle-slot.notion-quiet {
    --ob-gap: 0px;
    --ob-wiki-w: 0px;
    --ob-wiki-op: 0;
    --ob-wiki-px: 0px;
    --ob-wiki-bw: 0px;
    --ob-wiki-pe: none;
    --ob-pill-fg: var(--text-faint);
    --ob-pill-bg: transparent;
    --ob-pill-px: 7px;
  }
  .topbar:hover .oracle-slot.notion-quiet,
  .oracle-slot.notion-quiet:hover,
  .oracle-slot.notion-quiet:focus-within,
  .oracle-slot.notion-quiet:has(:global(.clean)),
  .oracle-slot.notion-quiet:has(:global(.issues)),
  .oracle-slot.notion-quiet:has(:global(.running)),
  .oracle-slot.notion-quiet:has(:global(.clint-pop)),
  .oracle-slot.notion-quiet:has(:global(.lint-popover)),
  .oracle-slot.notion-quiet:has(:global(.modal-backdrop)),
  .oracle-slot.notion-quiet:has(:global(.wiki-backdrop)) {
    --ob-gap: 6px;
    --ob-wiki-w: 130px;
    --ob-wiki-op: 1;
    --ob-wiki-px: 8px;
    --ob-wiki-bw: 1px;
    --ob-wiki-pe: auto;
    --ob-pill-fg: var(--text-muted);
    --ob-pill-bg: var(--bg-elev);
    --ob-pill-px: 8px;
  }
  .oracle-slot.notion-quiet :global(.oracle-bar) {
    gap: var(--ob-gap);
    transition: gap 150ms ease;
  }
  .oracle-slot.notion-quiet :global(.clint-pill:not(.clean):not(.issues):not(.running)) {
    height: 22px;
    padding: 0 var(--ob-pill-px);
    font-size: calc(11.5px * var(--ui-scale, 1));
    color: var(--ob-pill-fg);
    background: var(--ob-pill-bg);
    border-color: var(--border);
  }
  .oracle-slot.notion-quiet :global(.clint-pill:hover:not(:disabled)) {
    background: var(--bg-hover);
    color: var(--text);
    border-color: var(--border-strong);
  }
  .oracle-slot.notion-quiet :global(.wiki-btn) {
    max-width: var(--ob-wiki-w);
    opacity: var(--ob-wiki-op);
    padding-inline: var(--ob-wiki-px);
    border-width: var(--ob-wiki-bw);
    pointer-events: var(--ob-wiki-pe);
    overflow: hidden;
    transition: max-width 160ms ease, opacity 130ms ease, padding 160ms ease, border-width 160ms ease, background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .oracle-slot.notion-quiet :global(.wiki-btn:hover) {
    background: var(--bg-hover);
    color: var(--text);
    border-color: var(--border-strong);
  }
  .edited-lbl { color: var(--text-faint); margin-right: 2px; }
  .top-pill { padding: 3px 8px; border-radius: 5px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); font: inherit; cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms; }
  .top-pill:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
  .star-pill.starred { color: var(--yellow); background: color-mix(in srgb, var(--yellow) 11%, transparent); border-color: color-mix(in srgb, var(--yellow) 36%, var(--border)); font-weight: 500; }
  .top-link, .top-more { padding: 3px 5px; border-radius: 5px; color: var(--text-muted); font: inherit; cursor: pointer; transition: background 120ms, color 120ms; }
  .top-link:hover, .top-more:hover { background: var(--bg-hover); color: var(--text); }
  .top-more { font-weight: 600; letter-spacing: 0.06em; padding: 3px 6px; }
  .trash-btn { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 5px; color: var(--text-faint); transition: background 120ms, color 120ms; }
  .trash-btn:hover { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red); }

  @media (max-width: 820px) {
    .edited-lbl { display: none; }
    .topbar { padding: 0 12px; }
    .top-actions { gap: 6px; }
  }

  .editor-host :global(.cm-editor) { height: 100%; }
  .new-file-hint { font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-faint); padding: 6px 16px 0; text-align: center; }
  .banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    padding: 8px 14px; font-size: calc(13px * var(--ui-scale, 1)); border-bottom: 1px solid var(--border); }
  .banner-warn { background: color-mix(in srgb, var(--yellow) 14%, var(--bg)); color: var(--text); }
  .banner-actions { display: flex; gap: 8px; }
</style>
