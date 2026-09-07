-- =========================================================
-- V6 UPGRADE: ORIGINAL-FILE RELEASE GATING (paid delivery access control)
-- This is the server-side "is the original unlocked?" state that genuine
-- payment verification (admin confirmation now, a future Ko-fi/PayPal
-- webhook later) flips to true. The public delivery page reads it to show
-- the unlock/payment UI, but cannot write it (no anon UPDATE policy).
-- It is never tied to any client-supplied value. The original file itself
-- remains protected by the deliver-file Edge Function (see below)..
-- Additive only — existing rows simply default to locked/gated (false). Safe
-- to run more than once.
-- =========================================================
alter table public.deliveries
  add column if not exists release_original boolean not null default false;

comment on column public.deliveries.release_original is
  'Server-side (admin-set or future webhook-set) flag granting the client access to the original/non-watermarked file. TRUE = original unlocked (delivery behaves open; FALSE = gated (watermarked-preview/locked-original behaviour applied by the deliver-file Edge Function.';

-- Exposed to anonymous clients (unlike source/source_meta) since these are
-- needed to render the correct delivery behaviour.. Only the safe, derived
-- `is_photoshop_battles` boolean is exposed — never `source_meta` (it can
-- carry the secret direct_token). This preserves the real PhotoshopBattles
-- detection rule (source = reddit AND source_meta.type = photoshop_battles.


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
  reddit_source,
  source,
  release_original,
  (source = 'reddit'and coalesce(source_meta->>'type','') = 'photoshop_battles') as is_photoshop_battles
from public.deliveries
where expires_at > now();