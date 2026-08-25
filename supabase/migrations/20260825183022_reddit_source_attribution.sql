-- =========================================================
-- V5 UPGRADE: REDDIT SOURCE ATTRIBUTION (client-facing)
-- This repository did not previously use supabase/migrations/ — schema
-- changes were tracked as versioned sections inside supabase/schema.sql
-- (see "V2 UPGRADE", "V3 UPGRADE", "V4 UPGRADE" in that file). This is
-- the first migration file added, using the Supabase CLI's standard
-- <UTC timestamp>_<description>.sql naming so future migrations have a
-- convention to follow. The same statements are also appended to
-- schema.sql as "V5 UPGRADE" so a fresh install via schema.sql alone
-- stays complete and in sync with this file.
--
-- Independent of `source`/`source_meta` (those track how the
-- delivery/client originated, e.g. PhotoshopBattles vs private vs
-- paid). This column instead optionally records the original Reddit
-- post the delivered work is based on, for ANY delivery type, and is
-- shown to the client on the delivery page as "Original Source".
-- Nullable, additive only — existing rows are unaffected. Safe to run
-- more than once.
-- =========================================================
alter table public.deliveries
  add column if not exists reddit_source jsonb;

comment on column public.deliveries.reddit_source is
  'Optional original-Reddit-post attribution shown on the client delivery page. Shape: {"url": "<url pasted by admin>", "canonicalUrl": "<resolved /comments/ URL>", "subreddit": "OldPhotos", "author": "some_redditor", "title": "Thread title"}. author/subreddit/title may be null if Reddit metadata could not be fetched (URL-only save). NULL = no Reddit source attached.';

-- Exposed to anonymous clients (unlike source/source_meta) since it is
-- meant to be displayed on the public delivery page.
create or replace view public.deliveries_public
with (security_invoker = true) as
select
  id,
  project_name,
  client_name,
  notes,
  file_path,
  file_name,
  file_size,
  created_at,
  expires_at,
  reddit_source
from public.deliveries
where expires_at > now();
