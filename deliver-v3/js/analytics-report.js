// Boztik Analytics — pure logic: labels, "What stands out" observations and the plain-text report.
//
// No DOM, no network, no imports: everything here is a function of the `model` object that
// site-analytics.js assembles from the Worker's /analytics/summary response, so it can be tested in
// Node and the on-screen insights and the copy-paste report can never disagree.
//
// House rules (the same ones the brief sets):
//   * Only state what the data shows. Never explain WHY something happened.
//   * Website analytics and Deliver analytics are different systems and are never added together.
//     The public Deliver page (deliver.html) is counted as a website page; private delivery
//     activity (views/downloads/types) is Deliver analytics and stays in its own block.
//   * Anything that cannot be known from the available data is listed under DATA NOTES, not guessed.

export const PAGE_LABELS = {
  homepage: "Home",
  deliver: "Deliver (public page)",
  services: "Services",
  portfolio: "Portfolio",
  toolkit: "Creative Toolkit",
  tools: "Tools (Image Inspector + Creative Assistant)",
  guides: "Guides (hub + 4 guide articles)",
  about: "About",
  support: "Support",
  contact: "Contact"
};
/** Public pages that should normally receive traffic; used to spot pages with no recorded views. */
export const KEY_PAGES = ["homepage", "deliver", "services", "portfolio", "toolkit", "tools", "guides", "about", "support", "contact"];

export const TYPE_LABELS = {
  photoshop_battles: "PhotoshopBattles",
  paid: "Paid Client",
  free: "Free Edit",
  private: "Private Client",
  returning: "Returning Client",
  reddit: "Reddit (not PhotoshopBattles)",
  other: "Other",
  deleted: "Deleted deliveries"
};
/** Display order: the four types the dashboard is organised around first, then the rest. */
export const TYPE_ORDER = ["photoshop_battles", "paid", "free", "private", "returning", "reddit", "other", "deleted"];
/** PhotoshopBattles images are public direct links, so a "download" is not something that can happen to them. */
const CLIENT_TYPES = ["paid", "free", "private", "returning"];

export const PERIODS = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All available"]];
export const periodLabel = key => (key === "all" ? "All available data" : `Last ${PERIODS.find(([k]) => k === key)?.[1] ?? key}`);

/* ------------------------------------------------------------------ numbers */
const n0 = v => Number(v) || 0;
export const fmt = v => n0(v).toLocaleString("en-US");
export const pctOf = (part, whole) => (n0(whole) > 0 ? Math.round((n0(part) / n0(whole)) * 100) : null);
/** Whole-percent change, or null when there is no (or an empty) earlier period to compare with. */
export function pctChange(current, previous) {
  if (previous === null || previous === undefined || !n0(previous)) return null;
  return Math.round(((n0(current) - n0(previous)) / n0(previous)) * 100);
}
/** "12.4" — one decimal, or "—" when the denominator is zero (a ratio of nothing is not zero). */
export const per100 = (num, views) => (n0(views) > 0 ? (Math.round((n0(num) / n0(views)) * 1000) / 10).toFixed(1) : "—");
export const perDelivery = (views, active) => (n0(active) > 0 ? (Math.round((n0(views) / n0(active)) * 10) / 10).toFixed(1) : "—");
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const signed = p => `${p > 0 ? "+" : ""}${p}%`;

/** Below this many events in the previous period a percentage swing is noise, so no observation is made. */
export const MIN_COMPARE_BASE = 20;
/** A change smaller than this (in whole percent) is not called out. */
export const NOTABLE_CHANGE = 25;

/* ------------------------------------------------------------------- model */
/**
 * Turns the Worker summary into the model both the UI and the report use. `summary` may be null when the
 * Worker has not been updated yet; `fallbackPages` (the older 30-day /analytics/pages result) then keeps the
 * website block alive in a clearly-labelled limited mode.
 */
export function buildModel({ periodKey, summary, fallbackPages = null }) {
  const model = {
    periodKey,
    periodLabel: periodLabel(periodKey),
    range: summary ? { since: summary.period.since, until: summary.period.until } : null,
    previous: summary?.period?.previous ?? null,
    limited: !summary,
    website: { available: false, pages: [], total: 0, prevTotal: null, dataSince: null },
    deliver: { available: false, types: [], totals: { views: 0, downloads: 0, shares: 0, active: 0 }, prevTotals: null, stored: {} },
    ga4: { available: false }
  };

  if (summary) {
    const pages = summary.website.pages.map(p => ({ page: p.page, label: PAGE_LABELS[p.page] || p.page, views: n0(p.views), prev: p.prev_views === null ? null : n0(p.prev_views) }));
    model.website = { available: true, pages, total: n0(summary.website.total_views), prevTotal: summary.website.prev_total_views === null ? null : n0(summary.website.prev_total_views), dataSince: summary.website.data_since };

    const types = summary.deliver.types.map(t => ({
      type: t.type, label: TYPE_LABELS[t.type] || t.type, active: n0(t.deliveries_active), views: n0(t.views), downloads: n0(t.downloads), shares: n0(t.shares),
      prevViews: t.prev_views === null ? null : n0(t.prev_views), prevDownloads: t.prev_downloads === null ? null : n0(t.prev_downloads), prevShares: t.prev_shares === null ? null : n0(t.prev_shares)
    }));
    // Always list the four headline types, even at zero, so a missing type is visible rather than absent.
    for (const t of ["photoshop_battles", "paid", "free", "private"]) {
      if (!types.some(x => x.type === t)) types.push({ type: t, label: TYPE_LABELS[t], active: 0, views: 0, downloads: 0, shares: 0, prevViews: summary.period.previous ? 0 : null, prevDownloads: summary.period.previous ? 0 : null, prevShares: summary.period.previous ? 0 : null });
    }
    types.sort((a, b) => (TYPE_ORDER.indexOf(a.type) + 1 || 99) - (TYPE_ORDER.indexOf(b.type) + 1 || 99));
    const sum = key => types.reduce((t, x) => t + x[key], 0);
    const hasPrev = summary.period.previous !== null;
    model.deliver = {
      available: true, types, stored: summary.deliver.stored || {},
      totals: { views: sum("views"), downloads: sum("downloads"), shares: sum("shares"), active: sum("active") },
      prevTotals: hasPrev ? { views: sum("prevViews"), downloads: sum("prevDownloads"), shares: sum("prevShares") } : null
    };
  } else if (Array.isArray(fallbackPages)) {
    const rows = fallbackPages;  // the public Deliver page (deliver.html) is website traffic
    model.website = { available: true, pages: rows.map(p => ({ page: p.page, label: PAGE_LABELS[p.page] || p.page, views: n0(p.views), prev: null })), total: rows.reduce((t, p) => t + n0(p.views), 0), prevTotal: null, dataSince: null };
    model.periodLabel = "Last 30 days (fixed — Worker update not deployed)";
  }
  return model;
}

/* ------------------------------------------------------------ observations */
/**
 * Evidence-based observations. Each item: { text, area }. Wording is deliberately cautious — it states what the
 * counters show and, where a cause could be assumed, says the data does not establish one.
 */
export function buildObservations(model) {
  const out = [];
  const add = (text, area) => out.push({ text, area });
  const w = model.website, d = model.deliver;

  if (w.available && w.total > 0) {
    const top = w.pages[0];
    const share = pctOf(top.views, w.total);
    add(share >= 50
      ? `Traffic is concentrated in one page: ${top.label} received ${fmt(top.views)} of ${fmt(w.total)} counted page views (${share}%).`
      : `${top.label} is the most-viewed page with ${fmt(top.views)} of ${fmt(w.total)} counted page views (${share}%); views are spread across several pages.`, "website");

    const change = pctChange(w.total, w.prevTotal);
    if (change !== null && w.prevTotal >= MIN_COMPARE_BASE && Math.abs(change) >= NOTABLE_CHANGE) {
      add(`Counted page views are ${change > 0 ? "up" : "down"} ${Math.abs(change)}% on the previous period (${fmt(w.prevTotal)} → ${fmt(w.total)}). The data does not establish the cause.`, "website");
    } else if (w.prevTotal !== null && w.prevTotal < MIN_COMPARE_BASE) {
      add(`The previous period has only ${fmt(w.prevTotal)} counted page views, too few to say whether traffic has changed.`, "website");
    }

    const moved = w.pages.filter(p => p.prev !== null && p.prev >= MIN_COMPARE_BASE && Math.abs(pctChange(p.views, p.prev)) >= 40)
      .sort((a, b) => Math.abs(b.views - b.prev) - Math.abs(a.views - a.prev))[0];
    if (moved) {
      const c = pctChange(moved.views, moved.prev);
      add(`${moved.label} changed the most: ${signed(c)} (${fmt(moved.prev)} → ${fmt(moved.views)} views). This may be worth investigating.`, "website");
    }

    if (w.total >= MIN_COMPARE_BASE) {
      // Creative Toolkit has its own note just below (it can be a tracking gap), so it is not listed here.
      const silent = KEY_PAGES.filter(k => k !== "toolkit" && !w.pages.some(p => p.page === k && p.views > 0)).map(k => PAGE_LABELS[k]);
      if (silent.length) add(`No counted views in this period for: ${silent.join("; ")}. This may be worth investigating.`, "website");
      if (!w.pages.some(p => p.page === "toolkit" && p.views > 0)) {
        add("Creative Toolkit shows no counted views. Page views for it are only recorded once the Worker update that adds the 'toolkit' page key is deployed, so this can be a tracking gap rather than a lack of visits.", "website");
      }
    }
  } else if (w.available) {
    add("No website page views were counted in this period.", "website");
  }

  if (d.available) {
    const t = d.totals;
    if (t.views > 0) {
      const topType = [...d.types].sort((a, b) => b.views - a.views)[0];
      add(`Deliver activity is concentrated in ${topType.label}: ${fmt(topType.views)} of ${fmt(t.views)} Deliver views (${pctOf(topType.views, t.views)}%). These are Deliver views, not website visits.`, "deliver");
    }
    const dc = d.prevTotals ? pctChange(t.views, d.prevTotals.views) : null;
    if (dc !== null && d.prevTotals.views >= MIN_COMPARE_BASE && Math.abs(dc) >= NOTABLE_CHANGE) {
      add(`Deliver views are ${dc > 0 ? "up" : "down"} ${Math.abs(dc)}% on the previous period (${fmt(d.prevTotals.views)} → ${fmt(t.views)}). The data does not establish the cause.`, "deliver");
    }
    const battles = d.types.find(x => x.type === "photoshop_battles");
    if (battles && battles.views > 0) {
      const bc = battles.prevViews !== null ? pctChange(battles.views, battles.prevViews) : null;
      add(`PhotoshopBattles images received ${fmt(battles.views)} views across ${fmt(battles.active)} image${battles.active === 1 ? "" : "s"}${battles.shares ? ` and ${fmt(battles.shares)} share${battles.shares === 1 ? "" : "s"}` : ""}${bc !== null && battles.prevViews >= MIN_COMPARE_BASE ? `; views are ${bc === 0 ? "unchanged" : `${bc > 0 ? "up" : "down"} ${Math.abs(bc)}%`} on the previous period` : ""}.`, "deliver");
    }
    for (const type of d.types.filter(x => CLIENT_TYPES.includes(x.type) && x.views >= 10 && x.downloads === 0)) {
      add(`${type.label} deliveries were viewed ${fmt(type.views)} times with no recorded downloads. This may be worth investigating; the counters do not show why.`, "deliver");
    }
  }
  return out;
}

/** Short list of things worth a closer look — derived from the same facts, never from guesses. */
export function buildAreasToInvestigate(model) {
  const out = [];
  const w = model.website, d = model.deliver;
  out.push("Traffic sources, users, sessions, engagement and click behaviour are not visible in Command Centre. They sit in GA4 only; connecting the GA4 Data API would bring them here.");
  if (w.available && w.total >= MIN_COMPARE_BASE) {
    const top = w.pages[0];
    if (pctOf(top.views, w.total) >= 50) out.push(`Whether the traffic that lands on ${top.label} goes anywhere afterwards (needs GA4 data: entrances and clicks).`);
    const silent = KEY_PAGES.filter(k => k !== "toolkit" && !w.pages.some(p => p.page === k && p.views > 0));
    if (silent.length) out.push(`Pages with no counted views: ${silent.map(k => PAGE_LABELS[k]).join("; ")} — are they linked prominently enough, or only rarely visited?`);
  }
  if (w.available && !w.pages.some(p => p.page === "toolkit" && p.views > 0)) out.push("Deploy the Worker update so Creative Toolkit page views start being counted, then re-check.");
  if (d.available) {
    const noDl = d.types.filter(x => CLIENT_TYPES.includes(x.type) && x.views >= 10 && x.downloads === 0).map(x => x.label);
    if (noDl.length) out.push(`Client deliveries viewed but not downloaded: ${noDl.join(", ")}.`);
    const b = d.types.find(x => x.type === "photoshop_battles");
    if (b && b.views > 0 && b.shares === 0) out.push("PhotoshopBattles images are being viewed but not shared from the delivery page — direct Reddit views may simply not offer a share action.");
  }
  return out.slice(0, 6);
}

/* ------------------------------------------------------------------ report */
const pad2 = v => String(v).padStart(2, "0");
/** "2026-10-04 21:44" in the browser's local time. */
export function stamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "-56% vs previous period: 200" — plain wording, no parentheses (callers add their own). */
function changeCore(current, previous, base = MIN_COMPARE_BASE) {
  if (previous === null || previous === undefined) return "";
  if (previous === 0) return current > 0 ? "no activity in the previous period" : "no activity in either period";
  if (previous < base) return `previous period: ${fmt(previous)}, too few to compare`;
  const c = pctChange(current, previous);
  return `${c === 0 ? "no change" : signed(c)} vs previous period: ${fmt(previous)}`;
}
const changeText = (current, previous) => { const t = changeCore(current, previous); return t ? ` (${t})` : ""; };

/** The plain-text report Clint pastes into ChatGPT. Returns a string. */
export function buildReport(model, { generatedAt = new Date() } = {}) {
  const w = model.website, d = model.deliver;
  const L = [];
  const line = (s = "") => L.push(s);

  line("BOZTIK ANALYTICS REPORT");
  line(`Reporting period: ${model.periodLabel}${model.range?.since ? ` (${model.range.since} to ${model.range.until})` : ""}`);
  if (model.previous) line(`Compared with: previous equal period (${model.previous.since} to ${model.previous.until})`);
  line(`Generated: ${stamp(generatedAt)} (local time)`);
  line("Two separate data sources are used below. Website traffic (first-party page-view counter, including the public Deliver page deliver.html) and private Deliver activity (Deliver's own counters) are never added together.");
  if (model.limited) line("NOTE: limited mode — the Worker summary endpoint is not deployed yet, so only the last 30 days of website page views are available.");

  line();
  line("TRAFFIC (website)");
  if (w.available) {
    line(`- Page views (counted page loads): ${fmt(w.total)}${changeText(w.total, w.prevTotal)}`);
    line(`- Most-viewed page: ${w.total > 0 ? `${w.pages[0].label} (${fmt(w.pages[0].views)} views, ${pctOf(w.pages[0].views, w.total)}%)` : "none recorded"}`);
  } else line("- Page views: unavailable");
  line("- Users, sessions, engagement rate, new vs returning users: NOT AVAILABLE here (GA4 only; Command Centre has no GA4 connection).");

  line();
  line("TRAFFIC SOURCES");
  line("NOT AVAILABLE here. Sources (Google, Reddit, Direct, Social, Referral) exist only in GA4. The first-party counter deliberately records no referrer.");

  line();
  line("TOP PAGES (website, ranked by counted page views)");
  if (w.available && w.pages.length) {
    w.pages.forEach((p, i) => line(`${i + 1}. ${p.label}: ${fmt(p.views)} views (${[`${pctOf(p.views, w.total) ?? 0}% of total`, p.prev !== null ? changeCore(p.views, p.prev) : ""].filter(Boolean).join("; ")})`));
    const missing = KEY_PAGES.filter(k => !w.pages.some(p => p.page === k && p.views > 0)).map(k => PAGE_LABELS[k]);
    if (missing.length) line(`No counted views: ${missing.join("; ")}`);
  } else line("No page views counted in this period.");
  line("Per-page entrances, engagement and onward clicks are not available here (GA4 only).");

  line();
  line("IMPORTANT ACTIONS (clicks)");
  line("NOT AVAILABLE here. Clicks on the Chrome Web Store, Edge store, Ko-fi, PayPal, email, portfolio and product links are sent to GA4 as the event 'boztik_action' (parameters: action, destination, position, page_key). They can be read in GA4 (Reports > Engagement > Events) but not in Command Centre until the GA4 Data API is connected.");

  line();
  line("DELIVER USAGE (PRIVATE DELIVERY ACTIVITY — separate from website/GA4 traffic; the public Deliver page deliver.html is counted under website traffic above)");
  if (d.available) {
    line(`Totals: ${plural(d.totals.views, "view")}, ${plural(d.totals.downloads, "download")}, ${plural(d.totals.shares, "share")}${d.prevTotals ? `; views: ${changeCore(d.totals.views, d.prevTotals.views)}` : ""}`);
    for (const t of d.types) {
      if (t.type === "deleted" && !t.views && !t.downloads && !t.shares) continue;
      line(`- ${t.label}: ${plural(t.views, "view")}; ${plural(t.downloads, "download")}; ${plural(t.shares, "share")}; ${per100(t.downloads, t.views)} downloads per 100 views; ${per100(t.shares, t.views)} shares per 100 views; ${perDelivery(t.views, t.active)} views per active delivery (${plural(t.active, "delivery", "deliveries")} with activity)${t.prevViews !== null ? `; views: ${changeCore(t.views, t.prevViews)}` : ""}`);
    }
  } else line("Unavailable (Worker summary endpoint not deployed). The all-time table in Command Centre → Analytics still shows lifetime figures per delivery type.");

  line();
  line("KEY OBSERVATIONS");
  const obs = buildObservations(model);
  if (obs.length) obs.forEach(o => line(`- ${o.text}`)); else line("- Not enough recorded activity to draw any observation.");

  line();
  line("AREAS TO INVESTIGATE");
  buildAreasToInvestigate(model).forEach(a => line(`- ${a}`));

  line();
  line("DATA NOTES");
  line("- Website page views come from Boztik's own first-party counter (js/pageview.js). It counts page loads, not people; it ignores visitors who send Do Not Track or Global Privacy Control; it may include some automated traffic; it does not de-duplicate repeat loads.");
  line(`- Website counter data begins ${w.dataSince ? `on ${w.dataSince}` : "on an unknown date"}; earlier traffic is not in these numbers.${model.periodKey === "all" ? " 'All available' therefore starts there." : ""}`);
  line("- Numbers here will not match GA4: GA4 counts differently (users, sessions, consent and filtering) and is not connected to Command Centre.");
  line("- Creative Toolkit page views are only counted after the Worker update adding the 'toolkit' page key is deployed; earlier views were not recorded.");
  line("- Legal pages (Privacy, Terms) send no page-view and are not counted as website traffic. The public Deliver page (deliver.html) IS counted as a website page; private delivery activity is reported below under Deliver usage.");
  line("- Deliver views count every load of a delivery page or direct image link, including repeat views. PhotoshopBattles images are public direct links, so they register views only (no downloads), and Reddit/browser caching can hide repeat views.");
  line("- Deliver shares include completed copies/system shares and opened WhatsApp/Facebook/X/Reddit sheets (attempts); a published post cannot be confirmed.");
  line("- Deliveries that were deleted keep their historical counts but no longer have a stored type; they appear as 'Deleted deliveries'. 'Views per active delivery' divides by deliveries with at least one view or download in the period.");
  line("- Percentage changes are only commented on when the previous period had at least 20 events; below that they are shown as 'too few to compare'.");
  return L.join("\n");
}
