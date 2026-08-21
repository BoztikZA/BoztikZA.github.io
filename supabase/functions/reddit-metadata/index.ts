// Boztik Deliver: fetches a Reddit thread's title + subreddit server-side so the
// Command Centre can auto-fill a new delivery's project title. Reddit's public
// JSON endpoint cannot be called directly from the browser (CORS), so this
// function proxies it. It never blocks delivery creation — the dashboard
// falls back to manual entry on any error, timeout, or malformed URL.
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
      if (!location) break;
      current = location.startsWith("http") ? location : new URL(location, current).toString();
      continue;
    }

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

  if (!rawUrl || !isRedditHost(rawUrl)) {
    return json({ error: "not_a_reddit_thread", message: "That doesn't look like a Reddit link." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    let subreddit: string | null = null;
    let postId: string | null = null;

    let directMatch = rawUrl.match(COMMENTS_RE);

    if (directMatch) {
      subreddit = directMatch[1];
      postId = directMatch[2];
    } else {
      // Share shortlink or redd.it link — resolve the redirect chain first,
      // then try to read the canonical URL it landed on.
      const resolvedUrl = await resolveRedirect(rawUrl);
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
        error: "not_a_reddit_thread",
        message: "Could not resolve that link to a Reddit thread."
      }, 400);
    }

    const jsonUrl = postId
      ? `https://www.reddit.com/comments/${postId}.json?raw_json=1`
      // We only have a subreddit with no real post id (rare fallback) —
      // ask Reddit's own resolver for the canonical .json directly.
      : `${rawUrl.replace(/\/?$/, "")}.json?raw_json=1`;

    const redditResponse = await fetch(jsonUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT }
    });

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

    const title = typeof postData?.title === "string" ? postData.title.trim() : "";

    if (!title) {
      return json({ error: "no_title_found", message: "Could not read a title from that thread." }, 502);
    }

    return json({
      title,
      subreddit: postData?.subreddit || subreddit || null,
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