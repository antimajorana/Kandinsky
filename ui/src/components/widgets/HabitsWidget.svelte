<script lang="ts">
  import { onMount, tick } from "svelte";
  import { api, ApiError } from "../../lib/api";
  import { openPath } from "../../lib/dock";
  import { localDay } from "../../lib/local-day";
  import { dirOf, resolveRel, shownName } from "../../lib/paths";
  import { reloadOnChange } from "../../lib/reload-on-change";
  import { errReason } from "../../lib/text";

  let { options = {}, doc = "" }: { options?: Record<string, unknown>; doc?: string } = $props();

  interface HabitsDoc { prefix: string; suffix: string; habits: string[]; checks: Record<string, string[]> }

  const DEFAULT_SEED = ["Deep work", "Reading", "Exercise"];
  const DEFAULT_PREFIX = "---\ntype: habits\n---\n\n# Habits\n\n";
  const CHECKED_RE = /^(?:x|✓|✔|true|\[x\]|1|yes)$/i;

  const targetPath = $derived.by(() => {
    const raw = (typeof options.path === "string" ? options.path : "").replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim() || "Habits.md";
    const withExt = /\.\w+$/.test(raw) ? raw : `${raw}.md`;
    return withExt.startsWith("./") || withExt.startsWith("../") ? resolveRel(withExt, dirOf(doc)) : withExt.replace(/^\/+/, "");
  });

  const seedHabits = $derived.by(() => {
    const raw = Array.isArray(options.habits) ? options.habits.map(String) : typeof options.habits === "string" ? options.habits.split(",") : [];
    const cleaned = raw.map((s) => s.replace(/\|/g, "/").trim()).filter(Boolean);
    return cleaned.length ? cleaned : DEFAULT_SEED;
  });

  const dayCount = $derived(Math.max(5, Math.min(14, Math.round(Number(options.days) || 7))));

  function shiftDay(iso: string, delta: number): string {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + delta);
    return localDay(d);
  }

  const splitRow = (line: string): string[] =>
    line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());

  function parseHabits(text: string, fallback: string[]): HabitsDoc {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const hIdx = lines.findIndex((l, i) => l.trim().startsWith("|") && /^\|[\s:|-]+\|$/.test(lines[i + 1]?.trim() ?? ""));
    if (hIdx < 0) {
      const pre = text.endsWith("\n\n") ? text : text.endsWith("\n") ? `${text}\n` : `${text}\n\n`;
      return { prefix: text.trim() ? pre : DEFAULT_PREFIX, suffix: "\n", habits: [...fallback], checks: {} };
    }
    let endIdx = hIdx + 2;
    while (endIdx < lines.length && lines[endIdx].trim().startsWith("|")) endIdx++;
    const cols = splitRow(lines[hIdx]).slice(1).filter(Boolean);
    const habits = cols.length ? cols : [...fallback];
    const checks: Record<string, string[]> = {};
    for (let r = hIdx + 2; r < endIdx; r++) {
      const cells = splitRow(lines[r]);
      const date = cells[0] ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const done = habits.filter((_, j) => CHECKED_RE.test((cells[j + 1] ?? "").trim()));
      checks[date] = done;
    }
    return {
      prefix: hIdx > 0 ? `${lines.slice(0, hIdx).join("\n")}\n` : "",
      suffix: endIdx < lines.length ? `\n${lines.slice(endIdx).join("\n")}` : "\n",
      habits,
      checks,
    };
  }

  function serializeHabits(d: HabitsDoc, today: string): string {
    const esc = (s: string) => s.replace(/\|/g, "\\|");
    const head = `| Date | ${d.habits.map(esc).join(" | ")} |`;
    const sep = `| --- | ${d.habits.map(() => "---").join(" | ")} |`;
    const dates = Object.keys(d.checks).filter((k) => (d.checks[k]?.length ?? 0) > 0).sort((a, b) => b.localeCompare(a));
    if (!dates.length) dates.push(today);
    const rows = dates.map((dt) => {
      const set = new Set(d.checks[dt] ?? []);
      return `| ${dt} | ${d.habits.map((h) => (set.has(h) ? "x" : "")).join(" | ")} |`;
    });
    return `${d.prefix}${head}\n${sep}\n${rows.join("\n")}${d.suffix}`;
  }

  let rootEl = $state<HTMLElement | null>(null);
  let todayIso = $state(localDay());
  let fileExists = $state(false);
  let mtime = $state<number | undefined>(undefined);
  let loaded = $state(false);
  let error = $state("");
  let saving = $state(0);
  let adding = $state(false);
  let newHabit = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let docState = $state<HabitsDoc>({ prefix: DEFAULT_PREFIX, suffix: "\n", habits: DEFAULT_SEED, checks: {} });

  const days = $derived(Array.from({ length: dayCount }, (_, i) => shiftDay(todayIso, i - (dayCount - 1))));
  const isDone = (dt: string, h: string): boolean => (docState.checks[dt] ?? []).includes(h);

  function streakOf(habit: string): number {
    let cur = isDone(todayIso, habit) ? todayIso : shiftDay(todayIso, -1);
    if (!isDone(cur, habit)) return 0;
    let n = 0;
    while (n < 3660 && isDone(cur, habit)) { n++; cur = shiftDay(cur, -1); }
    return n;
  }

  const doneToday = $derived(docState.habits.filter((h) => isDone(todayIso, h)).length);
  const allToday = $derived(docState.habits.length > 0 && doneToday === docState.habits.length);

  function dayMeta(iso: string): { dow: string; dom: string } {
    const d = new Date(`${iso}T12:00:00`);
    const dow = d.toLocaleDateString(undefined, { weekday: dayCount > 9 ? "narrow" : "short" });
    return { dow, dom: String(d.getDate()) };
  }

  async function load(preserveError = false): Promise<void> {
    if (saving > 0) return;
    const p = targetPath;
    todayIso = localDay();
    try {
      const f = await api.file(p);
      if (p !== targetPath) return;
      fileExists = true; mtime = f.mtime; docState = parseHabits(f.text, seedHabits);
      if (!preserveError) error = "";
    } catch (e) {
      if (p !== targetPath) return;
      if (e instanceof ApiError && e.status === 404) {
        fileExists = false; mtime = undefined;
        docState = { prefix: DEFAULT_PREFIX, suffix: "\n", habits: [...seedHabits], checks: {} };
        if (!preserveError) error = "";
      } else error = errReason(e);
    } finally { loaded = true; }
  }

  $effect(() => { void targetPath; void seedHabits; void load(); });
  onMount(() => reloadOnChange(() => void load(), { wait: 280, wants: (p) => p === targetPath, host: () => rootEl }));

  const cloneDoc = (d: HabitsDoc): HabitsDoc => ({
    prefix: d.prefix, suffix: d.suffix, habits: [...d.habits],
    checks: Object.fromEntries(Object.entries(d.checks).map(([k, v]) => [k, [...v]])),
  });

  async function persist(mutate: (d: HabitsDoc) => void): Promise<void> {
    const p = targetPath;
    todayIso = localDay();
    const optimistic = cloneDoc(docState);
    mutate(optimistic);
    docState = optimistic;
    saving++;
    let failed = false;
    try {
      if (!fileExists) {
        const res = await api.createFile(p, serializeHabits(optimistic, todayIso));
        if (res.written) { fileExists = true; mtime = res.mtime; error = ""; return; }
        const fresh = await api.file(p);
        const merged = parseHabits(fresh.text, seedHabits);
        mutate(merged);
        const res2 = await api.putFile(p, serializeHabits(merged, todayIso), fresh.mtime);
        fileExists = true; mtime = res2.mtime; docState = merged; error = "";
        return;
      }
      try {
        const res = await api.putFile(p, serializeHabits(optimistic, todayIso), mtime);
        mtime = res.mtime; error = "";
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const fresh = await api.file(p);
          const merged = parseHabits(fresh.text, seedHabits);
          mutate(merged);
          const res2 = await api.putFile(p, serializeHabits(merged, todayIso), fresh.mtime);
          mtime = res2.mtime; docState = merged; error = "";
        } else if (e instanceof ApiError && e.status === 404) {
          const res2 = await api.putFile(p, serializeHabits(optimistic, todayIso));
          fileExists = true; mtime = res2.mtime; error = "";
        } else throw e;
      }
    } catch (e) {
      error = errReason(e);
      failed = true;
    } finally {
      saving--;
      if (failed) void load(true);
    }
  }

  function toggleCell(date: string, habit: string): void {
    const want = !isDone(date, habit);
    void persist((d) => {
      if (!d.habits.includes(habit)) d.habits.push(habit);
      const cur = new Set(d.checks[date] ?? []);
      if (want) cur.add(habit); else cur.delete(habit);
      d.checks[date] = d.habits.filter((h) => cur.has(h));
    });
  }

  async function openAddHabit(): Promise<void> {
    adding = true;
    newHabit = "";
    await tick();
    inputEl?.focus();
  }

  function submitHabit(e: SubmitEvent): void {
    e.preventDefault();
    const name = newHabit.replace(/\|/g, "/").trim();
    adding = false;
    newHabit = "";
    if (!name || docState.habits.some((h) => h.toLowerCase() === name.toLowerCase())) return;
    void persist((d) => {
      if (!d.habits.some((h) => h.toLowerCase() === name.toLowerCase())) d.habits.push(name);
    });
  }
</script>

<section class="kw-habits" bind:this={rootEl} aria-label="Habit tracker">
  <header class="kw-head">
    <div class="kw-title-wrap">
      <span class="kw-title">{shownName(targetPath)}</span>
      <span class="kw-badge" class:complete={allToday}>{doneToday}/{docState.habits.length} today</span>
    </div>
    <div class="kw-actions">
      {#if adding}
        <form class="add-form" onsubmit={submitHabit}>
          <input bind:this={inputEl} bind:value={newHabit} type="text" class="add-input" placeholder="Habit name…"
            aria-label="New habit name" onkeydown={(e) => { if (e.key === "Escape") { adding = false; newHabit = ""; } }} />
          <button type="submit" class="act-btn primary">Add</button>
        </form>
      {:else}
        <button type="button" class="act-btn" onclick={() => void openAddHabit()}>+ Habit</button>
      {/if}
      {#if fileExists}
        <button type="button" class="act-btn ghost" onclick={() => openPath(targetPath)} title="Open {targetPath}">Open file</button>
      {/if}
    </div>
  </header>

  {#if error}<p class="kw-err">{error}</p>{/if}

  {#if loaded}
    <div class="grid-scroll">
      <table class="hab-table">
        <thead>
          <tr>
            <th class="col-name">Habit</th>
            {#each days as dt (dt)}
              {@const m = dayMeta(dt)}
              <th class="col-day" class:today={dt === todayIso} title={dt}>
                <span class="dow">{m.dow}</span>
                <span class="dom">{m.dom}</span>
              </th>
            {/each}
            <th class="col-streak" title="Consecutive days up to today/yesterday">Streak</th>
          </tr>
        </thead>
        <tbody>
          {#each docState.habits as habit (habit)}
            {@const streak = streakOf(habit)}
            <tr>
              <td class="hab-name" title={habit}>{habit}</td>
              {#each days as dt (dt)}
                {@const checked = isDone(dt, habit)}
                <td class="cell-td" class:today={dt === todayIso}>
                  <button type="button" class="check-btn" class:checked aria-pressed={checked}
                    aria-label="{habit} on {dt}" onclick={() => toggleCell(dt, habit)}>{checked ? "✓" : ""}</button>
                </td>
              {/each}
              <td class="streak-td">
                <span class="streak-pill" class:hot={streak > 0}>{streak}d</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .kw-habits {
    display: flex; flex-direction: column; gap: 10px; font-family: var(--font-ui);
    background: var(--card-bg, var(--bg-alt)); border: 1px solid var(--border);
    border-radius: var(--radius-lg, 10px); padding: 14px 16px; min-width: 0;
  }
  :global(.pb.card) .kw-habits { background: transparent; border: 0; border-radius: 0; padding: 0; }
  .kw-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .kw-title-wrap { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .kw-title { font-size: calc(13.5px * var(--ui-scale, 1)); font-weight: 600; color: var(--heading); }
  .kw-badge {
    font-size: calc(11.5px * var(--ui-scale, 1)); font-variant-numeric: tabular-nums;
    padding: 1px 7px; border-radius: 999px; background: var(--bg-alt); border: 1px solid var(--border); color: var(--text-muted);
  }
  .kw-badge.complete { color: var(--green); border-color: color-mix(in srgb, var(--green) 35%, var(--border)); background: color-mix(in srgb, var(--green) 13%, transparent); font-weight: 600; }
  .kw-actions { display: inline-flex; align-items: center; gap: 6px; }
  .add-form { display: inline-flex; align-items: center; gap: 5px; }
  .add-input { width: 128px; padding: 3px 7px; border-radius: 5px; border: 1px solid var(--accent); background: var(--bg); color: var(--text); font: inherit; font-size: calc(12px * var(--ui-scale, 1)); outline: none; }
  .act-btn { padding: 3px 8px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--text-muted); font: inherit; font-size: calc(11.5px * var(--ui-scale, 1)); cursor: pointer; transition: color 120ms, border-color 120ms, background 120ms; }
  .act-btn:hover { color: var(--text); border-color: var(--border-strong); }
  .act-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); font-weight: 500; }
  .act-btn.ghost { background: transparent; border-color: transparent; color: var(--link, var(--accent)); }
  .act-btn.ghost:hover { background: var(--bg-hover); }
  .kw-err { margin: 0; font-size: calc(12px * var(--ui-scale, 1)); color: var(--red); }

  .grid-scroll { overflow-x: auto; margin: 0 -2px; padding: 0 2px; }
  .hab-table { width: 100%; border-collapse: collapse; font-size: calc(12.5px * var(--ui-scale, 1)); }
  .hab-table th { font-weight: 500; color: var(--text-faint); padding: 2px 4px 6px; text-align: center; border-bottom: 1px solid var(--border); }
  .hab-table th.col-name { text-align: left; padding-left: 2px; }
  .hab-table th.col-streak { text-align: right; padding-right: 2px; }
  .col-day .dow { display: block; font-size: calc(10px * var(--ui-scale, 1)); text-transform: uppercase; letter-spacing: 0.04em; }
  .col-day .dom { display: block; font-size: calc(11.5px * var(--ui-scale, 1)); font-variant-numeric: tabular-nums; color: var(--text-muted); margin-top: 1px; }
  .col-day.today .dow, .col-day.today .dom { color: var(--accent); font-weight: 600; }

  .hab-table td { padding: 5px 4px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); vertical-align: middle; }
  .hab-table tbody tr:last-child td { border-bottom: 0; }
  .hab-name { color: var(--text); font-weight: 500; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 2px; }
  .cell-td { text-align: center; width: 32px; }
  .cell-td.today { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .check-btn {
    width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--border-strong);
    background: var(--bg); color: transparent; font-size: 12px; font-weight: 700; line-height: 1;
    display: inline-grid; place-items: center; cursor: pointer; padding: 0; transition: transform 100ms, background 120ms, border-color 120ms;
  }
  .check-btn:hover { border-color: var(--green); background: var(--bg-hover); }
  .check-btn.checked { background: var(--green); border-color: var(--green); color: #fff; } /* literal: white checkmark on viridian fill */
  .streak-td { text-align: right; padding-right: 2px; white-space: nowrap; }
  .streak-pill { font-family: var(--font-mono); font-size: calc(11px * var(--ui-scale, 1)); font-variant-numeric: tabular-nums; padding: 1px 6px; border-radius: 999px; color: var(--text-faint); background: var(--bg-alt); }
  .streak-pill.hot { color: var(--orange); background: color-mix(in srgb, var(--orange) 13%, transparent); font-weight: 600; }
</style>
