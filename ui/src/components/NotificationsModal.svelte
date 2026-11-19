<script module lang="ts">
  import type { Notice } from "../lib/gen/Notice";

  const MAX_LIVE_NOTICES = 30;
  let liveNotices = $state<Notice[]>([]);

  export function recordLiveNotice(n: Notice): void {
    const idx = n.id ? liveNotices.findIndex((x) => x.id === n.id) : -1;
    if (idx >= 0) {
      liveNotices[idx] = n;
      liveNotices = [...liveNotices];
      return;
    }
    liveNotices = [n, ...liveNotices].slice(0, MAX_LIVE_NOTICES);
  }

  export function withdrawLiveNotice(id: string): void {
    if (!id) return;
    liveNotices = liveNotices.filter((n) => n.id !== id && n.subject !== id);
  }

  function dismissLiveNotice(target: Notice): void {
    liveNotices = liveNotices.filter((n) => (target.id ? n.id !== target.id : n !== target));
  }
</script>

<script lang="ts">
  // Notion-style × Kandinsky Notifications & Inbox modal: plugin notification sources, sync/rescue alerts, live action notices, and recent captures.
  import { onMount } from "svelte";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { openPath } from "../lib/dock";
  import type { NoticeAction } from "../lib/gen/NoticeAction";
  import { shownName } from "../lib/paths";
  import { openCaptures, openQuickCapture } from "../lib/quick-capture.svelte";
  import { openSettingsAt } from "../lib/settings-nav.svelte";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";
  import {
    notificationsInbox,
    refreshInbox,
    requestNotificationsSync,
    markSourceRead,
    openNotificationSource,
  } from "../lib/notifications-inbox.svelte";

  let { onclose }: { onclose: () => void } = $props();

  type FilterTab = "all" | "messages" | "sync" | "captures";
  let tab = $state<FilterTab>("all");

  const sources = $derived(notificationsInbox.sources);
  const notices = $derived(notificationsInbox.syncNotices);
  const captures = $derived(notificationsInbox.captures);
  const unreadTotal = $derived(notificationsInbox.unreadMessages);
  const liveCount = $derived(liveNotices.length);
  const totalBadge = $derived(notificationsInbox.totalBadgeCount + liveCount);

  async function runNoticeAction(n: Notice, a: NoticeAction): Promise<void> {
    try {
      await api.noticeAction({ action: a.id, source: n.source, notice: n.id, open: n.open });
      dismissLiveNotice(n);
    } catch (err) {
      toast(`“${a.label}” failed`, errText(err), "error");
    }
  }

  onMount(() => {
    void refreshInbox();
  });
</script>

<Dialog label="Notifications & Inbox" {onclose} testid="notifications-modal">
  <div class="notif-modal">
    <header class="notif-head">
      <div class="notif-title">
        <span class="bell-orb"><Icon name="bell" size={15} /></span>
        <span>Notifications &amp; Inbox</span>
        {#if totalBadge > 0}<span class="badge-pill">{totalBadge}</span>{/if}
      </div>
      <div class="head-actions">
        <button type="button" class="ghost-btn" disabled={notificationsInbox.syncing}
          onclick={() => void requestNotificationsSync()} title="Sync notification sources & refresh vault inbox">
          <span class="btn-ico" class:spinning={notificationsInbox.syncing}><Icon name="refresh" size={12} /></span>
          <span>{notificationsInbox.syncing ? "Checking…" : "Check now"}</span>
        </button>
        <button type="button" class="ghost-btn" onclick={() => { openCaptures(); onclose(); }}>
          Open Captures
        </button>
        <button type="button" class="accent-btn" onclick={() => { onclose(); openQuickCapture(); }}>
          + Quick capture
        </button>
        <button type="button" class="icon-btn" aria-label="Close Notifications & Inbox" onclick={onclose}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </header>

    <nav class="filter-bar" aria-label="Notification sections">
      <button type="button" class="tab-btn" class:active={tab === "all"} onclick={() => (tab = "all")}>
        <span>All</span>
        {#if totalBadge > 0}<span class="tab-count">{totalBadge}</span>{/if}
      </button>
      <button type="button" class="tab-btn" class:active={tab === "messages"} onclick={() => (tab = "messages")}>
        <span>Messages</span>
        {#if unreadTotal > 0}
          <span class="tab-count unread">{unreadTotal}</span>
        {:else if sources.length > 0}
          <span class="tab-count">{sources.length}</span>
        {/if}
      </button>
      <button type="button" class="tab-btn" class:active={tab === "sync"} onclick={() => (tab = "sync")}>
        <span>Sync &amp; Alerts</span>
        {#if notices.length + liveCount > 0}
          <span class="tab-count warn">{notices.length + liveCount}</span>
        {:else}
          <span class="sync-dot" aria-hidden="true"></span>
        {/if}
      </button>
      <button type="button" class="tab-btn" class:active={tab === "captures"} onclick={() => (tab = "captures")}>
        <span>Captures</span>
        {#if notificationsInbox.openCapturesCount > 0}
          <span class="tab-count">{notificationsInbox.openCapturesCount}</span>
        {/if}
      </button>
    </nav>

    <div class="notif-body">
      {#if tab === "all" || tab === "messages"}
        <section class="sec" aria-label="Messages">
          <div class="sec-head">
            <span class="sec-title">Messages</span>
            {#if unreadTotal > 0}<span class="sec-sub">{unreadTotal} unread</span>{/if}
          </div>
          {#if sources.length === 0}
            <div class="empty-card">
              <div class="empty-ico"><Icon name="bell" size={16} /></div>
              <div class="empty-copy">
                <p class="empty-title">No notification sources yet</p>
                <p class="empty-sub">
                  Enable the <strong>Notifications</strong> plugin (ntfy / Apprise) to collect server &amp; phone alerts as Markdown notes in <code>{notificationsInbox.folder}/</code>.
                </p>
              </div>
              <button type="button" class="act-btn" onclick={() => { openSettingsAt("plugins"); onclose(); }}>
                Plugins
              </button>
            </div>
          {:else}
            <ul class="card-list">
              {#each sources as s (s.path)}
                <li class="source-card" class:is-unread={s.unread > 0}>
                  <div class="source-top">
                    <div class="source-title-row">
                      {#if s.unread > 0}<span class="unread-dot" title="{s.unread} unread"></span>{/if}
                      <span class="source-name">{s.name}</span>
                      {#if s.unread > 0}<span class="pill unread-pill">{s.unread} new</span>{/if}
                      {#if s.muted}
                        <span class="pill muted-pill">{s.muted === "always" ? "Muted" : `Muted until ${s.muted}`}</span>
                      {/if}
                      {#if s.origin}<span class="source-origin">{s.origin}</span>{/if}
                    </div>
                    <div class="row-actions">
                      {#if s.unread > 0}
                        <button type="button" class="act-btn" onclick={() => void markSourceRead(s.path)}>Mark read</button>
                      {/if}
                      <button type="button" class="act-btn primary" onclick={() => { openNotificationSource(s.path); onclose(); }}>
                        Open
                      </button>
                    </div>
                  </div>
                  {#if s.messages.length > 0}
                    <ul class="snippet-list">
                      {#each s.messages.slice(0, tab === "messages" ? 3 : 2) as msg, idx (idx)}
                        <li class="snippet">{msg}</li>
                      {/each}
                    </ul>
                  {:else}
                    <p class="snippet faint">No messages logged in {s.path}</p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      {#if tab === "all" || tab === "sync"}
        <section class="sec" aria-label="Sync and Vault Notices">
          <div class="sec-head">
            <span class="sec-title">Sync &amp; Vault Notices</span>
          </div>
          {#if notices.length === 0 && liveNotices.length === 0}
            <div class="sync-ok" data-testid="sync-ok">
              <span class="ok-badge"><Icon name="check" size={14} /></span>
              <span class="ok-text">All vault files in sync</span>
              <span class="ok-sub">0 conflict copies · 0 unsaved rescue drafts</span>
            </div>
          {:else}
            <ul class="card-list">
              {#each liveNotices as n, idx (n.id ?? `${n.title}:${idx}`)}
                <li class="notice-row live" class:offline={n.level === "failure"}>
                  <span class="warn-ico"><Icon name={n.level === "failure" ? "error" : n.level === "warning" ? "warning" : "bell"} size={15} /></span>
                  <div class="notice-meta">
                    <span class="notice-title">{n.title}{#if n.source} <span class="source-origin">· {n.source}</span>{/if}</span>
                    {#if n.body}<span class="notice-detail">{n.body}</span>{/if}
                  </div>
                  <div class="row-actions">
                    {#each n.actions ?? [] as a (a.id)}
                      <button type="button" class="act-btn primary" onclick={() => void runNoticeAction(n, a)}>{a.label}</button>
                    {/each}
                    {#if n.open && !(n.actions ?? []).some((a) => /open/i.test(a.label))}
                      {@const openTarget = n.open}
                      <button type="button" class="act-btn" onclick={() => { openPath(openTarget); onclose(); }}>Open</button>
                    {/if}
                    <button type="button" class="icon-btn" aria-label="Dismiss notice" title="Dismiss" onclick={() => dismissLiveNotice(n)}>
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                </li>
              {/each}
              {#each notices as n (n.id)}
                <li class="notice-row" class:offline={n.kind === "offline"}>
                  <span class="warn-ico"><Icon name={n.kind === "offline" ? "error" : "warning"} size={15} /></span>
                  <div class="notice-meta">
                    <span class="notice-title">{n.title}</span>
                    <span class="notice-detail">{n.detail}</span>
                  </div>
                  {#if n.path}
                    {@const targetPath = n.path}
                    <button type="button" class="act-btn warn-btn" onclick={() => { openPath(targetPath); onclose(); }}>
                      Open &amp; resolve
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      {#if tab === "all" || tab === "captures"}
        <section class="sec" aria-label="Recent Captures">
          <div class="sec-head">
            <span class="sec-title">Recent Captures</span>
            <button type="button" class="link-btn" onclick={() => { openCaptures(); onclose(); }}>
              View all captures →
            </button>
          </div>
          {#if captures.length === 0}
            <p class="empty-line">No recent captures yet — use <strong>+ Quick capture</strong> to jot notes or tasks into your inbox.</p>
          {:else}
            <ul class="cap-list">
              {#each captures.slice(0, tab === "captures" ? 12 : 6) as c, idx (`${c.path}:${c.line}:${idx}`)}
                <li>
                  <button type="button" class="cap-row" onclick={() => { openPath(c.path, c.line || undefined); onclose(); }} title="{c.path}{c.line ? `:${c.line}` : ''}">
                    <span class="cap-ico"><Icon name={c.kind === "note" ? "file-text" : /^\s*[-*+]\s+\[.\]/.test(c.source) ? "list-todo" : "inbox"} size={14} /></span>
                    <span class="cap-text">{c.text || shownName(c.path)}</span>
                    <span class="cap-meta">{c.day}{c.time ? ` ${c.time}` : ""} · {shownName(c.path)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</Dialog>

<style>
  .notif-modal { width: min(640px, 94vw); max-height: 76vh; display: flex; flex-direction: column; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-xl); box-shadow: var(--shadow-pop); overflow: hidden; }
  .notif-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .notif-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: calc(14.5px * var(--ui-scale, 1)); color: var(--heading); }
  .bell-orb { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
  .badge-pill { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--accent); color: var(--accent-fg); font-variant-numeric: tabular-nums; }
  .head-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .ghost-btn, .accent-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; padding: 4px 9px; border-radius: 6px; border: 1px solid var(--border); color: var(--text-muted); }
  .ghost-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
  .ghost-btn:disabled { opacity: 0.55; cursor: default; }
  .accent-btn { border-color: color-mix(in srgb, var(--accent) 45%, var(--border-strong)); background: var(--accent-soft); color: var(--accent); }
  .accent-btn:hover { background: var(--accent-sel); color: var(--heading); }
  .btn-ico { display: inline-flex; }
  .btn-ico.spinning { animation: spin 0.8s linear infinite; }
  .icon-btn { width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; color: var(--text-faint); }
  .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
  .filter-bar { display: flex; align-items: center; gap: 4px; padding: 7px 14px; border-bottom: 1px solid var(--border); background: var(--bg-alt); overflow-x: auto; }
  .tab-btn { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
  .tab-btn:hover { background: var(--bg-hover); color: var(--text); }
  .tab-btn.active { background: var(--bg-elev); color: var(--heading); box-shadow: var(--shadow-sm); border: 1px solid var(--border); }
  .tab-count { font-size: 10.5px; font-weight: 600; padding: 0 6px; border-radius: 999px; background: var(--bg-hover); color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .tab-count.unread { background: var(--accent-soft); color: var(--accent); }
  .tab-count.warn { background: var(--orange-soft, rgba(226, 131, 39, 0.14)); color: var(--orange); }
  .sync-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
  .notif-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 16px; display: flex; flex-direction: column; gap: 16px; }
  .sec { display: flex; flex-direction: column; gap: 8px; }
  .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sec-title { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-faint); }
  .sec-sub { font-size: 11.5px; color: var(--accent); font-weight: 500; }
  .link-btn { font-size: 12px; color: var(--link); font-weight: 500; }
  .link-btn:hover { text-decoration: underline; }
  .empty-card { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: var(--radius-lg); border: 1px dashed var(--border-strong); background: var(--bg-alt); }
  .empty-ico { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; background: var(--bg-elev); color: var(--text-faint); flex: none; }
  .empty-copy { flex: 1; min-width: 0; }
  .empty-title { margin: 0 0 2px; font-size: 13px; font-weight: 600; color: var(--heading); }
  .empty-sub { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.45; }
  .empty-sub code { font-family: var(--font-mono); font-size: 11px; padding: 1px 4px; border-radius: 4px; background: var(--code-bg); color: var(--inline-code); }
  .card-list, .cap-list, .snippet-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .source-card { padding: 10px 12px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--card-bg, var(--bg-alt)); display: flex; flex-direction: column; gap: 6px; }
  .source-card.is-unread { border-color: color-mix(in srgb, var(--accent) 42%, var(--border-strong)); }
  .source-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .source-title-row { display: inline-flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
  .unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  .source-name { font-size: 13.5px; font-weight: 600; color: var(--heading); }
  .source-origin { font-size: 11.5px; color: var(--text-faint); font-family: var(--font-mono); }
  .pill { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 999px; }
  .unread-pill { background: var(--accent-soft); color: var(--accent); }
  .muted-pill { background: var(--bg-hover); color: var(--text-faint); border: 1px solid var(--border); }
  .snippet-list { gap: 3px; }
  .snippet { margin: 0; font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .snippet.faint { color: var(--text-faint); }
  .sync-ok { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border-radius: var(--radius-lg); background: var(--green-soft, rgba(60, 163, 149, 0.12)); border: 1px solid color-mix(in srgb, var(--green) 32%, var(--border)); }
  .ok-badge { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--green) 20%, transparent); color: var(--green); flex: none; }
  .ok-text { font-size: 13px; font-weight: 600; color: var(--green); }
  .ok-sub { margin-left: auto; font-size: 11.5px; color: var(--text-muted); }
  .notice-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: var(--radius-lg); border: 1px solid color-mix(in srgb, var(--orange) 40%, var(--border)); background: var(--orange-soft, rgba(226, 131, 39, 0.1)); }
  .notice-row.live { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); background: var(--bg-alt); }
  .notice-row.live .warn-ico { color: var(--accent); }
  .notice-row.offline { border-color: color-mix(in srgb, var(--red) 40%, var(--border)); background: var(--red-soft, rgba(217, 78, 65, 0.1)); }
  .warn-ico { color: var(--orange); display: inline-flex; flex: none; }
  .notice-row.offline .warn-ico { color: var(--red); }
  .notice-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .notice-title { font-size: 13px; font-weight: 600; color: var(--heading); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .notice-detail { font-size: 11.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-actions { display: inline-flex; align-items: center; gap: 6px; flex: none; }
  .act-btn { padding: 3px 9px; border-radius: 5px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-size: 12px; font-weight: 500; white-space: nowrap; }
  .act-btn:hover { background: var(--bg-hover); }
  .act-btn.primary { border-color: color-mix(in srgb, var(--accent) 45%, var(--border-strong)); background: var(--accent-soft); color: var(--accent); }
  .act-btn.warn-btn { border-color: color-mix(in srgb, var(--orange) 45%, var(--border-strong)); color: var(--orange); }
  .empty-line { margin: 0; padding: 10px 4px; font-size: 12.5px; color: var(--text-muted); }
  .cap-list { gap: 2px; }
  .cap-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 6px; text-align: left; color: var(--text); }
  .cap-row:hover { background: var(--bg-hover); }
  .cap-ico { color: var(--text-faint); display: inline-flex; flex: none; }
  .cap-text { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cap-meta { flex: none; font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); }
</style>
