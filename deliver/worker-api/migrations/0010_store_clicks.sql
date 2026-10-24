-- Store-link click events (Command Centre -> Stores Analytics).
-- One row per recorded link activation on the four store destinations.
-- event_id is client-generated and unique, so INSERT OR IGNORE makes
-- retries idempotent: the same event can never be counted twice.
-- No personal data: session_id is the same anonymous first-party session id
-- already used by the site's page-view counter (boztik_anon_session).
-- No IPs, names, emails or free text are stored.
CREATE TABLE IF NOT EXISTS store_clicks (
  event_id        TEXT PRIMARY KEY,
  destination     TEXT NOT NULL CHECK (destination IN ('boztik_store','redbubble','teepublic','kofi')),
  source_placement TEXT NOT NULL,
  session_id      TEXT NOT NULL DEFAULT '',
  event_version   INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_store_clicks_destination_time ON store_clicks(destination, created_at);
CREATE INDEX IF NOT EXISTS idx_store_clicks_created_at ON store_clicks(created_at);
