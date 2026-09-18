-- =========================================================
-- STORAGE USAGE MONITOR — Command Centre "Storage & usage"
-- panel.
--
-- Authoritative, byte-exact usage from the storage.objects
-- catalog (the same source Supabase billing uses for Storage
-- size). Aggregated server-side only. The function runs as a
-- SECURITY DEFINER (owner = postgres) so it can read the
-- storage.objects catalog directly, and EXECUTE is revoked
-- from public/anon/authenticated so it is ONLY callable by the
-- server-side Edge Function (service_role) — never from a
-- browser with the anon key.
-- =========================================================

create or replace function public.storage_usage_summary()
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with agg as (
    select
      bucket_id,
      count(*)::bigint as objects,
      coalesce(sum((metadata ->> 'size')::bigint), 0)::bigint as bytes
    from storage.objects
    group by bucket_id
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'bytes',   coalesce(sum(bytes), 0),
        'objects', coalesce(sum(objects), 0)
      )
      from agg
    ),
    'buckets', (
      select coalesce(
               jsonb_object_agg(
                 bucket_id,
                 jsonb_build_object('bytes', bytes, 'objects', objects)
               ),
               '{}'::jsonb
             )
      from agg
    ),
    'generated_at', now()
  );
$$;

comment on function public.storage_usage_summary() is
  'Returns authoritative Supabase storage usage (bytes + object count, per bucket and total). Macro-stats only. Restricted to service_role; call via the storage-usage Edge Function.';

-- Only the server-side Edge Function (service_role) may invoke this.
revoke all on function public.storage_usage_summary() from public;
revoke all on function public.storage_usage_summary() from anon;
revoke all on function public.storage_usage_summary() from authenticated;
grant execute on function public.storage_usage_summary() to service_role;