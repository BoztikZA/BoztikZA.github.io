import { HttpError } from "../types";

export const TRAFFIC_SOURCES = ["reddit", "organic_search", "social", "referral", "direct_unknown"] as const;
export type TrafficSource = typeof TRAFFIC_SOURCES[number];

export interface TrafficSourceVisit {
  sessionId: string;
  referrerHost: string | null;
  searchReferrer: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  source: TrafficSource;
}

const SEARCH_DOMAINS = [
  "bing.com", "duckduckgo.com", "search.yahoo.com", "yahoo.com", "yandex.com", "yandex.ru",
  "baidu.com", "ecosia.org", "search.brave.com",
];
const SOCIAL_DOMAINS = [
  "facebook.com", "fb.com", "instagram.com", "threads.net", "x.com", "twitter.com", "t.co",
  "linkedin.com", "pinterest.com", "tiktok.com", "youtube.com", "youtu.be", "snapchat.com",
  "tumblr.com", "discord.com",
];
const OWN_DOMAINS = ["boztik.com", "boztikza.github.io"];

function isDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function cleanHostname(value: unknown): string | null {
  if (typeof value !== "string") throw new HttpError(422, "invalid_referrer_host", "referrer_host must be a hostname.");
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (host === "") return null;
  if (host.length > 253 || /^\d+(?:\.\d+){3}$/.test(host)) {
    throw new HttpError(422, "invalid_referrer_host", "referrer_host must be a valid hostname.");
  }
  const labels = host.split(".");
  if (labels.length < 2 || labels.some(label => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new HttpError(422, "invalid_referrer_host", "referrer_host must be a valid hostname.");
  }
  return host;
}

function cleanUtm(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(422, "invalid_utm", `${field} must be text.`);
  const clean = value.trim();
  if (clean === "") return null;
  if (clean.length > maxLength || !/^[\p{L}\p{N}][\p{L}\p{N} ._~:/+-]*$/u.test(clean)) {
    throw new HttpError(422, "invalid_utm", `${field} contains invalid or overlong text.`);
  }
  return clean;
}

export function classifyTrafficSource(referrerHost: string | null, searchReferrer: boolean): TrafficSource {
  if (!referrerHost) return "direct_unknown";
  if (OWN_DOMAINS.some(domain => isDomain(referrerHost, domain))) return "direct_unknown";
  if (isDomain(referrerHost, "reddit.com") || isDomain(referrerHost, "redd.it") || isDomain(referrerHost, "redditmedia.com")) return "reddit";
  if (SOCIAL_DOMAINS.some(domain => isDomain(referrerHost, domain))) return "social";
  const googleSearch = /(^|\.)google\.(?:com|[a-z]{2}|(?:co|com|net|org|ac|go|ne|or)\.[a-z]{2})$/.test(referrerHost);
  if ((googleSearch || SEARCH_DOMAINS.some(domain => isDomain(referrerHost, domain))) && searchReferrer) return "organic_search";
  return "referral";
}

export function validateTrafficSourceVisit(body: Record<string, unknown>): TrafficSourceVisit {
  const sessionId = typeof body.session_id === "string" ? body.session_id.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{32}$/.test(sessionId)) throw new HttpError(422, "invalid_session_id", "session_id must be a 32-character random hex identifier.");
  if (typeof body.search_referrer !== "boolean") throw new HttpError(422, "invalid_search_signal", "search_referrer must be a boolean.");
  const referrerHost = cleanHostname(body.referrer_host);
  const utmSource = cleanUtm(body.utm_source, "utm_source", 100);
  const utmMedium = cleanUtm(body.utm_medium, "utm_medium", 100);
  const utmCampaign = cleanUtm(body.utm_campaign, "utm_campaign", 200);
  return {
    sessionId, referrerHost, searchReferrer: body.search_referrer,
    utmSource, utmMedium, utmCampaign,
    source: classifyTrafficSource(referrerHost, body.search_referrer),
  };
}
