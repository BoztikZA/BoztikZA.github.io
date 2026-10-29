// Google Analytics 4 — read-only reporting through the official Google Analytics Data API (v1beta).
//
// WHY THIS FILE EXISTS: Command Centre needs GA4 users, sessions, acquisition, engagement and `boztik_action`
// events, which only Google holds. This module is the ONLY place that talks to Google. Rules it keeps:
//   * Least privilege: the single scope is analytics.readonly. Nothing here can change a GA4 property.
//   * Secrets stay on the server: GA4_SERVICE_ACCOUNT_JSON is a Worker secret, parsed in memory, never logged,
//     never returned, never stored in D1. Error responses carry a stable code and a fixed sentence — never a
//     Google response body, token, key or e-mail address.
//   * The browser can only pick a NAMED report and a validated window. It can never choose dimensions, metrics,
//     filters or a property, so a request cannot be turned into an expensive or arbitrary GA4 query.
//   * Bounded: every Google call has a timeout; page size is capped; the reporting window reuses the same strict
//     validation as every other analytics endpoint (<= 366 days); results are cached; identical in-flight requests
//     are shared; and after a quota error the Worker stops calling Google for a minute.
//   * Honest states: a genuine zero comes back as `state: "empty"` (Google answered with no rows). A failure comes
//     back as an HTTP error with a code. The two are never confused, and GA4 numbers are never added to the
//     first-party or Deliver counters.
//   * No new storage: nothing is written to D1 or R2. The only persistence is a short-lived HTTP cache entry.
import type { Env } from "../types";
import { HttpError } from "../types";
import { MIN_CUSTOM_DAY, resolveWindow } from "./db";
import type { PeriodWindow } from "./db";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_SECONDS = 600;
const METADATA_CACHE_SECONDS = 3600;
const MIN_FORCE_REFRESH_AGE_SECONDS = 60;
const QUOTA_COOLDOWN_SECONDS = 60;
export const MAX_PAGE_SIZE = 100;
export const MAX_OFFSET = 900;
const DEFAULT_PAGE_SIZE = 25;

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------
export interface Ga4Config { propertyId: string; clientEmail: string; privateKeyPem: string }
export interface Ga4ConfigCheck { config: Ga4Config | null; missing: string[]; invalid: string[] }

/** The numeric GA4 *property* ID (e.g. 412345678). The measurement ID (G-XXXXXXXX) is NOT accepted. */
const PROPERTY_ID_RE = /^\d{4,15}$/;

/** Reads and validates the two settings. Reports only the NAMES of what is missing or malformed — never a value. */
export function readGa4Config(env: Env): Ga4ConfigCheck {
  const missing: string[] = [], invalid: string[] = [];
  const propertyId = (env.GA4_PROPERTY_ID ?? "").trim();
  const rawJson = (env.GA4_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!propertyId) missing.push("GA4_PROPERTY_ID");
  else if (!PROPERTY_ID_RE.test(propertyId)) invalid.push("GA4_PROPERTY_ID");
  if (!rawJson) missing.push("GA4_SERVICE_ACCOUNT_JSON");

  let clientEmail = "", privateKeyPem = "";
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      clientEmail = typeof parsed.client_email === "string" ? parsed.client_email.trim() : "";
      privateKeyPem = typeof parsed.private_key === "string" ? parsed.private_key : "";
      if (parsed.type !== "service_account" || !clientEmail || !/BEGIN PRIVATE KEY/.test(privateKeyPem)) invalid.push("GA4_SERVICE_ACCOUNT_JSON");
    } catch {
      invalid.push("GA4_SERVICE_ACCOUNT_JSON");
    }
  }
  if (missing.length || invalid.length) return { config: null, missing, invalid };
  return { config: { propertyId, clientEmail, privateKeyPem }, missing, invalid };
}

// -----------------------------------------------------------------------------
// Injectable dependencies (production defaults; tests pass fakes)
// -----------------------------------------------------------------------------
export interface Ga4CacheEntry { value: unknown; storedAt: number }
export interface Ga4Cache {
  get(key: string): Promise<Ga4CacheEntry | null>;
  put(key: string, value: unknown, ttlSeconds: number, storedAt: number): Promise<void>;
}
export interface Ga4Deps { fetch?: typeof fetch; cache?: Ga4Cache; now?: () => number; /** Per-request timeout; production always uses the default. */ timeoutMs?: number }

const STORED_AT_HEADER = "x-ga4-stored-at";
const cacheUrl = (key: string) => `https://ga4-cache.invalid/v1/${encodeURIComponent(key)}`;

/** Edge HTTP cache when the runtime has one, otherwise a small bounded in-memory map. Either way entries expire. */
function defaultCache(): Ga4Cache {
  const memory = new Map<string, { value: unknown; storedAt: number; expiresAt: number }>();
  const edge: Cache | undefined = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  return {
    async get(key) {
      if (edge) {
        try {
          const hit = await edge.match(new Request(cacheUrl(key)));
          if (hit) return { value: await hit.json(), storedAt: Number(hit.headers.get(STORED_AT_HEADER)) || 0 };
        } catch { /* fall through to memory */ }
      }
      const m = memory.get(key);
      if (m && m.expiresAt > Date.now()) return { value: m.value, storedAt: m.storedAt };
      memory.delete(key);
      return null;
    },
    async put(key, value, ttlSeconds, storedAt) {
      if (memory.size >= 64) memory.delete(memory.keys().next().value as string);
      memory.set(key, { value, storedAt, expiresAt: Date.now() + ttlSeconds * 1000 });
      if (edge) {
        try {
          await edge.put(new Request(cacheUrl(key)), new Response(JSON.stringify(value), {
            headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${ttlSeconds}`, [STORED_AT_HEADER]: String(storedAt) },
          }));
        } catch { /* the in-memory copy still serves this isolate */ }
      }
    },
  };
}
let sharedCache: Ga4Cache | null = null;
const cacheOf = (deps: Ga4Deps): Ga4Cache => deps.cache ?? (sharedCache ??= defaultCache());

// Per-isolate state. Losing it (isolate recycled) only costs one extra token request or one extra Google call.
let tokenState: { key: string; token: string; expiresAtMs: number } | null = null;
let quotaBlockedUntilMs = 0;
const inflight = new Map<string, Promise<unknown>>();
/** Test hook: clears per-isolate state so tests do not leak into each other. */
export function resetGa4State(): void { tokenState = null; quotaBlockedUntilMs = 0; inflight.clear(); sharedCache = null; }

const cacheSeconds = (env: Env): number => {
  const n = Number(env.GA4_CACHE_SECONDS);
  return Number.isFinite(n) && n > 0 ? Math.min(3600, Math.max(60, Math.floor(n))) : DEFAULT_CACHE_SECONDS;
};

// -----------------------------------------------------------------------------
// Google authentication (service account -> short-lived access token)
// -----------------------------------------------------------------------------
const b64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/\\n/g, "\n").replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function timedFetch(fetchFn: typeof fetch, url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw new HttpError(504, "ga4_timeout", "Google Analytics did not respond in time. Try again shortly.");
    throw new HttpError(502, "ga4_unreachable", "Could not reach Google Analytics. Try again shortly.");
  } finally {
    clearTimeout(timer);
  }
}

async function accessToken(cfg: Ga4Config, fetchFn: typeof fetch, nowMs: number, timeoutMs?: number): Promise<string> {
  const key = cfg.clientEmail;
  if (tokenState && tokenState.key === key && tokenState.expiresAtMs - 120_000 > nowMs) return tokenState.token;

  const iat = Math.floor(nowMs / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: cfg.clientEmail, scope: GA4_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }))}`;
  let assertion: string;
  try {
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importPrivateKey(cfg.privateKeyPem), new TextEncoder().encode(unsigned));
    assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  } catch {
    throw new HttpError(502, "ga4_auth_failed", "The GA4 service account key could not be used. Re-create the key and store it again.");
  }

  const res = await timedFetch(fetchFn, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(assertion)}`,
  }, timeoutMs);
  const data = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!res.ok || typeof data?.access_token !== "string") {
    console.error("ga4 token request failed", res.status);
    throw new HttpError(502, "ga4_auth_failed", "Google rejected the GA4 service account credentials.");
  }
  const ttl = Number(data.expires_in);
  tokenState = { key, token: data.access_token, expiresAtMs: nowMs + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) * 1000 };
  return tokenState.token;
}

/** Maps a Google API failure to a stable code + fixed sentence. The Google body is parsed for its status word only;
 *  it is never forwarded or logged in full. */
function mapGoogleError(httpStatus: number, body: unknown, nowMs: number): HttpError {
  const word = String((body as { error?: { status?: unknown } } | null)?.error?.status ?? "");
  console.error("ga4 api error", httpStatus, word || "-");
  if (httpStatus === 429 || word === "RESOURCE_EXHAUSTED") {
    quotaBlockedUntilMs = nowMs + QUOTA_COOLDOWN_SECONDS * 1000;
    return new HttpError(429, "ga4_quota_exceeded", "Google Analytics quota is exhausted for now. Try again in a minute.", { retry_after: QUOTA_COOLDOWN_SECONDS });
  }
  if (httpStatus === 401 || word === "UNAUTHENTICATED") { tokenState = null; return new HttpError(502, "ga4_auth_failed", "Google rejected the GA4 service account credentials."); }
  if (httpStatus === 403 || word === "PERMISSION_DENIED") {
    return new HttpError(502, "ga4_permission_denied", "Google Analytics refused access. Add the service account as a Viewer on the GA4 property and make sure the Google Analytics Data API is enabled.");
  }
  if (httpStatus === 404 || word === "NOT_FOUND") {
    return new HttpError(502, "ga4_property_not_found", "The GA4 property was not found. Check that GA4_PROPERTY_ID is the numeric property ID, not the G- measurement ID.");
  }
  if (httpStatus === 400 || word === "INVALID_ARGUMENT") return new HttpError(502, "ga4_bad_request", "Google Analytics rejected the report request.");
  return new HttpError(502, "ga4_unavailable", "Google Analytics is temporarily unavailable. Try again shortly.");
}

async function googleCall(cfg: Ga4Config, deps: Ga4Deps, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Record<string, unknown>> {
  const fetchFn = deps.fetch ?? fetch;
  const nowMs = (deps.now ?? Date.now)();
  if (quotaBlockedUntilMs > nowMs) {
    throw new HttpError(429, "ga4_quota_exceeded", "Google Analytics quota is exhausted for now. Try again in a minute.", { retry_after: Math.max(1, Math.ceil((quotaBlockedUntilMs - nowMs) / 1000)) });
  }
  const token = await accessToken(cfg, fetchFn, nowMs, deps.timeoutMs);
  const res = await timedFetch(fetchFn, `${DATA_API}/properties/${cfg.propertyId}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  }, deps.timeoutMs);
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw mapGoogleError(res.status, data, nowMs);
  return data ?? {};
}

// -----------------------------------------------------------------------------
// Report catalogue — the ONLY queries this Worker will ever send to Google.
// -----------------------------------------------------------------------------
type Metrics = Record<string, number | null>;
export interface ReportDef {
  id: string;
  dimensions: string[];
  /** Response key for each dimension (same order). */
  dimensionKeys: string[];
  metrics: string[];
  orderMetric: string;
  paged: boolean;
  dimensionFilter?: unknown;
  metricFilter?: unknown;
  /** Needs the boztik_action custom dimensions to be registered in GA4. */
  needsCustomDimensions?: boolean;
}

const ACTION_EVENT_FILTER = { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "boztik_action" } } };
export const ACTION_DIMENSIONS = ["customEvent:action", "customEvent:destination"] as const;
const SESSION_METRICS = ["sessions", "totalUsers", "engagedSessions", "engagementRate"];

export const REPORTS: Record<string, ReportDef> = {
  overview: { id: "overview", dimensions: [], dimensionKeys: [], paged: false, orderMetric: "sessions",
    metrics: ["totalUsers", "newUsers", "sessions", "engagedSessions", "engagementRate", "screenPageViews", "activeUsers", "userEngagementDuration"] },
  sources: { id: "sources", dimensions: ["sessionSourceMedium"], dimensionKeys: ["source_medium"], paged: true, orderMetric: "sessions", metrics: SESSION_METRICS },
  channels: { id: "channels", dimensions: ["sessionDefaultChannelGroup"], dimensionKeys: ["channel"], paged: true, orderMetric: "sessions", metrics: SESSION_METRICS },
  // `landingPage` is the path WITHOUT its query string, so a landing page can never carry a token or an e-mail address.
  "landing-pages": { id: "landing-pages", dimensions: ["landingPage"], dimensionKeys: ["landing_page"], paged: true, orderMetric: "sessions", metrics: SESSION_METRICS },
  pages: { id: "pages", dimensions: ["pagePath"], dimensionKeys: ["page_path"], paged: true, orderMetric: "screenPageViews",
    metrics: ["screenPageViews", "totalUsers", "activeUsers", "userEngagementDuration"] },
  "new-returning": { id: "new-returning", dimensions: ["newVsReturning"], dimensionKeys: ["user_type"], paged: false, orderMetric: "totalUsers", metrics: ["totalUsers", "sessions", "engagementRate"] },
  actions: { id: "actions", dimensions: [...ACTION_DIMENSIONS], dimensionKeys: ["action", "destination"], paged: true, orderMetric: "eventCount",
    metrics: ["eventCount", "totalUsers"], dimensionFilter: ACTION_EVENT_FILTER, needsCustomDimensions: true },
  "key-events": { id: "key-events", dimensions: ["eventName"], dimensionKeys: ["event"], paged: true, orderMetric: "keyEvents", metrics: ["keyEvents"],
    metricFilter: { filter: { fieldName: "keyEvents", numericFilter: { operation: "GREATER_THAN", value: { int64Value: "0" } } } } },
};
/** Used when the custom dimensions are not registered: the plain event count, with no breakdown. */
const ACTIONS_BASIC: ReportDef = { id: "actions", dimensions: ["eventName"], dimensionKeys: ["event"], paged: false, orderMetric: "eventCount",
  metrics: ["eventCount", "totalUsers"], dimensionFilter: ACTION_EVENT_FILTER };

/** What an `action` value means, in plain words. Counts are CLICKS on a link — never purchases, enquiries or posts. */
export const ACTION_GROUPS: Record<string, { label: string; group: string }> = {
  redbubble_store: { label: "Redbubble", group: "outbound_store" },
  teepublic_store: { label: "TeePublic", group: "outbound_store" },
  kofi: { label: "Ko-fi", group: "outbound_store" },
  paypal: { label: "PayPal", group: "support" },
  chrome_web_store: { label: "Chrome Web Store", group: "extension_listing" },
  edge_store: { label: "Edge Add-ons", group: "extension_listing" },
  launchzone_listing: { label: "LaunchZone listing", group: "extension_listing" },
  social_link: { label: "Social profiles", group: "social" },
  external_portfolio: { label: "External portfolio", group: "portfolio" },
  portfolio_page: { label: "Portfolio page", group: "portfolio" },
  contact_email: { label: "Contact e-mail link", group: "contact" },
  contact_page: { label: "Contact page", group: "contact" },
  services_page: { label: "Services page", group: "services" },
  stores_page: { label: "Stores page", group: "product_links" },
  creative_toolkit: { label: "Creative Toolkit page", group: "product_links" },
  image_inspector: { label: "Image Inspector page", group: "product_links" },
  creative_assistant: { label: "Creative Assistant page", group: "product_links" },
  deliver: { label: "Deliver page", group: "deliver" },
};
export const ACTION_GROUP_LABELS: Record<string, string> = {
  outbound_store: "Outbound store links", support: "Support links", extension_listing: "Extension listings", social: "Social profiles",
  portfolio: "Portfolio", contact: "Contact", services: "Services", product_links: "Product pages", deliver: "Deliver", other: "Other / unrecognised",
};

// -----------------------------------------------------------------------------
// Response parsing (pure, exported for tests)
// -----------------------------------------------------------------------------
export interface Ga4Row { key: string; dims: Record<string, string>; current: Metrics | null; previous: Metrics | null }
export interface ParsedReport {
  rows: Ga4Row[];
  totals: { current: Metrics | null; previous: Metrics | null };
  row_count: number;
  has_more: boolean;
  /** Raw Google row offset for the next page (null on the last page). With a comparison period one dimension value can use
   *  two raw rows, so this is NOT merged-row count. */
  next_offset: number | null;
  /** True when this response holds the WHOLE result (first page and nothing more). Only then is 'not listed' a proven zero. */
  complete: boolean;
  property: { timezone: string | null; currency: string | null; thresholded: boolean; data_loss_other_row: boolean };
}

/** A dimension value that came back from Google. Capped, stripped of control characters, and any value that looks
 *  like an e-mail address is masked — a defensive layer so a stray address in GA4 data can never reach the screen. */
export function cleanDimensionValue(v: unknown): string {
  const s = String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
  return s.includes("@") ? "[redacted]" : s;
}

const toNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(typeof v === "string" ? v : NaN);
  return typeof v !== "undefined" && v !== "" && Number.isFinite(n) ? n : null;
};

interface GoogleRow { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }

function metricsOf(def: ReportDef, row: GoogleRow): Metrics {
  const out: Metrics = {};
  def.metrics.forEach((name, i) => { out[name] = toNumber(row.metricValues?.[i]?.value); });
  const users = out.activeUsers, seconds = out.userEngagementDuration;
  if (def.metrics.includes("userEngagementDuration") && def.metrics.includes("activeUsers")) {
    out.avgEngagementSeconds = users != null && seconds != null && users > 0 ? seconds / users : null;
  }
  return out;
}

const zeroMetrics = (def: ReportDef): Metrics => {
  const out: Metrics = {};
  for (const m of def.metrics) out[m] = 0;
  if ("userEngagementDuration" in out && "activeUsers" in out) out.avgEngagementSeconds = null;
  return out;
};

/** Merges Google's per-date-range rows into one row per dimension combination. */
export function parseReport(def: ReportDef, data: Record<string, unknown>, compared: boolean, requestedOffset: number, requestedLimit: number): ParsedReport {
  const headers = (data.dimensionHeaders as Array<{ name?: string }> | undefined) ?? [];
  const rangeIdx = headers.findIndex((h) => h.name === "dateRange");
  const rangeOf = (row: GoogleRow): "current" | "previous" => (rangeIdx >= 0 && row.dimensionValues?.[rangeIdx]?.value === "previous" ? "previous" : "current");

  const byKey = new Map<string, Ga4Row>();
  for (const raw of ((data.rows as GoogleRow[] | undefined) ?? [])) {
    const dims: Record<string, string> = {};
    def.dimensionKeys.forEach((k, i) => { dims[k] = cleanDimensionValue(raw.dimensionValues?.[i]?.value); });
    const key = def.dimensionKeys.map((k) => dims[k]).join("␟");
    const row = byKey.get(key) ?? { key, dims, current: null, previous: null };
    row[rangeOf(raw)] = metricsOf(def, raw);
    byKey.set(key, row);
  }

  // With two date ranges Google counts a combination once per range, so the page boundary is measured on raw rows.
  const rawRows = ((data.rows as unknown[] | undefined) ?? []).length;
  const rowCount = Number(data.rowCount);
  const reportedRows = Number.isFinite(rowCount) ? rowCount : rawRows;
  const hasMore = def.paged && requestedOffset + rawRows < reportedRows;
  const complete = requestedOffset === 0 && !hasMore;
  void requestedLimit;

  const rows = [...byKey.values()];
  for (const r of rows) {
    // Google omits all-zero rows. A combination seen only in the other period had genuinely zero here — but only if
    // this response is the WHOLE result. On any partial page (or a later page) "not listed" is not proof of zero: the
    // other half of the row may sit on another page, so it stays null and the client fills it once every page is in.
    if (compared && complete) { r.current ??= zeroMetrics(def); r.previous ??= zeroMetrics(def); }
  }
  const lead = def.orderMetric;
  rows.sort((a, b) => (b.current?.[lead] ?? -1) - (a.current?.[lead] ?? -1) || (b.previous?.[lead] ?? -1) - (a.previous?.[lead] ?? -1) || a.key.localeCompare(b.key));

  const totals: ParsedReport["totals"] = { current: null, previous: null };
  for (const t of ((data.totals as GoogleRow[] | undefined) ?? [])) {
    const m: Metrics = {};
    def.metrics.forEach((name, i) => { m[name] = toNumber(t.metricValues?.[i]?.value); });
    totals[rangeIdx >= 0 && t.dimensionValues?.[rangeIdx]?.value === "previous" ? "previous" : "current"] = m;
  }
  if (!def.dimensions.length) {
    // overview: the single row IS the total
    const only = rows[0];
    totals.current = only?.current ?? null;
    totals.previous = only?.previous ?? null;
  }

  const meta = (data.metadata as { timeZone?: unknown; currencyCode?: unknown; subjectToThresholding?: unknown; dataLossFromOtherRow?: unknown } | undefined) ?? {};
  return {
    rows,
    totals,
    row_count: reportedRows,
    has_more: hasMore,
    next_offset: hasMore ? requestedOffset + rawRows : null,
    complete,
    property: {
      timezone: typeof meta.timeZone === "string" ? meta.timeZone : null,
      currency: typeof meta.currencyCode === "string" ? meta.currencyCode : null,
      thresholded: meta.subjectToThresholding === true,
      data_loss_other_row: meta.dataLossFromOtherRow === true,
    },
  };
}

/** Groups `boztik_action` rows into safe destination categories (counts are clicks, not outcomes). */
export function groupActions(rows: Ga4Row[]) {
  const labelled = rows.map((r) => {
    const action = r.dims.action ?? "";
    const known = ACTION_GROUPS[action];
    return { ...r, label: known?.label ?? (action || "(not set)"), group: known?.group ?? "other" };
  });
  const groups = new Map<string, { group: string; label: string; clicks: number | null; previous_clicks: number | null }>();
  for (const r of labelled) {
    const g = groups.get(r.group) ?? { group: r.group, label: ACTION_GROUP_LABELS[r.group] ?? r.group, clicks: 0, previous_clicks: 0 };
    const add = (cur: number | null, next: number | null | undefined) => (next == null ? cur : (cur ?? 0) + next);
    g.clicks = r.current ? add(g.clicks, r.current.eventCount) : g.clicks;
    g.previous_clicks = r.previous ? add(g.previous_clicks, r.previous.eventCount) : g.previous_clicks;
    groups.set(r.group, g);
  }
  return { rows: labelled, groups: [...groups.values()].sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0) || a.label.localeCompare(b.label)) };
}

// -----------------------------------------------------------------------------
// Property metadata (cached 1 h): proves credentials work and tells us which custom dimensions are registered.
// -----------------------------------------------------------------------------
export interface Ga4Metadata { custom_dimensions: Record<"action" | "destination" | "position" | "page_key", boolean>; dimension_count: number }
const WANTED_DIMENSIONS = ["action", "destination", "position", "page_key"] as const;

async function propertyMetadata(cfg: Ga4Config, deps: Ga4Deps, force = false): Promise<Ga4Metadata> {
  const cache = cacheOf(deps);
  const key = `meta:${cfg.propertyId}`;
  if (!force) {
    const hit = await cache.get(key);
    if (hit) return hit.value as Ga4Metadata;
  }
  const data = await googleCall(cfg, deps, "/metadata", { method: "GET" });
  const names = new Set(((data.dimensions as Array<{ apiName?: string }> | undefined) ?? []).map((d) => d.apiName ?? ""));
  const value: Ga4Metadata = {
    custom_dimensions: Object.fromEntries(WANTED_DIMENSIONS.map((d) => [d, names.has(`customEvent:${d}`)])) as Ga4Metadata["custom_dimensions"],
    dimension_count: names.size,
  };
  await cache.put(key, value, METADATA_CACHE_SECONDS, (deps.now ?? Date.now)());
  return value;
}

// -----------------------------------------------------------------------------
// Public API used by the route
// -----------------------------------------------------------------------------
export interface Ga4StatusResponse {
  source: "ga4";
  configured: boolean;
  missing: string[];
  invalid: string[];
  scope: string;
  cache_seconds: number;
  verified: boolean | null;
  custom_dimensions: Ga4Metadata["custom_dimensions"] | null;
  error: { code: string; message: string } | null;
}

/** Configuration state, optionally proven against Google. Upstream failures are DATA here (never a thrown error), so the
 *  panel can show "configured, but Google refused access" instead of a blank screen. */
export async function ga4Status(env: Env, verify: boolean, deps: Ga4Deps = {}): Promise<Ga4StatusResponse> {
  const { config, missing, invalid } = readGa4Config(env);
  const base: Ga4StatusResponse = { source: "ga4", configured: !!config, missing, invalid, scope: GA4_SCOPE, cache_seconds: cacheSeconds(env), verified: null, custom_dimensions: null, error: null };
  if (!config || !verify) return base;
  try {
    const meta = await propertyMetadata(config, deps, true);
    return { ...base, verified: true, custom_dimensions: meta.custom_dimensions };
  } catch (e) {
    if (e instanceof HttpError) return { ...base, verified: false, error: { code: e.code, message: e.message } };
    throw e;
  }
}

export interface ReportParams {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  compare: boolean;
  limit: number;
  offset: number;
  refresh: boolean;
}

/** Validates the query string. Anything unexpected is a 422 — never silently replaced. */
export function parseReportParams(q: URLSearchParams): ReportParams {
  const intParam = (name: string, fallback: number, min: number, max: number): number => {
    const raw = q.get(name);
    if (raw === null || raw === "") return fallback;
    if (!/^\d{1,6}$/.test(raw)) throw new HttpError(422, "invalid_param", `${name} must be a whole number.`);
    const n = Number(raw);
    if (n < min || n > max) throw new HttpError(422, "invalid_param", `${name} must be between ${min} and ${max}.`);
    return n;
  };
  const compareRaw = q.get("compare");
  if (compareRaw !== null && compareRaw !== "0" && compareRaw !== "1") throw new HttpError(422, "invalid_param", "compare must be 0 or 1.");
  const refreshRaw = q.get("refresh");
  if (refreshRaw !== null && refreshRaw !== "0" && refreshRaw !== "1") throw new HttpError(422, "invalid_param", "refresh must be 0 or 1.");
  return {
    period: q.get("period"), from: q.get("from"), to: q.get("to"),
    compare: compareRaw !== "0",
    limit: intParam("limit", DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    offset: intParam("offset", 0, 0, MAX_OFFSET),
    refresh: refreshRaw === "1",
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

export interface Ga4ReportResponse extends ParsedReport {
  source: "ga4";
  report: string;
  state: "ok" | "empty" | "custom_dimensions_missing";
  period: { key: string; since: string; until: string };
  previous: { since: string; until: string } | null;
  freshness: { fetched_at: string; cache: "hit" | "miss"; age_seconds: number; includes_today: boolean; refresh_throttled: boolean; note: string };
  limit: number;
  offset: number;
  dimensions: string[];
  metrics: string[];
  extra?: Record<string, unknown>;
}

const FRESHNESS_NOTE = "GA4 standard reports can lag by several hours, and the most recent day may still be incomplete. GA4 may also apply privacy thresholds that hide small counts.";

export async function ga4Report(env: Env, reportId: string, q: URLSearchParams, deps: Ga4Deps = {}): Promise<Ga4ReportResponse> {
  const def = Object.prototype.hasOwnProperty.call(REPORTS, reportId) ? REPORTS[reportId] : undefined;
  if (!def) throw new HttpError(404, "not_found", "Unknown GA4 report.");

  const { config, missing, invalid } = readGa4Config(env);
  if (!config) throw new HttpError(503, "ga4_not_configured", "GA4 is not connected to the Worker yet.", { missing, invalid });

  const params = parseReportParams(q);
  const window: PeriodWindow = resolveWindow(env, params.from || params.to ? { period: "custom", from: params.from, to: params.to } : { period: params.period });
  const since = window.since ?? MIN_CUSTOM_DAY;
  const compared = params.compare && !!window.previous;
  const nowFn = deps.now ?? Date.now;
  const cache = cacheOf(deps);
  const ttl = cacheSeconds(env);
  const limit = def.paged ? params.limit : MAX_PAGE_SIZE;
  const offset = def.paged ? params.offset : 0;

  const key = ["report", config.propertyId, def.id, since, window.until, compared ? `${window.previous!.since}_${window.previous!.until}` : "none", limit, offset].join(":");

  const respond = (stored: Omit<Ga4ReportResponse, "freshness">, storedAt: number, hit: boolean, throttled: boolean): Ga4ReportResponse => ({
    ...stored,
    freshness: {
      fetched_at: iso(storedAt), cache: hit ? "hit" : "miss", age_seconds: Math.max(0, Math.round((nowFn() - storedAt) / 1000)),
      includes_today: window.includesToday, refresh_throttled: throttled, note: FRESHNESS_NOTE,
    },
  });

  const cached = await cache.get(key);
  const ageSeconds = cached ? (nowFn() - cached.storedAt) / 1000 : Infinity;
  if (cached && (!params.refresh || ageSeconds < MIN_FORCE_REFRESH_AGE_SECONDS)) {
    return respond(cached.value as Omit<Ga4ReportResponse, "freshness">, cached.storedAt, true, params.refresh && ageSeconds < MIN_FORCE_REFRESH_AGE_SECONDS);
  }

  // Identical requests in flight on this isolate share ONE Google call.
  const existing = inflight.get(key) as Promise<{ stored: Omit<Ga4ReportResponse, "freshness">; storedAt: number }> | undefined;
  const work = existing ?? (async () => {
    let active = def;
    let extra: Record<string, unknown> | undefined;
    let state: Ga4ReportResponse["state"] = "ok";
    if (def.needsCustomDimensions) {
      const meta = await propertyMetadata(config, deps);
      const missingDims = ACTION_DIMENSIONS.map((d) => d.replace("customEvent:", "")).filter((d) => !meta.custom_dimensions[d as keyof Ga4Metadata["custom_dimensions"]]);
      if (missingDims.length) { active = ACTIONS_BASIC; state = "custom_dimensions_missing"; extra = { missing_dimensions: missingDims }; }
    }

    const body: Record<string, unknown> = {
      dateRanges: [
        { startDate: since, endDate: window.until, name: "current" },
        ...(compared ? [{ startDate: window.previous!.since, endDate: window.previous!.until, name: "previous" }] : []),
      ],
      dimensions: active.dimensions.map((name) => ({ name })),
      metrics: active.metrics.map((name) => ({ name })),
      orderBys: [{ metric: { metricName: active.orderMetric }, desc: true }],
      limit: String(limit),
      offset: String(offset),
      keepEmptyRows: false,
      metricAggregations: active.dimensions.length ? ["TOTAL"] : [],
    };
    if (active.dimensionFilter) body.dimensionFilter = active.dimensionFilter;
    if (active.metricFilter) body.metricFilter = active.metricFilter;

    const data = await googleCall(config, deps, ":runReport", { method: "POST", body });
    const parsed = parseReport(active, data, compared, offset, limit);
    if (state === "ok" && parsed.rows.length === 0) state = "empty";

    if (def.id === "actions" && state !== "custom_dimensions_missing") extra = { ...(extra ?? {}), ...groupActions(parsed.rows) };

    const stored: Omit<Ga4ReportResponse, "freshness"> = {
      source: "ga4", report: def.id, state, ...parsed,
      period: { key: window.key, since, until: window.until },
      previous: compared ? { since: window.previous!.since, until: window.previous!.until } : null,
      limit, offset, dimensions: active.dimensionKeys, metrics: active.metrics,
      ...(extra ? { extra } : {}),
    };
    const storedAt = nowFn();
    await cache.put(key, stored, ttl, storedAt);
    return { stored, storedAt };
  })();
  if (!existing) { inflight.set(key, work); void work.then(() => inflight.delete(key), () => inflight.delete(key)); }

  const { stored, storedAt } = await work;
  return respond(stored, storedAt, false, false);
}
