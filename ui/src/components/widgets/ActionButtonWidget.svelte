<script lang="ts">
  // Nootion × Bauhaus Action Button widget for `.page` dashboards and ```view (`type: button`) blocks in `.md` notes.
  import { tick } from "svelte";
  import Dialog from "../Dialog.svelte";
  import { api } from "../../lib/api";
  import { nextStatusValue } from "../../lib/base-format";
  import { openPath } from "../../lib/dock";
  import { localDay } from "../../lib/local-day";
  import { dirOf, resolveRel, shownName } from "../../lib/paths";
  import { frontmatterOf, linkTarget } from "../../lib/property-model";
  import { editors } from "../../lib/registry";
  import { toast } from "../../lib/state.svelte";
  import { errReason } from "../../lib/text";
  import type { BaseRow } from "../../lib/gen/BaseRow";
  import type { BaseView } from "../../lib/gen/BaseView";

  let { options = {}, doc = "", host = "note" }: { options?: Record<string, unknown>; doc?: string; host?: string } = $props();

  type ActionKind = "create_note" | "set_property" | "toggle_property";
  type Tone = "primary" | "default" | "green" | "yellow" | "red";
  type InputKind = "text" | "number" | "date" | "checkbox" | "select";
  interface InputFieldSpec {
    key: string; label: string; placeholder: string; defaultVal: string | boolean;
    kind: InputKind; options: string[]; required: boolean;
  }

  const str = (v: unknown, d = ""): string => (typeof v === "string" && v.trim() ? v.trim() : d);
  const humanize = (k: string): string => {
    const clean = k.replace(/[_.-]+/g, " ").trim();
    return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Value";
  };

  const action = $derived.by((): ActionKind => {
    const a = str(options.action).toLowerCase();
    if (a === "toggle_property" || a === "toggle" || a === "cycle_property") return "toggle_property";
    if (a === "set_property" || a === "set" || a === "update_property") return "set_property";
    return "create_note";
  });

  const glyph = $derived(str(options.icon) || str(options.glyph));
  const label = $derived.by((): string => {
    const explicit = str(options.label);
    if (explicit) return explicit;
    if (action === "create_note") return glyph ? "New Note" : "+ New Note";
    return action === "set_property" ? "Update Property" : action === "toggle_property" ? "Toggle Property" : "Run Action";
  });
  const subtitle = $derived(str(options.subtitle) || str(options.description));
  const tone = $derived.by((): Tone => {
    const t = (str(options.tone) || str(options.style)).toLowerCase();
    if (t === "default" || t === "neutral" || t === "secondary") return "default";
    if (t === "green" || t === "success") return "green";
    if (t === "yellow" || t === "warning" || t === "amber") return "yellow";
    if (t === "red" || t === "danger") return "red";
    return "primary";
  });

  const inputSpecs = $derived.by((): InputFieldSpec[] => {
    if (Array.isArray(options.inputs) && options.inputs.length > 0) {
      const specs: InputFieldSpec[] = [];
      for (const raw of options.inputs) {
        if (typeof raw === "string" && raw.trim()) {
          const k = raw.trim();
          specs.push({ key: k, label: humanize(k), placeholder: "", defaultVal: "", kind: "text", options: [], required: false });
        } else if (typeof raw === "object" && raw !== null) {
          const r = raw as Record<string, unknown>;
          const k = str(r.key) || str(r.name);
          if (!k) continue;
          const rk = (str(r.kind) || str(r.type)).toLowerCase();
          const kind: InputKind = rk === "number" || rk === "date" || rk === "checkbox" || rk === "select" ? rk : "text";
          const opts = Array.isArray(r.options) ? r.options.map((o) => String(o).trim()).filter(Boolean)
            : typeof r.options === "string" ? r.options.split(",").map((o) => o.trim()).filter(Boolean) : [];
          const defaultVal: string | boolean =
            kind === "checkbox" ? Boolean(r.default)
            : kind === "date" && str(r.default).toLowerCase() === "today" ? localDay()
            : r.default != null ? String(r.default) : kind === "select" ? (opts[0] ?? "") : "";
          specs.push({ key: k, label: str(r.label, humanize(k)), placeholder: str(r.placeholder), defaultVal, kind, options: opts, required: Boolean(r.required) });
        }
      }
      if (specs.length > 0) return specs;
    }
    if (typeof options.prompt_fields === "string" && options.prompt_fields.trim().length > 0) {
      return options.prompt_fields.split(/[,\r\n]+/).map((f) => f.trim()).filter(Boolean)
        .map((k) => ({ key: k, label: humanize(k), placeholder: "", defaultVal: "", kind: "text", options: [], required: false }));
    }
    if (options.prompt === true || str(options.prompt).toLowerCase() === "true") {
      if (action === "create_note") {
        return [{ key: "title", label: "Note title", placeholder: "Untitled…", defaultVal: "", kind: "text", options: [], required: false }];
      }
      const prop = str(options.property);
      const def = options.value != null && options.value !== "!toggle" ? String(options.value) : "";
      return [{ key: "value", label: prop ? `Value for ${prop}` : "Value", placeholder: "Enter value…", defaultVal: def, kind: "text", options: [], required: false }];
    }
    return [];
  });

  let busy = $state(false);
  let modalOpen = $state(false);
  let formValues = $state<Record<string, string | boolean>>({});
  let createdNote = $state<{ path: string; name: string } | null>(null);
  let statusMsg = $state<{ text: string; error?: boolean } | null>(null);

  function focusFirst(node: HTMLElement, active: boolean) {
    if (!active) return;
    void tick().then(() => {
      node.focus();
      if (node instanceof HTMLInputElement && node.type === "text") node.select();
    });
  }

  function buildTimeVars(extra: Record<string, unknown>, now = new Date()): Record<string, unknown> {
    const d = localDay(now);
    const hh = String(now.getHours()).padStart(2, "0"), mm = String(now.getMinutes()).padStart(2, "0");
    return { date: d, time: `${hh}-${mm}`, datetime: `${d} ${hh}-${mm}`, this: doc ? shownName(doc) : "", ...extra };
  }

  const interpolate = (pattern: string, vars: Record<string, unknown>): string =>
    pattern.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k: string) => (vars[k] == null ? "" : String(vars[k])));

  function splitTopLevelCommas(raw: string): string[] {
    const out: string[] = [];
    let start = 0, depth = 0, quote = "";
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quote) { if (c === quote && raw[i - 1] !== "\\") quote = ""; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "[") depth++;
      else if (c === "]" && depth > 0) depth--;
      else if (c === "," && depth === 0) { out.push(raw.slice(start, i)); start = i + 1; }
    }
    out.push(raw.slice(start));
    return out;
  }

  function parsePresetEntries(raw: string): [string, string][] {
    const entries: [string, string][] = [];
    for (const line of raw.split(/\r?\n/)) {
      let pending: [string, string] | null = null;
      for (const part of splitTopLevelCommas(line)) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0 && /^[A-Za-z_][\w.-]*$/.test(trimmed.slice(0, eq).trim())) {
          if (pending) entries.push(pending);
          pending = [trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim()];
        } else if (pending) pending[1] = `${pending[1]}, ${trimmed}`;
      }
      if (pending) entries.push(pending);
    }
    return entries;
  }

  function coerceScalar(raw: string): unknown {
    const t = raw.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
    if (/^(?:true|false)$/i.test(t)) return t.toLowerCase() === "true";
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
    return t;
  }

  function parsePropValue(raw: unknown, vars: Record<string, unknown>, key = ""): unknown {
    if (typeof raw === "boolean" || typeof raw === "number") return raw;
    if (raw === null || raw === undefined) return null;
    if (Array.isArray(raw)) return raw.map((x) => coerceScalar(interpolate(String(x ?? ""), vars)));
    const strRaw = String(raw);
    const singleVar = /^\{\{\s*([\w.-]+)\s*\}\}$/.exec(strRaw.trim());
    if (singleVar && singleVar[1] in vars) {
      const direct = vars[singleVar[1]];
      if (typeof direct === "boolean" || typeof direct === "number" || Array.isArray(direct)) return direct;
    }
    const s = interpolate(strRaw, vars).trim();
    if (!s) return null;
    const isSingleWikilink = s.startsWith("[[") && s.endsWith("]]") && !s.slice(2, -2).includes("]]");
    if (!isSingleWikilink && s.startsWith("[") && s.endsWith("]")) {
      const inner = s.slice(1, -1).trim();
      return inner ? splitTopLevelCommas(inner).map((item) => coerceScalar(item)).filter((x) => x !== "") : [];
    }
    if (s.includes(",") && (/^(?:tags?|aliases?|cssclasses)$/i.test(key) || /\[\[[^\]]+\]\]\s*,\s*\[\[/.test(s))) {
      return splitTopLevelCommas(s).map((item) => coerceScalar(item)).filter((x) => x !== "");
    }
    return coerceScalar(s);
  }

  function collectRawProps(includeSingle: boolean, vars: Record<string, unknown>): [string, unknown][] {
    const map = new Map<string, unknown>();
    if (typeof options.properties === "object" && options.properties !== null && !Array.isArray(options.properties)) {
      for (const [k, v] of Object.entries(options.properties as Record<string, unknown>)) if (k.trim()) map.set(k.trim(), v);
    }
    if (typeof options.preset_properties === "string" && options.preset_properties.trim()) {
      for (const [k, v] of parsePresetEntries(options.preset_properties)) map.set(k, v);
    }
    if (includeSingle) {
      const singleProp = str(options.property);
      if (singleProp) {
        const hasVal = options.value !== undefined;
        map.set(singleProp, !hasVal && "value" in vars ? vars.value : !hasVal && action === "toggle_property" ? "!toggle" : options.value);
      }
    }
    return [...map.entries()];
  }

  function cleanNoteRef(raw: string): string {
    const core = raw.replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
    if (!core) return "";
    const withExt = /\.\w+$/.test(core) ? core : `${core}.md`;
    return withExt.startsWith("./") || withExt.startsWith("../") ? resolveRel(withExt, dirOf(doc)) : withExt.replace(/^\/+/, "");
  }

  function parseCycleItems(): string[] {
    if (Array.isArray(options.cycle)) return options.cycle.map((x) => String(x).trim()).filter(Boolean);
    if (typeof options.cycle === "string" && options.cycle.trim()) return splitTopLevelCommas(options.cycle).map((x) => x.trim()).filter(Boolean);
    return [];
  }

  function nextToggledValue(cur: unknown, cycle: string[]): unknown {
    if (cycle.length > 0) {
      const curStr = cur == null ? "" : String(cur).trim().toLowerCase();
      const idx = cycle.findIndex((item) => item.toLowerCase() === curStr);
      return coerceScalar(cycle[(idx + 1) % cycle.length]);
    }
    if (typeof cur === "boolean" || cur === null || cur === undefined || cur === "") return !Boolean(cur);
    const s = String(cur).trim();
    return /^(?:true|false)$/i.test(s) ? s.toLowerCase() !== "true" : nextStatusValue(s);
  }

  function matchesWhere(actual: unknown, expectedRaw: string): boolean {
    const want = expectedRaw.trim().toLowerCase();
    const cmp = (v: unknown): boolean => {
      if (v === null || v === undefined) return want === "" || want === "null";
      const s = String(v).trim();
      return s.toLowerCase() === want || linkTarget(s).toLowerCase() === want || shownName(linkTarget(s)).toLowerCase() === want;
    };
    return Array.isArray(actual) ? actual.some(cmp) : cmp(actual);
  }

  async function runCreateNote(vars: Record<string, unknown>): Promise<void> {
    const folderRaw = str(options.folder) || str(options.dir);
    const folder = folderRaw ? interpolate(folderRaw, vars).replace(/^\/+|\/+$/g, "") : "";
    const tpl = str(options.template).replace(/\.md$/i, "");
    const titleOpt = str(options.title);
    const promptedTitle = typeof vars.title === "string" ? vars.title.trim() : "";
    const resolvedTitle = titleOpt
      ? interpolate(titleOpt, vars).trim() || interpolate("Untitled {{date}}", vars)
      : promptedTitle || interpolate("Untitled {{date}}", vars);

    const created = await api.newNote({
      title: resolvedTitle,
      ...(tpl ? { template: tpl } : {}),
      ...(folder ? { dir: folder } : doc ? { near: dirOf(doc) || undefined } : {}),
      values: vars,
    });
    for (const [key, rawVal] of collectRawProps(false, vars)) {
      const val = parsePropValue(rawVal, vars, key);
      await api.setProperty({ path: created.path, key, text: "", list: Array.isArray(val), value: val });
    }
    const shouldOpen = options.open === undefined ? true : Boolean(options.open) && str(options.open).toLowerCase() !== "false";
    const name = shownName(created.path);
    statusMsg = null;
    if (shouldOpen) {
      createdNote = null;
      openPath(created.path, created.line);
    } else {
      createdNote = { path: created.path, name };
      toast(`Created ${name}`, created.path, "success", 4500, { label: "Open", run: () => openPath(created.path, created.line) });
    }
  }

  async function resolveTargets(vars: Record<string, unknown>): Promise<{ path: string; row?: BaseRow; view?: BaseView }[] | null> {
    const baseRaw = str(options.base);
    if (!baseRaw) {
      const explicit = str(options.target_note) || (str(options.target) && str(options.target) !== "self" ? str(options.target) : "");
      const notePath = explicit ? cleanNoteRef(interpolate(explicit, vars)) : doc;
      if (!notePath || !notePath.toLowerCase().endsWith(".md")) {
        statusMsg = { text: "No target .md note", error: true };
        toast("No target note", "Specify target_note or base to update properties from a .page dashboard.", "error");
        return null;
      }
      return [{ path: notePath }];
    }
    const stripped = interpolate(baseRaw, vars).replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
    const [rawFile, hashView = ""] = stripped.split("#");
    const withExt = /\.\w+$/.test(rawFile.trim()) ? rawFile.trim() : `${rawFile.trim()}.base`;
    const basePath = withExt.startsWith("./") || withExt.startsWith("../") ? resolveRel(withExt, dirOf(doc)) : withExt.replace(/^\/+/, "");
    const res = await api.base(basePath, doc || undefined);
    if (res.error) throw new Error(res.error);
    const wantView = str(options.view) || hashView.trim();
    const v = (wantView ? res.views.find((x) => x.name === wantView) : undefined) ?? res.views[0];
    if (!v) return [];

    const whereProp = str(options.where_property).replace(/^note\./, "");
    const whereVal = options.where_value !== undefined ? interpolate(String(options.where_value), vars) : "";
    const whereColIdx = whereProp ? v.columns.findIndex((c) => c.key === whereProp || c.id === whereProp || c.id === `note.${whereProp}`) : -1;
    const out: { path: string; row: BaseRow; view: BaseView }[] = [];
    for (const row of v.rows) {
      if (!row.path.toLowerCase().endsWith(".md")) continue;
      if (whereProp) {
        const actual = whereColIdx >= 0 ? row.values[whereColIdx] : frontmatterOf((await api.file(row.path)).text)?.data?.[whereProp];
        if (!matchesWhere(actual, whereVal)) continue;
      }
      out.push({ path: row.path, row, view: v });
    }
    return out;
  }

  async function runPropertyAction(vars: Record<string, unknown>): Promise<void> {
    const rawEntries = collectRawProps(true, vars);
    if (!rawEntries.length) {
      statusMsg = { text: "No property configured", error: true };
      toast("No property configured", "Set `property` or `properties` on this action button.", "error");
      return;
    }
    for (const h of editors.values()) await h.flush();
    const targets = await resolveTargets(vars);
    if (!targets) return;
    if (!targets.length) {
      statusMsg = { text: "0 matching notes" };
      toast("No matching notes", "No notes matched the base view filter.", "info");
      return;
    }
    const cycle = parseCycleItems();
    const forceToggle = action === "toggle_property" || options.toggle === true || str(options.toggle).toLowerCase() === "true";
    let lastSummary = "";
    for (const tgt of targets) {
      let cachedFm: Record<string, unknown> | undefined;
      for (const [rawKey, rawVal] of rawEntries) {
        const key = rawKey.replace(/^note\./, "");
        let nextVal: unknown;
        if (forceToggle || rawVal === "!toggle") {
          const colIdx = tgt.view ? tgt.view.columns.findIndex((c) => c.key === key || c.id === key || c.id === `note.${key}`) : -1;
          let cur: unknown;
          if (colIdx >= 0 && tgt.row && !cachedFm) cur = tgt.row.values[colIdx];
          else { cachedFm ??= frontmatterOf((await api.file(tgt.path)).text)?.data ?? {}; cur = cachedFm[key]; }
          nextVal = nextToggledValue(cur, cycle);
        } else {
          nextVal = parsePropValue(rawVal, vars, key);
        }
        await api.setProperty({ path: tgt.path, key, text: "", list: Array.isArray(nextVal), value: nextVal });
        if (cachedFm) cachedFm[key] = nextVal;
        lastSummary = `${key} → ${Array.isArray(nextVal) ? nextVal.join(", ") : String(nextVal ?? "empty")}`;
      }
    }
    createdNote = null;
    statusMsg = { text: targets.length === 1 ? `✓ ${lastSummary}` : `✓ Updated ${targets.length} notes` };
    if (targets.length > 1 || str(options.base)) {
      toast(targets.length === 1 ? `Updated ${shownName(targets[0].path)}` : `Updated ${targets.length} notes`, lastSummary, "success");
    }
  }

  async function execute(extraVars: Record<string, unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const vars = buildTimeVars(extraVars);
      if (action === "create_note") await runCreateNote(vars);
      else await runPropertyAction(vars);
    } catch (e) {
      const reason = errReason(e);
      statusMsg = { text: reason, error: true };
      toast("Action failed", reason, "error");
    } finally { busy = false; }
  }

  function handleButtonClick(): void {
    if (busy) return;
    if (inputSpecs.length > 0) {
      formValues = Object.fromEntries(inputSpecs.map((s) => [s.key, s.defaultVal]));
      modalOpen = true;
      return;
    }
    void execute({});
  }

  function submitModal(e: SubmitEvent): void {
    e.preventDefault();
    const collected: Record<string, unknown> = {};
    for (const spec of inputSpecs) {
      const raw = formValues[spec.key];
      if (spec.required && (raw === undefined || raw === "" || raw === false)) return;
      if (spec.kind === "checkbox") collected[spec.key] = Boolean(raw);
      else if (spec.kind === "number") {
        const s = String(raw ?? "").trim(), n = s ? Number(s) : NaN;
        collected[spec.key] = Number.isFinite(n) ? n : s;
      } else collected[spec.key] = String(raw ?? "");
    }
    modalOpen = false;
    void execute(collected);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ab-wrap" data-host={host} onmousedown={(e) => e.stopPropagation()}>
  <div class="ab-row">
    <button type="button" class="ab-btn tone-{tone}" data-testid="action-button" disabled={busy} onclick={handleButtonClick}>
      {#if glyph}<span class="ab-glyph" aria-hidden="true">{glyph}</span>{/if}
      <span class="ab-label">{label}</span>
    </button>
    {#if createdNote}
      <button type="button" class="ab-created" onclick={() => createdNote && openPath(createdNote.path)} title="Open {createdNote.path}">✓ Created {createdNote.name}</button>
    {:else if statusMsg}
      <span class="ab-status" class:err={statusMsg.error}>{statusMsg.text}</span>
    {/if}
  </div>
  {#if subtitle}<p class="ab-sub">{subtitle}</p>{/if}
</div>

{#if modalOpen}
  <Dialog label={label} testid="action-button-modal" onclose={() => (modalOpen = false)}>
    <form class="ab-modal" onsubmit={submitModal}>
      <header class="ab-modal-head"><span class="ab-modal-title">{glyph ? `${glyph} ` : ""}{label}</span>{#if subtitle}<span class="ab-modal-sub">{subtitle}</span>{/if}</header>
      <div class="ab-fields">
        {#each inputSpecs as spec, idx (spec.key)}
          {#if spec.kind === "checkbox"}
            <label class="ab-check-row"><input type="checkbox" use:focusFirst={idx === 0} checked={Boolean(formValues[spec.key])} onchange={(e) => (formValues[spec.key] = e.currentTarget.checked)} /><span>{spec.label}</span></label>
          {:else if spec.kind === "select"}
            <label class="ab-field"><span class="ab-field-lbl">{spec.label}{#if spec.required} *{/if}</span>
              <select use:focusFirst={idx === 0} value={String(formValues[spec.key] ?? "")} required={spec.required} onchange={(e) => (formValues[spec.key] = e.currentTarget.value)}>{#each spec.options as opt (opt)}<option value={opt}>{opt}</option>{/each}</select>
            </label>
          {:else}
            <label class="ab-field"><span class="ab-field-lbl">{spec.label}{#if spec.required} *{/if}</span>
              <input use:focusFirst={idx === 0} type={spec.kind === "number" ? "number" : spec.kind === "date" ? "date" : "text"} step={spec.kind === "number" ? "any" : undefined} placeholder={spec.placeholder} required={spec.required} value={String(formValues[spec.key] ?? "")} oninput={(e) => (formValues[spec.key] = e.currentTarget.value)} />
            </label>
          {/if}
        {/each}
      </div>
      <div class="ab-modal-btns"><button type="button" class="m-btn" onclick={() => (modalOpen = false)}>Cancel</button><button type="submit" class="m-btn primary" disabled={busy}>Run</button></div>
    </form>
  </Dialog>
{/if}

<style>
  .ab-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; font-family: var(--font-ui); color: var(--text); min-width: 0; }
  .ab-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; max-width: 100%; }
  .ab-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; padding: 6px 14px; border-radius: var(--radius, 6px); border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); font-family: var(--font-ui); font-size: calc(13px * var(--ui-scale, 1)); font-weight: 600; letter-spacing: -0.005em; cursor: pointer; box-shadow: var(--shadow-sm); transition: transform 90ms ease, filter 120ms ease, background 120ms ease, border-color 120ms ease; }
  :global(html.phone) .ab-btn { min-height: 42px; padding: 8px 16px; }
  .ab-btn:hover:not(:disabled) { filter: brightness(1.06); }
  .ab-btn:active:not(:disabled) { transform: translateY(1px); }
  .ab-btn:disabled { opacity: 0.55; cursor: default; }
  .ab-btn.tone-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); }
  .ab-btn.tone-default { background: var(--bg-elev); border-color: var(--border-strong); color: var(--heading, var(--text)); }
  .ab-btn.tone-default:hover:not(:disabled) { border-color: var(--accent); background: var(--bg-hover); }
  .ab-btn.tone-green { background: var(--green); border-color: var(--green); color: #fff; } /* literal: white ink on saturated viridian button */
  .ab-btn.tone-yellow { background: var(--yellow); border-color: var(--yellow); color: #141518; } /* literal: dark ink on ochre button */
  .ab-btn.tone-red { background: var(--red); border-color: var(--red); color: #fff; } /* literal: white ink on vermilion button */
  .ab-glyph { font-size: 1.05em; line-height: 1; }
  .ab-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
  .ab-sub, .ab-modal-sub { margin: 0; font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); line-height: 1.4; }
  .ab-created { padding: 3px 8px; border-radius: var(--radius-sm, 5px); border: 1px solid color-mix(in srgb, var(--green) 35%, var(--border)); background: var(--green-soft, color-mix(in srgb, var(--green) 12%, transparent)); color: var(--green); font: inherit; font-size: calc(12px * var(--ui-scale, 1)); font-weight: 500; cursor: pointer; }
  .ab-created:hover { filter: brightness(1.08); text-decoration: underline; }
  .ab-status { font-family: var(--font-mono); font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); }
  .ab-status.err { color: var(--red); }
  .ab-modal { width: min(440px, 92vw); background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-lg, 10px); padding: 16px; box-shadow: var(--shadow-pop); display: flex; flex-direction: column; gap: 12px; font-family: var(--font-ui); color: var(--text); }
  .ab-modal-head, .ab-field { display: flex; flex-direction: column; gap: 4px; }
  .ab-modal-title { font-size: calc(14px * var(--ui-scale, 1)); font-weight: 600; color: var(--heading); }
  .ab-fields { display: flex; flex-direction: column; gap: 10px; }
  .ab-field-lbl { font-size: calc(12px * var(--ui-scale, 1)); font-weight: 500; color: var(--text-muted); }
  .ab-field input, .ab-field select { font: inherit; font-size: calc(13.5px * var(--ui-scale, 1)); color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm, 5px); padding: 6px 9px; outline: none; }
  .ab-field input:focus, .ab-field select:focus { border-color: var(--accent); }
  .ab-check-row { display: inline-flex; align-items: center; gap: 8px; font-size: calc(13px * var(--ui-scale, 1)); color: var(--text); cursor: pointer; }
  .ab-check-row input { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; }
  .ab-modal-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
  .m-btn { padding: 5px 13px; border-radius: var(--radius-sm, 5px); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font: inherit; font-size: calc(12.5px * var(--ui-scale, 1)); cursor: pointer; }
  .m-btn:hover { background: var(--bg-hover); }
  .m-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg, #fff); font-weight: 600; }
</style>
