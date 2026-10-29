export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;

  // Vars (wrangler.toml [vars])
  PUBLIC_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  STORAGE_LIMIT_BYTES: string;
  MAX_UPLOAD_BYTES: string;
  MAX_FILES_PER_DELIVERY: string;
  SESSION_HOURS: string;
  DEFAULT_EXPIRY_HOURS: string;
  ABANDONED_UPLOAD_GRACE_HOURS: string;
  RATE_LIMIT_PUBLIC_PER_MINUTE: string;
  LOGIN_MAX_FAILURES: string;
  PAGE_ANALYTICS_ALLOWED: string;
  /** Calendar offset for analytics buckets, minutes east of UTC (default 120 = SAST). */
  ANALYTICS_UTC_OFFSET_MINUTES?: string;

  // Secrets (wrangler secret put / .dev.vars)
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
  AUTH_TOKEN_SALT: string;

  // Google Analytics 4 reporting (read-only; both optional — without them Command Centre says "not connected").
  // GA4_PROPERTY_ID           numeric GA4 *property* ID (NOT the G- measurement ID). Not secret, but stored with the key.
  // GA4_SERVICE_ACCOUNT_JSON  service-account key JSON. SECRET: `wrangler secret put`, never committed, never logged.
  // GA4_CACHE_SECONDS         var, optional, 60–3600 (default 600): how long a report may be served from cache.
  GA4_PROPERTY_ID?: string;
  GA4_SERVICE_ACCOUNT_JSON?: string;
  GA4_CACHE_SECONDS?: string;

  // Milestone notification emails (backend-only; all optional).
  // MILESTONE_EMAILS_ENABLED  var,   default "1"; set "0" to disable the feature.
  // The rest are secrets, never committed. See README "Email notifications".
  MILESTONE_EMAILS_ENABLED?: string;
  NOTIFY_EMAIL_TO?: string;        // owner / admin recipient address
  NOTIFY_EMAIL_FROM?: string;      // verified sender address
  EMAIL_PROVIDER_URL?: string;     // outbound email HTTP API endpoint
  EMAIL_PROVIDER_KEY?: string;     // API key for that endpoint
}

export interface DeliveryRow {
  id: string;
  project_name: string | null;
  client_name: string | null;
  notes: string | null;
  created_at: number;
  expires_at: number;
  files_removed_at: number | null;
  support_enabled: number;
  is_photoshop_battles: number;
  source: string;
  source_meta: string | null;
  reddit_url: string | null;
  reddit_source: string | null;
  view_count: number;
  download_count: number;
  last_viewed_at: number | null;
  last_downloaded_at: number | null;
}

export interface DeliveryFileRow {
  id: string;
  delivery_id: string;
  file_name: string;
  file_size: number;
  content_type: string | null;
  r2_key: string;
  removed_at: number | null;
}

export type UploadState = "reserved" | "uploading" | "stored";

export interface PendingUploadRow {
  upload_id: string;
  delivery_id: string | null;
  file_id: string;
  r2_key: string;
  file_name: string;
  file_size: number;
  content_type: string | null;
  created_at: number;
  confirmed_at: number | null;
  state: UploadState;
  stored_at: number | null;
}

export interface StorageStateRow {
  id: number;
  limit_bytes: number;
  total_bytes: number;
  reserved_bytes: number;
  mutation_seq: number;
  needs_reconcile: number;
  status: string; // 'ok' | 'locked'
  lock_reason: string | null;
  last_reconciled_at: number | null;
  last_mutation_at: number | null;
}

export const DELIVERY_SOURCES = ["reddit", "private", "paid", "free", "returning", "other"] as const;

/** Thrown for any failed authentication / authorisation check. */
export class AuthError extends Error {}

/** Thrown for a request-level failure that should map to a specific HTTP
 *  status + machine-readable code. Never carries secrets or stack traces. */
export class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
