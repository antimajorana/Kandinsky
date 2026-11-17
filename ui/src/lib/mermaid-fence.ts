// Dynamic Mermaid diagram fence renderer (`type: mermaid` / ```mermaid): imports `mermaid` lazily on first diagram so main bundle stays tiny.
import DOMPurify from "dompurify";
import { registerFence } from "./fences";
import { errText } from "./text";

let mermaidSeq = 0;

function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme !== "light" && !document.documentElement.classList.contains("light");
}

registerFence("kandinsky-mermaid", "mermaid", (host, fence) => {
  let gone = false;
  let lastDark = isDarkTheme();
  const box = document.createElement("div");
  box.className = "tikz-figure mermaid-figure";
  box.dataset.state = "drawing";
  box.textContent = "Rendering diagram…";
  host.append(box);

  const draw = async () => {
    const dark = isDarkTheme();
    lastDark = dark;
    try {
      const { default: mermaid } = await import("mermaid");
      if (gone) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "default",
      });
      const id = `kdy-mmd-${++mermaidSeq}`;
      const { svg, bindFunctions } = await mermaid.render(id, fence.source);
      if (gone) return;
      box.dataset.state = "done";
      box.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      bindFunctions?.(box);
      for (const el of box.querySelectorAll("svg")) el.setAttribute("role", "img");
    } catch (e) {
      if (gone) return;
      box.dataset.state = "error";
      const title = Object.assign(document.createElement("div"), {
        className: "tikz-error-title",
        textContent: "Mermaid diagram syntax issue",
      });
      const why = Object.assign(document.createElement("pre"), {
        className: "tikz-error-log",
        textContent: errText(e),
      });
      box.replaceChildren(title, why);
    }
  };

  void draw();

  let mo: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    mo = new MutationObserver(() => {
      const dark = isDarkTheme();
      if (dark !== lastDark) void draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  }

  return () => {
    gone = true;
    mo?.disconnect();
    mo = null;
    box.remove();
  };
});
