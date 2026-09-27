// Milestone notification engine (backend-only).
//
// Runs inside ctx.waitUntil so it can NEVER block, slow, or break the request
// that produced the analytics event. All failures are logged and swallowed.
//
// Deduplication: notify_milestones (PK metric+milestone) is the source of truth.
// A milestone is claimed with INSERT OR IGNORE before emailing, so concurrent
// events cannot double-send. Baseline init records the sentinel -1 once; every
// threshold already passed at that first run is marked "sent" WITHOUT emailing,
// so existing production data can never trigger a flood of historical emails.
import type { Env } from "../types";
import type { MilestoneMetric } from "./milestones";
import { milestoneEmailContent, reachedMilestones, thresholdsFor } from "./milestones";

const nowSec = () => Math.floor(Date.now() / 1000);

/** Master on/off switch. Default ON; set MILESTONE_EMAILS_ENABLED=0 to disable
 *  the feature without touching the code. */
export function milestoneNotificationsEnabled(env: Env): boolean {
  const v = env.MILESTONE_EMAILS_ENABLED;
  return v === undefined || v === "" || v === "1";
}

/** Lifetime cumulative count for a metric across the whole system. */
export async function currentMilestoneCount(env: Env, metric: MilestoneMetric): Promise<number> {
  if (metric === "shares") {
    const r = await env.DB
      .prepare("SELECT COALESCE(SUM(count),0) AS n FROM share_metrics WHERE kind = 'completed'")
      .first<{ n: number }>();
    return r?.n ?? 0;
  }
  if (metric === "deliveries") {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries").first<{ n: number }>();
    return r?.n ?? 0;
  }
  // deliveries rows are never deleted, so SUM(view_count) / SUM(download_count)
  // are exact lifetime totals. `col` is drawn from a fixed allow-list below.
  const col = metric === "views" ? "view_count" : "download_count";
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(${col}),0) AS n FROM deliveries`).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Schedule the milestone engine in the background. Returns immediately; it never
 *  awaits email/network, so a slow or failing notification cannot affect the event
 *  that triggered it. */
export function queueMilestoneCheck(env: Env, ctx: ExecutionContext, metric: MilestoneMetric): void {
  ctx.waitUntil(
    runMilestoneCheck(env, metric).catch((e) => {
      console.error(`[milestones] check failed for ${metric}`, e);
    }),
  );
}

async function runMilestoneCheck(env: Env, metric: MilestoneMetric): Promise<void> {
  const count = await currentMilestoneCount(env, metric);
  if (!Number.isFinite(count) || count < 1) return;
  const ts = nowSec();
  const base = env.DB.prepare(
    "INSERT OR IGNORE INTO notify_milestones (metric, milestone, sent_at) VALUES (?, -1, ?)",
  ).bind(metric, ts);
  const marker = await base.run();
  const initialized = (marker.meta.changes ?? 0) === 0;

  if (!initialized) {
    // First time this metric is seen: capture the baseline. Mark every already
    // reached threshold as handled WITHOUT emailing, then stop.
    const past = thresholdsFor(metric, count);
    if (past.length) {
      await env.DB.batch(
        past.map((t) =>
          env.DB.prepare("INSERT OR IGNORE INTO notify_milestones (metric, milestone, sent_at) VALUES (?, ?, ?)")
            .bind(metric, t, ts),
        ),
      );
    }
    return;
  }

  const rows = await env.DB
    .prepare("SELECT milestone FROM notify_milestones WHERE metric = ? AND milestone >= 0")
    .bind(metric)
    .all<{ milestone: number }>();
  const already = new Set((rows?.results ?? []).map((r) => r.milestone));
  for (const t of reachedMilestones(metric, count, already, true)) {
    // Atomic claim: only one request wins the INSERT, guaranteeing one email.
    const claim = await env.DB
      .prepare("INSERT OR IGNORE INTO notify_milestones (metric, milestone, sent_at) VALUES (?, ?, ?)")
      .bind(metric, t, ts)
      .run();
    if ((claim.meta.changes ?? 0) !== 1) continue; // a concurrent request claimed it
    await sendMilestoneEmail(env, metric, t); // isolated; never throws
  }
}

/** Send one milestone email, best effort. Never throws — a notification failure
 *  must not leak a provider error to a delivery visitor. Uses outbound email
 *  configuration from secrets (never hard-coded). Returns nothing useful. */
async function sendMilestoneEmail(env: Env, metric: MilestoneMetric, milestone: number): Promise<void> {
  try {
    const to = env.NOTIFY_EMAIL_TO?.trim();
    const from = env.NOTIFY_EMAIL_FROM?.trim();
    const url = env.EMAIL_PROVIDER_URL?.trim();
    if (!to || !from || !url) {
      console.error(`[milestones] email not configured (need NOTIFY_EMAIL_TO, NOTIFY_EMAIL_FROM, EMAIL_PROVIDER_URL) — ${metric} ${milestone} NOT emailed`);
      return;
    }
    const content = milestoneEmailContent(metric, milestone);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.EMAIL_PROVIDER_KEY) headers.Authorization = `Bearer ${env.EMAIL_PROVIDER_KEY}`;
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ from, to, subject: content.subject, text: content.text, html: content.html }),
    });
    if (!resp.ok) {
      console.error(`[milestones] email provider returned ${resp.status} for ${metric} ${milestone}`);
      const body = await resp.text().catch(() => "");
      if (body) console.error(`[milestones] provider body: ${body.slice(0, 500)}`);
    }
  } catch (e) {
    console.error(`[milestones] send failed for ${metric} ${milestone}`, e);
  }
}