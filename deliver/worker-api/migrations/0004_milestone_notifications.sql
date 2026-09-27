-- =============================================================
-- 0004 — Milestone notification emails (additive only).
--
-- Backend-only: the owner receives an email when a whole-system
-- cumulative counter crosses a milestone. Never exposed to the
-- public, never used for delivery recipients or customers.
--
-- One row per (metric, milestone) that has ALREADY been handled, so
-- an email can never be sent twice for the same milestone.
--
--   metric    'views' | 'downloads' | 'shares' | 'deliveries'
--   milestone the crossed threshold (e.g. 1000 for views)
--             plus the sentinel value -1, which marks that the
--             metric has been "initialised" (baseline captured).
--   sent_at   unix seconds when it was claimed/handled
--
-- The primary key is what makes claiming atomic: a concurrent
-- request that triggers the same milestone cannot double-insert, so
-- it cannot double-send.
-- =============================================================
CREATE TABLE IF NOT EXISTS notify_milestones (
  metric     TEXT NOT NULL,
  milestone  INTEGER NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (metric, milestone)
);