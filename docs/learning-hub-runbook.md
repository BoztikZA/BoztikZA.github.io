# Boztik Learning Hub — deployment runbook

The Learning Hub and its first public resource library have been merged to `main`. Cloudflare Pages publishes the static site from `main`; the Learning API is deployed separately as a Worker.
This resource release adds **no D1 migration**. It adds the public analytics key `learning_resource`, so the Worker must be redeployed before resource-page views will be accepted by production analytics.

For future releases, order matters: **validate → inspect remote D1 state → apply only genuinely pending migrations → deploy Worker → verify API → publish Pages → smoke test**.
Stop at the first failure. Never apply or roll back database migrations just because a page or Worker changed.

Prerequisites: `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` with Workers + D1 edit) for Worker `boztik-deliver-api` and D1 `boztik-deliver`.
Run from `deliver/worker-api` after pulling the latest `main` branch.

## 0. Pre-flight (read-only)

```bash
git checkout main
git pull
cd deliver/worker-api
npm ci
npm run learning:pages                      # regenerate committed static pages from source
npm run learning:check                      # manifest, courses.json, pages and sitemap must be in sync
npm run typecheck && npm test               # full regression suite, including resource and analytics tests
npm run db:migrate:local                     # validate local migration chain
npx wrangler d1 migrations list boztik-deliver --remote   # inspect production state; read-only
```

The Learning Hub baseline migration is `0023_learning_hub.sql`. The resource-library release does not add or change any migration.
Confirm that production has already applied the expected Learning Hub migration. If production differs from repository history, stop and investigate before deploying.

## 1. Database state

There is **no remote migration to apply for this resource release**. Do not run `npm run db:migrate:remote` unless the read-only migration listing proves a separate, approved migration is pending.

The original `0023_learning_hub.sql` migration creates the nine Learning tables. It is not part of this release's change set.

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

## 3. Verify the published Pages

The resource-library PR is already merged. Confirm that the latest Cloudflare Pages production deployment has completed before treating the public pages as live. Check:

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
- Editorial resources: maintain article content in `deliver/worker-api/scripts/learning-resources.mts`. The `learning:pages` generator creates the resource hub, article pages, homepage feature cards, course cross-links and sitemap entries. After editing resources, run `npm run learning:pages`, `npm run learning:check` and `npm test`, then commit the generated HTML and `sitemap.xml`. The Learning Hub quality workflow also regenerates and validates these pages.
- Local preview with no production access: `npm run learning:dev` → http://localhost:8080/learning/ (in-memory data).
- Optional browser checks (Playwright is not a repo dependency): `scripts/learning-e2e.mts` (learner journey) and `scripts/learning-admin-e2e.mts` (Command Centre panel).

## Known limitations

- Certificate names are Latin-script only (PDF standard fonts). Other scripts are rejected with a clear message.
- No email recovery: a lost private link is recovered with the one-time recovery code shown at enrolment.
- No QR code on the certificate; the verification URL and certificate ID are printed.
- A name typo after issuance cannot be self-corrected; an admin can revoke, and the learner can re-claim.
- PayPal refund handling depends on PayPal including the order id in the refund webhook.
- Storage figure is an estimate, not a Cloudflare billing number.
- Learning pages carry no third-party analytics or ads. Public catalogue, course overview and resource pages use the existing privacy-first first-party counter; private learner pages are excluded.
