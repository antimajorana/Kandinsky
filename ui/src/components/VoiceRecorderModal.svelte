<script lang="ts">
  import { tick } from "svelte";
  import Dialog from "./Dialog.svelte";
  import Icon from "./Icon.svelte";
  import { shownName } from "../lib/paths";
  import { toast } from "../lib/state.svelte";
  import { errText } from "../lib/text";
  import { closeVoiceRecorder, saveVoiceRecording, voiceRecorder } from "../lib/voice-recorder.svelte";

  type Phase = "idle" | "requesting" | "recording" | "paused" | "preview" | "saving";

  const BAR_COUNT = 16;
  const REST_BARS = Array.from({ length: BAR_COUNT }, () => 0.08);
  const MIME_CANDIDATES: readonly { mime: string; ext: string }[] = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
    { mime: "audio/ogg", ext: "ogg" },
    { mime: "audio/mp4", ext: "mp4" },
  ];

  function extFromMime(mimeType: string): string {
    const t = mimeType.toLowerCase();
    if (t.includes("ogg")) return "ogg";
    if (t.includes("mp4")) return "mp4";
    if (t.includes("m4a") || t.includes("aac")) return "m4a";
    if (t.includes("wav")) return "wav";
    return "webm";
  }

  let phase = $state<Phase>("idle");
  let elapsedMs = $state(0);
  let bars = $state<number[]>([...REST_BARS]);
  let errorMsg = $state("");
  let previewUrl = $state("");
  let recordedBlob = $state<Blob | null>(null);
  let recordedExt = $state(pickMime().ext);
  let startBtn = $state<HTMLButtonElement>();

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let chunks: BlobPart[] = [];
  let chosenMime = "";
  let rafId = 0;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let baseElapsedMs = 0;
  let runStartedAt = 0;
  let abortFinalize: (() => void) | null = null;

  const timerLabel = $derived.by(() => {
    const s = Math.max(0, Math.floor(elapsedMs / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  });

  function pickMime(): { mime: string; ext: string } {
    if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
      for (const c of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(c.mime)) return c;
    }
    return { mime: "", ext: "webm" };
  }

  function stopLiveGraph(): void {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = undefined; }
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    if (audioCtx) { void audioCtx.close().catch(() => {}); audioCtx = null; }
    analyser = null;
    bars = [...REST_BARS];
  }

  function revokePreview(): void {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; }
    recordedBlob = null;
  }

  function resetAll(): void {
    abortFinalize?.();
    abortFinalize = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try { recorder.stop(); } catch { /* ignore */ }
    }
    recorder = null;
    chunks = [];
    stopLiveGraph();
    revokePreview();
    phase = "idle";
    elapsedMs = 0;
    baseElapsedMs = 0;
    runStartedAt = 0;
    errorMsg = "";
  }

  function startMeterLoop(): void {
    if (!analyser) return;
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const step = () => {
      if (!analyser || (phase !== "recording" && phase !== "paused")) return;
      if (phase === "paused") {
        bars = bars.map((v) => Math.max(0.08, v * 0.82));
      } else {
        analyser.getByteFrequencyData(freq);
        bars = Array.from({ length: BAR_COUNT }, (_, i) =>
          Math.max(0.08, Math.min(1, Math.pow((freq[i + 1] ?? freq[i] ?? 0) / 255, 0.78) * 1.18)),
        );
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }

  function describeMicError(err: unknown): string {
    const name = (err as { name?: string } | null)?.name ?? "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
      return "Microphone permission was denied. Allow microphone access in your browser or OS settings and try again.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No microphone was detected on this device. Connect an audio input and try again.";
    }
    return `Could not start microphone: ${errText(err)}`;
  }

  async function startRecording(): Promise<void> {
    errorMsg = "";
    revokePreview();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      errorMsg = "Audio recording is unavailable in this environment (MediaRecorder / microphone API missing).";
      return;
    }
    phase = "requesting";
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!voiceRecorder.open) { for (const t of media.getTracks()) t.stop(); return; }
      stream = media;
      const picked = pickMime();
      chosenMime = picked.mime;
      chunks = [];
      const rec = chosenMime ? new MediaRecorder(media, { mimeType: chosenMime }) : new MediaRecorder(media);
      const actualRecMime = rec.mimeType || chosenMime;
      if (actualRecMime) {
        chosenMime = actualRecMime;
        recordedExt = extFromMime(actualRecMime);
      } else {
        recordedExt = picked.ext;
      }
      rec.ondataavailable = (ev) => {
        if (rec.mimeType && rec.mimeType !== chosenMime) {
          chosenMime = rec.mimeType;
          recordedExt = extFromMime(rec.mimeType);
        }
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      rec.onerror = (ev) => {
        const err = (ev as Event & { error?: unknown }).error;
        recorder = null;
        stopLiveGraph();
        phase = "idle";
        errorMsg = `Recording error: ${errText(err ?? "MediaRecorder failure")}`;
      };
      recorder = rec;

      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        audioCtx = new Ctx();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.76;
        audioCtx.createMediaStreamSource(media).connect(analyser);
      }

      baseElapsedMs = 0;
      elapsedMs = 0;
      runStartedAt = Date.now();
      rec.start(200);
      if (rec.mimeType) {
        chosenMime = rec.mimeType;
        recordedExt = extFromMime(rec.mimeType);
      }
      phase = "recording";
      tickTimer = setInterval(() => {
        if (phase === "recording") elapsedMs = baseElapsedMs + (Date.now() - runStartedAt);
      }, 150);
      startMeterLoop();
    } catch (err) {
      stopLiveGraph();
      phase = "idle";
      errorMsg = describeMicError(err);
    }
  }

  function pauseRecording(): void {
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    baseElapsedMs += Date.now() - runStartedAt;
    elapsedMs = baseElapsedMs;
    phase = "paused";
  }

  function resumeRecording(): void {
    if (!recorder || recorder.state !== "paused") return;
    runStartedAt = Date.now();
    recorder.resume();
    phase = "recording";
  }

  function finalizeRecording(): Promise<Blob | null> {
    if (recordedBlob) return Promise.resolve(recordedBlob);
    const rec = recorder;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    if (phase === "recording") { baseElapsedMs += Date.now() - runStartedAt; elapsedMs = baseElapsedMs; }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return true;
        settled = true;
        clearTimeout(timeoutId);
        if (abortFinalize === cancelFinalize) abortFinalize = null;
        rec.onstop = null;
        rec.onerror = null;
        return false;
      };
      const cancelFinalize = () => {
        if (finish()) return;
        resolve(null);
      };
      abortFinalize = cancelFinalize;
      const timeoutId = setTimeout(() => {
        if (finish()) return;
        recorder = null;
        stopLiveGraph();
        reject(new Error("Recording failed to finalize (recorder timed out)."));
      }, 5000);
      rec.onerror = (ev) => {
        if (finish()) return;
        recorder = null;
        stopLiveGraph();
        const err = (ev as Event & { error?: unknown }).error;
        reject(err instanceof Error ? err : new Error(errText(err ?? "Audio recorder error")));
      };
      rec.onstop = () => {
        if (finish()) return;
        const actualMime = rec.mimeType || chosenMime || (chunks[0] instanceof Blob ? chunks[0].type : "") || "audio/webm";
        recordedExt = extFromMime(actualMime);
        const blob = new Blob(chunks, { type: actualMime });
        recorder = null;
        stopLiveGraph();
        recordedBlob = blob;
        previewUrl = URL.createObjectURL(blob);
        resolve(blob);
      };
      try { rec.requestData(); } catch { /* ignore */ }
      try {
        rec.stop();
      } catch (err) {
        if (!finish()) {
          recorder = null;
          stopLiveGraph();
          reject(err instanceof Error ? err : new Error(errText(err)));
        }
      }
    });
  }

  async function stopAndPreview(): Promise<void> {
    errorMsg = "";
    try {
      const blob = await finalizeRecording();
      if (!voiceRecorder.open) return;
      if (!blob || !blob.size) { phase = "idle"; errorMsg = "No audio data was captured. Check your microphone and try again."; return; }
      phase = "preview";
    } catch (err) {
      if (!voiceRecorder.open) return;
      phase = "idle";
      errorMsg = `Could not stop recording: ${errText(err)}`;
    }
  }

  async function saveAndInsert(): Promise<void> {
    errorMsg = "";
    let blob: Blob | null;
    try {
      blob = await finalizeRecording();
    } catch (err) {
      if (!voiceRecorder.open) return;
      phase = "idle";
      errorMsg = `Could not finalize recording: ${errText(err)}`;
      return;
    }
    if (!voiceRecorder.open) return;
    if (!blob || !blob.size) { phase = "idle"; errorMsg = "No audio data was captured to save."; return; }
    phase = "saving";
    try {
      const { path, embed } = await saveVoiceRecording(blob, recordedExt);
      const insertFn = voiceRecorder.onInsert;
      resetAll();
      closeVoiceRecorder();
      insertFn?.(embed);
      toast("Voice note saved", path, "success");
    } catch (err) {
      phase = "preview";
      errorMsg = `Could not save recording: ${errText(err)}`;
    }
  }

  function handleClose(): void { resetAll(); closeVoiceRecorder(); }

  $effect(() => {
    if (!voiceRecorder.open) { resetAll(); return; }
    void tick().then(() => startBtn?.focus());
    return () => resetAll();
  });
</script>

{#if voiceRecorder.open}
  <Dialog label="Record Voice Note" testid="voice-recorder-modal" onclose={handleClose}>
    <div class="vr-modal">
      <header class="vr-head">
        <div class="vr-title-row">
          <span class="vr-dot" class:live={phase === "recording"} class:paused={phase === "paused"}></span>
          <strong>Record Voice Note</strong>
          {#if voiceRecorder.notePath}<span class="vr-note-chip" title={voiceRecorder.notePath}>→ {shownName(voiceRecorder.notePath)}</span>{/if}
        </div>
        <button type="button" class="icon-btn" aria-label="Close voice recorder" onclick={handleClose}><Icon name="close" size={15} /></button>
      </header>

      <div class="vr-stage">
        <div class="vr-timer" data-phase={phase}>{timerLabel}</div>
        <div class="vr-bars" aria-hidden="true" data-phase={phase}>
          {#each bars as lv, idx (idx)}<span class="vr-bar" style:--lv={lv.toFixed(3)}></span>{/each}
        </div>
        <div class="vr-status">
          {#if phase === "idle"}Ready — saves into <code>zAttachments/recording-….{recordedExt}</code>
          {:else if phase === "requesting"}Requesting microphone permission…
          {:else if phase === "recording"}Recording live audio…
          {:else if phase === "paused"}Recording paused
          {:else if phase === "preview"}Preview ready — listen below or insert into note
          {:else}Saving voice note…{/if}
        </div>
      </div>

      {#if phase === "preview" && previewUrl}
        <audio class="vr-preview-audio" controls preload="metadata" src={previewUrl}></audio>
      {/if}
      {#if errorMsg}<div class="kandinsky-notice error" role="alert">{errorMsg}</div>{/if}

      <footer class="vr-actions">
        <button type="button" class="btn btn-ghost" onclick={handleClose} disabled={phase === "saving"}>Cancel</button>
        <div class="vr-actions-right">
          {#if phase === "idle" || phase === "requesting"}
            <button type="button" class="btn primary" bind:this={startBtn} onclick={() => void startRecording()} disabled={phase === "requesting"}>
              {phase === "requesting" ? "Starting…" : "Start Recording"}
            </button>
          {:else if phase === "recording" || phase === "paused"}
            <button type="button" class="btn btn-ghost" onclick={phase === "recording" ? pauseRecording : resumeRecording}>
              {phase === "recording" ? "Pause" : "Resume"}
            </button>
            <button type="button" class="btn btn-ghost" onclick={() => void stopAndPreview()}>Stop &amp; Preview</button>
            <button type="button" class="btn primary" onclick={() => void saveAndInsert()}>Save &amp; Insert into Note</button>
          {:else}
            <button type="button" class="btn btn-ghost" onclick={() => void startRecording()} disabled={phase === "saving"}>Re-record</button>
            <button type="button" class="btn primary" onclick={() => void saveAndInsert()} disabled={phase === "saving"}>
              {phase === "saving" ? "Saving…" : "Save & Insert into Note"}
            </button>
          {/if}
        </div>
      </footer>
    </div>
  </Dialog>
{/if}

<style>
  .vr-modal { width: min(480px, 94vw); background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius-xl, 12px); padding: 16px 18px; box-shadow: var(--shadow-pop); display: flex; flex-direction: column; gap: 14px; }
  .vr-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .vr-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: calc(14px * var(--ui-scale, 1)); color: var(--heading); }
  .vr-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-faint); flex: none; transition: background .15s, box-shadow .15s; }
  .vr-dot.live { background: var(--red); box-shadow: 0 0 0 4px var(--red-soft); animation: pulse 1.2s infinite; }
  .vr-dot.paused { background: var(--yellow); }
  .vr-note-chip { font-size: calc(11.5px * var(--ui-scale, 1)); color: var(--text-muted); background: var(--bg-alt); border: 1px solid var(--border); padding: 1px 7px; border-radius: 999px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vr-stage { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-lg, 10px); padding: 16px 14px 12px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .vr-timer { font-family: var(--font-mono); font-size: calc(28px * var(--ui-scale, 1)); font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: .03em; color: var(--heading); line-height: 1.1; }
  .vr-timer[data-phase="recording"] { color: var(--red); }
  .vr-bars { height: 46px; width: 100%; max-width: 280px; display: grid; grid-template-columns: repeat(16, 1fr); align-items: center; gap: 5px; }
  .vr-bar { display: block; width: 100%; height: calc(5px + 38px * var(--lv, 0.08)); border-radius: 999px; background: color-mix(in srgb, var(--accent) 78%, var(--cyan)); transition: height 65ms linear, background .15s; }
  .vr-bar:nth-child(4n + 1) { background: var(--accent); }
  .vr-bar:nth-child(4n + 3) { background: var(--green); }
  .vr-bars[data-phase="paused"] .vr-bar { background: var(--yellow); }
  .vr-bars[data-phase="idle"] .vr-bar, .vr-bars[data-phase="preview"] .vr-bar { background: var(--border-strong); }
  .vr-status { font-size: calc(12px * var(--ui-scale, 1)); color: var(--text-muted); text-align: center; }
  .vr-status code { font-size: .92em; color: var(--text); }
  .vr-preview-audio { width: 100%; height: 36px; border-radius: var(--radius); }
  .vr-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
  .vr-actions-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
</style>
