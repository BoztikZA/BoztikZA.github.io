-- =========================================================
-- BOZTIK DELIVER — READ-ONLY STORAGE ORPHAN AUDIT
-- Supabase SQL Editor (Project → SQL Editor)
--
-- This script is STRICTLY READ-ONLY: it only SELECTs. It never
-- deletes, updates or inserts anything. Run it (or any single
-- section) to get a report of every anomaly between the
-- `deliveries` / `delivery_files` tables and the physical objects
-- in the private `deliveries` Storage bucket before any manual
-- cleanup is approved.
--
-- Quick start: run the whole file, then read the "PANEL SUMMARY"
-- at the bottom. Each numeric column on the summary row maps to a
-- detailed query above it.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Storage objects with NO database record at all
--    (no matching deliveries.file_path AND no delivery_files row).
--    These cannot be served by Deliver and are pure orphan bytes.
-- ---------------------------------------------------------
select
  o.bucket_id  as bucket,
  o.name       as object_path,
  o.owner_id,
  o.created_at as object_created_at,
  pg_size_pretty(coalesce((o.metadata ->> 'size')::bigint, 0)) as object_size_label,
  coalesce((o.metadata ->> 'size')::bigint, 0) as object_size_bytes
from storage.objects o
where o.bucket_id = 'deliveries'
  and not exists (
        select 1 from public.deliveries d
        where d.file_path = o.name
      )
  and not exists (
        select 1 from public.delivery_files f
        where f.file_path = o.name
      )
order by object_size_bytes desc;

-- ---------------------------------------------------------
-- 2. Storage objects with no delivery_files row AND not the
--    primary deliveries.file_path. (Overlaps with #1 but shown
--    separately for the multi-file view — a legacy delivery's
--    primary path is allowed to exist without a delivery_files
--    row only if a backfill has not run.)
-- ---------------------------------------------------------
select
  o.bucket_id  as bucket,
  o.name       as object_path,
  coalesce((o.metadata ->> 'size')::bigint, 0) as object_size_bytes
from storage.objects o
where o.bucket_id = 'deliveries'
  and not exists (select 1 from public.delivery_files f where f.file_path = o.name)
order by object_size_bytes desc;

-- ---------------------------------------------------------
-- 3. Database records whose Storage object no longer exists.
--    (delivery_files rows + primary deliveries.file_path rows.)
-- ---------------------------------------------------------
-- 3a. Multi-file records pointing at a missing object
select
  f.delivery_id,
  f.file_path,
  f.file_name,
  f.file_size
from public.delivery_files f
where not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'deliveries' and o.name = f.file_path
      );

-- 3b. Primary deliveries.file_path pointing at a missing object
select
  d.id as delivery_id,
  d.file_path,
  d.file_name,
  d.file_size
from public.deliveries d
where not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'deliveries' and o.name = d.file_path
      );

-- ---------------------------------------------------------
-- 4. Duplicate file paths (used more than once across
--    deliveries / delivery_files). A path should be unique.
-- ---------------------------------------------------------
select file_path, count(*) as occurrences
from (
  select file_path from public.delivery_files
  union all
  select file_path from public.deliveries where file_path is not null
) all_paths
group by file_path
having count(*) > 1
order by occurrences desc;

-- ---------------------------------------------------------
-- 5. Expired deliveries whose Storage objects are still present.
--    These are the first candidates for automatic cleanup
--    (cleanup-expired-deliveries is only allowed to remove files
--    once that is approved).
-- ---------------------------------------------------------
select
  d.id              as delivery_id,
  d.created_at,
  d.expires_at,
  d.storage_deleted_at,
  count(distinct f.file_path) + (
    case when exists (select 1 from storage.objects o where o.name = d.file_path)
         then 1 else 0 end
  ) as estimated_storage_objects_still_present
from public.deliveries d
left join public.delivery_files f on f.delivery_id = d.id
where d.expires_at < now()
  and d.storage_deleted_at is null
group by d.id
order by d.expires_at asc;

-- ---------------------------------------------------------
-- 6. Also report expired deliveries that were already cleaned
--    (informational — confirms cleanup marked them).
-- ---------------------------------------------------------
select
  d.id,
  d.expires_at,
  d.storage_deleted_at
from public.deliveries d
where d.expires_at < now()
  and d.storage_deleted_at is not null
order by d.storage_deleted_at desc;

-- ---------------------------------------------------------
-- PANEL SUMMARY — one row, every count above, so you can glance
-- at the headline numbers before reading the detail queries.
-- ---------------------------------------------------------
select
  (select count(*) from storage.objects
     where bucket_id = 'deliveries'
       and not exists (select 1 from public.deliveries d where d.file_path = storage.objects.name)
       and not exists (select 1 from public.delivery_files f where f.file_path = storage.objects.name)
  ) as orphan_objects_no_db_record,

  (select count(*) from public.delivery_files f
     where not exists (select 1 from storage.objects o where o.bucket_id = 'deliveries' and o.name = f.file_path)
  ) as db_rows_file_missing_object,

  (select count(*) from public.deliveries d
     where not exists (select 1 from storage.objects o where o.bucket_id = 'deliveries' and o.name = d.file_path)
  ) as deliveries_filepath_missing_object,

  (select count(*) from (
     select file_path from public.delivery_files
     union all
     select file_path from public.deliveries where file_path is not null
   ) p group by file_path having count(*) > 1
  ) as duplicate_path_groups,

  (select count(*) from public.deliveries d
     where d.expires_at < now() and d.storage_deleted_at is null
  ) as expired_not_cleaned,

  (select count(*) from public.deliveries d
     where d.expires_at < now() and d.storage_deleted_at is not null
  ) as expired_already_cleaned;