import { config } from "./config.js";
import { safeFileName, supabase } from "./shared.js";

const DELIVER_FILE_FUNCTION = `${config.supabaseUrl}/functions/v1/deliver-file`;
const REDDIT_METADATA_FUNCTION = `${config.supabaseUrl}/functions/v1/reddit-metadata`;
const STORAGE_USAGE_FUNCTION = `${config.supabaseUrl}/functions/v1/storage-usage`;

export const DELIVERY_SOURCES = Object.freeze(["reddit", "private", "paid", "free", "returning", "other"]);

async function signedStorageUrl(file, mode) {
  const options = mode === "download"
    ? { download: file.file_name || file.file_path.split("/").pop() }
    : undefined;
  const { data, error } = await supabase().storage.from(config.storageBucket)
    .createSignedUrl(file.file_path, mode === "preview" ? 300 : 60, options);
  if (error || !data?.signedUrl) throw error || new Error("Could not prepare this file.");
  return data.signedUrl;
}

async function signedServerUrl(file, mode) {
  const deliveryId = file?.delivery_id || file?.deliveryId;
  if (!deliveryId || !file?.file_path) throw new Error("A delivery and file are required.");
  let response;
  try {
    response = await fetch(DELIVER_FILE_FUNCTION, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`
      },
      body: JSON.stringify({ deliveryId, filePath: file.file_path, fileName: file.file_name, mode })
    });
  } catch {
    return signedStorageUrl(file, mode);
  }
  let result = null;
  try { result = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    // Keep the established private-Storage fallback only for a missing or
    // unavailable signer; authorization/expiry errors are never bypassed.
    if (response.status === 404 || response.status >= 500) return signedStorageUrl(file, mode);
    throw new Error(result?.message || result?.error || `Could not prepare this file (HTTP ${response.status}).`);
  }
  return result?.signedUrl || signedStorageUrl(file, mode);
}

export async function listDeliveries() {
  const { data: deliveries, error } = await supabase().from("deliveries").select("*")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  if (!deliveries?.length) return [];
  const ids = deliveries.map(delivery => delivery.id);
  const [{ data: files, error: filesError }, { data: analytics, error: analyticsError }] = await Promise.all([
    supabase().from("delivery_files").select("*").in("delivery_id", ids).order("created_at"),
    supabase().from("delivery_analytics").select("*").in("delivery_id", ids)
      .eq("month_start", new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10))
  ]);
  if (filesError) throw filesError;
  if (analyticsError) console.warn("[Boztik Deliver] Monthly analytics could not be loaded:", analyticsError);
  const byDelivery = {};
  for (const file of files || []) {
    (byDelivery[file.delivery_id] ||= []).push(file);
  }
  const monthly = Object.fromEntries((analytics || []).map(row => [row.delivery_id, row]));
  return deliveries.map(delivery => ({
    ...delivery,
    delivery_files: byDelivery[delivery.id] || [],
    monthly_views: Number(monthly[delivery.id]?.view_count || 0),
    monthly_downloads: Number(monthly[delivery.id]?.download_count || 0),
    lifetime_views: Number(delivery.view_count || 0),
    lifetime_downloads: Number(delivery.download_count || 0)
  }));
}

export async function createDelivery(metadata, files, onProgress) {
  if (!metadata?.id || !files?.length) throw new Error("A delivery ID and at least one file are required.");
  const uploaded = [];
  let deliveryInserted = false;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = `${metadata.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error } = await supabase().storage.from(config.storageBucket).upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream"
      });
      if (error) throw error;
      uploaded.push({ delivery_id: metadata.id, file_path: path, file_name: file.name, file_size: file.size });
      onProgress?.((index + 1) / files.length);
    }
    const { error: deliveryError } = await supabase().from("deliveries").insert({
      ...metadata,
      file_path: uploaded[0].file_path,
      file_name: uploaded[0].file_name,
      file_size: uploaded.reduce((total, file) => total + file.file_size, 0)
    });
    if (deliveryError) throw deliveryError;
    deliveryInserted = true;
    const { error: filesError } = await supabase().from("delivery_files").insert(uploaded);
    if (filesError) throw filesError;
  } catch (error) {
    if (uploaded.length) await supabase().storage.from(config.storageBucket).remove(uploaded.map(file => file.file_path));
    if (deliveryInserted) await supabase().from("deliveries").delete().eq("id", metadata.id);
    throw error;
  }
}

export async function updateDelivery(deliveryId, updates = {}) {
  if (!deliveryId) throw new Error("A delivery ID is required.");
  const allowed = ["project_name", "client_name", "notes", "expires_at", "source", "source_meta", "reddit_source"];
  const payload = Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.includes(key)));
  if (!Object.keys(payload).length) throw new Error("No editable fields were supplied.");
  if (payload.expires_at) {
    const expiresAt = new Date(payload.expires_at);
    if (Number.isNaN(expiresAt.getTime())) throw new Error("The expiry date/time is invalid.");
    payload.expires_at = expiresAt.toISOString();
  }
  const { data, error } = await supabase().from("deliveries").update(payload).eq("id", deliveryId).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteDelivery(delivery) {
  const files = delivery.delivery_files?.length ? delivery.delivery_files : [{ file_path: delivery.file_path }];
  const paths = files.map(file => file.file_path).filter(Boolean);
  if (paths.length) {
    const { error } = await supabase().storage.from(config.storageBucket).remove(paths);
    if (error) throw error;
  }
  // Preserve the delivery row and all associated analytics as historical data.
  const { error } = await supabase().from("deliveries")
    .update({ storage_deleted_at: new Date().toISOString() }).eq("id", delivery.id);
  if (error) throw error;
}

export async function duplicateDelivery(delivery) {
  const newId = `${delivery.id}-COPY-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const sourceFiles = delivery.delivery_files?.length ? delivery.delivery_files : [delivery];
  const copied = [];
  try {
    for (const source of sourceFiles) {
      const filePath = `${newId}/${crypto.randomUUID()}-${safeFileName(source.file_name)}`;
      const { error } = await supabase().storage.from(config.storageBucket).copy(source.file_path, filePath);
      if (error) throw error;
      copied.push({ delivery_id: newId, file_path: filePath, file_name: source.file_name, file_size: source.file_size });
    }
    const { delivery_files, id, created_at, created_by, download_count, view_count, last_viewed_at, last_downloaded_at,
      monthly_views, monthly_downloads, lifetime_views, lifetime_downloads, storage_deleted_at, ...copy } = delivery;
    const { error: deliveryError } = await supabase().from("deliveries").insert({
      ...copy, id: newId, file_path: copied[0].file_path, file_name: copied[0].file_name,
      file_size: copied.reduce((total, file) => total + Number(file.file_size || 0), 0),
      project_name: `${copy.project_name} (copy)`, expires_at: new Date(Date.now() + 86400000).toISOString(),
      download_count: 0, view_count: 0, last_viewed_at: null, last_downloaded_at: null, storage_deleted_at: null
    });
    if (deliveryError) throw deliveryError;
    const { error: filesError } = await supabase().from("delivery_files").insert(copied);
    if (filesError) throw filesError;
    return newId;
  } catch (error) {
    if (copied.length) await supabase().storage.from(config.storageBucket).remove(copied.map(file => file.file_path));
    await supabase().from("deliveries").delete().eq("id", newId);
    throw error;
  }
}

export async function getPublicDelivery(id) {
  const { data, error } = await supabase().from("deliveries_public").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: files, error: filesError } = await supabase().from("delivery_files_public").select("*")
    .eq("delivery_id", id).order("created_at");
  if (filesError) console.warn("[Boztik Deliver] Files could not be loaded:", filesError);
  return { ...data, delivery_files: files || null };
}

async function record(rpc, id) {
  const { error } = await supabase().rpc(rpc, { p_delivery_id: id });
  if (error) { console.error(`[Boztik Deliver] ${rpc} failed:`, error); return false; }
  return true;
}
export const recordView = id => record("record_delivery_view", id);
export const recordDownload = id => record("record_delivery_download", id);
export const signedDownload = file => signedServerUrl(file, "download");
export const signedPreview = file => signedServerUrl(file, "preview");

export async function fetchRedditMetadata(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(REDDIT_METADATA_FUNCTION, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` },
      body: JSON.stringify({ url: (url || "").trim() })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.title) throw new Error(result?.message || "Could not read this Reddit thread's title.");
    return { title: result.title, subreddit: result.subreddit || null, author: result.author || null,
      canonicalUrl: result.canonicalUrl || result.redditUrl || url, redditUrl: result.redditUrl || url };
  } finally { clearTimeout(timeout); }
}

/**
 * Fetches authoritative Supabase storage usage from the server-side
 * `storage-usage` Edge Function, authenticated with the admin's sign-in
 * session. Uses the user's access token (never the service-role key).
 * Returns { storage, egress } where egress may be { available: false }.
 */
export async function fetchStorageUsage() {
  const { data, error } = await supabase().auth.getSession();
  if (error) throw error;
  const token = data?.session?.access_token;
  if (!token) throw new Error("You need to be signed in to view storage usage.");

  let response;
  try {
    response = await fetch(STORAGE_USAGE_FUNCTION, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`
      }
    });
  } catch {
    throw new Error("Could not reach the usage service.");
  }

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.message || result?.error || `Storage usage unavailable (HTTP ${response.status}).`);
  }
  return result || {};
}
