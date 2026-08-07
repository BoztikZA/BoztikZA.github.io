import { config } from "./config.js";
import { supabase, safeFileName } from "./shared.js";

export async function listDeliveries() { const { data, error } = await supabase().from("deliveries").select("*, delivery_files(*)").order("created_at", { ascending: false }).limit(100); if (error) throw error; return data; }
export async function createDelivery(metadata, files, onProgress) {
  const id = metadata.id; const uploaded = [];
  try {
    for (let i = 0; i < files.length; i++) { const file = files[i], path = `${id}/${crypto.randomUUID()}-${safeFileName(file.name)}`; const { error } = await supabase().storage.from(config.storageBucket).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" }); if (error) throw error; uploaded.push({ delivery_id: id, file_path: path, file_name: file.name, file_size: file.size }); onProgress?.((i + 1) / files.length); }
    const { error } = await supabase().from("deliveries").insert({ ...metadata, file_path: uploaded[0].file_path, file_name: uploaded[0].file_name, file_size: uploaded.reduce((total, file) => total + file.file_size, 0) }); if (error) throw error;
    const { error: filesError } = await supabase().from("delivery_files").insert(uploaded); if (filesError) throw filesError;
  } catch (error) { if (uploaded.length) await supabase().storage.from(config.storageBucket).remove(uploaded.map(file => file.file_path)); throw error; }
}
export async function deleteDelivery(delivery) { const files = delivery.delivery_files?.length ? delivery.delivery_files : [{ file_path: delivery.file_path }]; const { error: storageError } = await supabase().storage.from(config.storageBucket).remove(files.map(file => file.file_path)); if (storageError) throw storageError; const { error } = await supabase().from("deliveries").delete().eq("id", delivery.id); if (error) throw error; }
export async function duplicateDelivery(delivery) { const { delivery_files, id, created_at, download_count, ...copy } = delivery; const newId = `${id}-COPY-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; const { error } = await supabase().from("deliveries").insert({ ...copy, id: newId, project_name: `${copy.project_name} (copy)`, expires_at: new Date(Date.now() + 24 * 3600000).toISOString() }); if (error) throw error; return newId; }
export async function getPublicDelivery(id) { const { data, error } = await supabase().from("deliveries_public").select("*").eq("id", id).maybeSingle(); if (error || !data) { if (error) throw error; return null; } const { data: files, error: filesError } = await supabase().from("delivery_files_public").select("*").eq("delivery_id", id).order("created_at"); if (filesError) throw filesError; return { ...data, delivery_files: files }; }
export async function signedDownload(file) { const { data, error } = await supabase().storage.from(config.storageBucket).createSignedUrl(file.file_path, 60, { download: file.file_name }); if (error) throw error; return data.signedUrl; }
export async function recordDownload(id) { await supabase().rpc("increment_delivery_downloads", { p_delivery_id: id }); }