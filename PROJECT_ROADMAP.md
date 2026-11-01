# Boztik — Project Roadmap

> Internal planning document. Update this file when project priorities or shipped architecture change.

## Current architecture

Boztik is a GitHub Pages website with a separate Cloudflare-backed delivery service.

- **Public website:** root HTML pages, shared and page-specific CSS, and scripts under `js/`.
- **Creator tools:** Creative Studio and Creative Toolkit pages and their associated assets/scripts.
- **Boztik Deliver frontend:** `deliver-v3/`, served as part of the GitHub Pages site.
- **Boztik Deliver backend:** `deliver/worker-api/`, a Cloudflare Worker using D1 and private R2 storage.
- **Deployment:** GitHub Actions publishes the public website from `main`; Worker deployment is a separate Wrangler operation.

See [README.md](README.md) and [docs/REPOSITORY_GUIDE.md](docs/REPOSITORY_GUIDE.md) for the maintained repository map and safety boundaries.

## Development principles

1. Preserve existing public functionality, URLs, SEO and accessibility.
2. Keep the website and Worker deployment boundaries separate.
3. Prefer small, scoped changes over broad rewrites.
4. Keep API contracts and database migration history stable.
5. Do not remove assets whose references may be stored in D1/R2 or assembled dynamically.
6. Verify changes with relevant tests and review the full diff before merging.

## Priorities

### Maintenance
- Continue removing verified dead code and obsolete repository artifacts.
- Improve documentation and make test commands easy to discover.
- Review deployment workflow checks and add safe validation where it does not alter production behaviour.

### Public website
- Maintain a clear, useful experience across desktop and mobile.
- Keep page-specific styles and scripts scoped to the pages that need them.
- Improve accessibility, performance, and content quality without introducing unnecessary dependencies.

### Boztik Deliver
- Protect authentication, upload admission controls, signed downloads, expiry/retention, and D1/R2 consistency.
- Keep analytics accurate and privacy-conscious.
- Expand automated coverage before refactoring core Worker or storage logic.

### Growth
- Improve discoverability and useful content.
- Promote the Creative Toolkit and creator resources where they provide clear visitor value.
- Prioritise sustainable, maintainable revenue opportunities over feature volume.

## Release discipline

- Work on a feature or maintenance branch.
- Run the relevant tests and inspect the diff.
- Merge only after review and explicit approval.
- Treat GitHub Pages deployment and Cloudflare Worker deployment as separate release actions.
