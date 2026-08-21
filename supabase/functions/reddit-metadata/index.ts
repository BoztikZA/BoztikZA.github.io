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

// Matches reddit.com and redd.it thread URLs and pulls the subreddit + post id.
// Accepts www./old./np. subdomains, with or without a trailing slug/query string.
const REDDIT_THREAD_RE =
  /^https?:\/\/(?:www\.|old\.|np\.)?reddit\.com\/r\/([A-Za-z0-9_]+)\/comments\/([A-Za-z0-9]+)/i;

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let input: { url?: string };
  try { input = await request.json(); } catch { return json({ error: "invalid_request" }, 400); }

  const rawUrl = (input.url ?? "").trim();
  const match = rawUrl.match(REDDIT_THREAD_RE);
  if (!match) {
    return json({ error: "not_a_reddit_thread", message: "That doesn't look like a Reddit thread URL." }, 400);
  }

  const [, subreddit, postId] = match;
  const jsonUrl = `https://www.reddit.com/comments/${postId}.json?raw_json=1`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const redditResponse = await fetch(jsonUrl, {
      signal: controller.signal,
      headers: {
        // Reddit rejects requests with no/blank User-Agent.
        "User-Agent": "BoztikDeliver/1.0 (Command Centre metadata fetch)"
      }
    });

    if (!redditResponse.ok) {
      return json({
        error: "reddit_unavailable",
        message: `Reddit returned HTTP ${redditResponse.status}.`
      }, 502);
    }

    const payload = await redditResponse.json();
    const postData = payload?.[0]?.data?.children?.[0]?.data;
    const title = typeof postData?.title === "string" ? postData.title.trim() : "";

    if (!title) {
      return json({ error: "no_title_found", message: "Could not read a title from that thread." }, 502);
    }

    return json({
      title,
      subreddit: postData?.subreddit || subreddit,
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
