export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;

  PUBLIC_ORIGIN: string;
  DELIVER_V2_BASE_URL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_EMAIL: string;
  DOWNLOAD_URL_TTL_SECONDS: string;
  PREVIEW_URL_TTL_SECONDS: string;
  UPLOAD_URL_TTL_SECONDS: string;
  MAX_UPLOAD_BYTES: string;
  MAX_FILES_PER_DELIVERY: string;
  ABANDONED_UPLOAD_GRACE_HOURS: string;

  R2_BUCKET_NAME: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
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
  source: string | null;
  source_meta: string | null;
  /** JSON-encoded {subreddit, title, author, url, canonicalUrl} — public
   *  attribution, unrelated to and never containing the PhotoshopBattles
   *  direct_token that lives in source_meta. */
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
  file_size: number | null;
  r2_key: string;
  removed_at: number | null;
}

export interface PendingUploadRow {
  upload_id: string;
  delivery_id: string;
  r2_key: string;
  file_name: string;
  file_size: number | null;
  created_at: number;
  confirmed_at: number | null;
}

/** Safe, public-facing projection of a delivery — this is the entire
 *  replacement for Supabase's `deliveries_public` view + RLS, so nothing
 *  outside this shape may ever reach a public response. Never includes
 *  `source` or `source_meta` (the PhotoshopBattles direct_token lives in
 *  source_meta).
 *
 *  Shaped to match exactly what the reused deliver-v2/js/client.js reads
 *  (see Phase 3 report's "frontend contract" section): the array is named
 *  `delivery_files` (not `files`), and each entry carries `file_path` and
 *  `delivery_id` — client.js uses `file_path` purely as an opaque cache
 *  key/identifier, never displaying or parsing it, so it safely holds this
 *  system's short fileId rather than a literal storage path. */
export interface PublicDelivery {
  id: string;
  project_name: string | null;
  client_name: string | null;
  notes: string | null;
  created_at: number;
  expires_at: number;
  support_enabled: boolean;
  is_photoshop_battles: boolean;
  reddit_source: Record<string, unknown> | null;
  delivery_files: Array<{
    id: string;
    delivery_id: string;
    file_path: string;
    file_name: string;
    file_size: number | null;
    file_type: null;
    available: boolean;
  }>;
}

export class AccessAuthError extends Error {}
