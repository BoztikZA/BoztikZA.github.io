-- Spotlight aggregate engagement improvements. Visitor identifiers are hashed server-side
-- and retained only as daily profile-level keys; no raw IP address is stored.
ALTER TABLE spotlight_daily_metrics
  ADD COLUMN featured_impressions INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS spotlight_visitors (
  profile_id TEXT NOT NULL,
  day TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, day, visitor_key),
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spotlight_visitors_created
  ON spotlight_visitors(created_at);

CREATE TABLE IF NOT EXISTS spotlight_impressions (
  event_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spotlight_impressions_created
  ON spotlight_impressions(created_at);
