// Interactive ```encrypted fence block: local AES-256-GCM (PBKDF2-SHA256) encryption in memory.
import { EditorView } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import { registerFence } from "./fences";
import { api } from "./api";
import { errText } from "./text";
import {
  parseEncryptedEnvelope,
  encryptBlockText,
  decryptBlockText,
  rememberUnlockedInMemory,
  getUnlockedInMemory,
  lockInMemory,
} from "./encrypted-crypto";

const STYLE_ID = "kandinsky-encrypted-fence-styles";
const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*encrypted(?=[ \t]|$)/;

function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    ".enc-card { border: 1px solid var(--border-strong, var(--border)); border-radius: var(--radius-lg, 8px); background: var(--bg-alt); color: var(--text); font-family: var(--font-ui); margin: 8px 0; overflow: hidden; }",
    ".enc-card[data-state='unlocked'] { border-color: color-mix(in srgb, var(--green) 48%, var(--border)); }",
    ".enc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 12px; background: var(--bg-elev); border-bottom: 1px solid var(--border); }",
    ".enc-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--text); }",
    ".enc-badge.is-unlocked { color: var(--green); background: var(--green-soft, color-mix(in srgb, var(--green) 14%, transparent)); padding: 2px 8px; border-radius: 999px; }",
    ".enc-hint-pill { font-size: 11.5px; font-family: var(--font-mono); color: var(--text-muted); background: var(--bg-alt); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; }",
    ".enc-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
    ".enc-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }",
    ".enc-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
    ".enc-input, .enc-textarea { background: var(--bg, var(--bg-elev)); color: var(--text); border: 1px solid var(--border-strong, var(--border)); border-radius: var(--radius-sm, 5px); font-size: 13px; padding: 6px 9px; outline: none; }",
    ".enc-input:focus, .enc-textarea:focus { border-color: var(--accent); }",
    ".enc-input { flex: 1 1 160px; min-width: 140px; font-family: var(--font-ui); }",
    ".enc-textarea { width: 100%; min-height: 108px; resize: vertical; font-family: var(--font-mono); line-height: 1.55; box-sizing: border-box; }",
    ".enc-btn { padding: 5px 11px; border-radius: var(--radius-sm, 5px); font-size: 12.5px; font-weight: 600; border: 1px solid var(--border-strong, var(--border)); background: var(--bg-elev); color: var(--text); cursor: pointer; white-space: nowrap; }",
    ".enc-btn:hover:not(:disabled) { background: var(--bg-hover); }",
    ".enc-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); }",
    ".enc-btn.primary:hover:not(:disabled) { opacity: 0.92; }",
    ".enc-btn.viridian { background: var(--green-soft, color-mix(in srgb, var(--green) 15%, transparent)); border-color: color-mix(in srgb, var(--green) 45%, var(--border)); color: var(--green); }",
    ".enc-btn:disabled { opacity: 0.55; cursor: not-allowed; }",
    ".enc-error { margin: 0; font-size: 12px; color: var(--red); background: var(--red-soft, color-mix(in srgb, var(--red) 12%, transparent)); border: 1px solid color-mix(in srgb, var(--red) 35%, transparent); border-radius: var(--radius-sm, 5px); padding: 5px 9px; }",
    ".enc-status { font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono); }",
  ].join("\n");
  document.head.appendChild(style);
}

interface FenceMatch {
  openFrom: number;
  closeTo: number;
  innerFrom: number;
  innerTo: number;
  emptyInterior: boolean;
  interior: string;
}

const normFenceBody = (s: string): string => s.replace(/\r\n/g, "\n").replace(/\n$/, "");

function isClosingFenceLine(lineText: string, markChar: string, minLen: number): boolean {
  const t0 = lineText.replace(/^ +/, "");
  if (lineText.length - t0.length > 3) return false;
  let run = 0;
  while (t0[run] === markChar) run++;
  return run >= minLen && t0.slice(run).replace(/[\r\n]+$/, "").trim() === "";
}

function findEncryptedFencesInCm(doc: Text): FenceMatch[] {
  const out: FenceMatch[] = [];
  let open: { lineNo: number; from: number; to: number; markChar: string; markLen: number } | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!open) {
      const m = OPEN_FENCE_RE.exec(line.text);
      if (m) open = { lineNo: n, from: line.from, to: line.to, markChar: m[1][0], markLen: m[1].length };
      continue;
    }
    if (isClosingFenceLine(line.text, open.markChar, open.markLen)) {
      const emptyInterior = n === open.lineNo + 1;
      const innerFrom = emptyInterior ? line.from : open.to + 1;
      const innerTo = emptyInterior ? line.from : line.from - 1;
      const interior = emptyInterior ? "" : doc.sliceString(innerFrom, innerTo);
      out.push({ openFrom: open.from, closeTo: line.to, innerFrom, innerTo, emptyInterior, interior });
      open = null;
    }
  }
  return out;
}

function replaceEncryptedFenceInText(docText: string, oldSource: string, cleanNew: string): string | null {
  const eol = docText.includes("\r\n") ? "\r\n" : "\n";
  const lines = docText.split(/\r?\n/);
  const want = normFenceBody(oldSource);
  let openIdx = -1;
  let markChar = "`";
  let markLen = 3;
  for (let i = 0; i < lines.length; i++) {
    if (openIdx < 0) {
      const m = OPEN_FENCE_RE.exec(lines[i]);
      if (m) { openIdx = i; markChar = m[1][0]; markLen = m[1].length; }
      continue;
    }
    if (isClosingFenceLine(lines[i], markChar, markLen)) {
      const interior = lines.slice(openIdx + 1, i).join("\n");
      if (normFenceBody(interior) === want) {
        const nextInterior = cleanNew ? cleanNew.split("\n") : [];
        return [...lines.slice(0, openIdx + 1), ...nextInterior, ...lines.slice(i)].join(eol);
      }
      openIdx = -1;
    }
  }
  return null;
}

export async function writeFenceSource(
  host: HTMLElement,
  notePath: string,
  oldSource: string,
  newSource: string,
): Promise<void> {
  const cleanNew = normFenceBody(newSource);
  const want = normFenceBody(oldSource);
  const view = EditorView.findFromDOM(host);

  if (view) {
    const doc = view.state.doc;
    let refPos = view.state.selection.main.head;
    try { refPos = view.posAtDOM(host); } catch { /* detached fallback */ }
    const all = findEncryptedFencesInCm(doc);
    const exact = all.filter((b) => normFenceBody(b.interior) === want);
    const pool = exact.length > 0 ? exact : all.length === 1 ? all : [];
    const dist = (b: FenceMatch) => Math.min(Math.abs(b.openFrom - refPos), Math.abs(b.closeTo - refPos));
    const target = pool.sort((a, b) => dist(a) - dist(b))[0];
    if (target) {
      const insertStr = target.emptyInterior ? (cleanNew ? `${cleanNew}\n` : "") : cleanNew;
      const needTrailingNl = target.closeTo >= doc.length;
      const changes = needTrailingNl
        ? [{ from: target.innerFrom, to: target.innerTo, insert: insertStr }, { from: target.closeTo, to: target.closeTo, insert: "\n" }]
        : { from: target.innerFrom, to: target.innerTo, insert: insertStr };
      const delta = insertStr.length - (target.innerTo - target.innerFrom);
      const newCloseFenceTo = target.closeTo + delta;
      const newDocLen = doc.length + delta + (needTrailingNl ? 1 : 0);
      const afterFencePos = Math.min(newDocLen, newCloseFenceTo + 1);
      view.dispatch({ changes, selection: { anchor: afterFencePos }, userEvent: "input.encrypted" });
      return;
    }
  }

  if (!notePath) throw new Error("Cannot persist encrypted block without a note path");
  const fileDoc = await api.file(notePath);
  const updated = replaceEncryptedFenceInText(fileDoc.text, oldSource, cleanNew);
  if (updated === null) throw new Error("Could not locate matching ```encrypted fence in note");
  await api.putFile(notePath, updated, fileDoc.mtime);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

registerFence("kandinsky", "encrypted", (host, fence) => {
  ensureStyles();
  let disposed = false;
  let currentSource = fence.source;

  const card = el("div", { class: "enc-card", "data-testid": "encrypted-block" });
  for (const ev of ["click", "pointerdown", "mousedown"]) card.addEventListener(ev, (e) => e.stopPropagation());
  host.appendChild(card);

  const render = (unlockErr = "", focusEditor = false): void => {
    if (disposed) return;
    card.replaceChildren();

    // State 1: Unconfigured / Empty
    if (currentSource.trim() === "") {
      card.dataset.state = "empty";
      const head = el("div", { class: "enc-head" });
      head.append(el("span", { class: "enc-badge" }, "🔒 New Encrypted Block · AES-256-GCM (PBKDF2-SHA256)"));

      const body = el("div", { class: "enc-body" });
      const plainInput = el("textarea", {
        class: "enc-textarea",
        "data-testid": "encrypted-plaintext-input",
        placeholder: "Write secret note content (encrypted locally in memory; never written in plaintext)…",
      });
      const row = el("div", { class: "enc-row" });
      const passInput = el("input", { type: "password", class: "enc-input", "data-testid": "encrypted-passphrase-input", placeholder: "Passphrase…", autocomplete: "new-password" });
      const confirmInput = el("input", { type: "password", class: "enc-input", "data-testid": "encrypted-confirm-input", placeholder: "Confirm passphrase…", autocomplete: "new-password" });
      const hintInput = el("input", { type: "text", class: "enc-input", placeholder: "Optional hint…" });
      const saveLockBtn = el("button", { type: "button", class: "enc-btn primary", "data-testid": "encrypted-save-lock-btn" }, "Encrypt & Lock");
      const errEl = el("p", { class: "enc-error" });
      errEl.hidden = true;

      const submitNew = async () => {
        errEl.hidden = true;
        const pass = passInput.value;
        if (!pass) { errEl.textContent = "Enter a passphrase to encrypt this block."; errEl.hidden = false; passInput.focus(); return; }
        if (pass !== confirmInput.value) { errEl.textContent = "Passphrases do not match."; errEl.hidden = false; confirmInput.focus(); return; }
        saveLockBtn.disabled = true;
        saveLockBtn.textContent = "Encrypting…";
        try {
          const prev = currentSource;
          const envelope = await encryptBlockText(plainInput.value, pass, hintInput.value);
          lockInMemory(envelope);
          currentSource = envelope;
          await writeFenceSource(host, fence.path, prev, envelope);
          render();
        } catch (e) {
          errEl.textContent = errText(e);
          errEl.hidden = false;
          saveLockBtn.disabled = false;
          saveLockBtn.textContent = "Encrypt & Lock";
        }
      };

      saveLockBtn.addEventListener("click", () => void submitNew());
      confirmInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void submitNew(); } });
      row.append(passInput, confirmInput, hintInput, saveLockBtn);
      body.append(plainInput, row, errEl);
      card.append(head, body);
      return;
    }

    const session = getUnlockedInMemory(currentSource);
    const parsed = parseEncryptedEnvelope(currentSource);

    // State 3: Unlocked (in memory only)
    if (session && parsed) {
      card.dataset.state = "unlocked";
      const head = el("div", { class: "enc-head" });
      const left = el("div", { class: "enc-actions" });
      left.append(el("span", { class: "enc-badge is-unlocked" }, "🔓 Unlocked in memory · AES-256-GCM"));
      if (session.hint || parsed.hint) left.append(el("span", { class: "enc-hint-pill" }, `Hint: ${session.hint ?? parsed.hint}`));
      const statusSpan = el("span", { class: "enc-status" }, "");
      left.append(statusSpan);

      const actions = el("div", { class: "enc-actions" });
      const lockBtn = el("button", { type: "button", class: "enc-btn", "data-testid": "encrypted-lock-btn" }, "Lock");
      const saveBtn = el("button", { type: "button", class: "enc-btn viridian", "data-testid": "encrypted-save-btn" }, "Save");
      const saveLockBtn = el("button", { type: "button", class: "enc-btn primary", "data-testid": "encrypted-save-lock-btn" }, "Save & Lock");
      actions.append(lockBtn, saveBtn, saveLockBtn);
      head.append(left, actions);

      const body = el("div", { class: "enc-body" });
      const editor = el("textarea", { class: "enc-textarea", "data-testid": "encrypted-editor", placeholder: "Encrypted note content…" });
      editor.value = session.plaintext;
      const errEl = el("p", { class: "enc-error" });
      errEl.hidden = true;

      const setBusy = (b: boolean) => { lockBtn.disabled = b; saveBtn.disabled = b; saveLockBtn.disabled = b; };

      const persistUnlocked = async (andLock: boolean) => {
        errEl.hidden = true;
        setBusy(true);
        statusSpan.textContent = "Encrypting…";
        try {
          const prev = currentSource;
          const nextText = editor.value;
          const hint = session.hint ?? parsed.hint;
          const nextEnvelope = await encryptBlockText(nextText, session.passphrase, hint);
          lockInMemory(prev);
          if (andLock) lockInMemory(nextEnvelope);
          else rememberUnlockedInMemory(nextEnvelope, { plaintext: nextText, passphrase: session.passphrase, hint });
          currentSource = nextEnvelope;
          await writeFenceSource(host, fence.path, prev, nextEnvelope);
          statusSpan.textContent = andLock ? "" : "Saved";
          render();
        } catch (e) {
          errEl.textContent = errText(e);
          errEl.hidden = false;
          statusSpan.textContent = "";
          setBusy(false);
        }
      };

      lockBtn.addEventListener("click", () => { lockInMemory(currentSource); render(); });
      saveBtn.addEventListener("click", () => void persistUnlocked(false));
      saveLockBtn.addEventListener("click", () => void persistUnlocked(true));
      editor.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void persistUnlocked(false); }
      });

      body.append(editor, errEl);
      card.append(head, body);
      if (focusEditor) queueMicrotask(() => editor.focus());
      return;
    }

    // State 2: Locked (or invalid envelope)
    card.dataset.state = "locked";
    const head = el("div", { class: "enc-head" });
    const left = el("div", { class: "enc-actions" });
    left.append(el("span", { class: "enc-badge" }, "🔒 Encrypted block · AES-256-GCM"));
    if (parsed?.hint) left.append(el("span", { class: "enc-hint-pill" }, `Hint: ${parsed.hint}`));
    head.append(left);

    const body = el("div", { class: "enc-body" });
    if (!parsed) {
      body.append(el("p", { class: "enc-error" }, "Corrupted or unrecognized encrypted block envelope."));
      card.append(head, body);
      return;
    }

    const row = el("div", { class: "enc-row" });
    const passInput = el("input", { type: "password", class: "enc-input", "data-testid": "encrypted-unlock-input", placeholder: "Enter passphrase to unlock…", autocomplete: "current-password" });
    const unlockBtn = el("button", { type: "button", class: "enc-btn primary", "data-testid": "encrypted-unlock-btn" }, "Unlock");
    const errEl = el("p", { class: "enc-error" }, unlockErr);
    errEl.hidden = !unlockErr;

    const doUnlock = async () => {
      const pass = passInput.value;
      if (!pass) { errEl.textContent = "Enter passphrase to unlock."; errEl.hidden = false; passInput.focus(); return; }
      unlockBtn.disabled = true;
      unlockBtn.textContent = "Unlocking…";
      errEl.hidden = true;
      try {
        const res = await decryptBlockText(currentSource, pass);
        rememberUnlockedInMemory(currentSource, { plaintext: res.plaintext, passphrase: pass, hint: res.hint });
        render("", true);
      } catch {
        unlockBtn.disabled = false;
        unlockBtn.textContent = "Unlock";
        errEl.textContent = "Incorrect passphrase or corrupted ciphertext";
        errEl.hidden = false;
        passInput.select();
      }
    };

    unlockBtn.addEventListener("click", () => void doUnlock());
    passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void doUnlock(); } });
    row.append(passInput, unlockBtn);
    body.append(row, errEl);
    card.append(head, body);
  };

  render();
  return () => { disposed = true; card.remove(); };
});
