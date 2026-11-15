// localStorage access that never throws (private windows, blocked storage, Tauri quirks).
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works, it just forgets */
  }
}

/** A plain string kept as is (not JSON): what a page's inline script reads before the app loads (`kandinsky.theme`). */
export function loadRaw(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function saveRaw(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function drop(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export const KEYS = {
  // layout, recent and pins moved to files of the vault (docs/guides/SHELL.md); the keys remain to read them once
  layout: "kandinsky.layout.v1",
  theme: "kandinsky.theme",
  vim: "kandinsky.vim",
  recent: "kandinsky.recent.v1",
  pins: "kandinsky.pins.v1",
  sidebar: "kandinsky.sidebar.v1",
  sidePanel: "kandinsky.sidepanel.v1",
  tabs: "kandinsky.tabs",
} as const;
