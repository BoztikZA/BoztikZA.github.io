import assert from "node:assert/strict";
import { downloadButtonsMarkup, safeDownloadUrl, normaliseDownloadLinks } from "../../../spotlight/downloads.js";
import { heroCardMarkup } from "../../../spotlight/home-cards.js";
import { featuredShowcaseMarkup } from "../../../spotlight/showcase.js";
import { checkedDownloadLinks, normalizeDownloadLinks, safeDownloadUrl as workerSafeDownloadUrl } from "../src/lib/spotlight-downloads.ts";
import { handleSpotlightAdmin, handleSpotlightPublic, publicDto } from "../src/routes/spotlight.ts";
import { sessionTokenHash } from "../src/lib/auth.ts";
import { HttpError } from "../src/types.ts";

const ADMIN_SALT = "spotlight-downloads-test-salt";
const ADMIN_TOKEN = "spotlight-downloads-test-token";

// 1. URL validation tests (frontend + backend)
{
  const apple = "https://apps.apple.com/app/apple-store/id6786910043";
  const play = "https://play.google.com/store/apps/details?id=com.example.app";
  const generic = "https://downloads.example.com/installer-v2.dmg";

  assert.equal(safeDownloadUrl("apple_app_store", apple), apple);
  assert.equal(workerSafeDownloadUrl("apple_app_store", apple), apple);
  assert.equal(safeDownloadUrl("apple_app_store", "https://itunes.apple.com/us/app/id123"), "https://itunes.apple.com/us/app/id123");
  assert.equal(safeDownloadUrl("apple_app_store", play), "");
  assert.equal(workerSafeDownloadUrl("apple_app_store", play), null);

  assert.equal(safeDownloadUrl("google_play", play), play);
  assert.equal(workerSafeDownloadUrl("google_play", play), play);
  assert.equal(safeDownloadUrl("google_play", apple), "");
  assert.equal(workerSafeDownloadUrl("google_play", apple), null);

  assert.equal(safeDownloadUrl("generic", generic), generic);
  assert.equal(workerSafeDownloadUrl("generic", generic), generic);

  // Reject unsafe schemes, credentials, ports, and malformed URLs
  for (const bad of [
    "http://apps.apple.com/app/id123",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://user:pass@example.com/file.zip",
    "https://example.com:8443/file.zip",
    "not a url",
    ""
  ]) {
    assert.equal(safeDownloadUrl("generic", bad), "");
    assert.equal(workerSafeDownloadUrl("generic", bad), null);
  }

  assert.throws(() => checkedDownloadLinks([{ type: "apple_app_store", url: "https://evil.com/app" }]), HttpError);
  assert.throws(() => checkedDownloadLinks([{ type: "google_play", url: "https://evil.com/app" }]), HttpError);
  assert.throws(() => checkedDownloadLinks([{ type: "generic", url: "javascript:alert(1)" }]), HttpError);
  assert.throws(() => checkedDownloadLinks([{ type: "unknown_store", url: "https://example.com/app" }]), HttpError);

  console.log("✓ Download URL & type validation (frontend + backend)");
}

// 2. Conditional rendering & branded buttons (homepage hero + directory showcase)
{
  const baseProfile = {
    id: "aaaaaaaaaaaaaaaaaaaa",
    slug: "acme-studio-aaaaa",
    display_name: "Acme Studio",
    tagline: "Independent software and creative tools.",
    description: "We build fast, privacy-first desktop and mobile applications for creators.",
    category: "software",
    website_url: "https://acme.example.com",
    social_links: {},
    images: [],
    featured: true,
    featured_open_ended: false,
    featured_until: Math.floor(Date.now() / 1000) + 3600,
    download_links: [],
  };

  // Profile WITHOUT download links: must render zero download UI
  assert.equal(downloadButtonsMarkup(undefined), "");
  assert.equal(downloadButtonsMarkup([]), "");
  assert.equal(downloadButtonsMarkup([{ type: "generic", url: "http://insecure.example.com" }]), "");

  const noDlHero = heroCardMarkup(baseProfile);
  assert.ok(!noDlHero.includes("sp-downloads"));
  assert.ok(!noDlHero.includes("sp-dl-btn"));
  assert.ok(!noDlHero.includes("Download on the App Store"));
  assert.ok(!noDlHero.includes("Get it on Google Play"));
  assert.ok(!noDlHero.includes("Download Now"));

  // Profile WITH Apple App Store + Google Play + Generic Download
  const withDownloads = {
    ...baseProfile,
    id: "bbbbbbbbbbbbbbbbbbbb",
    slug: "beta-app-bbbbb",
    display_name: "Beta App",
    download_links: [
      { type: "apple_app_store", url: "https://apps.apple.com/app/apple-store/id6786910043" },
      { type: "google_play", url: "https://play.google.com/store/apps/details?id=com.example.app" },
      { type: "generic", url: "https://beta.example.com/BetaInstaller.exe", label: "Download for Windows" },
    ],
  };

  const heroWithDl = heroCardMarkup(withDownloads);
  assert.ok(heroWithDl.includes("sp-downloads--hero"));
  assert.ok(heroWithDl.includes("sp-dl-btn--apple"));
  assert.ok(heroWithDl.includes("sp-dl-btn--google"));
  assert.ok(heroWithDl.includes("sp-dl-btn--generic"));
  assert.ok(heroWithDl.includes("Download on the"));
  assert.ok(heroWithDl.includes("App Store"));
  assert.ok(heroWithDl.includes("Get it on"));
  assert.ok(heroWithDl.includes("Google Play"));
  assert.ok(heroWithDl.includes("Download for Windows"));
  assert.ok(heroWithDl.includes('rel="noopener noreferrer"'));
  assert.ok(heroWithDl.includes('target="_blank"'));
  assert.ok(heroWithDl.includes("data-outbound"));

  // Switching back to profile without downloads must not leak previous profile's downloads
  const switchedBack = heroCardMarkup(baseProfile);
  assert.ok(!switchedBack.includes("BetaInstaller.exe"));
  assert.ok(!switchedBack.includes("sp-downloads"));

  // Directory showcase also includes download buttons when present, and none when absent
  assert.ok(!featuredShowcaseMarkup(baseProfile).includes("sp-downloads"));
  assert.ok(featuredShowcaseMarkup(withDownloads).includes("sp-downloads--showcase"));

  console.log("✓ Conditional rendering & branded store badges");
}

// 3. publicDto visibility rules
{
  const row = {
    id: "cccccccccccccccccccc",
    slug: "gamma-app-ccccc",
    display_name: "Gamma App",
    tagline: "Cross-platform productivity app.",
    description: "Built for independent teams and solo creators worldwide.",
    category: "other",
    website_url: "https://gamma.example.com",
    social_links: "{}",
    download_links: JSON.stringify([
      { type: "apple_app_store", url: "https://apps.apple.com/app/id12345" },
      { type: "generic", url: "http://should-be-dropped.example.com" },
    ]),
    status: "pending",
    featured_until: null,
    created_at: 1700000000,
  };

  // Pending profile: public DTO must not expose download_links
  const pendingPublic = publicDto(row);
  assert.deepEqual(pendingPublic.download_links, []);

  // Moderator view: sees valid normalized download_links even before publish
  const pendingAdmin = publicDto(row, [], { moderator: true });
  assert.equal(pendingAdmin.download_links.length, 1);
  assert.equal(pendingAdmin.download_links[0]?.type, "apple_app_store");

  // Published profile: public DTO exposes only valid approved download_links
  const publishedPublic = publicDto({ ...row, status: "published" });
  assert.equal(publishedPublic.download_links.length, 1);
  assert.equal(publishedPublic.download_links[0]?.url, "https://apps.apple.com/app/id12345");

  console.log("✓ Public vs moderator DTO visibility & sanitization");
}

// 4. End-to-end Worker API tests (unauthorised edit, Command Centre edit preserving tracking/rotation, public submit)
{
  const nowSec = Math.floor(Date.now() / 1000);
  const existingProfile: Record<string, any> = {
    id: "dddddddddddddddddddd",
    slug: "delta-tools-ddddd",
    display_name: "Delta Tools",
    tagline: "Precision audio utilities for creators.",
    description: "Delta Tools builds lightweight audio plugins and desktop utilities.",
    category: "other",
    contact_email: "hello@delta.example.com",
    website_url: "https://delta.example.com",
    social_links: "{}",
    download_links: null,
    song_metadata: null,
    video_metadata: null,
    image_key: null,
    image_size: 0,
    image_content_type: null,
    status: "published",
    application_status: "published",
    review_expires_at: null,
    listing_expires_at: nowSec + 20 * 86400,
    featured_until: nowSec + 12 * 3600,
    review_unread: 0,
    owner_token_hash: "preserved_owner_hash_123",
    created_at: nowSec - 86400,
    updated_at: nowSec - 86400,
    published_at: nowSec - 86400,
  };
  const submissions: Record<string, any>[] = [existingProfile];
  const adminTokenHash = await sessionTokenHash(ADMIN_TOKEN, ADMIN_SALT);

  class MockStmt {
    sql: string;
    args: unknown[] = [];
    constructor(sql: string) { this.sql = sql; }
    bind(...args: unknown[]) { this.args = args; return this; }
    async first() {
      if (this.sql.includes("FROM sessions WHERE token_hash")) {
        return this.args[0] === adminTokenHash ? { email: "admin@boztik.com", expires_at: nowSec + 3600, revoked: 0 } : null;
      }
      if (this.sql.includes("FROM spotlight_profiles WHERE id=?")) {
        return submissions.find(r => r.id === this.args[0]) || null;
      }
      if (this.sql.includes("FROM spotlight_submission_limits") || this.sql.includes("INTO spotlight_submission_limits")) {
        return { request_count: 1, window_start: nowSec };
      }
      return null;
    }
    async all() { return { results: [] }; }
    async run() {
      if (this.sql.startsWith("UPDATE spotlight_profiles SET display_name=?")) {
        const [
          display_name, tagline, description, category, contact_email, website_url,
          social_links, download_links, song_metadata, video_metadata, status,
          application_status, _statusForReview, listing_expires_at, featured_until,
          updated_at, _statusForPublished, _updatedForPublished, id
        ] = this.args;
        const row = submissions.find(r => r.id === id);
        if (!row) return { meta: { changes: 0 } };
        Object.assign(row, {
          display_name, tagline, description, category, contact_email, website_url,
          social_links, download_links, song_metadata, video_metadata, status,
          application_status, listing_expires_at, featured_until, updated_at,
        });
        return { meta: { changes: 1 } };
      }
      if (this.sql.includes("INSERT INTO spotlight_profiles")) {
        const [
          id, slug, display_name, tagline, description, category, contact_email,
          website_url, social_links, download_links, song_metadata, video_metadata,
          review_expires_at, created_at, updated_at, owner_token_hash
        ] = this.args;
        submissions.push({
          id, slug, display_name, tagline, description, category, contact_email,
          website_url, social_links, download_links, song_metadata, video_metadata,
          status: "pending", application_status: "new", review_expires_at,
          created_at, updated_at, owner_token_hash, featured_until: null, listing_expires_at: null,
        });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 1 } };
    }
  }

  const env: any = {
    AUTH_TOKEN_SALT: ADMIN_SALT,
    ADMIN_ORIGIN: "https://www.boztik.com",
    PUBLIC_ORIGIN: "https://www.boztik.com",
    DB: {
      prepare: (sql: string) => new MockStmt(sql),
      batch: async (stmts: MockStmt[]) => Promise.all(stmts.map(s => s.run())),
    },
  };

  // Unauthorised profile edit must fail with 401
  const unauthRes = await handleSpotlightAdmin(
    new Request("https://deliver-api.boztik.com/api/admin/spotlight/profile/dddddddddddddddddddd", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ download_links: [{ type: "generic", url: "https://delta.example.com/app.zip" }] }),
    }),
    "/profile/dddddddddddddddddddd",
    env,
  );
  assert.equal(unauthRes.status, 401);

  // Authorised Command Centre edit: add Apple + Google Play + Generic, update website & video
  const addRes = await handleSpotlightAdmin(
    new Request("https://deliver-api.boztik.com/api/admin/spotlight/profile/dddddddddddddddddddd", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({
        website_url: "https://new-delta.example.com",
        video_url: "https://youtu.be/dQw4w9WgXcQ",
        download_links: [
          { type: "apple_app_store", url: "https://apps.apple.com/app/id99999" },
          { type: "google_play", url: "https://play.google.com/store/apps/details?id=com.delta.app" },
          { type: "generic", url: "https://new-delta.example.com/delta.dmg", label: "macOS Installer" },
        ],
      }),
    }),
    "/profile/dddddddddddddddddddd",
    env,
  );
  assert.equal(addRes.status, 200);
  const addJson: any = await addRes.json();
  assert.equal(addJson.profile.id, "dddddddddddddddddddd");
  assert.equal(addJson.profile.slug, "delta-tools-ddddd");
  assert.equal(addJson.profile.website_url, "https://new-delta.example.com/");
  assert.equal(addJson.profile.video?.platform, "youtube");
  assert.equal(addJson.profile.download_links.length, 3);
  assert.equal(existingProfile.owner_token_hash, "preserved_owner_hash_123");
  assert.equal(existingProfile.status, "published");
  assert.ok(existingProfile.featured_until > nowSec);
  assert.ok(existingProfile.listing_expires_at > nowSec);

  // Replace URL & remove one destination
  const replaceRes = await handleSpotlightAdmin(
    new Request("https://deliver-api.boztik.com/api/admin/spotlight/profile/dddddddddddddddddddd", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({
        download_links: [
          { type: "google_play", url: "https://play.google.com/store/apps/details?id=com.delta.v2" },
          { type: "apple_app_store", url: "https://apps.apple.com/app/id99999" },
        ],
      }),
    }),
    "/profile/dddddddddddddddddddd",
    env,
  );
  assert.equal(replaceRes.status, 200);
  const replaceJson: any = await replaceRes.json();
  assert.equal(replaceJson.profile.download_links.length, 2);
  assert.equal(replaceJson.profile.download_links[0].type, "google_play");
  assert.equal(replaceJson.profile.download_links[0].url, "https://play.google.com/store/apps/details?id=com.delta.v2");

  // Remove all download destinations
  const clearRes = await handleSpotlightAdmin(
    new Request("https://deliver-api.boztik.com/api/admin/spotlight/profile/dddddddddddddddddddd", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ download_links: [] }),
    }),
    "/profile/dddddddddddddddddddd",
    env,
  );
  assert.equal(clearRes.status, 200);
  const clearJson: any = await clearRes.json();
  assert.deepEqual(clearJson.profile.download_links, []);

  // Public submission with optional download links
  const submitRes = await handleSpotlightPublic(
    new Request("https://deliver-api.boztik.com/api/public/spotlight/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.boztik.com" },
      body: JSON.stringify({
        display_name: "Echo App",
        tagline: "Fast notes for mobile and desktop.",
        description: "Echo App helps creators capture ideas instantly across every device.",
        category: "other",
        contact_email: "echo@example.com",
        consent: true,
        download_links: [
          { type: "apple_app_store", url: "https://apps.apple.com/app/id55555" },
          { type: "generic", url: "https://echo.example.com/echo.zip", label: "Download Desktop" },
        ],
      }),
    }),
    "/submit",
    env,
    {} as any,
  );
  assert.equal(submitRes.status, 201);
  const created = submissions.find(s => s.display_name === "Echo App");
  assert.ok(created);
  assert.equal(normalizeDownloadLinks(created.download_links).length, 2);

  // Public submission with invalid download URL must fail with 422
  const badSubmitRes = await handleSpotlightPublic(
    new Request("https://deliver-api.boztik.com/api/public/spotlight/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://www.boztik.com" },
      body: JSON.stringify({
        display_name: "Bad App",
        tagline: "Fast notes for mobile and desktop.",
        description: "Bad App helps creators capture ideas instantly across every device.",
        category: "other",
        contact_email: "bad@example.com",
        consent: true,
        download_links: [{ type: "apple_app_store", url: "https://not-apple.example.com/app" }],
      }),
    }),
    "/submit",
    env,
    {} as any,
  );
  assert.equal(badSubmitRes.status, 422);

  console.log("✓ Worker API edit, preservation, authorization, and submission");
}

console.log("All Spotlight download links tests passed.");
