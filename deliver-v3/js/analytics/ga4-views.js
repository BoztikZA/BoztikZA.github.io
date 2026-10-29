// HTML renderers for the "Google Analytics 4" section of the Analytics tab.
// Pure (no DOM, no network) so escaping and numbers can be unit-tested in Node. EVERY dynamic value goes through esc().
//
// Rules this file keeps (they are the product requirements, not decoration):
//   * GA4 numbers are labelled "GA4 · Google" and are never added to, merged with, or shown as the first-party page-view
//     counter or the private Deliver counters. They measure different things (users and sessions, not counted page loads).
//   * "No rows" is a genuine zero from Google; a failure is a failure. They never share wording, and a missing figure is
//     "—", never 0.
//   * A click is a click. Nothing here calls an outbound click a purchase, an enquiry or a completed delivery.
import { esc } from "./views.js?v=an2";
import { fmtInt } from "./chart-math.js";

const icon = name => `<svg class="cc-i" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const dash = `<span class="an-na" title="Not available">—</span>`;
export const GA4_BASIS = `<span class="an-basis an-basis-ga4" title="Reported by Google Analytics 4, not by Boztik's own counters.">GA4 · Google</span>`;
/** Percentages are only shown when the earlier period had at least this many events; below it the raw difference is shown. */
export const GA4_MIN_BASE = 20;

/* --------------------------------------------------------------- formatting */
export const fmtRate = v => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
export function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "—";
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
const FORMATS = { int: fmtInt, rate: fmtRate, dur: fmtDuration };

/** Change vs the previous period. Returns { kind, text } — never a made-up percentage. */
export function ga4Change(cur, prev, { unit = "count" } = {}) {
  const ok = v => v !== null && v !== undefined && Number.isFinite(Number(v));
  if (!ok(cur) || !ok(prev)) return { kind: "none", text: "No comparison" };
  cur = Number(cur); prev = Number(prev);
  if (unit === "rate") {
    const pp = (cur - prev) * 100;
    return Math.abs(pp) < 0.05 ? { kind: "flat", text: "No change" } : { kind: pp > 0 ? "up" : "down", text: `${pp > 0 ? "+" : "−"}${Math.abs(pp).toFixed(1)} pp` };
  }
  if (unit === "duration") {
    const d = Math.round(cur - prev);
    return d === 0 ? { kind: "flat", text: "No change" } : { kind: d > 0 ? "up" : "down", text: `${d > 0 ? "+" : "−"}${fmtDuration(Math.abs(d))}` };
  }
  if (prev === 0) return cur === 0 ? { kind: "flat", text: "No change" } : { kind: "up", text: "New" };
  if (prev < GA4_MIN_BASE) {
    const diff = Math.round(cur - prev);
    return diff === 0 ? { kind: "flat", text: "No change" } : { kind: diff > 0 ? "up" : "down", text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} (small base)` };
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  return pct === 0 ? { kind: "flat", text: "No change" } : { kind: pct > 0 ? "up" : "down", text: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%` };
}
const changeHtml = (cur, prev, opts) => {
  const c = ga4Change(cur, prev, opts);
  if (c.kind === "none") return `<span class="an-delta is-flat">${esc(c.text)}</span>`;
  const arrow = c.kind === "up" ? "▲" : c.kind === "down" ? "▼" : "";
  return `<span class="an-delta is-${c.kind}">${arrow ? `<span aria-hidden="true">${arrow}</span> ` : ""}${esc(c.text)} <small>vs previous</small></span>`;
};

/* ------------------------------------------------------------- page merging */
const zeroLike = m => Object.fromEntries(Object.keys(m).map(k => [k, k === "avgEngagementSeconds" ? null : 0]));
/** Merges pages of one report into one row per key. A dimension value's current and previous halves can sit on different
 *  pages, so a half is only declared zero once the LAST page is in (complete = no more pages) and a comparison was made. */
export function mergeReportPages(pages, { compared, complete }) {
  const byKey = new Map();
  let shape = null;
  for (const page of pages) {
    for (const r of page?.rows ?? []) {
      const have = byKey.get(r.key) ?? { key: r.key, dims: r.dims, current: null, previous: null };
      have.current ??= r.current ?? null;
      have.previous ??= r.previous ?? null;
      byKey.set(r.key, have);
      shape ??= r.current ?? r.previous;
    }
  }
  const rows = [...byKey.values()];
  if (compared && complete && shape) for (const r of rows) { r.current ??= zeroLike(shape); r.previous ??= zeroLike(shape); }
  return rows;
}

/* ------------------------------------------------------------ state panels */
const ERROR_TEXT = {
  ga4_permission_denied: "Google refused access. Add the service account as a Viewer on the GA4 property and enable the Google Analytics Data API.",
  ga4_property_not_found: "Google could not find the GA4 property. GA4_PROPERTY_ID must be the numeric property ID, not the G- measurement ID.",
  ga4_auth_failed: "Google rejected the service-account credentials. Create a new key and store it again.",
  ga4_quota_exceeded: "Google Analytics quota is used up for now.",
  ga4_timeout: "Google Analytics did not answer in time.",
  ga4_unreachable: "Google Analytics could not be reached.",
  ga4_unavailable: "Google Analytics is temporarily unavailable.",
  network: "Could not reach the Boztik Deliver server.",
};
export const errorText = e => ERROR_TEXT[e?.code] || e?.message || "Request failed.";

const stateBox = (kind, body, retry) => `<div class="an-state an-state-${kind}" role="${kind === "error" ? "alert" : "status"}">${kind === "loading" ? `<span class="an-spinner" aria-hidden="true"></span>` : icon(kind === "error" ? "alert" : "info")}<span>${body}${retry ? ` <button type="button" class="cc-btn cc-btn-inline" data-ga4-retry="${esc(retry)}">Try again</button>` : ""}</span></div>`;

/** Inline panel for a report that is loading, failed, empty or not yet supported by the deployed Worker. Returns "" when the
 *  report has data to draw. */
export function reportState(rep, label) {
  if (!rep || rep.phase === "idle" || rep.phase === "loading") return stateBox("loading", `Loading ${esc(label)}…`);
  if (rep.phase === "error") {
    const e = rep.error;
    if (e?.isMissingRoute) return stateBox("missing", `<strong>${esc(label)} needs the updated Worker.</strong> The deployed Worker does not have the GA4 routes yet.`);
    const wait = e?.code === "ga4_quota_exceeded" && e.retryAfter ? ` Try again in about ${esc(Math.max(1, Math.round(e.retryAfter / 60)))} minute.` : "";
    return stateBox("error", `<strong>${esc(label)} could not be loaded.</strong> ${esc(errorText(e))}${wait}`, rep.id);
  }
  if (rep.data?.state === "empty") return stateBox("empty", `<strong>No data for ${esc(label)} in this period.</strong> Google Analytics answered successfully but reported no rows. That is a real zero, not an error. Recent days can also still be processing.`);
  return "";
}

/** One banner when several reports fail for the same reason (e.g. no access), instead of eight identical errors. */
export function commonFailure(reports) {
  const failed = Object.values(reports).filter(r => r?.phase === "error" && r.error && !r.error.isMissingRoute);
  if (failed.length < 3) return null;
  const code = failed[0].error.code;
  return failed.every(r => r.error.code === code) ? failed[0].error : null;
}

/* ----------------------------------------------------------------- sections */
export function badgeFor(state) {
  const s = state.status;
  if (s.phase === "loading") return { kind: "loading", text: "GA4: checking…" };
  if (s.phase === "error") return s.error?.isMissingRoute ? { kind: "none", text: "GA4: needs updated Worker" } : { kind: "error", text: "GA4: unavailable" };
  if (!s.data?.configured) return { kind: "none", text: "GA4: not connected" };
  if (commonFailure(state.reports)) return { kind: "error", text: "GA4: access problem" };
  const phases = Object.values(state.reports).map(r => r?.phase);
  if (phases.some(p => p === "ok")) return { kind: "ok", text: "GA4: connected" };
  return phases.some(p => p === "loading" || p === "idle") ? { kind: "loading", text: "GA4: loading…" } : { kind: "error", text: "GA4: no data loaded" };
}

const SETUP_STEPS = [
  "In Google Cloud, enable the <em>Google Analytics Data API</em> and create a service account (no project roles needed).",
  "In GA4 → Admin → Property access management, add the service account's e-mail as a <em>Viewer</em>.",
  "Set the Worker secrets: <code>GA4_SERVICE_ACCOUNT_JSON</code> (the key file's JSON) and <code>GA4_PROPERTY_ID</code> (the <em>numeric</em> property ID from GA4 → Admin → Property details, not the G- measurement ID).",
  "In GA4 → Admin → Custom definitions, register <code>action</code>, <code>destination</code>, <code>position</code> and <code>page_key</code> as <em>event-scoped</em> custom dimensions so <code>boztik_action</code> can be broken down.",
  "Reload this page. Nothing is estimated or filled in while GA4 is not connected.",
];

export function notConfiguredView(status) {
  const missing = (status?.missing ?? []).map(n => `<code>${esc(n)}</code>`).join(", ");
  const invalid = (status?.invalid ?? []).map(n => `<code>${esc(n)}</code>`).join(", ");
  return `<div class="an-state an-state-missing" role="status">${icon("info")}<span><strong>GA4 is not connected to Command Centre yet.</strong> Users, sessions, acquisition, engagement and <code>boztik_action</code> clicks live only in Google Analytics, so none of them are shown here until the Worker can read them. ${missing ? `Missing on the Worker: ${missing}.` : ""} ${invalid ? `Set but not valid: ${invalid}.` : ""}</span></div>
    <details class="cc-ga4-how"><summary>How to connect GA4 (read-only)</summary><ol>${SETUP_STEPS.map(s => `<li>${s}</li>`).join("")}</ol>
    <p class="an-fine">The Worker asks Google for the single <code>analytics.readonly</code> permission. Credentials never reach the browser.</p></details>`;
}

const period = (p, prev) => `${esc(p?.since ?? "start")} to ${esc(p?.until ?? "—")}${prev ? ` · compared with ${esc(prev.since)} to ${esc(prev.until)}` : " · no comparison period"}`;

/** Reporting period, comparison period, GA4 timezone, and the freshness of what is on screen. */
export function headerView(state) {
  const first = Object.values(state.reports).find(r => r?.phase === "ok" && r.data);
  const d = first?.data;
  const fresh = d?.freshness;
  const when = iso => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? "—" : t.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); };
  const lines = [];
  lines.push(`<span>${GA4_BASIS}</span>`);
  if (d) {
    lines.push(`<span>Period: ${period(d.period, d.previous)}</span>`);
    if (d.property?.timezone) lines.push(`<span>GA4 timezone: ${esc(d.property.timezone)}</span>`);
    if (fresh) lines.push(`<span>Last successful refresh: ${esc(when(fresh.fetched_at))} (${fresh.cache === "hit" ? `cached, ${esc(Math.max(0, Math.round((fresh.age_seconds || 0) / 60)))} min old` : "fetched just now"})</span>`);
  } else {
    lines.push(`<span>Last successful refresh: never</span>`);
  }
  const notes = [];
  if (fresh) notes.push(esc(fresh.note));
  if (d?.property?.thresholded) notes.push("Google applied privacy thresholds to this property, so some small counts are hidden.");
  if (d?.property?.data_loss_other_row) notes.push("Google grouped some rows into “(other)” because a report was too large.");
  if (d && d.period?.since && d.period.until && d.freshness?.includes_today) notes.push("The most recent day is still in progress.");
  if (Object.values(state.reports).some(r => r?.refreshError)) notes.push("<strong>Refresh failed.</strong> Showing the last successful GA4 figures.");
  return `<div class="cc-site-status an-ga4-meta">${lines.join("")}</div>${notes.length ? `<p class="an-fine">${notes.join(" ")}</p>` : ""}`;
}

export function kpiView(rep) {
  const hold = reportState(rep, "GA4 overview");
  if (hold) return hold;
  const cur = rep.data.totals?.current, prev = rep.data.totals?.previous;
  const card = (label, key, unit = "int", fmt = FORMATS.int, sub = "") => {
    const v = cur?.[key] ?? null;
    return `<article class="an-kpi"><header><span>${esc(label)}</span></header><strong class="an-kpi-val">${v === null ? dash : esc(fmt(v))}</strong>
      <div class="an-kpi-delta">${changeHtml(v, prev?.[key] ?? null, { unit: unit === "int" ? "count" : unit })}</div><p class="an-kpi-sub">${sub}</p>${GA4_BASIS}</article>`;
  };
  return `<div class="an-kpis">${[
    card("Users", "totalUsers", "int", FORMATS.int, "People GA4 identified (cookie-consent and thresholds apply). Not page loads."),
    card("New users", "newUsers", "int", FORMATS.int, "First visit in this period."),
    card("Sessions", "sessions", "int", FORMATS.int, "Visits as GA4 counts them."),
    card("Engaged sessions", "engagedSessions", "int", FORMATS.int, "10 s+, a conversion, or 2+ views."),
    card("Engagement rate", "engagementRate", "rate", FORMATS.rate, "Engaged sessions ÷ sessions."),
    card("Page views", "screenPageViews", "int", FORMATS.int, "GA4's count. Differs from Boztik's own page-view counter."),
    card("Avg engagement time", "avgEngagementSeconds", "duration", FORMATS.dur, "Per active user."),
  ].join("")}</div>`;
}

const USER_TYPE = { new: "New users", returning: "Returning users", "(not set)": "Not classified" };
export const REPORT_VIEWS = {
  sources: { label: "Sessions by source / medium", dim: "source_medium", dimLabel: "Source / medium", lead: "sessions",
    cols: [["sessions", "Sessions", "int"], ["totalUsers", "Users", "int"], ["engagedSessions", "Engaged", "int"], ["engagementRate", "Engagement rate", "rate"]] },
  channels: { label: "Default channel group", dim: "channel", dimLabel: "Channel group", lead: "sessions",
    cols: [["sessions", "Sessions", "int"], ["totalUsers", "Users", "int"], ["engagedSessions", "Engaged", "int"], ["engagementRate", "Engagement rate", "rate"]] },
  "landing-pages": { label: "Landing pages", dim: "landing_page", dimLabel: "Landing page", lead: "sessions",
    cols: [["sessions", "Sessions", "int"], ["totalUsers", "Users", "int"], ["engagedSessions", "Engaged", "int"], ["engagementRate", "Engagement rate", "rate"]] },
  pages: { label: "Views by page path", dim: "page_path", dimLabel: "Page path", lead: "screenPageViews",
    cols: [["screenPageViews", "Views", "int"], ["totalUsers", "Users", "int"], ["avgEngagementSeconds", "Avg engagement / user", "dur"]] },
  "new-returning": { label: "New and returning users", dim: "user_type", dimLabel: "User type", lead: "totalUsers", map: v => USER_TYPE[v] ?? v,
    cols: [["totalUsers", "Users", "int"], ["sessions", "Sessions", "int"], ["engagementRate", "Engagement rate", "rate"]] },
  "key-events": { label: "Key events (conversions)", dim: "event", dimLabel: "Event", lead: "keyEvents",
    cols: [["keyEvents", "Key events", "int"]] },
};

/** Table for one report. `rows` are the merged rows of every loaded page (see mergeReportPages). */
export function tableView(id, rep) {
  const def = REPORT_VIEWS[id];
  const hold = reportState(rep, def.label);
  if (hold) return hold;
  const d = rep.data, rows = rep.rows ?? [];
  const leadCol = def.cols.find(c => c[0] === def.lead);
  const total = d.totals?.current?.[def.lead];
  const head = `<th scope="col">${esc(def.dimLabel)}</th>${def.cols.map(([, label]) => `<th scope="col" class="num">${esc(label)}</th>`).join("")}<th scope="col" class="num">${esc(leadCol[1])} vs previous</th>`;
  const body = rows.map(r => {
    const name = def.map ? def.map(r.dims[def.dim]) : r.dims[def.dim];
    return `<tr><th scope="row">${esc(name || "(not set)")}</th>${def.cols.map(([k, , unit]) => `<td class="num">${r.current ? esc(FORMATS[unit](r.current[k])) : "—"}</td>`).join("")}<td class="num">${changeHtml(r.current?.[def.lead], r.previous?.[def.lead], { unit: leadCol[2] === "rate" ? "rate" : leadCol[2] === "dur" ? "duration" : "count" })}</td></tr>`;
  }).join("");
  const totalRow = total != null ? `<tr class="an-total"><th scope="row">All rows (GA4 total)</th>${def.cols.map(([k, , unit]) => `<td class="num">${esc(FORMATS[unit](d.totals.current?.[k]))}</td>`).join("")}<td class="num">${changeHtml(total, d.totals.previous?.[def.lead], { unit: "count" })}</td></tr>` : "";
  const more = d.has_more ? `<p class="an-more"><button type="button" class="cc-btn" data-ga4-more="${esc(id)}"${rep.loadingMore ? " disabled" : ""}>${rep.loadingMore ? "Loading…" : "Show more"}</button> <span class="an-muted">${esc(rows.length)} of ${esc(d.row_count)} loaded</span></p>` : "";
  const moreErr = rep.moreError ? stateBox("error", `<strong>More rows could not be loaded.</strong> ${esc(errorText(rep.moreError))}`) : "";
  return `<div class="an-table-wrap"><table class="an-table an-wide"><caption class="cc-sr">${esc(def.label)}, GA4 data</caption><thead><tr>${head}</tr></thead><tbody>${body}${totalRow}</tbody></table></div>${moreErr}${more}`;
}

const CUSTOM_DIM_HELP = `Register these as <em>event-scoped</em> custom dimensions in GA4 → Admin → Custom definitions: <code>action</code>, <code>destination</code>, <code>position</code>, <code>page_key</code>. GA4 only starts filling a custom dimension after it is registered.`;

/** boztik_action: grouped by safe destination category, then by action. Counts are CLICKS on links, never outcomes. */
export function actionsView(rep) {
  const hold = reportState(rep, "GA4 actions");
  if (hold) return hold;
  const d = rep.data;
  if (d.state === "custom_dimensions_missing") {
    const miss = (d.extra?.missing_dimensions ?? []).map(n => `<code>${esc(n)}</code>`).join(", ");
    const total = rep.rows?.[0]?.current?.eventCount;
    return `${stateBox("missing", `<strong>The <code>boztik_action</code> breakdown is not available yet.</strong> GA4 has not been told about the custom dimension${(d.extra?.missing_dimensions ?? []).length === 1 ? "" : "s"} ${miss}. ${CUSTOM_DIM_HELP}`)}
      <p class="an-stats"><span><b>${esc(fmtInt(total))}</b> <code>boztik_action</code> events in total (no breakdown)</span></p>`;
  }
  const groups = d.extra?.groups ?? [];
  const lines = (d.extra?.rows ?? []);
  const merged = new Map(lines.map(r => [r.key, r]));
  for (const r of rep.rows ?? []) merged.set(r.key, { ...(merged.get(r.key) ?? {}), ...r });
  const groupRows = groups.map(g => `<tr><th scope="row">${esc(g.label)}</th><td class="num">${esc(fmtInt(g.clicks))}</td><td class="num">${changeHtml(g.clicks, g.previous_clicks, { unit: "count" })}</td></tr>`).join("");
  const actionRows = [...merged.values()].map(r => `<tr><th scope="row">${esc(r.label ?? r.dims?.action ?? "")}</th><td>${esc(r.dims?.destination ?? "")}</td><td class="num">${r.current ? esc(fmtInt(r.current.eventCount)) : "—"}</td><td class="num">${r.current ? esc(fmtInt(r.current.totalUsers)) : "—"}</td></tr>`).join("");
  return `<h3 class="an-h3">Clicks by destination category</h3>
    <div class="an-table-wrap"><table class="an-table"><caption class="cc-sr">boztik_action clicks grouped by destination category, GA4 data</caption><thead><tr><th scope="col">Category</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">Clicks vs previous</th></tr></thead><tbody>${groupRows}</tbody></table></div>
    <h3 class="an-h3">Clicks by action</h3>
    <div class="an-table-wrap"><table class="an-table an-wide"><caption class="cc-sr">boztik_action clicks by action and destination host, GA4 data</caption><thead><tr><th scope="col">Action</th><th scope="col">Destination (host or path)</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">Users</th></tr></thead><tbody>${actionRows}</tbody></table></div>
    <p class="an-fine">${GA4_BASIS} Each count is a recorded <strong>click</strong> on a link, including links that leave Boztik (Redbubble, TeePublic, Ko-fi, extension stores). It is not a purchase, a completed enquiry, a published post or a delivery. Destinations are hostnames or paths only — never a full URL, query string or e-mail address.</p>`;
}

/** The whole GA4 body for one state snapshot. */
export function bodyView(state) {
  const s = state.status;
  if (s.phase === "loading") return stateBox("loading", "Checking the GA4 connection…");
  if (s.phase === "error") {
    return s.error?.isMissingRoute
      ? stateBox("missing", "<strong>GA4 reporting needs the updated Worker.</strong> This dashboard is newer than the deployed Worker, so the GA4 routes are not available yet.")
      : stateBox("error", `<strong>The GA4 connection could not be checked.</strong> ${esc(errorText(s.error))}`, "status");
  }
  if (!s.data?.configured) return notConfiguredView(s.data);

  const common = commonFailure(state.reports);
  const verify = state.verify;
  const verifyBox = verify?.phase === "ok"
    ? (verify.data.verified === true ? stateBox("empty", "<strong>Connection verified.</strong> Google accepted the credentials for this property.") : stateBox("error", `<strong>Google did not accept the connection.</strong> ${esc(errorText(verify.data.error))}`))
    : verify?.phase === "error" ? stateBox("error", `<strong>Could not run the check.</strong> ${esc(errorText(verify.error))}`) : verify?.phase === "loading" ? stateBox("loading", "Asking Google…") : "";
  const banner = common ? stateBox("error", `<strong>Google Analytics is not returning reports.</strong> ${esc(errorText(common))}`) : "";

  const R = state.reports;
  const section = (title, html) => `<section class="an-ga4-section"><h3 class="an-h3">${esc(title)}</h3>${html}</section>`;
  const guard = (rep, html) => (common ? "" : html);
  return `${banner}${verifyBox}${headerView(state)}
    ${guard(R.overview, section("Overview", kpiView(R.overview)))}
    ${guard(R.sources, section("Acquisition", `<h4 class="an-h4">Sessions by source / medium</h4>${tableView("sources", R.sources)}<h4 class="an-h4">Default channel group</h4>${tableView("channels", R.channels)}<h4 class="an-h4">New and returning users</h4>${tableView("new-returning", R["new-returning"])}`))}
    ${guard(R["landing-pages"], section("Engagement", `<h4 class="an-h4">Landing pages</h4>${tableView("landing-pages", R["landing-pages"])}<h4 class="an-h4">Views by page path</h4>${tableView("pages", R.pages)}<p class="an-fine">Onward navigation between pages is not available from these reports; first-party “Visitor flow” above shows page-to-page movement.</p>`))}
    ${guard(R.actions, section("Commercial actions", `${actionsView(R.actions)}<h4 class="an-h4">Configured key events</h4>${tableView("key-events", R["key-events"])}`))}
    <p class="an-fine">GA4 measures users and sessions; Boztik's own counter measures page loads; Deliver counters measure private deliveries. They answer different questions and are <strong>never added together</strong>. Visitors who decline analytics cookies or send Do Not Track / Global Privacy Control are missing from GA4.</p>`;
}
