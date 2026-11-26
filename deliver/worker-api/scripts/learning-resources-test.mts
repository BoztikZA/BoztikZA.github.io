// Checks that editorial resource metadata, generated pages, internal links and sitemap stay aligned.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEARNING_RESOURCES } from "./learning-resources.mts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const hubPath = join(root, "learning/resources/index.html");
const homePath = join(root, "learning/index.html");
const sitemapPath = join(root, "sitemap.xml");
assert.ok(existsSync(hubPath), "resource hub page is missing");
assert.ok(existsSync(homePath), "Learning Hub homepage is missing");
assert.ok(existsSync(sitemapPath), "sitemap.xml is missing");

const hub = readFileSync(hubPath, "utf8");
const home = readFileSync(homePath, "utf8");
const sitemap = readFileSync(sitemapPath, "utf8");
const slugs = new Set<string>();
assert.ok(LEARNING_RESOURCES.length >= 4, "publish a useful initial resource library");

for (const resource of LEARNING_RESOURCES) {
  assert.ok(resource.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resource.slug), "resource slug must be URL-safe");
  assert.ok(!slugs.has(resource.slug), `duplicate resource slug: ${resource.slug}`);
  slugs.add(resource.slug);
  assert.ok(resource.title.length >= 25, `${resource.slug}: title is too short`);
  assert.ok(resource.description.length >= 80 && resource.description.length <= 180, `${resource.slug}: meta description should be 80–180 characters`);
  assert.ok(resource.excerpt.length >= 80, `${resource.slug}: excerpt is too short`);
  assert.ok(resource.sections.length >= 4, `${resource.slug}: article needs substantive sections`);
  assert.ok(resource.sources.length >= 1, `${resource.slug}: add at least one trusted source`);
  assert.match(resource.publishedAt, /^2026-\d{2}-\d{2}$/, `${resource.slug}: publishedAt must be an ISO date`);
  for (const source of resource.sources) assert.match(source.url, /^https:\/\//, `${resource.slug}: source links must use HTTPS`);

  const pagePath = join(root, `learning/resources/${resource.slug}/index.html`);
  assert.ok(existsSync(pagePath), `${resource.slug}: generated article page is missing`);
  const page = readFileSync(pagePath, "utf8");
  const canonical = `https://www.boztik.com/learning/resources/${resource.slug}/`;
  assert.ok(page.includes(`<link rel="canonical" href="${canonical}">`), `${resource.slug}: canonical URL mismatch`);
  assert.ok(page.includes('"@type":"Article"'), `${resource.slug}: Article structured data is missing`);
  assert.ok(page.includes(`<h1>${resource.title}</h1>`), `${resource.slug}: visible H1 is missing`);
  assert.ok(!/name="robots" content="noindex/i.test(page), `${resource.slug}: public article must be indexable`);
  assert.ok(hub.includes(`/learning/resources/${resource.slug}/`), `${resource.slug}: resource hub link is missing`);
  assert.ok(home.includes(`/learning/resources/${resource.slug}/`) || resource !== LEARNING_RESOURCES[4], `${resource.slug}: homepage feature link is missing`);
  assert.ok(sitemap.includes(`<loc>${canonical}</loc>`), `${resource.slug}: sitemap entry is missing`);
  for (const source of resource.sources) assert.ok(page.includes(source.url.replace(/&/g, "&amp;")), `${resource.slug}: source link is not rendered`);
}

console.log(`Learning resources: ${LEARNING_RESOURCES.length} articles, metadata, canonical URLs, schema, source links and sitemap entries passed.`);
