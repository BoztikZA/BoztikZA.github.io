// Boztik Learning — optional support helpers (pure: no DOM, no network, no imports, so they run unchanged under Node tests).
//
// Two clearly different things exist and must never be confused:
//  * PayPal.Me redirect  — the learner is sent to paypal.me. Boztik cannot see whether they paid, so nothing here ever
//                          reports a payment as received.
//  * Server-verified PayPal Orders — handled by the Worker and confirmed only by PayPal's signed webhook (see exam.js).
// Neither affects results or certificates.

export const PAYPAL_ME_USER = "angry5p1c3";
export const PAYPAL_ME_BASE = `https://paypal.me/${PAYPAL_ME_USER}`;

// PayPal.Me accepts small amounts; the upper bound matches the Worker's own maximum so both paths agree.
export const REDIRECT_LIMITS = Object.freeze({ minCents: 100, maxCents: 50_000 });

export const SUPPORT_TIERS = Object.freeze([
  Object.freeze({ cents: 200, label: "Small contribution" }),
  Object.freeze({ cents: 500, label: "Supporter" }),
  Object.freeze({ cents: 1000, label: "Learning advocate" }),
  Object.freeze({ cents: 2000, label: "Generous supporter" }),
]);

export const formatUsd = (cents) => `$${Math.floor(cents / 100)}${cents % 100 ? `.${String(cents % 100).padStart(2, "0")}` : ""}`;

/**
 * Parse a learner-typed amount (dollars) into whole cents, or explain why not.
 * Only plain decimals are accepted: no signs, exponents, separators, spaces inside, or more than two decimals.
 * Integer maths on the digit strings avoids floating-point drift (e.g. 19.99 * 100).
 */
export function parseAmount(input, { minCents, maxCents }) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return { ok: false, message: "Enter an amount, or choose one of the options above." };
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return { ok: false, message: "Use digits only, with at most two decimal places (for example 7.50)." };
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (cents === 0) return { ok: false, message: "Enter an amount greater than zero." };
  if (cents < minCents) return { ok: false, message: `The minimum is ${formatUsd(minCents)}.` };
  if (cents > maxCents) return { ok: false, message: `The maximum is ${formatUsd(maxCents)}.` };
  return { ok: true, cents };
}

/**
 * Build the PayPal.Me URL from a validated integer number of cents ONLY.
 * The host and username are constants; the amount is re-validated here so no caller can smuggle text into the URL.
 */
export function buildPayPalMeUrl(cents, limits = REDIRECT_LIMITS) {
  if (!Number.isSafeInteger(cents) || cents < limits.minCents || cents > limits.maxCents) throw new RangeError("Invalid contribution amount.");
  const amount = cents % 100 ? `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}` : String(cents / 100);
  return `${PAYPAL_ME_BASE}/${amount}USD`;
}

/** True only for the confirmed Boztik PayPal.Me destination (used as a belt-and-braces check before navigating). */
export const isBoztikPayPalMeUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "paypal.me" && !u.username && !u.password && !u.search && !u.hash
      && new RegExp(`^/${PAYPAL_ME_USER}(?:/\\d{1,6}(?:\\.\\d{2})?USD)?$`).test(u.pathname);
  } catch { return false; }
};

/** Per-course "Maybe later" key: dismissing one course's panel never affects another course. */
export const dismissKey = (courseSlug) => `bzl.support.dismissed.${String(courseSlug || "").replace(/[^a-z0-9-]/gi, "").slice(0, 64) || "unknown"}`;
