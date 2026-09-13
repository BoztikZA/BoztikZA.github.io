# Boztik Deliver setup

Boztik Deliver is a static premium client-delivery interface backed by Supabase Auth, Postgres, private Storage, and the `deliver-file` signer. The active production site must not depend on Cloudflare Workers, R2, D1, or Cloudflare Access.

## Before deploying

1. Apply the reviewed Supabase migrations and schema changes needed by this project. Do not re-run the complete schema blindly against production.
2. Confirm the `deliveries` bucket remains private and that its existing RLS policies are intact.
3. Confirm the anon key in `js/config.js` is the public anon key for project `hwcxxotgtqchcriascti`. Never use a service-role key in the static site.
4. Deploy the secure file signer: `supabase functions deploy deliver-file --project-ref hwcxxotgtqchcriascti`. It verifies that a file belongs to an active delivery before issuing a short-lived URL.
5. After the lifecycle migration is applied, deploy `cleanup-expired-deliveries` and set a strong `CLEANUP_SECRET` function secret. Create and monitor a daily Supabase Cron job that invokes it. The function removes only expired physical Storage objects and sets `deliveries.storage_deleted_at`; it does not delete delivery rows or analytics.

## Verification

- Sign in at `deliver/dashboard.html`, create a small test delivery, and verify the copied client URL in a private window.
- Check image preview, individual and all-file downloads, and the view/download counters.
- Delete a test delivery; its Storage objects should disappear while its delivery history remains visible in Command Centre.
- Make a test delivery expire, run cleanup, and verify `storage_deleted_at` is populated while `view_count`, `download_count`, and `delivery_analytics` remain intact.

Do not schedule or test cleanup against historical files until the Supabase restriction has been lifted and a reviewed backup/export exists.
