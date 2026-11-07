import type { Env } from "./types";
import { runMaintenance } from "./lib/cleanup";

/** Cron entrypoint (every 10 minutes): expiry and page-view event cleanup,
 *  abandoned-upload and orphan sweeps, storage reconciliation, housekeeping. */
export async function scheduled(env: Env): Promise<void> {
  const report = await runMaintenance(env);
  // Keep idempotency records bounded; daily aggregate metrics remain for reporting.
  const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM spotlight_events WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM spotlight_visitors WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM spotlight_impressions WHERE created_at < ?").bind(cutoff)
  ]);
  console.log("maintenance", JSON.stringify(report));
}
