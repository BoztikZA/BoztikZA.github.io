# Boztik Learning Hub — Progress Tracker

> **Purpose:** Persistent handover document for Claude and anyone continuing the Learning Hub implementation.
> **Last updated:** 2026-11-25
> **Project status:** Planning decisions locked; implementation status must be verified against the repository before being marked complete.

## How to use this file

Update this document whenever meaningful work is completed. Do not rely on chat history as the only project record.

At the beginning of every resumed work session:
1. Read this file.
2. Inspect the current repository and Git status/branch.
3. Compare the actual implementation with the checklist below.
4. Continue from the first incomplete item.
5. Do not repeat completed work or overwrite working features without a clear reason.

At the end of every work session:
- Update the status and next steps.
- Record files changed and commits created.
- Record tests actually run and their exact outcomes.
- List blockers, missing credentials and deployment actions still requiring approval.
- Never mark work complete merely because code was written.

## 1. Confirmed product decisions

### Information architecture
- Learning Hub landing page: `/learning/`
- Existing Guides library remains at `/guides/`.
- Preserve existing guide pages and URLs.
- Learning Hub is a distinct Boztik section, integrated with the existing site navigation and visual identity.
- Create all eight categories immediately; categories without courses remain visible with a clear “Courses coming soon” message.

### Categories
1. AI & Emerging Technology
2. Cybersecurity & Digital Safety
3. Data & Analytics
4. Computer & Digital Skills
5. Design & Creativity
6. Business & Entrepreneurship
7. Programming & Development
8. Career & Professional Skills

### Confirmed launch courses
1. **Practical Artificial Intelligence & AI Productivity**
   - Beginner–Intermediate
   - 30-question assessment
   - 70% pass mark
2. **Cybersecurity & Digital Safety Fundamentals**
   - Beginner–Intermediate
   - 30-question assessment
   - 70% pass mark
3. **Data Analysis & Spreadsheet Skills**
   - Beginner–Intermediate
   - 30-question assessment plus a practical exercise
   - 75% pass mark

Learners may enrol in any course independently. No compulsory course sequence or prerequisites.

### Learning experience
- Free, self-paced learning with no fixed deadline.
- Teaching is primarily text, diagrams, worked examples and practical exercises.
- No Boztik-hosted video platform at launch.
- Optional downloadable PDF study packs.
- Clear lesson/module/course progress and a simple resume-learning experience.
- Course sharing via copy link, WhatsApp, email and native sharing where supported.
- Shared links must never expose a learner's private session, progress, results or certificate.

### Branding and visual direction
- Create a distinctive Boztik Learning identity derived from the existing Boztik logo.
- Preserve recognisable Boztik branding and the dark/neon-green visual language.
- Create original, consistent, lightweight illustrations for each launch course.
- Avoid generic stock-like visuals, childish graphics and unnecessary animation.
- Design should be premium, accessible, responsive and especially straightforward on mobile.

### Learner sessions and privacy
- No mandatory account/password system at launch.
- Full name required before enrolment; email and country optional.
- Use cryptographically secure private resume/recovery tokens.
- Store token hashes, never raw recovery tokens.
- Keep public learner references separate from private tokens.
- Save progress and assessment records server-side.
- Rate-limit recovery operations.
- Explain that anyone with a private resume link may access that learner's session.
- Minimise personal data.

### Examinations and certificates
- Mark assessments server-side; never expose answer keys in public browser code.
- Record attempts and results securely.
- Permit study and retakes after unsuccessful attempts.
- Issue a certificate only after successful completion.
- Each course has an independent certificate.
- Generate a polished, print-ready PDF Certificate of Achievement.
- Certificate includes learner name, course, completion date, actual score, pass mark, unique ID and verification URL.
- Public verification must disclose only minimum necessary information and respect learner consent.
- Certificates are independent completion/achievement certificates, not accredited qualifications, academic credits, licences or professional certifications.

### Required global disclaimer
“Boztik courses are independently developed educational and skills-development programmes designed to provide practical knowledge and learning opportunities.

These courses are not formally accredited by any recognised educational, professional or regulatory accreditation body.

Certificates issued by Boztik are certificates of completion or achievement for independently provided training. They do not represent formally recognised academic qualifications, professional certifications, academic credits or licences.

Completion of a Boztik course does not guarantee employment, professional recognition or acceptance by educational institutions or employers.

Our mission is to make practical, accessible and valuable learning opportunities available to everyone, everywhere.”

### Voluntary PayPal contributions
- Courses remain free.
- Show the optional contribution prompt after successful completion of each individual course.
- Options: $5 Starter Support, $10 Learning Supporter, $15 Growth Supporter, $20 Premium Supporter, and custom amount (minimum $5).
- Include a clear “No thanks” option.
- Never gate lessons, results or an earned certificate behind payment.
- Use PayPal-hosted checkout and server-side verified webhook events.
- Never trust a browser redirect as proof of payment.
- Do not collect/store card details.
- If credentials or merchant configuration are unavailable, document setup steps; never fake successful payments.

### Command Centre
Extend the existing Boztik Command Centre; do not create an unnecessary second admin platform.

Provide secure Learning Hub analytics for:
- Total learner sessions.
- Currently active learner sessions.
- Courses in progress / active training.
- Total enrolments.
- Completed courses.
- Certificates issued.
- Examination attempts and pass rate.
- Average scores.
- Course popularity and completion rates.
- Recent learner activity and measurable drop-off points.

Define the active-session time window and make it visible. Distinguish learners/sessions, enrolments, active training, completed courses and certificates so counts are not misleading.

Provide authorised certificate search/verification/revocation with audit records, plus learner-session and progress visibility. Never expose private recovery tokens or public learner records through unauthorised endpoints.

### Storage allocation
- Learning Hub application-level quota: 1.5 GB.
- Existing Boztik services application-level quota: 3 GB.
- Combined application-level limits: 4.5 GB.
- These are internal application limits, not additional Cloudflare provider storage.
- Isolate Learning Hub usage and monitoring; do not change the existing 3 GB allocation.
- Avoid large learner uploads and duplicate per-learner copies of shared PDFs.

## 2. Intended architecture (verify before implementation)

Reuse existing Boztik infrastructure where it is safe and appropriate:
- GitHub Pages for public pages and static course content.
- Existing Cloudflare Worker API for secure session, progress and assessment operations.
- Cloudflare D1 for learner sessions, progress, attempts, results and certificate records.
- Cloudflare R2 only where genuinely required.

Do not assume bindings, database names, bucket names, environment variables, routes or schemas. Inspect the live repository/configuration and existing Worker before deciding.

## 3. Implementation checklist

Mark an item **DONE** only after inspecting the implementation and, where applicable, running relevant tests.

- [ ] Repository, deployment workflow and existing architecture audited.
- [ ] Existing guides and URLs preserved.
- [ ] Learning Hub brand/logo assets created.
- [ ] Learning Hub homepage and navigation implemented.
- [ ] Eight visible categories implemented.
- [ ] Three complete courses written and structured.
- [ ] Course illustrations created and optimised.
- [ ] Course discovery, detail pages and enrolment implemented.
- [ ] Course sharing implemented without session-data leakage.
- [ ] Secure learner session and resume flow implemented.
- [ ] Server-side progress persistence implemented.
- [ ] Server-side assessment marking and retake logic implemented.
- [ ] Certificate PDF generation implemented.
- [ ] Public certificate verification and consent controls implemented.
- [ ] Optional PayPal contribution flow implemented safely.
- [ ] Command Centre Learning Hub overview implemented.
- [ ] Course analytics and certificate administration implemented.
- [ ] Storage quota isolation/monitoring implemented or documented if blocked.
- [ ] SEO, accessibility, responsive layout and performance reviewed.
- [ ] Security review completed.
- [ ] Unit/integration/regression tests run.
- [ ] Deployment steps documented.
- [ ] Production changes deployed only after explicit approval.

## 4. Current verified implementation status

**Do not assume any of the checklist items above are implemented.**

At the time this tracker was created, the project decisions and implementation brief had been agreed in conversation, but no Learning Hub implementation had been verified in the repository.

The first implementation session must inspect the repository and update this section based on actual files and working code.

## 5. Change log

### 2026-11-25 — Tracker created
- Added this persistent project handover document.
- No Learning Hub application functionality was implemented by creating this document.
- Repository branch: `docs/learning-hub-progress-tracker`.

## 6. Test log

Record actual commands and outcomes here. Include failures; do not report tests as passed unless they were run.

| Date | Test/check | Result | Notes |
|---|---|---|---|
| Not yet recorded | — | Not run | Implementation audit still required |

## 7. Outstanding blockers and approvals

Record missing credentials, provider configuration, infrastructure changes, schema deployment, and any other actions requiring owner approval.

At tracker creation:
- Live Cloudflare Worker deployment: not authorised by this tracker.
- Production D1 migrations: not authorised by this tracker.
- Production R2/storage configuration changes: not authorised by this tracker.
- Live PayPal activation: not authorised by this tracker.
- DNS changes: not authorised by this tracker.

## 8. Exact next steps

1. Inspect the current repository branch and working tree.
2. Inspect existing website structure, logo assets, navigation and Guides URLs.
3. Inspect the Worker API, D1 schema/migrations, R2 configuration and Command Centre.
4. Produce a concise architecture map and identify reusable components.
5. Implement the Learning Hub in coherent, recoverable changes.
6. Update this tracker continuously as work progresses.
7. Run available tests and document the real results.
8. Prepare deployment instructions and list all production actions requiring approval.
