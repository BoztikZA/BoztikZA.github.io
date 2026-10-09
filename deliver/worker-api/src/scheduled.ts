import type { Env } from "./types";
import { runMaintenance } from "./lib/cleanup";

/** Cron entrypoint (every 10 minutes): expiry and page-view event cleanup,
 *  abandoned-upload and orphan sweeps, storage reconciliation, housekeeping. */
export async function scheduled(env: Env): Promise<void> {
  const report = await runMaintenance(env);
  console.log("maintenance", JSON.stringify(report));
}
