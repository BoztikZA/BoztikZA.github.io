import { config } from "./config.js";

let client;
export function supabase() {
  if (!client) {
    if (!window.supabase?.createClient) throw new Error("Supabase could not be loaded. Check your connection and reload.");
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "boztik-deliver-auth-v2" }
    });
  }
  return client;
}
export const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"}[c]));
export const formatBytes = bytes => !bytes ? "0 B" : `${(bytes / 1024 ** Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)))).toFixed(bytes < 1024 ? 0 : 1)} ${["B","KB","MB","GB"][Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)))]}`;
export const formatDate = value => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export function countdown(value) { const ms = new Date(value) - Date.now(); if (ms <= 0) return { expired: true, label: "Expired" }; const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000); return { expired: false, label: h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h remaining` : `${h}h ${m}m remaining` }; }
export function deliveryId() { const values = crypto.getRandomValues(new Uint8Array(8)); return `BZ-${[...values].map(v => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[v % 32]).join("")}`; }
export const deliveryLink = id => `${config.publicBaseUrl}?id=${encodeURIComponent(id)}`;
export function toast(message, kind = "success") { let host = document.querySelector("#deliver-toast-container"); if (!host) { host = document.createElement("div"); host.id = "deliver-toast-container"; host.setAttribute("aria-live", "polite"); document.body.append(host); } const el = document.createElement("div"); el.className = `deliver-toast deliver-toast--${kind}`; el.textContent = message; host.append(el); requestAnimationFrame(() => el.classList.add("is-visible")); setTimeout(() => { el.classList.remove("is-visible"); setTimeout(() => el.remove(), 300); }, 4200); }
export function safeFileName(name) { return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120); }
export function isValidFile(file) { const extension = file.name.split(".").pop()?.toLowerCase(); return file && config.allowedExtensions.includes(extension) && file.size > 0 && file.size <= config.maxUploadBytes; }
