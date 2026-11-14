-- Spotlight applications: private owner access, terms acceptance, "more information required" overlay,
-- applicant/admin emails, and a plan column for future paid placements.
--
-- Safety: spotlight_profiles (the parent) is only ALTERed additively; no data is rewritten and no table that other
-- tables reference is rebuilt. The two rebuilt tables below are leaf tables (nothing references them) and every
-- existing row is copied across.

-- Private owner link: only a SHA-256 hash of the secret token is stored, never the token itself.
ALTER TABLE spotlight_profiles ADD COLUMN owner_token_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_spotlight_owner_token_hash
  ON spotlight_profiles(owner_token_hash) WHERE owner_token_hash IS NOT NULL;

-- Which version of the terms the applicant accepted, and when.
ALTER TABLE spotlight_profiles ADD COLUMN terms_version TEXT;
ALTER TABLE spotlight_profiles ADD COLUMN terms_accepted_at INTEGER;

-- "Information required" is an overlay on application_status='under_review' (no status rebuild needed).
ALTER TABLE spotlight_profiles ADD COLUMN info_request_note TEXT;
ALTER TABLE spotlight_profiles ADD COLUMN info_requested_at INTEGER;
ALTER TABLE spotlight_profiles ADD COLUMN info_response_note TEXT;
ALTER TABLE spotlight_profiles ADD COLUMN info_responded_at INTEGER;

-- Placement plan for future paid placements. Deliberately no CHECK so new plans never need a table rebuild.
-- Every profile is on the free plan today and nothing reads this to gate behaviour.
ALTER TABLE spotlight_profiles ADD COLUMN placement_plan TEXT NOT NULL DEFAULT 'free';

-- Audit log: allow the new actions (submitted, request_info, info_received).
CREATE TABLE spotlight_review_events_v2 (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('mark_read','start_review','approve','decline','publish','expire','submitted','request_info','info_received')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
INSERT INTO spotlight_review_events_v2 (id,profile_id,actor,action,from_status,to_status,reason,created_at)
  SELECT id,profile_id,actor,action,from_status,to_status,reason,created_at FROM spotlight_review_events;
DROP TABLE spotlight_review_events;
ALTER TABLE spotlight_review_events_v2 RENAME TO spotlight_review_events;
CREATE INDEX IF NOT EXISTS idx_spotlight_review_events_profile
  ON spotlight_review_events(profile_id, created_at);

-- Email outbox: more kinds, and a `ref` so repeatable emails (e.g. a second information request) are not de-duplicated away.
CREATE TABLE spotlight_email_outbox_v2 (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new_submission','declined','info_requested','approved','info_received')),
  ref TEXT NOT NULL DEFAULT '',
  recipient TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error TEXT,
  UNIQUE(profile_id, kind, ref),
  FOREIGN KEY(profile_id) REFERENCES spotlight_profiles(id) ON DELETE CASCADE
);
INSERT INTO spotlight_email_outbox_v2 (id,profile_id,kind,ref,recipient,state,attempts,next_attempt_at,locked_until,created_at,sent_at,last_error)
  SELECT id,profile_id,kind,'',recipient,state,attempts,next_attempt_at,locked_until,created_at,sent_at,last_error FROM spotlight_email_outbox;
DROP TABLE spotlight_email_outbox;
ALTER TABLE spotlight_email_outbox_v2 RENAME TO spotlight_email_outbox;
CREATE INDEX IF NOT EXISTS idx_spotlight_email_outbox_due
  ON spotlight_email_outbox(state, next_attempt_at, locked_until);
