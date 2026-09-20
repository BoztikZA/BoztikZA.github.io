-- =============================================================
-- Boztik Command Centre / Deliver — Cloudflare D1 schema
-- Database: boztik-deliver  (D1)
-- Storage:  boztik-deliveries (R2, PRIVATE — never served directly)
-- API:      boztik-deliver-api (Worker)
--
-- Design principles
--   * Image/binary payloads NEVER live in D1. They live only in R2.
--   * `deliveries` rows are never deleted by application code. Physical
--     file removal is tracked via `files_removed_at`. This preserves the
--     existing 24-h expiry + analytics behaviour (a never-deleted row keeps
--     its view/download history even after its files are reclaimed).
--   * Storage accounting is a single authoritative row in `storage_state`,
--     reconciled against real R2 usage by the Worker (list + sum), so
--     tracked bytes can never silently drift past the hard cap.
--   * Anonymous/public callers only ever hit the public projection routes;
--     RLS-equivalent scoping is enforced in the Worker, not here.
--   * Auth sessions live in `sessions` (hashed tokens, revocable, expiring)
--     so there is no secret in frontend JavaScript and no dependency on
--     Cloudflare Access.
-- =============================================================

-- -------------------------------------------------------------
-- AUTH
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,      -- SHA-256 hex of the random session token
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,      -- unix seconds
  expires_at INTEGER NOT NULL,      -- unix seconds
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- A single admin identity is enough for a solo Command Centre. The password
-- is NOT stored here — only a PBKDF2 hash is kept in the Worker secret
-- ADMIN_PASSWORD_HASH. `email` is recorded for the dashboard "signed in as".
CREATE TABLE IF NOT EXISTS admin_users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- -------------------------------------------------------------
-- DELIVERIES
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliveries (
  id                   TEXT PRIMARY KEY,   -- 'BZ-XXXXXXXX'
  project_name         TEXT,
  client_name          TEXT,
  notes                TEXT,
  created_at           INTEGER NOT NULL,   -- unix seconds
  expires_at           INTEGER NOT NULL,   -- unix seconds
  files_removed_at     INTEGER,            -- NULL until files physically removed
  support_enabled      INTEGER NOT NULL DEFAULT 1,
  is_photoshop_battles INTEGER NOT NULL DEFAULT 0,
  -- Boztik delivery source/type. Preserves ALL existing types:
  -- reddit, private, paid, free, returning, other.
  source               TEXT NOT NULL DEFAULT 'private',
  -- JSON; for PhotoshopBattles holds
  -- { type:"photoshop_battles", direct_token, redditUrl? }. Never public.
  source_meta          TEXT,
  -- Optional Reddit Source URL, stored raw + validated.
  reddit_url           TEXT,
  -- Optional cached oEmbed attribution JSON ({title, subreddit, author, url})
  -- shown publicly on the delivery as "View Original Reddit Post".
  reddit_source        TEXT,
  view_count           INTEGER NOT NULL DEFAULT 0,
  download_count       INTEGER NOT NULL DEFAULT 0,
  last_viewed_at       INTEGER,
  last_downloaded_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deliveries_created ON deliveries(created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_expires ON deliveries(expires_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_source  ON deliveries(source);

-- -------------------------------------------------------------
-- DELIVERY FILES (one row per R2 object)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_files (
  id           TEXT PRIMARY KEY,        -- short fileId
  delivery_id  TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_size    INTEGER NOT NULL DEFAULT 0,
  content_type TEXT,
  r2_key       TEXT NOT NULL,
  removed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_delivery_files_delivery ON delivery_files(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_files_removed  ON delivery_files(r2_key, removed_at);

-- -------------------------------------------------------------
-- PENDING UPLOADS — reserved before any bytes move, so concurrent uploads
-- cannot oversubscribe past the cap even mid-transfer. Rows are swept by the
-- cron once they are older than ABANDONED_UPLOAD_GRACE_HOURS and unconfirmed.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_uploads (
  upload_id    TEXT PRIMARY KEY,
  delivery_id  TEXT,                 -- NULL until a delivery exists
  file_id      TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_size    INTEGER NOT NULL DEFAULT 0,
  content_type TEXT,
  created_at   INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pending_uploads_sweep ON pending_uploads(confirmed_at, created_at);

-- -------------------------------------------------------------
-- ANALYTICS
-- -------------------------------------------------------------
-- Aggregated per delivery but bucketed by calendar month (small rows).
CREATE TABLE IF NOT EXISTS delivery_analytics (
  delivery_id TEXT NOT NULL,
  month       TEXT NOT NULL,   -- 'YYYY-MM'
  views       INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (delivery_id, month)
);

-- Per-day metrics, used for the "views/downloads over time" charts
-- (24h / 7d / 30d / all-time). Intentionally aggregated (one row per
-- delivery-day), never a raw per-event stream, so it cannot itself become
-- a storage problem.
CREATE TABLE IF NOT EXISTS delivery_daily_metrics (
  delivery_id TEXT NOT NULL,
  day         TEXT NOT NULL,   -- 'YYYY-MM-DD'
  views       INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (delivery_id, day)
);

-- Public website page analytics — one row per (day, page), lightweight.
CREATE TABLE IF NOT EXISTS page_analytics (
  day   TEXT NOT NULL,   -- 'YYYY-MM-DD'
  page  TEXT NOT NULL,   -- homepage|portfolio|tools|guides|about|support|contact|deliver
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, page)
);

-- -------------------------------------------------------------
-- STORAGE ACCOUNTING — the hard cap is enforced from this row.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1), -- single row
  limit_bytes        INTEGER NOT NULL,  -- hard cap (3 GB default)
  total_bytes        INTEGER NOT NULL DEFAULT 0, -- reconciled running total
  needs_reconcile    INTEGER NOT NULL DEFAULT 1,  -- set 1 on every mutation
  status             TEXT NOT NULL DEFAULT 'ok',  -- 'ok' | 'locked'
  lock_reason        TEXT,
  last_reconciled_at INTEGER,
  last_mutation_at   INTEGER
);

-- -------------------------------------------------------------
-- KEY-VALUE SETTINGS (overrides for the dashboard, uploads lock, etc.)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER
);