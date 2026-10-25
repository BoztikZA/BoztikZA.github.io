-- Idempotent page-view events.
-- js/pageview.js now sends a random per-load event_id. A re-sent event (network retry, beacon + fetch fallback)
-- is recognised by it and is neither stored twice nor counted twice. Additive and nullable: existing rows and
-- older cached clients (which send no event_id) keep working exactly as before. No data is changed or removed.
ALTER TABLE page_session_events ADD COLUMN event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_page_session_events_event_id
  ON page_session_events(event_id) WHERE event_id IS NOT NULL;
