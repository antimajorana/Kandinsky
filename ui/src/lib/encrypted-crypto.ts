// Opt-in local AES-256-GCM block encryption using browser WebCrypto (`crypto.subtle`).
// Plaintext and passphrases live strictly in JS heap memory while unlocked — never in storage or on disk.

const ENVELOPE_HEADER = "KANDINSKY-AES256-GCM-V1";
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BITS = 128;

export interface ParsedEncryptedEnvelope {
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
  hint?: string;
}

export interface UnlockedMemoryEntry {
  plaintext: string;
  passphrase: string;
  hint?: string;
}

// Pure in-memory map keyed by normalized envelope text (never persisted to localStorage/sessionStorage/disk).
const unlockedMemory = new Map<string, UnlockedMemoryEntry>();

function normalizeEnvelopeKey(envelope: string): string {
  return envelope.replace(/\r\n/g, "\n").trim();
}

export function rememberUnlockedInMemory(envelope: string, entry: UnlockedMemoryEntry): void {
  const key = normalizeEnvelopeKey(envelope);
  if (!key) return;
  unlockedMemory.set(key, {
    plaintext: entry.plaintext,
    passphrase: entry.passphrase,
    ...(entry.hint ? { hint: entry.hint } : {}),
  });
}

export function getUnlockedInMemory(envelope: string): UnlockedMemoryEntry | undefined {
  const key = normalizeEnvelopeKey(envelope);
  return key ? unlockedMemory.get(key) : undefined;
}

export function lockInMemory(envelope: string): void {
  const key = normalizeEnvelopeKey(envelope);
  if (key) unlockedMemory.delete(key);
}

export function clearAllUnlockedInMemory(): void {
  unlockedMemory.clear();
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + step)));
  }
  return btoa(chunks.join(""));
}

function base64ToBytes(raw: string): Uint8Array<ArrayBuffer> | null {
  const cleaned = raw.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!cleaned || /[^A-Za-z0-9+/=]/.test(cleaned)) return null;
  const padded = cleaned.length % 4 === 0 ? cleaned : cleaned + "=".repeat(4 - (cleaned.length % 4));
  try {
    const bin = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function wrapBase64(b64: string, width = 64): string {
  if (b64.length <= width) return b64;
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += width) lines.push(b64.slice(i, i + width));
  return lines.join("\n");
}

function buildParsed(saltB64: string, ivB64: string, ctB64: string, hint?: string): ParsedEncryptedEnvelope | null {
  const salt = base64ToBytes(saltB64);
  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);
  if (!salt || !iv || !ct) return null;
  if (salt.byteLength < 8 || iv.byteLength < 8 || ct.byteLength < TAG_BITS / 8) return null;
  const cleanHint = hint?.replace(/[\r\n]+/g, " ").trim();
  return { salt, iv, ct, ...(cleanHint ? { hint: cleanHint } : {}) };
}

export function parseEncryptedEnvelope(src: string): ParsedEncryptedEnvelope | null {
  const trimmed = src.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return null;

  // 1. Standard ASCII header format: KANDINSKY-AES256-GCM-V1
  const lines = trimmed.split("\n");
  if (lines[0].trim() === ENVELOPE_HEADER) {
    let hint: string | undefined;
    let saltB64 = "";
    let ivB64 = "";
    const ctParts: string[] = [];
    let inCt = false;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (inCt) {
        ctParts.push(line);
        continue;
      }
      if (line.startsWith("hint:")) hint = line.slice(5).trim();
      else if (line.startsWith("salt:")) saltB64 = line.slice(5).trim();
      else if (line.startsWith("iv:")) ivB64 = line.slice(3).trim();
      else if (line.startsWith("ct:")) {
        inCt = true;
        const rest = line.slice(3).trim();
        if (rest) ctParts.push(rest);
      }
    }
    return buildParsed(saltB64, ivB64, ctParts.join(""), hint);
  }

  // 2. Compact single-line format: v1:<salt_b64>:<iv_b64>:<ct_b64>
  const compact = /^v1:([A-Za-z0-9+/_=-]+):([A-Za-z0-9+/_=-]+):([A-Za-z0-9+/_=-]+)$/.exec(trimmed);
  if (compact) {
    return buildParsed(compact[1], compact[2], compact[3]);
  }

  // 3. JSON envelope format: { salt, iv, ct, hint }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj.salt === "string" && typeof obj.iv === "string" && typeof obj.ct === "string") {
        return buildParsed(obj.salt, obj.iv, obj.ct, typeof obj.hint === "string" ? obj.hint : undefined);
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto API (crypto.subtle) is unavailable in this context");
  return subtle;
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const rawPass = new TextEncoder().encode(passphrase);
  const passBuf = new Uint8Array(new ArrayBuffer(rawPass.byteLength));
  passBuf.set(rawPass);
  const baseKey = await subtle.importKey("raw", passBuf, "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

export async function encryptBlockText(plaintext: string, passphrase: string, hint?: string): Promise<string> {
  if (!passphrase) throw new Error("Passphrase is required");
  const subtle = getSubtle();
  const salt = new Uint8Array(new ArrayBuffer(SALT_BYTES));
  const iv = new Uint8Array(new ArrayBuffer(IV_BYTES));
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);

  const key = await deriveAesKey(passphrase, salt, ["encrypt"]);
  const encoded = new TextEncoder().encode(plaintext);
  const plainBuf = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  plainBuf.set(encoded);

  const ctBuf = await subtle.encrypt({ name: "AES-GCM", iv, tagLength: TAG_BITS }, key, plainBuf);
  const cleanHint = hint?.replace(/[\r\n]+/g, " ").trim();
  const outLines = [ENVELOPE_HEADER];
  if (cleanHint) outLines.push(`hint: ${cleanHint}`);
  outLines.push(`salt: ${bytesToBase64(salt)}`);
  outLines.push(`iv: ${bytesToBase64(iv)}`);
  outLines.push("ct:");
  outLines.push(wrapBase64(bytesToBase64(new Uint8Array(ctBuf))));
  return outLines.join("\n");
}

export async function decryptBlockText(
  src: string,
  passphrase: string,
): Promise<{ plaintext: string; hint?: string }> {
  const parsed = parseEncryptedEnvelope(src);
  if (!parsed) throw new Error("Invalid encrypted block envelope");
  if (!passphrase) throw new Error("Passphrase is required");
  const subtle = getSubtle();
  const key = await deriveAesKey(passphrase, parsed.salt, ["decrypt"]);
  const plainBuf = await subtle.decrypt({ name: "AES-GCM", iv: parsed.iv, tagLength: TAG_BITS }, key, parsed.ct);
  const plaintext = new TextDecoder("utf-8", { fatal: false }).decode(plainBuf);
  return { plaintext, ...(parsed.hint ? { hint: parsed.hint } : {}) };
}
