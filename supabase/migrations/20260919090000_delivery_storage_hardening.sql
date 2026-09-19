-- Boztik Deliver: authoritative deletion, retained analytics and catalog usage.
-- This migration intentionally archives (then removes) only delivery_files rows
-- whose parent delivery is already absent before enforcing the foreign key.

create table if not exists public.delivery_files_orphan_archive (
  id uuid primary key,
  delivery_id text not null,
  file_path text not null,
  file_name text not null,
  file_size bigint not null,
  content_type text,
  created_at timestamptz,
  archived_at timestamptz not null default now(),
  archive_reason text not null default 'missing_delivery'
);

insert into public.delivery_files_orphan_archive
  (id, delivery_id, file_path, file_name, file_size, content_type, created_at)
select f.id, f.delivery_id, f.file_path, f.file_name, f.file_size, f.content_type, f.created_at
from public.delivery_files f
where not exists (select 1 from public.deliveries d where d.id = f.delivery_id)
on conflict (id) do nothing;

delete from public.delivery_files f
where not exists (select 1 from public.deliveries d where d.id = f.delivery_id);

create index if not exists delivery_files_delivery_id_idx on public.delivery_files(delivery_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.delivery_files'::regclass
      and contype = 'f'
      and confrelid = 'public.deliveries'::regclass
  ) then
    alter table public.delivery_files
      add constraint delivery_files_delivery_id_fkey
      foreign key (delivery_id) references public.deliveries(id) on delete cascade;
  end if;
end $$;

-- delivery_analytics uses (delivery_id, month_start) as its primary key, so
-- ON DELETE SET NULL is not possible without a destructive key redesign.
-- Historical rows are therefore deliberately retained as immutable records.
alter table public.delivery_analytics
  drop constraint if exists delivery_analytics_delivery_id_fkey;

create or replace function public.storage_usage_summary()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with objects as (
    select case when coalesce(metadata ->> 'size', '') ~ '^[0-9]+$'
      then (metadata ->> 'size')::bigint else 0 end as bytes
    from storage.objects
    where bucket_id = 'deliveries'
  ), agg as (
    select coalesce(sum(bytes), 0)::bigint as used_bytes, count(*)::bigint as object_count from objects
  ), limits as (
    select 1073741824::bigint as quota_bytes
  )
  select jsonb_build_object(
    'used_bytes', a.used_bytes,
    'used_mb', round(a.used_bytes::numeric / 1048576, 2),
    'used_gb', round(a.used_bytes::numeric / 1073741824, 3),
    'quota_bytes', l.quota_bytes,
    'usage_percent', round(a.used_bytes::numeric * 100 / l.quota_bytes, 2),
    'remaining_bytes', greatest(l.quota_bytes - a.used_bytes, 0),
    'warning_level', case
      when a.used_bytes >= l.quota_bytes then 'over_quota'
      when a.used_bytes * 100 >= l.quota_bytes * 95 then 'critical'
      when a.used_bytes * 100 >= l.quota_bytes * 90 then 'high'
      when a.used_bytes * 100 >= l.quota_bytes * 80 then 'warning'
      when a.used_bytes * 100 >= l.quota_bytes * 70 then 'notice'
      else 'healthy' end,
    'object_count', a.object_count,
    'generated_at', now()
  ) from agg a cross join limits l;
$$;

create or replace function public.delivery_storage_paths_present(p_paths text[])
returns text[]
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(array_agg(o.name order by o.name), '{}'::text[])
  from storage.objects o
  where o.bucket_id = 'deliveries' and o.name = any(coalesce(p_paths, '{}'::text[]));
$$;

create or replace function public.delivery_orphan_storage_preview()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with orphan_objects as (
    select o.name,
      case when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (o.metadata ->> 'size')::bigint else 0 end as bytes
    from storage.objects o
    where o.bucket_id = 'deliveries'
      and not exists (select 1 from public.deliveries d where d.file_path = o.name)
      and not exists (select 1 from public.delivery_files f where f.file_path = o.name)
  )
  select jsonb_build_object(
    'orphan_storage_count', (select count(*) from orphan_objects),
    'orphan_storage_bytes', (select coalesce(sum(bytes), 0) from orphan_objects),
    'orphan_storage_paths', (select coalesce(jsonb_agg(jsonb_build_object('path', name, 'bytes', bytes) order by name), '[]'::jsonb) from orphan_objects),
    'archived_orphan_delivery_files', (select count(*) from public.delivery_files_orphan_archive)
  );
$$;

revoke all on function public.storage_usage_summary() from public, anon, authenticated;
revoke all on function public.delivery_storage_paths_present(text[]) from public, anon, authenticated;
revoke all on function public.delivery_orphan_storage_preview() from public, anon, authenticated;
grant execute on function public.storage_usage_summary() to service_role;
grant execute on function public.delivery_storage_paths_present(text[]) to service_role;
grant execute on function public.delivery_orphan_storage_preview() to service_role;
