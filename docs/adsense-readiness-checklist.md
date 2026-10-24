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
