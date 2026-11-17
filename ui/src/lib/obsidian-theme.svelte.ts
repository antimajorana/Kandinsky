// Loads an optional `.obsidian/themes/<Name>/theme.css` live when `settings.config.ui.obsidian_theme` is selected.
import { api } from "./api";
import { reloadOnChange } from "./reload-on-change";
import { onSettings, settings } from "./settings.svelte";
import { toast } from "./state.svelte";
import { errText } from "./text";

const STYLE_ID = "kandinsky-obsidian-theme";
let applySeq = 0;
let lastApplied = "";

function sanitizeObsidianCss(css: string): string {
  return css
    .replace(/@import\s+(?:url\s*\([^)]*\)|"[^"]*"|'[^']*'|[^;]+);?/gi, "/* blocked-import */")
    .replace(/url\(\s*(?:"(?:https?:|\/\/|javascript:|vbscript:)[^"]*"|'(?:https?:|\/\/|javascript:|vbscript:)[^']*'|(?:https?:|\/\/|javascript:|vbscript:)[^)]*)\s*\)/gi, 'url("about:invalid")');
}

function removeThemeStyle(): void {
  document.getElementById(STYLE_ID)?.remove();
  lastApplied = "";
}

export async function applyObsidianTheme(force = false): Promise<void> {
  const id = (settings.config?.ui.obsidian_theme ?? "").trim();
  if (!id) {
    removeThemeStyle();
    return;
  }
  if (!force && id === lastApplied && document.getElementById(STYLE_ID)) return;
  const seq = ++applySeq;
  try {
    const css = sanitizeObsidianCss(await api.obsidianThemeCss(id));
    if (seq !== applySeq) return;
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.append(el);
    }
    el.dataset.obsidianTheme = id;
    el.textContent = css;
    lastApplied = id;
  } catch (e) {
    if (seq !== applySeq) return;
    removeThemeStyle();
    toast("Obsidian theme could not be loaded", errText(e));
  }
}

export function initObsidianTheme(): () => void {
  void applyObsidianTheme();
  const offFs = reloadOnChange(() => void applyObsidianTheme(true), {
    wait: 200,
    wants: (p) => p.startsWith(".obsidian/themes/"),
  });
  const offCfg = onSettings(() => { void applyObsidianTheme(); });
  return () => {
    offFs();
    offCfg();
  };
}
