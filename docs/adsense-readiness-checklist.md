# AdSense readiness checklist (Boztik)

Readiness work, not a guarantee of approval. The repeated "site down or unavailable" rejection is an availability matter that content changes do not cure.

## Done in the repo
- Unsupported popularity/endorsement claims replaced with factual wording; generic About rewritten without invented details.
- Portfolio shows real before/after examples with captions; two risky images removed from the page (files kept).
- Guides: byline, publish/update dates, related reading, a real worked example.
- Ad labels normalised to "Advertisements"; "support us"-style notes removed; units cut from 17 to 11 and placed between content sections. No units on privacy, terms, contact, Deliver, guides hub.
- Floating Support button hides while an ad is on screen; it was also invisible-but-clickable under reduced motion (fixed).
- Image Inspector bugs fixed; Creative Assistant copy corrected; privacy policy corrected; mobile overflow on the assistant page fixed.
- Untouched: DNS/CNAME, robots.txt, ads.txt, sitemap, workflows, analytics, AdSense loader tags, deliver-v3.

## Needs the owner
- LaunchZone references removed from the site (owner decision). Portfolio image consent confirmed by the owner.
- Confirm method claims ("done by hand", "manually, layer by layer"), extension feature claims, "free forever".
- Authentic extension screenshots; decide on images/extension-preview.png as og:image (shows Pro/Level/"No ads").
- Decide whether to publish a name/location/bio on About; confirm the funding statement and guide dates.
- Account side: Auto-ads page exclusions; AdSense Privacy & messaging (EEA/UK consent); Search Console live URL tests, uptime checks, TLS validity.
- Optional: BYOK keys currently live in localStorage on a page that also loads ads/analytics; consider sessionStorage or removing ads there. Verify OpenAI `max_tokens` vs `max_completion_tokens` for gpt-5-mini before changing provider code.

## SEO and compliance pass (2026-11-10)
- Portfolio: replaced an 8.9 MB PNG reference with the existing 1400 px JPG (original file kept) and corrected its width/height to avoid layout shift.
- Added a branded `404.html` (noindex, no ad code) and added it to the Pages deploy file list; without that, the workflow would not publish it.
- Structured data: Organization + WebSite on the homepage; ContactPage, CollectionPage and WebPage with breadcrumbs on contact, portfolio, stores and Creative Studio. All JSON-LD parses.
- Trimmed over-long meta descriptions (all now 160 characters or fewer) and over-long titles on the toolkit, services, Spotlight and AI-vs-manual guide pages.
- Added missing Twitter/Open Graph tags (Creative Studio, Stores, Spotlight submit).
- Spotlight profile template (client-rendered, near-empty HTML) set to noindex,follow to avoid thin-page indexing; Spotlight submit page added to the sitemap; sitemap lastmod refreshed.
- About link added to Stores header/footer and Creative Studio footer so the trust page is reachable site-wide.
- Not touched: AdSense loader tags, ads.txt, robots.txt, DNS/CNAME, analytics, deliver-v3.

### Still needs the owner (cannot be done from the repo)
- AdSense account: Privacy & messaging consent message for EEA/UK/Switzerland (the site already enables TCF support for gtag), auto-ads page exclusions, confirm the site status in AdSense, request a review only when the site is confirmed reachable.
- Search Console: submit the sitemap, inspect live URLs, watch Coverage for the noindexed Spotlight profile template.
- Decide whether to add a POPIA/GDPR data-subject-rights paragraph to the privacy policy (legal wording is the owner's call).
- Compress or retire the two 9 MB originals in images/portfolio/ (unreferenced now); replace images/extension-preview.png (1.6 MB) before using it as a social image.
