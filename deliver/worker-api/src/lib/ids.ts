// Same alphabet/shape as the previous Boztik Deliver clients used, so BZ-
// links keep looking identical to clients. No visually ambiguous chars.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 symbols -> unbiased mod on a byte

function randomToken(length: number): string {
  const values = crypto.getRandomValues(new Uint8Array(length));
  return [...values].map((v) => ALPHABET[v % ALPHABET.length]).join("");
}

export const newDeliveryId = (): string => `BZ-${randomToken(8)}`;
/** 12 chars ≈ 60 bits. delivery_files.id is a global primary key, so it must
 *  not collide across deliveries (the old 4-char id would, at scale). */
export const newFileId = (): string => randomToken(12).toLowerCase();
export const newUploadId = (): string => randomToken(16).toLowerCase();
/** ~215 bits of entropy. */
export const newSessionTokenRaw = (): string => randomToken(43);
/** 128-bit token for PhotoshopBattles direct image URLs (32 hex chars). */
export function newDirectToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reduce a client-supplied name to a safe R2 key segment. The extension is
 *  preserved (only the base is truncated) and the result can only contain
 *  [A-Za-z0-9._-], so it can never inject path separators or control chars. */
export function sanitizeFilename(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const dot = normalized.lastIndexOf(".");
  const rawBase = dot > 0 ? normalized.slice(0, dot) : normalized;
  const rawExt = dot > 0 ? normalized.slice(dot + 1) : "";
  const base = rawBase.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "file";
  const ext = rawExt.replace(/[^A-Za-z0-9]/g, "").toLowerCase().slice(0, 10);
  return ext ? `${base}.${ext}` : base;
}

/** Human-visible file name: control chars stripped, length capped. Rendered by
 *  the client through escapeHtml, and never used to build a storage path. */
export function displayFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f<>"\\/]/g, "_").trim().slice(0, 200);
  return clean || "file";
}

export function r2KeyFor(deliveryId: string, fileId: string, safeName: string): string {
  return `deliveries/${deliveryId}/${fileId}-${safeName}`;
}

export const R2_PREFIX = "deliveries/";

/** Hex SHA-256 of a string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time string comparison (length is compared without early exit on
 *  content; unequal lengths still walk the longer input). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
