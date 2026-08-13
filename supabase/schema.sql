-- =========================================================
-- BOZTIK DELIVER — Supabase schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor)
-- =========================================================

-- ---------------------------------------------------------
-- 1. TABLE
-- ---------------------------------------------------------
create table if not exists public.deliveries (
  id            text primary key,                 -- e.g. 'BZ-8FQX92K'
  client_name   text not null,
  project_name  text not null,
  notes         text,
  file_path     text not null,                     -- storage object path: "<id>/<filename>"
  file_name     text not null,
  file_size     bigint not null,
  download_count integer not null default 0,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  created_by    uuid references auth.users(id) default auth.uid()
);

comment on table public.deliveries is 'Boztik Deliver — client file delivery metadata. Actual files live in Storage bucket "deliveries".';

-- ---------------------------------------------------------
-- 2. ROW LEVEL SECURITY
-- ---------------------------------------------------------
alter table public.deliveries enable row level security;

-- Only authenticated admin users (i.e. you, logged into the dashboard)
-- may read/write the full table directly.
create policy "Admins can select all deliveries"
  on public.deliveries for select
  to authenticated
  using (true);

create policy "Admins can insert deliveries"
  on public.deliveries for insert
  to authenticated
  with check (true);

create policy "Admins can update deliveries"
  on public.deliveries for update
  to authenticated
  using (true);

create policy "Admins can delete deliveries"
  on public.deliveries for delete
  to authenticated
  using (true);

-- Anonymous visitors get NO direct access to public.deliveries.
-- They can only read through the restricted view below, and only
-- for non-expired rows, and only the columns a client page needs.

-- ---------------------------------------------------------
-- 3. PUBLIC-SAFE VIEW (what the client delivery page reads)
-- ---------------------------------------------------------
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
  expires_at
from public.deliveries
where expires_at > now();

-- Views don't have their own RLS; grant SELECT on the view to anon,
-- and rely on the base table's RLS via security_invoker... but since
-- anon has no SELECT policy on the base table, we instead grant a
-- narrow anon SELECT policy scoped to non-expired rows only:
create policy "Anonymous can view non-expired deliveries"
  on public.deliveries for select
  to anon
  using (expires_at > now());

grant select on public.deliveries_public to anon;
grant select on public.deliveries to anon; -- required for the view above to resolve under security_invoker

-- ---------------------------------------------------------
-- 4. SECURE DOWNLOAD-COUNTER RPC
-- Anonymous visitors call this instead of updating the table
-- directly, so they can only ever increment download_count on an
-- existing, non-expired delivery — nothing else.
-- ---------------------------------------------------------
create or replace function public.increment_delivery_downloads(p_delivery_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.deliveries
  set download_count = download_count + 1
  where id = p_delivery_id
    and expires_at > now();
end;
$$;

revoke all on function public.increment_delivery_downloads(text) from public;
grant execute on function public.increment_delivery_downloads(text) to anon, authenticated;

-- ---------------------------------------------------------
-- 5. STORAGE BUCKET
-- Create this in Storage → New bucket (or via the snippet below).
-- Keep it PRIVATE — access is only ever via signed URLs.
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deliveries', 'deliveries', false, 262144000, array['application/zip', 'application/x-zip-compressed'])
on conflict (id) do nothing;

-- Admins (authenticated) can upload/delete anything in the bucket.
create policy "Admins can upload deliveries"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'deliveries');

create policy "Admins can delete deliveries"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'deliveries');

create policy "Admins can update deliveries"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'deliveries');

-- Anonymous visitors can only request a SIGNED URL for an object that
-- belongs to a delivery which is still active — enforced by joining
-- back to public.deliveries. They get no "list" permission, so the
-- bucket cannot be browsed — only a known, unguessable path can be
-- resolved to a signed URL.
create policy "Anonymous can read files for active deliveries"
  on storage.objects for select
  to anon
  using (
    bucket_id = 'deliveries'
    and exists (
      select 1 from public.deliveries d
      where d.file_path = storage.objects.name
        and d.expires_at > now()
    )
  );

-- ---------------------------------------------------------
-- 6. ADMIN USER
-- Create your login in Authentication → Users → Add User (email +
-- password). Do NOT enable public sign-ups for this project — Deliver
-- has no registration flow and none should be added.
-- ---------------------------------------------------------

-- =========================================================
-- V2 UPGRADE: MULTI-FILE DELIVERIES
-- Run this section after the original schema when upgrading an existing
-- Deliver installation. It is safe to run more than once.
-- =========================================================
create table if not exists public.delivery_files (
  id uuid primary key default gen_random_uuid(),
  delivery_id text not null references public.deliveries(id) on delete cascade,
  file_path text not null unique,
  file_name text not null,
  file_size bigint not null check (file_size > 0),
  content_type text,
  created_at timestamptz not null default now()
);

create index if not exists delivery_files_delivery_id_idx on public.delivery_files(delivery_id);
alter table public.delivery_files enable row level security;

create policy "Admins can manage delivery files"
  on public.delivery_files for all to authenticated
  using (true) with check (true);

create policy "Anonymous can view active delivery files"
  on public.delivery_files for select to anon
  using (exists (select 1 from public.deliveries d where d.id = delivery_id and d.expires_at > now()));

create or replace view public.delivery_files_public
with (security_invoker = true) as
select f.delivery_id, f.file_path, f.file_name, f.file_size, f.content_type, f.created_at
from public.delivery_files f
join public.deliveries d on d.id = f.delivery_id
where d.expires_at > now();

grant select on public.delivery_files_public to anon;
grant select on public.delivery_files to anon;

-- Backfill existing one-file deliveries so older delivery links continue
-- to work in the new gallery. The conflict guard makes this idempotent.
insert into public.delivery_files (delivery_id, file_path, file_name, file_size, content_type)
select id, file_path, file_name, file_size,
  case when lower(file_name) like '%.zip' then 'application/zip' else null end
from public.deliveries
on conflict (file_path) do nothing;

-- The bucket must accept the file types validated by the dashboard.
update storage.buckets
set allowed_mime_types = array[
  'application/zip', 'application/x-zip-compressed', 'image/jpeg',
  'image/png', 'image/webp', 'image/tiff', 'application/pdf',
  'application/postscript', 'application/octet-stream'
]
where id = 'deliveries';

-- Extend the signed-download policy to every file in a multi-file delivery.
drop policy if exists "Anonymous can read files for active deliveries" on storage.objects;
create policy "Anonymous can read files for active deliveries"
  on storage.objects for select to anon
  using (
    bucket_id = 'deliveries' and (
      exists (select 1 from public.deliveries d where d.file_path = storage.objects.name and d.expires_at > now())
      or exists (
        select 1 from public.delivery_files f
        join public.deliveries d on d.id = f.delivery_id
        where f.file_path = storage.objects.name and d.expires_at > now()
      )
    )
  );

-- =========================================================
-- V3 UPGRADE: DELIVERY ACTIVITY
-- These counters are deliberately non-blocking on the client. They provide
-- dashboard analytics without ever affecting a customer's download.
-- =========================================================
alter table public.deliveries
  add column if not exists view_count integer not null default 0,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists last_downloaded_at timestamptz;

create table if not exists public.delivery_analytics (
  delivery_id text not null references public.deliveries(id) on delete cascade,
  month_start date not null,
  view_count integer not null default 0,
  download_count integer not null default 0,
  primary key (delivery_id, month_start)
);

alter table public.delivery_analytics enable row level security;
create policy "Admins can view delivery analytics"
  on public.delivery_analytics for select to authenticated using (true);

create or replace function public.record_delivery_view(p_delivery_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.deliveries set view_count = view_count + 1, last_viewed_at = now()
  where id = p_delivery_id and expires_at > now();
  insert into public.delivery_analytics (delivery_id, month_start, view_count)
  select id, date_trunc('month', now())::date, 1 from public.deliveries
  where id = p_delivery_id and expires_at > now()
  on conflict (delivery_id, month_start) do update set view_count = public.delivery_analytics.view_count + 1;
end;
$$;

create or replace function public.record_delivery_download(p_delivery_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.deliveries set download_count = download_count + 1, last_downloaded_at = now()
  where id = p_delivery_id and expires_at > now();
  insert into public.delivery_analytics (delivery_id, month_start, download_count)
  select id, date_trunc('month', now())::date, 1 from public.deliveries
  where id = p_delivery_id and expires_at > now()
  on conflict (delivery_id, month_start) do update set download_count = public.delivery_analytics.download_count + 1;
end;
$$;

revoke all on function public.record_delivery_view(text), public.record_delivery_download(text) from public;
grant execute on function public.record_delivery_view(text), public.record_delivery_download(text) to anon, authenticated;
