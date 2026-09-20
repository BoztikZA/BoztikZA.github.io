-- =============================================================
-- 0002 — Upload reservations, atomic storage accounting, login throttle,
--        hourly activity. ADDITIVE ONLY: 0001 is untouched so a database
--        that already ran 0001 upgrades cleanly.
--
-- Storage accounting model (see src/lib/storage.ts)
--   total_bytes    bytes of objects that physically exist in R2 (stored)
--   reserved_bytes bytes promised to in-flight uploads (not yet in R2)
--   Guard: total_bytes + reserved_bytes + incoming <= limit, evaluated
--   INSIDE a single SQL statement so concurrent uploads cannot both pass.
--   mutation_seq lets reconciliation detect concurrent changes and refuse to
--   overwrite a ledger that moved underneath it.
-- =============================================================
ALTER TABLE storage_state ADD COLUMN reserved_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE storage_state ADD COLUMN mutation_seq   INTEGER NOT NULL DEFAULT 0;

-- pending_uploads.state: reserved -> uploading -> stored -> (finalised: row deleted)
ALTER TABLE pending_uploads ADD COLUMN state     TEXT    NOT NULL DEFAULT 'reserved';
ALTER TABLE pending_uploads ADD COLUMN stored_at INTEGER;

-- Every R2 key is referenced by at most one row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_files_r2key  ON delivery_files(r2_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_uploads_r2key ON pending_uploads(r2_key);
CREATE INDEX IF NOT EXISTS idx_pending_uploads_delivery     ON pending_uploads(delivery_id);
CREATE INDEX IF NOT EXISTS idx_pending_uploads_state        ON pending_uploads(state, created_at);

-- Persistent (cross-isolate) failed-login throttle, keyed by client IP.
CREATE TABLE IF NOT EXISTS auth_throttle (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  failures     INTEGER NOT NULL DEFAULT 0
);

-- Site-wide hourly activity for the honest "last 24 hours" chart.
-- One row per hour; pruned by the cron after 8 days.
CREATE TABLE IF NOT EXISTS site_hourly_metrics (
  hour      TEXT PRIMARY KEY,  -- 'YYYY-MM-DDTHH' (UTC)
  views     INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0
);

-- Delivery ids are unique; a fast lookup for the expiry worklist.
CREATE INDEX IF NOT EXISTS idx_deliveries_cleanup ON deliveries(files_removed_at, expires_at);
