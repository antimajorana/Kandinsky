<script lang="ts">
  // Security approval modal for plugins requesting to spawn OS binaries outside the trusted allowlist.
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import { api } from "../lib/api";
  import { on } from "../lib/bus";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";
  import type { BinaryApprovalChoice } from "../lib/gen/BinaryApprovalChoice";
  import type { PendingBinaryApproval } from "../lib/gen/PendingBinaryApproval";

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let queue = $state<PendingBinaryApproval[]>([]);
  let busy = $state(false);
  let techOpen = $state(false);

  const current = $derived(queue[0] ?? null);
  const pluginTitle = $derived(
    current?.plugin ? current.plugin.charAt(0).toUpperCase() + current.plugin.slice(1) : "A plugin",
  );
  $effect(() => {
    void current?.id;
    techOpen = false;
  });

  function enqueue(req: PendingBinaryApproval): void {
    if (queue.some((q) => q.id === req.id || (q.command === req.command && q.sha256 === req.sha256))) {
      return;
    }
    queue = [...queue, req];
  }

  async function refreshPending(): Promise<void> {
    try {
      const res = await api.securityBinaries();
      for (const req of res.pending) enqueue(req);
    } catch {
      // Ignore background sync failures when polling pending binary approvals.
    }
  }

  async function decide(choice: BinaryApprovalChoice): Promise<void> {
    if (!current || busy) return;
    const req = current;
    busy = true;
    try {
      await api.decideBinary({ id: req.id, choice });
      queue = queue.filter(
        (q) => q.id !== req.id && !(q.command === req.command && q.sha256 === req.sha256),
      );
    } catch (e) {
      const msg = errText(e);
      if (/404|expired or not found/i.test(msg)) {
        queue = queue.filter((q) => q.id !== req.id);
        void refreshPending();
      } else {
        toast("Could not save security decision", msg);
      }
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (!dialogEl) return;
    if (current) {
      if (!dialogEl.open && dialogEl.isConnected) dialogEl.showModal();
    } else if (dialogEl.open) {
      dialogEl.close();
    }
  });

  onMount(() => {
    void refreshPending();
    const off = on("binaryapproval", (ev) => enqueue(ev));
    return () => off();
  });
</script>

<dialog
  bind:this={dialogEl}
  class="trust-dialog"
  aria-labelledby="trust-title"
  data-testid="binary-trust-modal"
  oncancel={(e) => {
    e.preventDefault();
    void decide("deny");
  }}
>
  {#if current}
    <div class="trust-card">
      <header class="trust-head">
        <span class="trust-icon"><Icon name="warning" size={18} /></span>
        <div>
          <h2 id="trust-title">{pluginTitle} wants to use a helper program on your computer</h2>
          <p class="trust-sub">{current.reason || "Only allow programs you recognize and trust."}</p>
        </div>
      </header>

      <div class="trust-tech">
        <button
          type="button"
          class="tech-toggle"
          aria-expanded={techOpen}
          aria-controls="trust-tech-details"
          onclick={() => (techOpen = !techOpen)}
        >
          {techOpen ? "Hide technical details" : "Technical details"}
        </button>
        <dl id="trust-tech-details" class="trust-details" class:collapsed={!techOpen} inert={!techOpen}>
          <div class="kv"><dt>Program</dt><dd><code>{current.command}</code></dd></div>
          {#if current.args.length > 0}
            <div class="kv"><dt>Arguments</dt><dd><code>{current.args.join(" ")}</code></dd></div>
          {/if}
          <div class="kv"><dt>SHA-256</dt><dd><code class="hash">{current.sha256}</code></dd></div>
        </dl>
      </div>

      <footer class="trust-actions">
        <!-- svelte-ignore a11y_autofocus -->
        <button type="button" class="btn-deny" disabled={busy} autofocus onclick={() => void decide("deny")} data-testid="binary-deny">Deny</button>
        <div class="allow-group">
          <button type="button" class="btn-once" disabled={busy} onclick={() => void decide("allow_once")} data-testid="binary-allow-once">Allow once</button>
          <button type="button" class="btn-always" disabled={busy} onclick={() => void decide("always_allow")} data-testid="binary-always-allow">Always allow</button>
        </div>
      </footer>
    </div>
  {/if}
</dialog>

<style>
  dialog.trust-dialog {
    padding: 0;
    margin: auto;
    border: none;
    background: transparent;
    color: var(--text);
    width: min(500px, 95vw);
    max-width: min(500px, 95vw);
    overflow: visible;
  }
  dialog.trust-dialog[open] {
    display: flex;
  }
  dialog.trust-dialog:modal {
    overscroll-behavior: contain;
  }
  dialog.trust-dialog::backdrop {
    overflow: hidden;
    overscroll-behavior: contain;
    background: color-mix(in srgb, var(--bg) 58%, transparent);
    backdrop-filter: blur(4px);
  }
  /* a long command line scrolls inside the details, so the buttons below never leave the window */
  .trust-card { max-height: calc(100dvh - 32px); min-height: 0; }
  .trust-head, .trust-actions { flex: none; }
  .trust-tech { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .tech-toggle { align-self: flex-start; padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-muted); font-size: calc(12px * var(--ui-scale, 1)); font-weight: 500; cursor: pointer; }
  .tech-toggle:hover { color: var(--text); border-color: var(--border-strong); background: var(--bg-hover); }
  .trust-details { min-height: 0; overflow-y: auto; overscroll-behavior: contain; margin: 0; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg-side); border: 1px solid var(--border); font-size: calc(12px * var(--ui-scale, 1)); }
  .trust-details.collapsed { max-height: 0; padding-block: 0; margin-block: 0; border-width: 0; opacity: 0; overflow-y: hidden; pointer-events: none; }
  .trust-details:not(.collapsed) { max-height: min(36dvh, 220px); overflow-y: auto; }
  .trust-card { width: 100%; display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: var(--radius); background: var(--bg-elev); border: 1px solid var(--border-strong); box-shadow: var(--shadow-pop); }
  .trust-head { display: flex; align-items: flex-start; gap: 12px; }
  .trust-icon { flex: none; width: 34px; height: 34px; border-radius: 999px; display: grid; place-items: center; background: var(--yellow-soft, color-mix(in srgb, var(--yellow) 16%, transparent)); color: var(--yellow); }
  .trust-head h2 { margin: 0; font-size: calc(15px * var(--ui-scale, 1)); color: var(--heading); }
  .trust-sub { margin: 4px 0 0; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text-muted); line-height: 1.4; }
  .kv { display: grid; grid-template-columns: 78px 1fr; gap: 8px; align-items: baseline; }
  .kv dt { color: var(--text-faint); font-weight: 600; }
  .kv dd { margin: 0; min-width: 0; }
  .kv code { font-family: var(--font-mono); color: var(--text); word-break: break-all; }
  .hash { font-size: calc(11px * var(--ui-scale, 1)); color: var(--text-muted); }
  .trust-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .allow-group { display: inline-flex; gap: 8px; }
  .btn-deny { padding: 6px 12px; border-radius: var(--radius-sm); border: 1px solid color-mix(in srgb, var(--red) 40%, var(--border)); background: transparent; color: var(--red); font-weight: 500; }
  .btn-deny:hover { background: color-mix(in srgb, var(--red) 12%, transparent); }
  .btn-once { padding: 6px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-weight: 500; }
  .btn-once:hover { background: var(--bg-hover); }
  .btn-always { padding: 6px 14px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg, #fff); font-weight: 600; }
</style>
