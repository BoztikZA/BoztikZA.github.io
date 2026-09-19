-- ============================================================================
-- SITE ANALYTICS — public Boztik website traffic analytics
-- ============================================================================
-- A private, persistent analytics layer for the PUBLIC website (homepage,
-- portfolio, tools, guides, …). It is deliberately COMPLETELY SEPARATE from
-- the delivery analytics system (delivery_analytics / record_delivery_*):
--   * the PUBLIC tracking beacon writes via record_site_visit   (anon EXECUTE)
--   * the COMMAND CENTRE reads via get_site_analytics          (authenticated)
-- All three tables have RLS enabled with NO anon table policies — anonymous
-- visitors can never touch the tables directly; they may only EXECUTE the
-- write RPC. Reads are surfaced only through the authenticated read RPC / the
-- authenticated SELECT policies (Command Centre only).
--
-- Storage model (3 tiers, kept small on purpose):
--   1. site_visits            raw events (source of truth)
--   2. site_visitors_month    one row per (month, visitor_key), used to
--                             estimate UNIQUE visitors per month / all-time
--   3. site_analytics_month   one row per calendar month (aggregate cache),
--                             so dashboard reads stay O(months) — a handful
--                             of rows regardless of raw event volume.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. RAW VISIT EVENTS
-- ---------------------------------------------------------------------------
create table if not exists public.site_visits (
  id          bigint generated always as identity primary key,
  visited_at  timestamptz not null default now(),
  month_start date        not null,
  page        text        not null default 'home',
  source      text        not null default 'direct',
  device      text        not null default 'desktop',
  browser     text        not null default 'other',
  os          text        not null default 'other',
  country     text,
  region      text,
  city        text,
  visitor_key text
);

create index if not exists site_visits_visited_at_idx on public.site_visits (visited_at);
create index if not exists site_visits_month_idx      on public.site_visits (month_start);

alter table public.site_visits enable row level security;

create policy "Admins can read raw site visits"
  on public.site_visits
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. PER-MONTH UNIQUE VISITORS (estimated)
-- ---------------------------------------------------------------------------
-- Rows appear ONLY when a NEW visitor_key is seen for a given month, so this
-- table stays bounded by (active visitors × months). count(distinct visitor_key)
-- across all rows gives an all-time-unique estimate cheaply.
-- ---------------------------------------------------------------------------
create table if not exists public.site_visitors_month (
  month_start   date        not null,
  visitor_key   text        not null,
  first_seen_at timestamptz not null default now(),
  primary key (month_start, visitor_key)
);

create index if not exists site_visitors_month_month_idx
  on public.site_visitors_month (month_start);

alter table public.site_visitors_month enable row level security;

create policy "Admins can read site visitor estimates"
  on public.site_visitors_month
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. MONTHLY AGGREGATE CACHE
-- ---------------------------------------------------------------------------
-- One row per calendar month, maintained by record_site_visit. Reading this
-- back is the cheap path used by get_site_analytics (and therefore by the
-- dashboard's Site Analytics panel).
-- ---------------------------------------------------------------------------
create table if not exists public.site_analytics_month (
  month_start     date primary key,
  visits          integer not null default 0,
  unique_visitors integer not null default 0,
  sources         jsonb   not null default '{}'::jsonb,
  locations       jsonb   not null default '{}'::jsonb,
  devices         jsonb   not null default '{}'::jsonb,
  browsers        jsonb   not null default '{}'::jsonb,
  os              jsonb   not null default '{}'::jsonb,
  pages           jsonb   not null default '{}'::jsonb
);

alter table public.site_analytics_month enable row level security;

create policy "Admins can read site analytics"
  on public.site_analytics_month
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- jsonb increment helper (used inside record_site_visit; definer-scoped)
-- ---------------------------------------------------------------------------
create or replace function public._jsonb_increment(
  target jsonb,
  key    text,
  by     integer default 1
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(target, '{}'::jsonb)
         || jsonb_build_object(coalesce(key, 'Unknown'), coalesce((target ->> key)::int, 0) + by)
$$;

-- ---------------------------------------------------------------------------
-- WRITE RPC — called by the public tracking beacon (anon)
--   * security definer -> runs as owner, bypasses RLS for the write
--   * coalesces/sanitises its own inputs (never trusts the client blindly)
--   * writes the raw event, tracks the month's unique visitor, and upserts
--     the month's aggregate cache in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.record_site_visit(
  p_page        text default 'home',
  p_source      text default 'direct',
  p_device      text default 'desktop',
  p_browser     text default 'other',
  p_os          text default 'other',
  p_country     text default null,
  p_region      text default null,
  p_city        text default null,
  p_visitor_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m         date    := date_trunc('month', now())::date;
  is_new    boolean := false;
  cnt       bigint;
  v_page    text    := lower(coalesce(nullif(left(coalesce(p_page, 'home'), 64),  ''), 'home'));
  v_source  text    := lower(coalesce(nullif(left(coalesce(p_source, 'direct'), 32), ''), 'direct'));
  v_device  text    := lower(coalesce(nullif(left(coalesce(p_device, 'desktop'), 16), ''), 'desktop'));
  v_browser text    := lower(coalesce(nullif(left(coalesce(p_browser, 'other'), 16), ''), 'other'));
  v_os      text    := lower(coalesce(nullif(left(coalesce(p_os, 'other'), 16), ''), 'other'));
  v_country text    := nullif(left(coalesce(p_country, ''), 32), '');
  v_region  text    := nullif(left(coalesce(p_region, ''), 64), '');
  v_city    text    := nullif(left(coalesce(p_city, ''), 64), '');
  v_key     text    := nullif(left(coalesce(p_visitor_key, ''), 96), '');
begin
  -- 1. Raw event (source of truth).
  insert into public.site_visits
    (visited_at, month_start, page, source, device, browser, os, country, region, city, visitor_key)
  values
    (now(), m, v_page, v_source, v_device, v_browser, v_os, v_country, v_region, v_city, v_key);

  -- 2. Track the month's unique visitor, but ONLY when a key was supplied.
  if v_key is not null then
    insert into public.site_visitors_month (month_start, visitor_key)
    values (m, v_key)
    on conflict (month_start, visitor_key) do nothing;

    get diagnostics cnt = row_count;
    is_new := (cnt = 1);
  end if;

  -- 3. Upsert this month's aggregate cache.
  insert into public.site_analytics_month
    (month_start, visits, unique_visitors, sources, locations, devices, browsers, os, pages)
  values (
    m, 1, case when is_new then 1 else 0 end,
    jsonb_build_object(v_source, 1),
    jsonb_build_object(coalesce(v_country, 'Unknown'), 1),
    jsonb_build_object(v_device, 1),
    jsonb_build_object(v_browser, 1),
    jsonb_build_object(v_os, 1),
    jsonb_build_object(v_page, 1)
  )
  on conflict (month_start) do update set
    visits          = public.site_analytics_month.visits + 1,
    unique_visitors = public.site_analytics_month.unique_visitors + case when is_new then 1 else 0 end,
    sources         = public._jsonb_increment(public.site_analytics_month.sources, v_source),
    locations       = public._jsonb_increment(public.site_analytics_month.locations, v_country),
    devices         = public._jsonb_increment(public.site_analytics_month.devices, v_device),
    browsers        = public._jsonb_increment(public.site_analytics_month.browsers, v_browser),
    os              = public._jsonb_increment(public.site_analytics_month.os,       v_os),
    pages           = public._jsonb_increment(public.site_analytics_month.pages,    v_page);

  return;
end;
$$;

revoke all on function public.record_site_visit
  (text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.record_site_visit
  (text, text, text, text, text, text, text, text, text) from anon;
grant execute on function public.record_site_visit
  (text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- READ RPC — called by the COMMAND CENTRE Site Analytics panel (authenticated)
--   * security definer -> runs as owner, so the cheap cached reads never hit RLS
--   * returns a compact { months[], totals{} } — one object per calendar month
--     plus totals — so the dashboard aggregates distributions client-side from
--     a handful of rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_site_analytics()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'months', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'month',            month,
            'visits',           visits,
            'unique_visitors',  unique_visitors,
            'sources',          sources,
            'locations',        locations,
            'devices',          devices,
            'browsers',         browsers,
            'os',               os,
            'pages',            pages
          ) order by month_start
        ),
        '[]'::jsonb
      )
      from (
        select
          to_char(month_start, 'YYYY-MM') as month,
          month_start,
          visits,
          unique_visitors,
          sources,
          locations,
          devices,
          browsers,
          os,
          pages
        from public.site_analytics_month
      ) m
    ),
    'totals', (
      select jsonb_build_object(
        'visits', (
          select coalesce(sum(visits), 0) from public.site_analytics_month
        ),
        'unique_visitors', (
          select count(distinct visitor_key)
          from public.site_visitors_month
          where visitor_key is not null
        )
      )
    )
  );
$$;

revoke all on function public.get_site_analytics() from public;
revoke all on function public.get_site_analytics() from anon;
revoke all on function public.get_site_analytics() from authenticated;
grant execute on function public.get_site_analytics() to authenticated;