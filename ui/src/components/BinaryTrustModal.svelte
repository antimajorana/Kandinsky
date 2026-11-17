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

  let queue = $state<PendingBinaryApproval[]>([]);
  let busy = $state(false);

  const current = $derived(queue[0] ?? null);

  function enqueue(req: PendingBinaryApproval): void {
    if (queue.some((q) => q.id === req.id)) return;
    queue = [...queue, req];
  }

  async function decide(choice: BinaryApprovalChoice): Promise<void> {
    if (!current || busy) return;
    const req = current;
    busy = true;
    try {
      await api.decideBinary({ id: req.id, choice });
      queue = queue.filter((q) => q.id !== req.id);
    } catch (e) {
      toast("Could not save security decision", errText(e));
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void api.securityBinaries().then((res) => {
      for (const req of res.pending) enqueue(req);
    }, () => {});
    const off = on("binaryapproval", (ev) => enqueue(ev));
    return () => off();
  });
</script>

{#if current}
  <div class="trust-backdrop" role="dialog" aria-modal="true" aria-labelledby="trust-title" data-testid="binary-trust-modal">
    <div class="trust-card">
      <header class="trust-head">
        <span class="trust-icon"><Icon name="warning" size={18} /></span>
        <div>
          <h2 id="trust-title">Extension wants to run a local program</h2>
          <p class="trust-sub">Extension <strong>{current.plugin}</strong> is asking permission to execute an external command.</p>
        </div>
      </header>

      <div class="trust-details">
        <div class="kv"><span>Reason</span><span>{current.reason || "External helper execution"}</span></div>
        <div class="kv"><span>Program</span><code>{current.command}</code></div>
        {#if current.args.length > 0}
          <div class="kv"><span>Arguments</span><code>{current.args.join(" ")}</code></div>
        {/if}
        <div class="kv"><span>SHA-256</span><code class="hash">{current.sha256}</code></div>
      </div>

      <footer class="trust-actions">
        <button type="button" class="btn-deny" disabled={busy} onclick={() => void decide("deny")} data-testid="binary-deny">Deny</button>
        <div class="allow-group">
          <button type="button" class="btn-once" disabled={busy} onclick={() => void decide("allow_once")} data-testid="binary-allow-once">Allow once</button>
          <button type="button" class="btn-always" disabled={busy} onclick={() => void decide("always_allow")} data-testid="binary-always-allow">Always allow</button>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .trust-backdrop { position: fixed; inset: 0; z-index: 950; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--bg) 58%, transparent); backdrop-filter: blur(4px); }
  .trust-card { width: min(500px, 95vw); display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: var(--radius); background: var(--bg-elev); border: 1px solid var(--border-strong); box-shadow: var(--shadow-pop); }
  .trust-head { display: flex; align-items: flex-start; gap: 12px; }
  .trust-icon { flex: none; width: 34px; height: 34px; border-radius: 999px; display: grid; place-items: center; background: var(--yellow-soft, color-mix(in srgb, var(--yellow) 16%, transparent)); color: var(--yellow); }
  .trust-head h2 { margin: 0; font-size: calc(15px * var(--ui-scale, 1)); color: var(--heading); }
  .trust-sub { margin: 4px 0 0; font-size: calc(12.5px * var(--ui-scale, 1)); color: var(--text-muted); line-height: 1.4; }
  .trust-details { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg-side); border: 1px solid var(--border); font-size: calc(12px * var(--ui-scale, 1)); }
  .kv { display: grid; grid-template-columns: 78px 1fr; gap: 8px; align-items: baseline; }
  .kv > span:first-child { color: var(--text-faint); font-weight: 600; }
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
