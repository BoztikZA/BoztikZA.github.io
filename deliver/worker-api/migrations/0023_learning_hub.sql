-- Boztik Learning Hub (additive only: new tables, no changes to existing tables).
-- NOT applied automatically. Apply deliberately after review:
--   npm run db:migrate:remote
--
-- Privacy notes
--  * A learner "session" is a private link. Only the SHA-256 of the secret token is stored (token_hash);
--    the public_ref (LN-XXXXXXXX) is a separate identifier that is safe to show and is NOT a credential.
--  * A one-time recovery code is also stored only as a hash (recovery_hash).
--  * Email and country are optional. Card/payment details are never stored (PayPal hosts checkout).

CREATE TABLE IF NOT EXISTS learning_learners (
  id            TEXT PRIMARY KEY,
  public_ref    TEXT NOT NULL UNIQUE,
  token_hash    TEXT NOT NULL UNIQUE,
  recovery_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT,
  country       TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_learning_learners_seen ON learning_learners(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_learning_learners_created ON learning_learners(created_at);

CREATE TABLE IF NOT EXISTS learning_enrolments (
  learner_id       TEXT NOT NULL,
  course_slug      TEXT NOT NULL,
  enrolled_at      INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  last_lesson_id   TEXT,
  completed_at     INTEGER,
  PRIMARY KEY (learner_id, course_slug)
);
CREATE INDEX IF NOT EXISTS idx_learning_enrol_course ON learning_enrolments(course_slug, enrolled_at);

CREATE TABLE IF NOT EXISTS learning_progress (
  learner_id   TEXT NOT NULL,
  course_slug  TEXT NOT NULL,
  lesson_id    TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (learner_id, course_slug, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_learning_progress_course ON learning_progress(course_slug, lesson_id);

-- One row per assessment attempt. Questions/option order/answers are server-side only.
CREATE TABLE IF NOT EXISTS learning_attempts (
  id                TEXT PRIMARY KEY,
  learner_id        TEXT NOT NULL,
  course_slug       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','expired')),
  seed              TEXT NOT NULL,
  question_order    TEXT NOT NULL,            -- JSON: ordered question ids
  option_orders     TEXT NOT NULL,            -- JSON: { questionId: [original option indexes in displayed order] }
  started_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  submitted_at      INTEGER,
  written_correct   INTEGER,
  written_total     INTEGER,
  written_percent   INTEGER,
  module_breakdown  TEXT,                     -- JSON: { m01: { correct, total } }
  practical_seed    TEXT,
  practical_correct INTEGER,
  practical_total   INTEGER,
  practical_percent INTEGER,
  practical_detail  TEXT,                     -- JSON: { taskId: boolean }
  passed            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_learning_attempts_learner ON learning_attempts(learner_id, course_slug, started_at);
CREATE INDEX IF NOT EXISTS idx_learning_attempts_course ON learning_attempts(course_slug, status, submitted_at);

CREATE TABLE IF NOT EXISTS learning_certificates (
  id                TEXT PRIMARY KEY,
  certificate_id    TEXT NOT NULL UNIQUE,     -- public, e.g. BZL-7K3M-Q9XA-4D2P
  learner_id        TEXT NOT NULL,
  course_slug       TEXT NOT NULL,
  attempt_id        TEXT NOT NULL UNIQUE,
  learner_name      TEXT NOT NULL,            -- snapshot as printed on the certificate
  course_title      TEXT NOT NULL,
  score_percent     INTEGER NOT NULL,
  practical_percent INTEGER,
  pass_mark         INTEGER NOT NULL,
  issued_at         INTEGER NOT NULL,
  public_details    INTEGER NOT NULL DEFAULT 0,  -- learner consent: show name+score on the public verification page
  revoked_at        INTEGER,
  revoked_reason    TEXT,
  download_count    INTEGER NOT NULL DEFAULT 0,
  verify_count      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_learning_cert_learner ON learning_certificates(learner_id, course_slug);
CREATE INDEX IF NOT EXISTS idx_learning_cert_issued ON learning_certificates(issued_at);

-- Optional contributions. Created by the Worker, confirmed ONLY by a verified PayPal webhook.
CREATE TABLE IF NOT EXISTS learning_contributions (
  id              TEXT PRIMARY KEY,
  learner_id      TEXT,
  course_slug     TEXT,
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  paypal_order_id TEXT UNIQUE,
  paypal_env      TEXT NOT NULL DEFAULT 'sandbox',
  status          TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','approved','completed','failed','refunded')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  completed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_learning_contrib_status ON learning_contributions(status, created_at);

CREATE TABLE IF NOT EXISTS learning_webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  received_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT,
  detail  TEXT
);
CREATE INDEX IF NOT EXISTS idx_learning_audit_at ON learning_audit(at);

-- Single-row estimate of how much of the separate 1.5 GiB Learning allocation is used.
CREATE TABLE IF NOT EXISTS learning_usage (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  bytes_used   INTEGER NOT NULL DEFAULT 0,
  breakdown    TEXT,
  computed_at  INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO learning_usage (id, bytes_used, breakdown, computed_at) VALUES (1, 0, NULL, 0);
