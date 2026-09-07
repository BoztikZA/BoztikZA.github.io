-- =========================================================
-- V6 UPGRADE: PHOTOSHOPBATTLES PRESENTATION FLAG
--
-- The public delivery page must never receive source_meta, because it can
-- contain the direct-image token. It only needs this safe derived boolean to
-- select the clean PhotoshopBattles presentation.
-- =========================================================
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
  (source = 'reddit' and coalesce(source_meta->>'type', '') = 'photoshop_battles')
    as is_photoshop_battles
from public.deliveries
where expires_at > now();
