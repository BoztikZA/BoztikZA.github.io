// Local preview of the whole Learning Hub with NO production access:
//   static site  → http://localhost:8080   (repo root)
//   Worker API   → http://localhost:8787   (real Worker code on an in-memory SQLite database built from the real migrations)
// Data is lost on exit. Usage: npm run learning:dev
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index.ts";
import { SqliteD1 } from "./lib/sqlite-d1.mts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../../..");
const SITE = "http://localhost:8080";
export const db = new SqliteD1();
const env: any = {
  DB: db, BUCKET: {}, PUBLIC_ORIGIN: SITE, ALLOWED_ORIGINS: SITE, STORAGE_LIMIT_BYTES: "0", MAX_UPLOAD_BYTES: "0", MAX_FILES_PER_DELIVERY: "0",
  SESSION_HOURS: "12", DEFAULT_EXPIRY_HOURS: "24", ABANDONED_UPLOAD_GRACE_HOURS: "1", RATE_LIMIT_PUBLIC_PER_MINUTE: "100000",
  LOGIN_MAX_FAILURES: "8", PAGE_ANALYTICS_ALLOWED: "", ADMIN_USERNAME: "a", ADMIN_PASSWORD_HASH: "x", AUTH_TOKEN_SALT: "dev-only-salt",
  LEARNING_SITE_ORIGIN: SITE,
};
const ctx: any = { waitUntil() {}, passThroughOnException() {} };
const TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".csv": "text/csv", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon" };

export function start(api = 8787, site = 8080) {
  const apiServer = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(`http://localhost:${api}${req.url}`, { method: req.method, headers: req.headers as any, body: ["GET", "HEAD"].includes(req.method!) ? undefined : body }), env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(api);
  const siteServer = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent((req.url || "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
    let file = join(ROOT, p);
    try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); } catch { /* fall through */ }
    try { const data = await readFile(file); res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }); res.end(data); }
    catch { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); }
  }).listen(site);
  return { close: () => { apiServer.close(); siteServer.close(); } };
}
if (process.argv[1] && process.argv[1].endsWith("learning-devserver.mts")) { start(); console.log("Learning Hub preview: http://localhost:8080/learning/  (API on :8787, in-memory data)"); }
