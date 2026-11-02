// Server-side input validation. Nothing the client says about a file (name,
// type, size) is trusted: the extension is checked against an allow-list, the
// stored Content-Type is derived from the extension, and the leading bytes of
// every stored object are verified against the format's magic number.
import { HttpError } from "../types";
import { newDirectToken } from "./ids";

export const ALLOWED_EXTENSIONS = ["zip", "jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "pdf", "psd", "ai", "eps"] as const;
/** PhotoshopBattles deliveries are IMAGE ONLY (same set the old function served). */
export const BATTLE_EXTENSIONS = ["jpg", "jpeg", "png"] as const;
/** Types a browser may render inline for preview; everything else is forced to download. */
export const PREVIEW_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"] as const;
/** Share methods the delivery page can record. Native + copy are "completed", the rest are opened share sheets. */
export const SHARE_METHODS = ["native", "copy", "whatsapp", "facebook", "x", "reddit"] as const;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  tif: "image/tiff", tiff: "image/tiff", pdf: "application/pdf", zip: "application/zip",
  psd: "image/vnd.adobe.photoshop", ai: "application/postscript", eps: "application/postscript",
};

export function extensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export const isAllowedExtension = (ext: string | null): boolean =>
  ext !== null && (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
export const isBattleExtension = (ext: string | null): boolean =>
  ext !== null && (BATTLE_EXTENSIONS as readonly string[]).includes(ext);
export const isPreviewExtension = (ext: string | null): boolean =>
  ext !== null && (PREVIEW_EXTENSIONS as readonly string[]).includes(ext);
export const mimeForExtension = (ext: string | null): string =>
  (ext && MIME_BY_EXT[ext]) || "application/octet-stream";

const ascii = (b: Uint8Array, at: number, s: string): boolean =>
  s.length + at <= b.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/** True when the leading bytes are consistent with the claimed extension. */
export function magicMatches(ext: string, b: Uint8Array): boolean {
  switch (ext) {
    case "jpg": case "jpeg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "png": return b[0] === 0x89 && ascii(b, 1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
    case "gif": return ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a");
    case "webp": return ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP");
    case "tif": case "tiff": {
      const le = b[0] === 0x49 && b[1] === 0x49 && (b[2] === 0x2a || b[2] === 0x2b) && b[3] === 0x00;
      const be = b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && (b[3] === 0x2a || b[3] === 0x2b);
      return le || be;
    }
    case "pdf": return new TextDecoder("latin1").decode(b.slice(0, 1024)).includes("%PDF-");
    case "zip": return ascii(b, 0, "PK\x03\x04") || ascii(b, 0, "PK\x05\x06");
    case "psd": return ascii(b, 0, "8BPS");
    case "ai": return new TextDecoder("latin1").decode(b.slice(0, 1024)).includes("%PDF-") || ascii(b, 0, "%!PS");
    case "eps": return ascii(b, 0, "%!PS") || (b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6);
    default: return false;
  }
}

export function isValidDeliveryId(id: unknown): id is string {
  return typeof id === "string" && /^BZ-[A-Z0-9]{6,12}$/.test(id);
}
export function isValidFileId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9]{8,32}$/.test(id);
}
export const isValidShareMethod = (m: unknown): boolean => typeof m === "string" && (SHARE_METHODS as readonly string[]).includes(m);

export const MAX_NOTES_LENGTH = 4000;
export const MAX_NAME_LENGTH = 200;

export function clampString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
  return s === "" ? null : s;
}

/** http(s) only, no embedded credentials, sane length. Rejects javascript:, data:, etc. */
export function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v === "" || v.length > 2048) return false;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  return (u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "" && u.username === "" && u.password === "";
}

export function isRedditHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "reddit.com" || h.endsWith(".reddit.com") || h === "redd.it";
}

export interface CleanRedditSource {
  json: string;
  url: string; // canonical/source URL mirrored into deliveries.reddit_url
}

/** Validates the optional Reddit Source. Accepts either the structured object
 *  the Command Centre sends ({title, subreddit, author, canonicalUrl,
 *  redditUrl}) or a bare `reddit_url` string. Returns null when nothing was
 *  supplied (delivery then shows no Reddit link at all). Throws 422 when a
 *  supplied URL is not http(s). */
export function cleanRedditSource(source: unknown, bareUrl?: unknown): CleanRedditSource | null {
  const obj: Record<string, unknown> =
    source && typeof source === "object" && !Array.isArray(source) ? (source as Record<string, unknown>) : {};
  const rawCanonical = typeof obj.canonicalUrl === "string" ? obj.canonicalUrl.trim() : typeof obj.url === "string" ? obj.url.trim() : "";
  const rawReddit = typeof obj.redditUrl === "string" ? obj.redditUrl.trim() : "";
  const rawBare = typeof bareUrl === "string" ? bareUrl.trim() : "";

  const supplied = [rawCanonical, rawReddit, rawBare].filter((u) => u !== "");
  if (supplied.length === 0) return null;
  for (const u of supplied) {
    if (!isValidHttpUrl(u)) throw new HttpError(422, "invalid_reddit_url", "The Reddit source URL must be a valid http(s) link.");
  }
  const canonicalUrl = rawCanonical || rawReddit || rawBare;
  const redditUrl = rawReddit || rawBare || rawCanonical;

  const out: Record<string, string> = { canonicalUrl, redditUrl };
  const title = clampString(obj.title, 300);
  if (title) out.title = title;
  const sub = typeof obj.subreddit === "string" ? obj.subreddit.trim() : "";
  if (/^[A-Za-z0-9_]{1,50}$/.test(sub)) out.subreddit = sub;
  const author = typeof obj.author === "string" ? obj.author.trim() : "";
  if (/^[A-Za-z0-9_\-\[\]]{1,60}$/.test(author)) out.author = author;
  return { json: JSON.stringify(out), url: canonicalUrl };
}

export interface CleanSourceMeta { json: string | null; isBattle: boolean; directToken: string | null }

/** source_meta is only ever the PhotoshopBattles marker. Anything else is dropped. */
export function cleanSourceMeta(meta: unknown, existingToken?: string | null): CleanSourceMeta {
  if (!meta || typeof meta !== "object" || (meta as Record<string, unknown>).type !== "photoshop_battles") {
    return { json: null, isBattle: false, directToken: null };
  }
  const m = meta as Record<string, unknown>;
  const supplied = typeof m.direct_token === "string" && /^[a-f0-9]{32}$/.test(m.direct_token) ? m.direct_token : null;
  const token = existingToken && /^[a-f0-9]{32}$/.test(existingToken) ? existingToken : supplied ?? newDirectToken();
  const out: Record<string, string> = { type: "photoshop_battles", direct_token: token };
  if (typeof m.redditUrl === "string" && m.redditUrl.trim() !== "") {
    if (!isValidHttpUrl(m.redditUrl)) throw new HttpError(422, "invalid_reddit_url", "The Reddit URL must be a valid http(s) link.");
    out.redditUrl = m.redditUrl.trim();
  }
  return { json: JSON.stringify(out), isBattle: true, directToken: token };
}

/** Accepts unix seconds, unix milliseconds, or an ISO string. Returns unix seconds or null. */
export function parseExpiry(value: unknown): number | null {
  let ms: number;
  if (typeof value === "number" && Number.isFinite(value)) ms = value > 1e12 ? value : value * 1000;
  else if (typeof value === "string" && value.trim() !== "") ms = new Date(value).getTime();
  else return null;
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export const MAX_EXPIRY_SECONDS = 30 * 24 * 3600;
