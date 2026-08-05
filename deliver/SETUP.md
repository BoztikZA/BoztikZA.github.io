# Boztik Deliver — Setup Guide

Production-ready client delivery system, integrated into the existing
Boztik Creative Toolkit website. Static frontend on GitHub Pages,
backend on Supabase (Postgres + Auth + Storage). No server of your own.

## What was built

```
deliver/
  index.html              Client delivery page (public, reads ?id=)
  dashboard.html           Admin dashboard (private, requires login)
  SETUP.md                 This file
  css/
    deliver.css            Module styles — reuses your existing theme tokens
  js/
    deliver-config.js       Supabase URL/key + module settings — EDIT THIS
    deliver-shared.js       Shared helpers (ID gen, formatting, toasts, Supabase client)
    deliver-client.js       Client page logic
    deliver-dashboard.js    Admin dashboard logic

supabase/
  schema.sql                          Full SQL: table, RLS policies, RPC, storage bucket
  functions/cleanup-expired-deliveries/index.ts   Edge Function for auto-deletion
```

Nothing outside `deliver/` and `supabase/` was touched, except that
you should add one link to `dashboard.html` from wherever you keep
private bookmarks (it's intentionally **not** linked from the public
nav — it's `noindex` and unlisted, reachable only if you know the URL).

## 1. Supabase project setup

You already have a project: `https://hwcxxotgtqchcriascti.supabase.co`.

1. **Get your anon key**: Project Settings → API → "Project API keys" →
   copy the `anon` `public` key (NOT `service_role`).
2. Paste it into `deliver/js/deliver-config.js`:
   ```js
   SUPABASE_ANON_KEY: "eyJ...", // your real anon key
   ```
   This key is safe to publish — it only grants what the RLS policies
   below allow. Never put the `service_role` key in any file in this repo.

## 2. Run the database schema

Open **SQL Editor** in your Supabase dashboard, paste the entire
contents of `supabase/schema.sql`, and run it. This creates:

- `public.deliveries` — the table holding delivery metadata
- Row Level Security policies:
  - Authenticated (you, logged into the dashboard) → full read/write
  - Anonymous (client visitors) → can only read **non-expired** rows,
    and only via the safe columns exposed
- `public.deliveries_public` — a restricted view the client page reads
- `increment_delivery_downloads()` — a `SECURITY DEFINER` function so
  anonymous visitors can bump the download counter without being able
  to write anything else
- The `deliveries` Storage bucket (private, 250MB limit, ZIP only)
- Storage RLS policies:
  - Authenticated → upload/update/delete
  - Anonymous → can request a **signed URL** for a file *only if* its
    parent delivery is still active — they can never list the bucket

## 3. Create your admin login

Supabase Dashboard → **Authentication → Users → Add User**. Use your
own email + a strong password. Boztik Deliver has **no sign-up flow**
by design — do not enable public sign-ups in Auth settings.

## 4. Deploy

Nothing to build — it's static. Commit and push:

```bash
git add deliver/ supabase/
git commit -m "Add Boztik Deliver: secure client delivery system"
git push
```

GitHub Pages picks it up automatically. Your dashboard will be live at:

```
https://boztikza.github.io/deliver/dashboard.html
```

and client links will look like:

```
https://boztikza.github.io/deliver/?id=BZ-8FQX92K
```

(Double-check `PUBLIC_BASE_URL` in `deliver-config.js` matches your
actual GitHub Pages URL / custom domain.)

## 5. Automatic deletion of expired deliveries (optional but recommended)

GitHub Pages can't run scheduled jobs — deletion needs to happen on
Supabase's side. Two ways to enforce expiration; use both together for
defense-in-depth:

**Already enforced without any extra setup:**
The client page and RLS policies both check `expires_at > now()`, so
an expired delivery is immediately inaccessible even if the file is
still physically sitting in Storage. From a visitor's perspective,
expiration works today with zero extra deployment.

**For actually freeing up storage space (recommended, needs deploy):**
1. Install the Supabase CLI and link your project:
   ```bash
   supabase login
   supabase link --project-ref hwcxxotgtqchcriascti
   ```
2. Deploy the function:
   ```bash
   supabase functions deploy cleanup-expired-deliveries
   ```
3. (Optional) Set a shared secret so it can't be triggered by anyone
   who finds the URL:
   ```bash
   supabase secrets set CLEANUP_SECRET=some-long-random-string
   ```
4. Schedule it — easiest option is **Database → Cron Jobs** (pg_cron,
   available on all plans) in the Supabase dashboard:
   ```sql
   select cron.schedule(
     'cleanup-expired-deliveries-daily',
     '0 3 * * *', -- 3am daily
     $$
     select net.http_post(
       url := 'https://hwcxxotgtqchcriascti.supabase.co/functions/v1/cleanup-expired-deliveries',
       headers := jsonb_build_object('x-cleanup-secret', 'some-long-random-string')
     );
     $$
   );
   ```
   (Requires the `pg_cron` and `pg_net` extensions — enable both under
   **Database → Extensions** first.)

## 6. Storage limits & cost

- Supabase free tier: 1GB storage, 2GB egress/month — fine for a
  handful of client deliveries a month. If Boztik Deliver takes off,
  Supabase Pro ($25/mo) gives 100GB storage + 250GB egress.
- The 250MB per-file cap is enforced both client-side
  (`deliver-config.js` → `MAX_UPLOAD_BYTES`) and server-side (the
  bucket's `file_size_limit` in `schema.sql`). Raise both together if
  you need bigger files.

## 7. Testing checklist

- [ ] Log into `/deliver/dashboard.html`, confirm the login screen
      rejects wrong passwords with a clear error
- [ ] Upload a small ZIP, confirm it appears in "Recent Deliveries"
      and the link auto-copies to your clipboard
- [ ] Open the copied link in an incognito window — confirm the file
      downloads and the counter increments
- [ ] Manually set a delivery's `expires_at` to the past in the SQL
      editor, refresh the client link — confirm it shows the expired
      state
- [ ] Delete a delivery from the dashboard, confirm both the DB row
      and Storage object are gone
- [ ] Confirm `dashboard.html` is not linked anywhere in the public
      nav/sitemap

## Architecture notes / trade-offs

- **Why signed URLs instead of a public bucket**: signed URLs expire
  (60s window here, regenerated per click) and are gated by the RLS
  policy checking `expires_at`, so a shared/leaked signed URL doesn't
  outlive the delivery. A fully public bucket would rely on
  security-through-obscurity of the file path.
- **Why an RPC for the download counter**: anonymous visitors need to
  write *something* (the counter), but RLS can't easily express
  "increment exactly one column, exactly one row, and only if active."
  A `SECURITY DEFINER` function is the standard Postgres/Supabase
  pattern for that narrow write.
- **Why a view (`deliveries_public`) for reads**: keeps the anon-facing
  query shape stable and explicit, separate from the admin table shape,
  so future admin-only columns (e.g. internal pricing notes) can be
  added to `deliveries` without any risk of leaking through the client
  page.
