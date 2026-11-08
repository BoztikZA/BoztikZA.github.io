CREATE TABLE IF NOT EXISTS spotlight_gallery_images (
  profile_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 4),
  image_key TEXT NOT NULL UNIQUE,
  image_size INTEGER NOT NULL,
  image_content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id, position),
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
