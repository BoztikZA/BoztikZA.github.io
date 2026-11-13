# Spotlight deployment runbook

Applies to PR #55 and the Spotlight work that follows it. The Worker, D1 and the static site must go live in a
fixed order, because the new frontend depends on API fields that do not exist in production until the Worker is
deployed.

**Order: validate → apply remote D1 migration → verify → deploy Worker → verify → merge to `main` → verify Pages → smoke test.**
Stop at the first failure. Never merge first.

Prerequisites: Cloudflare login for the `boztik-deliver-api` Worker and the `boztik-deliver` D1 database
(`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` with Workers + D1 edit). Run everything from `deliver/worker-api`
on the PR branch (or the merge commit) so the migrations folder matches the Worker you deploy.

## 0. Pre-flight (read-only)

```bash
git fetch origin && git checkout feature/spotlight-video-showcase && git pull --ff-only
cd deliver/worker-api && npm ci
npm run typecheck && npm test                 # must be green
npm run db:migrate:local                      # applies every migration to a scratch local D1
npx wrangler d1 migrations list boztik-deliver --remote   # what production still needs
```

Expected: production is at `0018_spotlight_lifecycle.sql`; pending is `0019_spotlight_video.sql`.
If production is ahead of or different from this, stop and investigate before continuing.

## 1. Apply the remote D1 migration

`0019` only adds a nullable `video_metadata` column (additive, no rebuild, no data rewrite), so existing Spotlight
rows and the live Worker keep working while it is applied.

```bash
npm run db:migrate:remote
npx wrangler d1 execute boztik-deliver --remote --command \
  "SELECT name FROM pragma_table_info('spotlight_profiles') WHERE name='video_metadata'"
npx wrangler d1 execute boztik-deliver --remote --command "SELECT COUNT(*) AS profiles FROM spotlight_profiles"
```

Verify: the column is listed and the profile count matches what you saw before. **If this fails, stop.**
Do not deploy the Worker.

## 2. Deploy the Worker

```bash
npm run deploy
```

Verify (public, read-only):

```bash
curl -s  https://deliver-api.boztik.com/api/public/spotlight | head -c 400    # 200 JSON, "profiles" array
curl -sI https://deliver-api.boztik.com/api/public/spotlight | head -3
```

Check that every listed profile carries `song` and `video` keys (null when absent) and that no profile has
`status`, `contact_email` or `review_*` fields. Then confirm in the Cloudflare dashboard that the Worker's latest
deployment time is now and the cron trigger is still attached.

**If this fails:** `npx wrangler rollback` restores the previous Worker version. The migration can stay (additive).

## 3. Merge to `main`

Only when steps 1 and 2 passed and the PR's required checks are green (Worker API checks + Cloudflare Pages preview).
Merge PR #55 into `main` (a merge commit or squash both work; do not force-push).

## 4. Verify the production Pages deployment

The site at `www.boztik.com` is published by the **Deploy GitHub Pages** workflow on pushes to `main`. A
Cloudflare Pages *preview* on a PR is not a production deployment.

```bash
gh run list --workflow "Deploy GitHub Pages" --limit 3        # newest run: completed / success
curl -s https://www.boztik.com/spotlight/ | grep -o 'media.css?v=[0-9]*\|spotlight.js?v=[0-9]*'
```

Expected: `media.css?v=1` and `spotlight.js?v=14` (or newer) appear. If the run failed with an artifact-lookup error
rather than a build error, re-run it (`gh run rerun <id>`); that failure has happened before and is GitHub-side.

## 5. Live smoke tests

1. `https://www.boztik.com/spotlight/` loads, directory shows cards, no console errors.
2. If a profile is featured: the showcase shows **facades** (thumbnail + play button), no player loads until you
   press play, then the official YouTube/Twitch/Spotify player appears and does not autoplay on page load.
3. On a card and on a profile page: media shows artwork, a label and an outbound link, never a player.
4. Twitch: play a Twitch facade and confirm the player renders (this is the `parent=` check, which cannot be
   verified before deploy). If it shows a "parent" error, capture the console message.
5. Submit a test application with a Spotify album link and a YouTube link: it must appear in the Command Centre
   review modal and **not** on `/spotlight/` until approved and published.
6. Command Centre still loads Deliver, storage monitoring and upload tools (unchanged).

## Rollback summary

| Problem | Action |
| --- | --- |
| Migration fails | Stop. Nothing else has changed. |
| Worker misbehaves after deploy | `npx wrangler rollback`. Leave the additive column. |
| Frontend misbehaves after merge | Revert the merge commit on `main` (`git revert -m 1 <merge>`); Pages redeploys. The Worker stays compatible with the old frontend. |

## Known limits of pre-deploy verification

Automated tests use stubbed providers and a mocked API. They prove no player loads before a click, that
attributes and URLs are correct, and that pending media never appears publicly. They cannot prove the live
YouTube, Twitch and Spotify players accept these embed parameters from `www.boztik.com`; step 5 does.
