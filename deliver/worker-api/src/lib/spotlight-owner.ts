/**
 * Private applicant access to a Spotlight application ("owner link").
 *
 * The owner link is a capability: whoever holds the secret token can see that one application's status and reply
 * to information requests. Properties:
 *  - 256 bits from crypto.getRandomValues, base64url (43 chars). Not guessable.
 *  - Only the SHA-256 hash is stored, so a database read never yields a usable link.
 *  - The token is only ever sent in a POST body or held in the page's URL fragment, never in a path or query
 *    string that reaches logs or Referer headers.
 *  - It grants access to exactly one profile and exposes no admin-only data.
 */

export const SPOTLIGHT_TERMS_VERSION = "2026-11";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newOwnerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isOwnerToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export async function hashOwnerToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export type OwnerStage = "received" | "in_review" | "info_needed" | "approved" | "live" | "declined" | "expired";

/** True while the team is waiting for the applicant to answer an information request. */
export function awaitingApplicant(row: { info_requested_at?: unknown; info_responded_at?: unknown }): boolean {
  const requested = Number(row.info_requested_at || 0);
  return requested > 0 && Number(row.info_responded_at || 0) < requested;
}

export function ownerStage(row: any): OwnerStage {
  if (row.status === "published" && row.application_status !== "declined" && row.application_status !== "expired") return "live";
  switch (row.application_status) {
    case "declined": return "declined";
    case "expired": return "expired";
    case "approved":
    case "published": return "approved";
    case "under_review": return awaitingApplicant(row) ? "info_needed" : "in_review";
    default: return "received";
  }
}

/** What the applicant may see. Deliberately excludes the contact email, review_unread, admin notes and ids. */
export function ownerDto(row: any, nowSeconds: number) {
  const stage = ownerStage(row);
  return {
    display_name: row.display_name,
    stage,
    submitted_at: row.created_at,
    reviewed_at: row.reviewed_at ?? null,
    review_expires_at: stage === "received" || stage === "in_review" || stage === "info_needed" ? row.review_expires_at ?? null : null,
    listing_expires_at: stage === "live" ? row.listing_expires_at ?? null : null,
    featured_until: stage === "live" && Number(row.featured_until || 0) > nowSeconds ? row.featured_until : null,
    public_url: stage === "live" ? "https://www.boztik.com/spotlight/profile.html?slug=" + encodeURIComponent(row.slug) : null,
    decline_reason: stage === "declined" ? row.decline_reason ?? null : null,
    info_request: stage === "info_needed" || (row.info_requested_at && stage !== "declined")
      ? {
        note: row.info_request_note ?? null,
        requested_at: row.info_requested_at ?? null,
        awaiting_reply: awaitingApplicant(row),
        reply: row.info_response_note ?? null,
        replied_at: row.info_responded_at ?? null,
      }
      : null,
  };
}
