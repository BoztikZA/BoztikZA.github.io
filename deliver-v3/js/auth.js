// Worker-owned admin auth. The Worker verifies the password (PBKDF2) and issues
// an opaque, server-revocable session token. No Supabase, no Cloudflare Access.
import { config } from "./config.js";

const KEY = "boztik-deliver-session-v3";
const listeners = new Set();

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!s?.token || !s.expires_at || Date.parse(s.expires_at) <= Date.now()) return null;
    return s;
  } catch { return null; }
}
function notify() { const s = read(); listeners.forEach(cb => { try { cb(s); } catch (e) { console.error(e); } }); }

export const authToken = () => read()?.token || null;
export const authHeaders = () => (authToken() ? { Authorization: `Bearer ${authToken()}` } : {});

/** Drops the local session (used on sign-out and whenever the Worker says 401). */
export function clearLocalSession() { localStorage.removeItem(KEY); notify(); }

export async function getSession() {
  const s = read();
  if (!s) { localStorage.removeItem(KEY); return null; }
  return { ...s, user: { email: s.email } };
}

export async function signIn(email, password) {
  let response;
  try {
    response = await fetch(`${config.apiBaseUrl}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: String(email || "").trim(), password })
    });
  } catch { throw new Error("Could not reach the Boztik Deliver server. Check your connection and try again."); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.token) {
    throw new Error(response.status === 429
      ? "Too many failed attempts. Please wait a few minutes and try again."
      : data?.error || "Sign-in failed.");
  }
  localStorage.setItem(KEY, JSON.stringify({ token: data.token, email: data.user?.email || email, expires_at: data.expires_at }));
  notify();
  return getSession();
}

export async function signOut() {
  const headers = authHeaders();
  localStorage.removeItem(KEY);
  try { await fetch(`${config.apiBaseUrl}/api/auth/logout`, { method: "POST", headers }); } catch { /* server session expires on its own */ }
  notify();
}

export function onAuthChange(callback) {
  listeners.add(callback);
  // Sign-in/out in another tab.
  const onStorage = event => { if (event.key === KEY) callback(read()); };
  window.addEventListener("storage", onStorage);
  return { data: { subscription: { unsubscribe() { listeners.delete(callback); window.removeEventListener("storage", onStorage); } } } };
}
