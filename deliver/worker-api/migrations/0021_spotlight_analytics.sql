-- Spotlight analytics v2 (additive only: no existing table is rebuilt, no row is rewritten).
-- Existing counters keep their meaning: views, unique_views, outbound_clicks (all destinations), featured_impressions.

-- Outbound clicks by destination type (outbound_clicks remains the total, including legacy clicks with no type).
ALTER TABLE spotlight_daily_metrics ADD COLUMN website_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spotlight_daily_metrics ADD COLUMN social_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spotlight_daily_metrics ADD COLUMN media_clicks INTEGER NOT NULL DEFAULT 0;
-- Featured-stage player: a deliberate click on the facade's play button, and a play that reached the end.
ALTER TABLE spotlight_daily_metrics ADD COLUMN player_interactions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spotlight_daily_metrics ADD COLUMN completed_plays INTEGER NOT NULL DEFAULT 0;

-- Idempotency for player events. A 'complete' row is only accepted if the matching 'player' row exists.
CREATE TABLE IF NOT EXISTS spotlight_engagement_events (
  event_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('player','complete')),
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spotlight_engagement_created ON spotlight_engagement_events(created_at);

-- Coarse traffic-source buckets per profile per day. No referrer URLs or hosts are stored.
CREATE TABLE IF NOT EXISTS spotlight_source_daily (
  profile_id TEXT NOT NULL,
  day TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('direct','directory','featured','search','social','other')),
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(profile_id, day, source),
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
