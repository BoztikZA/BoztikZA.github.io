# Boztik Learning Hub — deployment runbook

Nothing in this branch has been deployed, migrated or pushed. Everything below is a manual step for the site owner.
Order matters: **validate → migrate remote D1 → deploy Worker → verify API → merge to `main` (publishes Pages) → smoke test → (optional) PayPal.**
Stop at the first failure. Never merge before the Worker is live: the Learning pages call `https://deliver-api.boztik.com/api/learning/*`.

Prerequisites: `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` with Workers + D1 edit) for Worker `boztik-deliver-api` and D1 `boztik-deliver`.
Run from `deliver/worker-api` on the feature branch.

## 0. Pre-flight (read-only)

```bash
git checkout feature/boztik-learning-hub
cd deliver/worker-api && npm ci
npm run typecheck && npm test              # must be green (includes learning content + API tests)
npm run learning:check                      # generated manifest, courses.json and static pages are in sync
npm run db:migrate:local
npx wrangler d1 migrations list boztik-deliver --remote   # read the real production level first
```

Production should be at `0022_spotlight_rotation.sql`; `0023_learning_hub.sql` is the only new migration. If production
differs from the repository history, stop and investigate.

## 1. Apply the D1 migration

`0023` only **creates** new `learning_*` tables (`IF NOT EXISTS`). It does not alter or read any existing table.

```bash
npm run db:migrate:remote
npx wrangler d1 execute boztik-deliver --remote --command "SELECT name FROM sqlite_master WHERE name LIKE 'learning_%' ORDER BY name"
```

Expect 9 tables: audit, attempts, certificates, contributions, enrolments, learners, progress, usage, webhook_events.
Rollback if ever needed: drop those nine tables; no other table depends on them.

## 2. Deploy the Worker

```bash
npx wrangler deploy
```

Bundle is about 1.26 MiB (323 KiB gzip). No new bindings, no R2 use, no new cron triggers; the existing cron refreshes Learning usage.
Verify:

```bash
curl -s https://deliver-api.boztik.com/api/learning/config | head -c 400     # 3 courses + contribution config, no learner data
curl -s -o /dev/null -w "%{http_code}\n" https://deliver-api.boztik.com/api/admin/learning/overview   # 401 without admin login
```

## 3. Merge and verify Pages

Merge the PR to `main`; GitHub Pages publishes `/learning/` and the Command Centre panel. Check:

- https://www.boztik.com/learning/ (8 categories, 3 courses, free resources feature)
- https://www.boztik.com/learning/resources/ and each article URL; confirm canonical, Article schema, source links and course CTAs.
- A course page, then enrol with a test name, finish a lesson, open the private link from another browser.
- `/guides/` and the main nav still work; "Courses" appears in the nav.
- `/deliver-v3/dashboard.html` → sign in → **Learning** tab loads overview, courses, certificates, learner sessions, contributions & storage.
- `https://www.boztik.com/sitemap.xml` includes the Learning URLs; private pages (`/learning/learn/`, `/exam/`, `/dashboard/`, `/resume/`, `/thanks/`) are `noindex`.

Then run one full pass as a test learner (AI course is quickest), claim the certificate, download the PDF, open the verification URL
printed on it, revoke it from the Command Centre, and confirm verification shows "revoked". Delete the test learner via their dashboard.

## 4. Optional: PayPal contributions (off until all of this is done)

Contributions are inert by default. Certificates never depend on them.

1. In the PayPal developer dashboard create a **sandbox** REST app and a webhook pointing at
   `https://deliver-api.boztik.com/api/learning/paypal/webhook` subscribed to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`.
2. Set secrets (never commit them):
   ```bash
   npx wrangler secret put PAYPAL_CLIENT_ID
   npx wrangler secret put PAYPAL_CLIENT_SECRET
   npx wrangler secret put PAYPAL_WEBHOOK_ID
   ```
3. Add vars in `wrangler.toml` (or the dashboard): `LEARNING_CONTRIBUTIONS_ENABLED = "1"`; leave `PAYPAL_ENV` unset (= sandbox). Redeploy.
4. Test end to end in sandbox. The Command Centre lists sandbox payments separately and never counts them as income.
5. To go live: create a **live** app + live webhook, replace the three secrets with live values, set `PAYPAL_ENV = "live"`, redeploy, and test one real $5 payment.

If any secret is missing the Worker reports contributions as unavailable and the learner flow continues normally.

### Two support modes (after a learner passes)
The completion screen always offers optional support; which path it uses depends on the config above.
- **Default (Orders API not configured):** a **PayPal.Me redirect** to `https://paypal.me/angry5p1c3/<amount>USD` ($2 / $5 / $10 / $20 or a custom $1–$500). This is *not* a verified payment: Boztik cannot see whether the learner paid, and the UI never says a payment was received.
- **Verified (all PayPal secrets set + `LEARNING_CONTRIBUTIONS_ENABLED=1`):** server-created PayPal order, confirmed only by PayPal's signed webhook ($5–$500).
Either way nothing gates results or certificates, "Maybe later" is remembered per course in the browser, and the destination must stay `paypal.me/angry5p1c3` (`npm run test:learning-support` fails if any other PayPal.Me address appears).

## 5. Ongoing

- Storage: Command Centre → Learning → Contributions & storage shows use of the separate 1.5 GB allocation (warnings at 70/85/95%; new learners pause at 100%). It is an estimate.
- Adding a course: add content under `learning/courses/<slug>/`, an exam bank, an entry in `learning/courses/rules.json`, then `npm run learning:build && npm run learning:pages` and commit the generated files.
- Editorial resources: maintain the reviewed article content in `deliver/worker-api/scripts/learning-resources.mts`. The `learning:pages` generator creates `/learning/resources/`, the individual article pages, homepage feature cards, course cross-links and the Learning sitemap block. After editing resources, run `npm run learning:pages`, then `npm run learning:check` and commit the generated HTML plus `sitemap.xml`.
- Local preview with no production access: `npm run learning:dev` → http://localhost:8080/learning/ (in-memory data).
- Optional browser checks (Playwright is not a repo dependency): `scripts/learning-e2e.mts` (learner journey) and `scripts/learning-admin-e2e.mts` (Command Centre panel).

## Known limitations

- Certificate names are Latin-script only (PDF standard fonts). Other scripts are rejected with a clear message.
- No email recovery: a lost private link is recovered with the one-time recovery code shown at enrolment.
- No QR code on the certificate; the verification URL and certificate ID are printed.
- A name typo after issuance cannot be self-corrected; an admin can revoke, and the learner can re-claim.
- PayPal refund handling depends on PayPal including the order id in the refund webhook.
- Storage figure is an estimate, not a Cloudflare billing number.
- Learning pages carry no analytics or ads by design.
