import { HttpError } from "../types";

export const DOWNLOAD_TYPES = ["apple_app_store", "google_play", "generic"] as const;
export type DownloadType = (typeof DOWNLOAD_TYPES)[number];

export interface DownloadDestination {
  type: DownloadType;
  url: string;
  label?: string;
}

export const MAX_DOWNLOAD_DESTINATIONS = 10;
const MAX_URL_LENGTH = 500;
const MAX_LABEL_LENGTH = 48;

const APPLE_HOSTS = ["apps.apple.com", "itunes.apple.com"];
const GOOGLE_PLAY_HOSTS = ["play.google.com"];

function isAllowedHost(hostname: string, roots: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return roots.some(root => host === root || host.endsWith("." + root));
}

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, MAX_LABEL_LENGTH);
  return cleaned || undefined;
}

export function safeDownloadUrl(type: DownloadType, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
  if (type === "apple_app_store" && !isAllowedHost(parsed.hostname, APPLE_HOSTS)) return null;
  if (type === "google_play" && !isAllowedHost(parsed.hostname, GOOGLE_PLAY_HOSTS)) return null;
  return parsed.toString();
}

function isDownloadType(value: unknown): value is DownloadType {
  return typeof value === "string" && (DOWNLOAD_TYPES as readonly string[]).includes(value);
}

/**
 * Validates and normalizes an incoming download_links payload from an applicant or administrator.
 * Accepts null/undefined/[] (meaning no downloads) or an array of { type, url, label? }.
 */
export function checkedDownloadLinks(value: unknown): DownloadDestination[] {
  if (value === undefined || value === null || value === "") return [];
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      throw new HttpError(422, "invalid_download_links", "Download links must be a valid list.");
    }
  }
  if (!Array.isArray(raw)) {
    throw new HttpError(422, "invalid_download_links", "Download links must be a list.");
  }
  if (raw.length > MAX_DOWNLOAD_DESTINATIONS) {
    throw new HttpError(422, "too_many_download_links", `Add no more than ${MAX_DOWNLOAD_DESTINATIONS} download destinations.`);
  }
  const normalized: DownloadDestination[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(422, "invalid_download_links", "Each download destination must be an object.");
    }
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (!isDownloadType(type)) {
      throw new HttpError(422, "invalid_download_type", "Choose Apple App Store, Google Play Store or Generic Download.");
    }
    const url = safeDownloadUrl(type, record.url);
    if (!url) {
      if (type === "apple_app_store") {
        throw new HttpError(422, "invalid_download_url", "Enter a valid HTTPS Apple App Store URL (apps.apple.com).");
      }
      if (type === "google_play") {
        throw new HttpError(422, "invalid_download_url", "Enter a valid HTTPS Google Play Store URL (play.google.com).");
      }
      throw new HttpError(422, "invalid_download_url", "Generic download links must use a valid HTTPS URL.");
    }
    const label = cleanLabel(record.label);
    normalized.push(label ? { type, url, label } : { type, url });
  }
  return normalized;
}

/**
 * Safely parses stored download_links from D1 for public/admin DTOs.
 * Drops any malformed or invalid entries without throwing.
 */
export function normalizeDownloadLinks(value: unknown): DownloadDestination[] {
  if (!value) return [];
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const result: DownloadDestination[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (!isDownloadType(record.type)) continue;
    const url = safeDownloadUrl(record.type, record.url);
    if (!url) continue;
    const label = cleanLabel(record.label);
    result.push(label ? { type: record.type, url, label } : { type: record.type, url });
    if (result.length >= MAX_DOWNLOAD_DESTINATIONS) break;
  }
  return result;
}
