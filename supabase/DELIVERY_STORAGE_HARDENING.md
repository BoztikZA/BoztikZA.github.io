# Deliver storage hardening deployment

1. Review and apply `20260919090000_delivery_storage_hardening.sql`. It archives
   orphan `delivery_files` rows before removing them, then adds the foreign key.
2. Set the allowlist before deploying the function. Use the UUID(s) of the
   intended dashboard administrator only:

   `supabase secrets set DELIVERY_ADMIN_USER_IDS="uuid-1,uuid-2" --project-ref hwcxxotgtqchcriascti`

3. Deploy `delivery-maintenance`. It is the only endpoint used for usage and
   deletion. The legacy `storage-usage` function is no longer required.
4. Do not deploy or schedule `cleanup-expired-deliveries`; it now returns 410.

## Manual backlog cleanup

Request `{"action":"cleanup_preview","limit":25}` from an allowlisted admin
session. Review expired delivery paths, orphan Storage paths, and estimated bytes.
Then request `{"action":"cleanup_execute","limit":25,"confirm":true}`. Repeat
only after reviewing each report. Orphan Storage objects are intentionally only
reported, not deleted by the delivery cleanup endpoint.

Deletion is idempotent: a missing delivery returns `already_deleted`; an object
already absent is acceptable only after the catalog-verification RPC confirms no
requested path remains. Metadata is never removed after a failed verification.
