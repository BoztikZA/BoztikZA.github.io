import type { Env } from "../types";
import { HttpError } from "../types";
import { requireSession } from "../lib/auth";
import { localDay } from "../lib/db";
import { reserveUpload, claimUpload, commitUpload, releaseReservation } from "../lib/storage";
import { assertSameSiteOrigin, checkPublicRate, error, json, readJson, requireJson, segments, wrap } from "./util";

const CATEGORIES = new Set(["small-business","youtube","twitch","gaming","photography","design","music","creator","freelance","other"]);
const ID = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const now = () => Math.floor(Date.now() / 1000);
const day = (env: Env) => localDay(env);
const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const u = new URL(value.trim()); return u.protocol === "https:" ? u.toString().slice(0, 500) : null; }
  catch { return null; }
}
function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "profile";
}
function spotifyTrack(value: unknown): { id: string; url: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || !["open.spotify.com", "www.open.spotify.com"].includes(u.hostname)) return null;
    const match = u.pathname.match(/^\/track\/([A-Za-z0-9]{22})\/?$/);
    return match ? { id: match[1], url: "https://open.spotify.com/track/" + match[1] } : null;
  } catch { return null; }
}
async function spotifyMetadata(track: { id: string; url: string }): Promise<{ id: string; url: string; title: string; artwork: string | null }> {
  const response = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(track.url), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new HttpError(422, "spotify_unavailable", "Spotify could not retrieve that track. Check the song link and try again.");
  const data = await response.json() as { title?: unknown; thumbnail_url?: unknown; provider_name?: unknown };
  if (data.provider_name !== "Spotify" || typeof data.title !== "string") throw new HttpError(422, "spotify_invalid_track", "Please provide a public Spotify track link, not an artist or playlist link.");
  const artwork = typeof data.thumbnail_url === "string" && data.thumbnail_url.startsWith("https://") ? data.thumbnail_url : null;
  return { ...track, title: data.title.slice(0, 200), artwork };
}

function publicDto(row: any) {
  return {
    id: row.id, slug: row.slug, display_name: row.display_name, tagline: row.tagline,
    description: row.description, category: row.category, website_url: row.website_url,
    social_links: JSON.parse(row.social_links || "{}"), song: row.song_metadata ? JSON.parse(row.song_metadata) : null, image_url: row.image_key && row.status === "published" ? "https://deliver-api.boztik.com/api/public/spotlight/image/" + row.id : null,
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
        "SELECT id,slug,display_name,tagline,description,category,website_url,social_links,song_metadata,image_key,image_size,image_content_type,status,featured_until,created_at FROM spotlight_profiles WHERE status='published' ORDER BY CASE WHEN featured_until > ? THEN 0 ELSE 1 END, published_at DESC LIMIT 100"
      ).bind(now()).all<any>();
      return json({ ok: true, profiles: (rows.results || []).map(publicDto) }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" });
    }
    if (request.method === "GET" && seg[0] === "image" && seg.length === 2) {
      const row = await env.DB.prepare("SELECT image_key,image_content_type FROM spotlight_profiles WHERE id=? AND status='published'").bind(seg[1]).first<any>();
      if (!row?.image_key) return error("Image not found",404);
      const object = await env.BUCKET.get(row.image_key);
      if (!object) return error("Image not found",404);
      return new Response(object.body,{headers:{"Content-Type":row.image_content_type || "image/jpeg","Cache-Control":"public, max-age=3600","X-Content-Type-Options":"nosniff"}});
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
      const songTrack = b.song_url ? spotifyTrack(b.song_url) : null;
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = songTrack ? await spotifyMetadata(songTrack) : null;
      const website = safeUrl(b.website_url);
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30) throw new HttpError(422, "invalid_profile", "Please provide a name, a clear tagline and a description of at least 30 characters.");
      if (!CATEGORIES.has(category)) throw new HttpError(422, "invalid_category", "Choose a valid category.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "invalid_email", "Enter a valid contact email.");
      if (b.contact_email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new HttpError(422, "invalid_email", "Enter a valid contact email.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      if (b.consent !== true) throw new HttpError(422, "consent_required", "Confirm that you own or are authorised to submit this profile.");
      const social: Record<string,string> = {};
      if (b.social_links && typeof b.social_links === "object" && !Array.isArray(b.social_links)) {
        for (const key of ["youtube","twitch","instagram","tiktok","facebook","linkedin","x","spotify"]) {
          const value = (b.social_links as Record<string,unknown>)[key];
          if (value) { const url = safeUrl(value); if (!url) throw new HttpError(422, "invalid_social_url", "Social links must use HTTPS."); if (url) social[key] = url; }
        }
      }
      const id = ID(), timestamp = now();
      const slug = slugify(displayName) + "-" + id.slice(0, 5);
      await env.DB.prepare(
        "INSERT INTO spotlight_profiles (id,slug,display_name,tagline,description,category,contact_email,website_url,social_links,song_metadata,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)"
      ).bind(id,slug,displayName,tagline,description,category,email,website,JSON.stringify(social),song ? JSON.stringify(song) : null,timestamp,timestamp).run();
      // Attempt the owner notification before responding so the submitter sees
      // whether the email alert was sent. The D1 submission is already safely
      // stored, so provider failure never loses the profile.
      const notificationSent = await notifySpotlightSubmission(env, { displayName, tagline, category, email, website, id })
        .catch(e => { console.error("[spotlight] notification failed", e); return false; });
      return json({
        ok: true,
        notification_sent: notificationSent,
        message: notificationSent
          ? "Your profile has been received. The Boztik team has also been notified."
          : "Your profile has been safely received for review, but the email alert could not be sent. You do not need to submit it again."
      }, 201);
    }
    if (request.method === "POST" && seg[0] === "event" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-event", 2);
      assertSameSiteOrigin(request, env); requireJson(request);
      const b = await readJson(request, 1024);
      const eventId = clean(b.event_id, 64), profileId = clean(b.profile_id, 32), type = b.type;
      const visitorId = clean(b.visitor_id, 64);
      if (!/^[a-zA-Z0-9_-]{12,64}$/.test(eventId) || !/^[a-f0-9]{20}$/i.test(profileId) || !["view","click"].includes(String(type)) || (type === "view" && !/^[a-f0-9-]{36}$/i.test(visitorId))) throw new HttpError(422, "invalid_event", "Invalid analytics event.");
      const profile = await env.DB.prepare("SELECT id FROM spotlight_profiles WHERE id=? AND status='published'").bind(profileId).first();
      if (!profile) return json({ ok: true, counted: false });
      const d = day(env), t = now();
      const insert = await env.DB.prepare("INSERT OR IGNORE INTO spotlight_events(event_id,profile_id,event_type,day,created_at) VALUES(?,?,?,?,?)").bind(eventId,profileId,type,d,t).run();
      if ((insert.meta.changes || 0) > 0) {
        await env.DB.prepare(`INSERT INTO spotlight_daily_metrics(profile_id,day,${type === "view" ? "views" : "outbound_clicks"}) VALUES(?,?,1) ON CONFLICT(profile_id,day) DO UPDATE SET ${type === "view" ? "views" : "outbound_clicks"}=${type === "view" ? "views" : "outbound_clicks"}+1`).bind(profileId,d).run();
        if (type === "view") {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(visitorId + ":" + d + ":" + env.AUTH_TOKEN_SALT));
          const visitorKey = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
          const unique = await env.DB.prepare("INSERT OR IGNORE INTO spotlight_visitors(profile_id,day,visitor_key,created_at) VALUES(?,?,?,?)").bind(profileId,d,visitorKey,t).run();
          if ((unique.meta.changes || 0) > 0) await env.DB.prepare("UPDATE spotlight_daily_metrics SET unique_views=unique_views+1 WHERE profile_id=? AND day=?").bind(profileId,d).run();
        }
      }
      return json({ ok: true, counted: (insert.meta.changes || 0) > 0 });
    }
    if (request.method === "POST" && seg[0] === "impression" && seg.length === 1) {
      checkPublicRate(request, env, "spotlight-impression", 2);
      assertSameSiteOrigin(request, env); requireJson(request);
      const b = await readJson(request, 1024);
      const eventId = clean(b.event_id, 64), profileId = clean(b.profile_id, 32);
      if (!/^[a-zA-Z0-9_-]{12,64}$/.test(eventId) || !/^[a-f0-9]{20}$/i.test(profileId)) throw new HttpError(422, "invalid_event", "Invalid impression event.");
      const d = day(env), t = now();
      const featured = await env.DB.prepare("SELECT id FROM spotlight_profiles WHERE id=? AND status='published' AND featured_until>?").bind(profileId,t).first();
      if (!featured) return json({ok:true,counted:false});
      const insert = await env.DB.prepare("INSERT OR IGNORE INTO spotlight_impressions(event_id,profile_id,day,created_at) VALUES(?,?,?,?)").bind(eventId,profileId,d,t).run();
      if ((insert.meta.changes || 0) > 0) await env.DB.prepare("INSERT INTO spotlight_daily_metrics(profile_id,day,featured_impressions) VALUES(?,?,1) ON CONFLICT(profile_id,day) DO UPDATE SET featured_impressions=featured_impressions+1").bind(profileId,d).run();
      return json({ok:true,counted:(insert.meta.changes || 0)>0});
    }
    return error("Not found", 404);
  });
}

export function handleSpotlightAdmin(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    await requireSession(request, env);
    const seg = segments(path);
    if (seg.length === 1 && seg[0] === "profile" && request.method === "POST") {
      requireJson(request);
      const b = await readJson(request, 12 * 1024);
      const displayName = clean(b.display_name, 80), tagline = clean(b.tagline, 120);
      const description = clean(b.description, 900), category = clean(b.category, 40);
      const email = clean(b.contact_email, 254).toLowerCase();
      const website = b.website_url ? safeUrl(b.website_url) : null;
      const songTrack = b.song_url ? spotifyTrack(b.song_url) : null;
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = songTrack ? await spotifyMetadata(songTrack) : null;
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30) throw new HttpError(422, "invalid_profile", "Please provide a name, a clear tagline and a description of at least 30 characters.");
      if (!CATEGORIES.has(category)) throw new HttpError(422, "invalid_category", "Choose a valid category.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "invalid_email", "Enter a valid contact email.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      const social: Record<string,string> = {};
      if (b.social_links && typeof b.social_links === "object" && !Array.isArray(b.social_links)) {
        for (const key of ["youtube","twitch","instagram","tiktok","facebook","linkedin","x","spotify"]) {
          const value = (b.social_links as Record<string,unknown>)[key];
          if (value) { const url = safeUrl(value); if (!url) throw new HttpError(422, "invalid_social_url", "Social links must use HTTPS."); social[key] = url; }
        }
      }
      const id = ID(), timestamp = now(), slug = slugify(displayName) + "-" + id.slice(0, 5);
      await env.DB.prepare(
        "INSERT INTO spotlight_profiles (id,slug,display_name,tagline,description,category,contact_email,website_url,social_links,song_metadata,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)"
      ).bind(id,slug,displayName,tagline,description,category,email,website,JSON.stringify(social),song ? JSON.stringify(song) : null,timestamp,timestamp).run();
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(id).first<any>();
      return json({ ok:true, profile:{...publicDto(row),contact_email:row.contact_email,status:row.status} }, 201);
    }
    if (!seg.length && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT * FROM spotlight_profiles ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, created_at DESC LIMIT 300").all<any>();
      return json({ ok: true, profiles: (rows.results || []).map((r:any) => ({ ...publicDto(r), contact_email:r.contact_email, status:r.status })) });
    }
    if (seg.length === 3 && seg[0] === "profile" && seg[2] === "image" && request.method === "PUT") return uploadSpotlightImage(request,env,seg[1]);
    if (seg.length === 3 && seg[0] === "profile" && seg[2] === "image" && request.method === "GET") {
      const row=await env.DB.prepare("SELECT image_key,image_content_type FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if(!row?.image_key)return error("Image not found",404);
      const object=await env.BUCKET.get(row.image_key);
      if(!object)return error("Image not found",404);
      return new Response(object.body,{headers:{"Content-Type":row.image_content_type || "image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    if (seg.length === 2 && seg[0] === "profile" && request.method === "PATCH") {
      requireJson(request); const b = await readJson(request, 8 * 1024);
      const old = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if (!old) return error("Profile not found",404);
      const status = ["pending","published","archived"].includes(String(b.status)) ? String(b.status) : old.status;
      const displayName = b.display_name === undefined ? old.display_name : clean(b.display_name, 80);
      const tagline = b.tagline === undefined ? old.tagline : clean(b.tagline, 120);
      const description = b.description === undefined ? old.description : clean(b.description, 900);
      const category = b.category === undefined ? old.category : clean(b.category, 40);
      const contactEmail = b.contact_email === undefined ? old.contact_email : clean(b.contact_email, 254).toLowerCase();
      const website = b.website_url === undefined ? old.website_url : (b.website_url ? safeUrl(b.website_url) : null);
      const songTrack = b.song_url === undefined ? (old.song_metadata ? spotifyTrack(JSON.parse(old.song_metadata).url) : null) : (b.song_url ? spotifyTrack(b.song_url) : null);
      if (b.song_url && !songTrack) throw new HttpError(422, "invalid_spotify_track", "Use a public Spotify track link.");
      const song = b.song_url === undefined ? (old.song_metadata ? JSON.parse(old.song_metadata) : null) : (songTrack ? await spotifyMetadata(songTrack) : null);
      const social = b.social_links === undefined ? JSON.parse(old.social_links || "{}") : b.social_links;
      if (displayName.length < 2 || tagline.length < 8 || description.length < 30 || !CATEGORIES.has(category)) throw new HttpError(422, "invalid_profile", "Check the name, tagline, description and category.");
      if (b.website_url && !website) throw new HttpError(422, "invalid_url", "Website links must use HTTPS.");
      if (!social || typeof social !== "object" || Array.isArray(social)) throw new HttpError(422, "invalid_social_links", "Social links must be an object.");
      for (const [key,value] of Object.entries(social)) { if (!["youtube","twitch","instagram","tiktok","facebook","linkedin","x","spotify"].includes(key) || !safeUrl(value)) throw new HttpError(422, "invalid_social_url", "Social links must use HTTPS."); }
      if (b.featured === true && status !== "published") throw new HttpError(422, "feature_requires_published", "Publish the profile before featuring it.");
      const featured = status !== "published" ? null : b.featured === true ? now()+86400 : b.featured === false ? null : old.featured_until;
      const updated = now();
      // Only one profile can hold the daily featured placement at a time.
      await env.DB.batch([
        env.DB.prepare("UPDATE spotlight_profiles SET featured_until=NULL WHERE featured_until > ? AND id<>?").bind(updated,seg[1]),
        env.DB.prepare("UPDATE spotlight_profiles SET display_name=?,tagline=?,description=?,category=?,contact_email=?,website_url=?,social_links=?,song_metadata=?,status=?,featured_until=?,updated_at=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END WHERE id=?").bind(displayName,tagline,description,category,contactEmail,website,JSON.stringify(social),song ? JSON.stringify(song) : null,status,featured,updated,status,updated,seg[1])
      ]);
      const row = await env.DB.prepare("SELECT * FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      return json({ ok:true, profile:{...publicDto(row),contact_email:row.contact_email,status:row.status} });
    }
    if (seg.length === 2 && seg[0] === "profile" && request.method === "DELETE") {
      const old=await env.DB.prepare("SELECT image_key,image_size FROM spotlight_profiles WHERE id=?").bind(seg[1]).first<any>();
      if(old?.image_key){await env.BUCKET.delete(old.image_key);await env.DB.prepare("UPDATE storage_state SET total_bytes=MAX(0,total_bytes-?),mutation_seq=mutation_seq+1,last_mutation_at=? WHERE id=1").bind(old.image_size||0,now()).run();}
      await env.DB.prepare("DELETE FROM spotlight_profiles WHERE id=?").bind(seg[1]).run();
      return json({ ok:true });
    }
    if (seg.length === 1 && seg[0] === "analytics" && request.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT p.id,p.display_name,COALESCE(SUM(m.views),0) views,COALESCE(SUM(m.unique_views),0) unique_views,COALESCE(SUM(m.outbound_clicks),0) outbound_clicks,COALESCE(SUM(m.featured_impressions),0) featured_impressions FROM spotlight_profiles p LEFT JOIN spotlight_daily_metrics m ON m.profile_id=p.id GROUP BY p.id ORDER BY views DESC LIMIT 100"
      ).all<any>();
      return json({ ok:true, profiles:rows.results || [] });
    }
    return error("Not found",404);
  });
}

async function notifySpotlightSubmission(env: Env, item: {displayName:string;tagline:string;category:string;email:string;website:string|null;id:string}): Promise<boolean> {
  const to=env.NOTIFY_EMAIL_TO?.trim(), from=env.NOTIFY_EMAIL_FROM?.trim(), url=env.EMAIL_PROVIDER_URL?.trim();
  if(!to||!from||!url){console.warn("[spotlight] owner email notification is not configured; submission remains safely queued in D1.");return false;}
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
  return true;
}

// Spotlight images share the existing atomic storage ledger and the same 3 GiB ceiling as Deliver.\nasync function uploadSpotlightImage(request:Request,env:Env,profileId:string):Promise<Response>{
  if(!/^[a-f0-9]{20}$/i.test(profileId))return error("Profile not found",404);
  const profile=await env.DB.prepare("SELECT id,image_key,image_size FROM spotlight_profiles WHERE id=?").bind(profileId).first<any>();
  if(!profile)return error("Profile not found",404);
  const type=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  const declaredHeader=request.headers.get("Content-Length");
  const declared=declaredHeader===null?null:Number(declaredHeader);
  const maxBytes=2*1024*1024;
  if(!["image/jpeg","image/png","image/webp"].includes(type))throw new HttpError(415,"invalid_image_type","Choose a JPG, PNG or WebP image.");
  if(declared!==null&&(!Number.isInteger(declared)||declared<1||declared>maxBytes))throw new HttpError(413,"image_too_large","Spotlight images must be no larger than 2 MB.");
  const reader=request.body?.getReader();
  if(!reader)throw new HttpError(422,"empty_image","Choose an image to upload.");
  const chunks:Uint8Array[]=[];let total=0;
  for(;;){
    const part=await reader.read();
    if(part.done)break;
    total+=part.value.byteLength;
    if(total>maxBytes){await reader.cancel();throw new HttpError(413,"image_too_large","Spotlight images must be no larger than 2 MB.");}
    chunks.push(part.value);
  }
  if(total<1)throw new HttpError(422,"empty_image","Choose an image to upload.");
  if(declared!==null&&total!==declared)throw new HttpError(422,"image_size_mismatch","The uploaded image size could not be verified.");
  const bytes=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const valid=type==="image/jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==="image/png"?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
  if(!valid)throw new HttpError(422,"invalid_image","The file contents do not match the selected image type.");
  const uploadId=crypto.randomUUID().replace(/-/g,"").slice(0,16),fileId=crypto.randomUUID().replace(/-/g,"").slice(0,16),key="spotlight/"+profileId+"/"+uploadId;
  await reserveUpload(env,{uploadId,deliveryId:profileId,fileId,r2Key:key,fileName:"spotlight-profile-image",fileSize:bytes.length,contentType:type});
  let committed=false;
  try{
    if(!(await claimUpload(env,uploadId)))throw new HttpError(409,"upload_conflict","The image upload could not be started.");
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});
    if(!(await commitUpload(env,uploadId,bytes.length)))throw new HttpError(409,"upload_conflict","The image upload could not be completed.");
    committed=true;
    const previousKey=profile.image_key,previousSize=Number(profile.image_size||0);
    await env.DB.batch([
      env.DB.prepare("UPDATE spotlight_profiles SET image_key=?,image_size=?,image_content_type=?,updated_at=? WHERE id=?").bind(key,bytes.length,type,now(),profileId),
      env.DB.prepare("DELETE FROM pending_uploads WHERE upload_id=? AND state='stored'").bind(uploadId)
    ]);
    if(previousKey){await env.BUCKET.delete(previousKey);await env.DB.prepare("UPDATE storage_state SET total_bytes=MAX(0,total_bytes-?),mutation_seq=mutation_seq+1,last_mutation_at=? WHERE id=1").bind(previousSize,now()).run();}
    return json({ok:true,image_size:bytes.length});
  }catch(e){
    if(!committed){try{await env.BUCKET.delete(key)}catch{};await releaseReservation(env,uploadId,bytes.length);}
    throw e;
  }
}
