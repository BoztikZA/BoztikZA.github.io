-- Per-delivery support presentation preference.
-- Kept in existing private source_meta so this is backwards compatible and
-- does not add a new table/column. Existing deliveries default to true.
-- The public view receives only this safe derived boolean, never source_meta.

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
where expires_at > now();
