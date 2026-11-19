<script lang="ts">
  // Notion-style Clock widget: Bauhaus Several Circles SVG analog face (12 ticks, geometric hour/minute
  // hands, vermilion second hand & pivot) paired with a tabular digital readout and IANA timezone support.
  import { onMount } from "svelte";

  type ClockStyle = "both" | "digital" | "analog";

  let { options = {} }: { options?: Record<string, unknown> } = $props();

  let now = $state(new Date());

  onMount(() => {
    const id = setInterval(() => { now = new Date(); }, 1000);
    return () => clearInterval(id);
  });

  const faceStyle = $derived.by((): ClockStyle => {
    const s = typeof options.style === "string" ? options.style.trim() : "";
    return s === "digital" || s === "analog" ? s : "both";
  });
  const format24 = $derived(options.format_24h !== false && options.format_24h !== "false");
  const showSeconds = $derived(options.seconds !== false && options.seconds !== "false");
  const caption = $derived(typeof options.label === "string" ? options.label.trim() : "");

  const clock = $derived.by(() => {
    const rawTz = typeof options.timezone === "string" ? options.timezone.trim() : "";
    let validTz: string | undefined = undefined;
    if (rawTz) {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: rawTz });
        validTz = rawTz;
      } catch {
        validTz = undefined;
      }
    }

    let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    if (validTz) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: validTz, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
        }).formatToParts(now);
        const part = (k: string, fb: number) => Number(parts.find((p) => p.type === k)?.value ?? fb);
        h = part("hour", h) % 24;
        m = part("minute", m);
        s = part("second", s);
      } catch {
        /* fallback to local time */
      }
    }

    const ampm = h >= 12 ? "PM" : "AM";
    const hh = format24 ? String(h).padStart(2, "0") : String(h % 12 || 12);
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");

    let dateLine = "";
    try {
      dateLine = new Intl.DateTimeFormat(undefined, {
        ...(validTz ? { timeZone: validTz } : {}),
        weekday: "long", month: "short", day: "numeric",
      }).format(now);
    } catch {
      dateLine = now.toDateString();
    }

    let zoneLabel = validTz ? validTz.replace(/_/g, " ") : "";
    if (!zoneLabel) {
      try {
        const local = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
        zoneLabel = local ? local.split("/").pop()!.replace(/_/g, " ") : "Local";
      } catch {
        zoneLabel = "Local";
      }
    }

    return {
      hm: `${hh}:${mm}`,
      ss,
      ampm,
      dateLine,
      zoneLabel,
      hourDeg: ((h % 12) + m / 60 + s / 3600) * 30,
      minDeg: (m + s / 60) * 6,
      secDeg: s * 6,
    };
  });
</script>

<div class="widget" class:analog-only={faceStyle === "analog"}>
  {#if faceStyle === "both" || faceStyle === "analog"}
    <div class="dial-wrap" class:large={faceStyle === "analog"}>
      <svg viewBox="0 0 100 100" class="dial" role="img" aria-label="Analog clock: {clock.hm}">
        <circle cx="50" cy="50" r="46" fill="var(--bg-elev)" stroke="var(--border-strong)" stroke-width="1.5" />
        <circle cx="38" cy="37" r="14" fill="var(--accent-soft)" />
        <circle cx="50" cy="50" r="33" fill="none" stroke="var(--border)" stroke-width="0.9" />
        {#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
          <line
            x1="50"
            y1={i % 3 === 0 ? 8.5 : 9.5}
            x2="50"
            y2={i % 3 === 0 ? 15 : 13}
            stroke={i === 0 ? "var(--accent)" : i % 3 === 0 ? "var(--text-muted)" : "var(--text-faint)"}
            stroke-width={i % 3 === 0 ? 1.8 : 1.1}
            stroke-linecap="round"
            transform="rotate({i * 30} 50 50)"
          />
        {/each}
        <line
          x1="50" y1="53.5" x2="50" y2="26.5"
          stroke="var(--heading)" stroke-width="2.6" stroke-linecap="round"
          transform="rotate({clock.hourDeg} 50 50)"
        />
        <line
          x1="50" y1="55.5" x2="50" y2="16.5"
          stroke="var(--heading)" stroke-width="1.8" stroke-linecap="round"
          transform="rotate({clock.minDeg} 50 50)"
        />
        {#if showSeconds}
          <line
            x1="50" y1="58.5" x2="50" y2="13.5"
            stroke="var(--red)" stroke-width="1.15" stroke-linecap="round"
            transform="rotate({clock.secDeg} 50 50)"
          />
        {/if}
        <circle cx="50" cy="50" r="2.8" fill="var(--red)" />
        <circle cx="50" cy="50" r="1" fill="var(--bg-elev)" />
      </svg>
    </div>
  {/if}

  {#if faceStyle === "both" || faceStyle === "digital"}
    <div class="digital">
      {#if caption}<div class="cap">{caption}</div>{/if}
      <div class="digits">
        <span class="hm">{clock.hm}</span>{#if showSeconds}<span class="ss">:{clock.ss}</span>{/if}
        {#if !format24}<span class="ampm">{clock.ampm}</span>{/if}
      </div>
      <div class="meta">
        <span>{clock.dateLine}</span>
        <span class="sep">·</span>
        <span class="zone">{clock.zoneLabel}</span>
      </div>
    </div>
  {:else}
    <div class="analog-meta">
      {#if caption}<span class="cap">{caption}</span>{/if}
      <span class="meta-line">{clock.dateLine} · {clock.zoneLabel}</span>
    </div>
  {/if}
</div>

<style>
  .widget {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-family: var(--font-ui); color: var(--text);
    background: var(--bg-alt); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px;
  }
  :global(.pb.card) .widget { background: none; border: 0; border-radius: 0; padding: 0; }
  .widget.analog-only { flex-direction: column; justify-content: center; gap: 10px; }
  .dial-wrap { width: 88px; height: 88px; flex: none; }
  .dial-wrap.large { width: 112px; height: 112px; }
  .dial { width: 100%; height: 100%; display: block; }
  .digital { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .cap { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); }
  .digits { display: flex; align-items: baseline; font-family: var(--font-mono); font-variant-numeric: tabular-nums; line-height: 1.05; }
  .hm { font-size: 29px; font-weight: 700; letter-spacing: -0.025em; color: var(--heading); }
  .ss { font-size: 18px; font-weight: 500; color: var(--text-muted); margin-left: 1px; }
  .ampm { font-family: var(--font-ui); font-size: 11.5px; font-weight: 600; color: var(--text-muted); margin-left: 6px; padding: 1px 5px; border-radius: 4px; background: var(--bg-elev); border: 1px solid var(--border); }
  .meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; color: var(--text-muted); margin-top: 2px; }
  .sep { color: var(--text-faint); }
  .zone { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-faint); }
  .analog-meta { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }
  .meta-line { font-size: 12px; color: var(--text-muted); }
</style>
