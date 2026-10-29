// Read-only client for the Worker's GA4 reporting routes (GET /api/admin/analytics/ga4/...).
//
// Same rules as analytics/client.js: every call is a GET, authenticated with the existing admin Bearer session, and
// accepts an AbortSignal so a newer selection cancels older requests. There is NO Google credential, token or property
// ID anywhere in the browser: the Worker holds them and answers only for the fixed, named reports.
import { config } from "../config.js";
import { authHeaders, clearLocalSession } from "../auth.js";
import { rangeQuery } from "./range.js";

export class Ga4Error extends Error {
  constructor(message, { status = 0, code = "", missing = [], invalid = [], retryAfter = 0 } = {}) {
    super(message);
    this.name = "Ga4Error";
    this.status = status;
    this.code = code;
    this.missing = missing;
    this.invalid = invalid;
    this.retryAfter = retryAfter;
  }
  /** The deployed Worker is older than this dashboard and has no GA4 routes. */
  get isMissingRoute() { return this.status === 404 && this.code !== "not_found_report"; }
  get isNotConfigured() { return this.code === "ga4_not_configured"; }
}

async function get(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, { method: "GET", signal, headers: { ...authHeaders() } });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Ga4Error("Could not reach the Boztik Deliver server. Check your connection and try again.", { code: "network" });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) clearLocalSession(); // session expired or revoked: the dashboard returns to sign-in
    throw new Ga4Error(data?.error || `Request failed (HTTP ${response.status}).`, {
      status: response.status,
      code: data?.code || "",
      missing: Array.isArray(data?.missing) ? data.missing.map(String) : [],
      invalid: Array.isArray(data?.invalid) ? data.invalid.map(String) : [],
      retryAfter: Number(response.headers.get("Retry-After")) || Number(data?.retry_after) || 0,
    });
  }
  return data ?? {};
}

const A = "/api/admin/analytics/ga4";
export const REPORT_IDS = Object.freeze(["overview", "sources", "channels", "landing-pages", "pages", "new-returning", "actions", "key-events"]);

/** Configuration state. `verify` also asks the Worker to prove the credentials against Google. */
export const fetchGa4Status = (verify, o) => get(`${A}/status${verify ? "?verify=1" : ""}`, o);

/** One named report for a range. `offset` is the Worker's raw `next_offset`; `refresh` asks for a fresh Google read
 *  (the Worker throttles it to one per minute per report). */
export function fetchGa4Report(report, range, { compare = true, limit, offset = 0, refresh = false, signal } = {}) {
  if (!REPORT_IDS.includes(report)) throw new Ga4Error(`Unknown GA4 report: ${report}`);
  const p = [rangeQuery(range), `compare=${compare ? 1 : 0}`];
  if (limit) p.push(`limit=${Math.max(1, Math.min(100, Math.floor(limit)))}`);
  if (offset) p.push(`offset=${Math.max(0, Math.floor(offset))}`);
  if (refresh) p.push("refresh=1");
  return get(`${A}/${report}?${p.join("&")}`, { signal });
}
