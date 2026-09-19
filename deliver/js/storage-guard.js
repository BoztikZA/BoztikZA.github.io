// Boztik Deliver — 500 MB storage safety limit (pure logic).
//
// This module deliberately has NO Supabase / DOM dependencies so the rules can
// be unit-tested in isolation and shared by api.js (upload guard) and
// dashboard.js (floating storage monitor).
//
// Usage numbers are NEVER computed here. They come from the authoritative
// server-side `delivery-maintenance` Edge Function (`action: "usage"`), which
// reads storage.objects via the service-role-only `storage_usage_summary()`
// RPC. No service-role credentials exist in frontend code.

import { config } from "./config.js";

export const MB = 1024 * 1024;
const DEFAULT_LIMIT_BYTES = 500 * MB;

/** The internal safety limit in bytes (config.storageSafetyLimitBytes, default 500 MB). */
export function storageLimitBytes() {
  const value = Number(config.storageSafetyLimitBytes);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMIT_BYTES;
}

/** "320 MB", "12.4 MB", "<0.1 MB" — MB-based (1 MB = 1024 * 1024 B, matching formatBytes). */
export function formatMb(bytes) {
  const mb = Math.max(0, Number(bytes) || 0) / MB;
  if (mb === 0) return "0 MB";
  if (mb < 0.1) return "<0.1 MB";
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Normalises the delivery-maintenance `usage` response. Prefers the explicit
 * fields (`usage.used_bytes` / `usage.object_count`) and falls back to the
 * compatibility shape the existing panel reads (`storage.totals`).
 * Returns null when no usable number is present (never fabricates a value).
 */
export function readStorageUsage(response) {
  const explicit = response?.usage;
  let used = Number(explicit?.used_bytes);
  let objects = Number(explicit?.object_count);
  let generatedAt = explicit?.generated_at || null;

  if (!Number.isFinite(used)) {
    const totals = response?.storage?.totals;
    used = Number(totals?.bytes);
    objects = Number(totals?.objects);
    generatedAt = response?.storage?.generated_at || null;
  }
  if (!Number.isFinite(used) || used < 0) return null;
  return { usedBytes: used, objectCount: Number.isFinite(objects) && objects >= 0 ? objects : 0, generatedAt };
}

/**
 * The upload decision. Blocks when:
 *   used >= limit                     -> reason "full"
 *   used + incoming > limit           -> reason "insufficient"
 * (used + incoming === limit is still allowed.)
 */
export function evaluateStorageGuard({ usedBytes, incomingBytes = 0, limitBytes = storageLimitBytes() }) {
  const used = Number(usedBytes);
  const incoming = Math.max(0, Number(incomingBytes) || 0);
  const remainingBytes = Math.max(0, limitBytes - used);
  let reason = null;
  if (used >= limitBytes) reason = "full";
  else if (used + incoming > limitBytes) reason = "insufficient";
  return { allowed: reason === null, reason, usedBytes: used, incomingBytes: incoming, limitBytes, remainingBytes };
}

/**
 * Visual state for the floating monitor.
 *   < 70%            normal
 *   70% – < 85%      warning
 *   85% – < 100%     critical
 *   used >= limit    blocked
 */
export function monitorLevel(usedBytes, limitBytes = storageLimitBytes()) {
  if (usedBytes >= limitBytes) return "blocked";
  const percent = (usedBytes / limitBytes) * 100;
  if (percent >= 85) return "critical";
  if (percent >= 70) return "warning";
  return "normal";
}

/**
 * Thrown by the upload guard. `kind`:
 *   "full"         usage already at/over the limit
 *   "insufficient" usage + selected file(s) would exceed the limit
 *   "unverified"   usage could not be read, so the upload is blocked (fail-closed)
 */
export class StorageLimitError extends Error {
  constructor(kind, details = {}) {
    const limit = formatMb(details.limitBytes ?? storageLimitBytes());
    let title;
    let body;
    if (kind === "full") {
      title = "Storage limit reached";
      body = `Boztik Deliver has reached its ${limit} safety limit. Delete some old or expired deliveries/images before uploading new files.`;
    } else if (kind === "insufficient") {
      title = "Storage limit reached";
      body = `This upload (${formatMb(details.incomingBytes)}) would exceed the ${limit} safety limit. Only ${formatMb(details.remainingBytes)} of space remains. Delete some old or expired deliveries first, or choose a smaller file.`;
    } else {
      kind = "unverified";
      title = "Storage check unavailable";
      body = `Boztik Deliver couldn't confirm current storage usage, so the upload was blocked to protect the ${limit} safety limit. Check your connection and try again.`;
    }
    super(`${title}. ${body}`);
    this.name = "StorageLimitError";
    this.kind = kind;
    this.title = title;
    this.body = body;
    this.usedBytes = details.usedBytes ?? null;
    this.incomingBytes = details.incomingBytes ?? null;
    this.remainingBytes = details.remainingBytes ?? null;
    this.limitBytes = details.limitBytes ?? storageLimitBytes();
    if (details.cause) this.cause = details.cause;
  }
}
