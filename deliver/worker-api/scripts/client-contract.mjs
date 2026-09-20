// Drives the REAL browser modules (deliver-v3/js/api.js, auth.js, insights.js) against a local
// `wrangler dev --port 8787`, with minimal shims for browser globals. Verifies the contract the UI relies on.
import { pathToFileURL } from "node:url";
import path from "node:path";

const JS = path.resolve(import.meta.dirname, "../../../deliver-v3/js");
const mem = new Map();
globalThis.location = { hostname: "localhost", href: "http://localhost:8000/deliver-v3/dashboard.html", search: "" };
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { getElementById: () => null };
// XHR shim over fetch (only what api.js uses: PUT with a body + upload progress).
globalThis.XMLHttpRequest = class {
  constructor() { this.upload = {}; this.h = {}; }
  open(m, u) { this.m = m; this.u = u; }
  setRequestHeader(k, v) { this.h[k] = v; }
  send(body) {
    fetch(this.u, { method: this.m, headers: this.h, body }).then(async r => {
      this.status = r.status; this.responseText = await r.text();
      this.upload.onprogress?.({ lengthComputable: true, loaded: body.size ?? body.length });
      this.onload();
    }).catch(() => this.onerror());
  }
};
const imp = f => import(pathToFileURL(path.join(JS, f)).href);
const { signIn, getSession, signOut } = await imp("auth.js");
const api = await imp("api.js");
const { StorageLimitError } = await imp("storage-guard.js");
const { barChart } = await imp("insights.js");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${n} ${c ? "" : x}`); };
const local = u => "http://localhost:8787" + new URL(u).pathname + new URL(u).search;
const png = n => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const jpg = n => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const mkFile = (name, bytes) => Object.assign(bytes, { name, size: bytes.length, type: "" });
const rid = () => "BZ-" + Array.from({ length: 8 }, () => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 32)]).join("");

console.log("\n[auth]");
ok("no session before sign-in", (await getSession()) === null);
let bad = null; try { await signIn("admin@boztik.test", "wrong-password-x"); } catch (e) { bad = e; }
ok("wrong password -> readable error", bad && /Incorrect/.test(bad.message), bad?.message);
const sess = await signIn("admin@boztik.test", "TestPassw0rd!x");
ok("sign-in stores session", sess?.user?.email === "admin@boztik.test" && !!(await getSession()));

console.log("\n[create via the same call the dashboard makes]");
const id = rid();
let progress = [];
const created = await api.createDelivery(
  { id, client_name: "Acme", project_name: "Shoot", notes: "n", expires_at: new Date(Date.now() + 24 * 3600e3).toISOString(),
    source: "reddit", source_meta: null, reddit_source: { canonicalUrl: "https://www.reddit.com/r/x/comments/abc/t/", redditUrl: "https://redd.it/abc", title: "T", subreddit: "x", author: "u" } },
  [mkFile("a.png", png(50_000)), mkFile("b.jpg", jpg(60_000))], p => progress.push(p));
ok("createDelivery returns legacy-shaped delivery", created.id === id && created.delivery_files.length === 2 && created.file_size === 110_000);
ok("progress reaches 100%", progress.at(-1) === 1);
const list = await api.listDeliveries();
const mine = list.find(d => d.id === id);
ok("listDeliveries: legacy fields present", mine && mine.delivery_files[0].file_path && mine.lifetime_views === 0 && mine.storage_deleted_at === null && mine.reddit_source?.title === "T");

console.log("\n[public client flow]");
const pub = await api.getPublicDelivery(id);
ok("getPublicDelivery shape", pub.delivery_files.length === 2 && pub.reddit_source?.canonicalUrl && pub.project_name === "Shoot" && !pub.expired);
ok("unknown id -> null (client shows expired state)", (await api.getPublicDelivery(rid())) === null);
ok("recordView counts", (await api.recordView(id)) === true);
ok("recordView with preview + valid session accepted", (await api.recordView(id, { preview: true })) === true);
const url = await api.signedDownload(pub.delivery_files[0]);
const dl = await fetch(local(url));
ok("signedDownload -> real bytes", dl.status === 200 && (await dl.arrayBuffer()).byteLength === 50_000);
ok("signedPreview -> inline image", (await fetch(local(await api.signedPreview(pub.delivery_files[0])))).headers.get("content-disposition")?.startsWith("inline"));
let pv = null; try { await api.signedPreview(pub.delivery_files[0].id ? { ...pub.delivery_files[0], delivery_id: rid() } : null); } catch (e) { pv = e; }
ok("access for a wrong delivery id fails cleanly", !!pv);
ok("recordDownload is a no-op (counted server-side)", (await api.recordDownload(id)) === true);
const after = (await api.listDeliveries()).find(d => d.id === id);
ok("counters: 1 real view (preview w/ session skipped) + 1 download", after.lifetime_views === 1 && after.lifetime_downloads === 1, `${after.lifetime_views}/${after.lifetime_downloads}`);

console.log("\n[dashboard operations]");
const upd = await api.updateDelivery(id, { project_name: "Renamed", notes: "x" });
ok("updateDelivery returns delivery", upd.project_name === "Renamed" && upd.delivery_files.length === 2);
let noField = null; try { await api.updateDelivery(id, { hacker: 1 }); } catch (e) { noField = e; }
ok("updateDelivery rejects unknown fields client-side", !!noField);
const newId = await api.duplicateDelivery(upd);
ok("duplicateDelivery returns new id", /^BZ-[A-Z0-9]{8}$/.test(newId) && newId !== id);
const st = (await api.fetchStorageUsage());
ok("fetchStorageUsage shape (legacy + new)", st.usage.used_bytes === 220_000 && st.storage.limit_bytes === 5 * 1048576 && st.storage.level === "ok", JSON.stringify(st.usage));
const ov = await api.fetchOverview();
ok("overview: 2 active, lifetime views 1", ov.deliveries.active === 2 && ov.activity.lifetime.views === 1, JSON.stringify(ov.deliveries));
const ts = await api.fetchTimeseries("7d");
ok("timeseries 7 points + chart renders", ts.series.length === 7 && /<svg/.test(barChart(ts.series, "views")) && /<title>/.test(barChart(ts.series, "views")));
ok("top deliveries", (await api.fetchTopDeliveries()).top.length >= 1);
ok("per-delivery analytics 30 points", (await api.fetchDeliveryAnalytics(id)).series.length === 30);
const del = await api.deleteDelivery({ id: newId });
ok("deleteDelivery -> success", del.status === "success");
ok("storage released by delete", (await api.fetchStorageUsage()).usage.used_bytes === 110_000);

console.log("\n[storage guard through the client]");
const big = mkFile("big.zip", Object.assign(new Uint8Array(6 * 1048576), {}));
big.set([0x50, 0x4b, 3, 4]);
let se = null; try { await api.createDelivery({ id: rid(), source: "private", expires_at: new Date(Date.now() + 3600e3).toISOString() }, [big]); } catch (e) { se = e; }
ok("6 MiB into 5 MiB cap -> StorageLimitError before uploading", se instanceof StorageLimitError, String(se));
const used = (await api.fetchStorageUsage()).usage.used_bytes;
ok("blocked upload wrote nothing", used === 110_000, `used=${used}`);
// Server-side guard when the client pre-check is bypassed (e.g. stale numbers): reserve directly.
const raw = await fetch("http://localhost:8787/api/admin/uploads", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${JSON.parse(mem.get("boztik-deliver-session-v3")).token}` }, body: JSON.stringify({ delivery_id: rid(), file_name: "z.zip", file_size: 6 * 1048576 }) });
ok("worker enforces the same limit independently -> 507", raw.status === 507);

console.log("\n[cleanup failure path: PhotoshopBattles]");
const bid = rid();
const battle = await api.createDelivery({ id: bid, client_name: "PhotoshopBattles", project_name: "x", expires_at: new Date(Date.now() + 3600e3).toISOString(), source: "reddit", source_meta: { type: "photoshop_battles", direct_token: "a".repeat(32) } }, [mkFile("i.jpg", jpg(4000))]);
ok("battle created keeping client's direct token", battle.source_meta.direct_token === "a".repeat(32));
let zErr = null; try { await api.createDelivery({ id: rid(), source: "reddit", source_meta: { type: "photoshop_battles", direct_token: "b".repeat(32) }, expires_at: new Date(Date.now() + 3600e3).toISOString() }, [mkFile("x.zip", (() => { const b = new Uint8Array(100); b.set([0x50, 0x4b, 3, 4]); return b; })())]); } catch (e) { zErr = e; }
ok("battle with zip rejected with clear message", zErr && /JPG or PNG/.test(zErr.message), zErr?.message);
ok("failed create left no orphan bytes", (await api.fetchStorageUsage()).usage.used_bytes === 110_000 + 4000);

console.log("\n[expired session handling]");
mem.set("boztik-deliver-session-v3", JSON.stringify({ token: "x".repeat(43), email: "a", expires_at: new Date(Date.now() + 3600e3).toISOString() }));
let e401 = null; try { await api.listDeliveries(); } catch (e) { e401 = e; }
ok("401 clears the local session", e401 && (await getSession()) === null);
await signIn("admin@boztik.test", "TestPassw0rd!x"); await signOut();
ok("signOut clears session", (await getSession()) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
