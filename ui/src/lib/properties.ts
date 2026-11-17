// Obsidian-style Properties table for a note's YAML frontmatter, drawn in the note (`[editor]
// properties = inline`): one row per key with its kind's icon (the vault's spec, else the value's
// shape), links and tags as pills, collapsible like Obsidian's. Read-only: a click outside a link
// reveals the YAML. The panel at the right (`= panel`) edits them: components/PropertiesPanel.svelte.
import { escapeHtml } from "./text";
import { loadRaw, saveRaw } from "./prefs";
import { resolveLink } from "./vault";
import { kindOf, parseYaml, scalarText, WIKI } from "./property-model";
import { propertySpec } from "./property-spec.svelte";
import type { PropertyKind } from "./types";

const BAUHAUS_VERIFICATION_ICON = '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/>';
const BAUHAUS_GRID_ICON = '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M3.5 12h17"/>';
const BAUHAUS_CALENDAR_ICON = '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><circle cx="8.5" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none"/>';
const BAUHAUS_PERSON_ICON = '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>';

const VERIFICATION_KEY_RE = /^(verification|status|state|check|audit|lint|health|stage|phase|result|verdict)$/i;
const DOMAIN_KEY_RE = /^(domain|domains|tags?|topics?|field|fields|area|areas|sector|sectors|category|categories|subject)$/i;
const DATE_KEY_RE = /^(date|created|updated|modified|due|deadline|scheduled|published|start|end)$/i;
const PERSON_KEY_RE = /^(author|authors|owner|assignee|speaker|instructor)$/i;

const ICON: Record<PropertyKind, string> = {
  text: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  enum: '<path d="m8.5 10.5 3.5 3.5 3.5-3.5"/><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>',
  status: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/>',
  rating: '<path d="m12 3.5 2.6 5.3 5.9.8-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.8Z"/>',
  auto_id: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M8 10h2v4M14 10h2v4M7.5 14h3"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  date: BAUHAUS_CALENDAR_ICON,
  datetime: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  number: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  bool: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  links: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  tags: BAUHAUS_GRID_ICON,
};

function resolveIconBody(k: PropertyKind, key?: string): string {
  const trimmed = key?.trim() ?? "";
  if (trimmed) {
    if (VERIFICATION_KEY_RE.test(trimmed)) return BAUHAUS_VERIFICATION_ICON;
    if (DOMAIN_KEY_RE.test(trimmed)) return BAUHAUS_GRID_ICON;
    if (DATE_KEY_RE.test(trimmed)) return BAUHAUS_CALENDAR_ICON;
    if (PERSON_KEY_RE.test(trimmed)) return BAUHAUS_PERSON_ICON;
  }
  if (k === "tags") return BAUHAUS_GRID_ICON;
  if (k === "date") return BAUHAUS_CALENDAR_ICON;
  return ICON[k];
}

/** A property's semantic Bauhaus or kind icon, as SVG markup (shared by inline rows and PropertiesPanel). */
export const propertyIcon = (k: PropertyKind, key?: string): string =>
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${resolveIconBody(k, key)}</svg>`;
const esc = escapeHtml;

function valueHtml(v: unknown, kind: PropertyKind, dir: string): string {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return `<span class="prop-empty">Empty</span>`;
  const items = Array.isArray(v) ? v : [v];
  const one = (x: unknown) => {
    const s = scalarText(x);
    const w = WIKI.exec(s);
    if (w) {
      const cls = resolveLink(w[1], dir) ? "" : " is-unresolved";
      return `<a class="prop-pill internal-link${cls}" data-href="${esc(w[1])}" href="#">${esc(w[2] ?? w[1].split("/").pop()!)}</a>`;
    }
    if (kind === "tags") return `<span class="prop-pill prop-tag">${esc(s.replace(/^#/, ""))}</span>`;
    if (Array.isArray(v)) return `<span class="prop-pill">${esc(s)}</span>`;
    if (kind === "bool") return `<input type="checkbox" disabled${x ? " checked" : ""}>`;
    if (/^https?:\/\//.test(s)) return `<a class="external-link" href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a>`;
    return esc(s);
  };
  return items.map(one).join("");
}

let collapsed = loadRaw("kandinsky.properties.collapsed") === "1";

/** Build the table. `onLink(target)` opens a link; a YAML error shows the error, not an empty box. */
export function propertiesElement(yamlText: string, dir: string, onLink: (target: string) => void): HTMLElement {
  const host = document.createElement("div");
  host.className = "note-properties" + (collapsed ? " is-collapsed" : "");
  const data = parseYaml(yamlText);
  const rows = data
    ? Object.entries(data).map(([k, v]) => {
        const kind = kindOf(propertySpec.spec, k, v);
        return `<div class="prop-row"><span class="prop-key" title="${esc(k)}">${propertyIcon(kind, k)}<span>${esc(k)}</span></span><span class="prop-value prop-${kind}">${valueHtml(v, kind, dir)}</span></div>`;
      }).join("")
    : `<div class="prop-row prop-error">Frontmatter is not valid YAML — click to edit it.</div>`;
  const count = data ? Object.keys(data).length : 0;
  host.innerHTML = `<button type="button" class="prop-head" aria-expanded="${!collapsed}"><span class="prop-chevron">▸</span>Properties<span class="prop-count">${count}</span></button><div class="prop-rows">${rows}</div>`;
  host.querySelector(".prop-head")!.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = !collapsed;
    saveRaw("kandinsky.properties.collapsed", collapsed ? "1" : "0");
    for (const el of document.querySelectorAll(".note-properties")) el.classList.toggle("is-collapsed", collapsed);
    host.querySelector(".prop-head")!.setAttribute("aria-expanded", String(!collapsed));
  });
  host.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    onLink(a.dataset.href ?? "");
  });
  return host;
}

/** The folded stand-in (`hidden` and `panel`): one faint line saying the note has properties;
 *  a click shows the YAML (the editor's usual "show me the source" gesture). The outer line is the
 *  editor's block (no margins: CodeMirror measures blocks by their box), the pill its hover target. */
export function propertiesChip(yamlText: string): HTMLElement {
  const data = parseYaml(yamlText);
  const line = document.createElement("div");
  line.className = "cm-properties-line";
  const pill = document.createElement("span");
  pill.className = "cm-properties";
  pill.title = "Show the properties in a panel at the right";
  // opens the rich panel (PropertiesPanel); the event never reaches CodeMirror, so the caret does not drop into the YAML
  line.addEventListener("mousedown", (e) => { if (e.altKey) return; /* Alt+click: the YAML (live-preview.js) */ e.preventDefault(); e.stopImmediatePropagation(); window.dispatchEvent(new Event("kandinsky-properties-toggle")); }); // immediate: the live preview's own listener on this element would enter the YAML
  pill.textContent = "Properties";
  const n = document.createElement("span");
  n.className = "cm-properties-n";
  n.textContent = data ? String(Object.keys(data).length) : "!";
  pill.append(n);
  line.append(pill);
  return line;
}
