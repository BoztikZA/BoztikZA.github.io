# Boztik Deliver API (Cloudflare Worker + D1 + R2)

Replaces the Supabase backend for Boztik Deliver. The Worker is the **only** gateway to R2 and D1:
the bucket stays private, the browser never receives an R2 credential/URL, and auth is Worker-owned
(no Cloudflare Access). Frontend: `../../deliver-v3/`. The old Supabase system in `../` is untouched (rollback).

## Guarantees (all covered by `npm run test:e2e`)
- **3 GB hard cap**, compiled in (`HARD_CAP_BYTES`); config can only lower it. Admission is one atomic SQL
  statement (`used + reserved + incoming <= limit`) evaluated BEFORE any byte is written; fail-closed if the
  ledger is uncertain or R2 is unreachable. Levels: 70 / 85 / 95 / 100 %.
- **Delete order:** R2 objects first; D1 rows only for objects R2 confirmed deleted.
- **24 h expiry:** enforced at read time (an expired delivery is never served, even with a valid signed URL);
  cron (every 10 min) and the dashboard "Clean expired" button remove the bytes and release storage.
- **PhotoshopBattles:** single JPG/PNG only, enforced server side incl. magic-byte check.
- Files are stored as `deliveries/<id>/<fileId>-<name>`; downloads use short-lived HMAC-signed Worker URLs.

## First-time deploy (manual steps)
```bash
cd deliver/worker-api
npm ci
npx wrangler login
npx wrangler d1 list                      # copy the id of `boztik-deliver` into wrangler.toml (database_id)
npm run db:migrate:remote                 # applies 0001 + 0002
node scripts/hash-password.mjs            # prompts for a >=12 char password, prints ADMIN_PASSWORD_HASH
node scripts/hash-password.mjs --salt     # prints AUTH_TOKEN_SALT
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put AUTH_TOKEN_SALT
npx wrangler deploy
curl https://deliver-api.boztik.com/api/health
```
`deliver-api.boztik.com` is a Custom Domain; the `boztik.com` zone must be on Cloudflare. If you would rather
test first on `*.workers.dev`, remember browser calls from www.boztik.com are still CORS-restricted to
`ALLOWED_ORIGINS`.

## Local development & tests
Create `.dev.vars` (git-ignored) with the three secret names, then:
```bash
npm run db:migrate:local
npx wrangler dev --local --port 8787 --var STORAGE_LIMIT_BYTES:5242880 --var ALLOWED_ORIGINS:http://localhost:8000
BASE=http://localhost:8787 E2E_USER=<user> E2E_PASS=<pass> npm run test:e2e        # API suite
node scripts/client-contract.mjs                                                    # real frontend modules vs the Worker
# real 3 GiB boundary: restart WITHOUT the STORAGE_LIMIT_BYTES override, then E2E_HARD=1 ... npm run test:e2e
```
Note: under `wrangler dev` signed URLs carry the route hostname (`deliver-api.boztik.com`); the tests rewrite it.

## Cutover (when you are happy)
Rename `deliver/` -> `deliver-supabase-legacy/` and `deliver-v3/` -> `deliver/` (links are built from the page's own
directory, so nothing else changes). Keep the legacy folder until you are confident.
