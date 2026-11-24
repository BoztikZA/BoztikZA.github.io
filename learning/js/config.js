// Boztik Learning — front-end configuration. The API is the existing Boztik Worker (same host as the Command Centre).
export const API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:8787" : "https://deliver-api.boztik.com";
export const SITE_ORIGIN = "https://www.boztik.com";
