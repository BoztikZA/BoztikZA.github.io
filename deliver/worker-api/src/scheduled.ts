import type { Env } from "./types";
import { rotateSpotlightFeature, runMaintenance } from "./lib/cleanup";

/** The minute cron rotates Spotlight; the 10-minute cron runs heavier maintenance. */
export async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  if (event.cron === "* * * * *" && new Date(event.scheduledTime).getUTCMinutes() % 10 !== 0) {
    ctx.waitUntil(rotateSpotlightFeature(env).then(rotation => {
      if (rotation.rotated) console.log("spotlight featured rotation",JSON.stringify(rotation));
    }).catch(error => console.error("spotlight featured rotation failed",error)));
    return;
  }
  const report = await runMaintenance(env);
  try { const rotation = await rotateSpotlightFeature(env); if (rotation.rotated) console.log("spotlight featured rotation",JSON.stringify(rotation)); }
  catch (error) { console.error("spotlight featured rotation failed",error); }
  // Keep idempotency records bounded; daily aggregate metrics remain for reporting.
  const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
  const submissionLimitCutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM spotlight_events WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM spotlight_visitors WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM spotlight_impressions WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM spotlight_submission_limits WHERE window_start < ?").bind(submissionLimitCutoff)
  ]);
  console.log("maintenance", JSON.stringify(report));
}
