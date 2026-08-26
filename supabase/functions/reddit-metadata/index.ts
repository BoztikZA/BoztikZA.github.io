// Boztik Deliver: fetches a Reddit thread's title, subreddit, original-poster
// username, and canonical post URL server-side.
//
// Used for two things:
//  1) Command Centre auto-fill (PhotoshopBattles delivery title/subreddit).
//  2) The optional "Reddit Source" attribution attached to any delivery and
//     shown to the client as "Original Source" (see deliveries.reddit_source).
//
// Reddit's public JSON endpoint cannot be called directly from the browser
// (CORS), so this function proxies it. It never blocks delivery creation —
// callers must treat any error response as "auto-fill unavailable" and fall
// back to manual entry / saving the raw URL without metadata.
//
// Deploy with: supabase functions deploy reddit-metadata
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://boztikza.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Classic thread URL: reddit.com/r/<sub>/comments/<id>/...
const COMMENTS_RE = /\/r\/([A-Za-z0-9_]+)\/comments\/([A-Za-z0-9]+)/i;

// "Share" shortlink from the Reddit app/website: reddit.com/r/<sub>/s/<code>
const SHARE_RE = /\/r\/([A-Za-z0-9_]+)\/s\/([A-Za-z0-9]+)/i;

// redd.it/<id> shortlink (no subreddit in the URL at all)
const REDDIT_IT_RE = /^https?:\/\/redd\.it\/([A-Za-z0-9]+)/i;

function isRedditHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "reddit.com" || host.endsWith(".reddit.com") || host === "redd.it";
  } catch {
    return false;
  }
}

function canonicalPostUrl(subreddit: string | null, postId: string | null, fallback: string): string {
  if (subreddit && postId) return `https://www.reddit.com/r/${subreddit}/comments/${postId}/`;
  return fallback;
}

// Reddit share shortlinks (and redd.it) are HTTP redirects to the canonical
// /comments/ URL. We can't follow redirects transparently from a browser
// fetch on the client, but a server-side edge function can — so on a
// shortlink we manually walk up to a few redirect hops to resolve it.
async function resolveRedirect(url: string): Promise<string> {
  let current = url;

  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) break;
      current = location.startsWith("http") ? location : new URL(location, current).toString();
      continue;
    }

    await response.body?.cancel();
    break;
  }

  return current;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let input: { url?: string };
  try { input = await request.json(); } catch { return json({ error: "invalid_request" }, 400); }

  const rawUrl = (input.url ?? "").trim();

  if (!rawUrl) {
    return json({ error: "invalid_url", message: "Please paste a Reddit URL." }, 400);
  }

  if (!isRedditHost(rawUrl)) {
    return json({ error: "not_reddit", message: "That doesn't look like a Reddit link." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let resolvedUrl;
  try {
    resolvedUrl = await resolveRedirect(rawUrl);
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = error instanceof Error && error.name === "AbortError";
    console.error("[reddit-metadata] resolveRedirect failed:", rawUrl, error);
    return json({
      error: timedOut ? "timeout" : "redirect_failed",
      message: timedOut
        ? "Reddit took too long to respond while resolving that link."
        : `Could not resolve that Reddit link (${error instanceof Error ? error.message : String(error)}).`
    }, 502);
  }

  // Extract metadata using Reddit's oEmbed endpoint
  const urlObj = new URL(resolvedUrl);
  urlObj.search = ""; // Remove query parameters which cause 400 errors
  const cleanUrl = urlObj.toString();
  const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(cleanUrl)}`;

  let redditResponse;
  try {
    redditResponse = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
    });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = error instanceof Error && error.name === "AbortError";
    console.error("[reddit-metadata] oEmbed fetch failed:", oembedUrl, error);
    return json({
      error: timedOut ? "timeout" : "fetch_failed",
      message: timedOut
        ? "Reddit took too long to respond."
        : `Could not reach Reddit (${error instanceof Error ? error.message : String(error)}).`
    }, 502);
  }
  clearTimeout(timeout);

  if (redditResponse.status === 429) {
    return json({
      error: "rate_limited",
      message: "Reddit is rate-limiting requests right now. Try again in a moment."
    }, 429);
  }

  if (redditResponse.status === 403) {
    const body = await redditResponse.text().catch(() => "");
    console.error("[reddit-metadata] Reddit returned 403 for", oembedUrl, "body:", body.slice(0, 500));
    return json({
      error: "forbidden",
      message: "Reddit blocked this request (HTTP 403). This is usually Reddit's own bot protection, not a bug in Deliver — try again in a moment, or save the raw link without metadata."
    }, 502);
  }

  if (!redditResponse.ok) {
    const body = await redditResponse.text().catch(() => "");
    console.error("[reddit-metadata] Reddit returned", redditResponse.status, "for", oembedUrl, "body:", body.slice(0, 500));
    return json({
      error: "reddit_unavailable",
      message: `Reddit returned HTTP ${redditResponse.status}.`
    }, 502);
  }

  const rawBody = await redditResponse.text();
  let oembed;
  try {
    oembed = JSON.parse(rawBody);
  } catch (error) {
    console.error("[reddit-metadata] Reddit response was not valid JSON for", oembedUrl, "body:", rawBody.slice(0, 500));
    return json({
      error: "invalid_response",
      message: "Reddit returned an unexpected (non-JSON) response for that link."
    }, 502);
  }

  if (!oembed || !oembed.title) {
    console.error("[reddit-metadata] oEmbed response missing title for", oembedUrl, "body:", rawBody.slice(0, 500));
    return json({
      error: "no_post_found",
      message: "Could not read that thread. It may have been deleted or removed."
    }, 502);
  }

  // Extract subreddit from canonical URL
  const canonicalUrl = oembed.url || resolvedUrl;
  const subMatch = canonicalUrl.match(COMMENTS_RE);
  const subreddit = subMatch ? subMatch[1] : null;

  return json({
    title: oembed.title,
    subreddit: subreddit,
    author: oembed.author_name || null,
    canonicalUrl: canonicalUrl,
    redditUrl: rawUrl
  });
});