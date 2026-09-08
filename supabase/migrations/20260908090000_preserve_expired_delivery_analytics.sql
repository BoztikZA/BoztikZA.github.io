-- Retain expired delivery records and analytics after their files are removed
-- by cleanup-expired-deliveries.
alter table public.deliveries
  add column if not exists storage_deleted_at timestamptz;

comment on column public.deliveries.storage_deleted_at is
  'When set, storage files were permanently removed after expiry; delivery and analytics records remain for Command Centre reporting.';
