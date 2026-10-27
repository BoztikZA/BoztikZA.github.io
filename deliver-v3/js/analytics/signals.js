// "What stands out": rule-based signals, every one traceable to numbers in the model. PURE.
//
// Each signal: { id, level, title, detail, evidence: [{label, value}], basis }
//   level  "notable" (worth a look) | "watch" (check the tracking/data) | "info"
//   basis  "measured" | "derived": says whether the headline number is recorded or calculated
// No signal claims a cause. Wording says what the counters show and, where a cause is tempting, that the data does
// not establish one. Signals need enough data to mean something (thresholds below) and stay silent otherwise.
import { fmtInt, shortDate } from "./chart-math.js";
import { SOURCE_LABELS, comparisonNote } from "./model.js";

export const NOTABLE_CHANGE = 25;   // whole-percent like-for-like change worth flagging
export const SPIKE_FACTOR = 2.5;    // a day this many times the median day
export const MIN_SPIKE_VIEWS = 15;
export const CONCENTRATION = 60;    // one page / source carrying this share of the total
export const MIN_TOTAL_FOR_SHARES = 20;
export const QUIET_DAYS = 3;

const median = arr => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const signed = n => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}%`;

export function buildSignals(model) {
  const out = [];
  if (!model) return out;
  const { trend, cmp, pages, sources, store, granularity } = model;
  const daily = granularity === "day" && trend;

  // 1. like-for-like movement in page views
  const w = cmp?.website_views;
  if (daily && w?.status === "ok" && Math.abs(w.change) >= NOTABLE_CHANGE) {
    out.push({
      id: "views-change", level: "notable", basis: "derived",
      title: `Page views ${w.change > 0 ? "up" : "down"} ${Math.abs(w.change)}% on the previous period`,
      detail: `${fmtInt(w.current)} page views in ${w.used} completed days versus ${fmtInt(w.previous)} in the matching days before.${w.excluded ? " Today's unfinished count is left out so it cannot look like a drop." : ""} Page views are counted per page load, not per person. This shows a change, not why it happened.`,
      evidence: [{ label: "This period", value: fmtInt(w.current) }, { label: "Previous", value: fmtInt(w.previous) }, { label: "Change", value: signed(w.change) }],
    });
  } else if (daily && w && w.status === "small-base") {
    out.push({ id: "views-small", level: "info", basis: "measured", title: "Too little earlier traffic to compare", detail: comparisonNote(w, { noun: "page views" }), evidence: [{ label: "Previous", value: fmtInt(w.previous) }] });
  }

  // 2. one standout day
  if (daily) {
    const days = trend.buckets.filter(b => !b.partial && !b.future && b.website_views !== null);
    if (days.length >= 5) {
      const med = median(days.map(b => b.website_views));
      const peak = days.reduce((a, b) => (b.website_views > a.website_views ? b : a));
      if (peak.website_views >= MIN_SPIKE_VIEWS && peak.website_views >= SPIKE_FACTOR * Math.max(med, 1)) {
        out.push({
          id: "spike", level: "notable", basis: "measured",
          title: `${shortDate(peak.start)} stood out with ${fmtInt(peak.website_views)} page views`,
          detail: `The typical day in this range had ${fmtInt(Math.round(med))}. The counters do not record what caused the spike; the traffic-source table below may show where visits came from.`,
          evidence: [{ label: "Peak day", value: fmtInt(peak.website_views) }, { label: "Median day", value: fmtInt(Math.round(med)) }],
        });
      }
      // 3. tracking may have stopped: recent completed days all zero after real activity
      const tail = days.slice(-QUIET_DAYS);
      const before = days.slice(0, -QUIET_DAYS);
      if (tail.length === QUIET_DAYS && tail.every(b => b.website_views === 0) && before.reduce((t, b) => t + b.website_views, 0) >= 20) {
        out.push({
          id: "quiet", level: "watch", basis: "measured",
          title: `No page views recorded for the last ${QUIET_DAYS} completed days`,
          detail: "Earlier days in this range had traffic. This can be a genuine quiet spell or a tracking problem (a deploy that dropped the page-view script, an outage). Open the public site and confirm a view is recorded before drawing conclusions.",
          evidence: [{ label: "Days at zero", value: String(QUIET_DAYS) }, { label: "Earlier total", value: fmtInt(before.reduce((t, b) => t + b.website_views, 0)) }],
        });
      }
    }
  }

  // 4. page concentration
  const total = model.totals?.website_views ?? 0;
  if (total >= MIN_TOTAL_FOR_SHARES && pages?.length) {
    const top = pages[0];
    if (top && top.share !== null && top.share >= CONCENTRATION) {
      out.push({
        id: "page-concentration", level: "info", basis: "derived",
        title: `${top.label} carries ${top.share}% of page views`,
        detail: "Most measured views land on one page. That is not a problem in itself, but pages further down the list are getting little exposure.",
        evidence: [{ label: top.label, value: `${fmtInt(top.views)} of ${fmtInt(total)}` }],
      });
    }
  }

  // 5. source concentration and unknown share
  if (sources && sources.total >= MIN_TOTAL_FOR_SHARES) {
    const ranked = [...sources.rows].sort((a, b) => b.visits - a.visits);
    const lead = ranked[0];
    if (lead.share !== null && lead.share >= CONCENTRATION) {
      const hidden = lead.key === "direct_unknown";
      out.push({
        id: "source-lead", level: "info", basis: "derived",
        title: `${SOURCE_LABELS[lead.key]} accounts for ${lead.share}% of visits`,
        detail: hidden
          ? "“Direct / unknown” includes visits whose referrer was missing or hidden by the browser, so it is not proof people typed the address in."
          : `${fmtInt(lead.visits)} of ${fmtInt(sources.total)} visits with a recorded source. A referring site shows where a visit came from, not what the visitor did next.`,
        evidence: [{ label: SOURCE_LABELS[lead.key], value: `${fmtInt(lead.visits)} visits` }, { label: "All sources", value: fmtInt(sources.total) }],
      });
    }
    const reddit = sources.rows.find(r => r.key === "reddit");
    if (reddit && sources.previousTotal !== null && reddit.visits >= 10 && sources.total > 0) {
      // informational only: reddit is the channel Boztik actively posts to
      out.push({ id: "reddit", level: "info", basis: "measured", title: `${fmtInt(reddit.visits)} visits came from Reddit`, detail: "Referrer is reddit.com, redd.it or redditmedia.com. This counts landings, not upvotes, comments or sign-ups.", evidence: [{ label: "Reddit visits", value: fmtInt(reddit.visits) }, { label: "Share", value: reddit.share === null ? "—" : `${reddit.share}%` }] });
    }
  }

  // 6. store page traffic without outbound clicks
  if (store && (store.store_page_views ?? 0) >= 30 && (store.outbound_total ?? 0) === 0) {
    out.push({
      id: "store-no-clicks", level: "watch", basis: "measured",
      title: "Store page views but no store-link clicks",
      detail: `${fmtInt(store.store_page_views)} views of the Stores page and no recorded outbound clicks. Either nobody clicked or click tracking is not recording; open a store link on the live site and check it appears under Store clicks.`,
      evidence: [{ label: "Stores page views", value: fmtInt(store.store_page_views) }, { label: "Outbound clicks", value: "0" }],
    });
  }

  // 7. Deliver: views with no downloads
  const d = model.deliver?.available ? model.deliver.totals : null;
  if (d && d.views >= 30 && d.downloads === 0) {
    out.push({
      id: "deliver-no-downloads", level: "watch", basis: "measured",
      title: "Deliver views but no downloads",
      detail: `${fmtInt(d.views)} Deliver views and no downloads in this period. Downloads can be disabled on a delivery or blocked by the link's rules, so check one live delivery before assuming a fault.`,
      evidence: [{ label: "Views", value: fmtInt(d.views) }, { label: "Downloads", value: "0" }],
    });
  }

  // 8. data-health caveats
  const cov = model.coverage?.website_views;
  if (cov && cov.since && trend && trend.buckets.length && cov.since > trend.buckets[0].start.slice(0, 10) && granularity === "day") {
    out.push({ id: "coverage-start", level: "info", basis: "measured", title: "Page-view counting started inside this range", detail: `First measured day is ${shortDate(cov.since)}. Earlier days are shown as “not measured”, not as zero, and are left out of comparisons.`, evidence: [{ label: "Counting since", value: cov.since }] });
  }
  if (granularity === "hour" && cov?.session_coverage_pct !== undefined && cov.session_coverage_pct !== null) {
    out.push({ id: "hourly-basis", level: "info", basis: "derived", title: "Hourly page views are an approximation", detail: `The hour-by-hour line comes from per-visit session events, which cover about ${cov.session_coverage_pct}% of today's page views. The daily total is exact; the hourly shape is partial.`, evidence: [{ label: "Session coverage", value: `${cov.session_coverage_pct}%` }] });
  }

  const rank = { watch: 0, notable: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
