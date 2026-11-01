# Repository guide

This document describes the current repository boundaries and the safest way to work in them.

## Public website

The root contains the public pages. Most pages load `styles-premium.css` plus a page-specific stylesheet; scripts in `js/` provide navigation, page interactions, and first-party measurement.

Important shared scripts:

- `js/site.js` — responsive navigation and shared reveal behaviour.
- `js/pageview.js` — first-party page-view and traffic-source measurement sent to the Deliver Worker.
- `js/boztik-events.js` — low-cardinality GA4 interaction events.
- `js/store-clicks.js` — first-party store-click events.
- `js/support.js` — support button and footer behaviour.

Page-specific scripts should remain attached only to the pages that use their corresponding UI. Before removing a script, inspect both static HTML references and dynamic imports/injection.

## Boztik Deliver

- `deliver-v3/` is the browser application served by GitHub Pages.
- `deliver/worker-api/` is the Cloudflare Worker backend.
- The Worker owns authentication and all access to D1 and the private R2 bucket. Never expose storage credentials or bypass Worker validation from the browser.
- SQL migrations are append-only production history. Do not delete, reorder, or rewrite applied migrations.
- Public API request/response shapes are contracts shared by the browser application, Worker, and tests. Change them deliberately and update contract tests.

The Worker package exposes these checks:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript static check |
| `npm test` | TypeScript check followed by unit, retention, traffic-source, analytics-pipeline, and client tests |
| `npm run test:e2e` | End-to-end API checks; requires the documented local environment |

See [the Worker README](../deliver/worker-api/README.md) for local setup, secrets, migrations, and end-to-end test configuration.

## Deployment

The GitHub Pages workflow is `.github/workflows/deploy-pages.yml`. It deploys only when `main` is updated (or manually dispatched). It copies the public-site directories and an explicit list of root files into the Pages artifact.

The Cloudflare Worker is deployed independently using Wrangler from `deliver/worker-api/`. A website-only change should not trigger a Worker deployment, and a Worker-only change should not alter the Pages artifact.

## Safe change checklist

- Search for every reference to a file, selector, function, endpoint, and asset before removal.
- Check HTML, CSS, JavaScript imports, service-worker precache lists, manifests, workflow copy lists, and documentation.
- For images, also consider content stored in D1/R2 or referenced by URLs assembled at runtime.
- Preserve redirects and old public URLs unless a redirect replacement is explicitly planned.
- Do not alter AdSense, consent, canonical URLs, robots, sitemap, or ads.txt as part of unrelated cleanup.
- Run relevant tests and inspect the final diff. Static reference searches are useful but do not replace browser or integration tests.
- Keep cleanup changes isolated from feature work so regressions are easier to identify and revert.
