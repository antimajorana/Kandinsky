// Reactive Notifications & Vault Inbox store: plugin notification sources (`notifications/*.md`),
// sync conflict & unsaved rescue notices, and recent captures.
import { api } from "./api";
import { on, touches } from "./bus";
import { openPath } from "./dock";
import type { CaptureItem } from "./gen/CaptureItem";
import { shownName } from "./paths";
import { frontmatterOf } from "./property-model";
import { app, toast } from "./state.svelte";
import { errText } from "./text";
import type { TreeEntry } from "./types";
import { listVault, onFilesAddedOrRemoved, vaultFiles } from "./vault";

export interface NotificationSource {
  path: string; name: string; origin: string; unread: number;
  /** "" | "always" | "YYYY-MM-DD" */
  muted: string; messages: string[]; modified: number;
}

export interface SyncNotice {
  id: string; kind: "conflict" | "rescue" | "offline"; title: string; detail: string; path?: string;
}

const CONFLICT_RE = /\.sync-conflict-\d{8}-\d{6}-[A-Za-z0-9]+|conflicted copy/i;
const localDay = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function mutedStatus(raw: unknown): string {
  const m = String(raw ?? "false").trim();
  if (m === "true") return "always";
  return /^\d{4}-\d{2}-\d{2}$/.test(m) && m >= localDay() ? m : "";
}

function extractSnippets(text: string, fmEnd: number): string[] {
  const body = (fmEnd > 0 ? text.slice(fmEnd) : text).replace(/<!--[\s\S]*?-->/g, "");
  const out: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^#\s+/.test(line)) continue;
    if (/^[-*+]\s+|^#{2,6}\s+/.test(line)) {
      const clean = line.replace(/^([-*+]|#{2,6})\s+/, "").replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s*·\s*$/, "").trim();
      if (clean) out.push(clean.slice(0, 160));
    }
    if (out.length >= 3) break;
  }
  return out;
}

async function walkDirFiles(rootDir: string, maxDepth = 3): Promise<TreeEntry[]> {
  if (!(await api.exists(rootDir).catch(() => false))) return [];
  const found: TreeEntry[] = [];
  const step = async (dir: string, depth: number): Promise<void> => {
    const entries = await api.tree(dir, true).catch(() => []);
    for (const e of entries) {
      if (e.kind === "dir" && depth < maxDepth) await step(e.path, depth + 1);
      else if (e.kind === "file" && (e.size ?? 1) > 0) found.push(e);
    }
  };
  await step(rootDir, 0);
  return found;
}

class NotificationsInboxStore {
  modalOpen = $state(false);
  loading = $state(false);
  syncing = $state(false);
  ready = $state(false);
  folder = $state("notifications");
  pluginUnread = $state<number | null>(null);
  sources = $state<NotificationSource[]>([]);
  fileNotices = $state<SyncNotice[]>([]);
  captures = $state<CaptureItem[]>([]);
  openCapturesCount = $state(0);

  readonly unreadMessages = $derived.by(() => {
    if (this.sources.length > 0) return this.sources.reduce((sum, s) => sum + s.unread, 0);
    return this.pluginUnread ?? 0;
  });

  readonly syncNotices = $derived.by((): SyncNotice[] => {
    const offline: SyncNotice[] = this.ready && app.conn !== "open"
      ? [{ id: "conn:offline", kind: "offline", title: app.conn === "connecting" ? "Reconnecting to Kandinsky core…" : "Offline — connection to core lost",
          detail: "Live file updates pause while offline; local changes sync once reconnected." }]
      : [];
    return [...offline, ...this.fileNotices];
  });

  readonly totalBadgeCount = $derived(this.unreadMessages + this.syncNotices.length);
}

export const notificationsInbox = new NotificationsInboxStore();

let refreshSeq = 0;
export async function refreshInbox(): Promise<void> {
  const seq = ++refreshSeq;
  notificationsInbox.loading = true;
  const folder = notificationsInbox.folder.replace(/^\/+|\/+$/g, "") || "notifications";
  try {
    const [hasFolder, allFiles, rescueFiles, recoveryFiles, capList] = await Promise.all([
      api.exists(folder).catch(() => false),
      listVault().catch(() => [] as string[]),
      walkDirFiles(".kandinsky/rescue", 3),
      walkDirFiles(".kandinsky/cache/recovery", 3),
      api.captures().catch(() => ({ items: [] as CaptureItem[], open: 0, total: 0 })),
    ]);
    const treeEntries = hasFolder ? await api.tree(folder, false).catch(() => []) : [];
    const mdEntries = treeEntries.filter((e) => e.kind === "file" && /\.md$/i.test(e.name));
    const parsedSources = await Promise.all(
      mdEntries.map(async (e): Promise<NotificationSource | null> => {
        try {
          const doc = await api.file(e.path);
          const fm = frontmatterOf(doc.text);
          const data = fm?.data ?? {};
          return {
            path: e.path,
            name: String(data.source || e.name.replace(/\.md$/i, "")),
            origin: data.from ? String(data.from) : "",
            unread: Math.max(0, Number(data.unread) || 0),
            muted: mutedStatus(data.muted),
            messages: extractSnippets(doc.text, fm?.end ?? 0),
            modified: e.modified ?? doc.mtime ?? 0,
          };
        } catch { return null; }
      }),
    );
    if (seq !== refreshSeq) return;
    notificationsInbox.sources = parsedSources
      .filter((s): s is NotificationSource => s !== null)
      .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || b.modified - a.modified || a.name.localeCompare(b.name));
    notificationsInbox.pluginUnread = null;

    const known = vaultFiles();
    const conflicts: SyncNotice[] = allFiles.filter((p) => CONFLICT_RE.test(p)).map((p) => {
      const orig = p.replace(/\.sync-conflict-\d{8}-\d{6}-[A-Za-z0-9]+(?=\.[^./]+$|$)/i, "");
      const target = orig !== p && known.has(orig) ? orig : p;
      return { id: `conflict:${p}`, kind: "conflict", title: shownName(p), detail: `Sync conflict copy (${p})`, path: target };
    });
    const rescues: SyncNotice[] = [
      ...rescueFiles.map((e): SyncNotice => ({ id: `rescue:${e.path}`, kind: "rescue", title: e.name, detail: `Unsaved rescue draft (${e.path})`, path: e.path })),
      ...recoveryFiles.map((e): SyncNotice => {
        const orig = e.path.replace(/^\.kandinsky\/cache\/recovery\/+/, "");
        return { id: `recovery:${e.path}`, kind: "rescue", title: shownName(orig || e.name), detail: `Unsaved recovery copy for ${orig || e.path}`, path: orig || e.path };
      }),
    ];
    notificationsInbox.fileNotices = [...conflicts, ...rescues];
    notificationsInbox.captures = capList.items.slice(0, 12);
    notificationsInbox.openCapturesCount = capList.open;
    notificationsInbox.ready = true;
  } finally {
    if (seq === refreshSeq) notificationsInbox.loading = false;
  }
}

export async function markSourceRead(path: string): Promise<void> {
  const hit = notificationsInbox.sources.find((s) => s.path === path);
  if (hit) hit.unread = 0;
  try {
    await api.setProperty({ path, key: "unread", text: "0", list: false });
    await refreshInbox();
  } catch (e) { toast("Could not mark read", errText(e), "error"); }
}

export function openNotificationSource(path: string): void {
  openPath(path);
  const hit = notificationsInbox.sources.find((s) => s.path === path);
  if (hit && hit.unread > 0) void markSourceRead(path);
}

export async function requestNotificationsSync(): Promise<void> {
  notificationsInbox.syncing = true;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("kandinsky:notifications-sync-request"));
  await refreshInbox();
  notificationsInbox.syncing = false;
}

export function openNotificationsModal(): void { notificationsInbox.modalOpen = true; void refreshInbox(); }
export function closeNotificationsModal(): void { notificationsInbox.modalOpen = false; }

let debounceT: ReturnType<typeof setTimeout> | undefined;
const scheduleRefresh = (ms = 400) => { clearTimeout(debounceT); debounceT = setTimeout(() => void refreshInbox(), ms); };

if (typeof window !== "undefined") {
  window.addEventListener("kandinsky:notifications-updated", (ev: Event) => {
    const d = (ev as CustomEvent<{ unread?: number; folder?: string }>).detail;
    if (d?.folder) notificationsInbox.folder = d.folder;
    if (typeof d?.unread === "number") notificationsInbox.pluginUnread = d.unread;
    scheduleRefresh(150);
  });
  window.addEventListener("kandinsky:open-notifications", (ev: Event) => { ev.preventDefault(); openNotificationsModal(); });
  onFilesAddedOrRemoved(() => scheduleRefresh(500), 500);
  on("fs", (e) => {
    const f = `${notificationsInbox.folder}/`;
    if (touches(e.paths, (p) => p.startsWith(f) || p.startsWith("inbox/") || p.includes("sync-conflict") || p.startsWith(".kandinsky/rescue"))) scheduleRefresh(450);
  });
  setTimeout(() => void refreshInbox(), 120);
}
