-- First-party traffic-source visits, isolated from page and Deliver analytics.
CREATE TABLE IF NOT EXISTS traffic_source_visits (
  session_id   TEXT PRIMARY KEY CHECK (length(session_id) = 32),
  seen_at      INTEGER NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('reddit', 'organic_search', 'social', 'referral', 'direct_unknown')),
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT
);
CREATE INDEX IF NOT EXISTS idx_traffic_source_visits_seen_at
  ON traffic_source_visits(seen_at);
