-- =============================================================
-- 0005 — Boztik Growth (Phase 1 foundation). Additive only.
--
-- Private AI marketing / content-assistant foundation inside the
-- existing Command Centre. Three new tables, nothing else is touched.
-- There is NO publishing automation here: content is written and
-- posted manually by the owner for now.
--
--   growth_knowledge  private knowledge base the AI should know about
--                     Boztik (brand, products, services, guidelines).
--   content_drafts    private drafts + lightweight content ideas.
--                     `kind` = 'draft' | 'idea'
--                     `status` = 'draft' | 'approved' | 'published'
--                     `platform` = 'x' for now (extend the value set
--                     later for other platforms).
--                     `posted_url` records a MANUAL publish (optional);
--                     nothing here ever posts to X automatically.
--   content_calendar  simple planned-content list associating a draft
--                     with a date/time. Deliberately no recurrence.
--
-- The PAUSE-AI switch is stored in the EXISTING generic `settings`
-- key/value table under key 'growth.ai_status' ('paused' | 'active'),
-- so no new settings table is required.
-- =============================================================

CREATE TABLE IF NOT EXISTS growth_knowledge (
  id         TEXT PRIMARY KEY,
  category   TEXT NOT NULL,                -- Brand | Product | Service | Audience | Marketing | Guidelines
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,   -- 0 = internal-only / not for public claims
  created_at INTEGER NOT NULL,             -- unix seconds
  updated_at INTEGER NOT NULL              -- unix seconds
);

CREATE TABLE IF NOT EXISTS content_drafts (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'idea'
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  platform   TEXT NOT NULL DEFAULT 'x',       -- extend value set for future platforms
  status     TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'approved' | 'published'
  posted_url TEXT,                            -- manual-publish URL record (never auto-posted)
  created_at INTEGER NOT NULL,                -- unix seconds
  updated_at INTEGER NOT NULL                 -- unix seconds
);

CREATE TABLE IF NOT EXISTS content_calendar (
  id           TEXT PRIMARY KEY,
  draft_id     TEXT,                          -- optional link to a draft
  scheduled_at TEXT NOT NULL,                 -- ISO date + approx time, e.g. 2026-10-05T09:00 (local)
  platform     TEXT NOT NULL DEFAULT 'x',
  status       TEXT NOT NULL DEFAULT 'planned', -- 'planned' | 'posted' | 'cancelled'
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- ---------------------------------------------------------------------
-- Seed: Boztik Knowledge — accurate facts from the live boztik.com site.
-- Planned, not-yet-launched products (FormPilot, QuoteCraft) are recorded
-- as INACTIVE (active=0) so they are never treated as customer-facing.
-- ---------------------------------------------------------------------

INSERT OR IGNORE INTO growth_knowledge
  (id, category, title, content, active, created_at, updated_at) VALUES
  ('brand-boztik',           'Brand',     'Boztik',            'Boztik is a solo creator building photo-editing tools and services. It was built because the creator needed these tools for their own photo editing and creative work. It is not built to maximize engagement or collect data; the stated priority is quality over growth.', 1, 1759449600, 1759449600),
  ('service-restoration',    'Service',   'Photo Restoration', 'Photo restoration for damaged or old photographs.', 1, 1759449600, 1759449600),
  ('service-retouching',     'Service',   'Portrait & Headshot Retouching', 'Portrait and headshot retouching.', 1, 1759449600, 1759449600),
  ('service-object-removal', 'Service',   'Object Removal',    'Removing unwanted objects from images.', 1, 1759449600, 1759449600),
  ('service-enhancement',    'Service',   'Image Enhancement', 'General image enhancement and cleanup.', 1, 1759449600, 1759449600),
  ('product-creative-toolkit','Product',  'Boztik Creative Toolkit', 'Free browser extension for Chrome and Microsoft Edge. Features image inspection, reverse image search, color extraction, typography inspection, page capture, and an AI creative assistant. Live on the Chrome Web Store.', 1, 1759449600, 1759449600),
  ('product-deliver',        'Product',   'Boztik Deliver',    'Private delivery workspace for sharing edited files with a tracked link. Admin-only Command Centre; recipients get a simple delivery page, not an account.', 1, 1759449600, 1759449600),
  ('audience-creators',      'Audience',  'Who Boztik serves', 'Boztik serves creators and clients needing photo editing, restoration, retouching, object removal, and image enhancement. The services page lists these four services.', 1, 1759449600, 1759449600),
  ('guidelines-voice',       'Guidelines','Brand voice & rules','Direct, hands-on and honest; Boztik does not overclaim. Keep a high bar for code quality, security, and UX. Never present a feature as launched unless it is actually live.', 1, 1759449600, 1759449600),
  ('guidelines-publishing',  'Guidelines','Publishing workflow','Boztik Growth Phase 1 is manual: content is written inside the Command Centre, copied by the owner, and posted to X by hand. There is no automated publishing, no X API, and no browser automation.', 1, 1759449600, 1759449600),
  ('product-formpilot',      'Product',   'FormPilot',         'Planned / not publicly launched. Do not market as an available product.', 0, 1759449600, 1759449600),
  ('product-quotecraft',     'Product',   'QuoteCraft',        'Planned / not publicly launched. Do not market as an available product.', 0, 1759449600, 1759449600);
