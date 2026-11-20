// Mentions (docs/guides/MALLEABLE.md R4 — Embark's `@`): `@key` / `[@key]` in a note is a chip for a
// structured entity. Papers come from the Library (Pandoc citation syntax, so files stay plain);
// plugins add other kinds by prefix (`@run:…`) through registerEntities; `@YYYY-MM-DD` and
// `@YYYY-MM-DD HH:MM` open the Calendar at that day. Hover shows the entity, a click opens it.
// The text stays editable: chips are marks, not replacements.
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { onLibraryChange, providers, resolveDateEntity, resolveEntity } from "../entities";
import type { GatedSource } from "./completion-gate";

// `@` must start a word (e-mail addresses never match); `@YYYY-MM-DD HH:MM` keeps optional trailing time
const MENTION = /(^|[\s(\[;])@(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?|[\w][\w:./-]*[\w])/g;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?$/;
const MENTION_STYLE_ID = "kandinsky-date-mention-css";

function ensureDateMentionStyles(): void {
  if (typeof document === "undefined" || document.getElementById(MENTION_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MENTION_STYLE_ID;
  style.textContent = `
.markdown .kandinsky-mention.kandinsky-date-mention {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
  cursor: pointer;
}
.markdown .kandinsky-mention.kandinsky-date-mention::before {
  content: "📅";
  font-size: 0.86em;
  line-height: 1;
}
.markdown .kandinsky-mention.kandinsky-date-mention:hover {
  background: var(--accent-dim);
  color: var(--accent-strong);
}
`;
  document.head.append(style);
}

const inCodeOrMath = (view: EditorView, pos: number) => {
  const n = syntaxTree(view.state).resolveInner(pos, 1).name;
  // `[@key]` parses as a Link (Pandoc citations look like reference links): only code, math and
  // URLs are off limits
  return /Code|Math|URL/.test(n);
};

const known = new Set<string>(); // ids that resolved (the chip is plain); others get .is-missing
const missing = new Set<string>();
let watched = false;

function mark(id: string) {
  const dateEnt = DATE_KEY_RE.test(id) ? resolveDateEntity(id) : null;
  if (dateEnt) {
    return Decoration.mark({
      class: "kandinsky-mention kandinsky-date-mention",
      attributes: {
        "data-mention": id,
        "data-date": id.slice(0, 10),
        "data-date-label": dateEnt.title,
        title: `${dateEnt.title} — Click to open Calendar`,
      },
    });
  }
  return Decoration.mark({ class: `kandinsky-mention${missing.has(id) ? " is-missing" : ""}`, attributes: { "data-mention": id } });
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(MENTION)) {
      const start = from + m.index! + m[1].length, end = start + 1 + m[2].length;
      if (inCodeOrMath(view, start)) continue;
      b.add(start, end, mark(m[2]));
    }
  }
  return b.finish();
}

const chips = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(readonly view: EditorView) {
    ensureDateMentionStyles();
    // a paper added or edited may resolve a "missing" mention: ask again
    if (!watched) { watched = true; onLibraryChange(() => { known.clear(); missing.clear(); }); }
    this.decorations = build(view);
    void this.check();
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged) { this.decorations = build(u.view); void this.check(); }
  }
  /** Resolve unseen ids once; repaint when one turns out missing. */
  async check() {
    const ids = new Set<string>();
    this.decorations.between(0, this.view.state.doc.length, (_f, _t, d) => { ids.add(String(d.spec.attributes["data-mention"])); });
    let changed = false;
    for (const id of ids) {
      if (known.has(id) || missing.has(id)) continue;
      if (DATE_KEY_RE.test(id) && resolveDateEntity(id)) {
        known.add(id);
        continue;
      }
      if (await resolveEntity(id)) known.add(id); else { missing.add(id); changed = true; }
    }
    if (changed) { this.decorations = build(this.view); this.view.dispatch({}); }
  }
}, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    mousedown(e) {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".kandinsky-mention");
      if (!el || e.altKey || e.button !== 0) return false; // Alt+click: edit the text
      e.preventDefault();
      void resolveEntity(el.dataset.mention!).then((x) => x?.open());
      return true;
    },
  },
});

const card = hoverTooltip(async (view, pos) => {
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(MENTION)) {
    const start = line.from + m.index! + m[1].length, end = start + 1 + m[2].length;
    if (pos < start || pos > end) continue;
    const x = await resolveEntity(m[2]);
    const isDate = DATE_KEY_RE.test(m[2]) && !!x;
    return {
      pos: start, end, above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "kandinsky-mention-card";
        const h = Object.assign(document.createElement("div"), { className: "t", textContent: x ? (isDate ? `📅 ${x.title}` : x.title) : `@${m[2]}` });
        const s = Object.assign(document.createElement("div"), { className: "s", textContent: x ? x.subtitle ?? "" : "Not in the Library (or any provider) — a typo, or a paper to add." });
        dom.append(h, s);
        for (const [k, v] of Object.entries(x?.props ?? {})) dom.append(Object.assign(document.createElement("div"), { className: "p", textContent: `${k}: ${v}` }));
        if (x) dom.append(Object.assign(document.createElement("div"), { className: "hint", textContent: isDate ? "Click to open Calendar · Alt+click to edit" : "Click to open · Alt+click to edit" }));
        return { dom };
      },
    };
  }
  return null;
}, { hoverTime: 350 });

/** Completion for plugin entities (`@run:` …); citekeys stay in md-complete's citeSource. */
const ENTITY_BEFORE = /(?:^|[\s(\[;])@([\w-]+:)[\w:./-]*$/;
export const entitySource: GatedSource = {
  applies: (ctx) => !!ctx.matchBefore(ENTITY_BEFORE),
  answer: entityResult,
};

async function entityResult(ctx: CompletionContext): Promise<CompletionResult | null> {
  const m = ctx.matchBefore(ENTITY_BEFORE);
  if (!m) return null;
  const p = providers.find((x) => x.prefix && x.prefix === /@([\w-]+:)/.exec(m.text)![1]);
  if (!p?.list) return null;
  const at = m.from + m.text.lastIndexOf("@");
  const items = await p.list();
  return { from: at, options: items.map((i) => ({ label: `@${p.prefix}${i.id}`, detail: i.title })), validFor: /^@[\w:./-]*$/ };
}

export const mentions: Extension = [chips, card];
