// Global distraction-free Zen mode: hides shell chrome, tab headers, topbars, format bars, and status bar across
// every pane (Editor, Page, Canvas, Excalidraw), coordinating cleanly with `fullscreen` and mounting a subtle
// hover-reveal `Exit Zen · F11` pill in the top-right corner.
import { fullscreen, toggleFullscreen } from "./fullscreen.svelte";
import { iconSvg } from "./icons";
import { nativeShell } from "./native-shell.svelte";

export const zenMode = $state({ on: false });

let zenMadeFull = false;
let transitioning = false;
let exitBtn: HTMLButtonElement | null = null;

function syncExitPill(): void {
  if (!exitBtn) return;
  exitBtn.hidden = !zenMode.on;
}

function clearZenSilently(): void {
  zenMadeFull = false;
  zenMode.on = false;
  if (typeof document !== "undefined") {
    document.documentElement.classList.remove("kandinsky-zen");
  }
  syncExitPill();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("kandinsky-layout"));
  }
}

export async function setZenMode(on: boolean): Promise<void> {
  if (on === zenMode.on) {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("kandinsky-zen", on);
    }
    syncExitPill();
    return;
  }
  transitioning = true;
  try {
    zenMode.on = on;
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("kandinsky-zen", on);
    }
    syncExitPill();
    if (on && !fullscreen.on) {
      zenMadeFull = true;
      await toggleFullscreen();
    } else if (!on && zenMadeFull) {
      zenMadeFull = false;
      if (fullscreen.on || nativeShell.on) {
        await toggleFullscreen();
      }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("kandinsky-layout"));
    }
  } finally {
    transitioning = false;
    syncExitPill();
  }
}

export async function toggleZenMode(): Promise<void> {
  await setZenMode(!zenMode.on);
}

export function installZenListeners(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "kandinsky-zen-exit";
  btn.dataset.testid = "zen-exit-btn";
  btn.title = "Exit Zen Mode (F11)";
  btn.setAttribute("aria-label", "Exit Zen Mode");
  btn.hidden = !zenMode.on;
  btn.innerHTML = `${iconSvg("close", 13)}<span>Exit Zen</span><span class="zen-exit-sep keys-only" aria-hidden="true">·</span><kbd class="keys-only">F11</kbd>`;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void setZenMode(false);
  });
  document.body.appendChild(btn);
  exitBtn = btn;

  const onToggleEvent = () => {
    void toggleZenMode();
  };
  window.addEventListener("kandinsky:toggle-zen", onToggleEvent);

  let sawDomFullscreen = Boolean(document.fullscreenElement);
  const onDomFullscreenChange = () => {
    const active = Boolean(document.fullscreenElement);
    if (active) {
      sawDomFullscreen = true;
    } else if (sawDomFullscreen && zenMode.on && !transitioning) {
      sawDomFullscreen = false;
      void setZenMode(false);
    } else {
      sawDomFullscreen = false;
    }
  };
  document.addEventListener("fullscreenchange", onDomFullscreenChange);

  const mo = new MutationObserver(() => {
    if (!transitioning && zenMode.on && !document.documentElement.classList.contains("kandinsky-zen")) {
      clearZenSilently();
    }
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  const stopEffect = $effect.root(() => {
    let sawFull = fullscreen.on;
    $effect(() => {
      const isFull = fullscreen.on;
      const isZen = zenMode.on;
      syncExitPill();
      if (!isZen) {
        sawFull = isFull;
        return;
      }
      if (isFull) {
        sawFull = true;
      } else if (sawFull && !transitioning) {
        sawFull = false;
        clearZenSilently();
      }
    });
  });

  return () => {
    stopEffect();
    mo.disconnect();
    window.removeEventListener("kandinsky:toggle-zen", onToggleEvent);
    document.removeEventListener("fullscreenchange", onDomFullscreenChange);
    if (exitBtn === btn) exitBtn = null;
    btn.remove();
  };
}
