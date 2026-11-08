export function spotlightProfileSaveRequest(id, body) {
  const editing = Boolean(id);
  return {
    path: editing
      ? `/api/admin/spotlight/profile/${encodeURIComponent(id)}`
      : "/api/admin/spotlight/profile",
    init: {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  };
}

export const SPOTLIGHT_DESCRIPTION_MAX = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts a pasted domain ("example.com") and adds https:// so it passes URL validation. */
export function normaliseWebsiteUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : "https://" + text.replace(/^\/+/, "");
}

/**
 * Client-side pre-check that mirrors the Worker rules. Only business name, tagline,
 * category and About are required; website, email and every social link are optional.
 * Returns a human-readable message for the first problem, or "" when the draft is valid.
 */
export function validateSpotlightDraft(values) {
  const name = String(values.display_name ?? "").trim();
  const tagline = String(values.tagline ?? "").trim();
  const description = String(values.description ?? "").trim();
  const email = String(values.contact_email ?? "").trim();
  const website = String(values.website_url ?? "").trim();
  if (name.length < 2) return "Enter the business name (at least 2 characters).";
  if (tagline.length < 8) return "Enter a tagline (at least 8 characters).";
  if (!String(values.category ?? "").trim()) return "Choose a category.";
  if (description.length < 30) return `The About description needs at least 30 characters (currently ${description.length}).`;
  if (description.length > SPOTLIGHT_DESCRIPTION_MAX) return `The About description is too long (maximum ${SPOTLIGHT_DESCRIPTION_MAX.toLocaleString("en-US")} characters).`;
  if (email && !EMAIL_PATTERN.test(email)) return "Enter a valid contact email, or leave the field blank.";
  if (website) {
    let parsed = null;
    try { parsed = new URL(normaliseWebsiteUrl(website)); } catch { /* handled below */ }
    if (!parsed || parsed.protocol !== "https:") return "Enter a valid website address, for example yourwebsite.com.";
  }
  return "";
}

/** Publishing is only possible once the server has confirmed a saved draft (i.e. we hold a profile id). */
export function publishGateState(profileId, status = "pending") {
  if (!profileId) return { disabled: true, label: "Save draft to unlock publishing" };
  return { disabled: false, label: status === "published" ? "Apply live settings" : "Publish profile" };
}

/** Turns an API failure into a message that is safe and useful to show beside the form. */
export function describeSaveError(error) {
  if (error && error.status === 401) return "You are signed out or your session expired. Sign in again, then save the draft.";
  const message = error && typeof error.message === "string" && error.message.trim();
  if (!message) return "Could not save the draft. Check your connection and try again.";
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) {
    return "Could not reach the Boztik server. Check your connection and try again.";
  }
  return message;
}
