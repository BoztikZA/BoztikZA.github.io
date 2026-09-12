import { AwsClient } from "aws4fetch";
import type { Env } from "../types";

function s3Client(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

function objectUrl(env: Env, key: string): URL {
  return new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${key}`,
  );
}

/** Presigned PUT — handed to the browser so it can upload a file directly
 *  to R2. The Worker never receives the file bytes. Deliberately does not
 *  sign Content-Type: R2 will store whatever content-type the browser
 *  sends, unvalidated against the signature — signing it is a well-known
 *  footgun that breaks real browser uploads (see Phase 3 build notes). */
export async function presignPutUrl(env: Env, key: string): Promise<string> {
  const ttl = env.UPLOAD_URL_TTL_SECONDS;
  const url = objectUrl(env, key);
  url.searchParams.set("X-Amz-Expires", ttl);
  const signed = await s3Client(env).sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Presigned GET — handed to the public client page for a download or
 *  preview. TTL is short and intent-specific (60s / 300s), matching the
 *  existing deliver-file Edge Function's TTLs exactly. */
export async function presignGetUrl(
  env: Env,
  key: string,
  ttlSeconds: number,
): Promise<string> {
  const url = objectUrl(env, key);
  url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
  const signed = await s3Client(env).sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Direct binding delete. Deleting an already-missing key is a no-op, not
 *  an error — this is what makes expiry/manual-delete cleanup idempotent,
 *  same principle as the current Supabase Storage API behaviour. */
export async function deleteObject(env: Env, key: string): Promise<void> {
  await env.BUCKET.delete(key);
}

/** Existence check used by the upload-finalize step — never trust the
 *  browser's claim that an upload succeeded without independently
 *  confirming the object is actually in R2. */
export async function objectExists(env: Env, key: string): Promise<boolean> {
  const head = await env.BUCKET.head(key);
  return head !== null;
}

/** Direct binding read, used only by the PhotoshopBattles stable
 *  reddit-embed route — that route intentionally streams bytes through
 *  the Worker rather than issuing a presigned URL, because Reddit needs a
 *  URL that stays valid indefinitely, not one pinned to a signature
 *  timestamp. Every other read path in this system uses presigned URLs. */
export async function getObjectBody(
  env: Env,
  key: string,
): Promise<{ body: ReadableStream; httpMetadata?: R2HTTPMetadata } | null> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return null;
  return { body: obj.body, httpMetadata: obj.httpMetadata };
}
