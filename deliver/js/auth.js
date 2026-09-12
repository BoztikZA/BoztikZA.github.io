// Cloudflare Access sits in front of this entire page (see Phase 2 §7) —
// by the time this script runs, the browser could not have reached
// dashboard.html at all without Access already approving the session.
// There is no client-side login form to wire up and no session to fetch;
// this file exists purely so dashboard.js's existing auth-gate logic
// (`getSession()` → show dashboard, `onAuthChange` → return to login if the
// session disappears) keeps working completely unmodified.
//
// dashboard.js never inspects the session object's contents — it only
// checks truthiness — so the placeholder shape below is sufficient.

const STATIC_SESSION = Object.freeze({ accessManaged: true });

export async function getSession() {
  return STATIC_SESSION;
}

export async function signIn() {
  // Unreachable in practice: Access gates the page before this file ever
  // loads, so the login form (#dash-login-view) stays hidden and its
  // submit handler has nothing to call this on. Kept as a safe no-op
  // rather than left undefined, in case that ever changes.
  throw new Error(
    "Sign-in is handled by Cloudflare Access, not this page. If you're seeing this, Access may not be configured correctly for this route.",
  );
}

function getAccessLogoutHost() {
  // Access's logout endpoint lives on your team domain, not on
  // deliver-api.boztik.com itself. Set this to match ACCESS_TEAM_DOMAIN
  // from the Worker's wrangler.toml.
  return "REPLACE_WITH_YOUR_TEAM_DOMAIN"; // e.g. "boztik.cloudflareaccess.com"
}

export async function signOut() {
  // Properly ends the Access session (clears the CF_Authorization cookie)
  // rather than leaving the "Sign Out" link as a dead button.
  window.location.href = "https://" + getAccessLogoutHost() + "/cdn-cgi/access/logout";
}

export function onAuthChange(_callback) {
  // No-op: there is no session lifecycle to observe client-side. If the
  // Access session actually expires, the next admin API call will fail
  // with 401 and Access will re-prompt on the next full page load — this
  // deliberately does not try to simulate Supabase's live session-change
  // events, since there's nothing analogous to listen to here.
  return { unsubscribe() {} };
}
