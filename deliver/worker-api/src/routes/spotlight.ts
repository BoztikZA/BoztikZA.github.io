import type { Env } from "../types";
import { HttpError } from "../types";
import { requireSession } from "../lib/auth";
import { assertSameSiteOrigin, checkPublicRate, error, json, readJson, requireJson, segments, wrap } from "./util";

const CATEGORIES = new Set(["small-business","youtube","twitch","gaming","photography","design","music","creator","freelance","other"]);
const ID = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const now = () => Math.floor(Date.now() / 1000);
const day = () => new Date().toISOString().slice(0, 10);
const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const u = new URL(value.trim()); return u.protocol === "https:" ? u.toString().slice(0, 500) : null; }
  catch { return null; }
}
function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "profile";
}
function publicDto(row: any) {
  return {
    id: row.id, slug: row.slug, display_name: row.display_name, tagline: row.tagline,
    description: row.description, category: row.category, website_url: row.website_url,
    social_links: JSON.parse(row.social_links || "{}"), image_url: null,
    featured: Number(row.featured_until || 0) > now(), featured_until: Number(row.featured_until || 0) > now() ? row.featured_until : null,
    created_at: row.created_at,
  };
}

export function handleSpotlightPublic(request: Request, path: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  return wrap(async () => {
    const seg = segments(path);
    if (request.method === "GET" && seg.length === 0) {
      checkPublicRate(request, env, "spotlight-list", 2);
      const rows = await env.DB.prepare(
        "SELECT id,slug,display_name,tagline,description,category,website_url,social_links,featured_until,created_at FROM spotlight_profiles WHERE status='published' ORDER BY CASE WHEN featured_until > ? THEN 0 ELSE 1 END, published_at DESC LIMIT 100"
      ).bind(now()).all<any>();
      return json({ ok: true, profiles: (rows.results || []).map(publicDto) }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" });
    }
    if (request.method === "GET" && seg[0] === "profile" && seg.length === 2) {
      checkPublicRate(request, env, "spotlight-profile", 2);
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE slug=? AND status='published'").bind(seg[1]).first<any>();
      if (!row) return error("Profile not found", 404);
      return json({ ok: true, profile: publicDto(row) }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" });
    }
    if (request.method === "POST" && seg[0] === "submit" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-submit", 0.25);
      assertSameSiteOrigin(request, env); requireJson(request);
      const b = await readJson(request, 8 * 1024);
      // Honeypot: silently accept automated submissions without storing them.
      if (clean(b.company_website, 200)) return json({ ok: true });
      const displayName = clean(b.display_name, 80), tagline = clean(b.tagline, 120);
      const description = clean(b.description, 900), category = clean(b.category, 40);
      const email = clean(b.contact_email, 254).toLowerCase();
      const website = safeUrl(b.website_url);
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30) throw new HttpError(422, "invalid_profile", "Please provide a name, a clear tagline and a description of at least 30 characters.");
      if (!CATEGORIES.has(category)) throw new HttpError(422, "invalid_category", "Choose a valid category.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "invalid_email", "Enter a valid contact email.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      if (b.consent !== true) throw new HttpError(422, "consent_required", "Confirm that you own or are authorised to submit this profile.");
      const social: Record<string,string> = {};
      if (b.social_links && typeof b.social_links === "object" && !Array.isArray(b.social_links)) {
        for (const key of ["youtube","twitch","instagram","tiktok","facebook","linkedin","x"]) {
          const value = (b.social_links as Record<string,unknown>)[key];
          if (value) { const url = safeUrl(value); if (!url) throw new HttpError(422, "invalid_social_url", "Social links must use HTTPS."); if (url) social[key] = url; }
        }
      }
      const id = ID(), timestamp = now();
      const slug = slugify(displayName) + "-" + id.slice(0, 5);
      await env.DB.prepare(
        "INSERT INTO spotlight_profiles (id,slug,display_name,tagline,description,category,contact_email,website_url,social_links,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)"
      ).bind(id,slug,displayName,tagline,description,category,email,website,JSON.stringify(social),timestamp,timestamp).run();
      // Notify the owner asynchronously; email failure must never lose a submission.
      ctx.waitUntil(notifySpotlightSubmission(env, { displayName, tagline, category, email, website, id }).catch(e => console.error("[spotlight] notification failed", e)));
      return json({ ok: true, message: "Your profile has been submitted for review." }, 201);
    }
    if (request.method === "POST" && seg[0] === "event" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-event", 2);
      assertSameSiteOrigin(request, env); requireJson(request);
      const b = await readJson(request, 1024);
      const eventId = clean(b.event_id, 64), profileId = clean(b.profile_id, 32), type = b.type;
      if (!/^[a-zA-Z0-9_-]{12,64}$/.test(eventId) || !/^[a-f0-9]{20}$/i.test(profileId) || !["view","click"].includes(String(type))) throw new HttpError(422, "invalid_event", "Invalid analytics event.");
      const profile = await env.DB.prepare("SELECT id FROM spotlight_profiles WHERE id=? AND status='published'").bind(profileId).first();
      if (!profile) return json({ ok: true, counted: false });
      const d = day(), t = now();
      const insert = await env.DB.prepare("INSERT OR IGNORE INTO spotlight_events(event_id,profile_id,event_type,day,created_at) VALUES(?,?,?,?,?)").bind(eventId,profileId,type,d,t).run();
      if ((insert.meta.changes || 0) > 0) {
        await env.DB.prepare(`INSERT INTO spotlight_daily_metrics(profile_id,day,${type === "view" ? "views" : "outbound_clicks"}) VALUES(?,?,1) ON CONFLICT(profile_id,day) DO UPDATE SET ${type === "view" ? "views" : "outbound_clicks"}=${type === "view" ? "views" : "outbound_clicks"}+1`).bind(profileId,d).run();
      }
      return json({ ok: true, counted: (insert.meta.changes || 0) > 0 });
    }
    return error("Not found", 404);
  });
}

export function handleSpotlightAdmin(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    await requireSession(request, env);
    const seg = segments(path);
    if (!seg.length && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT * FROM spotlight_profiles ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, created_at DESC LIMIT 300").all<any>();
      return json({ ok: true, profiles: (rows.results || []).map((r:any) => ({ ...publicDto(r), contact_email:r.contact_email, status:r.status })) });
    }
    if (seg.length === 2 && seg[0] === "profile" && request.method === "PATCH") {
      requireJson(request); const b = await readJson(request, 8 * 1024);
      const old = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if (!old) return error("Profile not found",404);
      const status = ["pending","published","archived"].includes(String(b.status)) ? String(b.status) : old.status;
      const featured = b.featured === true ? now()+86400 : b.featured === false ? null : old.featured_until;
      const updated = now();
      // Only one profile can hold the daily featured placement at a time.
      if (b.featured === true) {
        await env.DB.prepare("UPDATE spotlight_profiles SET featured_until=NULL WHERE featured_until > ?").bind(updated).run();
      }
      await env.DB.prepare("UPDATE spotlight_profiles SET status=?,featured_until=?,updated_at=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END WHERE id=?")
        .bind(status,featured,updated,status,updated,seg[1]).run();
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      return json({ ok:true, profile:{...publicDto(row),contact_email:row.contact_email,status:row.status} });
    }
    if (seg.length === 2 && seg[0] === "profile" && request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM spotlight_profiles WHERE id=?").bind(seg[1]).run();
      return json({ ok:true });
    }
    if (seg.length === 1 && seg[0] === "analytics" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT p.id,p.display_name,COALESCE(SUM(m.views),0) views,COALESCE(SUM(m.outbound_clicks),0) outbound_clicks FROM spotlight_profiles p LEFT JOIN spotlight_daily_metrics m ON m.profile_id=p.id GROUP BY p.id ORDER BY views DESC LIMIT 100"
      ).all<any>();
      return json({ ok:true, profiles:rows.results || [] });
    }
    return error("Not found",404);
  });
}

async function notifySpotlightSubmission(env: Env, item: {displayName:string;tagline:string;category:string;email:string;website:string|null;id:string}): Promise<void> {
  const to=env.NOTIFY_EMAIL_TO?.trim(), from=env.NOTIFY_EMAIL_FROM?.trim(), url=env.EMAIL_PROVIDER_URL?.trim();
  if(!to||!from||!url){console.warn("[spotlight] owner email notification is not configured; submission remains safely queued in D1.");return;}
  const subject="New Boztik Spotlight submission: "+item.displayName;
  const textBody=[
    "A new Spotlight profile is waiting for review.",
    "",
    "Name: "+item.displayName,
    "Category: "+item.category,
    "Tagline: "+item.tagline,
    "Contact: "+item.email,
    "Website: "+(item.website||"Not supplied"),
    "",
    "Review it in the Boztik Command Centre > Spotlight.",
    "Submission reference: "+item.id
  ].join("\n");
  const headers:Record<string,string>={"Content-Type":"application/json"};
  if(env.EMAIL_PROVIDER_KEY)headers.Authorization="Bearer "+env.EMAIL_PROVIDER_KEY;
  const response=await fetch(url,{method:"POST",headers,body:JSON.stringify({from,to,subject,text:textBody})});
  if(!response.ok)throw new Error("Email provider returned "+response.status);
}
