import type { Env } from "../types";
import { HttpError } from "../types";
import { requireSession } from "../lib/auth";
import { growthEngine } from "../lib/growth/engine";
import { error, json, readJson, requireJson, segments, wrap } from "./util";

/**
 * Boztik Growth — admin-only routes, mounted under /api/admin/growth/*.
 *
 * Every route here requires the existing authenticated Command Centre session
 * (`requireSession`). All Growth data is private: nothing here is reachable via
 * public routes, and no AI/API keys are ever stored in code, D1, or the client.
 *
 * Phase 1 scope: knowledge ↔ drafts (incl. ideas) ↔ calendar, plus a PAUSE-AI
 * switch and a manual-marking seam. No automated publishing of any kind.
 */

// ------------------------------------------------------------------
// Row shapes
// ------------------------------------------------------------------
export interface GrowthKnowledgeRow {
  id: string; category: string; title: string; content: string;
  active: number; created_at: number; updated_at: number;
}
export interface ContentDraftRow {
  id: string; kind: "draft" | "idea"; title: string; body: string;
  platform: string; status: string; posted_url: string | null;
  created_at: number; updated_at: number;
}
export interface ContentCalendarRow {
  id: string; draft_id: string | null; scheduled_at: string; platform: string;
  status: string; created_at: number; updated_at: number;
}
export interface GrowthDashboard {
  drafts: number; ideas: number; approved: number; published: number;
  scheduled: number; provider: string; ai_status: "active" | "paused";
  recent: ContentDraftRow[]; calendar: Array<ContentCalendarRow & { draft_title: string | null }>;
}

// ------------------------------------------------------------------
// Limits / helpers
// ------------------------------------------------------------------
const LIMITS = {
  title: 200, text: 20000, category: 60, platform: 30, status: 30,
  scheduled_at: 40, posted_url: 2000,
};
const KNOWLEDGE_CATEGORIES = ["Brand", "Product", "Service", "Audience", "Marketing", "Guidelines"];
const DRAFT_KINDS = ["draft", "idea"];
const DRAFT_STATUSES = ["draft", "approved", "published"];
const CALENDAR_STATUSES = ["planned", "posted", "cancelled"];
const PLATFORMS = ["x"]; // extend this value set in Phase 2 for other platforms.
const AI_STATUSES = ["paused", "active"];

const newId = () => crypto.randomUUID();
const nowSec = () => Math.floor(Date.now() / 1000);

function clamp(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.slice(0, max);
}
function oneOf(v: unknown, allowed: readonly string[]): string | null {
  return allowed.includes(String(v)) ? String(v) : null;
}
function boolInt(v: unknown): number {
  return v === true || v === 1 || v === "1" ? 1 : 0;
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string | null }>();
  return row?.value ?? null;
}
async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).bind(key, value, nowSec()).run();
}

export function handleGrowth(request: Request, path: string, env: Env): Promise<Response> {
  return wrap(async () => {
    // Re-affirm the private admin boundary (these routes are also gated in
    // routes/admin.ts; this makes the Growth module's own boundary explicit).
    await requireSession(request, env);

    const seg = segments(path); // e.g. ['knowledge', '<id>']
    switch (seg[0]) {
      case "knowledge": return await routeKnowledge(request, seg, env);
      case "drafts": return await routeDrafts(request, seg, env);
      case "calendar": return await routeCalendar(request, seg, env);
      case "dashboard": return await routeDashboard(env);
      case "settings": return await routeSettings(request, env);
      case "generate": return await routeGenerate(request, env);
      default: return error("Not found", 404);
    }
  });
}

// ==================================================================
// KNOWLEDGE
// ==================================================================
async function routeKnowledge(request: Request, seg: string[], env: Env): Promise<Response> {
  const id = seg[1];
  if (!id) {
    if (request.method === "GET") return listKnowledge(env);
    if (request.method === "POST") return createKnowledge(request, env);
    return error("Method not allowed", 405);
  }
  if (request.method === "PUT") return updateKnowledge(request, id, env);
  if (request.method === "DELETE") return deleteKnowledge(id, env);
  return error("Method not allowed", 405);
}

async function listKnowledge(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT id, category, title, content, active, created_at, updated_at FROM growth_knowledge ORDER BY updated_at DESC, title ASC"
  ).all<GrowthKnowledgeRow>();
  return json({ items: rows.results });
}

async function createKnowledge(request: Request, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);
  const category = oneOf(b.category, KNOWLEDGE_CATEGORIES);
  if (!category) throw new HttpError(422, "invalid_category", "category must be one of: " + KNOWLEDGE_CATEGORIES.join(", "));
  const title = clamp(b.title, LIMITS.title).trim();
  if (!title) throw new HttpError(422, "invalid_title", "title is required.");
  const content = clamp(b.content, LIMITS.text);
  const active = boolInt(b.active);
  const ts = nowSec();
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO growth_knowledge (id, category, title, content, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, category, title, content, active, ts, ts).run();
  return json({ ok: true, id });
}

async function updateKnowledge(request: Request, id: string, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);
  const row = await env.DB.prepare("SELECT id FROM growth_knowledge WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "not_found", "Knowledge entry not found.");
  const category = oneOf(b.category, KNOWLEDGE_CATEGORIES);
  if (!category) throw new HttpError(422, "invalid_category", "category must be one of: " + KNOWLEDGE_CATEGORIES.join(", "));
  const title = clamp(b.title, LIMITS.title).trim();
  if (!title) throw new HttpError(422, "invalid_title", "title is required.");
  const content = clamp(b.content, LIMITS.text);
  const active = boolInt(b.active);
  await env.DB.prepare(
    "UPDATE growth_knowledge SET category = ?, title = ?, content = ?, active = ?, updated_at = ? WHERE id = ?"
  ).bind(category, title, content, active, nowSec(), id).run();
  return json({ ok: true, id });
}

async function deleteKnowledge(id: string, env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM growth_knowledge WHERE id = ?").bind(id).run();
  return json({ ok: true, id });
}


// ==================================================================
// DRAFTS  (kind = draft | idea)
// ==================================================================
async function routeDrafts(request: Request, seg: string[], env: Env): Promise<Response> {
  const id = seg[1];
  if (!id) {
    if (request.method === "GET") return listDrafts(request, env);
    if (request.method === "POST") return createDraft(request, env);
    return error("Method not allowed", 405);
  }
  if (request.method === "PUT") return updateDraft(request, id, env);
  if (request.method === "DELETE") return deleteDraft(id, env);
  return error("Method not allowed", 405);
}

async function listDrafts(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind") ?? "";
  const status = q.get("status") ?? "";
  let sql =
    "SELECT id, kind, title, body, platform, status, posted_url, created_at, updated_at FROM content_drafts";
  const cond: string[] = [];
  const args: string[] = [];
  if (kind) { cond.push("kind = ?"); args.push(kind); }
  if (status) { cond.push("status = ?"); args.push(status); }
  if (cond.length) sql += " WHERE " + cond.join(" AND ");
  sql += " ORDER BY updated_at DESC";
  const rows = await env.DB.prepare(sql).bind(...args).all<ContentDraftRow>();
  return json({ items: rows.results });
}

async function createDraft(request: Request, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);
  const kind = oneOf(b.kind ?? "draft", DRAFT_KINDS) ?? "draft";
  const status = oneOf(b.status ?? "draft", DRAFT_STATUSES) ?? "draft";
  const platform = oneOf(b.platform ?? "x", PLATFORMS) ?? "x";
  const title = clamp(b.title, LIMITS.title).trim();
  if (!title) throw new HttpError(422, "invalid_title", "title is required.");
  const body = clamp(b.body, LIMITS.text);
  const ts = nowSec();
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO content_drafts (id, kind, title, body, platform, status, posted_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)"
  ).bind(id, kind, title, body, platform, status, ts, ts).run();
  return json({ ok: true, id });
}

async function updateDraft(request: Request, id: string, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);
  const row = await env.DB.prepare("SELECT id FROM content_drafts WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "not_found", "Draft not found.");
  const cur = await env.DB.prepare(
    "SELECT kind, title, body, platform, status, posted_url FROM content_drafts WHERE id = ?"
  ).bind(id).first<ContentDraftRow>();
  if (!cur) throw new HttpError(404, "not_found", "Draft not found.");

  const kind = b.kind === undefined ? cur.kind : (oneOf(b.kind, DRAFT_KINDS) ?? cur.kind);
  const status = b.status === undefined ? cur.status : (oneOf(b.status, DRAFT_STATUSES) ?? cur.status);
  const platform = b.platform === undefined ? cur.platform : (oneOf(b.platform, PLATFORMS) ?? cur.platform);
  const title = (b.title === undefined ? cur.title : clamp(b.title, LIMITS.title)).trim();
  if (!title) throw new HttpError(422, "invalid_title", "title is required.");
  const body = b.body === undefined ? cur.body : clamp(b.body, LIMITS.text);
  // Only the owner records a manual publish URL; never set programmatically.
  // undefined = omitted -> leave unchanged; null = explicitly clear;
  // "" or whitespace -> cleared (normalised to null); string -> set.
  const posted_url = b.posted_url === undefined
    ? cur.posted_url
    : (b.posted_url === null ? null : clamp(b.posted_url, LIMITS.posted_url).trim() || null);

  await env.DB.prepare(
    "UPDATE content_drafts SET kind = ?, title = ?, body = ?, platform = ?, status = ?, posted_url = ?, updated_at = ? WHERE id = ?"
  ).bind(kind, title, body, platform, status, posted_url, nowSec(), id).run();
  return json({ ok: true, id });
}

async function deleteDraft(id: string, env: Env): Promise<Response> {
  // Calendar entries pointing at a deleted draft are left as free-standing slots.
  await env.DB.prepare("DELETE FROM content_drafts WHERE id = ?").bind(id).run();
  return json({ ok: true, id });
}


// ==================================================================
// CALENDAR
// ==================================================================
async function routeCalendar(request: Request, seg: string[], env: Env): Promise<Response> {
  const id = seg[1];
  if (!id) {
    if (request.method === "GET") return listCalendar(env);
    if (request.method === "POST") return createCalendar(request, env);
    return error("Method not allowed", 405);
  }
  if (request.method === "PUT") return updateCalendar(request, id, env);
  if (request.method === "DELETE") return deleteCalendar(id, env);
  return error("Method not allowed", 405);
}

async function listCalendar(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.draft_id, c.scheduled_at, c.platform, c.status, c.created_at, c.updated_at,
            d.title AS draft_title
       FROM content_calendar c
       LEFT JOIN content_drafts d ON d.id = c.draft_id
      ORDER BY c.scheduled_at ASC, c.created_at ASC`
  ).all<ContentCalendarRow & { draft_title: string | null }>();
  return json({ items: rows.results });
}

async function createCalendar(request: Request, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);
  const scheduled_at = clamp(b.scheduled_at, LIMITS.scheduled_at);
  if (!scheduled_at) throw new HttpError(422, "invalid_date", "scheduled_at is required.");
  const platform = oneOf(b.platform ?? "x", PLATFORMS) ?? "x";
  const status = oneOf(b.status ?? "planned", CALENDAR_STATUSES) ?? "planned";
  const draft_id = b.draft_id === null || b.draft_id === undefined ? null : clamp(b.draft_id, 64).trim() || null;
  const ts = nowSec();
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO content_calendar (id, draft_id, scheduled_at, platform, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, draft_id, scheduled_at, platform, status, ts, ts).run();
  return json({ ok: true, id });
}

async function updateCalendar(request: Request, id: string, env: Env): Promise<Response> {
  requireJson(request);
  const b = await readJson(request);
  const cur = await env.DB.prepare(
    "SELECT draft_id, scheduled_at, platform, status FROM content_calendar WHERE id = ?"
  ).bind(id).first<ContentCalendarRow>();
  if (!cur) throw new HttpError(404, "not_found", "Calendar entry not found.");
  const draft_id = b.draft_id === undefined ? cur.draft_id : (b.draft_id === null ? null : clamp(b.draft_id, 64).trim() || null);
  const scheduled_at = b.scheduled_at === undefined ? cur.scheduled_at : clamp(b.scheduled_at, LIMITS.scheduled_at);
  if (!scheduled_at) throw new HttpError(422, "invalid_date", "scheduled_at is required.");
  const platform = b.platform === undefined ? cur.platform : (oneOf(b.platform, PLATFORMS) ?? cur.platform);
  const status = b.status === undefined ? cur.status : (oneOf(b.status, CALENDAR_STATUSES) ?? cur.status);
  await env.DB.prepare(
    "UPDATE content_calendar SET draft_id = ?, scheduled_at = ?, platform = ?, status = ?, updated_at = ? WHERE id = ?"
  ).bind(draft_id, scheduled_at, platform, status, nowSec(), id).run();
  return json({ ok: true, id });
}

async function deleteCalendar(id: string, env: Env): Promise<Response> {
  await env.DB.prepare("DELETE FROM content_calendar WHERE id = ?").bind(id).run();
  return json({ ok: true, id });
}


// ==================================================================
// DASHBOARD  (Content Studio stats)
// ==================================================================
async function routeDashboard(env: Env): Promise<Response> {
  const counts = await env.DB.prepare(
    `SELECT
       SUM(kind = 'draft') AS drafts,
       SUM(kind = 'idea')  AS ideas,
       SUM(status = 'approved')   AS approved,
       SUM(status = 'published')  AS published
       FROM content_drafts`
  ).first<{ drafts: number | null; ideas: number | null; approved: number | null; published: number | null }>();
  const cal = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM content_calendar WHERE status = 'planned'"
  ).first<{ n: number }>();
  const recent = await env.DB.prepare(
    "SELECT id, kind, title, body, platform, status, posted_url, created_at, updated_at FROM content_drafts ORDER BY updated_at DESC LIMIT 5"
  ).all<ContentDraftRow>();

  const aiPaused = (await getSetting(env, "growth.ai_status")) !== "active";
  const dash: GrowthDashboard = {
    drafts: Number(counts?.drafts ?? 0),
    ideas: Number(counts?.ideas ?? 0),
    approved: Number(counts?.approved ?? 0),
    published: Number(counts?.published ?? 0),
    scheduled: Number(cal?.n ?? 0),
    provider: growthEngine.provider.id,
    ai_status: growthEngine.status(aiPaused),
    recent: recent.results,
    calendar: [],
  };
  return json({ dashboard: dash });
}


// ==================================================================
// SETTINGS  (PAUSE-AI switch, already session-gated)
// ==================================================================
async function routeSettings(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const aiPaused = (await getSetting(env, "growth.ai_status")) !== "active";
    return json({ settings: { ai_status: growthEngine.status(aiPaused), provider: growthEngine.provider.id } });
  }
  if (request.method === "PUT") {
    requireJson(request);
    const b = await readJson(request);
    const ai_status = oneOf(b.ai_status, AI_STATUSES);
    if (!ai_status) throw new HttpError(422, "invalid_ai_status", "ai_status must be 'paused' or 'active'.");
    await setSetting(env, "growth.ai_status", ai_status);
    return json({ ok: true, settings: { ai_status: growthEngine.status(ai_status === "paused"), provider: growthEngine.provider.id } });
  }
  return error("Method not allowed", 405);
}

// ==================================================================
// GENERATE  (AI seam — Phase 1 is manual, provider is never called)
// ==================================================================
async function routeGenerate(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error("Method not allowed", 405);
  const aiPaused = (await getSetting(env, "growth.ai_status")) !== "active";
  const status = growthEngine.status(aiPaused);
  // The engine returns null for the manual provider, so no draft is produced.
  // The client shows an honest "AI paused / write manually" prompt.
  return json({
    ok: true,
    provider: growthEngine.provider.id,
    ai_status: status,
    text: null,
    message: status === "paused"
      ? "AI generation is paused or not connected. Write the post manually and copy it from the Studio."
      : "Generating…",
  });
}

