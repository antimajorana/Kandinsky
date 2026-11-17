<script lang="ts">
  // Notion-style anchored margin comments drawer for Markdown notes, persisted via `.kandinsky/comments` sidecars.
  import { onMount, onDestroy } from "svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";
  import { onVaultChange } from "../lib/vault";
  import type { CommentThread } from "../lib/gen/CommentThread";

  let {
    path,
    selection = null,
    onjump,
    onclose,
    oncount,
  }: {
    path: string;
    selection?: { from: number; to: number; quote: string; anchor_line: number } | null;
    onjump?: (from: number, to: number, anchorLine: number) => void;
    onclose?: () => void;
    oncount?: (unresolved: number) => void;
  } = $props();

  let threads = $state<CommentThread[]>([]);
  let showResolved = $state(false);
  let draftText = $state("");
  let replyText = $state<Record<string, string>>({});
  let loading = $state(true);
  let busy = $state(false);
  let loadSeq = 0;

  const visibleThreads = $derived(showResolved ? threads : threads.filter((t) => !t.resolved));
  const resolvedCount = $derived(threads.filter((t) => t.resolved).length);

  function notifyCount(list: CommentThread[]): void {
    oncount?.(list.filter((t) => !t.resolved).length);
  }

  async function load(): Promise<void> {
    const targetPath = path;
    if (!targetPath) return;
    const seq = ++loadSeq;
    loading = true;
    try {
      const next = await api.comments(targetPath);
      if (seq !== loadSeq || targetPath !== path) return;
      threads = next;
      notifyCount(threads);
    } catch (e) {
      if (seq !== loadSeq || targetPath !== path) return;
      toast("Could not load comments", errText(e));
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  async function addThread(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const text = draftText.trim();
    if (!text) return;
    busy = true;
    try {
      const sel = selection ?? { from: 0, to: 0, quote: "", anchor_line: 1 };
      threads = await api.mutateComments({
        path,
        action: {
          kind: "add",
          from: sel.from,
          to: sel.to,
          quote: sel.quote,
          anchor_line: sel.anchor_line,
          text,
          author: "You",
        },
      });
      draftText = "";
      notifyCount(threads);
    } catch (e2) {
      toast("Could not save comment", errText(e2));
    } finally {
      busy = false;
    }
  }

  async function addReply(threadId: string, e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const text = (replyText[threadId] ?? "").trim();
    if (!text) return;
    busy = true;
    try {
      threads = await api.mutateComments({
        path,
        action: { kind: "reply", thread_id: threadId, text, author: "You" },
      });
      replyText = { ...replyText, [threadId]: "" };
      notifyCount(threads);
    } catch (e2) {
      toast("Could not reply", errText(e2));
    } finally {
      busy = false;
    }
  }

  async function toggleResolve(t: CommentThread): Promise<void> {
    busy = true;
    try {
      threads = await api.mutateComments({
        path,
        action: { kind: "resolve", thread_id: t.id, resolved: !t.resolved },
      });
      notifyCount(threads);
    } catch (e) {
      toast("Could not update comment", errText(e));
    } finally {
      busy = false;
    }
  }

  async function removeThread(id: string): Promise<void> {
    busy = true;
    try {
      threads = await api.mutateComments({ path, action: { kind: "delete", thread_id: id } });
      notifyCount(threads);
    } catch (e) {
      toast("Could not delete comment", errText(e));
    } finally {
      busy = false;
    }
  }

  $effect(() => { void path; void load(); });
  let offVault: (() => void) | undefined;
  onMount(() => {
    offVault = onVaultChange(() => { if (!busy) void load(); });
  });
  onDestroy(() => offVault?.());
</script>

<aside class="comments-drawer" aria-label="Comments" data-testid="margin-comments">
  <header class="cm-head">
    <strong>Comments</strong>
    {#if resolvedCount > 0}
      <button type="button" class="toggle-res" onclick={() => (showResolved = !showResolved)}>
        {showResolved ? "Hide resolved" : `Resolved (${resolvedCount})`}
      </button>
    {/if}
    {#if onclose}
      <button type="button" class="icon-x" onclick={onclose} aria-label="Close comments"><Icon name="close" size={13} /></button>
    {/if}
  </header>

  <form class="composer" onsubmit={(e) => void addThread(e)}>
    {#if selection?.quote}
      <blockquote class="sel-quote">“{selection.quote}”</blockquote>
    {/if}
    <textarea
      rows="2"
      placeholder={selection?.quote ? "Comment on selected text…" : "Add a comment to this note…"}
      bind:value={draftText}
      disabled={busy}
    ></textarea>
    <div class="comp-foot">
      <small>{selection ? `Line ${selection.anchor_line}` : "Page note"}</small>
      <button type="submit" class="post-btn" disabled={busy || !draftText.trim()}>Comment</button>
    </div>
  </form>

  <div class="thread-list">
    {#if loading && !threads.length}
      <p class="empty">Loading comments…</p>
    {:else if !visibleThreads.length}
      <p class="empty">No open comments yet. Select text in the note and add one.</p>
    {:else}
      {#each visibleThreads as t (t.id)}
        <article class="thread" class:resolved={t.resolved} data-testid="comment-thread">
          <div class="th-top">
            <span class="author">{t.author}</span>
            <button type="button" class="line-jump" onclick={() => onjump?.(t.from, t.to, t.anchor_line)} title="Jump to anchor">
              L{t.anchor_line}
            </button>
            <span class="grow"></span>
            <button type="button" class="act" onclick={() => void toggleResolve(t)} title={t.resolved ? "Reopen" : "Resolve"} aria-label={t.resolved ? "Reopen" : "Resolve"}>
              <Icon name="check" size={12} />
            </button>
            <button type="button" class="act danger" onclick={() => void removeThread(t.id)} title="Delete" aria-label="Delete comment">
              <Icon name="trash" size={12} />
            </button>
          </div>
          {#if t.quote}
            <button type="button" class="th-quote" onclick={() => onjump?.(t.from, t.to, t.anchor_line)}>“{t.quote}”</button>
          {/if}
          <p class="th-body">{t.text}</p>

          {#if t.replies.length > 0}
            <div class="replies">
              {#each t.replies as rep (rep.id)}
                <div class="reply">
                  <strong>{rep.author}</strong>
                  <span>{rep.text}</span>
                </div>
              {/each}
            </div>
          {/if}

          <form class="reply-form" onsubmit={(e) => void addReply(t.id, e)}>
            <input
              placeholder="Reply…"
              value={replyText[t.id] ?? ""}
              oninput={(e) => (replyText = { ...replyText, [t.id]: e.currentTarget.value })}
            />
            {#if (replyText[t.id] ?? "").trim()}
              <button type="submit" class="reply-send" disabled={busy}>Send</button>
            {/if}
          </form>
        </article>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .comments-drawer { width: 290px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--bg-side); min-height: 0; }
  .cm-head { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--heading); }
  .cm-head strong { flex: 1; }
  .toggle-res { font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-muted); padding: 2px 6px; border-radius: var(--radius-sm); }
  .toggle-res:hover { background: var(--bg-hover); }
  .icon-x { color: var(--text-faint); padding: 2px; border-radius: 4px; }
  .icon-x:hover { background: var(--bg-hover); color: var(--text); }
  .composer { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .sel-quote { margin: 0; padding: 4px 8px; border-left: 2px solid var(--accent); background: var(--accent-soft); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .composer textarea { width: 100%; resize: vertical; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; font-size: calc(12.5px * var(--ui-scale, 1)); padding: 6px 8px; }
  .composer textarea:focus { outline: none; border-color: var(--accent); }
  .comp-foot { display: flex; align-items: center; justify-content: space-between; font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-faint); }
  .post-btn { padding: 4px 10px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg, #fff); font-size: calc(11.5px * var(--ui-scale, 1)); font-weight: 600; }
  .post-btn:disabled { opacity: .45; }
  .thread-list { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .empty { margin: 8px 0; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-faint); line-height: 1.4; }
  .thread { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); }
  .thread.resolved { opacity: .65; }
  .th-top { display: flex; align-items: center; gap: 6px; font-size: calc(11.5px * var(--ui-scale, 1)); }
  .author { font-weight: 600; color: var(--heading); }
  .line-jump { color: var(--accent); font-family: var(--font-mono); font-size: calc(10.5px * var(--ui-scale, 1)); padding: 1px 4px; border-radius: 3px; }
  .line-jump:hover { background: var(--accent-soft); }
  .grow { flex: 1; }
  .act { color: var(--text-faint); padding: 2px 4px; border-radius: 4px; }
  .act:hover { background: var(--bg-hover); color: var(--text); }
  .act.danger:hover { color: var(--red); }
  .th-quote { text-align: left; font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); border-left: 2px solid var(--border-strong); padding: 2px 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .th-quote:hover { border-left-color: var(--accent); color: var(--text); }
  .th-body { margin: 0; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text); line-height: 1.45; white-space: pre-wrap; }
  .replies { display: flex; flex-direction: column; gap: 4px; padding-left: 8px; border-left: 1px solid var(--border); }
  .reply { font-size: calc(12px * var(--ui-scale, 1)); color: var(--text); display: flex; flex-direction: column; gap: 1px; }
  .reply strong { font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-muted); }
  .reply-form { display: flex; gap: 4px; }
  .reply-form input { flex: 1; min-width: 0; padding: 4px 7px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-side); color: var(--text); font: inherit; font-size: calc(11.5px * var(--ui-scale, 1)); }
  .reply-form input:focus { outline: none; border-color: var(--accent); background: var(--bg); }
  .reply-send { padding: 3px 8px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); font-size: calc(11px * var(--ui-scale, 1)); font-weight: 600; }
</style>
