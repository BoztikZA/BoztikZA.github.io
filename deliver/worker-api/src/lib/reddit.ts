// Server-side Reddit thread lookup for the Command Centre "Fetch details" button
// (port of the old Supabase reddit-metadata function). Admin-only, best effort:
// callers treat any error as "auto-fill unavailable" and may still save the raw
// link. SSRF-safe: only https reddit hosts are ever contacted, including every
// redirect hop, and the oEmbed endpoint is a fixed URL.
import { HttpError } from "../types";
import { isRedditHost } from "./validate";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const COMMENTS_RE = /\/r\/([A-Za-z0-9_]{1,50})\/comments\/([A-Za-z0-9]+)/i;

function assertRedditHttps(url: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new HttpError(400, "invalid_url", "Please paste a valid Reddit URL."); }
  if (u.protocol !== "https:" || !isRedditHost(u.hostname) || u.username || u.password) {
    throw new HttpError(400, "not_reddit", "That doesn't look like a Reddit link.");
  }
  return u;
}

async function resolveRedirects(start: URL, signal: AbortSignal): Promise<URL> {
  let current = start;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current.toString(), { method: "GET", redirect: "manual", signal, headers: { "User-Agent": USER_AGENT } });
    await res.body?.cancel();
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, current); // may be relative
      if (next.protocol !== "https:" || !isRedditHost(next.hostname)) {
        throw new HttpError(502, "redirect_blocked", "That link redirects somewhere other than Reddit.");
      }
      current = next;
      continue;
    }
    break;
  }
  return current;
}

export interface RedditMeta { title: string; subreddit: string | null; author: string | null; canonicalUrl: string; redditUrl: string }

export async function fetchRedditMetadata(rawUrl: string): Promise<RedditMeta> {
  const start = assertRedditHttps(rawUrl.trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let resolved: URL;
    try {
      resolved = await resolveRedirects(start, controller.signal);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const timedOut = (e as Error)?.name === "AbortError";
      throw new HttpError(502, timedOut ? "timeout" : "redirect_failed", timedOut ? "Reddit took too long to respond while resolving that link." : "Could not resolve that Reddit link.");
    }

    const clean = new URL(resolved.toString());
    clean.search = "";
    clean.hash = "";
    let res: Response;
    try {
      res = await fetch(`https://www.reddit.com/oembed?url=${encodeURIComponent(clean.toString())}`, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
    } catch (e) {
      const timedOut = (e as Error)?.name === "AbortError";
      throw new HttpError(502, timedOut ? "timeout" : "fetch_failed", timedOut ? "Reddit took too long to respond." : "Could not reach Reddit.");
    }
    if (res.status === 429) throw new HttpError(429, "rate_limited", "Reddit is rate-limiting requests right now. Try again in a moment.");
    if (res.status === 403) throw new HttpError(502, "forbidden", "Reddit blocked this request (HTTP 403) — its bot protection. Save the raw link without metadata, or try again later.");
    if (!res.ok) throw new HttpError(502, "reddit_unavailable", `Reddit returned HTTP ${res.status}.`);

    let oembed: { title?: unknown; author_name?: unknown; url?: unknown };
    try { oembed = await res.json(); } catch { throw new HttpError(502, "invalid_response", "Reddit returned an unexpected response for that link."); }
    if (!oembed || typeof oembed.title !== "string" || !oembed.title) {
      throw new HttpError(502, "no_post_found", "Could not read that thread. It may have been deleted or removed.");
    }

    const canonicalUrl = typeof oembed.url === "string" && /^https:\/\//.test(oembed.url) && isRedditHost(new URL(oembed.url).hostname)
      ? oembed.url : resolved.toString();
    const sub = canonicalUrl.match(COMMENTS_RE)?.[1] ?? null;
    const author = typeof oembed.author_name === "string" && /^[A-Za-z0-9_\-]{1,60}$/.test(oembed.author_name) ? oembed.author_name : null;
    return { title: oembed.title.slice(0, 300), subreddit: sub, author, canonicalUrl, redditUrl: rawUrl.trim() };
  } finally {
    clearTimeout(timer);
  }
}
