-- Boztik Deliver 2.0 — initial schema.
--
-- Core rule this schema exists to enforce: `deliveries` rows are never
-- deleted by application code, under any circumstance (expiry, manual
-- delete, or anything else). Physical-file removal is tracked alongside
-- the permanent record via `files_removed_at`, never by deleting the
-- record itself. There is deliberately no ON DELETE CASCADE anywhere in
-- this schema, and no application code path issues a DELETE against
-- `deliveries` or `delivery_analytics`.

CREATE TABLE deliveries (
  id                   TEXT PRIMARY KEY,
  project_name         TEXT,
  client_name          TEXT,
  notes                TEXT,
  created_at           INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL,
  files_removed_at     INTEGER,
  support_enabled      INTEGER NOT NULL DEFAULT 1,
  is_photoshop_battles INTEGER NOT NULL DEFAULT 0,
  source               TEXT,
  source_meta          TEXT,
  reddit_source        TEXT,
  view_count           INTEGER NOT NULL DEFAULT 0,
  download_count       INTEGER NOT NULL DEFAULT 0,
  last_viewed_at       INTEGER,
  last_downloaded_at   INTEGER
);

CREATE INDEX idx_deliveries_expires_at ON deliveries(expires_at);

CREATE TABLE delivery_files (
  id           TEXT PRIMARY KEY,
  delivery_id  TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_size    INTEGER,
  r2_key       TEXT NOT NULL,
  removed_at   INTEGER
);

CREATE INDEX idx_delivery_files_delivery ON delivery_files(delivery_id);

CREATE TABLE delivery_analytics (
  delivery_id  TEXT NOT NULL,
  month        TEXT NOT NULL,
  views        INTEGER NOT NULL DEFAULT 0,
  downloads    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (delivery_id, month)
);

CREATE TABLE pending_uploads (
  upload_id     TEXT PRIMARY KEY,
  delivery_id   TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_size     INTEGER,
  created_at    INTEGER NOT NULL,
  confirmed_at  INTEGER
);

CREATE INDEX idx_pending_uploads_sweep ON pending_uploads(confirmed_at, created_at);
