// End-to-end tests against a LOCAL `wrangler dev` (Miniflare D1 + R2). No Cloudflare account needed.
//   terminal 1:  npx wrangler dev --local --port 8799 --var STORAGE_LIMIT_BYTES:5242880 --var ALLOWED_ORIGINS:http://localhost:8000
//   terminal 2:  BASE=http://localhost:8799 E2E_USER=admin@boztik.test E2E_PASS='TestPassw0rd!x' node scripts/e2e.mjs
//   (E2E_HARD=1 runs only the real 3 GiB cap boundary test; start wrangler WITHOUT the STORAGE_LIMIT_BYTES override)
import { execSync } from "node:child_process";

const BASE = process.env.BASE || "http://localhost:8799";
const USER = process.env.E2E_USER, PASS = process.env.E2E_PASS;
const MB = 1024 * 1024;
let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); } };
const sql = (q) => execSync(`node node_modules/wrangler/bin/wrangler.js d1 execute boztik-deliver --local --command "${q}"`, { stdio: "pipe" }).toString();

let TOKEN = "";
const api = async (method, path, body, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if (TOKEN && !opts.anon) headers.Authorization = `Bearer ${TOKEN}`;
  let payload = body;
  if (body && !(body instanceof Uint8Array) && typeof body === "object") { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  let j = null; const ct = r.headers.get("content-type") || "";
  if (ct.includes("json")) j = await r.json().catch(() => null);
  return { status: r.status, json: j, res: r };
};
const png = (n) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); for (let i = 8; i < n; i++) b[i] = i % 251; return b; };
const jpg = (n) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); for (let i = 4; i < n; i++) b[i] = i % 241; return b; };
const zip = (n) => { const b = new Uint8Array(n); b.set([0x50, 0x4b, 3, 4]); return b; };
// wrangler dev reports the route hostname as request.url; point signed URLs back at the local server.
const local = (u) => BASE + new URL(u).pathname + new URL(u).search;
const newId = () => "BZ-" + Array.from({ length: 8 }, () => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 32)]).join("");
const storage = async () => (await api("GET", "/api/admin/storage")).json.storage;

async function upload(deliveryId, name, bytes, extra = {}) {
  const r = await api("POST", "/api/admin/uploads", { delivery_id: deliveryId, file_name: name, file_size: bytes.length, ...extra });
  if (r.status !== 201) return { reserve: r };
  const p = await api("PUT", `/api/admin/uploads/${r.json.upload_id}`, bytes);
  return { reserve: r, put: p, upload_id: r.json.upload_id, file_id: r.json.file_id };
}
async function makeDelivery(name, bytes, meta = {}, extra = {}) {
  const id = newId();
  const u = await upload(id, name, bytes, extra.up || {});
  if (u.put?.status !== 201) return { id, u };
  const c = await api("POST", "/api/admin/deliveries", { id, project_name: "E2E", client_name: "Tester", upload_ids: [u.upload_id], expires_in_hours: 24, ...meta });
  return { id, u, c, file_id: u.file_id };
}

async function main() {
  if (process.env.E2E_HARD) return hard();
  console.log("\n[1] health / auth / CORS");
  ok("health", (await api("GET", "/api/health", null, { anon: true })).json?.status === "ok");
  ok("admin route without token -> 401", (await api("GET", "/api/admin/deliveries", null, { anon: true })).status === 401);
  TOKEN = "x".repeat(43);
  ok("admin route with garbage token -> 401", (await api("GET", "/api/admin/storage")).status === 401);
  TOKEN = "";
  ok("upload without token -> 401", (await api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "a.png", file_size: 10 })).status === 401);
  ok("login wrong password -> 401", (await api("POST", "/api/auth/login", { username: USER, password: "nope-nope-nope" }, { anon: true })).status === 401);
  ok("login wrong username -> 401", (await api("POST", "/api/auth/login", { username: "who@x.com", password: PASS }, { anon: true })).status === 401);
  const li = await api("POST", "/api/auth/login", { username: USER, password: PASS }, { anon: true });
  ok("login ok returns token", li.status === 200 && li.json.token?.length >= 40);
  TOKEN = li.json.token;
  ok("session persists (/auth/me)", (await api("GET", "/api/auth/me")).json?.user?.email === USER);
  const evil = await fetch(BASE + "/api/admin/storage", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } });
  ok("CORS: evil origin gets no ACAO on admin", !evil.headers.get("access-control-allow-origin"));
  const good = await fetch(BASE + "/api/admin/storage", { method: "OPTIONS", headers: { Origin: "http://localhost:8000", "Access-Control-Request-Method": "GET" } });
  ok("CORS: site origin allowed on admin", good.headers.get("access-control-allow-origin") === "http://localhost:8000");

  console.log("\n[2] upload validation");
  const d0 = newId();
  ok(".exe rejected before storing", (await api("POST", "/api/admin/uploads", { delivery_id: d0, file_name: "x.exe", file_size: 100 })).status === 415);
  ok("no extension rejected", (await api("POST", "/api/admin/uploads", { delivery_id: d0, file_name: "noext", file_size: 100 })).status === 415);
  ok("PhotoshopBattles rejects zip", (await api("POST", "/api/admin/uploads", { delivery_id: d0, file_name: "a.zip", file_size: 100, is_photoshop_battles: true })).status === 415);
  ok("PhotoshopBattles rejects webp/gif", (await api("POST", "/api/admin/uploads", { delivery_id: d0, file_name: "a.gif", file_size: 100, is_photoshop_battles: true })).status === 415);
  ok("over per-file limit -> 413", (await api("POST", "/api/admin/uploads", { delivery_id: d0, file_name: "a.zip", file_size: 200 * MB })).status === 413);
  ok("zero/negative size rejected", (await api("POST", "/api/admin/uploads", { delivery_id: d0, file_name: "a.png", file_size: 0 })).status === 422);
  ok("bad delivery id rejected", (await api("POST", "/api/admin/uploads", { delivery_id: "../evil", file_name: "a.png", file_size: 10 })).status === 422);
  const s0 = await storage();
  ok("rejections reserved nothing", s0.reserved_bytes === 0 && s0.used_bytes === 0, JSON.stringify(s0));

  const r1 = await api("POST", "/api/admin/uploads", { delivery_id: d0, file_name: "a.png", file_size: 1000 });
  ok("reserve ok", r1.status === 201);
  ok("reservation is counted", (await storage()).reserved_bytes === 1000);
  ok("PUT with wrong length -> 422", (await api("PUT", `/api/admin/uploads/${r1.json.upload_id}`, png(999))).status === 422);
  const fake = new Uint8Array(1000).fill(65);
  const bad = await api("PUT", `/api/admin/uploads/${r1.json.upload_id}`, fake);
  ok("content not matching extension -> 422", bad.status === 422 && bad.json?.code === "content_mismatch", JSON.stringify(bad.json));
  const s1 = await storage();
  ok("failed upload released reservation, nothing stored", s1.reserved_bytes === 0 && s1.used_bytes === 0, JSON.stringify(s1));
  ok("abort of gone upload is idempotent", (await api("DELETE", `/api/admin/uploads/${r1.json.upload_id}`)).json?.ok === true);

  console.log("\n[3] create delivery, storage accounting, public access, tracking");
  const bytes = png(300_000);
  const A = await makeDelivery("photo one.png", bytes, { reddit_source: { canonicalUrl: "https://www.reddit.com/r/test/comments/abc/x/", title: "T <b>", subreddit: "test", author: "u1" } });
  ok("delivery created (201)", A.c?.status === 201, JSON.stringify(A.c?.json));
  const s2 = await storage();
  ok("used_bytes == file size", s2.used_bytes === 300_000 && s2.reserved_bytes === 0, JSON.stringify(s2));
  const pub = await api("GET", `/api/public/delivery/${A.id}`, null, { anon: true });
  ok("public delivery visible without auth", pub.status === 200 && pub.json.delivery.delivery_files.length === 1);
  ok("public payload leaks no storage path/counters", !JSON.stringify(pub.json).includes("deliveries/") && !("view_count" in pub.json.delivery) && !("source_meta" in pub.json.delivery));
  ok("reddit source returned", pub.json.delivery.reddit_source?.canonicalUrl?.startsWith("https://www.reddit.com/"));
  ok("GET delivery does not count a view", (await api("GET", `/api/admin/deliveries/${A.id}`)).json.delivery.view_count === 0);
  ok("view counted", (await api("POST", `/api/public/delivery/${A.id}/view`, {}, { anon: true })).json?.counted === true);
  ok("admin preview with valid session NOT counted", (await api("POST", `/api/public/delivery/${A.id}/view`, { preview: true })).json?.counted === false);
  ok("preview=true WITHOUT session IS counted", (await api("POST", `/api/public/delivery/${A.id}/view`, { preview: true }, { anon: true })).json?.counted === true);
  const acc = await api("POST", `/api/public/delivery/${A.id}/files/${A.file_id}/access`, { intent: "download" }, { anon: true });
  ok("signed download url issued", acc.status === 200 && acc.json.url.includes("/blob/"));
  ok("url exposes no R2 host", !/r2\.|cloudflarestorage/.test(acc.json.url));
  const dl = await fetch(local(acc.json.url));
  const got = new Uint8Array(await dl.arrayBuffer());
  ok("download returns exact bytes", dl.status === 200 && got.length === bytes.length && got.every((v, i) => v === bytes[i]));
  ok("download is attachment + nosniff + sandbox CSP", /attachment/.test(dl.headers.get("content-disposition")) && dl.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(dl.headers.get("content-security-policy")));
  const rg = await fetch(local(acc.json.url), { headers: { Range: "bytes=10-19" } });
  const rgb = new Uint8Array(await rg.arrayBuffer());
  ok("Range request -> 206 with correct slice", rg.status === 206 && rgb.length === 10 && rgb[0] === bytes[10] && /bytes 10-19\/300000/.test(rg.headers.get("content-range")));
  ok("tampered signature -> 403", (await fetch(local(acc.json.url).slice(0, -2) + "00")).status === 403);
  ok("signature for another file -> 403", (await fetch(local(acc.json.url).replace(A.file_id, "aaaaaaaaaaaa"))).status === 403);
  const prev = await api("POST", `/api/public/delivery/${A.id}/files/${A.file_id}/access`, { intent: "preview" }, { anon: true });
  const pv = await fetch(local(prev.json.url));
  ok("image preview served inline", pv.status === 200 && /inline/.test(pv.headers.get("content-disposition")));
  const adm = (await api("GET", `/api/admin/deliveries/${A.id}`)).json.delivery;
  ok("full download counted once (range resumes/previews not)", adm.download_count === 1, `download_count=${adm.download_count}`);
  ok("views counted (2: public + spoofed-preview)", adm.view_count === 2, `view_count=${adm.view_count}`);
  const ov = (await api("GET", "/api/admin/analytics/overview")).json;
  ok("overview: active=1, today views=2, downloads=1", ov.deliveries.active === 1 && ov.activity.today.views === 2 && ov.activity.today.downloads === 1, JSON.stringify(ov.activity.today));
  const ts = (await api("GET", "/api/admin/analytics/timeseries?range=24h")).json;
  ok("24h timeseries has 24 buckets w/ activity", ts.series.length === 24 && ts.series.reduce((s, p) => s + p.views, 0) === 2);
  ok("7d timeseries has 7 buckets", (await api("GET", "/api/admin/analytics/timeseries?range=7d")).json.series.length === 7);
  ok("top deliveries lists it", (await api("GET", "/api/admin/analytics/top")).json.top[0]?.id === A.id);

  console.log("\n[4] reddit source validation");
  const badR = await makeDelivery("r.png", png(500), { reddit_source: { canonicalUrl: "javascript:alert(1)" } });
  ok("javascript: url rejected (422)", badR.c?.status === 422);
  const relBad = await makeDelivery("r2.png", png(500), { reddit_url: "ftp://x.com/a" });
  ok("ftp url rejected (422)", relBad.c?.status === 422);
  const none = await makeDelivery("n.png", png(500), {});
  ok("no reddit url -> none stored", (await api("GET", `/api/public/delivery/${none.id}`, null, { anon: true })).json.delivery.reddit_source === null);
  // failed finalisations must not leak reservations: their uploads are stored-unfinalised; abort them
  for (const x of [badR, relBad]) await api("DELETE", `/api/admin/uploads/${x.u.upload_id}`);
  ok("aborting stored-unfinalised uploads returns their bytes", (await storage()).used_bytes === 300_000 + 500);

  console.log("\n[5] PhotoshopBattles: image only + stable direct URL");
  const B = await makeDelivery("battle.jpg", jpg(4000), { source: "reddit", source_meta: { type: "photoshop_battles", redditUrl: "https://www.reddit.com/r/photoshopbattles/comments/abc/x/" } }, { up: { is_photoshop_battles: true } });
  ok("battle delivery created", B.c?.status === 201, JSON.stringify(B.c?.json));
  const bm = B.c.json.delivery.source_meta;
  ok("server issued/kept a 32-hex direct token", /^[a-f0-9]{32}$/.test(bm.direct_token));
  const direct = `${BASE}/api/public/photoshop-battles-image/${B.id}--${bm.direct_token}.jpg`;
  const dr = await fetch(direct);
  ok("direct image URL serves jpeg", dr.status === 200 && dr.headers.get("content-type") === "image/jpeg" && (await dr.arrayBuffer()).byteLength === 4000);
  ok("direct URL counts a view", (await api("GET", `/api/admin/deliveries/${B.id}`)).json.delivery.view_count === 1);
  ok("wrong token -> 404", (await fetch(`${BASE}/api/public/photoshop-battles-image/${B.id}--${"0".repeat(32)}.jpg`)).status === 404);
  ok("wrong extension -> 404", (await fetch(`${BASE}/api/public/photoshop-battles-image/${B.id}--${bm.direct_token}.png`)).status === 404);
  ok("non-battle delivery via battle route -> 404", (await fetch(`${BASE}/api/public/photoshop-battles-image/${A.id}--${bm.direct_token}.png`)).status === 404);
  const zipB = await makeDelivery("z.zip", zip(200), { source: "reddit", source_meta: { type: "photoshop_battles" } });
  ok("battle finalise with a zip -> 422", zipB.c?.status === 422);
  await api("DELETE", `/api/admin/uploads/${zipB.u.upload_id}`);
  const edit = await api("PATCH", `/api/admin/deliveries/${B.id}`, { source_meta: { type: "photoshop_battles", direct_token: "f".repeat(32) } });
  ok("edit cannot change the shared direct token", edit.json.delivery.source_meta.direct_token === bm.direct_token);

  console.log("\n[6] edit / list / search / filter / sort / duplicate");
  const ed = await api("PATCH", `/api/admin/deliveries/${A.id}`, { project_name: "Renamed", notes: "hello", expires_at: new Date(Date.now() + 48 * 3600e3).toISOString() });
  ok("edit + extend expiry", ed.json.delivery.project_name === "Renamed" && new Date(ed.json.delivery.expires_at) > new Date(Date.now() + 47 * 3600e3));
  ok("expiry in the past rejected", (await api("PATCH", `/api/admin/deliveries/${A.id}`, { expires_at: new Date(Date.now() - 1000).toISOString() })).status === 422);
  ok("expiry > 30 days rejected", (await api("PATCH", `/api/admin/deliveries/${A.id}`, { expires_at: new Date(Date.now() + 40 * 86400e3).toISOString() })).status === 422);
  ok("search by name", (await api("GET", "/api/admin/deliveries?q=Renamed")).json.items.length === 1);
  ok("search with LIKE wildcard is literal", (await api("GET", "/api/admin/deliveries?q=%25")).json.items.length === 0);
  ok("SQL-injection-shaped search is harmless", (await api("GET", "/api/admin/deliveries?q=" + encodeURIComponent("'; DROP TABLE deliveries;--"))).status === 200 && (await api("GET", "/api/admin/deliveries")).json.total >= 3);
  ok("filter source=photoshop_battles", (await api("GET", "/api/admin/deliveries?source=photoshop_battles")).json.items.every((d) => d.is_photoshop_battles));
  const byViews = (await api("GET", "/api/admin/deliveries?sort=views&order=desc")).json.items;
  ok("sort by views desc", byViews[0].view_count >= byViews[byViews.length - 1].view_count);
  const before = (await storage()).used_bytes;
  const dup = await api("POST", `/api/admin/deliveries/${A.id}/duplicate`);
  ok("duplicate creates new delivery with own file", dup.status === 201 && dup.json.delivery.id !== A.id && dup.json.delivery.files.length === 1 && dup.json.delivery.view_count === 0, JSON.stringify(dup.json));
  ok("duplicate is counted against storage", (await storage()).used_bytes === before + 300_000);
  const dupDl = await api("POST", `/api/public/delivery/${dup.json.delivery.id}/files/${dup.json.delivery.files[0].id}/access`, { intent: "download" }, { anon: true });
  ok("duplicated file downloads", (await fetch(local(dupDl.json.url))).status === 200);

  console.log("\n[7] storage cap (limit forced to 5 MiB for this run)");
  const cap = (await storage()).limit_bytes;
  ok("effective limit is the overridden 5 MiB", cap === 5 * MB, `limit=${cap}`);
  ok("limit cannot be raised above 3 GiB", (await api("PATCH", "/api/admin/storage/limit", { limit_bytes: 4 * 1024 ** 3 })).status === 422);
  // free everything except what we need, for a clean boundary test
  for (const d of (await api("GET", "/api/admin/deliveries")).json.items) await api("DELETE", `/api/admin/deliveries/${d.id}`);
  const sc = await storage();
  ok("all deleted -> storage back to 0", sc.used_bytes === 0 && sc.reserved_bytes === 0, JSON.stringify(sc));
  const fillId = newId();
  const fill = await upload(fillId, "big.zip", zip(3 * MB));
  ok("3 MiB upload fits under 5 MiB", fill.put?.status === 201);
  const over = await api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "b.zip", file_size: 3 * MB });
  ok("upload that would exceed cap -> 507 storage_full BEFORE any write", over.status === 507 && over.json.code === "storage_full" && over.json.remaining_bytes === 2 * MB, JSON.stringify(over.json));
  ok("rejected upload changed nothing", (await storage()).used_bytes === 3 * MB && (await storage()).reserved_bytes === 0);
  const exact = await api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "e.zip", file_size: 2 * MB });
  ok("exactly filling the cap is allowed", exact.status === 201);
  const oneMore = await api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "e.zip", file_size: 1 });
  ok("one more byte -> 507", oneMore.status === 507);
  await api("DELETE", `/api/admin/uploads/${exact.json.upload_id}`);
  ok("aborted reservation freed", (await storage()).reserved_bytes === 0);
  await api("DELETE", `/api/admin/uploads/${fill.upload_id}`);
  // concurrency: 4 parallel 2 MiB reservations against 5 MiB free -> exactly 2 win
  const race = await Promise.all(Array.from({ length: 4 }, () => api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "c.zip", file_size: 2 * MB })));
  const won = race.filter((r) => r.status === 201), lost = race.filter((r) => r.status === 507);
  ok("concurrent reservations: exactly 2 of 4 admitted", won.length === 2 && lost.length === 2, `won=${won.length} lost=${lost.length}`);
  ok("reserved never exceeds cap", (await storage()).reserved_bytes === 4 * MB);
  for (const w of won) await api("DELETE", `/api/admin/uploads/${w.json.upload_id}`);

  console.log("\n[8] deletion order, expiry, cleanup, reconcile");
  const E = await makeDelivery("exp.png", png(200_000), {});
  const acc2 = await api("POST", `/api/public/delivery/${E.id}/files/${E.file_id}/access`, { intent: "download" }, { anon: true });
  await api("POST", `/api/admin/deliveries/${E.id}/expire`);
  const pubE = await api("GET", `/api/public/delivery/${E.id}`, null, { anon: true });
  ok("expired delivery: public payload has no files/names", pubE.json.delivery.expired === true && pubE.json.delivery.delivery_files.length === 0 && !("project_name" in pubE.json.delivery));
  ok("expired: still-valid signed URL is refused (410)", (await fetch(local(acc2.json.url))).status === 410);
  ok("expired: new access refused (410)", (await api("POST", `/api/public/delivery/${E.id}/files/${E.file_id}/access`, { intent: "download" }, { anon: true })).status === 410);
  ok("expired: view not counted", (await api("POST", `/api/public/delivery/${E.id}/view`, {}, { anon: true })).json.counted === false);
  ok("files still occupy storage until cleanup", (await storage()).used_bytes === 200_000);
  const cl = await api("POST", "/api/admin/cleanup");
  ok("manual cleanup removed expired delivery files", cl.json.cleaned === 1 && cl.json.removed_files === 1 && cl.json.removed_bytes === 200_000, JSON.stringify(cl.json));
  ok("storage released after cleanup", (await storage()).used_bytes === 0);
  const tomb = (await api("GET", `/api/admin/deliveries/${E.id}`)).json.delivery;
  ok("expiry keeps a tombstone row (history) with files_removed_at", tomb.files_removed_at && tomb.files.length === 0);
  ok("cleanup is idempotent", (await api("POST", "/api/admin/cleanup")).json.cleaned === 0);
  ok("cannot extend a cleaned delivery", (await api("PATCH", `/api/admin/deliveries/${E.id}`, { expires_at: new Date(Date.now() + 3600e3).toISOString() })).status === 409);
  const F = await makeDelivery("del.png", png(100_000), {});
  await api("POST", `/api/public/delivery/${F.id}/view`, {}, { anon: true });
  const del = await api("DELETE", `/api/admin/deliveries/${F.id}`);
  ok("manual delete: ok + storage freed", del.json.status === "deleted" && del.json.storage.used_bytes === 0);
  ok("manual delete removed D1 record", (await api("GET", `/api/admin/deliveries/${F.id}`)).status === 404);
  ok("deleted delivery is 404 publicly", (await api("GET", `/api/public/delivery/${F.id}`, null, { anon: true })).status === 404);
  ok("delete is idempotent", (await api("DELETE", `/api/admin/deliveries/${F.id}`)).json.status === "already_deleted");
  ok("historical analytics survive deletion", (await api("GET", "/api/admin/analytics/overview")).json.activity.lifetime.views >= 1);
  const rec = await api("POST", "/api/admin/storage/reconcile");
  ok("reconcile: ledger matches R2 (0 drift)", rec.json.reconcile.drift_bytes === 0 && rec.json.reconcile.actual_bytes === 0, JSON.stringify(rec.json));
  sql(`UPDATE storage_state SET total_bytes = 999999 WHERE id = 1`);
  const rec2 = await api("POST", "/api/admin/storage/reconcile");
  ok("reconcile heals a corrupted ledger from R2", rec2.json.storage.used_bytes === 0 && rec2.json.reconcile.drift_bytes === 999999, JSON.stringify(rec2.json));
  sql(`UPDATE storage_state SET needs_reconcile = 1 WHERE id = 1`);
  const heal = await api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "h.zip", file_size: 1000 });
  ok("uncertain ledger self-verifies before admitting an upload", heal.status === 201);
  await api("DELETE", `/api/admin/uploads/${heal.json.upload_id}`);
  sql(`INSERT INTO pending_uploads (upload_id, delivery_id, file_id, r2_key, file_name, file_size, content_type, created_at, state) VALUES ('stale00000000001','BZ-STALE234','stalefile001','deliveries/BZ-STALE234/x.zip','x.zip',1000,'application/zip',1,'reserved')`);
  sql(`UPDATE storage_state SET reserved_bytes = 1000 WHERE id = 1`);
  await api("POST", "/api/admin/storage/reconcile");
  ok("reconcile derives reserved_bytes from pending rows", (await storage()).reserved_bytes === 1000);
  sql(`DELETE FROM pending_uploads WHERE upload_id = 'stale00000000001'`);
  await api("POST", "/api/admin/storage/reconcile");

  console.log("\n[9] login throttle (last; it locks this IP)");
  let last;
  for (let i = 0; i < 9; i++) last = await api("POST", "/api/auth/login", { username: USER, password: "wrong-wrong-wrong" }, { anon: true });
  ok("8 failures -> 429 with Retry-After", last.status === 429 && !!last.res.headers.get("retry-after"));
  ok("correct password is blocked too while throttled", (await api("POST", "/api/auth/login", { username: USER, password: PASS }, { anon: true })).status === 429);
  sql(`DELETE FROM auth_throttle`);
  ok("throttle clears -> login works again", (await api("POST", "/api/auth/login", { username: USER, password: PASS }, { anon: true })).status === 200);
  const lo = await api("POST", "/api/auth/logout");
  ok("logout revokes the session", lo.json.ok && (await api("GET", "/api/auth/me")).status === 401);
}

async function hard() {
  console.log("\n[HARD] real 3 GiB cap (no override) — boundary via ledger");
  const li = await api("POST", "/api/auth/login", { username: USER, password: PASS }, { anon: true });
  TOKEN = li.json.token;
  const st = await storage();
  ok("limit is exactly 3 GiB", st.limit_bytes === 3 * 1024 ** 3, `limit=${st.limit_bytes}`);
  ok("PATCH above 3 GiB refused", (await api("PATCH", "/api/admin/storage/limit", { limit_bytes: 3 * 1024 ** 3 + 1 })).status === 422);
  sql(`UPDATE storage_state SET total_bytes = ${3 * 1024 ** 3 - 1 * MB}, reserved_bytes = 0, needs_reconcile = 0, status = 'ok' WHERE id = 1`);
  const a = await api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "a.zip", file_size: 2 * MB });
  ok("2 MiB with only 1 MiB left -> 507", a.status === 507 && a.json.remaining_bytes === MB, JSON.stringify(a.json));
  const b = await api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "b.zip", file_size: MB });
  ok("exactly the remaining 1 MiB is admitted", b.status === 201);
  const c = await api("POST", "/api/admin/uploads", { delivery_id: newId(), file_name: "c.zip", file_size: 1 });
  const s = await storage();
  ok("1 more byte -> 507; level=full and upload_locked", c.status === 507 && s.level === "full" && s.upload_locked === true, JSON.stringify(s));
  sql(`UPDATE storage_state SET total_bytes = ${Math.floor(3 * 1024 ** 3 * 0.86)}, reserved_bytes = 0 WHERE id = 1`);
  ok("86% -> warning level", (await storage()).level === "warning");
  sql(`UPDATE storage_state SET total_bytes = ${Math.floor(3 * 1024 ** 3 * 0.96)} WHERE id = 1`);
  ok("96% -> critical level", (await storage()).level === "critical");
  sql(`UPDATE storage_state SET total_bytes = ${Math.floor(3 * 1024 ** 3 * 0.71)} WHERE id = 1`);
  ok("71% -> notice level", (await storage()).level === "notice");
  sql(`UPDATE storage_state SET locked = 0 WHERE 0`.replace("locked = 0 WHERE 0", "needs_reconcile = 1 WHERE id = 1"));
  const r = await api("POST", "/api/admin/storage/reconcile");
  ok("reconcile restores true usage from R2", r.json.storage.used_bytes === 0);
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log("FAILED:\n - " + failures.join("\n - "));
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error("E2E crashed", e); process.exit(2); });
