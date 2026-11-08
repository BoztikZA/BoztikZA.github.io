ALTER TABLE spotlight_profiles
  ADD COLUMN application_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (application_status IN ('new','under_review','approved','published','declined','expired'));
ALTER TABLE spotlight_profiles ADD COLUMN review_expires_at INTEGER;
ALTER TABLE spotlight_profiles ADD COLUMN listing_expires_at INTEGER;
ALTER TABLE spotlight_profiles ADD COLUMN review_unread INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spotlight_profiles ADD COLUMN decline_reason TEXT;
ALTER TABLE spotlight_profiles ADD COLUMN reviewed_at INTEGER;
ALTER TABLE spotlight_profiles ADD COLUMN decided_at INTEGER;

UPDATE spotlight_profiles
   SET application_status = CASE status
     WHEN 'pending' THEN 'new'
     WHEN 'published' THEN 'published'
     ELSE 'published'
   END,
       review_unread = CASE WHEN status = 'pending' THEN 1 ELSE 0 END;

CREATE INDEX IF NOT EXISTS idx_spotlight_review_queue
  ON spotlight_profiles(application_status, review_unread, created_at);
CREATE INDEX IF NOT EXISTS idx_spotlight_listing_expiry
  ON spotlight_profiles(status, listing_expires_at);

CREATE TABLE IF NOT EXISTS spotlight_review_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('mark_read','start_review','approve','decline','publish','expire')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spotlight_review_events_profile
  ON spotlight_review_events(profile_id, created_at);

CREATE TABLE IF NOT EXISTS spotlight_email_outbox (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new_submission','declined')),
  recipient TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error TEXT,
  UNIQUE(profile_id, kind),
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_spotlight_email_outbox_due
  ON spotlight_email_outbox(state, next_attempt_at, locked_until);
