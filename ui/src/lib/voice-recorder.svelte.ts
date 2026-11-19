// Reactive state, window event bridge (`kandinsky:voice-record`), and vault upload helper (`<attachment_folder>/recording-…`)
// for the `/voice` audio recorder modal.
import type { EditorView } from "@codemirror/view";
import { api } from "./api";
import { vaultAttachDir } from "./attach";
import { activeEditorId, lastEditorId } from "./dock";
import { editors } from "./registry";
import { toast } from "./state.svelte";

export interface VoiceRecordEventDetail {
  view?: EditorView | null;
  path?: string;
  onInsert?: (embed: string) => void;
}

export const voiceRecorder = $state<{
  open: boolean;
  notePath: string;
  onInsert: ((embed: string) => void) | null;
}>({
  open: false,
  notePath: "",
  onInsert: null,
});

async function appendToNoteOnDisk(notePath: string, embed: string): Promise<void> {
  try {
    const f = await api.file(notePath);
    const sep = f.text.endsWith("\n") || !f.text ? "" : "\n";
    await api.putFile(notePath, `${f.text}${sep}${embed}\n`, f.mtime);
    toast("Recording linked", `Added at the end of ${notePath}`, "success", 3000);
  } catch (e) {
    console.warn("[kandinsky] voice note fallback append failed", notePath, e);
    toast("Recording saved but not linked", `Paste ${embed} into ${notePath} by hand.`, "error");
  }
}

function fallbackEditorInsert(embed: string, notePath?: string): void {
  const id = activeEditorId() ?? lastEditorId();
  const activeEd = id ? editors.get(id) : undefined;
  const targetEd =
    (activeEd && (!notePath || activeEd.path === notePath) ? activeEd : undefined) ??
    (notePath ? [...editors.values()].find((e) => e.path === notePath) : undefined) ??
    // A known note with no open editor is appended on disk, never written into an unrelated note.
    (notePath ? undefined : activeEd);
  if (targetEd) {
    targetEd.insertBlock(embed);
    targetEd.focus();
    return;
  }
  if (notePath) void appendToNoteOnDisk(notePath, embed);
}

function buildViewInserter(view: EditorView, notePath?: string): (embed: string) => void {
  return (embed: string) => {
    if (!view.dom.isConnected) {
      fallbackEditorInsert(embed, notePath);
      return;
    }
    const at = view.state.selection.main.head;
    const line = view.state.doc.lineAt(at);
    const before = view.state.sliceDoc(line.from, at);
    const lead = before.trim().length > 0 ? "\n" : "";
    const insert = `${lead}${embed}\n`;
    view.dispatch({
      changes: { from: at, to: at, insert },
      selection: { anchor: at + insert.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    view.focus();
  };
}

export function openVoiceRecorder(notePath?: string, onInsert?: (embed: string) => void): void {
  const id = activeEditorId() ?? lastEditorId();
  const activePath = id ? (editors.get(id)?.path ?? "") : "";
  const resolvedPath = notePath ?? activePath;
  voiceRecorder.notePath = resolvedPath;
  voiceRecorder.onInsert = onInsert ?? ((embed: string) => fallbackEditorInsert(embed, resolvedPath));
  voiceRecorder.open = true;
}

export function closeVoiceRecorder(): void {
  voiceRecorder.open = false;
  voiceRecorder.onInsert = null;
}

export function installVoiceRecorderListener(): () => void {
  if (typeof window === "undefined") return () => {};
  const onRecord = (ev: Event) => {
    const detail = (ev as CustomEvent<VoiceRecordEventDetail>).detail ?? {};
    const view = detail.view ?? null;
    const notePath =
      detail.path ??
      view?.dom.getAttribute("data-note") ??
      editors.get(activeEditorId() ?? lastEditorId() ?? "")?.path ??
      "";
    const onInsert = detail.onInsert ?? (view ? buildViewInserter(view, notePath) : (embed: string) => fallbackEditorInsert(embed, notePath));
    openVoiceRecorder(notePath, onInsert);
  };
  window.addEventListener("kandinsky:voice-record", onRecord);
  return () => window.removeEventListener("kandinsky:voice-record", onRecord);
}

function formatRecordingStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function normalizeAudioExt(blob: Blob, ext?: string): string {
  const clean = (ext ?? "").replace(/^\.+/, "").trim().toLowerCase();
  if (clean) return clean;
  const t = blob.type.toLowerCase();
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "m4a";
  if (t.includes("wav")) return "wav";
  return "webm";
}

export async function saveVoiceRecording(blob: Blob, ext?: string): Promise<{ path: string; embed: string }> {
  const cleanExt = normalizeAudioExt(blob, ext);
  const stamp = formatRecordingStamp();
  const dir = vaultAttachDir();
  let targetPath = `${dir}/recording-${stamp}.${cleanExt}`;
  for (let suffix = 2; suffix < 100; suffix++) {
    const taken = await api.exists(targetPath).catch(() => false);
    if (!taken) break;
    targetPath = `${dir}/recording-${stamp}-${suffix}.${cleanExt}`;
  }
  await api.upload(targetPath, blob, false);
  return { path: targetPath, embed: `![[${targetPath}]]` };
}
