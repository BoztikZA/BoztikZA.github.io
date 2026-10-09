import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/lib/cleanup.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { cleanupPageViewEvents, runMaintenance } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);
const analyticsBundle = await build({
  entryPoints: ["src/lib/db.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { getPageAnalytics, getPageFlow } = await import(
  `data:text/javascript;base64,${Buffer.from(analyticsBundle.outputFiles[0].contents).toString("base64")}`
);

const DAY_SECONDS = 24 * 60 * 60;
const RETENTION_SECONDS = 90 * DAY_SECONDS;
const BATCH_SIZE = 1000;
const MAX_BATCHES = 5;

class SqliteD1 {
  constructor(database, { failPageViewCleanup = false } = {}) {
    this.database = database;
    this.failPageViewCleanup = failPageViewCleanup;
    this.batchCalls = 0;
    this.statements = [];
  }

  prepare(sql) {
    this.statements.push(sql);
    const d1 = this;
    let values = [];
    return {
      bind(...bound) {
        values = bound;
        return this;
      },
      async run() {
        if (d1.failPageViewCleanup && sql.includes("DELETE FROM page_session_events")) {
          throw new Error("simulated isolated cleanup failure");
        }
        const result = d1.database.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
      async all() {
        if (sql.includes("FROM page_session_events") || sql.includes("FROM page_analytics")) {
          return { results: d1.database.prepare(sql).all(...values) };
        }
        return { results: [] };
      },
      async first() {
        if (sql.includes("SELECT * FROM storage_state")) {
          return {
            id: 1,
            limit_bytes: 3 * 1024 * 1024 * 1024,
            total_bytes: 0,
            reserved_bytes: 0,
            mutation_seq: 0,
            needs_reconcile: 0,
            status: "ok",
            lock_reason: null,
            last_reconciled_at: null,
            last_mutation_at: null,
          };
        }
        if (sql.includes("SELECT COALESCE(SUM(") && sql.includes("FROM pending_uploads")) {
          return { reserved: 0, uploading: 0 };
        }
        if (sql.includes("SELECT COUNT(*) AS n FROM deliveries")) return { n: 0 };
        return null;
      },
    };
  }

  async batch(statements) {
    this.batchCalls += 1;
    return statements.map(() => ({ meta: { changes: 0 } }));
  }
}

const createDatabase = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE page_analytics (
      day TEXT NOT NULL,
      page TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, page)
    );
    CREATE TABLE page_session_events (
      session_id TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      page TEXT NOT NULL,
      PRIMARY KEY (session_id, seen_at, page)
    );
    CREATE INDEX idx_page_session_events_seen_at ON page_session_events(seen_at);
    CREATE INDEX idx_page_session_events_page ON page_session_events(page, seen_at);
    CREATE TABLE deliveries (id TEXT PRIMARY KEY);
    CREATE TABLE delivery_daily_metrics (
      delivery_id TEXT NOT NULL,
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      downloads INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (delivery_id, day)
    );
    CREATE TABLE storage_state (
      id INTEGER PRIMARY KEY,
      limit_bytes INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      reserved_bytes INTEGER NOT NULL DEFAULT 0,
      mutation_seq INTEGER NOT NULL DEFAULT 0,
      needs_reconcile INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ok',
      lock_reason TEXT,
      last_reconciled_at INTEGER,
      last_mutation_at INTEGER
    );
    INSERT INTO storage_state (id, limit_bytes, total_bytes, reserved_bytes, mutation_seq, needs_reconcile, status)
    VALUES (1, 3221225472, 0, 0, 0, 0, 'ok');
  `);
  return db;
};

const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
const log = (label) => console.log(`  ok  ${label}`);

const originalNow = Date.now;
const now = Date.UTC(2026, 9, 9) / 1000;
Date.now = () => now * 1000;

try {
  console.log("page-view event retention");
  const db = createDatabase();
  const d1 = new SqliteD1(db);
  const cutoff = now - RETENTION_SECONDS;
  const insertEvent = db.prepare("INSERT INTO page_session_events (session_id, seen_at, page) VALUES (?, ?, ?)");
  insertEvent.run("a".repeat(32), cutoff + 1, "homepage");
  insertEvent.run("b".repeat(32), cutoff, "portfolio");
  insertEvent.run("c".repeat(32), cutoff - 1, "services");
  insertEvent.run("d".repeat(32), cutoff - 30 * DAY_SECONDS, "guides");
  db.prepare("INSERT INTO page_analytics (day, page, views) VALUES (?, ?, ?)").run("2026-10-08", "homepage", 42);
  db.prepare("INSERT INTO deliveries (id) VALUES (?)").run("BZ-TEST123");
  db.prepare("INSERT INTO delivery_daily_metrics (delivery_id, day, views, downloads) VALUES (?, ?, ?, ?)").run("BZ-TEST123", "2026-10-08", 7, 2);

  const deleted = await cleanupPageViewEvents({ DB: d1 });
  assert.equal(deleted, 2);
  assert.equal(count(db, "page_session_events"), 2);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM page_session_events WHERE seen_at = ?").get(cutoff).count), 1);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM page_session_events WHERE seen_at = ?").get(cutoff + 1).count), 1);
  log("strict cutoff deletes only events older than 90 days");
  assert.equal(Number(db.prepare("SELECT views FROM page_analytics WHERE page = ?").get("homepage").views), 42);
  assert.deepEqual(await getPageFlow({ DB: d1 }, 90, 8), [
    { path: "homepage", sessions: 1 },
    { path: "portfolio", sessions: 1 },
  ]);
  const aggregateRows = await getPageAnalytics({ DB: d1 }, 30);
  assert.deepEqual(aggregateRows.map((row) => ({ ...row })), [{ page: "homepage", views: 42 }]);
  log("existing page-flow and aggregate analytics queries still return retained data");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM deliveries").get().count), 1);
  assert.equal(Number(db.prepare("SELECT views FROM delivery_daily_metrics WHERE delivery_id = ?").get("BZ-TEST123").views), 7);
  log("aggregate website counts and Deliver data remain unchanged");
  await cleanupPageViewEvents({ DB: d1 });
  assert.equal(count(db, "page_session_events"), 2);
  log("repeated cleanup is safe");
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT rowid FROM page_session_events WHERE seen_at < ? ORDER BY seen_at LIMIT ?").all(cutoff, BATCH_SIZE);
  assert.ok(plan.some((row) => String(row.detail).includes("idx_page_session_events_seen_at")));
  log("timestamp range uses the existing seen_at index");
  db.close();

  console.log("bounded batches");
  const batchDb = createDatabase();
  const batchD1 = new SqliteD1(batchDb);
  const insertBatchEvent = batchDb.prepare("INSERT INTO page_session_events (session_id, seen_at, page) VALUES (?, ?, ?)");
  for (let i = 0; i < BATCH_SIZE * (MAX_BATCHES + 1); i += 1) {
    insertBatchEvent.run(`${i.toString(16).padStart(32, "0")}`, cutoff - 1, "homepage");
  }
  assert.equal(await cleanupPageViewEvents({ DB: batchD1 }), BATCH_SIZE * MAX_BATCHES);
  assert.equal(count(batchDb, "page_session_events"), BATCH_SIZE);
  assert.equal(batchD1.statements.length, MAX_BATCHES);
  assert.equal(await cleanupPageViewEvents({ DB: batchD1 }), BATCH_SIZE);
  assert.equal(count(batchDb, "page_session_events"), 0);
  log("each invocation is capped at five 1,000-row deletes; later runs catch up");
  batchDb.close();

  console.log("scheduled failure isolation");
  const maintenanceDb = createDatabase();
  const failingD1 = new SqliteD1(maintenanceDb, { failPageViewCleanup: true });
  const originalError = console.error;
  console.error = () => {};
  let report;
  try {
    report = await runMaintenance({
      DB: failingD1,
      BUCKET: { list: async () => ({ objects: [], truncated: false }) },
      STORAGE_LIMIT_BYTES: String(3 * 1024 * 1024 * 1024),
    });
  } finally {
    console.error = originalError;
  }
  assert.equal(report.page_view_events_deleted, null);
  assert.ok(report.errors.includes("page-view-event-retention"));
  assert.equal(failingD1.batchCalls, 1);
  assert.ok(failingD1.statements.some((sql) => sql.includes("DELETE FROM site_hourly_metrics")));
  log("cleanup errors are reported and remaining scheduled maintenance continues");
  maintenanceDb.close();
} finally {
  Date.now = originalNow;
}

console.log("\nAll page-view retention tests passed.");
