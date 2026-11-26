// Generates the static HTML for /learning/ (home, one page per course, and the app shells), plus the sitemap block.
// One template → header, footer, SEO tags and the global disclaimer can never drift between pages.
//   npm run learning:pages           write
//   npm run learning:pages -- --check  fail if committed output is stale (CI)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_DISCLAIMER } from "../src/learning/certificate-pdf.ts";
import { LEARNING_CATEGORIES } from "../src/learning/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../..");
const ORIGIN = "https://www.boztik.com";
const check = process.argv.includes("--check");
const V = "20261126a";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const catalogue = JSON.parse(readFileSync(join(ROOT, "learning/data/courses.json"), "utf8")).courses as any[];
const ILLUSTRATION: Record<string, string> = { "practical-ai-productivity": "ai", "cybersecurity-digital-safety": "cyber", "data-analysis-spreadsheets": "data" };

const CATEGORY_TEXT: Record<string, { name: string; blurb: string }> = {
  "ai-emerging-technology": { name: "AI & Emerging Technology", blurb: "Use AI tools well, check what they produce and stay ahead of new technology." },
  "cybersecurity-digital-safety": { name: "Cybersecurity & Digital Safety", blurb: "Protect your accounts, devices and information from everyday threats." },
  "data-analytics": { name: "Data & Analytics", blurb: "Turn messy numbers into clear answers using spreadsheets and sound reasoning." },
  "computer-digital-skills": { name: "Computer & Digital Skills", blurb: "Confident everyday computing, from files and email to online tools." },
  "design-creativity": { name: "Design & Creativity", blurb: "Visual thinking, editing and creative craft." },
  "business-entrepreneurship": { name: "Business & Entrepreneurship", blurb: "Start, price, market and run a small business." },
  "programming-development": { name: "Programming & Development", blurb: "Learn to build software, from first principles to real projects." },
  "career-professional-skills": { name: "Career & Professional Skills", blurb: "CVs, interviews, communication and workplace skills." },
};
const COMING_SOON = "Something exciting is on the way! We're developing new learning experiences for this category. New courses will be added soon.";

interface PageOpts { analytics?: boolean; path: string; title: string; description: string; robots?: "index" | "noindex"; body: string; script?: string; jsonld?: unknown[]; bodyClass?: string; ogImage?: string }

const NAV = `<header>
    <nav class="navbar" aria-label="Primary navigation">
      <a href="/index.html" class="logo-area">
        <img src="/images/boztik-mark.png" alt="Boztik logo" width="320" height="295">
        <div><span class="logo-title">BOZTIK</span><span class="logo-subtitle">Discover · Create · Learn · Grow</span></div>
      </a>
      <button class="nav-toggle" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="primary-navigation"><span class="nav-toggle__label">Menu</span><span class="nav-toggle__icon" aria-hidden="true"></span></button>
      <div class="nav-links" id="primary-navigation">
        <a href="/index.html">Home</a>
        <a href="/services.html">Services</a>
        <a href="/portfolio.html">Portfolio</a>
        <a href="/deliver.html">Deliver</a>
        <a href="/creative-toolkit.html">Creative Toolkit</a>
        <a href="/guides.html">Guides</a>
        <a href="/learning/" aria-label="Boztik Learning Hub" aria-current="page">Learn</a>
        <a class="nav-spotlight-link" href="/spotlight/" aria-label="Explore Boztik Spotlight">Spotlight</a>
        <a class="nav-store-link" href="/stores.html" aria-label="Boztik Stores" title="Boztik Stores"><img class="nav-store-logo" src="/images/boztik-mark.png" alt="" width="320" height="295"><span class="nav-store-sign" aria-hidden="true">OPEN</span></a>
        <a href="/about.html">About</a>
        <a href="/support.html">Support</a>
        <a href="/contact.html">Contact</a>
      </div>
    </nav>
  </header>`;

const FOOTER = `<footer>
    <img src="/learning/assets/brand/boztik-learning-mark.svg" alt="Boztik Learning" class="footer-logo" width="96" height="96">
    <h3>BOZTIK LEARNING HUB</h3>
    <p>The learning pillar of Boztik: free, practical, independently developed courses. Not formally accredited; certificates are certificates of completion.</p>
    <div class="footer-links">
      <a href="/index.html">Boztik Home</a>
      <a href="/learning/">All courses</a>
      <a href="/learning/dashboard/">My learning</a>
      <a href="/learning/verify/">Verify a certificate</a>
      <a href="/spotlight/">Spotlight</a>
      <a href="/creative-toolkit.html">Creative Toolkit</a>
      <a href="/guides.html">Guides</a>
      <a href="/stores.html">Boztik Stores</a>
      <a href="/learning/privacy/">Learning privacy</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
      <a href="/contact.html">Contact</a>
    </div>
    <div class="copyright">© 2026 Boztik. All Rights Reserved.</div>
  </footer>`;

function page(o: PageOpts): string {
  const canonical = `${ORIGIN}${o.path}`;
  const og = o.ogImage ?? `${ORIGIN}/images/boztik-og.png`;
  const index = (o.robots ?? "index") === "index";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <script>document.documentElement.className += ' js';</script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(o.title)}</title>
  <meta name="description" content="${esc(o.description)}">
  <meta name="robots" content="${index ? "index, follow, max-image-preview:large" : "noindex, nofollow"}">
  <meta name="author" content="Boztik">
  <meta name="theme-color" content="#8eff3d">
  <meta name="referrer" content="no-referrer">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${esc(o.title)}">
  <meta property="og:description" content="${esc(o.description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Boztik">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${og}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(o.title)}">
  <meta name="twitter:description" content="${esc(o.description)}">
  <meta name="twitter:image" content="${og}">
  <link rel="icon" type="image/svg+xml" href="/learning/assets/brand/favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/learning/assets/brand/favicon-32.png">
  <link rel="apple-touch-icon" href="/learning/assets/brand/favicon-180.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles-premium.css?v=20261123e">
  <link rel="stylesheet" href="/learning/learning.css?v=${V}">
${(o.jsonld ?? []).map((j) => `  <script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body class="lh${o.bodyClass ? " " + o.bodyClass : ""}">
  ${NAV}
  <main id="main-content">
${o.body}
  </main>
  ${FOOTER}
${o.analytics ? `  <script defer src="/js/pageview.js?v=4"></script>\n` : ""}  <script src="/js/site.js?v=20261125-learning-hub"></script>
${o.script ? `  <script type="module" src="${o.script}?v=${V}"></script>\n` : ""}</body>
</html>
`;
}

const iconSvg = (id: string) => `<svg aria-hidden="true"><use href="/learning/assets/img/icons.svg#i-${id}"/></svg>`;
const disclaimerHtml = `<div class="lh-disclaimer">${GLOBAL_DISCLAIMER.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;

function card(c: any): string {
  return `<article class="lh-card" data-course="${c.slug}">
        <img class="lh-card__img" src="/learning/assets/img/course-${ILLUSTRATION[c.slug] ?? "ai"}.svg" alt="" width="800" height="450" loading="lazy">
        <div class="lh-card__body">
          <div class="lh-meta"><span class="lh-chip lh-chip--free">Free</span><span class="lh-chip">${esc(c.level)}</span><span class="lh-chip">${esc(c.estimatedHours)}</span></div>
          <h3 class="lh-card__title"><a href="/learning/courses/${c.slug}/">${esc(c.title)}</a></h3>
          <p class="lh-muted">${esc(c.summary)}</p>
          <div data-progress></div>
          <div class="lh-card__foot"><span class="lh-muted">${c.modules} modules · ${c.lessons} lessons</span><a class="lh-btn lh-btn--primary lh-btn--sm" data-cta href="/learning/courses/${c.slug}/">View course</a></div>
        </div>
      </article>`;
}

const pages: { path: string; html: string }[] = [];
const sitemap: { loc: string; priority: string; changefreq: string }[] = [];
const add = (o: PageOpts) => { pages.push({ path: o.path, html: page(o) }); if ((o.robots ?? "index") === "index") sitemap.push({ loc: `${ORIGIN}${o.path}`, priority: o.path === "/learning/" ? "0.8" : "0.7", changefreq: "weekly" }); };

// ---------------------------------------------------------------------------- Home
const liveCats = new Set(catalogue.map((c) => c.category));
add({
  path: "/learning/",
  title: "Boztik Learning Hub | Free Practical Courses with Certificates",
  description: "Free, practical online courses in AI, cybersecurity and data analysis. Learn at your own pace, pass the assessment and earn a Boztik certificate of completion. Part of the Boztik platform.",
  script: "/learning/js/home.js",
  analytics: true,
  jsonld: [
    { "@context": "https://schema.org", "@type": "CollectionPage", name: "Boztik Learning Hub", url: `${ORIGIN}/learning/`, description: "Free practical courses from Boztik.", isPartOf: { "@type": "WebSite", name: "Boztik", url: `${ORIGIN}/` } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Boztik", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Learning Hub", item: `${ORIGIN}/learning/` } ] },
    { "@context": "https://schema.org", "@type": "ItemList", itemListElement: catalogue.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: `${ORIGIN}/learning/courses/${c.slug}/`, name: c.title })) },
  ],
  body: `
    <section class="lh-hero">
      <div class="lh-wrap lh-hero__grid">
        <div>
          <p class="lh-crumbs"><a href="/index.html">Boztik</a> / Learning Hub</p>
          <img src="/learning/assets/brand/boztik-learning-logo-dark.svg" alt="Boztik Learning" width="260" height="64" style="height:52px;width:auto">
          <h1>Learn something useful. Finish it. Be proud of it.</h1>
          <p class="lh-lead">Free, practical courses written to be completed — clear lessons, honest assessments and a certificate you earn by passing.</p>
          <div class="lh-btnrow" style="margin-top:26px"><a class="lh-btn lh-btn--primary" href="#courses">Browse free courses</a><a class="lh-btn" href="#certificates">How certificates work</a></div>
          <div class="lh-stats"><span><strong>${catalogue.length}</strong>launch courses</span><span><strong>100%</strong>free to learn</span><span><strong>Any device</strong>resume anywhere</span></div>
        </div>
        <img class="lh-hero__art" src="/learning/assets/img/completion.svg" alt="Steps rising towards a summit flag" width="400" height="220">
      </div>
    </section>

    <section class="lh-section" id="continue" hidden><div class="lh-wrap"><span class="lh-eyebrow">Welcome back</span><h2 style="margin:10px 0 18px">Continue where you left off</h2><div class="lh-grid lh-grid--3" id="continue-grid"></div></div></section>

    <section class="lh-section" id="courses">
      <div class="lh-wrap">
        <span class="lh-eyebrow">Featured courses</span>
        <h2 style="margin:10px 0 8px">Start with a course that pays off quickly</h2>
        <p class="lh-lead" style="margin-bottom:28px">Each course has ten short modules, knowledge checks as you go, and a final assessment. Every course is free.</p>
        <div class="lh-grid lh-grid--3">
      ${catalogue.map(card).join("\n      ")}
        </div>
      </div>
    </section>

    <section class="lh-section" id="categories" style="padding-top:0">
      <div class="lh-wrap">
        <span class="lh-eyebrow">Categories</span>
        <h2 style="margin:10px 0 24px">Eight areas, growing over time</h2>
        <div class="lh-grid lh-grid--2">
      ${LEARNING_CATEGORIES.map((id) => {
        const live = catalogue.filter((c) => c.category === id);
        const t = CATEGORY_TEXT[id]!;
        return live.length
          ? `<a class="lh-cat" href="/learning/courses/${live[0].slug}/"><span class="lh-cat__icon">${iconSvg(id)}</span><span><h3>${esc(t.name)}</h3><p>${esc(t.blurb)}</p><p class="lh-soon" style="color:var(--lh-neon)">${live.length} course available</p></span></a>`
          : `<div class="lh-cat lh-cat--soon"><span class="lh-cat__icon">${iconSvg(id)}</span><span><h3>${esc(t.name)}</h3><p>${esc(t.blurb)}</p><p class="lh-soon">${esc(COMING_SOON)}</p></span></div>`;
      }).join("\n      ")}
        </div>
      </div>
    </section>

    <section class="lh-section" style="background:var(--lh-panel,#0b110d);border-block:1px solid rgba(246,255,244,.1)">
      <div class="lh-wrap">
        <span class="lh-eyebrow">How it works</span>
        <h2 style="margin:10px 0 24px">Four steps, no account</h2>
        <ol class="lh-steps lh-steps--row">
          <li><h3>Pick a course</h3><p class="lh-muted">Read the outline first. Enrol with your name — email and country are optional.</p></li>
          <li><h3>Learn at your pace</h3><p class="lh-muted">Short lessons with examples, exercises and knowledge checks. Progress saves on our server.</p></li>
          <li><h3>Pass the assessment</h3><p class="lh-muted">Marked on our server. Not passed yet? Review the lessons and retake it.</p></li>
          <li><h3>Claim your certificate</h3><p class="lh-muted">A print-ready PDF with a unique ID that anyone can verify.</p></li>
        </ol>
      </div>
    </section>

    <section class="lh-section" id="certificates">
      <div class="lh-wrap lh-split">
        <div>
          <span class="lh-eyebrow">Certificates</span>
          <h2 style="margin:10px 0 14px">A certificate you actually earn</h2>
          <p class="lh-muted">Pass the assessment and you can claim a Certificate of Achievement showing your name, the course, completion date, your score and the pass mark, with a unique ID and a public verification page.</p>
          <ul class="lh-outcomes" style="margin:18px 0;grid-template-columns:1fr">
            <li>Printed and downloadable as a PDF</li>
            <li>Anyone can verify it by ID — and it shows only what you consent to share</li>
            <li>Never locked behind a payment</li>
          </ul>
          <div class="lh-note lh-note--warn"><strong>Please read: </strong>Boztik courses are independently developed and not formally accredited. Certificates are certificates of completion or achievement, not academic qualifications or professional certifications.</div>
        </div>
        <div class="lh-panel lh-panel--neon">
          <h3 style="margin-bottom:12px">Boztik Learning disclaimer</h3>
          ${disclaimerHtml}
        </div>
      </div>
    </section>

    <section class="lh-section" style="padding-top:0">
      <div class="lh-wrap lh-split">
        <div class="lh-panel">
          <span class="lh-eyebrow">Courses are free</span>
          <h2 style="margin:10px 0 12px">Learn for free. Support if you like.</h2>
          <p class="lh-muted">Every course, assessment and certificate is free. After you pass a course you will see an optional way to contribute — $5, $10, $15, $20 or an amount of your choice — to help maintain the Learning Hub and develop new courses. It is entirely voluntary, never required, and has no effect on your result or certificate. These are not charitable donations.</p>
        </div>
        <div class="lh-panel lh-faq">
          <h3 style="margin-bottom:12px">Good to know</h3>
          <details><summary>Do I need an account?</summary><p>No. You get a private link that saves your progress. Anyone with that link can open your session, so keep it safe. <a href="/learning/privacy/">How private links work</a>.</p></details>
          <details><summary>Can I learn on my phone?</summary><p>Yes. Every page is built for phones first, and you can pick up on another device with your private link.</p></details>
          <details><summary>What if I fail the assessment?</summary><p>Review the lessons and try again. Retakes are allowed, with a fresh question order each time.</p></details>
          <details><summary>Looking for photo editing help?</summary><p>Our free <a href="/guides.html">photo editing and restoration guides</a> are still available.</p></details>
        </div>
      </div>
    </section>`,
});

// ---------------------------------------------------------------------------- Course pages
for (const c of catalogue) {
  const course = JSON.parse(readFileSync(join(ROOT, `learning/courses/${c.slug}/course.json`), "utf8"));
  const isoMinutes = `PT${Math.floor(c.minutes / 60)}H${c.minutes % 60}M`;
  add({
    path: `/learning/courses/${c.slug}/`,
    title: `${c.title} | Boztik Learning`,
    description: c.summary,
    script: "/learning/js/course.js",
    analytics: true,
    ogImage: `${ORIGIN}/learning/assets/img/course-${ILLUSTRATION[c.slug]}.svg`,
    jsonld: [
      {
        "@context": "https://schema.org", "@type": "Course", name: c.title, description: course.description, url: `${ORIGIN}/learning/courses/${c.slug}/`,
        provider: { "@type": "Organization", name: "Boztik", url: ORIGIN }, isAccessibleForFree: true, educationalLevel: c.level, inLanguage: "en",
        timeRequired: isoMinutes, teaches: course.outcomes,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", category: "Free" },
        hasCourseInstance: { "@type": "CourseInstance", courseMode: "online", courseWorkload: isoMinutes },
      },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Boztik", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Learning Hub", item: `${ORIGIN}/learning/` },
        { "@type": "ListItem", position: 3, name: c.title, item: `${ORIGIN}/learning/courses/${c.slug}/` } ] },
    ],
    body: `
    <section class="lh-hero" style="padding-block:clamp(32px,6vw,72px)">
      <div class="lh-wrap lh-hero__grid">
        <div>
          <p class="lh-crumbs"><a href="/index.html">Boztik</a> / <a href="/learning/">Learning Hub</a> / ${esc(CATEGORY_TEXT[c.category]!.name)}</p>
          <h1>${esc(c.title)}</h1>
          <p class="lh-lead" style="margin-top:14px">${esc(c.subtitle)}</p>
          <div class="lh-meta" style="margin-top:18px"><span class="lh-chip lh-chip--free">Free</span><span class="lh-chip">${esc(c.level)}</span><span class="lh-chip">${esc(c.estimatedHours)}</span><span class="lh-chip">${c.modules} modules · ${c.lessons} lessons</span></div>
          <div class="lh-btnrow" style="margin-top:24px"><button class="lh-btn lh-btn--primary" type="button" id="start-btn" data-course="${c.slug}">Start this course — free</button><a class="lh-btn" href="#syllabus">See the syllabus</a></div>
          <div id="progress-slot" style="margin-top:18px;max-width:420px"></div>
        </div>
        <img class="lh-hero__art" src="/learning/assets/img/course-${ILLUSTRATION[c.slug]}.svg" alt="" width="800" height="450">
      </div>
    </section>

    <section class="lh-section"><div class="lh-wrap lh-course-layout">
      <div style="display:grid;gap:48px">
        <div><h2 style="margin-bottom:14px">About this course</h2><p class="lh-muted" style="max-width:68ch">${esc(course.description)}</p><p style="margin-top:12px"><strong>Before you start: </strong><span class="lh-muted">${esc(course.prerequisites)}</span></p></div>
        <div><h2 style="margin-bottom:16px">What you will be able to do</h2><ul class="lh-outcomes">${course.outcomes.map((o: string) => `<li>${esc(o)}</li>`).join("")}</ul></div>
        <div><h2 style="margin-bottom:12px">Who it is for</h2><ul class="lh-outcomes" style="grid-template-columns:1fr">${course.audience.map((o: string) => `<li>${esc(o)}</li>`).join("")}</ul></div>
        <div class="lh-syllabus" id="syllabus"><h2 style="margin-bottom:16px">Syllabus</h2>
          ${course.modules.map((m: any, i: number) => `<details${i === 0 ? " open" : ""}><summary><span class="n">${i + 1}</span>${esc(m.title)}</summary><ul>${m.lessons.map((l: any) => `<li>${esc(l.title)} <span style="opacity:.6">· ${l.minutes} min</span></li>`).join("")}</ul></details>`).join("\n          ")}
        </div>
        <div><h2 style="margin-bottom:12px">What to learn next</h2><ul class="lh-outcomes" style="grid-template-columns:1fr">${course.furtherLearning.map((o: string) => `<li>${esc(o)}</li>`).join("")}</ul></div>
      </div>
      <aside class="lh-course-aside" aria-label="Course details">
        <div class="lh-panel lh-panel--neon">
          <h3 style="margin-bottom:12px">Assessment and certificate</h3>
          <dl class="lh-dl"><dt>Written exam</dt><dd>${c.questionCount} questions</dd><dt>Pass mark</dt><dd>${c.passMark}%</dd>${c.practicalPassMark != null ? `<dt>Practical</dt><dd>8 tasks · ${c.practicalPassMark}% to pass</dd>` : ""}<dt>Retakes</dt><dd>Allowed</dd><dt>Certificate</dt><dd>On passing</dd></dl>
          <p class="lh-muted" style="margin-top:12px;font-size:.92rem">The assessment unlocks when you finish every lesson. It is marked on our server and your certificate is never locked behind a payment.</p>
        </div>
        <div class="lh-panel" id="share-slot"><h3 style="margin-bottom:12px">Learn together</h3></div>
        <div class="lh-panel"><h3 style="margin-bottom:10px">Free, with an optional way to support</h3><p class="lh-muted" style="font-size:.92rem">This course is free. After passing you can choose to contribute towards maintaining the Learning Hub and new courses — never required.</p></div>
      </aside>
    </div></section>

    <section class="lh-section" style="padding-top:0"><div class="lh-wrap" id="discover-slot" data-category="${c.category}" data-slug="${c.slug}"></div></section>

    <section class="lh-section" style="padding-top:0"><div class="lh-wrap lh-narrow"><h3 style="margin-bottom:12px">Disclaimer</h3>${disclaimerHtml}</div></section>`,
  });
}

// ---------------------------------------------------------------------------- App shells (private/utility pages: noindex)
const shell = (path: string, title: string, description: string, script: string, intro = "") => add({
  path, title, description, robots: "noindex", script,
  body: `    <div class="lh-wrap lh-section" id="app" aria-live="polite">${intro}<div class="lh-skeleton" role="status" aria-label="Loading"></div><noscript><p class="lh-note lh-note--warn">Boztik Learning needs JavaScript to load lessons and save your progress.</p></noscript></div>`,
});
shell("/learning/learn/", "Lesson — Boztik Learning", "Your Boztik Learning lesson.", "/learning/js/player.js");
shell("/learning/exam/", "Assessment — Boztik Learning", "Your Boztik Learning assessment.", "/learning/js/exam.js");
shell("/learning/dashboard/", "My learning — Boztik Learning", "Your private Boztik Learning dashboard.", "/learning/js/dashboard.js");
shell("/learning/resume/", "Resuming — Boztik Learning", "Resume your Boztik Learning session.", "/learning/js/resume.js");
shell("/learning/thanks/", "Thank you — Boztik Learning", "Thank you for supporting Boztik Learning.", "/learning/js/thanks.js");
shell("/learning/verify/", "Verify a certificate — Boztik Learning", "Check that a Boztik Learning certificate is genuine.", "/learning/js/verify.js");

// Privacy (indexable, static)
add({
  path: "/learning/privacy/",
  title: "Boztik Learning privacy and private links",
  description: "How Boztik Learning private session links, progress, certificates, verification and optional contributions handle your information.",
  body: `    <div class="lh-wrap lh-narrow lh-section" style="display:grid;gap:22px">
      <p class="lh-crumbs"><a href="/index.html">Boztik</a> / <a href="/learning/">Learning Hub</a> / Privacy</p>
      <h1>Privacy and private links</h1>
      <p class="lh-lead">The short version of what Boztik Learning stores, why, and what you control.</p>
      <h2>Private links (no password, no account)</h2>
      <p class="lh-muted">When you enrol we create a random private link. We store only a hash of it, never the link itself. The link lets you carry on from any device. <strong>Anyone who has your link can open your learning session</strong> — treat it like a key. Course-sharing links never contain it.</p>
      <p class="lh-muted">You also get a one-time recovery code. With your reference and that code you can get a new private link; the old one then stops working. If you lose both, we cannot recover your session, because we have no email-based recovery.</p>
      <h2>What we store</h2>
      <ul class="lh-outcomes" style="grid-template-columns:1fr"><li>Your full name (required, printed on your certificate)</li><li>Your email and country, only if you provide them</li><li>Which lessons you completed, your assessment attempts and scores, and your certificates</li><li>For optional contributions: the amount, status and PayPal order reference. PayPal hosts checkout; we never see or store card details</li></ul>
      <h2>Certificate verification</h2>
      <p class="lh-muted">A certificate can be checked by its ID. By default the verification page confirms the course and completion date only. It shows your name and score only if you tick “show my details”, and you can change that later. A person holding your certificate can type the name printed on it to confirm it matches, without the page revealing a name it was not given.</p>
      <h2>Your choices</h2>
      <p class="lh-muted">From your dashboard you can delete your session and data at any time, optionally including your certificates. Certificates you keep remain verifiable by ID but stop showing your name publicly.</p>
      <h2>Analytics</h2>
      <p class="lh-muted">The Learning pages do not load advertising scripts or Google Analytics. The course catalogue and course overview pages count page views with the same first-party counter used across boztik.com: it stores an anonymous random session cookie, never your name or email, and sends nothing if Do Not Track or Global Privacy Control is on. Lessons, exams, your dashboard, private links and certificate pages are never counted. Lessons and progress use only what is needed to run the service.</p>
      <p class="lh-muted">Questions: <a href="/contact.html">contact Boztik</a>. See also the site-wide <a href="/privacy.html">Privacy Policy</a> and <a href="/terms.html">Terms</a>.</p>
    </div>`,
});

// ---------------------------------------------------------------------------- write
let stale = false;
for (const p of pages) {
  const file = join(ROOT, p.path.replace(/^\//, ""), "index.html");
  const cur = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (check) { if (cur !== p.html) { console.error(`STALE: ${file}`); stale = true; } continue; }
  if (cur !== p.html) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, p.html); console.log("wrote", file.replace(ROOT + "/", "")); }
}

// Sitemap: a delimited block so reruns are idempotent and the rest of the file is untouched.
const START = "  <!-- learning:start -->", END = "  <!-- learning:end -->";
const block = `${START}\n${sitemap.map((s) => `  <url><loc>${s.loc}</loc><lastmod>2026-11-25</lastmod><changefreq>${s.changefreq}</changefreq><priority>${s.priority}</priority></url>`).join("\n")}\n${END}`;
const smPath = join(ROOT, "sitemap.xml");
let sm = readFileSync(smPath, "utf8");
const next = sm.includes(START) ? sm.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block) : sm.replace("</urlset>", `${block}\n</urlset>`);
if (check) { if (next !== sm) { console.error("STALE: sitemap.xml"); stale = true; } }
else if (next !== sm) { writeFileSync(smPath, next); console.log("updated sitemap.xml"); }
if (stale) process.exitCode = 1;
