import type { Env } from "../types";
import { R2_PREFIX } from "./ids";

/** The Worker is the ONLY reader/writer of R2. */

export interface ListedObject { key: string; size: number; uploaded: number }

/** Every object in the bucket. Throws if R2 is unreachable (callers fail closed). */
export async function listAllObjects(env: Env, prefix?: string): Promise<ListedObject[]> {
  const out: ListedObject[] = [];
  let cursor: string | undefined;
  for (;;) {
    const listed = await env.BUCKET.list({ limit: 1000, cursor, prefix });
    for (const o of listed.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded.getTime() });
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return out;
}

export async function sumR2Bytes(env: Env): Promise<{ bytes: number; objects: number }> {
  const all = await listAllObjects(env);
  return { bytes: all.reduce((s, o) => s + o.size, 0), objects: all.length };
}

/** Keys must be server-generated under deliveries/. Defence in depth. */
export function assertSafeKey(key: string): void {
  if (!key.startsWith(R2_PREFIX) || key.includes("..") || key.includes("\\") || key.length > 400 || /[\u0000-\u001f]/.test(key)) {
    throw new Error("unsafe object key");
  }
}

/** Deleting an already-missing key is a no-op (R2 delete is idempotent). */
export async function deleteObject(env: Env, key: string): Promise<void> {
  assertSafeKey(key);
  await env.BUCKET.delete(key);
}

export async function headObject(env: Env, key: string): Promise<{ size: number } | null> {
  assertSafeKey(key);
  const h = await env.BUCKET.head(key);
  return h ? { size: h.size } : null;
}

/** First bytes of an object (for magic-number validation). */
export async function readHead(env: Env, key: string, length = 1024): Promise<Uint8Array | null> {
  assertSafeKey(key);
  const obj = await env.BUCKET.get(key, { range: { offset: 0, length } });
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}
