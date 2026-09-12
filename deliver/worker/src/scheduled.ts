import type { Env } from "./types";
import * as db from "./lib/db";
import { deleteObject } from "./lib/r2";

/** Runs on the Cron Trigger configured in wrangler.toml. Two independent
 *  jobs, neither depends on the other, and a failure in one delivery's
 *  cleanup never blocks the rest of the batch — see Phase 2 §14. */
export async function handleScheduled(env: Env): Promise<void> {
  await expireDeliveries(env);
  await sweepAbandonedUploads(env);
}

async function expireDeliveries(env: Env): Promise<void> {
  const ids = await db.findDeliveriesNeedingExpiryCleanup(env);
  for (const deliveryId of ids) {
    try {
      const files = await db.getDeliveryFiles(env, deliveryId);
      const remaining = files.filter((f) => f.removed_at === null);
      let allSucceeded = true;

      for (const file of remaining) {
        try {
          await deleteObject(env, file.r2_key);
          await db.markFileRemoved(env, file.id);
        } catch (err) {
          // This one file's failure doesn't stop the others in this same
          // delivery, and doesn't touch analytics. It's simply left with
          // removed_at still NULL, so the next run retries it.
          allSucceeded = false;
          console.error(`[expiry] failed to remove ${file.r2_key}:`, err);
        }
      }

      if (allSucceeded) {
        await db.markDeliveryFilesRemoved(env, deliveryId);
      }
      // If not all succeeded, files_removed_at is deliberately left unset
      // so this delivery is picked up again next run.
    } catch (err) {
      // One delivery's unexpected failure must never block the rest of
      // the batch.
      console.error(`[expiry] failed to process delivery ${deliveryId}:`, err);
    }
  }
}

async function sweepAbandonedUploads(env: Env): Promise<void> {
  const graceHours = Number(env.ABANDONED_UPLOAD_GRACE_HOURS);
  const cutoff = Math.floor(Date.now() / 1000) - graceHours * 3600;
  const abandoned = await db.findAbandonedPendingUploads(env, cutoff);

  for (const upload of abandoned) {
    try {
      // A no-op if nothing was ever actually uploaded to this key.
      await deleteObject(env, upload.r2_key);
      await db.deletePendingUpload(env, upload.upload_id);
    } catch (err) {
      console.error(`[abandoned-upload] failed to sweep ${upload.upload_id}:`, err);
      // Left in place; picked up again next run.
    }
  }
}
