// The weather in Today's greeting: two chips — the sky, the temperature and the place; sunrise, sunset and the daylight left —
// from this plugin's helper (`now`, Open-Meteo: the words and the icon of the sky), asked again every half hour.
const EVERY = 30 * 60 * 1000;

/** "18:05" today → minutes from now (negative once past). */
const minutesTo = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  const at = new Date(); at.setHours(h, m, 0, 0);
  return Math.round((at.getTime() - Date.now()) / 60000);
};
const span = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`);

export function register(kandinsky) {
  if (!kandinsky.shell.greetingItem) return; // an older Kandinsky
  const es = String(kandinsky.plugin.settings.language ?? "en") === "es";
  const sunIcon = (day) => (kandinsky.version >= 21 ? (day ? "sun" : "moon") : day ? "🌅" : "🌙"); // app icons since API 21
  const now = kandinsky.shell.greetingItem({ id: "now", text: "…", icon: "🌡", order: 10, title: es ? "El tiempo" : "The weather" });
  const sun = kandinsky.shell.greetingItem({ id: "sun", text: "", icon: sunIcon(true), order: 11 });
  sun.remove(); // shown once the times are known

  let sunChip = null;
  async function refresh() {
    let w;
    try { w = await kandinsky.helper.call("now", { settings: kandinsky.plugin.settings }, { timeout: 30 }); }
    catch { now.set(es ? "sin datos del tiempo" : "no weather", es ? "El servicio del tiempo no respondió" : "The weather service did not answer"); return; }
    const place = [w.city, w.country].filter(Boolean).join(", ");
    const text = [w.temperature, w.city].filter(Boolean).join(" · ");
    const detail = [w.condition, w.min && w.max && `${w.min} / ${w.max}`, w.feels_like && `${es ? "sensación" : "feels"} ${w.feels_like}`, w.humidity, w.wind, w.rain].filter(Boolean).join(" · ");
    now.remove();
    kandinsky.shell.greetingItem({ id: "now", text: text || (es ? "el tiempo" : "weather"), icon: w.icon ?? "🌡", order: 10, title: `${place}\n${detail}` });
    if (w.sunrise && w.sunset) {
      const left = minutesTo(w.sunset);
      const light = left > 0 ? ` · ${span(left)} ${es ? "de luz" : "of light"}` : "";
      sunChip?.remove();
      sunChip = kandinsky.shell.greetingItem({ id: "sun", text: `↑${w.sunrise} ↓${w.sunset}${light}`, icon: sunIcon(left > 0), order: 11,
        title: es ? "Salida y puesta del sol" : "Sunrise and sunset" });
    }
  }
  void refresh();
  // today's log gets its weather once it is there (not only after a capture)
  void kandinsky.helper.call("fill_today", { settings: kandinsky.plugin.settings }, { timeout: 30 }).catch(() => {});
  const t = setInterval(refresh, EVERY);
  return () => clearInterval(t);
}
