// `![[paper.pdf]]`, `![[Note]]` / `![[Note#Heading]]` and `![[any file]]`: markdown.ts renders a placeholder, this mounts
// what the embed registry has for the file (embed-registry.ts: a drawing, a plugin's), else
// the PDF viewer, the note (its section), or the file's own view into it — Obsidian embeds the first two; they showed as
// a link chip ("pdf's, some blocks … dont render correctly"). Any other file: sound and video play here, a file with a view (a table, a page,
// code, a book in its plugin's reader — the "Open with" default) is that view, the rest a card that opens it. Editor
// widgets and reading views alike, as bases.ts does for `.base`.
import { embedOptions, fileIcon } from "./panes";
import { basename } from "./paths";
import { mountBlock, paneBlockType } from "./blocks";
import { openWikilink, resolveWikilink } from "./links";
import { openersFor, resolveSpec } from "./openers";
import { blobUrl } from "./raw";
import { iconSvg } from "./icons";
import { embedFor, onEmbedsChanged, type Embed } from "./embed-registry";
import { logPlugin } from "./plugin-log.svelte";
import { errText } from "./text";
import "./builtin-embeds";
import "./embed-open"; // the ↗ over an embed, Ctrl+click: the original

/** How deep notes may embed notes (a note that embeds itself, or two that embed each other, stop here). */
const MAX_DEPTH = 2;
const PDF_HEIGHT = 520;
const AUDIO = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|weba)$/i;
const VOICE_WEBM = /(?:^|\/)(?:recording|voice|audio)[^/]*\.webm$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|mkv|ogv)$/i;

export const isAudioEmbedPath = (path: string): boolean => AUDIO.test(path) || VOICE_WEBM.test(path);
const isVideoEmbedPath = (path: string): boolean => !isAudioEmbedPath(path) && VIDEO.test(path);

const PLAY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6L19.2 12z"/></svg>';
const PAUSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.8" height="14" rx="1.2"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2"/></svg>';

function fmtAudioTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const whole = Math.floor(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The block an embedded file is drawn with (`type: table\npath: …`), or null: a card. `section`: what follows the
 *  `#` (a table's `view=Name`). */
function fileBlock(path: string, section: string): string | null {
  const spec = resolveSpec(path, undefined, section || undefined);
  // the editor is everyone's fallback: only for what it can read (a .zip is not text)
  if (spec.kind === "editor" && !openersFor(path).some((o) => o.id === "editor")) return null;
  const opts = spec.kind === "plugin" ? { id: spec.id, path } : embedOptions(spec);
  if (!opts) return null;
  return [`type: ${paneBlockType(spec.kind)}`, ...Object.entries(opts).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)].join("\n");
}

/** A file nothing draws: its icon, its name, and a click that opens it as a plain open would. */
function card(el: HTMLElement, path: string): void {
  const a = document.createElement("a");
  a.className = "file-card internal-link";
  a.href = "#";
  a.dataset.href = path;
  a.title = `Open ${path}`;
  const icon = document.createElement("span");
  icon.className = "file-card-icon";
  icon.innerHTML = iconSvg(fileIcon(path), 18);
  const name = document.createElement("span");
  name.textContent = basename(path);
  a.append(icon, name);
  el.replaceChildren(a);
}

/** Sound or video, played in the note. Audio renders a compact Bauhaus/Notion inline `.embed-audio-card`. */
async function media(el: HTMLElement, path: string, video: boolean): Promise<void> {
  const src = await blobUrl(path);
  if (released.has(el)) return;
  if (video) {
    const v = document.createElement("video");
    v.controls = true;
    v.preload = "metadata";
    v.className = "embed-video";
    v.src = src;
    el.replaceChildren(v);
    keep(el, () => { v.pause(); v.removeAttribute("src"); v.load(); });
    return;
  }

  const label = basename(path);
  const wrap = document.createElement("div");
  wrap.className = "embed-audio-card";
  wrap.dataset.testid = "embed-audio-card";
  wrap.dataset.audioPath = path;

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "embed-audio-play";
  playBtn.setAttribute("aria-label", `Play ${label}`);
  playBtn.title = "Play";
  playBtn.innerHTML = PLAY_SVG;

  const main = document.createElement("div");
  main.className = "embed-audio-main";

  const meta = document.createElement("div");
  meta.className = "embed-audio-meta";

  const title = document.createElement("span");
  title.className = "embed-audio-title";
  title.textContent = label;
  title.title = path;

  const time = document.createElement("span");
  time.className = "embed-audio-time";
  time.textContent = "0:00 / 0:00";

  const scrub = document.createElement("input");
  scrub.type = "range";
  scrub.className = "embed-audio-scrub";
  scrub.min = "0";
  scrub.max = "100";
  scrub.step = "0.05";
  scrub.value = "0";
  scrub.setAttribute("aria-label", `Seek ${label}`);

  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.className = "embed-audio";
  audio.hidden = true;
  audio.src = src;

  let dragging = false;
  let probedInfinity = false;

  const syncUi = () => {
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const cur = dragging ? Number(scrub.value) || 0 : (Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    if (dur > 0) scrub.max = String(dur);
    if (!dragging) scrub.value = String(dur > 0 ? Math.min(cur, dur) : 0);
    const pct = dur > 0 ? Math.max(0, Math.min(100, (cur / dur) * 100)) : 0;
    wrap.style.setProperty("--audio-pct", `${pct.toFixed(2)}%`);
    time.textContent = `${fmtAudioTime(cur)} / ${fmtAudioTime(dur)}`;
    const playing = !audio.paused && !audio.ended;
    wrap.classList.toggle("is-playing", playing);
    playBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
    playBtn.title = playing ? "Pause" : "Play";
    playBtn.setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${label}`);
  };

  for (const ev of ["pointerdown", "mousedown", "click"] as const) {
    wrap.addEventListener(ev, (e) => e.stopPropagation());
  }

  playBtn.addEventListener("click", () => {
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  });

  scrub.addEventListener("pointerdown", () => { dragging = true; });
  scrub.addEventListener("pointerup", () => { dragging = false; });
  scrub.addEventListener("change", () => {
    dragging = false;
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number(scrub.value);
    syncUi();
  });
  scrub.addEventListener("input", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = Number(scrub.value);
    syncUi();
  });

  audio.addEventListener("loadedmetadata", () => {
    if (audio.duration === Infinity && !probedInfinity) {
      probedInfinity = true;
      const onProbe = () => {
        audio.removeEventListener("timeupdate", onProbe);
        audio.currentTime = 0;
        syncUi();
      };
      audio.addEventListener("timeupdate", onProbe);
      audio.currentTime = 1e101;
      return;
    }
    syncUi();
  });
  for (const ev of ["durationchange", "timeupdate", "play", "pause", "ended"] as const) {
    audio.addEventListener(ev, syncUi);
  }

  meta.append(title, time);
  main.append(meta, scrub);
  wrap.append(playBtn, main, audio);
  el.replaceChildren(wrap);
  keep(el, () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  });
}

/** `compact` (a card on Home, the day's log): a file, PDF or note embedded there is its card, never a whole viewer.
 *  → unmounts what it mounted: a block kept mounted pins its element, and through it the whole closed note
 *  (Svelte's `mount` registers its target until `unmount`; leak hunt). */
export function hydrateEmbeds(root: HTMLElement, notePath: string, compact = false): () => void {
  const mine: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(`${PLACEHOLDERS.map((c) => `${c}:not([data-mounted])`).join(", ")}`)) {
    el.dataset.mounted = "1";
    el.dataset.embedNote = notePath;
    el.dataset.embedClass = el.className; // what a redraw starts from (a drawing adds its own classes)
    if (compact) el.dataset.embedCompact = "1";
    mine.push(el);
    void mountEmbed(el, notePath, compact);
  }
  return () => { for (const el of mine) release(el); };
}

const PLACEHOLDERS = [".pdf-embed", ".note-embed", ".file-embed"];
// what each mounted embed undoes before it is drawn again (a registration came or went) or when it goes
const cleanups = new WeakMap<HTMLElement, () => void>();
const mounted = new Set<WeakRef<HTMLElement>>();
/** Each mounted element's entry in `mounted`: a release finds it at once (a closed note's embeds all go together). */
const refOf = new WeakMap<HTMLElement, WeakRef<HTMLElement>>();
function track(el: HTMLElement): void {
  const ref = new WeakRef(el);
  refOf.set(el, ref);
  mounted.add(ref);
}
/** Embeds whose note view went: one still resolving its link must not mount into them afterwards. */
const released = new WeakSet<HTMLElement>();

function release(el: HTMLElement): void {
  released.add(el);
  try { cleanups.get(el)?.(); } catch { /* the drawing's own problem */ }
  cleanups.delete(el);
  const ref = refOf.get(el);
  if (ref) mounted.delete(ref);
  refOf.delete(el);
}
/** Keeps `clean` for `el` — or runs it at once when the embed was released while it was being drawn. */
function keep(el: HTMLElement, clean: () => void): void {
  if (released.has(el)) clean(); else cleanups.set(el, clean);
}

/** One placeholder: a registered embed when one takes the file (embed-registry.ts), else the usual viewer. */
async function mountEmbed(el: HTMLElement, notePath: string, compact: boolean): Promise<void> {
  const [target, ...rest] = (el.dataset.target ?? "").split("#");
  const section = rest.join("#").trim();
  const pdf = el.classList.contains("pdf-embed"), file = el.classList.contains("file-embed");
  let depth = 0;
  for (let up = el.parentElement?.closest(".note-embed"); up; up = up.parentElement?.closest(".note-embed")) depth++;
  const path = await resolveWikilink(target, notePath).catch(() => "");
  if (!path || released.has(el)) return;
  el.dataset.embedPath = path;
  const by = embedFor(path);
  el.dataset.embedBy = String(by?.id ?? 0);
  if (by) {
    track(el);
    return drawRegistered(el, by, path, section, notePath, compact);
  }
  if (!pdf && !file && depth >= MAX_DEPTH) return; // left as the link it was drawn with
  if (!pdf && !file && path === notePath && !section) return; // the note itself: the link stays
  track(el);
  if (compact && !(isAudioEmbedPath(path) || isVideoEmbedPath(path))) return card(el, path);
  if (file) {
    if (isAudioEmbedPath(path) || isVideoEmbedPath(path)) return void media(el, path, isVideoEmbedPath(path)).catch(() => card(el, path));
    const src = fileBlock(path, section);
    if (!src) return card(el, path);
    el.replaceChildren();
    return keep(el, mountBlock(el, notePath, src));
  }
  el.replaceChildren();
  const page = /^page=(\d+)/.exec(section)?.[1];
  const src = pdf
    ? `type: pdf\npath: ${JSON.stringify(path)}\nheight: ${PDF_HEIGHT}${page ? `\npage: ${page}` : ""}`
    : !file && !compact && section.startsWith("^")
      ? `type: synced\npath: ${JSON.stringify(path)}\nblock: ${JSON.stringify(section.slice(1))}`
      : `type: note\npath: ${JSON.stringify(path)}${section ? `\nsection: ${JSON.stringify(section)}` : ""}`;
  keep(el, mountBlock(el, notePath, src));
}

/** A registered embed into `el`: its failure is said in place and logged as its owner's. */
async function drawRegistered(el: HTMLElement, by: Embed, path: string, anchor: string, note: string, compact: boolean): Promise<void> {
  const options = (el.dataset.opts ?? "").split("|").map((p) => p.trim()).filter(Boolean);
  const width = Number(options.map((p) => /^(\d+)(?:x\d+)?$/.exec(p)?.[1]).find(Boolean)) || undefined;
  el.classList.add("registered-embed");
  el.replaceChildren();
  const fail = (e: unknown) => {
    if (by.owner !== "core") logPlugin(by.owner, `embed ${path}`, e); else console.error("[kandinsky] embed", path, e);
    el.replaceChildren(Object.assign(document.createElement("p"), { className: "view-error", textContent: `${path.split("/").pop()}: ${errText(e)}` }));
  };
  try {
    const clean = await by.render(el, { path, anchor, options, width, note, compact, open: () => void openWikilink(anchor ? `${path}#${anchor}` : path, note) });
    if (el.dataset.embedBy !== String(by.id)) { if (typeof clean === "function") clean(); return; } // redrawn meanwhile
    if (typeof clean === "function") keep(el, clean);
  } catch (e) { fail(e); }
}

// a registration came or went (a plugin loaded, reloaded or switched off): the embeds it changes are drawn again
onEmbedsChanged(() => {
  for (const ref of [...mounted]) {
    const el = ref.deref();
    if (!el || !el.isConnected) { mounted.delete(ref); continue; }
    const path = el.dataset.embedPath;
    if (!path || String(embedFor(path)?.id ?? 0) === el.dataset.embedBy) continue;
    mounted.delete(ref);
    try { cleanups.get(el)?.(); } catch { /* the old drawing's own problem */ }
    cleanups.delete(el);
    el.className = el.dataset.embedClass ?? el.className;
    el.removeAttribute("style");
    const note = el.dataset.embedNote ?? "", compact = el.dataset.embedCompact === "1";
    void mountEmbed(el, note, compact);
  }
});
