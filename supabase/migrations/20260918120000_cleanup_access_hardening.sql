-- =========================================================
-- V8: CLEANUP / DELETE ACCESS HARDENING
--
-- Once a delivery's files are removed — by natural-expiry cleanup
-- (cleanup-expired-deliveries) or by a manual Command Centre delete —
-- `deliveries.storage_deleted_at` is set (the row and its analytics are
-- preserved for reporting). Until now the anonymous-facing surfaces only
-- filtered on `expires_at > now()`, so a delivery deleted BEFORE its
-- `expires_at` was still served/rendered as an "active" delivery link
-- (a worthless shell with no files).
--
-- This migration makes the public delivery page, the on-demand signed
-- URLs, and the anonymous storage read policy ALL treat a delivery whose
-- files are gone as unavailable — independently of expiry. Expiry itself
-- continues to be enforced everywhere via `expires_at > now()` (Layer-1
-- independence; the cleanup job is only Layer-2).
--
-- Every statement is idempotent (`create or replace view`,
-- `drop policy if exists` + `create policy`), so re-running is safe and
-- supersedes the earlier view/policy definitions.
-- =========================================================

-- (1) deliveries_public must never expose a cleaned/deleted delivery.
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
  coalesce((source_meta->>'support_enabled')::boolean, true)
    as support_enabled,
  (source = 'reddit' and coalesce(source_meta->>'type', '') = 'photoshop_battles')
    as is_photoshop_battles
from public.deliveries
where expires_at > now()
  and storage_deleted_at is null;

-- (2) delivery_files_public must not expose files of a cleaned/deleted delivery.
-- The legacy view predates content_type, so PostgreSQL cannot change its
-- positional output columns with CREATE OR REPLACE. Dropping is transactional
-- and will fail safely if an unexpected dependent object exists.
drop view if exists public.delivery_files_public;
create or replace view public.delivery_files_public
with (security_invoker = true) as
-- `content_type` was not present in the first production multi-file table.
-- Keep this access-hardening migration compatible with that legacy schema;
-- the following hardening migration adds the nullable field before writes use it.
select f.delivery_id, f.file_path, f.file_name, f.file_size, null::text as content_type, f.created_at
from public.delivery_files f
join public.deliveries d on d.id = f.delivery_id
where d.expires_at > now()
  and d.storage_deleted_at is null;

grant select on public.delivery_files_public to anon;

-- (3) Direct anonymous SELECT on the base table must also respect cleanup state
--     (the deliveries_public view resolves through this table under RLS).
drop policy if exists "Anonymous can view non-expired deliveries" on public.deliveries;
create policy "Anonymous can view non-expired deliveries"
  on public.deliveries for select
  to anon
  using (expires_at > now() and storage_deleted_at is null);

-- (4) Anonymous signed-URL reads on storage.objects must not resolve files of a
--     cleaned/deleted delivery (single-file and multi-file paths alike).
drop policy if exists "Anonymous can read files for active deliveries" on storage.objects;
create policy "Anonymous can read files for active deliveries"
  on storage.objects for select to anon
  using (
    bucket_id = 'deliveries' and (
      exists (
        select 1 from public.deliveries d
        where d.file_path = storage.objects.name
          and d.expires_at > now()
          and d.storage_deleted_at is null
      )
      or exists (
        select 1 from public.delivery_files f
        join public.deliveries d on d.id = f.delivery_id
        where f.file_path = storage.objects.name
          and d.expires_at > now()
          and d.storage_deleted_at is null
      )
    )
  );
