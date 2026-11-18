// Dynamic Mermaid diagram fence renderer (`type: mermaid` / ```mermaid): imports `mermaid` lazily on first diagram so main bundle stays tiny.
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
    const id = `kdy-mmd-${++mermaidSeq}`;
    try {
      const { default: mermaid } = await import("mermaid");
      if (gone) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: dark ? "dark" : "default",
        // the fence shows its own error box; mermaid's error diagram would stay in a temp div on <body>
        suppressErrorRendering: true,
      });
      const { svg, bindFunctions } = await mermaid.render(id, fence.source);
      if (gone) return;
      box.dataset.state = "done";
      // "strict" already runs DOMPurify with foreignObject as an HTML integration point; an SVG-only
      // second pass removed every foreignObject and with it the node and edge labels
      box.innerHTML = svg;
      bindFunctions?.(box);
      for (const el of box.querySelectorAll("svg")) el.setAttribute("role", "img");
    } catch (e) {
      document.getElementById(`d${id}`)?.remove(); // a temp div left by a failed render
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
