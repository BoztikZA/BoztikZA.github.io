# Boztik

Boztik is a GitHub Pages website and creator-tools ecosystem. The repository contains the public marketing site, browser-based tools, and the frontend for Boztik Deliver. The Deliver API runs separately as a Cloudflare Worker.

## Repository map

| Path | Responsibility |
| --- | --- |
| Root `*.html` | Public website pages and legacy URL redirects |
| Root `*.css` | Shared and page-specific public-site styling |
| `js/` | Public-site behaviour, navigation, and first-party analytics |
| `images/` | Public-site images and artwork |
| `deliver-v3/` | Boztik Deliver browser application |
| `deliver/worker-api/` | Cloudflare Worker, D1 migrations, and backend tests |
| `docs/` | Internal technical and operational documentation |
| `.github/workflows/` | GitHub Pages deployment workflow |

## Deployment boundaries

- A push to `main` triggers the GitHub Pages workflow.
- The Pages workflow stages an explicit list of public HTML/configuration files and copies the public `js/`, `images/`, and `deliver-v3/` directories.
- Worker source under `deliver/worker-api/` is not deployed by GitHub Pages. Worker deployment is a separate Cloudflare/Wrangler operation.
- Do not put secrets, local environment files, database files, private exports, or scratch artifacts in the public website tree.

## Working safely

1. Inspect the current implementation and its callers before changing or deleting a file.
2. Preserve public URLs, redirects, query parameters, analytics contracts, and stored-data compatibility.
3. Treat Deliver's Worker, D1 migrations, R2 storage rules, authentication, and signed URLs as production-critical.
4. Run the relevant checks before merging. For Worker changes, start with `cd deliver/worker-api && npm ci && npm run typecheck && npm test`; run `npm run test:e2e` separately with the documented local environment.
5. Review the complete diff and deployment scope before merging to `main`.

See [docs/REPOSITORY_GUIDE.md](docs/REPOSITORY_GUIDE.md) for the dependency boundaries and test guidance.
