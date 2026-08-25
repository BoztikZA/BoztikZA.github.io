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
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});

const USER_AGENT = "BoztikDeliver/1.0 (Command Centre metadata fetch)";

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
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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

  try {
    let subreddit: string | null = null;
    let postId: string | null = null;
    let resolvedUrl = rawUrl;

    const directMatch = rawUrl.match(COMMENTS_RE);

    if (directMatch) {
      subreddit = directMatch[1];
      postId = directMatch[2];
    } else {
      // Share shortlink or redd.it link — resolve the redirect chain first,
      // then try to read the canonical URL it landed on.
      resolvedUrl = await resolveRedirect(rawUrl);
      const resolvedMatch = resolvedUrl.match(COMMENTS_RE);

      if (resolvedMatch) {
        subreddit = resolvedMatch[1];
        postId = resolvedMatch[2];
      } else {
        // Redirect chain didn't land on a comments URL for some reason —
        // fall back to whatever we can read out of the original link.
        const shareMatch = rawUrl.match(SHARE_RE);
        const reddItMatch = rawUrl.match(REDDIT_IT_RE);

        if (shareMatch) {
          subreddit = shareMatch[1];
        } else if (reddItMatch) {
          postId = reddItMatch[1];
        }
      }
    }

    if (!postId && !subreddit) {
      return json({
        error: "unresolvable_share_link",
        message: "Could not resolve that share link to a Reddit thread."
      }, 400);
    }

    const jsonUrl = postId
      ? `https://www.reddit.com/comments/${postId}.json?raw_json=1`
      // We only have a subreddit with no real post id (rare fallback) —
      // ask Reddit's own resolver for the canonical .json directly.
      : `${resolvedUrl.replace(/\/?$/, "")}.json?raw_json=1`;

    const redditResponse = await fetch(jsonUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
    });

    if (redditResponse.status === 429) {
      return json({
        error: "rate_limited",
        message: "Reddit is rate-limiting requests right now. Try again in a moment."
      }, 429);
    }

    if (redditResponse.status === 403) {
      return json({
        error: "private_subreddit",
        message: "That subreddit is private or restricted — its posts can't be read."
      }, 403);
    }

    if (redditResponse.status === 404) {
      return json({
        error: "not_found",
        message: "That Reddit post could not be found. It may have been deleted."
      }, 404);
    }

    if (!redditResponse.ok) {
      return json({
        error: "reddit_unavailable",
        message: `Reddit returned HTTP ${redditResponse.status}.`
      }, 502);
    }

    const payload = await redditResponse.json();
    const postData = Array.isArray(payload)
      ? payload?.[0]?.data?.children?.[0]?.data
      : payload?.data?.children?.[0]?.data?.data;

    if (!postData) {
      return json({
        error: "no_post_found",
        message: "Could not read that thread. It may have been deleted or removed."
      }, 502);
    }

    const rawTitle = typeof postData.title === "string" ? postData.title.trim() : "";
    const removed = Boolean(postData.removed_by_category) || rawTitle === "[deleted]" || rawTitle === "[removed]";

    if (!rawTitle || removed) {
      return json({
        error: "post_removed",
        message: "That Reddit post has been deleted or removed and no longer has readable details."
      }, 404);
    }

    const rawAuthor = typeof postData.author === "string" ? postData.author.trim() : "";
    const author = rawAuthor && rawAuthor !== "[deleted]" && rawAuthor !== "[removed]" ? rawAuthor : null;

    const resolvedSubreddit = postData.subreddit || subreddit || null;
    const resolvedPostId = postData.id || postId || null;

    return json({
      title: rawTitle,
      subreddit: resolvedSubreddit,
      author,
      canonicalUrl: canonicalPostUrl(resolvedSubreddit, resolvedPostId, resolvedUrl),
      redditUrl: rawUrl
    });

  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return json({
      error: timedOut ? "timeout" : "fetch_failed",
      message: timedOut ? "Reddit took too long to respond." : "Could not reach Reddit."
    }, 502);

  } finally {
    clearTimeout(timeout);
  }
});
