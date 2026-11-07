-- Boztik Spotlight: moderated global discovery directory.
-- Profile records live in D1; image objects (when enabled) must live in the
-- existing private R2 bucket and be included in the shared storage ledger.
CREATE TABLE IF NOT EXISTS spotlight_profiles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  website_url TEXT,
  social_links TEXT NOT NULL DEFAULT '{}',
  image_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','archived')),
  featured_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_spotlight_profiles_public
  ON spotlight_profiles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_spotlight_profiles_featured
  ON spotlight_profiles(status, featured_until);

CREATE TABLE IF NOT EXISTS spotlight_daily_metrics (
  profile_id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  unique_views INTEGER NOT NULL DEFAULT 0,
  outbound_clicks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(profile_id, day),
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spotlight_metrics_day
  ON spotlight_daily_metrics(day);

-- Anonymous event IDs make retries idempotent without retaining raw IP addresses.
CREATE TABLE IF NOT EXISTS spotlight_events (
  event_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('view','click')),
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spotlight_events_created
  ON spotlight_events(created_at);
