<script lang="ts">
  // Unified Notion-style sidebar: Vault header ("Several Circles" emblem + switcher), calm primary nav,
  // Favorites, colored Vault Pages tree with folder color picker, and pinned footer (Import, Trash, Plugins, Settings).
  import { onMount, untrack } from "svelte";
  import { api } from "../lib/api";
  import { app, toast } from "../lib/state.svelte";
  import { context } from "../lib/context.svelte";
  import { open, openPath } from "../lib/dock";
  import { homeDoc, openHome, openWith } from "../lib/actions";
  import { openPalette } from "../lib/palette.svelte";
  import { openCaptures, openQuickCapture } from "../lib/quick-capture.svelte";
  import { openSettingsAt } from "../lib/settings-nav.svelte";
  import { chooseVault } from "../lib/vaults";
  import { openWorkspacesMenu, workspaceState } from "../lib/workspaces";
  import { allCommands, keysOf, tipFor } from "../lib/keymap.svelte";
  import { chordLabel } from "../lib/keys";
  import { allApps, appHidden, appLaunchers, ordered, setAppHidden, type AppTile } from "../lib/apps.svelte";
  import { change, settings } from "../lib/settings.svelte";
  import { paneIcon } from "../lib/panes";
  import { tabs, activate, closeTab, canSplit, splitRight, unsplit, pin, unpin, isPinned, pinId, setSidebarWidth, toggleSidebar } from "../lib/tabs.svelte";
  import { fullscreen } from "../lib/fullscreen.svelte";
  import { notificationsInbox, openNotificationsModal, closeNotificationsModal, requestNotificationsSync } from "../lib/notifications-inbox.svelte";
  import { bookmarks, bookmarkTitle, bookmarkIcon, bookmarkDetail, openBookmark, removeBookmark, isFileStarred, toggleFileStar, type Bookmark } from "../lib/bookmarks.svelte";
  import { FOLDER_COLOR_PALETTE, getCustomFolderColor, setCustomFolderColor, getNoteIcon } from "../lib/folder-colors.svelte";
  import { toggleShowAll, treeView } from "../lib/tree-view.svelte";
  import { revealPath } from "../lib/file-tree.svelte";
  import { trashFile, embedItem } from "../lib/sidebar.svelte";
  import { onFilesAddedOrRemoved } from "../lib/vault";
  import { onGitWorthyChange, refreshGitTree } from "../lib/gitstatus.svelte";
  import { VAULT_DRAG, dragRow } from "../lib/explorer/drag";
  import { dirOf, basename } from "../lib/paths";
  import { atPointer, type MenuAt } from "../lib/menu";
  import { revealItems } from "../lib/reveal-items";
  import { pluginMenu } from "../lib/plugin-menus";
  import { movedTabs } from "../lib/gone-files";
  import { editors, lastEditorId, openIntent } from "../lib/registry";
  import { errText } from "../lib/text";
  import type { TreeEntry } from "../lib/types";
  import Icon from "./Icon.svelte";
  import FileTree from "./FileTree.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import type { MenuItem } from "../lib/menu";
  import InputDialog from "./InputDialog.svelte";
  import TrashModal from "./TrashModal.svelte";
  import NotificationsModal from "./NotificationsModal.svelte";
  import { openImportModal } from "../lib/import-modal.svelte";

  const collapsed = $derived(tabs.sidebar.collapsed || fullscreen.on);
  let peek = $state(false);
  const wide = $derived(!collapsed || peek);
  let wsMenuOpen = $state(false);
  let favOpen = $state(true);
  let panesOpen = $state(true);
  let trashOpen = $state(false);
  let homePath = $state<string | null>(null);

  let roots = $state<TreeEntry[]>([]);
  let error = $state("");
  let version = $state(0);
  let menu = $state<MenuAt | null>(null);
  let dialog = $state<{ title: string; value?: string; hint?: string; ok?: string; confirm?: string; submit: (v: string) => void } | null>(null);
  let dropDir = $state<string | null>(null);
  let treeScroller = $state<HTMLElement>();
  let tree = $state<ReturnType<typeof FileTree>>();
  let backTo = "";

  const isHomeActive = $derived(tabs.active === "today" || (!!homePath && context.active?.path === homePath));
  const cmds = $derived(allCommands());
  const searchKey = $derived.by(() => {
    const c = cmds.find((x) => x.id === "ui.quickSwitcher");
    return c?.keys ?? c?.alsoKeys?.at(-1);
  });
  const captureKey = $derived.by(() => {
    const c = cmds.find((x) => x.id === "ui.capture");
    return c?.keys ?? c?.alsoKeys?.[0];
  });
  const vaultKey = $derived(keysOf("ui.vault") ?? keysOf("ui.vault.next"));
  const devMode = $derived(Boolean(settings.config?.developer_mode));
  const homeTile = $derived(appLaunchers().find((a) => a.key === "home"));
  const extraApps = $derived(appLaunchers().filter((a) => !["home", "calendar", "graph", "bases"].includes(a.key)));
  const visibleExtraApps = $derived(extraApps);
  const openAppId = (a: AppTile): string | null =>
    (a.ids.includes(tabs.active ?? "") ? tabs.active : a.ids.find((id) => tabs.apps.some((t) => t.id === id))) ?? null;
  const isAppActive = (a: AppTile): boolean => a.ids.includes(tabs.active ?? "");
  function launchApp(a: AppTile): void {
    const id = openAppId(a);
    if (id) activate(id);
    else a.open();
  }
  function moveVisibleApp(a: AppTile, by: -1 | 1): void {
    const vis = [homeTile, ...extraApps].filter((x): x is AppTile => Boolean(x));
    const idx = vis.findIndex((x) => x.key === a.key);
    const target = vis[idx + by];
    if (idx < 1 || idx + by < 1 || !target) return;
    const keys = ordered(allApps()).map((x) => x.key).filter((k) => k !== a.key);
    const ti = keys.indexOf(target.key);
    if (ti < 0) return;
    keys.splice(by < 0 ? ti : ti + 1, 0, a.key);
    change("Apps", (c) => { c.ui.apps_order = keys; });
  }
  function onAppMenu(e: MouseEvent, a: AppTile): void {
    e.preventDefault();
    e.stopPropagation();
    const id = openAppId(a);
    const vis = [homeTile, ...extraApps].filter((x): x is AppTile => Boolean(x));
    const i = vis.findIndex((l) => l.key === a.key);
    const items: MenuItem[] = id ? [{ label: `Close ${a.title}`, icon: "close", run: () => closeTab(id) }] : [];
    if (i >= 0) {
      if (items.length) items.push("sep");
      items.push(
        { label: "Move earlier", icon: "arrow-up", disabled: i <= 1, run: () => moveVisibleApp(a, -1) },
        { label: "Move later", icon: "arrow-down", disabled: i < 1 || i >= vis.length - 1, run: () => moveVisibleApp(a, 1) },
        { label: `Hide ${a.title} from the bar`, detail: "it still opens from the palette and its keys", icon: "eye", run: () => setAppHidden(a.key, true) },
        "sep",
        { label: "Arrange the apps…", icon: "settings", run: () => openSettingsAt("plugins") },
      );
    }
    if (items.length) menu = atPointer(e, items);
  }
  const pinnedItems = $derived(
    tabs.pins.map((p) => {
      const id = pinId(p);
      const path = "path" in p.spec ? p.spec.path : undefined;
      return {
        id,
        title: p.title,
        icon: paneIcon(p.spec),
        path,
        tip: path ?? ("url" in p.spec ? p.spec.url : p.title),
        open: tabs.open.includes(id),
        active: tabs.active === id,
      };
    }),
  );

  function onPinMenu(e: MouseEvent, p: { id: string; title: string; open: boolean }) {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: p.open ? "Focus" : "Open", icon: "arrow-right", run: () => activate(p.id) },
      { label: "Unpin", icon: "pin", hint: keysOf("ui.tabs.pin"), run: () => unpin(p.id) },
    ];
    if (p.open) items.push("sep", { label: "Close", icon: "close", hint: keysOf("ui.close"), run: () => closeTab(p.id) });
    menu = atPointer(e, items);
  }

  // The editor zone has no tab strip in this shell, so open tabs are listed here: whenever more than one is open or one
  // sits behind another view (always with vertical tabs). Apps with their own nav row and pins are not repeated.
  const navAppIds = $derived(new Set(extraApps.flatMap((a) => a.ids)));
  const mainGroups = $derived(tabs.groups.filter((g) => g.zone === "main"));
  const openPanes = $derived([
    ...tabs.apps
      .filter((t) => !navAppIds.has(t.id) && !isPinned(t.id) && !homeTile?.ids.includes(t.id) && t.kind !== "today" && (!homePath || t.path !== homePath))
      .map((t) => ({ ...t, split: 0 })),
    ...mainGroups.flatMap((g, gi) => g.tabs.map((t) => ({ ...t, split: mainGroups.length > 1 ? gi + 1 : 0 }))),
  ]);
  const showPanes = $derived(openPanes.length > 1 || openPanes.some((t) => !t.shown) || (tabs.layout === "vertical" && openPanes.length > 0));

  function onPaneMenu(e: MouseEvent, t: { id: string; path?: string }) {
    e.preventDefault();
    e.stopPropagation();
    const pinned = isPinned(t.id);
    const items: MenuItem[] = [
      { label: pinned ? "Unpin" : "Pin", icon: "pin", hint: keysOf("ui.tabs.pin"), run: () => (pinned ? unpin(t.id) : pin(t.id)) },
    ];
    if (canSplit(t.id)) items.push({ label: "Split right", icon: "panel-right", run: () => splitRight(t.id) });
    // the tab menu's Show in the explorer / the system's file manager (the classic bar's menu had them too)
    if (t.path) items.push({ label: "Reveal in Vault Pages", icon: "files", run: () => revealPath(t.path!) }, ...revealItems(t.path));
    // the same menu entry the classic bar had: this tab as a live block in the note last written in
    items.push(...embedItem(t.id));
    // the classic bar's tab menu offered this; keep it reachable from the Open section too
    if (t.path) items.push("sep", { label: "Move to Trash…", icon: "close", danger: true, run: () => trashFile(t.path!) });
    items.push("sep", { label: "Close", icon: "close", hint: keysOf("ui.close"), run: () => closeTab(t.id) });
    menu = atPointer(e, items);
  }

  function onNotificationsMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menu = atPointer(e, [
      { label: "Open Notifications Inbox", icon: "bell", run: () => openNotificationsModal() },
      { label: "Open Captures", icon: "inbox", run: () => openCaptures() },
      { label: "Check notifications now", icon: "refresh", run: () => void requestNotificationsSync() },
    ]);
  }

  let hoverT: ReturnType<typeof setTimeout> | undefined;
  function enterNav() {
    clearTimeout(hoverT);
    if (collapsed && !peek && !fullscreen.on) {
      hoverT = setTimeout(() => {
        if (collapsed && !fullscreen.on) peek = true;
      }, 220);
    }
  }
  function leaveNav() {
    clearTimeout(hoverT);
    if (!collapsed || menu || wsMenuOpen || dialog || trashOpen || notificationsInbox.modalOpen) return;
    hoverT = setTimeout(() => { peek = false; }, 240);
  }
  $effect(() => { if (!collapsed && peek) peek = false; });
  $effect(() => { void peek; void collapsed; window.dispatchEvent(new Event("kandinsky-layout")); });

  let stopResize: (() => void) | null = null;
  function resize(e: PointerEvent) {
    e.preventDefault();
    stopResize?.();
    const x0 = e.clientX, w0 = tabs.sidebar.width;
    document.body.classList.add("kandinsky-resizing");
    const move = (ev: PointerEvent) => setSidebarWidth(w0 + ev.clientX - x0);
    const up = () => {
      document.body.classList.remove("kandinsky-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      stopResize = null;
    };
    stopResize = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
  const fail = (what: string) => (e: unknown) =>
    toast(what, e instanceof Error && /409/.test(e.message) ? "Something with that name already exists." : errText(e), "error");

  function newFile(dir: string) {
    dialog = { title: dir ? `New note in ${dir}/` : "New note", hint: "No extension → Markdown note (.md)", ok: "Create", submit: async (name) => {
      const path = join(dir, /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`);
      if (await api.file(path).then(() => true, () => false)) { toast("Could not create the file", "Something with that name already exists.", "error"); return; }
      try { await api.putFile(path, ""); openPath(path); } catch (e) { fail("Could not create the file")(e); }
    } };
  }
  function newFolder(dir: string) {
    dialog = { title: dir ? `New folder in ${dir}/` : "New folder", ok: "Create", submit: (name) => void api.mkdir(join(dir, name)).catch(fail("Could not create the folder")) };
  }
  async function moveTo(from: string, to: string): Promise<void> {
    const follow = movedTabs(from, to);
    await api.move(from, to);
    for (const p of follow) openPath(p);
  }
  function rename(path: string) {
    backTo = path;
    const name = basename(path);
    dialog = { title: `Rename ${name}`, value: name, ok: "Rename", submit: (to) => {
      if (to === name) return;
      backTo = join(dirOf(path), to);
      void moveTo(path, backTo).then(() => setTimeout(() => tree?.refocus(backTo), 300), fail("Could not rename"));
    } };
  }
  function remove(path: string) {
    dialog = { title: `Move “${path}” to the Trash?`, confirm: "Move to Trash", hint: "Recoverable from the Trash.", submit: async () => {
      try { const r = await api.trash(path); toast("Moved to " + r.to, path); } catch (e) { fail("Could not delete")(e); }
    } };
  }

  function onFavMenu(e: MouseEvent, b: Bookmark) {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: "Open", icon: bookmarkIcon(b), run: () => void openBookmark(b) },
      { label: "Remove from Favorites", icon: "close", danger: true, run: () => void removeBookmark(b) },
    ];
    if (b.target.kind === "file") {
      const p = b.target.path;
      items.splice(1, 0, { label: "Copy path", icon: "copy", run: () => void navigator.clipboard.writeText(p).then(() => toast("Copied", p)) });
    }
    menu = atPointer(e, items);
  }

  function onContext(e: MouseEvent) {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".row[data-path]");
    e.preventDefault();
    const path = row?.dataset.path ?? "";
    const isDir = !row || row.classList.contains("is-dir");
    const dir = isDir ? path : dirOf(path);
    const items: MenuItem[] = [
      { label: "New note…", icon: "file-text", run: () => newFile(dir) },
      { label: "New folder…", icon: "folder", run: () => newFolder(dir) },
      { label: "Import notes…", icon: "move-in", run: () => openImportModal(dir) },
    ];
    if (path && !isDir) {
      const starred = isFileStarred(path);
      items.push({ label: starred ? "Remove from Favorites" : "Add to Favorites", icon: "stamp", run: () => toggleFileStar(path) });
    }
    if (isDir && path) {
      const cur = getCustomFolderColor(path);
      items.push("sep", ...FOLDER_COLOR_PALETTE.map((c): MenuItem => ({
        label: `${cur === c.id ? "● " : ""}Color: ${c.label}`, icon: "circle", run: () => void setCustomFolderColor(path, c.id),
      })));
      if (cur !== null) items.push({ label: "Reset folder color", icon: "refresh", run: () => void setCustomFolderColor(path, null) });
    }
    items.push("sep", ...revealItems(path || dir, isDir));
    if (path && !isDir) items.push("sep", { label: "Open with…", icon: "plugin", run: () => openWith(path) });
    if (path) {
      items.push("sep",
        { label: "Rename…", icon: "edit", hint: "F2", run: () => rename(path) },
        { label: "Copy path", icon: "copy", run: () => void navigator.clipboard.writeText(path).then(() => toast("Copied", path)) },
        "sep",
        { label: "Delete…", icon: "trash", hint: "Del", danger: true, run: () => remove(path) });
    }
    items.push(...pluginMenu("file", { path: path || dir, dir: isDir }));
    menu = atPointer(e, items);
  }

  $effect(() => {
    treeScroller?.querySelectorAll(".row.drop-into").forEach((r) => r.classList.remove("drop-into"));
    if (dropDir) treeScroller?.querySelector(`.row[data-path="${CSS.escape(dropDir)}"]`)?.classList.add("drop-into");
  });
  const rowOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>(".row[data-path]");
  const dirAt = (row: HTMLElement | null) => (!row ? "" : row.classList.contains("is-dir") ? row.dataset.path! : dirOf(row.dataset.path!));
  function onDragStart(e: DragEvent) {
    const row = rowOf(e), path = row?.dataset.path;
    if (!path || !e.dataTransfer) return;
    dragRow(e.dataTransfer, { vault: true, path, dir: row!.classList.contains("is-dir") });
  }
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(VAULT_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dropDir = dirAt(rowOf(e));
  }
  function onDrop(e: DragEvent) {
    const from = e.dataTransfer?.getData(VAULT_DRAG);
    const dir = dirAt(rowOf(e));
    dropDir = null;
    if (!from) return;
    e.preventDefault();
    if (dirOf(from) === dir || dir === from || dir.startsWith(from + "/")) return;
    const to = join(dir, basename(from));
    moveTo(from, to).then(() => toast("Moved", `${from} → ${to}`), fail("Could not move"));
  }
  function onTreeKey(e: KeyboardEvent) {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".row[data-path]");
    if (!row?.dataset.path) return;
    if (e.key === "F2") { e.preventDefault(); rename(row.dataset.path); }
    else if (e.key === "Delete") { e.preventDefault(); remove(row.dataset.path); }
  }

  async function refresh() {
    try { roots = await api.tree(undefined, treeView.showAll); error = ""; }
    catch (err) { error = errText(err); }
    version++;
    if (!document.hidden) void refreshGitTree();
  }
  let showAllSeen = untrack(() => treeView.showAll);
  $effect(() => { if (treeView.showAll !== showAllSeen) { showAllSeen = treeView.showAll; void refresh(); } });

  onMount(() => {
    void refresh();
    void homeDoc().then((h) => { homePath = h.path; });
    const offFiles = onFilesAddedOrRemoved(refresh, 500);
    const offGit = onGitWorthyChange(() => void refreshGitTree(), () => !collapsed || peek);
    const onFocus = () => void refreshGitTree();
    window.addEventListener("focus", onFocus);
    const onShown = () => { if (!document.hidden) void refreshGitTree(); };
    document.addEventListener("visibilitychange", onShown);
    const onActive = (e: Event) => revealPath((e as CustomEvent<string>).detail);
    window.addEventListener("kandinsky-active-file", onActive);
    const last = lastEditorId();
    const initialPath = context.active?.path || openIntent.path || (last ? editors.get(last)?.path : undefined);
    if (initialPath) revealPath(initialPath);
    return () => {
      stopResize?.();
      clearTimeout(hoverT);
      offFiles();
      offGit();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onShown);
      window.removeEventListener("kandinsky-active-file", onActive);
    };
  });
</script>

<div class="slot notion-slot" style:width={collapsed ? "var(--sb-collapsed-w)" : `${tabs.sidebar.width}px`}>
  <aside class="notion-sidebar" class:wide class:peek={collapsed && peek}
    style:width={wide ? `${tabs.sidebar.width}px` : undefined} aria-label="Workspace navigation" onmouseenter={enterNav} onmouseleave={leaveNav} data-testid="sidebar">
    <header class="vault-head">
      {#if wide}
        <button class="vault-btn" onclick={() => void chooseVault()} title={vaultKey ? `${app.workspace?.root ?? ""} — switch vault (${vaultKey})` : `${app.workspace?.root ?? ""} — switch vault`}>
          <svg class="brand-emblem" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <defs>
              <radialGradient id="kc-notion-halo" cx="42%" cy="58%" r="48%">
                <stop offset="0%" stop-color="#7d97f4" stop-opacity="0.42" />
                <stop offset="65%" stop-color="#3d63c9" stop-opacity="0.16" />
                <stop offset="100%" stop-color="#13151c" stop-opacity="0" />
              </radialGradient>
            </defs>
            <circle cx="16" cy="16" r="15" fill="#13151c" stroke="rgba(176, 198, 210, 0.55)" stroke-width="1.4" />
            <path d="M 4.2 24.5 A 13.5 13.5 0 0 1 27.8 24.5 A 14.2 14.2 0 0 1 4.2 24.5 Z" fill="#21382d" fill-opacity="0.72" />
            <circle cx="13.6" cy="18.2" r="9.2" fill="url(#kc-notion-halo)" />
            <circle cx="13.6" cy="18.2" r="5.9" fill="#3259c2" fill-opacity="0.94" stroke="#7d97f4" stroke-width="0.65" stroke-opacity="0.72" />
            <circle cx="16.8" cy="11.2" r="4.7" fill="#dfab2e" fill-opacity="0.93" />
            <circle cx="21.2" cy="13.2" r="2.7" fill="#e28327" fill-opacity="0.86" />
            <circle cx="20.6" cy="18.5" r="3.8" fill="#d94e41" fill-opacity="0.9" />
            <circle cx="9.6" cy="10.2" r="2.5" fill="#efc8d2" fill-opacity="0.92" stroke="#dfab2e" stroke-width="0.95" />
            <circle cx="9.6" cy="10.2" r="1.15" fill="#d94e41" />
            <circle cx="23.0" cy="9.4" r="1.95" fill="#3ca395" stroke="#a8dfd4" stroke-width="0.75" />
            <circle cx="19.4" cy="24.2" r="2.35" fill="#3ca395" fill-opacity="0.92" />
            <circle cx="12.6" cy="24.9" r="1.35" fill="#e28327" />
          </svg>
          <span class="vault-name">{app.workspace?.name ?? "Workspace"}</span>
          <span class="vault-chev"><Icon name="chevron-down" size={12} /></span>
        </button>
      {/if}
      <div class="head-btns" class:shown={wsMenuOpen || peek || !wide}>
        {#if wide}
          <button class="head-icon" class:on={wsMenuOpen || Boolean(workspaceState.active)}
            onclick={(e) => { e.stopPropagation(); wsMenuOpen = true; void openWorkspacesMenu(e, () => { wsMenuOpen = false; }); }}
            aria-haspopup="menu" aria-label="Workspaces and layout presets"
            title={tipFor(workspaceState.active ? `Workspaces · ${workspaceState.active}` : "Workspaces & 1-click presets", "ui.workspace.switch")}
            data-testid="workspaces-menu"><Icon name="grid" size={14} /></button>
        {/if}
        <button class="head-icon"
          onclick={(e) => { e.stopPropagation(); if (fullscreen.on) { peek = !peek; return; } toggleSidebar(); peek = false; }}
          aria-label={collapsed ? "Keep sidebar open" : "Collapse sidebar"}
          title={tipFor(collapsed ? "Keep sidebar open" : "Collapse sidebar", "ui.sidebar")}
          data-testid="sidebar-toggle"><Icon name="panel-left" size={15} /></button>
      </div>
    </header>

    <nav class="nav-list" aria-label="Primary">
      <button class="nav-row" aria-label="Search" title={searchKey ? `Search notes & commands · ${searchKey}` : "Search notes & commands"} onclick={() => openPalette("all")}>
        <span class="nav-left"><Icon name="search" size={14} />{#if wide}<span>Search</span>{/if}</span>
        {#if wide && searchKey}<span class="kbd">{chordLabel(searchKey).join(" ")}</span>{/if}
      </button>
      {#if devMode}
        <button class="nav-row" aria-label="Quick capture" title={captureKey ? `Quick capture · ${captureKey}` : "Quick capture"} onclick={() => openQuickCapture()}>
          <span class="nav-left"><Icon name="edit" size={14} />{#if wide}<span>Quick capture</span>{/if}</span>
          {#if wide && captureKey}<span class="kbd">{chordLabel(captureKey).join(" ")}</span>{/if}
        </button>
      {/if}
      <div class="nav-apps" data-testid="apps">
        <button class="nav-row app" class:active={isHomeActive} class:open={homeTile ? Boolean(openAppId(homeTile)) : isHomeActive}
          aria-label="Home" title={tipFor("Home", "ui.today")} data-app-id="today" onclick={() => void openHome()}>
          <span class="nav-left"><Icon name="home" size={14} />{#if wide}<span>Home</span>{/if}</span>
        </button>
        {#if devMode}
          <button class="nav-row" class:active={tabs.active === "calendar"} aria-label="Calendar" title="Calendar" onclick={() => open({ kind: "calendar" })} data-testid="nav-calendar">
            <span class="nav-left"><Icon name="calendar" size={14} />{#if wide}<span>Calendar</span>{/if}</span>
          </button>
          <button class="nav-row" class:active={notificationsInbox.modalOpen} aria-label="Notifications" title="Notifications" onclick={() => openNotificationsModal()} oncontextmenu={onNotificationsMenu}>
            <span class="nav-left"><Icon name="bell" size={14} />{#if wide}<span>Notifications</span>{/if}</span>
            {#if wide && notificationsInbox.totalBadgeCount > 0}<span class="nav-badge">{notificationsInbox.totalBadgeCount}</span>{/if}
          </button>
          <button class="nav-row" class:active={context.active?.kind === "explorer"} aria-label="All pages" title="All pages" onclick={() => open({ kind: "explorer", source: "vault", place: "" })}>
            <span class="nav-left"><Icon name="pages" size={14} />{#if wide}<span>All pages</span>{/if}</span>
          </button>
          {#if !appHidden("graph")}
            <button class="nav-row" class:active={tabs.active === "graph"} aria-label="Graph" title={tipFor("Graph", "ui.graph")} onclick={() => open({ kind: "graph" })}>
              <span class="nav-left"><Icon name="graph" size={14} />{#if wide}<span>Graph</span>{/if}</span>
            </button>
          {/if}
        {/if}
        {#each visibleExtraApps as a (a.ids[0] ?? `app:${a.key}`)}
          <button class="nav-row app" class:active={isAppActive(a)} class:open={Boolean(openAppId(a))}
            aria-label={a.title} title={a.title} data-app-id={a.ids[0]}
            onclick={() => launchApp(a)} oncontextmenu={(e) => onAppMenu(e, a)}>
            <span class="nav-left"><Icon name={a.icon} size={14} />{#if wide}<span>{a.title}</span>{/if}</span>
          </button>
        {/each}
      </div>
    </nav>

    {#if pinnedItems.length > 0}
      <section class="pins-sec" aria-label="Pinned">
        {#if wide}<div class="sec-row"><span class="sec-label">Pinned</span></div>{/if}
        <div class="pins-list" role="listbox" aria-label="Pinned tabs" data-testid="pins">
          {#each pinnedItems as p (p.id)}
            {@const customIcon = p.path ? getNoteIcon(p.path) : null}
            <div class="pin-row" role="presentation">
              <button
                type="button"
                class="pin"
                class:active={p.active}
                class:resting={!p.open}
                role="option"
                aria-selected={p.active}
                aria-label={p.title}
                title={p.open ? p.tip : `${p.tip} (pinned — click to open)`}
                data-tab-id={p.id}
                onclick={() => activate(p.id)}
                onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
                onauxclick={(e) => { if (e.button === 1 && p.open) { e.preventDefault(); closeTab(p.id); } }}
                oncontextmenu={(e) => onPinMenu(e, p)}
              >
                {#if customIcon}<span class="fav-glyph">{customIcon}</span>{:else}<Icon name={p.icon} size={13} />{/if}
                {#if wide}<span class="trunc">{p.title}</span>{/if}
              </button>
              {#if wide}
                <button
                  type="button"
                  class="pane-close"
                  aria-label="Unpin {p.title}"
                  title="Unpin"
                  onclick={(e) => { e.stopPropagation(); unpin(p.id); }}
                >
                  <Icon name="close" size={11} />
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if showPanes}
      <section class="panes-sec" aria-label="Open tabs" data-testid="open-tabs">
        {#if wide}
          <div class="sec-row panes-head">
            <button type="button" class="panes-toggle" onclick={() => (panesOpen = !panesOpen)} aria-expanded={panesOpen}>
              <span class="sec-label">Open</span>
              <span class="panes-count">{openPanes.length}</span>
              <span class="sec-chev" class:open={panesOpen}><Icon name="chevron" size={11} /></span>
            </button>
            <span class="panes-head-actions">
              {#if mainGroups.length > 1}
                <button type="button" class="sec-btn" title="Unsplit" aria-label="Unsplit" onclick={() => unsplit("main")}><Icon name="maximize" size={11} /></button>
              {/if}
              <button type="button" class="kbd panes-kbd" title={searchKey ? `Find an open tab (${searchKey}, then %)` : "Find an open tab (%)"}
                onclick={() => openPalette("all", "%")}>%</button>
            </span>
          </div>
          {#if panesOpen}
            <div class="panes-list">
              {#each openPanes as t (t.id)}
                {@const customIcon = t.path ? getNoteIcon(t.path) : null}
                {@const paneActive = t.id === tabs.active}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="pane-row" class:active={paneActive} class:split-shown={t.shown && !paneActive}
                  onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}
                  oncontextmenu={(e) => onPaneMenu(e, t)}>
                  <button type="button" class="pane-main" data-tab-id={t.id} aria-current={paneActive ? "page" : undefined}
                    onclick={() => activate(t.id)} title={t.tip}>
                    <span class="nav-left">
                      {#if customIcon}<span class="fav-glyph">{customIcon}</span>{:else}<Icon name={t.icon} size={13} />{/if}
                      <span class="trunc pane-title">{t.title}</span>
                      {#if t.hint}<span class="pane-hint">{t.hint}</span>{/if}<!-- two tabs of one name say which folder -->
                    </span>
                    {#if t.split > 0}<span class="split-badge">Split {t.split}</span>{/if}
                  </button>
                  <button type="button" class="pane-close" aria-label="Close {t.title}" title="Close tab"
                    onclick={(e) => { e.stopPropagation(); closeTab(t.id); }}>
                    <Icon name="close" size={11} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <div class="panes-mini" role="group" aria-label="Open tabs">
            {#each openPanes as t (t.id)}
              {@const customIcon = t.path ? getNoteIcon(t.path) : null}
              <button type="button" class="pane-mini-btn" class:active={t.id === tabs.active} data-tab-id={t.id}
                title={t.tip} aria-label={t.title} onclick={() => activate(t.id)} oncontextmenu={(e) => onPaneMenu(e, t)}>
                {#if customIcon}<span class="fav-glyph">{customIcon}</span>{:else}<Icon name={t.icon} size={14} />{/if}
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    {#if bookmarks.list.length > 0}
      <section class="fav-sec wide-only" aria-label="Favorites">
        <button class="sec-toggle" onclick={() => (favOpen = !favOpen)} aria-expanded={favOpen}>
          <span class="sec-label">Favorites</span>
          <span class="sec-chev" class:open={favOpen}><Icon name="chevron" size={11} /></span>
        </button>
        {#if favOpen}
          <div class="fav-list">
            {#each bookmarks.list as b, idx (`${idx}:${bookmarkDetail(b)}`)}
              {@const customIcon = b.target.kind === "file" ? getNoteIcon(b.target.path) : null}
              {@const favActive = b.target.kind === "file" && context.active?.path === b.target.path}
              <button class="nav-row fav-row" class:active={favActive} onclick={() => void openBookmark(b)} oncontextmenu={(e) => onFavMenu(e, b)} title={bookmarkDetail(b)}>
                <span class="nav-left">
                  {#if customIcon}<span class="fav-glyph">{customIcon}</span>{:else}<Icon name={bookmarkIcon(b)} size={14} />{/if}
                  <span class="trunc">{bookmarkTitle(b)}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <div class="sec-row tree-head wide-only">
      <span class="sec-label">Pages</span>
      <span class="sec-actions">
        <button class="sec-btn" title="New note" aria-label="New note" onclick={() => newFile("")}><Icon name="plus" size={13} /></button>
        <button class="sec-btn" title="New folder" aria-label="New folder" onclick={() => newFolder("")}><Icon name="folder" size={13} /></button>
        <button class="sec-btn" class:on={treeView.showAll} title={treeView.showAll ? "Hide dotfiles & companions" : "Show hidden files"} aria-label="Show hidden files" aria-pressed={treeView.showAll} onclick={toggleShowAll}><Icon name="eye" size={13} /></button>
      </span>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tree-scroll wide-only" bind:this={treeScroller} class:drop-root={dropDir === ""} oncontextmenu={onContext} onkeydown={onTreeKey}
      ondragstart={onDragStart} ondragover={onDragOver} ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dropDir = null; }} ondrop={onDrop} ondragend={() => (dropDir = null)}>
      {#if error}<p class="err-msg">{error}</p>{/if}
      <FileTree bind:this={tree} {roots} {version} scroller={treeScroller} />
    </div>

    <footer class="side-foot">
      {#if devMode}
        <button class="nav-row" data-testid="sidebar-import" aria-label="Import" title="Import notes…" onclick={() => openImportModal()}><span class="nav-left"><Icon name="move-in" size={14} />{#if wide}<span>Import</span>{/if}</span></button>
      {/if}
      <button class="nav-row" aria-label="Trash" title="Trash" onclick={() => (trashOpen = true)}><span class="nav-left"><Icon name="trash" size={14} />{#if wide}<span>Trash</span>{/if}</span></button>
      {#if devMode}
        <button class="nav-row" aria-label="Plugins" title="Plugins" onclick={() => openSettingsAt("plugins")}><span class="nav-left"><Icon name="plugin" size={14} />{#if wide}<span>Plugins</span>{/if}</span></button>
      {/if}
      <button class="nav-row" class:active={tabs.active === "settings"} aria-label="Settings" title={tipFor("Settings", "ui.settings")} onclick={() => open({ kind: "settings" })}><span class="nav-left"><Icon name="settings" size={14} />{#if wide}<span>Settings</span>{/if}</span></button>
    </footer>

    {#if !collapsed}<div class="edge" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onpointerdown={resize} ondblclick={() => setSidebarWidth(252)}></div>{/if}
  </aside>
</div>

{#if menu}<ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />{/if}
{#if dialog}<InputDialog title={dialog.title} value={dialog.value} hint={dialog.hint} ok={dialog.ok} confirm={dialog.confirm}
  onsubmit={(v) => { const d = dialog!; dialog = null; d.submit(v); }} oncancel={() => { dialog = null; if (backTo) tree?.refocus(backTo); }} />{/if}
{#if trashOpen}<TrashModal onclose={() => (trashOpen = false)} />{/if}
{#if notificationsInbox.modalOpen}<NotificationsModal onclose={closeNotificationsModal} />{/if}

<style>
  .notion-slot { flex: none; position: relative; align-self: stretch; min-height: 0; overflow: visible; z-index: 30; --sb-collapsed-w: 44px; }
  .notion-sidebar {
    position: absolute; inset: 0 auto 0 0; width: var(--sb-collapsed-w);
    background: var(--bg-side, var(--bg-alt)); border-right: 1px solid var(--border);
    padding: 12px 10px; display: flex; flex-direction: column; font-size: calc(13.5px * var(--ui-scale, 1));
    user-select: none; min-height: 0; z-index: 30; transition: box-shadow .16s ease;
  }
  .notion-sidebar:not(.wide) { padding: 10px 6px; align-items: center; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; }
  .notion-sidebar:not(.wide) .wide-only { display: none; }
  .notion-sidebar.peek {
    top: 8px; bottom: 8px; border-top: 1px solid var(--border-strong); border-bottom: 1px solid var(--border-strong);
    border-right: 1px solid var(--border-strong); border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
    box-shadow: var(--shadow-pop); z-index: 60;
  }
  .vault-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 2px 4px 10px 6px; flex: none; }
  .notion-sidebar:not(.wide) .vault-head { justify-content: center; padding: 0 0 8px; width: 100%; }
  .vault-btn { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 9px; padding: 3px 4px; margin-left: -4px; border-radius: 6px; font-weight: 600; font-size: calc(14px * var(--ui-scale, 1)); letter-spacing: -0.01em; color: var(--heading); text-align: left; }
  .vault-btn:hover { background: var(--bg-hover); }
  .brand-emblem { flex: none; border-radius: 50%; box-shadow: var(--shadow-sm); }
  .vault-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vault-chev { display: inline-flex; color: var(--text-faint); opacity: 0; transition: opacity .12s; }
  .vault-btn:hover .vault-chev, .vault-btn:focus-visible .vault-chev { opacity: 1; }
  .head-btns { display: inline-flex; align-items: center; gap: 2px; opacity: 0; transition: opacity .12s; }
  .vault-head:hover .head-btns, .vault-head:focus-within .head-btns, .head-btns.shown { opacity: 1; }
  .head-icon { width: 24px; height: 24px; border-radius: 5px; display: grid; place-items: center; color: var(--text-faint); }
  .head-icon:hover, .head-icon.on { background: var(--bg-hover); color: var(--text); }
  .nav-list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; flex: none; }
  .nav-apps { display: flex; flex-direction: column; gap: 2px; }
  .notion-sidebar:not(.wide) .nav-list, .notion-sidebar:not(.wide) .nav-apps { align-items: center; width: 100%; }
  .notion-sidebar:not(.wide) .nav-list { margin-bottom: 8px; }
  .nav-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; padding: 5px 8px; border-radius: 6px; color: var(--text-muted); font-size: calc(13px * var(--ui-scale, 1)); text-align: left; transition: background .1s, color .1s; }
  .notion-sidebar:not(.wide) .nav-row { width: 32px; height: 30px; padding: 0; justify-content: center; }
  .nav-row:hover { background: var(--bg-hover); color: var(--text); }
  .nav-row.active { background: var(--accent-soft, var(--bg-active)); color: var(--heading); font-weight: 500; }
  .nav-left { min-width: 0; display: inline-flex; align-items: center; gap: 8px; }
  .nav-left :global(.icon) { color: var(--text-faint); }
  .nav-row:hover .nav-left :global(.icon), .nav-row.active .nav-left :global(.icon) { color: currentColor; }
  .trunc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kbd { flex: none; font-size: calc(10.5px * var(--ui-scale, 1)); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border); color: var(--text-faint); font-family: var(--font-mono); }
  .nav-badge { flex: none; font-size: calc(10.5px * var(--ui-scale, 1)); font-weight: 600; padding: 0 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-variant-numeric: tabular-nums; }
  .pins-sec, .panes-sec, .fav-sec { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; flex: none; }
  .notion-sidebar:not(.wide) :is(.pins-sec, .panes-sec) { align-items: center; width: 100%; border-top: 1px solid var(--border); padding-top: 6px; margin-bottom: 6px; }
  .pins-list { max-height: 112px; overflow-y: auto; scrollbar-width: none; display: flex; flex-direction: column; gap: 1px; }
  .notion-sidebar:not(.wide) .pins-list { align-items: center; width: 100%; max-height: none; }
  .pin-row { display: flex; align-items: center; gap: 2px; width: 100%; padding: 1px 4px 1px 8px; border-radius: 6px; color: var(--text-muted); transition: background .1s, color .1s; }
  .notion-sidebar:not(.wide) .pin-row { padding: 0; justify-content: center; }
  .pin-row:hover { background: var(--bg-hover); color: var(--text); }
  .pin { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 7px; padding: 3px 0; font-size: calc(12.5px * var(--ui-scale, 1)); color: inherit; text-align: left; }
  .notion-sidebar:not(.wide) .pin { flex: none; width: 32px; height: 28px; justify-content: center; border-radius: 6px; }
  .pin.active { color: var(--accent); font-weight: 500; }
  .pin-row:has(.pin.active) { background: var(--accent-soft, var(--bg-active)); }
  .pin.resting { opacity: .65; }
  .pin.resting:hover { opacity: 1; }
  .pin-row:hover .pane-close, .pane-row:hover .pane-close { opacity: 1; }
  .panes-head { gap: 4px; }
  .panes-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 0; color: var(--text-faint); }
  .panes-toggle:hover .sec-chev { opacity: 1; }
  .panes-head-actions { display: inline-flex; align-items: center; gap: 4px; }
  .panes-count { font-size: calc(10px * var(--ui-scale, 1)); font-weight: 600; padding: 0 5px; border-radius: 999px; background: var(--bg-hover); color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .panes-kbd { opacity: 0.72; transition: opacity .12s, color .12s; }
  .panes-kbd:hover { opacity: 1; color: var(--text); background: var(--bg-hover); }
  .panes-mini { display: flex; flex-direction: column; align-items: center; gap: 2px; max-height: 150px; overflow-y: auto; scrollbar-width: none; width: 100%; }
  .pane-mini-btn { width: 32px; height: 28px; border-radius: 6px; display: grid; place-items: center; color: var(--text-muted); flex: none; }
  .pane-mini-btn:hover { background: var(--bg-hover); color: var(--text); }
  .pane-mini-btn.active { background: var(--accent-soft); color: var(--accent); }
  .pane-row { display: flex; align-items: center; gap: 2px; width: 100%; padding: 1px 4px 1px 8px; border-radius: 6px; color: var(--text-muted); transition: background .1s, color .1s; }
  .pane-row:hover { background: var(--bg-hover); color: var(--text); }
  .pane-row.active { background: var(--accent-soft, var(--bg-active)); color: var(--heading); font-weight: 500; }
  .pane-row.split-shown { background: var(--bg-hover); color: var(--text); }
  .pane-hint { flex: none; color: var(--text-faint); font-size: .88em; }
  .pane-main { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; font-size: calc(12.5px * var(--ui-scale, 1)); color: inherit; text-align: left; }
  .pane-row:hover .nav-left :global(.icon), .pane-row.active .nav-left :global(.icon) { color: currentColor; }
  .split-badge { flex: none; font-size: calc(9.5px * var(--ui-scale, 1)); font-weight: 600; padding: 0 5px; border-radius: 4px; border: 1px solid var(--border); color: var(--text-faint); font-family: var(--font-mono); }
  .panes-list { max-height: 160px; overflow-y: auto; scrollbar-width: none; display: flex; flex-direction: column; gap: 1px; }
  .fav-list { max-height: 136px; overflow-y: auto; scrollbar-width: none; display: flex; flex-direction: column; gap: 1px; }
  .pane-close { flex: none; width: 18px; height: 18px; border-radius: 4px; display: grid; place-items: center; color: var(--text-faint); opacity: 0; transition: opacity .1s, background .1s, color .1s; }
  .pane-close:focus-visible { opacity: 1; }
  .pane-close:hover { background: var(--bg-active); color: var(--text); }
  .fav-glyph { width: 14px; text-align: center; font-size: 13px; line-height: 1; flex: none; }
  .sec-toggle, .sec-row { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 5px 8px 3px; }
  .sec-label { font-size: calc(10.5px * var(--ui-scale, 1)); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-faint); }
  .sec-chev { display: inline-flex; color: var(--text-faint); opacity: 0; transition: transform .12s, opacity .12s; }
  .sec-chev.open { transform: rotate(90deg); }
  .sec-toggle:hover .sec-chev { opacity: 1; }
  .sec-actions { display: inline-flex; align-items: center; gap: 2px; opacity: 0; transition: opacity .12s; }
  .tree-head:hover .sec-actions, .tree-head:focus-within .sec-actions { opacity: 1; }
  .sec-btn { width: 20px; height: 20px; border-radius: 4px; display: grid; place-items: center; color: var(--text-faint); }
  .sec-btn:hover, .sec-btn.on { background: var(--bg-hover); color: var(--text); }
  .tree-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; padding: 1px 0 8px; }
  .tree-scroll.drop-root { box-shadow: inset 0 0 0 1px var(--accent); border-radius: 6px; }
  .tree-scroll :global(.row.drop-into) { box-shadow: inset 0 0 0 1px var(--accent); background: var(--bg-hover); }
  .err-msg { margin: 0; padding: 6px 8px; font-size: 12px; color: var(--red); }
  .side-foot { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 4px; display: flex; flex-direction: column; gap: 2px; flex: none; }
  .notion-sidebar:not(.wide) .side-foot { margin-top: auto; width: 100%; align-items: center; }
  .edge { position: absolute; top: 0; bottom: 0; right: -3px; width: 6px; cursor: col-resize; z-index: 2; }
  .edge:hover { background: linear-gradient(to right, transparent 2px, color-mix(in srgb, var(--accent) 45%, transparent) 2px 4px, transparent 4px); transition: background .12s .25s; }
</style>
