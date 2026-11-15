<script lang="ts">
  // The blocks for notes, Home and the daily note: ```view finance.balance / finance.spending / finance.register.
  import { call, currency, folder, type PluginApi, type RegisterRow, type Summary } from "./api";
  import Spending from "./Spending.svelte";
  import Balances from "./Balances.svelte";
  import Register from "./Register.svelte";

  export type Kind = "balance" | "spending" | "register";
  let { kandinsky, kind, options }: { kandinsky: PluginApi; kind: Kind; options: Record<string, unknown> } = $props();
  const cur = $derived(String(options.currency ?? currency(kandinsky)));
  const account = $derived(String(options.account ?? "Assets"));
  const limit = $derived(Number(options.limit ?? (kind === "register" ? 10 : 8)));
  let summary = $state<Summary | null>(null);
  let rows = $state<RegisterRow[]>([]);
  let error = $state("");

  async function load() {
    try {
      if (kind === "register") rows = (await call<{ rows: RegisterRow[] }>(kandinsky, "register", { account })).rows;
      else summary = await call<Summary>(kandinsky, "summary");
      error = "";
    } catch (e) { error = (e as Error).message; }
  }
  $effect(() => {
    load();
    return kandinsky.on("file:save", (e) => { if ((e as { path?: string }).path?.startsWith(`${folder(kandinsky)}/`)) load(); });
  });
</script>

<div class="finance-block">
  {#if error}
    <div class="kandinsky-notice error">{error}</div>
  {:else if kind === "register"}
    <Register {rows} {account} {limit} onopen={(r) => kandinsky.open(r.path, r.line)} />
  {:else if !summary}
    <div class="kandinsky-empty">Reading the journal…</div>
  {:else if kind === "balance"}
    <Balances accounts={summary.accounts} {cur} onpick={() => kandinsky.openView("accounts", { title: "Finance" })} />
  {:else}
    <Spending budget={summary.budget} {cur} {limit} />
  {/if}
</div>

<style>
  .finance-block { font-size: 0.95em; }
</style>
