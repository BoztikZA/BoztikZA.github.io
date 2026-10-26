#!/usr/bin/env node
// LOCAL-ONLY analytics test fixture. Fills the LOCAL Miniflare D1 (wrangler `--local`) with deterministic,
// clearly synthetic data so the Command Centre Analytics tab can be rendered and tested.
//
//   node scripts/seed-analytics-fixture.mjs            # seed (idempotent: clears the analytics tables first)
//   node scripts/seed-analytics-fixture.mjs --clear    # only clear
//
// SAFETY: every database call below goes through `wrangler d1 execute ... --local`. There is no code path
// here that can reach a remote database, and the script refuses to run if a Cloudflare API token is set in
// the environment, so a mistaken shell can never be mistaken for production.
//
// It only touches analytics tables and the `deliveries` rows it creates itself (ids start with "BZ-TEST").
// The data is SYNTHETIC. Never use it as, or alongside, production numbers.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN) {
  console.error("Refusing to run: a Cloudflare API token is set in this shell. This script is local-only.");
  process.exit(1);
}

const OFFSET_MIN = 120; // SAST, same default as the Worker (ANALYTICS_UTC_OFFSET_MINUTES)
const now = Math.floor(Date.now() / 1000);
const localDay = ts => new Date((ts + OFFSET_MIN * 60) * 1000).toISOString().slice(0, 10);
const localHour = ts => new Date((ts + OFFSET_MIN * 60) * 1000).toISOString().slice(0, 13);
const dayStartTs = dayStr => Math.floor(Date.parse(`${dayStr}T00:00:00Z`) / 1000) - OFFSET_MIN * 60;

// Small deterministic PRNG (mulberry32) so every run produces identical data.
let seed = 20261025;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const hex32 = () => Array.from({ length: 32 }, () => Math.floor(rnd() * 16).toString(16)).join("");
const q = v => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const sql = [];
const clear = [
  "DELETE FROM page_analytics", "DELETE FROM page_session_events", "DELETE FROM traffic_source_visits", "DELETE FROM store_clicks",
  "DELETE FROM site_hourly_metrics", "DELETE FROM delivery_daily_metrics", "DELETE FROM delivery_analytics", "DELETE FROM share_metrics",
  "DELETE FROM deliveries WHERE id LIKE 'BZ-TEST%'",
];
sql.push(...clear);

if (!process.argv.includes("--clear")) {
  const TRACK_DAYS = 75;           // page-view counter "began" 75 days ago => a 90-day window has a 15-day unmeasured lead-in
  const PAGES = [["homepage", 34], ["stores", 22], ["toolkit", 9], ["tools", 12], ["guides", 10], ["services", 6], ["deliver", 4], ["about", 2], ["support", 1], ["contact", 1]];
  const pageWeight = PAGES.reduce((t, [, w]) => t + w, 0);

  // ---- daily page views: weekly pattern, slow growth, one Reddit-style spike, one quiet 2-day gap
  for (let back = TRACK_DAYS - 1; back >= 0; back--) {
    const ts = now - back * 86400;
    const day = localDay(ts);
    const dow = new Date((ts + OFFSET_MIN * 60) * 1000).getUTCDay();
    if (back === 40 || back === 39) continue;                       // genuine quiet gap: no counted views (no rows)
    let base = 55 + (TRACK_DAYS - back) * 0.9;                      // gentle growth
    base *= dow === 0 || dow === 6 ? 0.7 : 1.05;                    // quieter weekends
    if (back === 21) base *= 5.5;                                   // spike
    if (back === 20) base *= 2.4;                                   // spike tail
    if (back === 0) base *= 0.45;                                   // today is a partial day
    for (const [page, w] of PAGES) {
      const v = Math.round(base * (w / pageWeight) * (0.8 + rnd() * 0.4));
      if (v > 0) sql.push(`INSERT INTO page_analytics (day, page, views) VALUES (${q(day)}, ${q(page)}, ${v})`);
    }
  }

  // ---- anonymous sessions (last 30 days only: session tracking began later than the counters) + visits/journeys
  const journeys = [["homepage"], ["homepage", "stores"], ["homepage", "toolkit"], ["homepage", "services"], ["stores"], ["tools"], ["guides"], ["guides", "tools"],
    ["homepage", "stores", "toolkit"], ["toolkit"], ["deliver"], ["services", "contact"], ["homepage", "about", "contact"]];
  const sessions = [];
  const EVENT_DAYS = 30;
  for (let i = 0; i < 260; i++) {
    const startBack = rnd() * EVENT_DAYS * 86400;
    const start = Math.floor(now - startBack);
    const sid = hex32();
    sessions.push({ sid, start });
    let t = start;
    for (const page of pick(journeys)) {
      sql.push(`INSERT OR IGNORE INTO page_session_events (session_id, seen_at, page, event_id) VALUES (${q(sid)}, ${t}, ${q(page)}, ${q("evt" + hex32().slice(0, 20))})`);
      t += 20 + Math.floor(rnd() * 240);
    }
  }

  // ---- traffic sources (attribution began 20 days ago), a subset of the sessions + some UTM campaigns
  const srcMix = [["direct_unknown", 40], ["reddit", 30], ["organic_search", 14], ["social", 9], ["referral", 7]];
  const srcTotal = srcMix.reduce((t, [, w]) => t + w, 0);
  const pickSource = () => { let r = rnd() * srcTotal; for (const [s, w] of srcMix) { if ((r -= w) < 0) return s; } return "direct_unknown"; };
  for (const s of sessions) {
    if (s.start < now - 20 * 86400 || rnd() < 0.15) continue;
    const source = pickSource();
    const utm = source === "reddit" && rnd() < 0.5 ? ["reddit", "social", "photoshop_battles_oct"] : source === "social" && rnd() < 0.4 ? ["instagram", "social", "toolkit_launch"] : [null, null, null];
    sql.push(`INSERT OR IGNORE INTO traffic_source_visits (session_id, seen_at, source, utm_source, utm_medium, utm_campaign) VALUES (${q(s.sid)}, ${s.start}, ${q(source)}, ${q(utm[0])}, ${q(utm[1])}, ${q(utm[2])})`);
  }

  // ---- store clicks (last 25 days)
  const dests = ["boztik_store", "redbubble", "teepublic", "kofi"], places = ["store_grid", "stores", "homepage_stores", "nav"];
  for (let i = 0; i < 70; i++) {
    sql.push(`INSERT OR IGNORE INTO store_clicks (event_id, destination, source_placement, session_id, event_version, created_at) VALUES (${q("sc" + hex32().slice(0, 24))}, ${q(pick(dests))}, ${q(pick(places))}, ${q(pick(sessions).sid)}, 1, ${Math.floor(now - rnd() * 25 * 86400)})`);
  }

  // ---- deliveries (synthetic ids BZ-TEST...) + daily/monthly/hourly metrics + shares
  const types = [["private", "Wedding restoration", "A. Tester"], ["paid", "Family portrait", "B. Tester"], ["free", "Colourise grandpa", "C. Tester"], ["private", "Headshots", "D. Tester"],
    ["returning", "Album batch 2", "E. Tester"], ["reddit", "Reddit request", null], ["other", "Misc", null]];
  const ids = [];
  types.forEach(([source, project, client], i) => ids.push({ id: `BZ-TEST${String(i).padStart(4, "0")}`, source, project, client, battle: 0, created: now - (60 - i * 7) * 86400, expires: now + (i % 3 === 0 ? -3 * 86400 : (i + 1) * 86400 * 4) }));
  for (let i = 0; i < 4; i++) ids.push({ id: `BZ-TEST${String(10 + i).padStart(4, "0")}`, source: "reddit", project: `Battle image ${i + 1}`, client: null, battle: 1, created: now - (30 - i * 6) * 86400, expires: now + (i + 1) * 86400 * 3 });
  for (const d of ids) {
    sql.push(`INSERT INTO deliveries (id, project_name, client_name, created_at, expires_at, source, is_photoshop_battles, view_count, download_count) VALUES (${q(d.id)}, ${q(d.project)}, ${q(d.client)}, ${d.created}, ${d.expires}, ${q(d.source)}, ${d.battle}, 0, 0)`);
  }
  const monthly = new Map();
  let totalViews = new Map(), totalDl = new Map();
  for (const d of ids) {
    for (let back = 59; back >= 0; back--) {
      const ts = now - back * 86400;
      if (ts < d.created || ts > Math.min(d.expires, now)) continue;
      const hot = d.battle ? 1.6 : 1;
      const views = rnd() < 0.55 ? Math.floor(rnd() * 9 * hot) : 0;
      const dl = d.battle || views === 0 ? 0 : rnd() < 0.35 ? Math.ceil(rnd() * 2) : 0;
      if (!views && !dl) continue;
      const day = localDay(ts);
      sql.push(`INSERT INTO delivery_daily_metrics (delivery_id, day, views, downloads) VALUES (${q(d.id)}, ${q(day)}, ${views}, ${dl})`);
      const mk = `${d.id}|${day.slice(0, 7)}`; const m = monthly.get(mk) ?? [0, 0]; m[0] += views; m[1] += dl; monthly.set(mk, m);
      totalViews.set(d.id, (totalViews.get(d.id) ?? 0) + views); totalDl.set(d.id, (totalDl.get(d.id) ?? 0) + dl);
      if (views > 3 && rnd() < 0.5) sql.push(`INSERT INTO share_metrics (delivery_id, day, page_type, method, kind, count) VALUES (${q(d.id)}, ${q(day)}, ${q(d.battle ? "photoshop_battles" : "delivery")}, ${q(pick(["copy", "native", "whatsapp", "reddit"]))}, ${q(rnd() < 0.6 ? "completed" : "attempted")}, ${1 + Math.floor(rnd() * 3)})`.replace(/'(whatsapp|reddit)', 'completed'/, "'$1', 'attempted'"));
    }
  }
  for (const [k, [v, dl]] of monthly) { const [id, month] = k.split("|"); sql.push(`INSERT INTO delivery_analytics (delivery_id, month, views, downloads) VALUES (${q(id)}, ${q(month)}, ${v}, ${dl})`); }
  for (const d of ids) sql.push(`UPDATE deliveries SET view_count = ${totalViews.get(d.id) ?? 0}, download_count = ${totalDl.get(d.id) ?? 0} WHERE id = ${q(d.id)}`);
  // hourly Deliver activity, last 72 hours only (the Worker never had it earlier)
  for (let h = 71; h >= 0; h--) {
    const ts = now - h * 3600; const hr = new Date((ts + OFFSET_MIN * 60) * 1000).getUTCHours();
    const v = hr >= 8 && hr <= 22 ? Math.floor(rnd() * 7) : Math.floor(rnd() * 2);
    sql.push(`INSERT INTO site_hourly_metrics (hour, views, downloads) VALUES (${q(localHour(ts))}, ${v}, ${rnd() < 0.2 ? 1 : 0})`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "boztik-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql.join(";\n") + ";\n");
try {
  // `--local` is the ONLY mode used here. Run from deliver/worker-api so wrangler.toml is found.
  execFileSync("node", ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "boztik-deliver", "--local", "--file", file], { stdio: ["ignore", "pipe", "inherit"] });
  console.log(`Seeded ${sql.length} statements into the LOCAL database.${process.argv.includes("--clear") ? " (cleared only)" : ""}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
