import type { Env } from "../types";
import { HttpError } from "../types";

export type PromotionStore = "redbubble" | "teepublic" | "kofi";
export type PromotionStatus = "draft" | "published" | "archived";
export interface PromotionRow { id:string; store:PromotionStore; title:string; description:string; destination_url:string; cta_label:string; image_ref:string; image_content_type:string|null; status:PromotionStatus; homepage_featured:number; sort_order:number; created_at:number; updated_at:number }
const STORES: PromotionStore[] = ["redbubble","teepublic","kofi"];
const STATUSES: PromotionStatus[] = ["draft","published","archived"];
const DEFAULTS: Record<PromotionStore, { url:string; cta:string }> = {
  redbubble:{ url:"https://www.redbubble.com/people/Boztik-Designs/shop", cta:"Shop Redbubble" },
  teepublic:{ url:"https://www.teepublic.com/user/boztik-designs", cta:"Shop TeePublic" },
  kofi:{ url:"https://ko-fi.com/boztik/shop", cta:"Get Wallpapers" },
};
export const nowSec = () => Math.floor(Date.now()/1000);
export const isStore = (v: unknown): v is PromotionStore => typeof v === "string" && STORES.includes(v as PromotionStore);
export const isStatus = (v: unknown): v is PromotionStatus => typeof v === "string" && STATUSES.includes(v as PromotionStatus);
export function validDestination(value: unknown, store: PromotionStore): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULTS[store].url;
  let u: URL; try { u = new URL(raw); } catch { throw new HttpError(422,"invalid_destination","Use a valid HTTPS store or product URL."); }
  if (u.protocol !== "https:" || u.username || u.password) throw new HttpError(422,"invalid_destination","Use a valid HTTPS store or product URL.");
  const allowed = store === "redbubble" ? ["redbubble.com"] : store === "teepublic" ? ["teepublic.com"] : ["ko-fi.com"];
  if (!allowed.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`))) throw new HttpError(422,"invalid_destination","The destination must belong to the selected store.");
  return u.toString();
}
export function cleanPromotion(input: Record<string, unknown>, existing?: PromotionRow) {
  const store = "store" in input ? (isStore(input.store) ? input.store : (()=>{throw new HttpError(422,"invalid_store","Choose Redbubble, TeePublic or Ko-fi Wallpapers.");})()) : existing?.store;
  if (!store) throw new HttpError(422,"invalid_store","Choose a store.");
  const title = "title" in input ? String(input.title ?? "").trim().slice(0,100) : existing?.title ?? "";
  if (!title) throw new HttpError(422,"invalid_title","A title is required.");
  const description = "description" in input ? String(input.description ?? "").trim().slice(0,600) : existing?.description ?? "";
  const status = "status" in input ? (isStatus(input.status) ? input.status : (()=>{throw new HttpError(422,"invalid_status","Invalid status.");})()) : existing?.status ?? "draft";
  const featured = "homepage_featured" in input ? input.homepage_featured === true : !!existing?.homepage_featured;
  if (store === "kofi" && featured) throw new HttpError(422,"kofi_not_featureable","Ko-fi wallpaper promotions cannot appear in New Releases.");
  const cta = "cta_label" in input ? String(input.cta_label ?? "").trim().slice(0,48) : existing?.cta_label ?? DEFAULTS[store].cta;
  if (!cta) throw new HttpError(422,"invalid_cta","A CTA label is required.");
  return {store,title,description,status,homepage_featured:featured?1:0,cta_label:cta,destination_url:validDestination(input.destination_url ?? existing?.destination_url,store)};
}
export async function listPromotions(env: Env, publicOnly:boolean, store?: string) {
  const where = publicOnly ? "status = 'published'" : "1=1";
  const filter = isStore(store) ? " AND store = ?" : "";
  return (await env.DB.prepare(`SELECT * FROM store_promotions WHERE ${where}${filter} ORDER BY sort_order ASC, updated_at DESC`).bind(...(isStore(store)?[store]:[])).all<PromotionRow>()).results;
}
export async function getPromotion(env:Env,id:string) { return env.DB.prepare("SELECT * FROM store_promotions WHERE id = ?").bind(id).first<PromotionRow>(); }
export async function publicPromotion(env:Env,id:string) { return env.DB.prepare("SELECT * FROM store_promotions WHERE id = ? AND status = 'published'").bind(id).first<PromotionRow>(); }
export const publicDto = (p:PromotionRow) => ({id:p.id,store:p.store,title:p.title,description:p.description,destination_url:p.destination_url,cta_label:p.cta_label,image_url:p.image_ref.startsWith("r2:") ? `/api/public/promotion-image/${encodeURIComponent(p.id)}` : p.image_ref,homepage_featured:!!p.homepage_featured,sort_order:p.sort_order,created_at:p.created_at});
