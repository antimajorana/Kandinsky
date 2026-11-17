<script lang="ts">
  // Nootion Weather widget: live Open-Meteo geocoding + forecast (3.5s AbortController, zero uncaught
  // rejections), inline city switcher, Bauhaus weather glyphs, and calm Local Daylight & Sky fallback.
  import { onMount } from "svelte";
  import * as prefs from "../../lib/prefs";

  type Glyph = "sun" | "partly" | "cloudy" | "rain" | "snow" | "storm";
  type WeatherError = "" | "not_found" | "timeout" | "api" | "network";
  interface Forecast { place: string; tempC: number; highC: number; lowC: number; code: number; windKmh: number }
  interface StoredCity { base: string; val: string }

  const CITY_KEY = "kandinsky.weather.city.v1";
  let cachedCustomCity: StoredCity | null = prefs.load<StoredCity | null>(CITY_KEY, null);

  let { options = {} }: { options?: Record<string, unknown> } = $props();

  const optCity = $derived(typeof options.city === "string" ? options.city.trim() : "");
  const units = $derived(options.units === "F" ? "F" : "C");
  const liveFetch = $derived(options.live_fetch !== false && options.live_fetch !== "false");

  let customCity = $state<StoredCity | null>(cachedCustomCity);
  const activeCity = $derived(customCity && customCity.base === optCity ? customCity.val : optCity);

  let editingCity = $state(false);
  let cityDraft = $state("");
  let now = $state(new Date());
  let online = $state(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  let forecast = $state<Forecast | null>(null);
  let loading = $state(false);
  let fetchErr = $state<WeatherError>("");

  onMount(() => {
    const syncNet = () => { online = navigator.onLine !== false; };
    window.addEventListener("online", syncNet);
    window.addEventListener("offline", syncNet);
    const id = setInterval(() => { now = new Date(); }, 60_000);
    return () => {
      window.removeEventListener("online", syncNet);
      window.removeEventListener("offline", syncNet);
      clearInterval(id);
    };
  });

  $effect(() => {
    const q = activeCity;
    if (!q || !liveFetch || !online || typeof fetch === "undefined") {
      forecast = null;
      loading = false;
      fetchErr = q && liveFetch && online && typeof fetch === "undefined" ? "api" : "";
      return;
    }
    let cancelled = false;
    let timedOut = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      try { ctrl.abort(); } catch { /* ignore */ }
    }, 3500);
    loading = true;
    fetchErr = "";
    void (async () => {
      try {
        const gRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`,
          { signal: ctrl.signal },
        );
        if (!gRes.ok) {
          if (!cancelled) { forecast = null; fetchErr = "api"; }
          return;
        }
        const gData = (await gRes.json()) as { results?: { name: string; country_code?: string; latitude: number; longitude: number }[] };
        const loc = gData.results?.[0];
        if (!loc) {
          if (!cancelled) { forecast = null; fetchErr = "not_found"; }
          return;
        }
        const fRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`,
          { signal: ctrl.signal },
        );
        if (!fRes.ok) {
          if (!cancelled) { forecast = null; fetchErr = "api"; }
          return;
        }
        const fData = (await fRes.json()) as {
          current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
          daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
        };
        const c = fData.current?.temperature_2m;
        if (cancelled) return;
        if (typeof c !== "number") {
          forecast = null;
          fetchErr = "api";
          return;
        }
        forecast = {
          place: loc.country_code ? `${loc.name}, ${loc.country_code}` : loc.name,
          tempC: c,
          highC: fData.daily?.temperature_2m_max?.[0] ?? c,
          lowC: fData.daily?.temperature_2m_min?.[0] ?? c,
          code: fData.current?.weather_code ?? 0,
          windKmh: fData.current?.wind_speed_10m ?? 0,
        };
        fetchErr = "";
      } catch {
        if (cancelled) return;
        forecast = null;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          online = false;
          fetchErr = "";
        } else {
          fetchErr = timedOut ? "timeout" : "network";
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { ctrl.abort(); } catch { /* ignore */ }
    };
  });

  const fmtT = (c: number): number => Math.round(units === "F" ? (c * 9) / 5 + 32 : c);
  function wxMeta(code: number): { glyph: Glyph; label: string } {
    if (code >= 95) return { glyph: "storm", label: "Thunderstorm" };
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { glyph: "snow", label: "Snow" };
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { glyph: "rain", label: code >= 61 || code >= 80 ? "Rain" : "Light drizzle" };
    if (code === 3 || code === 45 || code === 48) return { glyph: "cloudy", label: code >= 45 ? "Mist & fog" : "Cloudy" };
    if (code === 1 || code === 2) return { glyph: "partly", label: "Partly cloudy" };
    return { glyph: "sun", label: "Clear sky" };
  }

  const sky = $derived.by(() => {
    const hrs = now.getHours() + now.getMinutes() / 60;
    const isDay = hrs >= 6 && hrs <= 20;
    const prog = Math.min(1, Math.max(0, isDay ? (hrs - 6) / 14 : (hrs > 20 ? hrs - 20 : hrs + 4) / 10));
    const th = Math.PI * (1 - prog);
    const sx = 84 + 64 * Math.cos(th), sy = 52 - 38 * Math.sin(th);
    const tod = hrs < 5 ? "Deep night" : hrs < 7 ? "Dawn" : hrs < 12 ? "Morning" : hrs < 14 ? "Solar noon" : hrs < 17.5 ? "Afternoon" : hrs <= 20 ? "Golden hour" : "Night sky";
    const mo = now.getMonth();
    const season = mo >= 2 && mo <= 4 ? "Spring" : mo >= 5 && mo <= 7 ? "Summer" : mo >= 8 && mo <= 10 ? "Autumn" : "Winter";
    const dateStr = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const pill = !activeCity
      ? (!online ? "Offline · Set city for live forecast" : "Set city…")
      : !liveFetch
        ? `${activeCity} · Live fetch off`
        : !online
          ? `Offline · ${activeCity}`
          : loading
            ? `Checking ${activeCity}…`
            : fetchErr === "not_found"
              ? `City not found · ${activeCity}`
              : fetchErr === "timeout"
                ? `Forecast timed out · ${activeCity}`
                : fetchErr === "api" || fetchErr === "network"
                  ? `Forecast unavailable · ${activeCity}`
                  : `Checking ${activeCity}…`;
    return { isDay, prog, sx, sy, tod, season, dateStr, pill };
  });

  function focusEl(el: HTMLInputElement) { el.focus(); el.select(); }
  function openCityEdit(): void { cityDraft = activeCity; editingCity = true; }
  function saveCity(): void {
    editingCity = false;
    const val = cityDraft.trim();
    const next = val ? { base: optCity, val } : null;
    customCity = next;
    cachedCustomCity = next;
    if (next) prefs.save(CITY_KEY, next);
    else prefs.drop(CITY_KEY);
  }
</script>

<div class="widget">
  {#if editingCity}
    <form class="city-form" onsubmit={(e) => { e.preventDefault(); saveCity(); }}>
      <input type="text" class="city-in" placeholder="City (e.g. Zurich, Paris, Tokyo)…" aria-label="City name"
        use:focusEl bind:value={cityDraft}
        onkeydown={(e) => { if (e.key === "Escape") { e.preventDefault(); editingCity = false; } }} />
      <button type="submit" class="pill-btn save">Apply</button>
      <button type="button" class="pill-btn" onclick={() => (editingCity = false)}>Cancel</button>
    </form>
  {/if}

  {#if forecast}
    {@const wx = wxMeta(forecast.code)}
    <div class="live-row">
      <div class="wx-left">
        <svg viewBox="0 0 36 36" class="wx-icon" aria-hidden="true">
          {#if wx.glyph === "sun"}
            <circle cx="18" cy="18" r="7.5" fill="var(--yellow)" />
            <g stroke="var(--yellow)" stroke-width="2" stroke-linecap="round">
              <path d="M18 4v3.5M18 28.5V32M4 18h3.5M28.5 18H32M8.1 8.1l2.5 2.5M25.4 25.4l2.5 2.5M27.9 8.1l-2.5 2.5M10.6 25.4l-2.5 2.5" />
            </g>
          {:else if wx.glyph === "partly"}
            <circle cx="13" cy="13" r="5.5" fill="var(--yellow)" />
            <path d="M13 4.5v2M5 13h2M7.3 7.3l1.4 1.4M18.7 7.3l-1.4 1.4" stroke="var(--yellow)" stroke-width="1.8" stroke-linecap="round" />
            <path d="M12 26.5h13.5a5 5 0 0 0 .6-10A7 7 0 0 0 12.6 15a4.8 4.8 0 0 0-.6 9.5z" fill="var(--bg-elev)" stroke="var(--text-muted)" stroke-width="1.8" stroke-linejoin="round" />
          {:else if wx.glyph === "cloudy"}
            <path d="M10.5 26h15a5.5 5.5 0 0 0 .7-10.9A7.5 7.5 0 0 0 11.4 14a5.2 5.2 0 0 0-.9 12z" fill="var(--bg-elev)" stroke="var(--text-muted)" stroke-width="1.9" stroke-linejoin="round" />
          {:else if wx.glyph === "rain"}
            <path d="M10.5 22h15a5 5 0 0 0 .6-10A7 7 0 0 0 11.4 11a4.8 4.8 0 0 0-.9 11z" fill="var(--bg-elev)" stroke="var(--text-muted)" stroke-width="1.8" />
            <path d="M13 25.5l-1.5 4.5M18.5 25.5L17 30M24 25.5L22.5 30" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" />
          {:else if wx.glyph === "snow"}
            <path d="M10.5 22h15a5 5 0 0 0 .6-10A7 7 0 0 0 11.4 11a4.8 4.8 0 0 0-.9 11z" fill="var(--bg-elev)" stroke="var(--text-muted)" stroke-width="1.8" />
            <g fill="var(--purple)"><circle cx="13" cy="27.5" r="1.6" /><circle cx="18.5" cy="29" r="1.6" /><circle cx="24" cy="27.5" r="1.6" /></g>
          {:else}
            <path d="M10.5 21.5h15a5 5 0 0 0 .6-10A7 7 0 0 0 11.4 10.5a4.8 4.8 0 0 0-.9 11z" fill="var(--bg-elev)" stroke="var(--text-muted)" stroke-width="1.8" />
            <path d="M19.5 22.5l-3 4.5h3.5l-2.5 5" fill="none" stroke="var(--orange)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          {/if}
        </svg>
        <div>
          <div class="temp">{fmtT(forecast.tempC)}°{units}</div>
          <div class="wx-desc">{wx.label}</div>
        </div>
      </div>
      <div class="wx-right">
        <button type="button" class="pill-btn" onclick={openCityEdit} title="Change city">{forecast.place}</button>
        <div class="hi-lo">H {fmtT(forecast.highC)}° · L {fmtT(forecast.lowC)}°</div>
        <div class="wind">{Math.round(units === "F" ? forecast.windKmh * 0.621 : forecast.windKmh)} {units === "F" ? "mph" : "km/h"}</div>
      </div>
    </div>
  {:else}
    <div class="sky-card">
      <div class="sky-info">
        <span class="sky-kicker">Local Daylight &amp; Sky</span>
        <div class="sky-phase">{sky.tod} · {sky.season}</div>
        <div class="sky-date">{sky.dateStr}</div>
        <button type="button" class="pill-btn" class:is-error={Boolean(fetchErr) && online} onclick={openCityEdit}>{sky.pill}</button>
      </div>
      <svg viewBox="0 0 168 68" class="sky-arc" role="img" aria-label="{sky.tod}, {sky.season}">
        <line x1="12" y1="52" x2="156" y2="52" stroke="var(--border-strong)" stroke-width="1" />
        <path d="M 20 52 A 64 38 0 0 1 148 52" fill="none" stroke="var(--border-strong)" stroke-width="1.4" stroke-dasharray="3 3" />
        {#if sky.prog > 0.01}
          <path d="M 20 52 A 64 38 0 0 1 {sky.sx.toFixed(1)} {sky.sy.toFixed(1)}" fill="none"
            stroke={sky.isDay ? "var(--yellow)" : "var(--purple)"} stroke-width="2.2" stroke-linecap="round" />
        {/if}
        <circle cx={sky.sx} cy={sky.sy} r="9.5" fill={sky.isDay ? "var(--yellow)" : "var(--purple)"} opacity="0.18" />
        <circle cx={sky.sx} cy={sky.sy} r="4.8" fill={sky.isDay ? "var(--yellow)" : "var(--purple)"} />
        <text x="20" y="64" class="arc-lbl" text-anchor="middle">06:00</text>
        <text x="148" y="64" class="arc-lbl" text-anchor="middle">20:00</text>
      </svg>
    </div>
  {/if}
</div>

<style>
  .widget {
    display: flex; flex-direction: column; gap: 10px; font-family: var(--font-ui); color: var(--text);
    background: var(--bg-alt); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px;
  }
  :global(.pb.card) .widget { background: none; border: 0; border-radius: 0; padding: 0; }
  .city-form { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .city-in { flex: 1; min-width: 140px; height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--text); font: inherit; font-size: 12.5px; outline: none; }
  .city-in:focus { border-color: var(--accent); }
  .pill-btn { align-self: flex-start; padding: 3px 9px; border-radius: 99px; border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text-muted); font-size: 11.5px; font-weight: 500; cursor: pointer; transition: border-color 120ms, color 120ms; }
  .pill-btn:hover { border-color: var(--accent); color: var(--heading); }
  .pill-btn.is-error { border-color: color-mix(in srgb, var(--yellow) 55%, var(--border-strong)); color: var(--text); }
  .pill-btn.save { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
  :global(html.phone) .pill-btn, :global(html.phone) .city-in { min-height: 40px; }
  .live-row, .sky-card { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  .wx-left { display: flex; align-items: center; gap: 12px; }
  .wx-icon { width: 42px; height: 42px; flex: none; }
  .temp { font-family: var(--font-mono); font-size: 26px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--heading); line-height: 1.05; }
  .wx-desc { font-size: 12.5px; color: var(--text-muted); margin-top: 2px; }
  .wx-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; margin-left: auto; }
  .hi-lo, .wind { font-family: var(--font-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--text-faint); }
  .sky-info { display: flex; flex-direction: column; gap: 3px; min-width: 140px; }
  .sky-kicker { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-faint); }
  .sky-phase { font-size: 15px; font-weight: 650; color: var(--heading); letter-spacing: -0.01em; }
  .sky-date { font-size: 12px; color: var(--text-muted); margin-bottom: 3px; }
  .sky-arc { width: 164px; height: 66px; flex: none; margin-left: auto; }
  .arc-lbl { font-family: var(--font-mono); font-size: 8.5px; fill: var(--text-faint); }
</style>
