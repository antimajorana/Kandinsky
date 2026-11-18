import { test, expect } from "@playwright/test";

// Two settings read by Obsidian-compatible plugins, tested in Node without a page: Antigravity's vault @specialist, and the
// home folder External Files expands `~/` with.
const plugin = (f: string) => import(new URL(`../../plugins/obsidian/${f}`, import.meta.url).href);

/** A page's localStorage, for code that runs in the page. */
function fakeStorage(items: Record<string, string>) {
  const m = new Map(Object.entries(items));
  const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)) };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  return m;
}

test("Antigravity: the @specialist setting is the source of truth, localStorage a cache of it", async () => {
  const ui = await plugin("antigravity/switcher-ui.js");
  const SPEC = ui.AGY_STORAGE_SPECIALIST, SYNCED = ui.AGY_STORAGE_SPECIALIST_SETTING;
  const active = (specialist: string) => ui.getActiveConfig({ plugin: { settings: { specialist } } }).specialist;
  try {
    // nothing stored yet: the setting
    fakeStorage({});
    expect(active("@deriver")).toBe("@deriver");
    expect(ui.reconcileStoredSpecialist({ specialist: "@deriver" })).toBe("@deriver");

    // the setting changed since the last sync (the settings page): it replaces the cache, a clear included
    for (const next of ["@prover", ""]) {
      const m = fakeStorage({ [SPEC]: "@deriver", [SYNCED]: "@deriver" });
      expect(ui.reconcileStoredSpecialist({ specialist: next })).toBe(next);
      expect([m.get(SPEC), m.get(SYNCED)]).toEqual([next, next]);
      expect(active(next)).toBe(next);
    }

    // the setting unchanged: a local pick not saved (yet) is kept, an explicit Coordinator ("") too
    for (const local of ["", "@prover"]) {
      const m = fakeStorage({ [SPEC]: local, [SYNCED]: "@deriver" });
      expect(ui.reconcileStoredSpecialist({ specialist: "@deriver" })).toBe(local);
      expect([m.get(SPEC), m.get(SYNCED)]).toEqual([local, "@deriver"]);
      // a pane's settings copy taken before the change does not bring the old value back
      expect(active("@deriver"), "a stale settings copy").toBe(local);
    }

    // a cache never synced with the setting (written before the plugin ran): the setting
    const m = fakeStorage({ [SPEC]: "@prover" });
    expect(ui.reconcileStoredSpecialist({ specialist: "" })).toBe("");
    expect(m.get(SYNCED)).toBe("");
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("Antigravity: a StatusBar clear whose save fails is reported and kept", async () => {
  const ui = await plugin("antigravity/switcher-ui.js");
  const main = await plugin("antigravity/main.js");
  const g = globalThis as { window?: unknown; localStorage?: unknown };
  const toasts: string[] = [];
  const kandinsky = {
    plugin: { id: "antigravity", settings: { specialist: "@prover", status_bar: false }, saveSettings: () => Promise.reject(new Error("read-only vault")) },
    registerCommand: () => {},
    shell: { menu: () => {} },
    toast: (_title: string, _detail: string, kind: string) => void toasts.push(kind),
  };
  // the cache of an older setting: register replaces it before anything reads it
  fakeStorage({ [ui.AGY_STORAGE_SPECIALIST]: "@deriver", [ui.AGY_STORAGE_SPECIALIST_SETTING]: "@deriver" });
  g.window = new EventTarget();
  let dispose: (() => void) | undefined;
  try {
    dispose = main.register(kandinsky);
    expect(ui.getActiveConfig(kandinsky).specialist).toBe("@prover");
    // what StatusBar.svelte does for "Coordinator": store "" and say so
    (g.localStorage as Storage).setItem(ui.AGY_STORAGE_SPECIALIST, "");
    (g.window as EventTarget).dispatchEvent(new CustomEvent(ui.AGY_CONFIG_EVENT, { detail: { specialist: "", source: "statusbar" } }));
    await expect.poll(() => toasts).toEqual(["error"]);
    expect(ui.getActiveConfig(kandinsky).specialist).toBe("");
    // the next load, with the setting still unsaved, keeps the clear
    expect(ui.reconcileStoredSpecialist(kandinsky.plugin.settings)).toBe("");
  } finally {
    dispose?.();
    delete g.window;
    delete g.localStorage;
  }
});

test("External Files: home comes from the open vault's path, not the vault opened last", async () => {
  const { homeFromVaults } = await plugin("external-files/main.js");
  const vaults = [
    { name: "shared", path: "C:\\Users\\Public\\Documents\\shared-vault" },
    { name: "notes", path: "C:\\Users\\alice\\Notes" },
  ];
  expect(homeFromVaults({ current: "C:\\Users\\alice\\Notes", vaults })).toBe("C:/Users/alice");
  expect(homeFromVaults({ current: "\\\\?\\C:\\Users\\alice\\Notes", vaults: [] }), "a canonical path").toBe("C:/Users/alice");
  expect(homeFromVaults({ current: "/home/u/vault", vaults })).toBe("/home/u");
  // the open vault outside any home: the list's first vault that is in one
  expect(homeFromVaults({ current: "D:/vaults/work", vaults })).toBe("C:/Users/Public");
  expect(homeFromVaults({ current: "D:/vaults/work", vaults: [] })).toBe("");
});
