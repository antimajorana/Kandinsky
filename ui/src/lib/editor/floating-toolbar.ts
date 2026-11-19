import { mount, unmount } from "svelte";
import type { EditorState, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import FloatingToolbar, { type FloatingToolbarSnapshot } from "../../components/FloatingToolbar.svelte";
import { app } from "../state.svelte";
import { findEnclosingLink, getSelectionFormat } from "./md-format";
import { frontmatterClose } from "./live/live-preview.js";
import { notePlaceAt } from "./math-context";

const SUPPRESSED_NODES = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "CodeText",
  "CodeMark",
  "HTMLBlock",
  "InlineMath",
  "BlockMath",
  "Math",
  "MathMark",
]);

interface MountedToolbar {
  setState(next: FloatingToolbarSnapshot): void;
  getElement(): HTMLElement | null;
  hasOpenPopover(): boolean;
  closeActivePopover(): boolean;
}

interface MeasureResult {
  visible: boolean;
  top: number;
  left: number;
  refine: boolean;
  format: ReturnType<typeof getSelectionFormat>;
  initialLink: string;
}

function isVimVisualMode(view: EditorView): boolean {
  if (!app.vimEnabled) return false;
  const cm = getCM(view) as { state?: { vim?: { visualMode?: boolean } } } | null;
  return Boolean(cm?.state?.vim?.visualMode);
}

function hasSuppressedAncestor(node: SyntaxNode | null): boolean {
  for (let cur = node; cur; cur = cur.parent) {
    if (SUPPRESSED_NODES.has(cur.name)) return true;
  }
  return false;
}

function isSuppressedSelection(state: EditorState, from: number, to: number): boolean {
  const fmClose = frontmatterClose(state.doc);
  const fmEnd = fmClose ? state.doc.line(fmClose).to : 0;
  if (fmEnd > 0 && (from < fmEnd || to <= fmEnd)) return true;

  const tree = syntaxTree(state);
  if (hasSuppressedAncestor(tree.resolveInner(from, 1))) return true;
  if (hasSuppressedAncestor(tree.resolveInner(to, -1))) return true;

  if (notePlaceAt(state, from).kind !== "text") return true;
  if (notePlaceAt(state, Math.max(from, to - 1)).kind !== "text") return true;
  return false;
}

function extractInitialLink(state: EditorState, from: number, to: number): string {
  return findEnclosingLink(state, from, to)?.target ?? "";
}

class FloatingToolbarPlugin {
  private host: HTMLDivElement;
  private instance: MountedToolbar;
  private measureKey = {};
  private dragging = false;
  private visible = false;
  private lastW = 0;
  private lastH = 0;
  private dismissedRange: { from: number; to: number } | null = null;
  private destroyed = false;
  private rafRefine = 0;

  private onPointerDown: (e: PointerEvent) => void;
  private onPointerUp: () => void;
  private onScrollOrResize: () => void;
  private onEditorKeyDown: (e: KeyboardEvent) => void;

  constructor(
    readonly view: EditorView,
    private readonly isEnabled: () => boolean,
  ) {
    this.host = document.createElement("div");
    this.host.className = "cm-floating-toolbar-host";
    document.body.appendChild(this.host);

    this.instance = mount(FloatingToolbar, {
      target: this.host,
      props: {
        view,
        onDismiss: () => this.dismiss(),
        onLayoutChange: () => this.scheduleMeasure(),
      },
    }) as unknown as MountedToolbar;

    this.onPointerDown = (e: PointerEvent) => {
      if (this.host.contains(e.target as Node | null)) return;
      this.dragging = true;
      this.hide();
    };

    this.onPointerUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.scheduleMeasure();
    };

    this.onScrollOrResize = () => {
      if (this.visible || !this.view.state.selection.main.empty) {
        this.scheduleMeasure();
      }
    };

    this.onEditorKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !this.visible) return;
      if (!app.vimEnabled) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!this.instance.closeActivePopover()) this.dismiss();
    };

    this.view.dom.addEventListener("pointerdown", this.onPointerDown);
    this.view.dom.addEventListener("keydown", this.onEditorKeyDown, true);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    this.view.scrollDOM.addEventListener("scroll", this.onScrollOrResize, { passive: true });
    window.addEventListener("scroll", this.onScrollOrResize, { capture: true, passive: true });
    window.addEventListener("resize", this.onScrollOrResize);
  }

  update(u: ViewUpdate): void {
    const sel = u.state.selection.main;
    if (this.dismissedRange && (sel.from !== this.dismissedRange.from || sel.to !== this.dismissedRange.to)) {
      this.dismissedRange = null;
    }
    if (u.docChanged || u.selectionSet || u.focusChanged || u.viewportChanged || u.transactions.length > 0) {
      this.scheduleMeasure();
    }
  }

  private dismiss(): void {
    const sel = this.view.state.selection.main;
    if (!sel.empty) {
      this.dismissedRange = { from: sel.from, to: sel.to };
    }
    this.hide();
    this.view.focus();
  }

  private hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.instance.setState({
      visible: false,
      top: 0,
      left: 0,
      format: getSelectionFormat(this.view.state),
      initialLink: "",
    });
  }

  private scheduleMeasure(): void {
    if (this.destroyed) return;
    this.view.requestMeasure({
      key: this.measureKey,
      read: (view) => this.readMeasure(view),
      write: (measure) => this.applyMeasure(measure),
    });
  }

  private readMeasure(view: EditorView): MeasureResult | null {
    if (this.destroyed || !this.isEnabled() || this.dragging) return null;
    const toolbarFocused = this.host.contains(document.activeElement);
    if (!view.hasFocus && !toolbarFocused) return null;
    if (isVimVisualMode(view)) return null;

    const sel = view.state.selection.main;
    if (sel.empty || sel.from >= sel.to) return null;
    if (this.dismissedRange && this.dismissedRange.from === sel.from && this.dismissedRange.to === sel.to) {
      return null;
    }
    if (isSuppressedSelection(view.state, sel.from, sel.to)) return null;

    const startCoords = view.coordsAtPos(sel.from);
    const endCoords = view.coordsAtPos(sel.to);
    if (!startCoords || !endCoords) return null;

    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const selTop = Math.min(startCoords.top, endCoords.top);
    const selBottom = Math.max(startCoords.bottom, endCoords.bottom);
    if (selBottom < scrollerRect.top || selTop > scrollerRect.bottom) return null;

    const el = this.instance.getElement();
    const rect = el?.getBoundingClientRect();
    const measuredW = rect && rect.width > 0 ? rect.width : 0;
    const measuredH = rect && rect.height > 0 ? rect.height : 0;
    if (measuredW > 0) this.lastW = measuredW;
    if (measuredH > 0) this.lastH = measuredH;

    const toolbarW = measuredW || this.lastW || 340;
    const toolbarH = measuredH || this.lastH || 38;
    const margin = 8;

    let top = selTop - toolbarH - margin;
    if (top < 12) top = selBottom + margin;
    top = Math.max(margin, Math.min(top, window.innerHeight - toolbarH - margin));

    const sameLine = Math.abs(startCoords.top - endCoords.top) < 6;
    const centerX = sameLine
      ? (startCoords.left + endCoords.right) / 2
      : (Math.min(startCoords.left, endCoords.left) + Math.max(startCoords.right, endCoords.right)) / 2;
    const left = Math.max(margin, Math.min(centerX - toolbarW / 2, window.innerWidth - toolbarW - margin));

    return {
      visible: true,
      top: Math.round(top),
      left: Math.round(left),
      refine: measuredW === 0 || measuredH === 0,
      format: getSelectionFormat(view.state),
      initialLink: extractInitialLink(view.state, sel.from, sel.to),
    };
  }

  private applyMeasure(measure: MeasureResult | null): void {
    if (this.destroyed) return;
    if (!measure || !measure.visible) {
      this.hide();
      return;
    }
    this.visible = true;
    this.instance.setState({
      visible: true,
      top: measure.top,
      left: measure.left,
      format: measure.format,
      initialLink: measure.initialLink,
    });
    if (measure.refine && !this.rafRefine) {
      this.rafRefine = requestAnimationFrame(() => {
        this.rafRefine = 0;
        if (!this.destroyed && this.visible) this.scheduleMeasure();
      });
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafRefine) {
      cancelAnimationFrame(this.rafRefine);
      this.rafRefine = 0;
    }
    this.view.dom.removeEventListener("pointerdown", this.onPointerDown);
    this.view.dom.removeEventListener("keydown", this.onEditorKeyDown, true);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.view.scrollDOM.removeEventListener("scroll", this.onScrollOrResize);
    window.removeEventListener("scroll", this.onScrollOrResize, true);
    window.removeEventListener("resize", this.onScrollOrResize);
    void unmount(this.instance);
    this.host.remove();
  }
}

export function floatingToolbarExtension(isEnabled: () => boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      private plugin: FloatingToolbarPlugin;
      constructor(view: EditorView) {
        this.plugin = new FloatingToolbarPlugin(view, isEnabled);
      }
      update(u: ViewUpdate): void {
        this.plugin.update(u);
      }
      destroy(): void {
        this.plugin.destroy();
      }
    },
  );
}
