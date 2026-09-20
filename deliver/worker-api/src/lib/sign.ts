// Short-lived, capability-style signed URLs for file access. The Worker is the
// only party that can mint or verify them (HMAC key derived from a secret), so
// the browser never sees an R2 URL or credential.
import type { Env } from "../types";
import { bytesToHex, timingSafeEqual } from "./ids";

export type AccessMode = "d" | "p"; // download | preview

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`file-url-v1:${env.AUTH_TOKEN_SALT}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function mac(env: Env, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}

export async function signFileAccess(env: Env, mode: AccessMode, deliveryId: string, fileId: string, ttlSeconds: number) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await mac(env, `${mode}.${deliveryId}.${fileId}.${exp}`);
  return { exp, sig };
}

export async function verifyFileAccess(env: Env, mode: string, deliveryId: string, fileId: string, exp: string, sig: string): Promise<boolean> {
  if (mode !== "d" && mode !== "p") return false;
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqual(await mac(env, `${mode}.${deliveryId}.${fileId}.${expNum}`), sig);
}
