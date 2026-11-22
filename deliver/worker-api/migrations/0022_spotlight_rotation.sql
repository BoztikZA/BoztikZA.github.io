-- Spotlight lifecycle v3: fixed 30-day published listings and 24-hour homepage feature rotation.
CREATE TABLE IF NOT EXISTS spotlight_rotation_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  last_profile_id TEXT,
  next_rotation_at INTEGER,
  updated_at INTEGER NOT NULL
);
UPDATE spotlight_profiles SET featured_until=unixepoch()+86400
 WHERE status='published' AND featured_until>=4102444800;
-- Normalise any overlapping legacy placements to the most recently updated active feature.
UPDATE spotlight_profiles
   SET featured_until=NULL
 WHERE status='published' AND featured_until>unixepoch()
   AND id<>(SELECT id FROM spotlight_profiles
             WHERE status='published' AND featured_until>unixepoch()
             ORDER BY featured_until DESC,updated_at DESC LIMIT 1);
UPDATE spotlight_profiles SET listing_expires_at=COALESCE(published_at,created_at)+2592000
 WHERE status='published' AND listing_expires_at IS NULL;
INSERT OR IGNORE INTO spotlight_rotation_state(id,last_profile_id,next_rotation_at,updated_at)
SELECT 1,id,featured_until,unixepoch() FROM spotlight_profiles
 WHERE status='published' AND featured_until>unixepoch()
 ORDER BY featured_until DESC,updated_at DESC LIMIT 1;
INSERT OR IGNORE INTO spotlight_rotation_state(id,last_profile_id,next_rotation_at,updated_at)
VALUES(1,NULL,NULL,unixepoch());
