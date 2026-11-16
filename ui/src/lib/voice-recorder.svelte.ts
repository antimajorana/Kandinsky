// Reactive state, window event bridge (`kandinsky:voice-record`), and vault upload helper (`zAttachments/recording-…`)
// for the `/voice` audio recorder modal.
import type { EditorView } from "@codemirror/view";
import { api } from "./api";
import { activeEditorId, lastEditorId } from "./dock";
import { editors } from "./registry";

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

function fallbackEditorInsert(embed: string): void {
  const id = activeEditorId() ?? lastEditorId();
  const ed = id ? editors.get(id) : undefined;
  if (ed) {
    ed.insertBlock(embed);
    ed.focus();
  }
}

function buildViewInserter(view: EditorView): (embed: string) => void {
  return (embed: string) => {
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
  voiceRecorder.notePath = notePath ?? activePath;
  voiceRecorder.onInsert = onInsert ?? fallbackEditorInsert;
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
    const onInsert = detail.onInsert ?? (view ? buildViewInserter(view) : fallbackEditorInsert);
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
  let targetPath = `zAttachments/recording-${stamp}.${cleanExt}`;
  for (let suffix = 2; suffix < 100; suffix++) {
    const taken = await api.exists(targetPath).catch(() => false);
    if (!taken) break;
    targetPath = `zAttachments/recording-${stamp}-${suffix}.${cleanExt}`;
  }
  await api.upload(targetPath, blob, false);
  return { path: targetPath, embed: `![[${targetPath}]]` };
}
