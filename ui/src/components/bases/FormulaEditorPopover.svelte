<script lang="ts">
  // Guided formula builder popover for .base views: inline typing autocomplete, full expr.rs function reference,
  // property chips across all columns/properties, sample row switcher, live evaluation preview, and save.
  import Icon from "../Icon.svelte";
  import Select from "../Select.svelte";
  import { api } from "../../lib/api";
  import { shownName } from "../../lib/paths";
  import type { BaseCell } from "../../lib/gen/BaseCell";
  import type { BaseResult } from "../../lib/gen/BaseResult";
  import type { BaseView } from "../../lib/gen/BaseView";
  import type { FormulaPreviewResponse } from "../../lib/gen/FormulaPreviewResponse";
  import type { ViewEdit } from "../../lib/gen/ViewEdit";

  let {
    basePath,
    res,
    view,
    props,
    onedit,
    onclose,
  }: {
    basePath: string;
    res: BaseResult;
    view: BaseView;
    props: { id: string; label: string }[];
    onedit: (e: ViewEdit, then?: () => void) => void;
    onclose: () => void;
  } = $props();

  interface FnDoc {
    name: string;
    insert: string;
    cursorBack?: number;
    sig: string;
    desc: string;
    kind: "fn" | "method" | "file" | "field";
    category: "Logic" | "Dates" | "Math" | "Text" | "Lists" | "Files" | "Relations";
  }

  const FILE_FIELDS: FnDoc[] = [
    { name: "file.name", insert: "file.name", sig: "file.name", desc: "Note name without extension", kind: "field", category: "Files" },
    { name: "file.basename", insert: "file.basename", sig: "file.basename", desc: "Note file stem", kind: "field", category: "Files" },
    { name: "file.path", insert: "file.path", sig: "file.path", desc: "Vault-relative file path", kind: "field", category: "Files" },
    { name: "file.ext", insert: "file.ext", sig: "file.ext", desc: "File extension (e.g. md)", kind: "field", category: "Files" },
    { name: "file.folder", insert: "file.folder", sig: "file.folder", desc: "Parent folder path", kind: "field", category: "Files" },
    { name: "file.size", insert: "file.size", sig: "file.size", desc: "File size in bytes", kind: "field", category: "Files" },
    { name: "file.ctime", insert: "file.ctime", sig: "file.ctime", desc: "Creation date/time", kind: "field", category: "Files" },
    { name: "file.mtime", insert: "file.mtime", sig: "file.mtime", desc: "Last modified date/time", kind: "field", category: "Files" },
    { name: "file.tags", insert: "file.tags", sig: "file.tags", desc: "All tags (frontmatter + inline)", kind: "field", category: "Files" },
    { name: "file.links", insert: "file.links", sig: "file.links", desc: "Outgoing wikilinks", kind: "field", category: "Files" },
    { name: "file.backlinks", insert: "file.backlinks", sig: "file.backlinks", desc: "Incoming backlinks", kind: "field", category: "Files" },
    { name: "file.properties", insert: "file.properties", sig: "file.properties", desc: "Frontmatter property map", kind: "field", category: "Files" },
    { name: "file.upstreamStatus", insert: "file.upstreamStatus", sig: "file.upstreamStatus", desc: "Upstream staleness label", kind: "field", category: "Files" },
    { name: "file.hasProperty", insert: 'file.hasProperty("")', cursorBack: 2, sig: 'file.hasProperty("key")', desc: "True if property is present and non-empty", kind: "file", category: "Files" },
    { name: "file.inFolder", insert: 'file.inFolder("")', cursorBack: 2, sig: 'file.inFolder("dir")', desc: "True if note sits inside folder", kind: "file", category: "Files" },
    { name: "file.hasTag", insert: 'file.hasTag("")', cursorBack: 2, sig: 'file.hasTag("tag", ...)', desc: "True if note has tag (matches nested)", kind: "file", category: "Files" },
    { name: "file.hasLink", insert: 'file.hasLink("")', cursorBack: 2, sig: 'file.hasLink("note")', desc: "True if note links to target", kind: "file", category: "Files" },
    { name: "this.file.name", insert: "this.file.name", sig: "this.file.name", desc: "Host note name when embedded", kind: "field", category: "Files" },
    { name: "this.file.path", insert: "this.file.path", sig: "this.file.path", desc: "Host note path when embedded", kind: "field", category: "Files" },
  ];

  // Exhaustive reference matching crates/kandinsky-core/src/bases/expr.rs
  const FUNCTIONS: FnDoc[] = [
    // Logic & variables
    { name: "if", insert: "if(, , )", cursorBack: 5, sig: "if(cond, then, else)", desc: "Conditional branch", kind: "fn", category: "Logic" },
    { name: "default", insert: "default(, )", cursorBack: 3, sig: "default(value, fallback)", desc: "Fallback when empty or null", kind: "fn", category: "Logic" },
    { name: "let", insert: "let(x, , )", cursorBack: 3, sig: "let(name, val, ..., body)", desc: "Bind local variable(s)", kind: "fn", category: "Logic" },
    { name: "lets", insert: "lets(x, , )", cursorBack: 3, sig: "lets(name, val, ..., body)", desc: "Bind multiple local variables", kind: "fn", category: "Logic" },
    { name: "prop", insert: 'prop("")', cursorBack: 2, sig: 'prop("key")', desc: "Read frontmatter property by name", kind: "fn", category: "Logic" },
    { name: "link", insert: 'link("")', cursorBack: 2, sig: 'link("note")', desc: "Create a wikilink value", kind: "fn", category: "Relations" },
    { name: "rollup", insert: 'rollup("", "", "Sum")', cursorBack: 13, sig: 'rollup(relation, target, summary?)', desc: "Aggregate linked notes (Sum, Average, Count…)", kind: "fn", category: "Relations" },
    { name: "upstreamStatus", insert: "upstreamStatus()", sig: "upstreamStatus()", desc: "Upstream health label (stale/changed)", kind: "fn", category: "Relations" },
    { name: "isUpstreamStale", insert: "isUpstreamStale()", sig: "isUpstreamStale()", desc: "True if any upstream dependency changed", kind: "fn", category: "Relations" },
    // Dates
    { name: "today", insert: "today()", sig: "today()", desc: "Today at 00:00 local time", kind: "fn", category: "Dates" },
    { name: "now", insert: "now()", sig: "now()", desc: "Current local date and time", kind: "fn", category: "Dates" },
    { name: "date", insert: "date()", cursorBack: 1, sig: "date(text_or_date)", desc: "Parse date string or timestamp", kind: "fn", category: "Dates" },
    { name: "duration", insert: 'duration("7d")', cursorBack: 2, sig: 'duration("1d"|"2w"|"1 month")', desc: "Duration offset for date + / -", kind: "fn", category: "Dates" },
    { name: "dateBetween", insert: 'dateBetween(, , "days")', cursorBack: 10, sig: 'dateBetween(a, b, "days"|"weeks"|"months")', desc: "Signed difference between two dates", kind: "fn", category: "Dates" },
    // Math & conversion
    { name: "number", insert: "number()", cursorBack: 1, sig: "number(value)", desc: "Coerce value to number", kind: "fn", category: "Math" },
    { name: "round", insert: "round(, 0)", cursorBack: 4, sig: "round(num, digits?)", desc: "Round number to decimal digits", kind: "fn", category: "Math" },
    { name: "abs", insert: "abs()", cursorBack: 1, sig: "abs(num)", desc: "Absolute value", kind: "fn", category: "Math" },
    { name: "floor", insert: "floor()", cursorBack: 1, sig: "floor(num)", desc: "Round down to integer", kind: "fn", category: "Math" },
    { name: "ceil", insert: "ceil()", cursorBack: 1, sig: "ceil(num)", desc: "Round up to integer", kind: "fn", category: "Math" },
    { name: "min", insert: "min()", cursorBack: 1, sig: "min(a, b, ... | list)", desc: "Smallest number", kind: "fn", category: "Math" },
    { name: "max", insert: "max()", cursorBack: 1, sig: "max(a, b, ... | list)", desc: "Largest number", kind: "fn", category: "Math" },
    // Text & lists
    { name: "concat", insert: "concat(, )", cursorBack: 3, sig: "concat(a, b, ...)", desc: "Join values into plain text", kind: "fn", category: "Text" },
    { name: "list", insert: "list()", cursorBack: 1, sig: "list(value)", desc: "Wrap value as a list", kind: "fn", category: "Lists" },
    // Methods (called as expr.method(...))
    { name: "isEmpty", insert: ".isEmpty()", sig: ".isEmpty()", desc: "True if null, blank string, or empty list", kind: "method", category: "Logic" },
    { name: "isNotEmpty", insert: ".isNotEmpty()", sig: ".isNotEmpty()", desc: "True if non-empty", kind: "method", category: "Logic" },
    { name: "isTruthy", insert: ".isTruthy()", sig: ".isTruthy()", desc: "True if truthy in conditions", kind: "method", category: "Logic" },
    { name: "isType", insert: '.isType("")', cursorBack: 2, sig: '.isType("string"|"number"|"list"|"date")', desc: "Check runtime value type", kind: "method", category: "Logic" },
    { name: "default", insert: ".default()", cursorBack: 1, sig: ".default(fallback)", desc: "Fallback when receiver is empty", kind: "method", category: "Logic" },
    { name: "contains", insert: '.contains("")', cursorBack: 2, sig: ".contains(item_or_substr)", desc: "List contains item or string contains text", kind: "method", category: "Lists" },
    { name: "containsAny", insert: '.containsAny("")', cursorBack: 2, sig: ".containsAny(a, b, ...)", desc: "True if any item matches", kind: "method", category: "Lists" },
    { name: "containsAll", insert: '.containsAll("")', cursorBack: 2, sig: ".containsAll(a, b, ...)", desc: "True if all items match", kind: "method", category: "Lists" },
    { name: "startsWith", insert: '.startsWith("")', cursorBack: 2, sig: '.startsWith("prefix")', desc: "True if text starts with prefix", kind: "method", category: "Text" },
    { name: "endsWith", insert: '.endsWith("")', cursorBack: 2, sig: '.endsWith("suffix")', desc: "True if text ends with suffix", kind: "method", category: "Text" },
    { name: "format", insert: '.format("YYYY-MM-DD")', cursorBack: 2, sig: '.format("YY.MM-DD")', desc: "Format date with moment tokens", kind: "method", category: "Dates" },
    { name: "date", insert: ".date()", sig: ".date()", desc: "Date part without time", kind: "method", category: "Dates" },
    { name: "time", insert: ".time()", sig: ".time()", desc: "HH:MM:SS time string", kind: "method", category: "Dates" },
    { name: "relative", insert: ".relative()", sig: ".relative()", desc: 'Relative time ("3 days ago")', kind: "method", category: "Dates" },
    { name: "year", insert: ".year", sig: ".year", desc: "Year number of a date", kind: "field", category: "Dates" },
    { name: "month", insert: ".month", sig: ".month", desc: "Month (1–12) of a date", kind: "field", category: "Dates" },
    { name: "day", insert: ".day", sig: ".day", desc: "Day of month (1–31)", kind: "field", category: "Dates" },
    { name: "hour", insert: ".hour", sig: ".hour", desc: "Hour (0–23) of a date", kind: "field", category: "Dates" },
    { name: "minute", insert: ".minute", sig: ".minute", desc: "Minute (0–59) of a date", kind: "field", category: "Dates" },
    { name: "second", insert: ".second", sig: ".second", desc: "Second (0–59) of a date", kind: "field", category: "Dates" },
    { name: "days", insert: ".days", sig: ".days", desc: "Whole days of a date difference", kind: "field", category: "Dates" },
    { name: "hours", insert: ".hours", sig: ".hours", desc: "Whole hours of a date difference", kind: "field", category: "Dates" },
    { name: "minutes", insert: ".minutes", sig: ".minutes", desc: "Whole minutes of a date difference", kind: "field", category: "Dates" },
    { name: "toString", insert: ".toString()", sig: ".toString()", desc: "Plain text representation", kind: "method", category: "Text" },
    { name: "lower", insert: ".lower()", sig: ".lower()", desc: "Convert text to lowercase", kind: "method", category: "Text" },
    { name: "upper", insert: ".upper()", sig: ".upper()", desc: "Convert text to uppercase", kind: "method", category: "Text" },
    { name: "title", insert: ".title()", sig: ".title()", desc: "Convert text to Title Case", kind: "method", category: "Text" },
    { name: "trim", insert: ".trim()", sig: ".trim()", desc: "Strip surrounding whitespace", kind: "method", category: "Text" },
    { name: "replace", insert: '.replace("", "")', cursorBack: 6, sig: '.replace(find, repl)', desc: "Replace substring occurrences", kind: "method", category: "Text" },
    { name: "split", insert: '.split(",")', cursorBack: 2, sig: '.split(sep)', desc: "Split text into list", kind: "method", category: "Text" },
    { name: "repeat", insert: ".repeat(2)", cursorBack: 1, sig: ".repeat(count)", desc: "Repeat text count times", kind: "method", category: "Text" },
    { name: "slice", insert: ".slice(0, )", cursorBack: 1, sig: ".slice(start, end?)", desc: "Substring or sublist slice", kind: "method", category: "Lists" },
    { name: "length", insert: ".length", sig: ".length", desc: "Character or list item count", kind: "field", category: "Lists" },
    { name: "join", insert: '.join(", ")', cursorBack: 2, sig: '.join(sep)', desc: "Join list items into string", kind: "method", category: "Lists" },
    { name: "filter", insert: ".filter(value )", cursorBack: 1, sig: ".filter(pred)", desc: "Filter items using value & index", kind: "method", category: "Lists" },
    { name: "map", insert: ".map(value)", cursorBack: 1, sig: ".map(expr)", desc: "Transform items using value & index", kind: "method", category: "Lists" },
    { name: "reduce", insert: ".reduce(acc + value, 0)", cursorBack: 1, sig: ".reduce(expr, init)", desc: "Fold list using acc, value & index", kind: "method", category: "Lists" },
    { name: "sum", insert: ".sum()", sig: ".sum()", desc: "Sum of numeric list items", kind: "method", category: "Lists" },
    { name: "avg", insert: ".avg()", sig: ".avg()", desc: "Mean of numeric list items (.mean)", kind: "method", category: "Lists" },
    { name: "reverse", insert: ".reverse()", sig: ".reverse()", desc: "Reverse list or string", kind: "method", category: "Lists" },
    { name: "sort", insert: ".sort()", sig: ".sort()", desc: "Sort list values", kind: "method", category: "Lists" },
    { name: "unique", insert: ".unique()", sig: ".unique()", desc: "Deduplicate list items", kind: "method", category: "Lists" },
    { name: "flat", insert: ".flat()", sig: ".flat()", desc: "Flatten nested lists one level", kind: "method", category: "Lists" },
    { name: "keys", insert: ".keys()", sig: ".keys()", desc: "Map object keys as list", kind: "method", category: "Lists" },
    { name: "values", insert: ".values()", sig: ".values()", desc: "Map object values as list", kind: "method", category: "Lists" },
    { name: "toFixed", insert: ".toFixed(2)", cursorBack: 1, sig: ".toFixed(digits)", desc: "Fixed-decimal string", kind: "method", category: "Math" },
    { name: "round", insert: ".round(1)", cursorBack: 1, sig: ".round(digits?)", desc: "Method form of round()", kind: "method", category: "Math" },
    { name: "abs", insert: ".abs()", sig: ".abs()", desc: "Method form of abs()", kind: "method", category: "Math" },
    { name: "floor", insert: ".floor()", sig: ".floor()", desc: "Method form of floor()", kind: "method", category: "Math" },
    { name: "ceil", insert: ".ceil()", sig: ".ceil()", desc: "Method form of ceil()", kind: "method", category: "Math" },
  ];

  interface CompletionItem {
    id: string;
    label: string;
    detail: string;
    badge: string;
    insert: string;
    cursorBack?: number;
  }

  const existing = $derived(Object.entries(res.formula_exprs ?? {}));
  // svelte-ignore state_referenced_locally
  let name = $state(existing[0]?.[0] ?? "score");
  // svelte-ignore state_referenced_locally
  let expr = $state(existing[0]?.[1] ?? 'prop("status")');
  let sampleNote = $state("");
  let fnQuery = $state("");
  let propQuery = $state("");
  let preview = $state<FormulaPreviewResponse | null>(null);
  let busy = $state(false);
  let inputEl: HTMLTextAreaElement;

  let caret = $state(0);
  let acDismissed = $state(false);
  let acIndex = $state(0);
  let acMenuEl = $state<HTMLUListElement>();

  const allPropsList = $derived.by(() => {
    const out: { id: string; key: string; label: string; isBuiltin: boolean }[] = [];
    const seen = new Set<string>();
    const add = (id: string, label: string) => {
      const key = id.replace(/^note\./, "");
      if (seen.has(id) || seen.has(key)) return;
      seen.add(id);
      if (!/^(file|formula)\./.test(id)) seen.add(key);
      out.push({ id, key, label, isBuiltin: /^(file|formula)\./.test(id) });
    };
    for (const c of view.columns) add(c.id, c.label);
    for (const p of props) add(p.id, p.label);
    for (const [fnName] of existing) add(`formula.${fnName}`, `formula.${fnName}`);
    return out;
  });

  const shownProps = $derived(
    propQuery.trim()
      ? allPropsList.filter((p) => `${p.label} ${p.key} ${p.id}`.toLowerCase().includes(propQuery.trim().toLowerCase()))
      : allPropsList,
  );

  const filteredFunctions = $derived(
    fnQuery.trim()
      ? [...FUNCTIONS, ...FILE_FIELDS].filter((f) =>
          `${f.name} ${f.sig} ${f.desc} ${f.category}`.toLowerCase().includes(fnQuery.trim().toLowerCase()),
        )
      : FUNCTIONS,
  );

  const sampleOptions = $derived.by(() => {
    const opts = [{ value: "", label: "Auto (first matching note)" }];
    const nameColIdx = view.columns.findIndex((c) => c.id === "file.name");
    for (const r of view.rows) {
      const nameCell = nameColIdx >= 0 ? r.cells[nameColIdx] : undefined;
      const title = nameCell?.t === "link" ? nameCell.text : shownName(r.path);
      opts.push({ value: r.path, label: title !== r.path ? `${title} (${r.path})` : r.path });
    }
    return opts;
  });

  function propInsert(p: { id: string; key: string; isBuiltin: boolean }): string {
    if (p.isBuiltin) return p.id;
    return /^[A-Za-z_]\w*$/.test(p.key) ? `prop("${p.key}")` : `prop(${JSON.stringify(p.key)})`;
  }

  const acContext = $derived.by((): { replaceStart: number; items: CompletionItem[] } | null => {
    if (acDismissed) return null;
    const before = expr.slice(0, caret);

    // Inside prop("... or prop('...
    const propStr = /prop\(\s*["']([^"']*)$/.exec(before);
    if (propStr) {
      const q = propStr[1].toLowerCase();
      const replaceStart = before.length - propStr[0].length;
      const noteProps = allPropsList.filter((p) => !p.isBuiltin);
      const hits = noteProps
        .filter((p) => !q || p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q))
        .map((p): CompletionItem => ({
          id: `prop:${p.key}`,
          label: `prop("${p.key}")`,
          detail: p.label !== p.key ? p.label : "Property",
          badge: "prop",
          insert: `prop(${JSON.stringify(p.key)})`,
        }));
      return hits.length ? { replaceStart, items: hits.slice(0, 14) } : null;
    }

    // After this.file.
    const thisFileMatch = /(?:^|[^A-Za-z0-9_.])(this\.file\.([A-Za-z0-9_]*))$/.exec(before);
    if (thisFileMatch) {
      const token = thisFileMatch[1];
      const q = thisFileMatch[2].toLowerCase();
      const replaceStart = before.length - token.length;
      const hits = FILE_FIELDS.filter((f) => f.name.startsWith("file.") && (!q || f.name.slice(5).toLowerCase().includes(q)))
        .map((f): CompletionItem => ({
          id: `this.${f.name}`,
          label: `this.${f.sig}`,
          detail: `${f.desc} (active base file)`,
          badge: f.kind === "file" ? "fn" : "file",
          insert: `this.${f.insert}`,
          cursorBack: f.cursorBack,
        }));
      return hits.length ? { replaceStart, items: hits.slice(0, 14) } : null;
    }

    // After file.
    const fileMatch = /(?:^|[^A-Za-z0-9_.])(file\.([A-Za-z0-9_]*))$/.exec(before);
    if (fileMatch) {
      const token = fileMatch[1];
      const q = fileMatch[2].toLowerCase();
      const replaceStart = before.length - token.length;
      const hits = FILE_FIELDS.filter((f) => f.name.startsWith("file.") && (!q || f.name.slice(5).toLowerCase().includes(q)))
        .map((f): CompletionItem => ({
          id: f.name,
          label: f.sig,
          detail: f.desc,
          badge: f.kind === "file" ? "fn" : "file",
          insert: f.insert,
          cursorBack: f.cursorBack,
        }));
      return hits.length ? { replaceStart, items: hits.slice(0, 14) } : null;
    }

    // After formula.
    const formulaMatch = /(?:^|[^A-Za-z0-9_.])(formula\.([A-Za-z0-9_]*))$/.exec(before);
    if (formulaMatch) {
      const token = formulaMatch[1];
      const q = formulaMatch[2].toLowerCase();
      const replaceStart = before.length - token.length;
      const hits = existing
        .filter(([fnName]) => !q || fnName.toLowerCase().includes(q))
        .map(([fnName, fnExpr]): CompletionItem => ({
          id: `formula.${fnName}`,
          label: `formula.${fnName}`,
          detail: fnExpr,
          badge: "formula",
          insert: `formula.${fnName}`,
        }));
      return hits.length ? { replaceStart, items: hits.slice(0, 14) } : null;
    }

    // Method call after a dot: expr.meth (ignore decimal numbers like 3. or 3.14)
    const dotMatch = /(?:^|[^0-9.])(\.(?:[A-Za-z_][A-Za-z0-9_]*)?)$/.exec(before);
    if (dotMatch) {
      const q = dotMatch[1].slice(1).toLowerCase();
      const replaceStart = before.length - dotMatch[1].length;
      const methods = FUNCTIONS.filter((f) => f.kind === "method" || f.kind === "field");
      const seen = new Set<string>();
      const hits: CompletionItem[] = [];
      for (const f of methods) {
        if (q && !f.name.toLowerCase().includes(q)) continue;
        if (seen.has(f.sig)) continue;
        seen.add(f.sig);
        hits.push({
          id: `m:${f.sig}`,
          label: f.sig,
          detail: f.desc,
          badge: f.kind === "field" ? "field" : "method",
          insert: f.insert,
          cursorBack: f.cursorBack,
        });
      }
      return hits.length ? { replaceStart, items: hits.slice(0, 14) } : null;
    }

    // Bare identifier prefix (at least 1 char, not preceded by quote)
    const identMatch = /(?:^|[^A-Za-z0-9_."'])([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
    if (identMatch) {
      const q = identMatch[1].toLowerCase();
      const replaceStart = before.length - identMatch[1].length;
      const items: CompletionItem[] = [];
      const seen = new Set<string>();

      for (const f of FUNCTIONS) {
        if (f.kind !== "fn") continue;
        if (!f.name.toLowerCase().includes(q)) continue;
        seen.add(`fn:${f.name}`);
        items.push({
          id: `fn:${f.name}`,
          label: f.sig,
          detail: f.desc,
          badge: "fn",
          insert: f.insert,
          cursorBack: f.cursorBack,
        });
      }
      for (const f of FILE_FIELDS) {
        if (!f.name.toLowerCase().includes(q)) continue;
        if (seen.has(f.name)) continue;
        seen.add(f.name);
        items.push({
          id: f.name,
          label: f.sig,
          detail: f.desc,
          badge: "file",
          insert: f.insert,
          cursorBack: f.cursorBack,
        });
      }
      for (const p of allPropsList) {
        const hay = `${p.key} ${p.label} ${p.id}`.toLowerCase();
        if (!hay.includes(q)) continue;
        const ins = propInsert(p);
        if (seen.has(`p:${ins}`)) continue;
        seen.add(`p:${ins}`);
        items.push({
          id: `p:${p.id}`,
          label: p.isBuiltin ? p.id : `${p.key} → ${ins}`,
          detail: p.label !== p.key ? p.label : p.isBuiltin ? "Built-in" : "Note property",
          badge: p.isBuiltin ? "field" : "prop",
          insert: ins,
        });
      }
      return items.length ? { replaceStart, items: items.slice(0, 14) } : null;
    }

    return null;
  });

  $effect(() => {
    void acContext;
    acIndex = 0;
  });

  function formatCell(c: BaseCell | null): string {
    if (!c || c.t === "null") return "—";
    if (c.t === "bool" || c.t === "num" || c.t === "text") return String(c.value);
    if (c.t === "date" || c.t === "link") return c.text;
    return `[${c.items.map(formatCell).join(", ")}]`;
  }

  $effect(() => {
    void view;
    const curExpr = expr.trim();
    const curSample = sampleNote || undefined;
    const t = setTimeout(() => {
      if (!curExpr || !basePath) { preview = null; return; }
      busy = true;
      void api.formulaPreview({ path: basePath, expr: curExpr, ...(curSample ? { sample_note: curSample } : {}) })
        .then((r) => { preview = r; })
        .catch(() => { preview = { ok: false, sample_title: "", value: null, kind: null, error: "Could not evaluate formula" }; })
        .finally(() => { busy = false; });
    }, 180);
    return () => clearTimeout(t);
  });

  function syncCaret(): void {
    if (!inputEl) return;
    caret = inputEl.selectionStart ?? expr.length;
  }

  function insertToken(tok: string, cursorBack = 0): void {
    if (!inputEl) { expr += tok; return; }
    const s = inputEl.selectionStart ?? expr.length;
    const e = inputEl.selectionEnd ?? expr.length;
    expr = expr.slice(0, s) + tok + expr.slice(e);
    const pos = Math.max(s, s + tok.length - cursorBack);
    caret = pos;
    acDismissed = true;
    requestAnimationFrame(() => {
      inputEl.focus();
      inputEl.setSelectionRange(pos, pos);
    });
  }

  function applyCompletion(item: CompletionItem): void {
    if (!acContext || !inputEl) return;
    const start = acContext.replaceStart;
    const end = inputEl.selectionEnd ?? caret;
    let tok = item.insert;
    let back = item.cursorBack ?? 0;
    // If the user already typed a closing quote after prop("..., avoid doubling ")"
    if (item.badge === "prop" && expr.slice(end, end + 2) === '")') {
      tok = tok.slice(0, -2);
    }
    expr = expr.slice(0, start) + tok + expr.slice(end);
    const nextPos = Math.max(start, start + tok.length - back);
    caret = nextPos;
    acDismissed = true;
    requestAnimationFrame(() => {
      inputEl.focus();
      inputEl.setSelectionRange(nextPos, nextPos);
    });
  }

  function onExprKeydown(e: KeyboardEvent): void {
    if (!acContext) return;
    const n = acContext.items.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      acIndex = (acIndex + 1) % n;
      requestAnimationFrame(() => acMenuEl?.children[acIndex]?.scrollIntoView({ block: "nearest" }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      acIndex = (acIndex - 1 + n) % n;
      requestAnimationFrame(() => acMenuEl?.children[acIndex]?.scrollIntoView({ block: "nearest" }));
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      applyCompletion(acContext.items[acIndex] ?? acContext.items[0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      acDismissed = true;
    }
  }

  function pickExisting(n: string, x: string): void {
    name = n;
    expr = x;
    acDismissed = true;
    requestAnimationFrame(() => {
      if (!inputEl) return;
      caret = x.length;
      inputEl.focus();
    });
  }

  function save(e: SubmitEvent): void {
    e.preventDefault();
    const clean = name.trim().replace(/^formula\./, "");
    if (!clean || !expr.trim()) return;
    onedit({ op: "formula", name: clean, expr: expr.trim() }, onclose);
  }
</script>

<form class="fx-pop" onsubmit={save} data-testid="formula-editor-popover">
  <header class="fx-head">
    <strong>Guided formula builder</strong>
    <button type="button" class="x" onclick={onclose} aria-label="Close"><Icon name="close" size={12} /></button>
  </header>

  {#if existing.length > 0}
    <div class="chips-row">
      {#each existing as [fnName, fnExpr] (fnName)}
        <button type="button" class="chip" class:active={name === fnName} onclick={() => pickExisting(fnName, fnExpr)}>formula.{fnName}</button>
      {/each}
    </div>
  {/if}

  <label class="fld">
    <span>Column name</span>
    <input placeholder="score" bind:value={name} required />
  </label>

  <div class="fld expr-wrap">
    <div class="expr-head">
      <label for="fx-expr-input">Expression</label>
      <span class="ac-hint">Type prop, file., formula., or .method</span>
    </div>
    <textarea
      id="fx-expr-input"
      bind:this={inputEl}
      rows="3"
      bind:value={expr}
      spellcheck="false"
      placeholder='if(prop("done"), 100, 0)'
      aria-autocomplete="list"
      oninput={() => { acDismissed = false; syncCaret(); }}
      onclick={syncCaret}
      onkeyup={(e) => {
        if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) syncCaret();
      }}
      onkeydown={onExprKeydown}
      onblur={() => { setTimeout(() => { acDismissed = true; }, 120); }}
    ></textarea>
    {#if acContext}
      <ul class="ac-menu" role="listbox" aria-label="Formula completions" data-testid="formula-autocomplete" bind:this={acMenuEl}>
        {#each acContext.items as item, idx (item.id)}
          <li role="option" aria-selected={idx === acIndex}>
            <button
              type="button"
              class="ac-item"
              class:active={idx === acIndex}
              onmousedown={(e) => { e.preventDefault(); applyCompletion(item); }}
              onmouseenter={() => (acIndex = idx)}
            >
              <span class="ac-badge">{item.badge}</span>
              <code class="ac-lbl">{item.label}</code>
              <span class="ac-desc">{item.detail}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="section-head">
    <span class="section-lbl">Properties ({allPropsList.length})</span>
    {#if allPropsList.length > 8}
      <input class="mini-search" type="search" placeholder="Filter properties…" aria-label="Filter properties" bind:value={propQuery} spellcheck="false" />
    {/if}
  </div>
  <div class="chips-row props-scroll">
    {#each shownProps as p (p.id)}
      <button type="button" class="chip" title={p.id} onclick={() => insertToken(propInsert(p))}>{p.label}</button>
    {:else}
      <span class="empty-mini">No matching properties.</span>
    {/each}
  </div>

  <div class="section-head">
    <span class="section-lbl">Function reference ({filteredFunctions.length})</span>
    <input class="mini-search" type="search" placeholder="Search functions…" aria-label="Search functions" bind:value={fnQuery} spellcheck="false" />
  </div>
  <div class="fn-list">
    {#each filteredFunctions as fn (`${fn.kind}:${fn.sig}`)}
      <button type="button" class="fn-item" title="{fn.sig} — {fn.desc}" onclick={() => insertToken(fn.insert, fn.cursorBack ?? 0)}>
        <code>{fn.sig}</code>
        <span>{fn.desc}</span>
      </button>
    {:else}
      <p class="empty-mini">No matching functions.</p>
    {/each}
  </div>

  <div class="preview-box" class:err={preview && !preview.ok}>
    <div class="pv-head">
      <span class="pv-lbl">{busy ? "Checking…" : preview?.ok ? "Live sample output" : "Syntax check"}</span>
      {#if view.rows.length > 0}
        <div class="sample-pick">
          <Select label="Sample note" value={sampleNote} options={sampleOptions} onchange={(v) => (sampleNote = v)} />
        </div>
      {/if}
    </div>
    {#if preview && !preview.ok}
      <p class="pv-err">{preview.error ?? "Invalid expression"}</p>
    {:else if preview && preview.ok}
      <ul class="pv-list">
        <li><span class="pv-path">{preview.sample_title || "Sample"}</span><code>{formatCell(preview.value)}</code></li>
      </ul>
    {:else}
      <p class="pv-empty">Type a formula above to preview its output on rows in this view.</p>
    {/if}
  </div>

  <footer class="fx-foot">
    {#if existing.some(([fnName]) => fnName === name)}
      <button type="button" class="del" onclick={() => onedit({ op: "formula", name, expr: null }, onclose)}>Remove</button>
    {:else}<span></span>{/if}
    <div class="right">
      <button type="button" class="ghost" onclick={onclose}>Cancel</button>
      <button type="submit" class="save" disabled={!name.trim() || !expr.trim()}>Save formula</button>
    </div>
  </footer>
</form>

<style>
  .fx-pop { display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text); }
  .fx-head { display: flex; align-items: center; justify-content: space-between; color: var(--heading); font-size: 13px; }
  .fx-head .x { color: var(--text-faint); padding: 2px; border-radius: 4px; }
  .fld { display: flex; flex-direction: column; gap: 3px; color: var(--text-muted); }
  .fld input, .fld textarea { padding: 6px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font-family: var(--font-mono); font-size: 12px; }
  .fld input:focus, .fld textarea:focus { outline: none; border-color: var(--accent); }
  .expr-wrap { position: relative; }
  .expr-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .ac-hint { font-size: 10.5px; color: var(--text-faint); }
  .ac-menu {
    position: absolute; z-index: 30; top: 100%; left: 0; right: 0; margin: 3px 0 0; padding: 4px; list-style: none;
    max-height: 184px; overflow-y: auto; background: var(--bg-elev); border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm); box-shadow: var(--shadow-pop); display: flex; flex-direction: column; gap: 1px;
  }
  .ac-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 6px; border-radius: 4px; text-align: left; color: var(--text); font-size: 11.5px; min-width: 0; }
  .ac-item:hover, .ac-item.active { background: var(--accent-soft); }
  .ac-badge { flex: none; padding: 1px 5px; border-radius: 4px; background: var(--bg-side); border: 1px solid var(--border); color: var(--text-faint); font-family: var(--font-mono); font-size: 10px; }
  .ac-lbl { flex: none; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); font-family: var(--font-mono); }
  .ac-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); text-align: right; font-size: 11px; }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .section-lbl { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-faint); }
  .mini-search { width: 156px; height: 22px; padding: 0 7px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; font-size: 11px; }
  .mini-search:focus { outline: none; border-color: var(--accent); }
  .chips-row { display: flex; flex-wrap: wrap; gap: 4px; }
  .props-scroll { max-height: 76px; overflow-y: auto; }
  .chip { padding: 2px 7px; border-radius: 999px; background: var(--bg-side); border: 1px solid var(--border); color: var(--text-muted); font-size: 11px; }
  .chip:hover, .chip.active { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
  .fn-list { display: flex; flex-direction: column; gap: 2px; max-height: 126px; overflow-y: auto; }
  .fn-item { display: flex; justify-content: space-between; gap: 8px; padding: 3px 6px; border-radius: 4px; text-align: left; color: var(--text-muted); font-size: 11px; min-width: 0; }
  .fn-item:hover { background: var(--bg-hover); color: var(--text); }
  .fn-item code { flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; color: var(--accent); font-family: var(--font-mono); white-space: nowrap; }
  .fn-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
  .empty-mini { margin: 2px 0; color: var(--text-faint); font-size: 11px; }
  .preview-box { padding: 7px 9px; border-radius: var(--radius); background: var(--bg-side); border: 1px solid var(--border); }
  .preview-box.err { background: var(--red-soft); border-color: color-mix(in srgb, var(--red) 40%, transparent); }
  .pv-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  .pv-lbl { font-size: 10.5px; font-weight: 600; color: var(--text-faint); }
  .sample-pick :global(.select) { min-width: 140px; max-width: 220px; }
  .sample-pick :global(.trigger) { padding: 2px 7px; font-size: 11px; background: var(--bg); border-color: var(--border); }
  .sample-pick :global(.menu) { top: auto; bottom: calc(100% + 4px); left: auto; right: 0; }
  .pv-err { margin: 0; color: var(--red); }
  .pv-empty { margin: 0; color: var(--text-faint); }
  .pv-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .pv-list li { display: flex; justify-content: space-between; gap: 8px; }
  .pv-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
  .fx-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px; border-top: 1px solid var(--border); }
  .right { display: inline-flex; gap: 6px; }
  .ghost { padding: 4px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--text-muted); }
  .del { padding: 4px 10px; border-radius: var(--radius-sm); color: var(--red); }
  .save { padding: 4px 12px; border-radius: var(--radius-sm); background: var(--accent); color: var(--accent-fg); font-weight: 600; }
</style>
