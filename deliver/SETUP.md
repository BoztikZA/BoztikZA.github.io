# Boztik Deliver v2 setup

Boztik Deliver is a static premium client-delivery interface backed by Supabase Auth, Postgres and private Storage.

## Before deploying

1. In Supabase SQL Editor, run the complete [`../supabase/schema.sql`](../supabase/schema.sql) file. The final V2 section creates the multi-file table, public-safe view and backfills older deliveries.
2. Create the `deliveries` bucket as private if it does not already exist; the SQL also applies its file-type rules.
3. In Authentication, create the administrator user in project `hwcxxotgtqchcriascti`. Disable public sign-ups.
4. Confirm the anon key in `js/config.js` is the **anon public key from this same project**. Never use a service-role key in this static site.
5. Set `publicBaseUrl` to the deployed Deliver directory. The configured PayPal support URL is `http://paypal.me/angry5p1c3`.

## Authentication checks

Open `deliver/dashboard.html` in a normal browser window. A successful login creates a persistent `boztik-deliver-auth-v2` browser session; reload once to confirm session restoration, then log out to clear it.

If Supabase reports invalid login credentials, the supplied email/password are not a user in the configured project. If it reports email verification, confirm that user in Authentication > Users. The dashboard now displays Supabase’s actual safe error instead of replacing every failure with one generic message.

## Delivery checks

- Upload a small ZIP and a JPG together; both should appear in the delivery.
- Open the copied client link in a private window and test individual and all-file downloads.
- Set `expires_at` in the past and refresh; the delivery should become unavailable.
- Delete a test delivery; its Storage objects should be removed with the record.

For automatic physical removal of expired uploads, deploy and schedule the existing `cleanup-expired-deliveries` Supabase Edge Function.
