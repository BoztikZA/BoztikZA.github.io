// Controller for the "Google Analytics 4" card on the Analytics tab.
//
// Independent of the first-party analytics state: GA4 loads, fails and retries on its own, so a GA4 problem can never blank
// the first-party sections (and the reverse). Reads only. Rules:
//   * a sequence token + AbortController: an older range selection can never overwrite a newer one
//   * if the Worker says GA4 is not configured, NO report requests are made (no wall of 503s)
//   * on a refresh of the same range the last good figures stay on screen; a failed refresh keeps them and says so
//   * paging: "Show more" requests the Worker's raw next_offset and merges by key (a row's current and previous halves can
//     arrive on different pages, so a half is only called zero after the last page)
import { fetchGa4Status, fetchGa4Report, Ga4Error, REPORT_IDS } from "./ga4-client.js?v=ga1";
import { rangeId } from "./range.js";
import { bodyView, badgeFor, mergeReportPages } from "./ga4-views.js?v=ga1";

const $ = id => document.getElementById(id);
const PAGE = 25;
const PAGED = new Set(["sources", "channels", "landing-pages", "pages", "key-events", "actions"]);
const blank = () => ({ status: { phase: "loading", data: null, error: null }, reports: Object.fromEntries(REPORT_IDS.map(id => [id, { id, phase: "idle", data: null, rows: [], error: null }])), verify: null, lastOk: null });

let state = blank();
let seq = 0, controller = null, loadedKey = null, wired = false;

function render() {
  const body = $("cc-ga4-body"), badge = $("cc-ga4-badge");
  if (!body) return;
  const b = badgeFor(state);
  if (badge) { badge.textContent = b.text; badge.dataset.kind = b.kind; }
  // Keep keyboard focus on the same control across a re-render.
  const f = document.activeElement && body.contains(document.activeElement) ? document.activeElement : null;
  const sel = f ? (f.dataset.ga4More ? `[data-ga4-more="${f.dataset.ga4More}"]` : f.dataset.ga4Retry ? `[data-ga4-retry="${f.dataset.ga4Retry}"]` : "") : "";
  body.innerHTML = bodyView(state);
  if (sel) body.querySelector(sel)?.focus();
  const actions = $("cc-ga4-actions");
  if (actions) {
    const configured = state.status.data?.configured === true;
    actions.hidden = !configured;
    const refresh = actions.querySelector("[data-ga4-refresh]");
    if (refresh) refresh.disabled = Object.values(state.reports).some(r => r.phase === "loading");
  }
}

const keep = (id, sameKey) => (sameKey && state.reports[id]?.data ? { ...state.reports[id], phase: "ok", error: null } : { id, phase: "loading", data: null, rows: [], error: null });

/** Loads (or reloads) GA4 for the selected range. Safe to call often: the Worker caches reports for several minutes. */
export async function updateGa4(range, compare, { refresh = false } = {}) {
  if (!$("cc-ga4-body")) return;
  const mine = ++seq;
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const key = `${rangeId(range)}|${compare ? 1 : 0}`;
  const sameKey = key === loadedKey;
  if (!sameKey) state = { ...blank(), status: state.status.data ? { ...state.status, phase: "ok" } : state.status };
  if (!state.status.data) state.status = { phase: "loading", data: null, error: null };
  render();

  try {
    const status = await fetchGa4Status(false, { signal });
    if (mine !== seq) return;
    state.status = { phase: "ok", data: status, error: null };
  } catch (err) {
    if (mine !== seq || err?.name === "AbortError") return;
    state.status = { phase: "error", data: null, error: err instanceof Ga4Error ? err : new Ga4Error(err?.message || "Request failed.") };
    render();
    return;
  }
  if (!state.status.data.configured) { render(); loadedKey = key; return; }

  for (const id of REPORT_IDS) state.reports[id] = keep(id, sameKey);
  render();

  await Promise.all(REPORT_IDS.map(async id => {
    try {
      const data = await fetchGa4Report(id, range, { compare, limit: PAGED.has(id) ? PAGE : undefined, refresh, signal });
      if (mine !== seq) return;
      const rows = mergeReportPages([data], { compared: !!data.previous, complete: data.complete === true });
      state.reports[id] = { id, phase: "ok", data, rows, pages: [data], error: null, moreError: null, loadingMore: false };
      state.lastOk = new Date();
    } catch (err) {
      if (mine !== seq || err?.name === "AbortError") return;
      const e = err instanceof Ga4Error ? err : new Ga4Error(err?.message || "Request failed.");
      const prev = state.reports[id];
      // A failed refresh keeps the last good figures and says so; a first load shows the error.
      state.reports[id] = sameKey && prev?.data ? { ...prev, phase: "ok", refreshError: e } : { id, phase: "error", data: null, rows: [], error: e };
    }
    if (mine === seq) render();
  }));
  if (mine !== seq) return;
  loadedKey = key;
  render();
}

async function loadMore(id, getRange) {
  const rep = state.reports[id];
  if (!rep?.data?.has_more || rep.loadingMore) return;
  const mine = seq;
  rep.loadingMore = true; rep.moreError = null; render();
  const { range, compare } = getRange();
  try {
    const next = await fetchGa4Report(id, range, { compare, limit: PAGE, offset: rep.data.next_offset, signal: controller?.signal });
    if (mine !== seq) return;
    const pages = [...(rep.pages ?? [rep.data]), next];
    // The latest page decides whether more remain; the first page carries the totals.
    const data = { ...rep.data, has_more: next.has_more, next_offset: next.next_offset, row_count: next.row_count };
    state.reports[id] = { ...rep, data, pages, rows: mergeReportPages(pages, { compared: !!rep.data.previous, complete: !next.has_more }), loadingMore: false, moreError: null };
  } catch (err) {
    if (mine !== seq || err?.name === "AbortError") return;
    rep.loadingMore = false;
    rep.moreError = err instanceof Ga4Error ? err : new Ga4Error(err?.message || "Request failed.");
  }
  render();
}

async function verify() {
  state.verify = { phase: "loading" }; render();
  try { state.verify = { phase: "ok", data: await fetchGa4Status(true) }; }
  catch (err) { state.verify = { phase: "error", error: err instanceof Ga4Error ? err : new Ga4Error(err?.message || "Request failed.") }; }
  render();
}

/** Wires the card once. `getRange()` returns the currently selected { range, compare } from the Analytics tab. */
export function initGa4Panel(getRange) {
  if (wired) return;
  const root = $("cc-ga4");
  if (!root) return;
  wired = true;
  root.addEventListener("click", ev => {
    const t = ev.target.closest("[data-ga4-refresh],[data-ga4-verify],[data-ga4-retry],[data-ga4-more]");
    if (!t) return;
    const { range, compare } = getRange();
    if ("ga4Refresh" in t.dataset) void updateGa4(range, compare, { refresh: true });
    else if ("ga4Verify" in t.dataset) void verify();
    else if (t.dataset.ga4Retry) void updateGa4(range, compare);
    else if (t.dataset.ga4More) void loadMore(t.dataset.ga4More, getRange);
  });
}
