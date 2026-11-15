// Several Circles pigment classification for Notion-style property rows & equation label lookup.
// Shared between inline `.note-properties` (note-extensions.ts) and the side PropertiesPanel / PropertyField.
import { loadRaw, saveRaw } from "../prefs";
import { fences } from "../fence-walk";
import { parseYaml, scalarText } from "../property-model";

export type PigmentTone = "viridian" | "cobalt" | "ochre" | "mauve" | "vermilion";

const STATUS_KEY = /^(status|verification|state|check|audit|lint|health|stage|phase|result|verdict)$/i;
const DOMAIN_KEY = /^(domain|domains|tags?|topics?|field|fields|area|areas|sector|sectors|category|categories|subject)$/i;
const BADGE_KEY = /^(type|kind|category|categories|role|class|format|series|course|venue|domain|domains|topics?|field|fields|area|areas|sector|sectors|subject)$/i;
const MULTI_PIGMENTS: readonly PigmentTone[] = ["cobalt", "ochre", "mauve", "viridian"];

const WIKI_PROVENANCE_VAL = /\bwiki\s+(accepted|filed|verified)\b/i;
const VIRIDIAN_VAL = /\b(verified|clean|accepted|passed|pass|complete|completed|done|proven|proved|published|final|active|ok|ready|green)\b/i;
const OCHRE_VAL = /\b(draft|wip|pending|in[-_ ]?progress|review|partial|warning|todo|open|sketch|conjecture|conditional)\b/i;
const OCHRE_DOMAIN_VAL = /\b(crystal|defects?|lattice)\b/i;
const VERMILION_VAL = /\b(failed|fail|failing|broken|error|rejected|refuted|blocked|stale|deprecated|missing|red)\b/i;
const MAUVE_VAL = /\b(concept|definition|axiom|entity|reference|paper|book|archive|paused)\b/i;

function hashTone(text: string): PigmentTone {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return MULTI_PIGMENTS[Math.abs(h) % MULTI_PIGMENTS.length];
}

/** Classifies a property value into a Kandinsky *Several Circles* pigment and whether it carries a status dot (`●`). */
export function classifyPigment(
  key: string,
  rawValue: string,
  index = 0,
  opts: { isList?: boolean; isTag?: boolean; isLink?: boolean } = {},
): { tone: PigmentTone | null; dot: boolean; wrapScalar: boolean } {
  const val = rawValue.trim();
  if (!val) return { tone: null, dot: false, wrapScalar: false };
  const k = key.trim();

  if (WIKI_PROVENANCE_VAL.test(val)) {
    return { tone: "cobalt", dot: false, wrapScalar: true };
  }

  if (STATUS_KEY.test(k) || (!DOMAIN_KEY.test(k) && (VIRIDIAN_VAL.test(val) || VERMILION_VAL.test(val)))) {
    if (VERMILION_VAL.test(val)) return { tone: "vermilion", dot: true, wrapScalar: true };
    if (OCHRE_VAL.test(val)) return { tone: "ochre", dot: true, wrapScalar: true };
    if (VIRIDIAN_VAL.test(val)) return { tone: "viridian", dot: true, wrapScalar: true };
    if (STATUS_KEY.test(k)) return { tone: "cobalt", dot: true, wrapScalar: true };
  }

  if (opts.isLink) return { tone: "cobalt", dot: false, wrapScalar: false };
  if (opts.isTag || opts.isList) {
    // Deterministic cycle across items in a list (`Algebraic Topology` → cobalt, `Crystal Defects` → ochre, …)
    const tone = MULTI_PIGMENTS[index % MULTI_PIGMENTS.length] ?? hashTone(val);
    return { tone, dot: false, wrapScalar: false };
  }

  if (BADGE_KEY.test(k)) {
    if (OCHRE_VAL.test(val) || (DOMAIN_KEY.test(k) && OCHRE_DOMAIN_VAL.test(val))) {
      return { tone: "ochre", dot: false, wrapScalar: true };
    }
    if (MAUVE_VAL.test(val)) return { tone: "mauve", dot: false, wrapScalar: true };
    return { tone: "cobalt", dot: false, wrapScalar: true };
  }

  return { tone: null, dot: false, wrapScalar: false };
}

// Session-only memory for whether the user explicitly clicked the `.prop-head` toggle on a compact note.
let userCollapsedSession: boolean | null = null;

/** Upgrades `propertiesElement(...)` DOM in place into compact Notion property rows with *Several Circles* pigment pills. */
export function enhanceNotionProperties(host: HTMLElement, yamlText: string): HTMLElement {
  const data = parseYaml(yamlText);
  const entries = data ? Object.entries(data) : [];
  const count = entries.length;
  const compact = count > 0 && count <= 8;

  if (compact) {
    host.classList.add("is-compact");
    if (userCollapsedSession !== true) {
      host.classList.remove("is-collapsed");
      host.querySelector(".prop-head")?.setAttribute("aria-expanded", "true");
      if (loadRaw("kandinsky.properties.collapsed") === "1") saveRaw("kandinsky.properties.collapsed", "0");
    }
  }

  const head = host.querySelector<HTMLButtonElement>(".prop-head");
  head?.addEventListener("click", () => {
    userCollapsedSession = host.classList.contains("is-collapsed");
  });

  const rowEls = host.querySelectorAll<HTMLElement>(".prop-row");
  entries.forEach(([key, rawVal], rowIdx) => {
    const row = rowEls[rowIdx];
    if (!row) return;
    row.dataset.propKey = key;
    const keySvg = row.querySelector<SVGElement>(".prop-key svg");
    if (keySvg) {
      keySvg.style.display = "block";
      keySvg.style.flexShrink = "0";
      keySvg.style.shapeRendering = "geometricPrecision";
    }
    const valEl = row.querySelector<HTMLElement>(".prop-value");
    if (!valEl) return;

    const pills = valEl.querySelectorAll<HTMLElement>(".prop-pill");
    if (pills.length > 0) {
      const isList = Array.isArray(rawVal) || pills.length > 1;
      pills.forEach((pill, idx) => {
        const isTag = pill.classList.contains("prop-tag");
        const isLink = pill.classList.contains("internal-link");
        const { tone, dot } = classifyPigment(key, pill.textContent ?? "", idx, { isList, isTag, isLink });
        if (tone) pill.classList.add(`pill-${tone}`);
        if (dot) pill.classList.add("has-dot");
      });
      return;
    }

    // Scalar text/enum values such as `type: lecture` or `verification: c_lint clean (14/14)`:
    // wrap in a pigment pill while keeping `.prop-value.prop-*` text intact for readers and tests.
    if (rawVal === null || rawVal === undefined || typeof rawVal === "boolean" || typeof rawVal === "number") return;
    if (valEl.querySelector("a, input, .prop-empty")) return;
    const s = scalarText(rawVal);
    // Leave dates/timestamps (`2026-11-15`, `2026-10-01 09:00`) as clean tabular text
    if (/^\d{4}-\d{2}-\d{2}/.test(s.trim())) {
      valEl.classList.add("prop-tabular");
      return;
    }
    const { tone, dot, wrapScalar } = classifyPigment(key, s, 0);
    if (wrapScalar && tone) {
      const span = document.createElement("span");
      span.className = `prop-pill pill-${tone}${dot ? " has-dot" : ""}`;
      span.textContent = s;
      valEl.replaceChildren(span);
    }
  });

  return host;
}

/** Finds the 1-based line number of an equation `\label{id}`, `\tag{id}`, or `^id` in a Markdown or TeX document. */
export function findEquationLine(text: string, id: string): number | null {
  const target = id.trim().replace(/^#\^?/, "");
  if (!target) return null;
  const lines = text.split("\n");
  const code = fences();
  const esc = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelRe = new RegExp(`\\\\(?:label|tag\\*?)\\{\\s*${esc}\\s*\\}`);
  const blockIdRe = new RegExp(`(?:^|\\s)\\^${esc}\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (code.code(lines[i])) continue;
    if (labelRe.test(lines[i]) || blockIdRe.test(lines[i])) return i + 1;
  }
  return null;
}

/** Scans standalone `\begin{equation|align|gather|multline|eqnarray}` blocks & `\tag{label}` in addition to `$$…$$`. */
export function scanExtraEquations(md: string, existingById: ReadonlyMap<string, string>): Map<string, { num: string; line: number }> {
  const out = new Map<string, { num: string; line: number }>();
  const lines = md.split("\n");
  const code = fences();
  let nextNum = existingById.size + 1;
  for (let i = 0; i < lines.length; i++) {
    if (code.code(lines[i])) continue;
    const envOpen = /^[\s>]*\\begin\{(equation|align|gather|multline|eqnarray)(\*?)\}/.exec(lines[i]);
    if (envOpen) {
      const closeTag = `\\end{${envOpen[1]}${envOpen[2]}}`;
      let close = i;
      while (close < lines.length && !lines[close].includes(closeTag)) close++;
      const block = lines.slice(i, Math.min(close + 1, lines.length)).join("\n");
      const ownTag = /\\tag\*?\{([^}]*)\}/.exec(block)?.[1]?.trim();
      const lbl = /\\label\{([^}]+)\}/.exec(block)?.[1]?.trim();
      const starred = envOpen[2] === "*" || /\\(?:notag|nonumber)\b/.test(block);
      const num = ownTag ?? (!starred ? String(nextNum++) : "");
      if (lbl && !existingById.has(lbl) && num) out.set(lbl, { num, line: i + 1 });
      if (ownTag && !existingById.has(ownTag)) out.set(ownTag, { num: ownTag, line: i + 1 });
      i = close;
      continue;
    }
    const tagMatch = /\\tag\*?\{([^}]+)\}/.exec(lines[i]);
    if (tagMatch) {
      const t = tagMatch[1].trim();
      if (t && !existingById.has(t) && !out.has(t)) out.set(t, { num: t, line: i + 1 });
    }
  }
  return out;
}
