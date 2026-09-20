import type { Env } from "./types";
import { runMaintenance } from "./lib/cleanup";

/** Cron entrypoint (every 10 minutes): expiry cleanup, abandoned-upload sweep,
 *  orphan sweep, storage reconciliation, housekeeping. */
export async function scheduled(env: Env): Promise<void> {
  const report = await runMaintenance(env);
  console.log("maintenance", JSON.stringify(report));
}
