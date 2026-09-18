# Cleanup-expired-deliveries — automatic Storage cleanup

Boztik Deliver keeps the physical delivery files in the private Supabase
Storage bucket `deliveries` only for the lifetime of the delivery. This
Edge Function removes the physical objects for deliveries whose
`expires_at` has passed, then records `deliveries.storage_deleted_at` so
the job never touches them again. It does **not** delete the delivery row
or its analytics (`view_count`, `download_count`, `delivery_analytics`).

> The public page, signed URLs and storage reads already refuse to serve
> an expired delivery independently of this job (`deliveries_public`,
> `delivery_files_public`, RLS, and the `deliver-file` signer all gate on
> `expires_at > now()` — and, since the `20260918120000_cleanup_access_hardening`
> migration, on `storage_deleted_at is null` too). Cleanup is the Layer-2
> job that reclaims the bytes; it is never the access gate.

## How it behaves

- **Scope**: only `deliveries` where `expires_at < now()` and
  `storage_deleted_at is null`.
- **Discovery**: reads each delivery's `file_path` plus its `delivery_files`
  rows, so the exact objects are removed — never a filename glob, never the
  whole bucket, never another delivery's files.
- **Idempotent**: a row is marked only after its own Storage removal
  succeeds; already-reportedly-missing objects are treated as success, so a
  repeated run (or recovery from an interrupted run) cannot fault a delivery.
- **Isolated failures**: one failing delivery never blocks the rest; every
  run returns `{ cleaned, failed, filesRemoved, ids, failures }` and logs a
  summary plus per-failure errors for diagnosis.

## Deploy

Privileged, server-side only. No key ever needs to reach the browser.

```sh
supabase functions deploy cleanup-expired-deliveries --project-ref hwcxxotgtqchcriascti
supabase secrets set CLEANUP_SECRET='<strong-random-value>'  --project-ref hwcxxotgtqchcriascti
```

`SUPABASE_SERVICE_ROLE_KEY` is injected automatically by the Supabase
function runtime (do **not** check it into the repo). The function rejects
requests that do not send the matching `x-cleanup-secret` header.

## Schedule (every 30 minutes)

Apply the declarative job in `supabase/cron/jobs.sql` through the Dashboard
**Integrations → Cron → SQL** (or the SQL Editor). Before running it:

1. Enable the **pg_cron** extension (Cron module) and the **pg_net**
   extension:
   ```sql
   create extension if not exists pg_net;
   ```
2. Store the two Vault secrets it loads (the anon key is public and already
   in `js/config.js`; `CLEANUP_SECRET` must match the function secret):
   ```sql
   select vault.create_secret('<anon key>',       'SUPABASE_ANON_KEY');
   select vault.create_secret('<CLEANUP_SECRET>', 'CLEANUP_SECRET');
   ```
3. Run the statements in `supabase/cron/jobs.sql`.

Monitor runs:
```sql
select * from cron.job_run_details order by start_time desc limit 20;
```

## Verify (against the deployed project)

- Create a delivery, copy its client URL, open it in a private window.
- Manually delete it — its Storage objects disappear while its history stays
  in Command Centre; the client URL must no longer load.
- Create a delivery that expires soon; after the job next runs, confirm
  `storage_deleted_at` is populated and `view_count` / `download_count` /
  `delivery_analytics` are intact.

## Deployment status

These repository changes are **implemented but not yet deployed/configured**:

- `supabase/migrations/20260918120000_cleanup_access_hardening.sql`
  (apply with `supabase db push` / SQL Editor — redundant with schema.sql V8)
- `supabase/functions/cleanup-expired-deliveries/index.ts` (redeploy)
- `supabase/cron/jobs.sql` (run once, after enabling pg_cron + pg_net and
  setting the Vault secrets)

Nothing here has been run against the live project in this session. Do not
schedule or test cleanup against historical files until the prior Supabase
Storage restriction has been lifted and a reviewed backup/export exists.