// Boztik Learning Hub — optional PayPal contributions.
//
// Safety properties (do not weaken):
//  * OFF unless LEARNING_CONTRIBUTIONS_ENABLED="1" AND PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID are all set.
//  * PAYPAL_ENV defaults to "sandbox". Live must be chosen explicitly. Nothing here ever fakes a confirmation.
//  * Checkout is PayPal-hosted: the learner is redirected to PayPal. We never see or store card details.
//  * A browser redirect is NEVER proof of payment. A contribution becomes "completed" only from a PayPal webhook whose
//    signature PayPal itself verified (verify-webhook-signature), and whose amount/currency match the order we created.
//  * Webhook handling is idempotent (event id is recorded) and safe to retry.
//  * Contributions never gate results or certificates; nothing in the learner flow reads this table.
import type { Env } from "../types";
import { HttpError } from "../types";
import { MAX_CONTRIBUTION_CENTS, MIN_CONTRIBUTION_CENTS, PRESET_CONTRIBUTIONS_CENTS, getCourse, newRowId, nowSec, type Learner } from "./core";
import { siteOrigin } from "./certificates";

export interface PaypalConfig { enabled: boolean; env: "sandbox" | "live"; base: string; missing: string[] }

export function paypalConfig(env: Env): PaypalConfig {
  const mode = env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  const missing: string[] = [];
  if (!env.PAYPAL_CLIENT_ID) missing.push("PAYPAL_CLIENT_ID");
  if (!env.PAYPAL_CLIENT_SECRET) missing.push("PAYPAL_CLIENT_SECRET");
  if (!env.PAYPAL_WEBHOOK_ID) missing.push("PAYPAL_WEBHOOK_ID");
  if (env.LEARNING_CONTRIBUTIONS_ENABLED !== "1") missing.push("LEARNING_CONTRIBUTIONS_ENABLED=1");
  return { enabled: missing.length === 0, env: mode, base: mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com", missing };
}

export function publicContributionConfig(env: Env): { enabled: boolean; currency: "USD"; presetsCents: readonly number[]; minCents: number; maxCents: number } {
  return { enabled: paypalConfig(env).enabled, currency: "USD", presetsCents: PRESET_CONTRIBUTIONS_CENTS, minCents: MIN_CONTRIBUTION_CENTS, maxCents: MAX_CONTRIBUTION_CENTS };
}

let tokenCache: { key: string; token: string; exp: number } | null = null;

async function accessToken(env: Env, cfg: PaypalConfig): Promise<string> {
  const key = `${cfg.env}:${env.PAYPAL_CLIENT_ID}`;
  if (tokenCache && tokenCache.key === key && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`${cfg.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) { console.error("paypal token failed", res.status); throw new HttpError(502, "paypal_unavailable", "PayPal is not available right now. You can skip this step; your certificate is not affected."); }
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new HttpError(502, "paypal_unavailable", "PayPal is not available right now.");
  tokenCache = { key, token: j.access_token, exp: Date.now() + (j.expires_in ?? 300) * 1000 };
  return j.access_token;
}

const centsToValue = (c: number): string => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

export function parseAmountCents(input: unknown): number {
  // Accepts whole-cent integers only (the client sends cents). 500 ≤ n ≤ 50 000.
  if (typeof input !== "number" || !Number.isInteger(input)) throw new HttpError(400, "invalid_amount", "Enter an amount in whole cents.");
  if (input < MIN_CONTRIBUTION_CENTS) throw new HttpError(400, "amount_too_small", "The minimum contribution is $5.");
  if (input > MAX_CONTRIBUTION_CENTS) throw new HttpError(400, "amount_too_large", "The maximum contribution is $500.");
  return input;
}

const PAYPAL_HOSTS = new Set(["www.paypal.com", "www.sandbox.paypal.com"]);

export async function createContribution(env: Env, learner: Learner, body: { amountCents?: unknown; courseSlug?: unknown }): Promise<{ contributionId: string; approveUrl: string }> {
  const cfg = paypalConfig(env);
  if (!cfg.enabled) throw new HttpError(503, "contributions_unavailable", "Contributions are not switched on yet. Thank you for the thought — your certificate does not depend on this.");
  const amount = parseAmountCents(body.amountCents);
  const slug = body.courseSlug == null ? null : getCourse(body.courseSlug).slug;
  const id = newRowId();
  const origin = siteOrigin(env);
  const token = await accessToken(env, cfg);
  const res = await fetch(`${cfg.base}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": `bzl-create-${id}` },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ custom_id: id, description: "Boztik Learning — voluntary contribution", amount: { currency_code: "USD", value: centsToValue(amount) } }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Boztik Learning", user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", landing_page: "LOGIN",
            return_url: `${origin}/learning/thanks/?c=${id}`, cancel_url: `${origin}/learning/thanks/?c=${id}&cancelled=1`,
          },
        },
      },
    }),
  });
  if (!res.ok) { console.error("paypal create order failed", res.status); throw new HttpError(502, "paypal_unavailable", "PayPal could not start the checkout. You can skip this step; your certificate is not affected."); }
  const order = (await res.json()) as { id?: string; links?: { rel: string; href: string }[] };
  const link = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  let host = "";
  try { host = new URL(link ?? "").hostname; } catch { /* handled below */ }
  if (!order.id || !link || !PAYPAL_HOSTS.has(host)) { console.error("paypal order response unexpected"); throw new HttpError(502, "paypal_unavailable", "PayPal returned an unexpected response."); }
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO learning_contributions (id, learner_id, course_slug, amount_cents, currency, paypal_order_id, paypal_env, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'USD', ?5, ?6, 'created', ?7, ?7)`,
  ).bind(id, learner.id, slug, amount, order.id, cfg.env, now).run();
  return { contributionId: id, approveUrl: link };
}

/** What the learner's "thank you" page may show. It reflects only what the webhook recorded. */
export async function contributionStatus(env: Env, learner: Learner, id: string): Promise<{ status: string; amountCents: number }> {
  if (!/^[a-z0-9]{16}$/.test(id)) throw new HttpError(404, "contribution_not_found", "Contribution not found.");
  const row = await env.DB.prepare("SELECT status, amount_cents FROM learning_contributions WHERE id = ? AND learner_id = ?").bind(id, learner.id).first<{ status: string; amount_cents: number }>();
  if (!row) throw new HttpError(404, "contribution_not_found", "Contribution not found.");
  return { status: row.status, amountCents: row.amount_cents };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
interface WebhookEvent {
  id?: string; event_type?: string;
  resource?: {
    id?: string; custom_id?: string; status?: string; amount?: { value?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
    purchase_units?: { custom_id?: string; amount?: { value?: string; currency_code?: string } }[];
  };
}

async function verifySignature(env: Env, cfg: PaypalConfig, request: Request, rawBody: string): Promise<boolean> {
  const h = (n: string) => request.headers.get(n) || "";
  const parts = { algo: h("paypal-auth-algo"), certUrl: h("paypal-cert-url"), id: h("paypal-transmission-id"), sig: h("paypal-transmission-sig"), time: h("paypal-transmission-time") };
  if (!parts.algo || !parts.certUrl || !parts.id || !parts.sig || !parts.time) return false;
  const token = await accessToken(env, cfg);
  // webhook_event must be the exact bytes PayPal signed, so the raw body is spliced in rather than re-serialised.
  const body = `{"auth_algo":${JSON.stringify(parts.algo)},"cert_url":${JSON.stringify(parts.certUrl)},"transmission_id":${JSON.stringify(parts.id)},"transmission_sig":${JSON.stringify(parts.sig)},"transmission_time":${JSON.stringify(parts.time)},"webhook_id":${JSON.stringify(env.PAYPAL_WEBHOOK_ID)},"webhook_event":${rawBody}}`;
  const res = await fetch(`${cfg.base}/v1/notifications/verify-webhook-signature`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body,
  });
  if (!res.ok) { console.error("paypal verify call failed", res.status); throw new HttpError(502, "paypal_unavailable", "Could not verify the webhook."); }
  return ((await res.json()) as { verification_status?: string }).verification_status === "SUCCESS";
}

export async function handlePaypalWebhook(env: Env, request: Request): Promise<{ handled: boolean; reason?: string }> {
  const cfg = paypalConfig(env);
  if (!cfg.enabled) throw new HttpError(503, "contributions_unavailable", "Contributions are not enabled.");
  const raw = await request.text();
  if (raw.length > 256 * 1024) throw new HttpError(413, "body_too_large", "Too large.");
  let event: WebhookEvent;
  try { event = JSON.parse(raw) as WebhookEvent; } catch { throw new HttpError(400, "invalid_json", "Invalid JSON."); }
  if (!event || typeof event !== "object" || !event.id || !event.event_type) throw new HttpError(400, "invalid_event", "Invalid event.");

  // Reject anything PayPal did not sign. (Unsigned/forged calls get a 401, never a state change.)
  if (!(await verifySignature(env, cfg, request, raw))) throw new HttpError(401, "invalid_signature", "Signature verification failed.");

  // Idempotency: record the event id first; a duplicate delivery is acknowledged without re-processing.
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO learning_webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)").bind(event.id, event.event_type, nowSec()).run();
  if (ins.meta?.changes === 0) return { handled: false, reason: "duplicate" };
  try {
    return await applyEvent(env, cfg, event);
  } catch (e) {
    // Let PayPal retry: forget the event id so the retry is processed.
    await env.DB.prepare("DELETE FROM learning_webhook_events WHERE event_id = ?").bind(event.id).run();
    throw e;
  }
}

async function findContribution(env: Env, orderId: string | undefined, customId: string | undefined) {
  const row = orderId
    ? await env.DB.prepare("SELECT id, amount_cents, currency, status, paypal_order_id FROM learning_contributions WHERE paypal_order_id = ?").bind(orderId).first<{ id: string; amount_cents: number; currency: string; status: string; paypal_order_id: string }>()
    : null;
  if (row) return row;
  if (customId && /^[a-z0-9]{16}$/.test(customId)) {
    return env.DB.prepare("SELECT id, amount_cents, currency, status, paypal_order_id FROM learning_contributions WHERE id = ?").bind(customId).first<{ id: string; amount_cents: number; currency: string; status: string; paypal_order_id: string }>();
  }
  return null;
}

async function applyEvent(env: Env, cfg: PaypalConfig, event: WebhookEvent): Promise<{ handled: boolean; reason?: string }> {
  const r = event.resource ?? {};
  const now = nowSec();
  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      const c = await findContribution(env, r.id, r.purchase_units?.[0]?.custom_id);
      if (!c) return { handled: false, reason: "unknown_order" };
      if (c.status === "created") await env.DB.prepare("UPDATE learning_contributions SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'created'").bind(now, c.id).run();
      // The buyer has approved; ask PayPal to capture. The money is only "completed" when PAYMENT.CAPTURE.COMPLETED arrives.
      const token = await accessToken(env, cfg);
      const res = await fetch(`${cfg.base}/v2/checkout/orders/${encodeURIComponent(c.paypal_order_id)}/capture`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": `bzl-capture-${c.id}` }, body: "{}",
      });
      // 422 ORDER_ALREADY_CAPTURED is fine; anything else non-2xx → retry later.
      if (!res.ok && res.status !== 422) throw new HttpError(502, "paypal_unavailable", "Capture failed; will retry.");
      return { handled: true };
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      const c = await findContribution(env, r.supplementary_data?.related_ids?.order_id, r.custom_id);
      if (!c) return { handled: false, reason: "unknown_order" };
      const paid = r.amount?.value, cur = r.amount?.currency_code;
      if (cur !== c.currency || paid !== centsToValue(c.amount_cents)) {
        console.error("paypal amount mismatch", c.id);
        await env.DB.prepare("UPDATE learning_contributions SET status = 'failed', updated_at = ? WHERE id = ? AND status IN ('created','approved')").bind(now, c.id).run();
        return { handled: true, reason: "amount_mismatch" };
      }
      await env.DB.prepare("UPDATE learning_contributions SET status = 'completed', completed_at = ?1, updated_at = ?1 WHERE id = ?2 AND status IN ('created','approved')").bind(now, c.id).run();
      return { handled: true };
    }
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      const c = await findContribution(env, r.supplementary_data?.related_ids?.order_id, r.custom_id);
      if (!c) return { handled: false, reason: "unknown_order" };
      await env.DB.prepare("UPDATE learning_contributions SET status = 'failed', updated_at = ? WHERE id = ? AND status IN ('created','approved')").bind(now, c.id).run();
      return { handled: true };
    }
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      const c = await findContribution(env, r.supplementary_data?.related_ids?.order_id, r.custom_id);
      if (!c) return { handled: false, reason: "unknown_order" };
      await env.DB.prepare("UPDATE learning_contributions SET status = 'refunded', updated_at = ? WHERE id = ? AND status = 'completed'").bind(now, c.id).run();
      return { handled: true };
    }
    default:
      return { handled: false, reason: "ignored_event_type" };
  }
}
