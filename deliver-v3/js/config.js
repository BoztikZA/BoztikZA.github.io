// Boztik Deliver (Cloudflare edition). No Supabase, no third-party keys:
// everything goes through the Boztik Deliver Worker, which owns auth, R2 and D1.
const host = typeof location !== "undefined" ? location.hostname : "";
const isLocal = host === "localhost" || host === "127.0.0.1";

export const config = Object.freeze({
  // Worker origin. Local dev talks to `wrangler dev` (default port 8787).
  // Deliberately NOT overridable from the URL: a crafted link must never be able
  // to point the login form at another server.
  apiBaseUrl: isLocal ? "http://localhost:8787" : "https://deliver-api.boztik.com",

  // Public delivery links are built from the directory this page is served from,
  // so they stay correct when this folder is later renamed to /deliver/.
  publicBaseUrl: typeof location !== "undefined" ? new URL("./", location.href).href : "https://www.boztik.com/deliver/",

  defaultExpiryHours: 24,
  // Must match the Worker's MAX_UPLOAD_BYTES (the Worker is authoritative).
  maxUploadBytes: 90 * 1024 * 1024,
  allowedExtensions: ["zip", "jpg", "jpeg", "png", "psd", "tif", "tiff", "webp", "pdf", "ai", "eps"],
  paypalUrl: "https://paypal.me/angry5p1c3",

  // Storage panel + floating monitor. The 3 GB cap is enforced by the Worker; this
  // number only drives the instant, friendly pre-check and the gauge labels.
  storagePlanBytes: 3 * 1024 * 1024 * 1024,
  storagePlanName: "hard cap",
  storageSafetyLimitBytes: null,
  storageMonitorRefreshMs: 60 * 1000,
  // Thresholds requested for the Command Centre: 70 / 85 / 95 / 100 %.
  storageWarningLevels: Object.freeze([
    { minPercent: 100, key: "over_quota", label: "Full — uploads locked" },
    { minPercent: 95, key: "critical", label: "Critical" },
    { minPercent: 85, key: "warning", label: "Warning" },
    { minPercent: 70, key: "notice", label: "Notice" },
    { minPercent: 0, key: "healthy", label: "Healthy" }
  ])
});
