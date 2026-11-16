import assert from "node:assert/strict";
import { listDeliveriesForAdmin } from "../src/lib/db.ts";

const deliveries = Array.from({ length: 200 }, (_, i) => ({
  id: `BZ-TEST${String(i).padStart(4, "0")}`,
  project_name: `Project ${i}`,
  client_name: "Regression test",
  notes: null,
  source: "private",
  source_meta: null,
  reddit_source: null,
  reddit_url: null,
  support_enabled: 1,
  is_photoshop_battles: 0,
  created_at: 1_700_000_000 + i,
  expires_at: 1_900_000_000,
  files_removed_at: null,
  view_count: i,
  download_count: i * 2,
  last_viewed_at: null,
  last_downloaded_at: null,
}));

const file = {
  id: "file-test-0001",
  delivery_id: deliveries[0]!.id,
  file_name: "sample.jpg",
  file_size: 1234,
  content_type: "image/jpeg",
  r2_key: "unused",
  removed_at: null,
};

const statements: Array<{ sql: string; binds: unknown[] }> = [];
const DB = {
  prepare(sql: string) {
    return {
      bind(...binds: unknown[]) {
        statements.push({ sql, binds });
        return {
          async first() {
            if (sql.includes("COUNT(*) AS n FROM deliveries")) return { n: deliveries.length };
            throw new Error(`Unexpected first() query: ${sql}`);
          },
          async all() {
            if (sql.includes("SELECT d.* FROM deliveries")) return { results: deliveries };
            if (sql.includes("FROM delivery_files")) return { results: [file] };
            if (sql.includes("FROM delivery_analytics")) return { results: [{ delivery_id: deliveries[0]!.id, views: 7, downloads: 3 }] };
            throw new Error(`Unexpected all() query: ${sql}`);
          },
        };
      },
    };
  },
};

const env = { DB, ANALYTICS_UTC_OFFSET_MINUTES: 120 } as any;
const result = await listDeliveriesForAdmin(env, {
  search: "test",
  source: "private",
  status: "expiring",
  sort: "created",
  order: "desc",
  limit: 200,
  offset: 0,
});

assert.equal(result.total, 200);
assert.equal(result.items.length, 200);
assert.equal(result.items[0]!.files.length, 1);
assert.equal(result.items[0]!.file_count, 1);
assert.equal(result.items[0]!.monthly_views, 7);
assert.equal(result.items[0]!.monthly_downloads, 3);

const enrichment = statements.filter((s) => s.sql.includes("FROM delivery_files") || s.sql.includes("FROM delivery_analytics"));
assert.equal(enrichment.length, 2, "file and monthly enrichment should each use one scoped query");
for (const statement of statements) {
  assert.ok(statement.binds.length <= 100, `D1 bind limit exceeded: ${statement.binds.length} in ${statement.sql}`);
}
for (const statement of enrichment) {
  assert.match(statement.sql, /IN \(SELECT d\.id FROM deliveries d/);
}
console.log("Delivery-list D1 parameter regression passed (200 rows; all statements <= 100 binds).");
