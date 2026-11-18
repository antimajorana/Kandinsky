<script lang="ts" module>
  import * as prefs from "../../lib/prefs";

  type Phase = "focus" | "short" | "long";
  interface PersistedPomodoro {
    mode: Phase;
    running: boolean;
    remaining: number | null;
    endAt: number | null;
    completedSessions: number;
  }
  type PeerListener = (key: string) => void;

  const STORAGE_KEY = "kandinsky.pomodoro.v1";
  // Shared by every widget in the window, so two blocks with the same key show one timer instead of
  // overwriting each other; a write notifies the other instances, which re-read the record. localStorage stays
  // the record other windows see, so this copy is read only when storage is unavailable and is dropped once no
  // widget is mounted.
  const pomodoroStates = new Map<string, PersistedPomodoro>();
  const peers = new Set<PeerListener>();

  function loadStoredMap(): Record<string, PersistedPomodoro> {
    return prefs.load<Record<string, PersistedPomodoro>>(STORAGE_KEY, {});
  }

  function readStoredState(key: string): PersistedPomodoro | undefined {
    return loadStoredMap()[key] ?? pomodoroStates.get(key);
  }

  function writeStoredState(key: string, next: PersistedPomodoro, from?: PeerListener): void {
    pomodoroStates.set(key, next);
    const all = loadStoredMap();
    all[key] = next;
    prefs.save(STORAGE_KEY, all);
    for (const peer of [...peers]) if (peer !== from) peer(key);
  }
</script>

<script lang="ts">
  // Nootion Pomodoro widget: Focus / Short break / Long break tabs, Bauhaus SVG progress ring,
  // tabular MM:SS countdown, Start/Pause/Reset/Skip controls, session dots, and gentle WebAudio chime.
  import { onMount, untrack } from "svelte";

  let { options = {}, doc = "" }: { options?: Record<string, unknown>; doc?: string } = $props();

  function intOpt(v: unknown, def: number, min: number, max: number): number {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  }

  const focusMin = $derived(intOpt(options.focus, 25, 1, 180));
  const shortMin = $derived(intOpt(options.short_break, 5, 1, 60));
  const longMin = $derived(intOpt(options.long_break, 15, 1, 120));
  const goalSessions = $derived(intOpt(options.goal_sessions, 4, 1, 12));
  const soundOn = $derived(options.sound !== false && options.sound !== "false");
  const stateKey = $derived(typeof options.id === "string" && options.id.trim() ? options.id.trim() : doc || "global");

  let phase = $state<Phase>("focus");
  let leftSec = $state<number | null>(null);
  let running = $state(false);
  let endAt = $state<number | null>(null);
  let completedSessions = $state(0);

  const totalSec = $derived((phase === "focus" ? focusMin : phase === "short" ? shortMin : longMin) * 60);
  const remaining = $derived(leftSec === null ? totalSec : Math.max(0, leftSec));
  const mm = $derived(String(Math.floor(remaining / 60)).padStart(2, "0"));
  const ss = $derived(String(remaining % 60).padStart(2, "0"));
  const ringColor = $derived(phase === "focus" ? "var(--accent)" : "var(--green)");

  const R = 50;
  const CIRC = 2 * Math.PI * R;
  const dashOffset = $derived(CIRC * (1 - (totalSec > 0 ? remaining / totalSec : 1)));
  const dotTotal = $derived(Math.min(12, Math.max(goalSessions, completedSessions)));

  const onPeerWrite: PeerListener = (key) => {
    if (key === stateKey) restoreState(key);
  };

  function persistState(): void {
    writeStoredState(stateKey, {
      mode: phase,
      running,
      remaining: leftSec,
      endAt,
      completedSessions,
    }, onPeerWrite);
  }

  function restoreState(key: string): void {
    const saved = readStoredState(key);
    if (!saved) {
      phase = "focus";
      leftSec = null;
      running = false;
      endAt = null;
      completedSessions = 0;
      return;
    }
    phase = saved.mode === "short" || saved.mode === "long" ? saved.mode : "focus";
    completedSessions = Number.isFinite(saved.completedSessions) ? Math.max(0, Math.floor(saved.completedSessions)) : 0;
    if (saved.running && typeof saved.endAt === "number") {
      const rem = Math.ceil((saved.endAt - Date.now()) / 1000);
      if (rem <= 0) {
        const justFinished = Date.now() - saved.endAt < 3000;
        running = false;
        endAt = null;
        leftSec = null;
        if (justFinished) playChime();
        if (phase === "focus") {
          completedSessions += 1;
          phase = completedSessions % goalSessions === 0 ? "long" : "short";
        } else {
          phase = "focus";
        }
        writeStoredState(key, {
          mode: phase,
          running: false,
          remaining: null,
          endAt: null,
          completedSessions,
        }, onPeerWrite);
      } else {
        running = true;
        endAt = saved.endAt;
        leftSec = rem;
      }
    } else {
      running = false;
      endAt = null;
      leftSec = typeof saved.remaining === "number" ? Math.max(0, Math.floor(saved.remaining)) : null;
    }
  }

  let loadedKey = "";
  $effect(() => {
    const k = stateKey;
    if (k !== loadedKey) {
      loadedKey = k;
      untrack(() => restoreState(k));
    }
  });

  function playChime(): void {
    if (!soundOn || typeof window === "undefined") return;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const t0 = ctx.currentTime;
      for (const [freq, delay] of [[587.33, 0], [880, 0.16]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t0 + delay);
        gain.gain.setValueAtTime(0.0001, t0 + delay);
        gain.gain.exponentialRampToValueAtTime(0.085, t0 + delay + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.42);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + delay);
        osc.stop(t0 + delay + 0.45);
      }
      setTimeout(() => { try { void ctx.close(); } catch { /* ignore */ } }, 900);
    } catch {
      /* WebAudio unavailable or blocked in headless environment */
    }
  }

  function selectPhase(next: Phase): void {
    running = false;
    phase = next;
    leftSec = null;
    endAt = null;
    persistState();
  }

  function advancePhase(chime: boolean): void {
    running = false;
    endAt = null;
    if (chime) playChime();
    if (phase === "focus") {
      completedSessions += 1;
      phase = completedSessions % goalSessions === 0 ? "long" : "short";
    } else {
      phase = "focus";
    }
    leftSec = null;
    persistState();
  }

  function toggleRun(): void {
    if (running) {
      const rem = endAt !== null ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) : remaining;
      running = false;
      endAt = null;
      leftSec = rem;
    } else {
      const rem = leftSec === null || leftSec <= 0 ? totalSec : leftSec;
      leftSec = rem;
      endAt = Date.now() + rem * 1000;
      running = true;
    }
    persistState();
  }

  function resetTimer(): void {
    running = false;
    leftSec = null;
    endAt = null;
    persistState();
  }

  // The tick only redraws: endAt alone rebuilds the countdown, so writing every second would undo
  // a pause or reset made in another instance with the same key.
  function syncFromClock(): void {
    if (!running || endAt === null) return;
    const rem = Math.ceil((endAt - Date.now()) / 1000);
    if (rem <= 0) {
      const saved = readStoredState(stateKey);
      if (saved && !(saved.running && saved.endAt === endAt)) restoreState(stateKey);
      else advancePhase(true);
    } else if (rem !== leftSec) {
      leftSec = rem;
    }
  }

  onMount(() => {
    syncFromClock();
    const id = setInterval(syncFromClock, 500);
    document.addEventListener("visibilitychange", syncFromClock);
    peers.add(onPeerWrite);
    // Another window wrote the record: drop the cached copy and adopt the stored one.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      pomodoroStates.delete(stateKey);
      restoreState(stateKey);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", syncFromClock);
      peers.delete(onPeerWrite);
      if (peers.size === 0) pomodoroStates.clear();
      window.removeEventListener("storage", onStorage);
    };
  });

  const PHASES: { id: Phase; label: string }[] = [
    { id: "focus", label: "Focus" },
    { id: "short", label: "Short break" },
    { id: "long", label: "Long break" },
  ];
</script>

<div class="widget">
  <div class="tabs kandinsky-seg" role="tablist" aria-label="Pomodoro phase">
    {#each PHASES as p (p.id)}
      <button
        type="button"
        role="tab"
        aria-selected={phase === p.id}
        class:on={phase === p.id}
        onclick={() => selectPhase(p.id)}
      >{p.label}</button>
    {/each}
  </div>

  <div class="body">
    <div class="ring-wrap">
      <svg viewBox="0 0 120 120" class="ring-svg" aria-hidden="true">
        <circle cx="60" cy="60" r="42" fill="none" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 3" />
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--border-strong)" stroke-width="6" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={ringColor}
          stroke-width="6"
          stroke-linecap="round"
          stroke-dasharray={CIRC}
          stroke-dashoffset={dashOffset}
          transform="rotate(-90 60 60)"
          class="arc"
        />
      </svg>
      <div class="readout">
        <span class="time">{mm}:{ss}</span>
        <span class="state">{running ? (phase === "focus" ? "Focusing" : "Resting") : leftSec !== null ? "Paused" : "Ready"}</span>
      </div>
    </div>

    <div class="side">
      <div class="controls">
        <button
          type="button"
          class="ctrl-btn primary"
          class:break-tone={phase !== "focus"}
          onclick={toggleRun}
        >{running ? "Pause" : "Start"}</button>
        <button type="button" class="ctrl-btn" onclick={resetTimer}>Reset</button>
        <button type="button" class="ctrl-btn" onclick={() => advancePhase(false)} title="Skip to next phase">Skip</button>
      </div>

      <div class="sessions" aria-label="{completedSessions} of {goalSessions} sessions completed">
        <div class="dots" aria-hidden="true">
          {#each Array.from({ length: dotTotal }, (_, i) => i) as i (i)}
            <span class="dot" class:filled={i < completedSessions}>{i < completedSessions ? "●" : "○"}</span>
          {/each}
        </div>
        <span class="session-lbl">{completedSessions} / {goalSessions} sessions</span>
      </div>
    </div>
  </div>
</div>

<style>
  .widget {
    display: flex; flex-direction: column; gap: 12px; font-family: var(--font-ui); color: var(--text);
    background: var(--bg-alt); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px;
  }
  :global(.pb.card) .widget { background: none; border: 0; border-radius: 0; padding: 0; }
  .tabs { align-self: flex-start; }
  .body { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .ring-wrap { position: relative; width: 118px; height: 118px; flex: none; display: grid; place-items: center; }
  .ring-svg { width: 100%; height: 100%; display: block; }
  .arc { transition: stroke-dashoffset 260ms linear, stroke 180ms ease; }
  .readout { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
  .time { font-family: var(--font-mono); font-size: 23px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--heading); line-height: 1.1; }
  .state { font-size: 11px; color: var(--text-faint); margin-top: 2px; }
  .side { display: flex; flex-direction: column; gap: 12px; flex: 1; min-width: 150px; }
  .controls { display: flex; flex-wrap: wrap; gap: 6px; }
  .ctrl-btn {
    height: 30px; padding: 0 12px; border-radius: 6px; font-size: 12.5px; font-weight: 500;
    border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); cursor: pointer;
    transition: background 120ms, border-color 120ms;
  }
  .ctrl-btn:hover { background: var(--bg-hover); border-color: var(--text-faint); }
  .ctrl-btn.primary { min-width: 68px; background: var(--accent); color: var(--accent-fg); border-color: transparent; font-weight: 600; }
  .ctrl-btn.primary:hover { background: var(--accent-strong, var(--accent)); }
  .ctrl-btn.primary.break-tone { background: var(--green); color: #ffffff; /* literal: white on viridian fill */ }
  .ctrl-btn.primary.break-tone:hover { filter: brightness(1.06); }
  :global(html.phone) .ctrl-btn { min-height: 40px; }
  .sessions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .dots { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; line-height: 1; }
  .dot { color: var(--text-faint); }
  .dot.filled { color: var(--accent); }
  .session-lbl { font-family: var(--font-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--text-muted); }
</style>
