-- Share-event analytics for Boztik Deliver delivery pages and Photoshop
-- Battles image pages.
--
-- Like the view/download metrics, this is an AGGREGATE table only: one row per
-- (delivery, calendar day, page type, method, outcome). It never stores a raw
-- per-visitor event stream, an identity, or an IP.
--
--   method:  native    = the browser's native share sheet completed
--            copy      = the share link was copied
--            whatsapp / facebook / x / reddit = an external share sheet was opened
--   kind:    completed = the share/copy action actually happened
--            attempted = an external share sheet was opened (a post cannot be verified)
CREATE TABLE IF NOT EXISTS share_metrics (
  delivery_id TEXT NOT NULL,
  day         TEXT NOT NULL,                                   -- 'YYYY-MM-DD' (owner's local calendar)
  page_type   TEXT NOT NULL DEFAULT 'delivery' CHECK (page_type IN ('delivery', 'photoshop_battles')),
  method      TEXT NOT NULL CHECK (method IN ('native', 'copy', 'whatsapp', 'facebook', 'x', 'reddit')),
  kind        TEXT NOT NULL CHECK (kind IN ('completed', 'attempted')),
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (delivery_id, day, page_type, method, kind)
);

CREATE INDEX IF NOT EXISTS idx_share_metrics_day      ON share_metrics(day);
CREATE INDEX IF NOT EXISTS idx_share_metrics_page     ON share_metrics(page_type);
CREATE INDEX IF NOT EXISTS idx_share_metrics_method   ON share_metrics(method);
CREATE INDEX IF NOT EXISTS idx_share_metrics_delivery ON share_metrics(delivery_id);