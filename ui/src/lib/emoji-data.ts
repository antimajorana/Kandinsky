// Curated searchable emoji & Bauhaus/physics/math emblem catalog for page icons,
// plus persistent recently-used icons in localStorage ("kandinsky.recent-icons").

export type EmojiCategoryId =
  | "recent"
  | "pages"
  | "science"
  | "objects"
  | "symbols"
  | "nature"
  | "people";

export type EmojiStaticCategoryId = Exclude<EmojiCategoryId, "recent">;

export interface EmojiCategoryMeta {
  id: EmojiCategoryId;
  label: string;
}

export interface EmojiEntry {
  icon: string;
  name: string;
  keywords: string[];
  category: EmojiStaticCategoryId;
}

export const RECENT_ICONS_KEY = "kandinsky.recent-icons";
export const MAX_RECENT_ICONS = 18;

export const EMOJI_CATEGORIES: readonly EmojiCategoryMeta[] = [
  { id: "recent", label: "Recent" },
  { id: "symbols", label: "Symbols & Bauhaus" },
  { id: "pages", label: "Pages & Work" },
  { id: "science", label: "Science & Math" },
  { id: "objects", label: "Objects & Tools" },
  { id: "nature", label: "Nature" },
  { id: "people", label: "People" },
] as const;

type RawEmojiTuple = [icon: string, name: string, keywords: string];

function pack(category: EmojiStaticCategoryId, rows: readonly RawEmojiTuple[]): EmojiEntry[] {
  return rows.map(([icon, name, kw]) => ({
    icon,
    name,
    keywords: kw ? kw.split(/\s+/) : [],
    category,
  }));
}

// 18 core Bauhaus/physics/math geometric emblems + clean geometric/typographic symbols
const SYMBOLS_RAW: readonly RawEmojiTuple[] = [
  ["◎", "Bullseye emblem", "bauhaus circle target kandinsky emblem default"],
  ["●", "Filled circle", "bauhaus dot disc point circle geometric"],
  ["▲", "Filled triangle", "bauhaus warning delta triangle geometric"],
  ["■", "Filled square", "bauhaus box cube block square geometric"],
  ["◆", "Filled diamond", "bauhaus gem rhombus diamond geometric"],
  ["✦", "Four-point star", "bauhaus sparkle idea star emblem"],
  ["○", "Open circle", "ring hollow circle geometric"],
  ["□", "Open square", "box hollow square geometric"],
  ["△", "Open triangle", "delta hollow triangle geometric"],
  ["◇", "Open diamond", "rhombus hollow diamond geometric"],
  ["★", "Solid star", "favorite bookmark rating star"],
  ["☆", "Outline star", "star wish rating outline"],
  ["❖", "Diamond ornament", "four diamonds bauhaus tile ornament"],
  ["※", "Reference mark", "note footnote reference kome"],
  ["⌘", "Command loop", "key shortcut mac command"],
  ["✓", "Check mark", "done tick ok check"],
  ["✕", "Cross mark", "close cancel delete multiply"],
  ["→", "Right arrow", "next forward implies arrow"],
  ["←", "Left arrow", "back previous arrow"],
  ["↔", "Double arrow", "bidirectional equivalence link arrow"],
  ["⇒", "Implies arrow", "logic implies double arrow"],
  ["⇔", "If and only if", "iff logic equivalence arrow"],
  ["§", "Section sign", "law clause section"],
  ["¶", "Pilcrow", "paragraph mark text"],
  ["†", "Dagger", "footnote note cross"],
  ["•", "Bullet", "dot point item"],
  ["♾️", "Infinity badge", "endless eternal loop"],
  ["⭐", "Yellow star", "favorite highlight featured star"],
  ["🌟", "Glowing star", "shine special highlight star"],
  ["✨", "Sparkles", "magic clean new polish ai"],
  ["⚡", "High voltage", "fast energy lightning bolt"],
  ["🔥", "Fire", "hot flame trending urgent"],
  ["❄️", "Snowflake", "cold freeze winter ice"],
  ["❗", "Exclamation", "alert important warning"],
  ["❓", "Question mark", "help unknown question"],
  ["⭕", "Hollow red circle", "ring target circle"],
  ["❌", "Red cross", "error fail wrong no"],
  ["✅", "Green check", "done complete verified yes"],
  ["☑️", "Check box", "task todo done box"],
  ["🔴", "Red circle", "vermilion dot red"],
  ["🟠", "Orange circle", "amber dot orange"],
  ["🟡", "Yellow circle", "ochre dot yellow"],
  ["🟢", "Green circle", "viridian dot green"],
  ["🔵", "Blue circle", "cobalt dot blue"],
  ["🟣", "Purple circle", "mauve dot purple"],
  ["⚫", "Black circle", "dark dot black"],
  ["⚪", "White circle", "light dot white"],
];

const SCIENCE_RAW: readonly RawEmojiTuple[] = [
  ["∑", "Summation", "sigma sum series math"],
  ["∫", "Integral", "calculus integral math"],
  ["∂", "Partial derivative", "del partial calculus math"],
  ["∇", "Nabla gradient", "del divergence curl gradient math physics"],
  ["⊗", "Tensor product", "otimes cross product quantum math"],
  ["⊕", "Direct sum", "oplus xor quantum math"],
  ["ℏ", "Reduced Planck", "hbar quantum mechanics physics"],
  ["λ", "Lambda", "wavelength eigenvalue function lambda physics"],
  ["Ω", "Omega", "ohm solid angle omega physics math"],
  ["Φ", "Phi", "flux golden ratio phase phi physics"],
  ["Ψ", "Psi", "wavefunction state psi quantum physics"],
  ["∞", "Infinity", "limit endless infinity math"],
  ["π", "Pi", "circle ratio pi math"],
  ["α", "Alpha", "fine structure angle alpha greek"],
  ["β", "Beta", "decay coefficient beta greek"],
  ["γ", "Gamma", "photon lorentz gamma greek"],
  ["δ", "Delta small", "variation dirac delta greek"],
  ["ε", "Epsilon", "permittivity small error epsilon greek"],
  ["θ", "Theta", "angle phase theta greek"],
  ["μ", "Mu", "chemical potential micro mean mu greek"],
  ["σ", "Sigma", "standard deviation cross section pauli greek"],
  ["τ", "Tau", "proper time torque tau greek"],
  ["Δ", "Delta capital", "change difference laplacian delta math"],
  ["Π", "Product capital", "pi product math"],
  ["∈", "Element of", "member set logic math"],
  ["⊂", "Subset of", "set inclusion math"],
  ["∀", "For all", "universal quantifier logic math"],
  ["∃", "There exists", "existential quantifier logic math"],
  ["≈", "Approximately", "approx estimate math"],
  ["≠", "Not equal", "inequality math"],
  ["≤", "Less or equal", "inequality bound math"],
  ["≥", "Greater or equal", "inequality bound math"],
  ["√", "Square root", "radical root math"],
  ["∝", "Proportional to", "scaling relation math"],
  ["ℝ", "Real numbers", "reals set blackboard math"],
  ["ℂ", "Complex numbers", "complex plane blackboard math"],
  ["ℤ", "Integers", "integer ring blackboard math"],
  ["🔬", "Microscope", "lab biology research science"],
  ["🔭", "Telescope", "astronomy space observation science"],
  ["🧪", "Test tube", "chemistry experiment lab science"],
  ["🧫", "Petri dish", "culture biology lab"],
  ["🧬", "DNA double helix", "genetics genome biology"],
  ["⚛️", "Atom symbol", "physics nuclear quantum science"],
  ["🧲", "Magnet", "magnetic field physics"],
  ["📡", "Satellite dish", "signal antenna radio telemetry"],
  ["🛰️", "Satellite", "orbit space astrophysics"],
  ["🧮", "Abacus", "calculate count arithmetic math"],
  ["📐", "Triangular ruler", "geometry angle engineering math"],
  ["📏", "Straight ruler", "measure length scale"],
  ["📊", "Bar chart", "data plot statistics metrics"],
  ["📈", "Chart increasing", "growth trend plot graph"],
  ["📉", "Chart decreasing", "decay decline plot graph"],
  ["💡", "Light bulb", "idea insight hypothesis"],
  ["🔋", "Battery", "power energy charge"],
  ["🌡️", "Thermometer", "temperature heat thermodynamics"],
  ["🩺", "Stethoscope", "medicine health diagnosis"],
  ["💊", "Pill", "pharma medicine capsule"],
  ["🩻", "X-ray", "scan imaging physics medicine"],
  ["🌌", "Milky way", "galaxy cosmos universe space"],
  ["🪐", "Ringed planet", "saturn astronomy planet"],
  ["☄️", "Comet", "asteroid space astronomy"],
  ["🌑", "New moon", "phase eclipse lunar"],
  ["🌕", "Full moon", "lunar night sky"],
];

const PAGES_RAW: readonly RawEmojiTuple[] = [
  ["📄", "Page facing up", "document note file page"],
  ["📝", "Memo", "draft write note edit"],
  ["📖", "Open book", "read guide manual literature"],
  ["📚", "Books", "library reading references bibliography"],
  ["📓", "Notebook", "journal diary lab notebook"],
  ["📔", "Decorated notebook", "journal cover notebook"],
  ["📒", "Ledger", "accounts log notes"],
  ["📕", "Closed red book", "book manual"],
  ["📗", "Green book", "book reference"],
  ["📘", "Blue book", "book textbook"],
  ["📙", "Orange book", "book guide"],
  ["📑", "Bookmark tabs", "index sections tabs"],
  ["🔖", "Bookmark", "save pin reading"],
  ["🗂️", "Card index dividers", "archive folder organize index"],
  ["📁", "Folder", "directory collection"],
  ["📂", "Open folder", "directory workspace"],
  ["🗃️", "Card file box", "database archive records"],
  ["🗄️", "File cabinet", "storage archive"],
  ["📋", "Clipboard", "checklist tasks plan"],
  ["📌", "Pushpin", "pin important sticky"],
  ["📍", "Round pushpin", "location pin marker"],
  ["📎", "Paperclip", "attachment file link"],
  ["✏️", "Pencil", "write edit draft"],
  ["✒️", "Black nib", "pen ink writing"],
  ["🖋️", "Fountain pen", "author essay manuscript"],
  ["🖊️", "Pen", "sign write ballpoint"],
  ["🖌️", "Paintbrush", "art design style"],
  ["📅", "Calendar", "date schedule event"],
  ["📆", "Tear-off calendar", "daily day log"],
  ["🗓️", "Spiral calendar", "planner roadmap month"],
  ["🗒️", "Spiral notepad", "scratchpad notes"],
  ["🏷️", "Label", "tag metadata category"],
  ["📥", "Inbox tray", "incoming capture triage"],
  ["📤", "Outbox tray", "export publish send"],
  ["📬", "Open mailbox", "mail newsletter messages"],
  ["📦", "Package", "release bundle crate module"],
  ["💼", "Briefcase", "work project business"],
  ["🏢", "Office building", "organization company work"],
  ["🏛️", "Classical building", "institution museum architecture"],
  ["🎓", "Graduation cap", "study thesis degree university"],
  ["🏆", "Trophy", "award goal milestone win"],
  ["🎯", "Direct hit", "target objective okr goal"],
  ["🚀", "Rocket", "launch deploy release ship"],
  ["⏳", "Hourglass", "pending wait timer"],
  ["⌛", "Hourglass done", "time deadline"],
  ["⏰", "Alarm clock", "reminder schedule time"],
  ["⏱️", "Stopwatch", "benchmark timing sprint"],
  ["📣", "Megaphone", "announcement release update"],
];

const OBJECTS_RAW: readonly RawEmojiTuple[] = [
  ["🔧", "Wrench", "fix tool config repair"],
  ["🔨", "Hammer", "build construct tool"],
  ["🛠️", "Hammer and wrench", "tools engineering dev maintenance"],
  ["⚙️", "Gear", "settings system engine mechanism"],
  ["🔩", "Nut and bolt", "hardware fastener"],
  ["🗜️", "Clamp", "compress tool"],
  ["⚖️", "Balance scale", "law justice compare tradeoff"],
  ["🔗", "Link", "url hyperlink chain reference"],
  ["🧰", "Toolbox", "utilities kit tools"],
  ["🪜", "Ladder", "steps career climb"],
  ["💻", "Laptop", "code computer dev software"],
  ["🖥️", "Desktop computer", "workstation monitor terminal"],
  ["🖨️", "Printer", "print pdf export"],
  ["⌨️", "Keyboard", "typing shortcuts input"],
  ["🖱️", "Computer mouse", "click pointer"],
  ["💾", "Floppy disk", "save backup storage"],
  ["💿", "Optical disk", "media archive data"],
  ["📱", "Mobile phone", "ios android app phone"],
  ["🔌", "Electric plug", "plugin integration power"],
  ["🔦", "Flashlight", "search inspect debug"],
  ["🕯️", "Candle", "focus calm light"],
  ["🔑", "Key", "access secret auth lock"],
  ["🗝️", "Old key", "vault legacy key"],
  ["🔒", "Locked", "private readonly security lock"],
  ["🔓", "Unlocked", "open access unlock"],
  ["🔐", "Locked with key", "encrypted secure"],
  ["🛡️", "Shield", "security defense protection"],
  ["🧭", "Compass", "navigation direction guide"],
  ["🗺️", "World map", "atlas geography plan"],
  ["🔍", "Magnifying glass", "search find inspect"],
  ["📷", "Camera", "photo snapshot image"],
  ["🎥", "Movie camera", "video film record"],
  ["🎬", "Clapper board", "media cinema production"],
  ["📺", "Television", "screen display"],
  ["📻", "Radio", "broadcast audio"],
  ["🎙️", "Studio microphone", "voice podcast audio"],
  ["🎛️", "Control knobs", "mixer parameters tuning"],
  ["🎧", "Headphones", "music audio listen"],
  ["🎵", "Musical note", "music song sound"],
  ["🎶", "Musical notes", "melody audio"],
  ["🎹", "Musical keyboard", "piano synth music"],
  ["🎨", "Artist palette", "color theme design canvas"],
  ["🎭", "Performing arts", "theater drama persona"],
  ["🎮", "Video game", "game controller play"],
  ["🎲", "Game die", "random probability chance"],
  ["🧩", "Puzzle piece", "plugin extension module"],
  ["♟️", "Chess pawn", "strategy game plan"],
  ["✈️", "Airplane", "travel flight trip"],
  ["🚂", "Locomotive", "train transit"],
  ["🚗", "Automobile", "car commute"],
  ["🚲", "Bicycle", "bike ride"],
  ["⛵", "Sailboat", "sail voyage sea"],
  ["⚓", "Anchor", "stable link reference"],
  ["🏠", "House", "home personal"],
  ["🏗️", "Building construction", "architecture wip infra"],
  ["🚦", "Traffic light", "status signal"],
];

const NATURE_RAW: readonly RawEmojiTuple[] = [
  ["🌱", "Seedling", "grow start sprout idea"],
  ["🌿", "Herb", "leaf plant green"],
  ["☘️", "Shamrock", "clover plant"],
  ["🍀", "Four leaf clover", "luck green plant"],
  ["🪴", "Potted plant", "desk plant care"],
  ["🌲", "Evergreen tree", "forest pine nature"],
  ["🌳", "Deciduous tree", "tree park woods"],
  ["🌴", "Palm tree", "vacation tropical"],
  ["🌵", "Cactus", "desert resilient"],
  ["🌷", "Tulip", "flower spring"],
  ["🌸", "Cherry blossom", "sakura flower spring"],
  ["🌹", "Rose", "flower red"],
  ["🌺", "Hibiscus", "flower tropical"],
  ["🌻", "Sunflower", "flower sun yellow"],
  ["🌼", "Blossom", "flower"],
  ["💐", "Bouquet", "flowers gift"],
  ["🍄", "Mushroom", "fungi forest"],
  ["🍁", "Maple leaf", "autumn fall canada"],
  ["🍂", "Fallen leaf", "autumn season"],
  ["🍃", "Leaf fluttering", "wind nature"],
  ["🪨", "Rock", "stone geology"],
  ["⛰️", "Mountain", "peak hike summit"],
  ["🏔️", "Snow-capped mountain", "alps peak"],
  ["🌋", "Volcano", "eruption geology"],
  ["🏕️", "Camping", "tent outdoors"],
  ["🏖️", "Beach", "coast sand sea"],
  ["🏝️", "Desert island", "isolated island"],
  ["🌊", "Water wave", "ocean fluid wave physics"],
  ["💧", "Droplet", "water liquid"],
  ["🫧", "Bubbles", "foam clean"],
  ["☀️", "Sun", "day morning bright light"],
  ["🌤️", "Sun behind cloud", "weather mild"],
  ["⛅", "Partly cloudy", "weather"],
  ["☁️", "Cloud", "sync storage sky"],
  ["🌧️", "Rain cloud", "weather rain"],
  ["⛈️", "Thunderstorm", "storm weather"],
  ["🌈", "Rainbow", "spectrum color optics"],
  ["🦋", "Butterfly", "chaos insect nature"],
  ["🐝", "Honeybee", "bee work nature"],
  ["🐞", "Lady beetle", "bug insect"],
  ["🐢", "Turtle", "slow steady"],
  ["🐙", "Octopus", "ocean tentacles"],
  ["🐬", "Dolphin", "sea smart"],
  ["🐳", "Spouting whale", "ocean docker"],
  ["🦉", "Owl", "wisdom night"],
  ["🦅", "Eagle", "bird flight"],
  ["🦊", "Fox", "animal clever"],
  ["🐺", "Wolf", "pack animal"],
  ["🐱", "Cat", "pet animal"],
  ["🐶", "Dog", "pet animal"],
  ["🐻", "Bear", "animal"],
  ["🐼", "Panda", "animal"],
  ["🦁", "Lion", "animal"],
  ["🦄", "Unicorn", "rare magic"],
  ["🐉", "Dragon", "mythic"],
  ["🍎", "Red apple", "fruit food"],
  ["🍋", "Lemon", "citrus yellow"],
  ["☕", "Hot beverage", "coffee tea morning"],
  ["🍵", "Teacup", "matcha green tea"],
];

const PEOPLE_RAW: readonly RawEmojiTuple[] = [
  ["😀", "Grinning face", "happy smile joy"],
  ["😄", "Smiling eyes", "happy laugh"],
  ["😊", "Smiling face", "warm happy"],
  ["🙂", "Slightly smiling", "calm okay"],
  ["😉", "Winking face", "wink playful"],
  ["😌", "Relieved face", "calm peace"],
  ["😍", "Heart eyes", "love favorite"],
  ["😎", "Sunglasses", "cool confident"],
  ["🤓", "Nerd face", "study geek smart"],
  ["🧐", "Monocle", "inspect review careful"],
  ["🤔", "Thinking face", "ponder question idea"],
  ["🤨", "Raised eyebrow", "skeptical check"],
  ["😮", "Open mouth", "surprise wow"],
  ["🤯", "Exploding head", "mind blown insight"],
  ["🥳", "Partying face", "celebrate launch"],
  ["🤩", "Star-struck", "excited amaze"],
  ["😴", "Sleeping face", "sleep rest"],
  ["🫡", "Saluting face", "respect ack"],
  ["👋", "Waving hand", "hello hi welcome"],
  ["✋", "Raised hand", "stop pause"],
  ["👌", "OK hand", "good fine"],
  ["✌️", "Victory hand", "peace two"],
  ["👍", "Thumbs up", "approve like yes"],
  ["👎", "Thumbs down", "reject no"],
  ["👏", "Clapping hands", "applause bravo"],
  ["🙌", "Raising hands", "celebrate hooray"],
  ["🤝", "Handshake", "agreement partner deal"],
  ["🙏", "Folded hands", "please thanks"],
  ["💪", "Flexed biceps", "strength effort"],
  ["🧠", "Brain", "memory think cognition ai"],
  ["🫀", "Anatomical heart", "biology pulse life"],
  ["👁️", "Eye", "view look watch"],
  ["👀", "Eyes", "review watching look"],
  ["👂", "Ear", "listen audio"],
  ["👤", "Bust in silhouette", "user profile person"],
  ["👥", "Busts in silhouette", "team group people"],
  ["🫂", "People hugging", "support care"],
  ["🗣️", "Speaking head", "talk speech voice"],
  ["🧑‍💻", "Technologist", "developer programmer code"],
  ["👨‍🔬", "Man scientist", "researcher physics lab"],
  ["👩‍🔬", "Woman scientist", "researcher chemistry lab"],
  ["🧑‍🎓", "Student", "study academic learn"],
  ["🧑‍🏫", "Teacher", "lecture mentor teach"],
  ["🧑‍🎨", "Artist", "design painter creative"],
  ["🧑‍🚀", "Astronaut", "space explorer"],
  ["🧙", "Mage", "wizard magic"],
  ["🤖", "Robot", "bot agent ai automation"],
  ["👾", "Alien monster", "retro arcade"],
  ["👻", "Ghost", "spooky hidden"],
  ["💀", "Skull", "dead legacy deprecated"],
  ["❤️", "Red heart", "love favorite"],
  ["🧡", "Orange heart", "warmth"],
  ["💛", "Yellow heart", "ochre"],
  ["💚", "Green heart", "viridian"],
  ["💙", "Blue heart", "cobalt"],
  ["💜", "Purple heart", "mauve"],
  ["🖤", "Black heart", "dark"],
  ["🤍", "White heart", "pure"],
  ["💯", "Hundred points", "perfect score 100"],
  ["💬", "Speech balloon", "comment chat discussion"],
  ["💭", "Thought balloon", "idea reflection"],
];

function buildCatalog(): EmojiEntry[] {
  const all = [
    ...pack("symbols", SYMBOLS_RAW),
    ...pack("science", SCIENCE_RAW),
    ...pack("pages", PAGES_RAW),
    ...pack("objects", OBJECTS_RAW),
    ...pack("nature", NATURE_RAW),
    ...pack("people", PEOPLE_RAW),
  ];
  const seen = new Set<string>();
  const out: EmojiEntry[] = [];
  for (const item of all) {
    if (seen.has(item.icon)) continue;
    seen.add(item.icon);
    out.push(item);
  }
  return out;
}

export const EMOJI_CATALOG: readonly EmojiEntry[] = buildCatalog();

const CATALOG_BY_ICON = new Map<string, EmojiEntry>(
  EMOJI_CATALOG.map((e) => [e.icon, e]),
);

export function lookupEmojiEntry(icon: string): EmojiEntry | undefined {
  return CATALOG_BY_ICON.get(icon);
}

export function searchEmojiIcons(query: string): EmojiEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...EMOJI_CATALOG];
  return EMOJI_CATALOG.filter((entry) => {
    const haystack = `${entry.icon} ${entry.name.toLowerCase()} ${entry.keywords.join(" ")}`;
    return terms.every((t) => haystack.includes(t));
  });
}

export function randomEmojiIcon(): string {
  const idx = Math.floor(Math.random() * EMOJI_CATALOG.length);
  return EMOJI_CATALOG[idx]?.icon ?? "◎";
}

export function getRecentIcons(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_ICONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (!trimmed || trimmed.toLowerCase() === "none" || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= MAX_RECENT_ICONS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function pushRecentIcon(icon: string): string[] {
  const trimmed = icon.trim();
  if (!trimmed || trimmed.toLowerCase() === "none" || isImageIcon(trimmed)) {
    return getRecentIcons();
  }
  const next = [trimmed, ...getRecentIcons().filter((x) => x !== trimmed)].slice(0, MAX_RECENT_ICONS);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(next));
    } catch {
      /* ignore storage quota failures */
    }
  }
  return next;
}

const IMAGE_ICON_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)(\?.*|#.*)?$/i;

export function cleanImageIconPath(icon: string): string {
  return icon.trim().replace(/^\[\[|\]\]$/g, "").trim();
}

export function isImageIcon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  const trimmed = cleanImageIconPath(icon);
  if (!trimmed || trimmed.toLowerCase() === "none") return false;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return true;
  if (IMAGE_ICON_EXT.test(trimmed)) return true;
  if ((trimmed.includes("/") || trimmed.startsWith("./")) && !/\s/.test(trimmed)) return true;
  return false;
}
