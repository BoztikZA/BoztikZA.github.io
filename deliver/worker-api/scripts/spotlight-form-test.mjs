// Unit tests for the Command Centre Spotlight form logic shared with the browser
// (deliver-v3/js/spotlight-profile-request.mjs). No DOM needed: the logic is pure.
import assert from "node:assert/strict";
import {
  normaliseWebsiteUrl, validateSpotlightDraft, publishGateState, describeSaveError, spotlightProfileSaveRequest,
} from "../../../deliver-v3/js/spotlight-profile-request.mjs";

const valid = (overrides = {}) => ({
  display_name: "Boztik Test Studio",
  tagline: "Photo restoration done properly",
  category: "small-business",
  description: "We restore and enhance old family photographs for clients across South Africa.",
  website_url: "www.example.com",
  contact_email: "",
  ...overrides,
});

console.log("Website URLs get https:// automatically");
assert.equal(normaliseWebsiteUrl("example.com"), "https://example.com");
assert.equal(normaliseWebsiteUrl("  www.example.com/path "), "https://www.example.com/path");
assert.equal(normaliseWebsiteUrl("//example.com"), "https://example.com");
assert.equal(normaliseWebsiteUrl("https://example.com"), "https://example.com");
assert.equal(normaliseWebsiteUrl(""), "");
assert.equal(normaliseWebsiteUrl(undefined), "");

console.log("A profile with only the business details and website is valid");
assert.equal(validateSpotlightDraft(valid()), "");
assert.equal(validateSpotlightDraft(valid({ website_url: "" })), "", "website is optional too");
assert.equal(validateSpotlightDraft(valid({ contact_email: "", social_links: {} })), "", "no email, no socials");
assert.equal(validateSpotlightDraft(valid({ contact_email: "hello@example.com" })), "");

console.log("Validation errors are clear and specific");
assert.match(validateSpotlightDraft(valid({ display_name: " " })), /business name/i);
assert.match(validateSpotlightDraft(valid({ tagline: "short" })), /tagline/i);
assert.match(validateSpotlightDraft(valid({ category: "" })), /category/i);
assert.match(validateSpotlightDraft(valid({ description: "too short" })), /About description.*30 characters/i);
assert.match(validateSpotlightDraft(valid({ contact_email: "not-an-email" })), /valid contact email/i);
assert.match(validateSpotlightDraft(valid({ website_url: "http://example.com" })), /website/i, "http:// is not accepted");
assert.match(validateSpotlightDraft(valid({ website_url: "https://exa mple.com" })), /website/i);

console.log("A description near 5,000 characters validates instantly; over 5,000 is rejected");
{
  const near = "Restoration and enhancement for treasured photographs. ".repeat(100).slice(0, 4990);
  const started = performance.now();
  assert.equal(validateSpotlightDraft(valid({ description: near })), "");
  assert.equal(validateSpotlightDraft(valid({ description: "a".repeat(5000) })), "");
  assert.match(validateSpotlightDraft(valid({ description: "a".repeat(5001) })), /too long/i);
  assert.ok(performance.now() - started < 100, "validation must not be slow");
}

console.log("Publish is locked until the server confirms a saved draft");
{
  const before = publishGateState("");
  assert.equal(before.disabled, true);
  assert.match(before.label, /Save draft/);
  assert.equal(publishGateState(undefined).disabled, true);
  const after = publishGateState("abc123def456ghi789jk");
  assert.equal(after.disabled, false);
  assert.equal(after.label, "Publish profile");
  assert.equal(publishGateState("abc", "published").label, "Apply live settings");
}

console.log("A new draft is POSTed once; a saved draft is edited with PATCH, never re-created");
assert.equal(spotlightProfileSaveRequest("", valid()).init.method, "POST");
assert.equal(spotlightProfileSaveRequest("abc123", valid()).init.method, "PATCH");

console.log("API failures become visible, safe messages");
assert.match(describeSaveError(Object.assign(new Error("Authentication required"), { status: 401 })), /signed out|session/i);
assert.match(describeSaveError(new TypeError("Failed to fetch")), /Could not reach the Boztik server/);
assert.equal(describeSaveError(new Error("Enter a valid contact email, or leave the field blank.")), "Enter a valid contact email, or leave the field blank.");
assert.equal(describeSaveError(new Error("Internal server error")), "Internal server error");
assert.match(describeSaveError(new Error("")), /Could not save the draft/);
assert.match(describeSaveError(undefined), /Could not save the draft/);

console.log("All Spotlight form logic tests passed.");
