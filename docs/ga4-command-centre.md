# GA4 in Command Centre — setup, verification, rollout

Read-only Google Analytics 4 reporting inside the existing **Analytics** tab (card "Google Analytics 4").
Measurement ID on the public site: `G-H8W54EBM20` (tracking only — **not** used by the Data API).

## What it is / is not
- Worker route family `GET /api/admin/analytics/ga4/*`, behind the **existing admin Bearer session** (same as every other admin route). GET only.
- Fixed catalogue of named reports (overview, sources, channels, landing-pages, pages, new-returning, key-events, actions). The browser cannot choose dimensions, metrics or filters.
- Scope: `https://www.googleapis.com/auth/analytics.readonly`. No writes to Google, **no writes to D1/R2** (only a short HTTP cache).
- Credentials exist only as Worker secrets. They never reach the browser, responses, logs or Git.
- GA4, first-party counters and Deliver counters are three separate sources. They are never summed; each card names its source.
- `boztik_action` counts are **clicks on links** — never purchases, enquiries, posts or deliveries.
- Unconfigured/unavailable reports show as unavailable, never as zero. No historical backfill.

## One-time setup (Clint)
1. Google Cloud: create/choose a project → enable **Google Analytics Data API**.
2. Create a service account (no project roles needed) → create a JSON key.
3. GA4 → Admin → **Property access management** → add the service account email as **Viewer**.
4. GA4 → Admin → Property details → copy the **numeric property ID**.
5. Set secrets (production change — only after deployment is authorised):
   ```
   cd deliver/worker-api
   npx wrangler secret put GA4_PROPERTY_ID            # numeric, e.g. 123456789
   npx wrangler secret put GA4_SERVICE_ACCOUNT_JSON   # paste the whole JSON key
   # optional: GA4_CACHE_SECONDS (clamped 60–3600)
   ```
6. GA4 → Admin → **Custom definitions** → register as **event-scoped** custom dimensions: `action`, `destination`, `position`, `page_key` (event parameter names of `boztik_action`). GA4 only fills them from registration onward; until then the card shows guidance instead of a breakdown.
7. Delete the downloaded key file locally.

## Verification (live — not covered by the mocked tests)
1. Sign in to Command Centre → Analytics → GA4 card → **Check connection** (`/ga4/status?verify=1`): expect "Connection verified" and the list of registered custom dimensions.
2. Compare Users/Sessions for the same dates against the GA4 UI (allow for GA4 processing lag and thresholding).
3. Click an outbound store link on the public site (with analytics consent), wait for GA4 processing, confirm it appears under Commercial actions (needs step 6).

Error meanings: `ga4_not_configured` (secrets missing), `ga4_permission_denied` (Viewer/API not enabled), quota/rate (backs off, last good data kept).

## Rollout order
1. Deploy the Worker (`cd deliver/worker-api && npm test && npx wrangler deploy`). This also activates the already-written first-party routes (trend, health, visitor flow, `text/plain` ingest) that the older deployed Worker lacked. No D1 migration is required by the GA4 work.
2. Push `main` (GitHub Pages deploys the dashboard; asset versions bumped: `an2`, `ga1`, `cf-4`).
3. Set the secrets (above), verify.

Frontend before Worker is safe: an older Worker answers 404 and the card says the Worker needs updating.

## Rollback
- Remove the GA4 secrets (card returns to "not connected"), or redeploy the previous Worker version (`npx wrangler rollback`), or revert the frontend commit. No data migration to undo.

## Tests
`cd deliver/worker-api && npm test` (includes `test:ga4` — mocked Google, and `test:ga4-client`). All Google responses in those tests are mocked; only the steps above prove the live connection.
