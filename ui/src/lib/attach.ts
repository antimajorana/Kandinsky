// Files pasted or dropped into text: clipboard paste saves immediately beside the note (`POST /api/attach`), while
// external file drops open `DropFileChoiceModal` so the author can copy into `zAttachments/`, link in place (`file:///`),
// or copy beside the note.
import { tick } from "svelte";
import { createSubscriber } from "svelte/reactivity";
import { api, ApiError } from "./api";
import { IMAGE_RE } from "./paths";
import { errText } from "./text";
import { toast } from "./state.svelte";

/** Obsidian's name for clipboard images, which arrive as a bare "image.png". */
export function attachmentName(f: File): string {
  if (f.name && !/^image\.\w+$/.test(f.name)) return f.name;
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
  return `Pasted image ${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export type Attached = { path: string; embed: string };

/** Attaches each file beside `note` → those that made it (saved path + embed); a failure is said and skipped. */
export async function attachFiles(note: string, files: File[]): Promise<Attached[]> {
  const done: Attached[] = [];
  for (const f of files) {
    try { done.push(await api.attach(note, attachmentName(f), f)); }
    catch (err) { toast(`Could not attach ${f.name || "the pasted file"}`, errText(err), "error"); }
  }
  return done;
}

/** The files a paste or a drop carries (none for plain text). */
export function filesOf(data: DataTransfer | null): File[] {
  return data ? [...data.files] : [];
}

/** A paste that carries nothing at all: WebKitGTK's paste-as-plain-text (Ctrl+Shift+V, Vim mode's paste) of a
 *  picture hands over an empty text and no files. The picture is still on the desktop's clipboard. */
function pastedNothing(data: DataTransfer | null): boolean {
  if (!data || data.files.length) return false;
  return [...data.types].every((t) => t === "text/plain") && !data.getData("text/plain");
}

/** The picture on the desktop's clipboard, read by the core (`GET /api/clipboard/image`); null when there is none. */
async function clipboardPicture(): Promise<File | null> {
  try {
    const blob = await api.clipboardImage();
    if (!blob) return null;
    return new File([blob], `image.${(blob.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: blob.type || "image/png" });
  } catch { return null; }
}

/** The files of a paste or a drop, or null when it is text (the default goes on). Call it in the event handler itself:
 *  when it answers files it has already taken the event (preventDefault), even if they come later from the core. */
export function takeFiles(e: ClipboardEvent | DragEvent): Promise<File[]> | null {
  const data = "clipboardData" in e ? e.clipboardData : e.dataTransfer;
  const files = filesOf(data);
  if (files.length) { e.preventDefault(); return Promise.resolve(files); }
  if (!("clipboardData" in e) || !pastedNothing(data)) return null;
  e.preventDefault();
  return clipboardPicture().then((f) => (f ? [f] : []));
}

// --- Interactive Drop-File Copy-vs-Link Workflow ------------------------------------------------

export const VAULT_ATTACH_DIR = "zAttachments";
export const VAULT_EMBED_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|mp3|wav|ogg|m4a|opus|webm|mp4|pdf)$/i;

export type DropFileChoice =
  | { action: "vault" }
  | { action: "link"; uri: string }
  | { action: "beside" }
  | { action: "cancel" };

export interface DropFilePromptState {
  notePath: string;
  files: File[];
  uriHint: string;
  defaultUri: string;
  choose: (choice: DropFileChoice) => void;
  cancel: () => void;
}

let promptCurrent: DropFilePromptState | null = null;
const promptListeners = new Set<() => void>();
const subscribePrompt = createSubscriber((update) => {
  promptListeners.add(update);
  return () => { promptListeners.delete(update); };
});

/** Reactive modal state read by `DropFileChoiceModal.svelte` (and `App.svelte` when active). */
export const dropFilePrompt: { current: DropFilePromptState | null } = {
  get current() {
    subscribePrompt();
    return promptCurrent;
  },
  set current(next: DropFilePromptState | null) {
    promptCurrent = next;
    for (const notify of promptListeners) notify();
  },
};

/** Inspects a DragEvent synchronously (before the browser clears `dataTransfer`) for a local path or `file:///` URI. */
export function extractDropUriHint(e: DragEvent): string {
  try {
    const dt = e.dataTransfer;
    if (!dt) return "";
    const uriList = dt.getData("text/uri-list");
    if (uriList) {
      const first = uriList.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
      if (first) return first;
    }
    const plain = dt.getData("text/plain")?.trim();
    if (plain) return plain.split(/\r?\n/)[0].trim();
    const firstFile = dt.files?.[0] as unknown as { path?: string } | undefined;
    return firstFile?.path?.trim() || "";
  } catch {
    return "";
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const escapeMarkdownUri = (u: string): string =>
  u.replace(/\s+/g, (m) => encodeURIComponent(m))
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");

/** Normalizes a local OS path, `uriHint`, or typed `file:///` string into a safe Markdown `file:///` (or `https://`) URI. */
export function toExternalFileUri(raw: string, fallbackName: string): string {
  const s = raw.trim();
  if (!s) return escapeMarkdownUri(`file:///${fallbackName.replace(/^\/+/, "")}`);
  if (/^file:\/\//i.test(s)) {
    const slashed = s.replace(/\\/g, "/").replace(/^file:\/\/([A-Za-z]:\/)/i, "file:///$1");
    return escapeMarkdownUri(slashed);
  }
  if (/^https?:\/\//i.test(s)) return escapeMarkdownUri(s);
  if (/^[A-Za-z]:[\\/]/.test(s)) return escapeMarkdownUri(`file:///${s.replace(/\\/g, "/")}`);
  if (/^\\\\[^\\]/.test(s)) return escapeMarkdownUri(`file://${s.replace(/^\\+/, "").replace(/\\/g, "/")}`);
  if (s.startsWith("/")) return escapeMarkdownUri(`file://${s}`);
  return escapeMarkdownUri(`file:///${s.replace(/\\/g, "/")}`);
}

export function previewExternalMarkdown(fileName: string, rawUri: string): string {
  const label = (fileName || "file").replace(/[\[\]\r\n]+/g, "").trim() || "file";
  const uri = toExternalFileUri(rawUri, label);
  const isImg = IMAGE_RE.test(label) || IMAGE_RE.test(uri.split(/[?#]/)[0]);
  return isImg && /^file:\/\/\/.+/i.test(uri) ? `![](${uri})` : `[${label}](${uri})`;
}

function sanitizeVaultName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || name;
  const cleaned = base.replace(/[<>:"/\\|?*#^\[\]\x00-\x1f]+/g, "_").trim().replace(/^\.+/, "");
  return cleaned || "attachment";
}

async function copyFilesToVaultAttachments(files: File[]): Promise<Attached[]> {
  const done: Attached[] = [];
  const taken = new Set<string>();
  for (const f of files) {
    const safeName = sanitizeVaultName(attachmentName(f));
    const dot = safeName.lastIndexOf(".");
    const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : "";
    let n = 1;
    while (n < 10_000) {
      const finalName = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
      const destPath = `${VAULT_ATTACH_DIR}/${finalName}`;
      try {
        if (taken.has(destPath) || (await api.exists(destPath))) { n++; continue; }
        await api.upload(destPath, f, false);
        taken.add(destPath);
        const embed = VAULT_EMBED_RE.test(finalName) ? `![[${destPath}]]` : `[[${destPath}]]`;
        done.push({ path: destPath, embed });
        break;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) { n++; continue; }
        toast(`Could not copy ${f.name || "file"} into ${VAULT_ATTACH_DIR}/`, errText(err), "error");
        break;
      }
    }
  }
  return done;
}

function linkFilesInPlace(files: File[], confirmedUri: string, defaultUri: string): Attached[] {
  const firstBase = toExternalFileUri(confirmedUri, files[0] ? attachmentName(files[0]) : "file");
  const dirPrefix = firstBase.includes("/") ? firstBase.slice(0, firstBase.lastIndexOf("/") + 1) : "file:///";
  const unchanged = confirmedUri.trim() === defaultUri.trim();
  return files.map((f, idx) => {
    const rawName = f.name || attachmentName(f);
    const osPath = (f as unknown as { path?: string })?.path?.trim() || "";
    const itemRaw = idx === 0
      ? confirmedUri
      : unchanged && osPath
        ? osPath
        : `${dirPrefix}${rawName}`;
    const uri = toExternalFileUri(itemRaw, rawName);
    const embed = previewExternalMarkdown(rawName, uri);
    return { path: uri, embed };
  });
}

function defaultExternalInput(files: File[], uriHint: string): string {
  const first = files[0];
  if (!first) return "file:///";
  const osPath = (first as unknown as { path?: string })?.path?.trim() || "";
  const seed = uriHint.trim() || osPath;
  if (seed) return toExternalFileUri(seed, first.name || attachmentName(first));
  return `file:///${first.name || attachmentName(first)}`;
}

/** Opens `DropFileChoiceModal` for dropped files and executes the chosen attachment strategy. */
export async function attachDroppedFiles(notePath: string, files: File[], uriHint = ""): Promise<Attached[]> {
  if (!files.length) return [];
  if (dropFilePrompt.current) dropFilePrompt.current.cancel();

  const defaultUri = defaultExternalInput(files, uriHint);
  const choice = await new Promise<DropFileChoice>((resolve) => {
    let settled = false;
    let fallbackCleanup: (() => void) | null = null;
    const finish = (c: DropFileChoice) => {
      if (settled) return;
      settled = true;
      if (dropFilePrompt.current === state) dropFilePrompt.current = null;
      fallbackCleanup?.();
      resolve(c);
    };
    const state: DropFilePromptState = {
      notePath,
      files,
      uriHint,
      defaultUri,
      choose: finish,
      cancel: () => finish({ action: "cancel" }),
    };
    dropFilePrompt.current = state;

    if (typeof document !== "undefined") {
      void tick().then(async () => {
        if (settled || dropFilePrompt.current !== state) return;
        if (document.querySelector('[data-testid="drop-file-choice-modal"]')) return;
        const [{ mount, unmount }, mod] = await Promise.all([
          import("svelte"),
          import("../components/DropFileChoiceModal.svelte"),
        ]);
        if (settled || dropFilePrompt.current !== state || document.querySelector('[data-testid="drop-file-choice-modal"]')) return;
        const host = document.body.appendChild(document.createElement("div"));
        const inst = mount(mod.default, { target: host });
        fallbackCleanup = () => { void unmount(inst); host.remove(); };
      });
    }
  });

  if (choice.action === "vault") return copyFilesToVaultAttachments(files);
  if (choice.action === "link") return linkFilesInPlace(files, choice.uri, defaultUri);
  if (choice.action === "beside") return attachFiles(notePath, files);
  return [];
}
