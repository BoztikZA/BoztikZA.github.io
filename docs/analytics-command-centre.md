# Command Centre → Analytics: data contract

What every number on the Analytics tab means, where it comes from, and what it deliberately does not claim.
Code: Worker `deliver/worker-api/src/lib/db.ts` (+ `routes/admin.ts`), frontend `deliver-v3/js/site-analytics.js` and `deliver-v3/js/analytics/*`.

## Vocabulary used on screen

| Label | Meaning |
|---|---|
| **Measured** | Recorded by Boztik's own first-party counters. `0` is a real, measured zero. |
| **Calculated** | Derived from measured numbers (shares, per-100 ratios, % change). The inputs are shown next to it. |
| **Estimate** | An approximation (traffic-source attribution; hourly website shape). The caveat is printed beside it. |
| **Not measured** (`null`, shown as “—” or a hatched band) | The collector had not started yet, or the section is unavailable. Never drawn as 0, never bridged by a line, left out of comparisons. |

## Range model
Presets `today`, `7d`, `30d`, `90d`, `all`, or a custom `from`/`to` (whole local calendar days, `2020-01-01` ≤ from ≤ to ≤ today, at most 366 days).
The Worker validates every range again (422 `invalid_range`) and answers with the window it actually used (`period`). The page refuses to show an answer whose `period` differs from the one requested (an older Worker silently falls back to 30 days).
Day boundaries use `ANALYTICS_UTC_OFFSET_MINUTES` (default UTC+2 / SAST). The "previous" window is the equal-length window immediately before; `all` has none.

## Endpoints (all GET, admin Bearer session, read-only)
`/api/admin/analytics/{summary,trend,traffic-sources,store-clicks,visitor-flow}?period=…|from=…&to=…` and `/health`.
`trend` is new: daily buckets (hourly for `today`), `previous_buckets`, per-collector `coverage`, `totals`, `page_series`, `previous_page_series`, `truncated`. Bucket flags: `partial` (in progress), `future` (not yet happened).

## Metrics
| Metric | Source | Notes |
|---|---|---|
| Page views | `page_analytics` daily counter | Counted page loads. **Not** unique visitors. DNT/GPC visitors not counted. Day resolution only. |
| Hourly page views (Today) | `page_session_events` | Only the share of views that stored a session event; the response states the coverage %. Daily total stays exact. Never compared with a full day. |
| Top page / page share | derived from page views | |
| Entrances / exits / journeys | `page_session_events`, 30-min visit gap | Covers only part of page views; coverage % shown. Not a full funnel. |
| Traffic sources | `traffic_source_visits` | One row per anonymous session, hostname-level. “Direct / unknown” includes hidden referrers. A referrer is not a full journey. |
| Deliver views / downloads / shares | Deliver's own counters | Never added to website page views, never sent to GA4. A download rate is not a conversion rate. |
| Deliveries created | `deliveries` | |
| Store-link clicks | `store_clicks` | Activation of a store link, not a purchase. |

## Comparison rule (“vs previous”)
Computed on **completed** buckets only (the in-progress day/hour is excluded), and only where both periods were measured. No percentage when the earlier period had too few events (20 overall, 10 per page, 8 hourly): the reason is printed instead. “From zero” is shown as *New*, never as an infinite %.

## Insights (“What stands out”)
Rule-based, each with its evidence and basis: like-for-like change ≥ 25 %, a day ≥ 2.5× the median (and ≥ 15 views), page/source concentration ≥ 60 %, three completed zero days after real traffic, store page views with no outbound clicks, Deliver views with no downloads, and coverage caveats. No signal states a cause.

## GA4 (separate source, read-only)
Users, sessions, new/returning, engagement, acquisition (source/medium, channel), landing pages, page paths, key events and `boztik_action` clicks come from GA4 via the Worker (see `docs/ga4-command-centre.md`), in their own card, never added to first-party or Deliver numbers. Until the Worker is configured they show *GA4: not connected*.

## Not implementable honestly (and therefore absent)
Countries/devices from first-party data, conversion rate, revenue, ad revenue, and any outcome (purchase, enquiry, delivery) from an outbound click. These are not collected; shown as *Not available*, never zero.

## Export
`Export CSV` and `Generate Analysis Report` read the same view-model as the screen (`analytics/model.js`), so the numbers match by construction. CSV: unmeasured = empty cell; cells starting `= + - @` are prefixed with `'` to block spreadsheet formula injection.

## Local verification (no production access)
```
cd deliver/worker-api
npm run test                       # unit + retention + traffic-source + pipeline (60) + frontend modules (21)
npx tsc --noEmit
wrangler dev --local --var ALLOWED_ORIGINS:http://localhost:8000
node scripts/seed-analytics-fixture.mjs        # SYNTHETIC local data only; refuses to run if a Cloudflare token is set
python3 -m http.server 8000                    # from the repo root, then open /deliver-v3/dashboard.html
```

## Rollout and rollback
1. **Deploy the Worker first** (`wrangler deploy` in `deliver/worker-api`). No migration is needed (0001–0011 are already applied); the change is additive (new route, new window parameters, one new response field). Old frontend keeps working.
2. Verify read-only: `/api/admin/analytics/trend?period=30d` and `/health` return 200 with an admin session.
3. **Then push the frontend** (GitHub Pages deploys on push to `main`). Cache chain: `dashboard.html → dashboard.js?v=cf-3 → command-centre.js?v=an1 → site-analytics.js?v=an1 → analytics/*.js?v=an1 + css/analytics.css?v=an1`. `api.js` is untouched.
4. Rollback: revert the frontend commit (instant for new loads; allow ~10 min cache). The Worker change is backwards compatible, so it can stay; if it must go, `wrangler rollback`.
If the frontend ships before the Worker, the tab degrades per section (“needs the updated Worker”), shows fixed 30-day page views in a labelled limited mode, and never presents a different range as the one selected.
