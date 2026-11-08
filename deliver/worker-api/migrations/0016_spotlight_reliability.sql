CREATE INDEX IF NOT EXISTS idx_spotlight_submission_duplicate
  ON spotlight_profiles(contact_email, created_at);

CREATE INDEX IF NOT EXISTS idx_spotlight_public_category
  ON spotlight_profiles(status, category, published_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS spotlight_submission_limits (
  visitor_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_spotlight_submission_limits_window
  ON spotlight_submission_limits(window_start);
