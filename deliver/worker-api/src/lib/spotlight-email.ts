import type { Env } from "../types";

const nowSec = () => Math.floor(Date.now() / 1000);
const emailId = () => crypto.randomUUID().replace(/-/g, "");

export async function enqueueSpotlightEmail(
  env: Env,
  profileId: string,
  kind: "new_submission" | "declined",
  recipient: string | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO spotlight_email_outbox
       (id,profile_id,kind,recipient,state,attempts,next_attempt_at,created_at)
     VALUES (?,?,?,?,'pending',0,?,?)`,
  ).bind(emailId(), profileId, kind, recipient, nowSec(), nowSec()).run();
}

export interface SpotlightEmailReport {
  sent: number;
  deferred: number;
}

export async function processSpotlightEmailOutbox(
  env: Env,
  max = 10,
  profileId?: string,
  kind?: "new_submission" | "declined",
): Promise<SpotlightEmailReport> {
  const timestamp = nowSec();
  const due = await env.DB.prepare(
    `SELECT e.id,e.profile_id,e.kind,e.recipient,e.attempts,
            p.display_name,p.category,p.tagline,p.contact_email,p.website_url,p.slug,p.decline_reason
       FROM spotlight_email_outbox e
       JOIN spotlight_profiles p ON p.id=e.profile_id
      WHERE ((e.state='pending' AND e.next_attempt_at<=?)
         OR (e.state='sending' AND e.locked_until<=?))
        AND (? IS NULL OR e.profile_id=?)
        AND (? IS NULL OR e.kind=?)
      ORDER BY e.created_at
      LIMIT ?`,
  ).bind(timestamp, timestamp, profileId ?? null, profileId ?? null, kind ?? null, kind ?? null, max).all<any>();
  const report: SpotlightEmailReport = { sent: 0, deferred: 0 };

  for (const item of due.results || []) {
    const lockUntil = nowSec() + 60;
    const claimed = await env.DB.prepare(
      `UPDATE spotlight_email_outbox
          SET state='sending',locked_until=?
        WHERE id=? AND ((state='pending' AND next_attempt_at<=?)
                     OR (state='sending' AND locked_until<=?))`,
    ).bind(lockUntil, item.id, nowSec(), nowSec()).run();
    if ((claimed.meta.changes || 0) !== 1) continue;

    const to = String(item.recipient || (item.kind === "new_submission" ? env.NOTIFY_EMAIL_TO || "" : item.contact_email) || "").trim();
    const from = env.NOTIFY_EMAIL_FROM?.trim();
    const url = env.EMAIL_PROVIDER_URL?.trim();
    if (!to || !from || !url) {
      await deferEmail(env, item.id, Number(item.attempts), "email_not_configured");
      report.deferred += 1;
      continue;
    }

    const subject = item.kind === "declined"
      ? "An update on your Boztik Spotlight application"
      : "New Boztik Spotlight submission: " + String(item.display_name);
    const text = item.kind === "declined"
      ? [
        `Hello ${item.display_name},`,
        "",
        "Thank you for applying to Boztik Spotlight. We are unable to publish this application at this time.",
        "",
        "Review note: " + String(item.decline_reason || "Please contact the Spotlight team for more information."),
        "",
        "If you have questions, reply to this email or contact boztiktech@gmail.com.",
        "",
        "The Boztik Spotlight team",
      ].join("\n")
      : [
        "A new Spotlight profile is waiting for review.",
        "",
        "Name: " + String(item.display_name),
        "Category: " + String(item.category),
        "Tagline: " + String(item.tagline),
        "Contact: " + String(item.contact_email || "Not supplied"),
        "Website: " + String(item.website_url || "Not supplied"),
        "",
        "Review it in the Boztik Command Centre > Spotlight.",
        "https://www.boztik.com/deliver-v3/dashboard.html",
        "Submission reference: " + String(item.profile_id),
      ].join("\n");

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Idempotency-Key": String(item.id),
      };
      if (env.EMAIL_PROVIDER_KEY) headers.Authorization = "Bearer " + env.EMAIL_PROVIDER_KEY;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ from, to, subject, text }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        console.warn("[spotlight] email provider returned", response.status, "for outbox item", item.id);
        await deferEmail(env, item.id, Number(item.attempts), "email_provider_http_" + response.status);
        report.deferred += 1;
        continue;
      }
      await env.DB.prepare(
        "UPDATE spotlight_email_outbox SET state='sent',sent_at=?,locked_until=NULL,last_error=NULL WHERE id=? AND state='sending'",
      ).bind(nowSec(), item.id).run();
      report.sent += 1;
    } catch (error) {
      console.error("[spotlight] email send failed for outbox item", item.id, error);
      await deferEmail(env, item.id, Number(item.attempts), "email_provider_unavailable");
      report.deferred += 1;
    }
  }
  return report;
}

async function deferEmail(env: Env, id: string, attempts: number, reason: string): Promise<void> {
  const nextAttempt = nowSec() + Math.min(24 * 60 * 60, 60 * 2 ** Math.min(attempts, 10));
  await env.DB.prepare(
    `UPDATE spotlight_email_outbox
        SET state='pending',attempts=attempts+1,next_attempt_at=?,locked_until=NULL,last_error=?
      WHERE id=? AND state='sending'`,
  ).bind(nextAttempt, reason, id).run();
}
