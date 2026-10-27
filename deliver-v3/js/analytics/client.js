// Read-only analytics API client for the Command Centre Analytics tab.
//
// WHY A SEPARATE CLIENT: js/api.js is imported by almost every Command Centre module. Editing it would mean a
// half-cached deploy (new module + stale api.js, GitHub Pages caches for ~10 minutes) could break the whole
// dashboard graph, including sign-in. This module imports ONLY config.js and auth.js (unchanged) and exposes the
// analytics endpoints, so api.js stays byte-for-byte untouched.
//
// Every call is GET, admin-authenticated with the existing Bearer session, and accepts an AbortSignal so a newer
// selection can cancel older requests (stale responses can never overwrite fresher ones).
import { config } from "../config.js";
import { authHeaders, clearLocalSession } from "../auth.js";
import { rangeQuery } from "./range.js";

export class AnalyticsError extends Error {
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "AnalyticsError";
    this.status = status;
    this.code = code;
  }
  /** The Worker is older than this dashboard and does not have the route yet. */
  get isMissingRoute() { return this.status === 404; }
}

async function get(path, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, { method: "GET", signal, headers: { ...authHeaders() } });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new AnalyticsError("Could not reach the Boztik Deliver server. Check your connection and try again.", { code: "network" });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) clearLocalSession(); // session expired or revoked: the dashboard returns to sign-in
    throw new AnalyticsError(data?.error || `Request failed (HTTP ${response.status}).`, { status: response.status, code: data?.code || "" });
  }
  return data ?? {};
}

const A = "/api/admin/analytics";
/** `range` is a preset key ("7d") or { period } or { from, to } — see range.js. */
export const fetchSummary = (range, o) => get(`${A}/summary?${rangeQuery(range)}`, o);
export const fetchTrend = (range, o) => get(`${A}/trend?${rangeQuery(range)}`, o);
export const fetchSources = (range, o) => get(`${A}/traffic-sources?${rangeQuery(range)}`, o);
export const fetchStore = (range, o) => get(`${A}/store-clicks?${rangeQuery(range)}`, o);
export const fetchFlow = (range, o) => get(`${A}/visitor-flow?${rangeQuery(range)}`, o);
export const fetchHealth = o => get(`${A}/health`, o);
export const fetchOverview = o => get(`${A}/overview`, o);
