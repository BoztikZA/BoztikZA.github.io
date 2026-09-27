// Pure milestone rules for the Boztik Command Centre milestone emails.
// No D1 / network / IO — trivially unit-testable via scripts/milestone-test.mjs.

export type MilestoneMetric = "views" | "downloads" | "shares" | "deliveries";

// A real "share" is a COMPLETED share/copy (native sheet or copied link). The
// "attempted" rows only mean an external share sheet was opened, which is not a
// share that the person actually completed, so they are excluded here.
export const SHARES_COMPLETED_KIND = "completed";

// Deliveries milestones (multiples are NOT appropriate — a solo creator gets
// meaningful landmarks instead), then a sensible ×2.5 / ×2 / ×2 ladder keeps
// growing without inventing excessive intermediate milestones.
const DELIVERY_HEAD = [10, 25, 50, 100, 250, 500, 1000];
const DELIVERY_STEPS = [2.5, 2, 2];

/** Regular spacing per metric, or null for the irregular deliveries ladder. */
export function metricStep(metric: MilestoneMetric): number | null {
  if (metric === "views") return 1000;
  if (metric === "downloads" || metric === "shares") return 10;
  return null;
}

/** All milestone thresholds for a metric that are `> 0` and `<= upTo`. */
export function thresholdsFor(metric: MilestoneMetric, upTo: number): number[] {
  if (!Number.isFinite(upTo) || upTo < 1) return [];
  const step = metricStep(metric);
  if (step) {
    const out: number[] = [];
    for (let v = step; v <= upTo; v += step) out.push(v);
    return out;
  }
  // deliveries
  const out: number[] = [];
  for (const h of DELIVERY_HEAD) if (h <= upTo) out.push(h);
  let next = DELIVERY_HEAD[DELIVERY_HEAD.length - 1]!; // last fixed head
  let i = 0;
  for (;;) {
    next = Math.round(next * DELIVERY_STEPS[i % DELIVERY_STEPS.length]!);
    i++;
    if (next > upTo) break;
    out.push(next);
  }
  return out;
}

/** Milestones reached at `count` that are not already in `alreadySent`. During
 *  the baseline window (`initialized === false`) it returns [] so historical
 *  data can never trigger a flood of past milestone emails. */
export function reachedMilestones(
  metric: MilestoneMetric,
  count: number,
  alreadySent: ReadonlySet<number>,
  initialized: boolean,
): number[] {
  if (!initialized) return [];
  const sent = new Set(alreadySent);
  return thresholdsFor(metric, count).filter((t) => !sent.has(t));
}

/** The next milestone strictly above `milestone` (for "Next stop: N."). */
export function nextMilestone(metric: MilestoneMetric, milestone: number): number | null {
  const step = metricStep(metric);
  if (step) return milestone + step;
  return thresholdsFor(metric, milestone * 10).find((t) => t > milestone) ?? null;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

function buildBody(metric: MilestoneMetric, milestone: number): string {
  const m = fmt(milestone);
  const next = nextMilestone(metric, milestone);
  const stop = next === null ? "" : `Next stop: ${fmt(next)}.`;
  switch (metric) {
    case "views":
      return [
        "BOZTIK COMMAND CENTRE",
        `You just hit ${m} views.`,
        `${m} times someone opened a delivery through your system.`,
        "That's a pretty good little milestone.",
        "Keep building.",
      ].join("\n");
    case "downloads":
      return [
        "BOZTIK COMMAND CENTRE",
        `${m} downloads.`,
        `${m} people have downloaded files through your delivery system.`,
        "Another milestone reached.",
        stop,
      ].join("\n");
    case "shares":
      return [
        "BOZTIK COMMAND CENTRE",
        `${m} shares.`,
        `Your deliveries have now been shared ${m} times.`,
        "That's a sign the system is getting used beyond the original delivery.",
        "Keep going.",
      ].join("\n");
    case "deliveries":
      return [
        "BOZTIK COMMAND CENTRE",
        `${m} deliveries.`,
        `You've created ${m} deliveries through the Command Centre.`,
        stop,
      ].join("\n");
  }
}

function toHtml(text: string): string {
  const p = text.split("\n").map((l) => `  <div>${l}</div>`).join("\n");
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;line-height:1.55;padding:16px 0;">\n${p}\n</div>`;
}

/** Email payload for a milestone. Subject + plain text + a small HTML mirror. */
export function milestoneEmailContent(metric: MilestoneMetric, milestone: number): { subject: string; text: string; html: string } {
  const label =
    metric === "views" ? "views" : metric === "downloads" ? "downloads" : metric === "shares" ? "shares" : "deliveries";
  const subject = metric === "views"
    ? `You just hit ${fmt(milestone)} views`
    : `${fmt(milestone)} ${label}`;
  const text = buildBody(metric, milestone);
  return { subject: `BOZTIK COMMAND CENTRE — ${subject}`, text, html: toHtml(text) };
}