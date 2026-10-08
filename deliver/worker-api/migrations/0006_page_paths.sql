-- Anonymous session-sequence tracking for public website journeys.
-- The identifier is a random first-party browser cookie only; it contains
-- no names, emails, or personal data and is only used to estimate flow.
CREATE TABLE IF NOT EXISTS page_session_events (
  session_id TEXT NOT NULL,
  seen_at    INTEGER NOT NULL,
  page       TEXT NOT NULL,
  PRIMARY KEY (session_id, seen_at, page)
);
CREATE INDEX IF NOT EXISTS idx_page_session_events_seen_at
  ON page_session_events(seen_at);
CREATE INDEX IF NOT EXISTS idx_page_session_events_page
  ON page_session_events(page, seen_at);
