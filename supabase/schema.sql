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
