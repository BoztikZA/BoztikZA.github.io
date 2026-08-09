import { config } from "./config.js";
import { supabase, safeFileName } from "./shared.js";

export async function listDeliveries() {
  const { data: deliveries, error } = await supabase().from("deliveries").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  if (!deliveries.length) return deliveries;
  const ids = deliveries.map(d => d.id);
  const { data: files, error: filesError } = await supabase().from("delivery_files").select("*").in("delivery_id", ids).order("created_at");
  if (filesError) throw filesError;
  const filesByDelivery = {};
  for (const file of files) (filesByDelivery[file.delivery_id] ??= []).push(file);
  return deliveries.map(d => ({ ...d, delivery_files: filesByDelivery[d.id] || [] }));
}
export async function createDelivery(metadata, files, onProgress) {
  const id = metadata.id; const uploaded = []; let deliveryInserted = false;
  try {
    for (let i = 0; i < files.length; i++) { const file = files[i], path = `${id}/${crypto.randomUUID()}-${safeFileName(file.name)}`; const { error } = await supabase().storage.from(config.storageBucket).upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" }); if (error) throw error; uploaded.push({ delivery_id: id, file_path: path, file_name: file.name, file_size: file.size }); onProgress?.((i + 1) / files.length); }
    const { error } = await supabase().from("deliveries").insert({ ...metadata, file_path: uploaded[0].file_path, file_name: uploaded[0].file_name, file_size: uploaded.reduce((total, file) => total + file.file_size, 0) });
    if (error) throw error;
    deliveryInserted = true;
    const { error: filesError } = await supabase().from("delivery_files").insert(uploaded);
    if (filesError) throw filesError;
  } catch (error) {
    console.error("[Boztik Deliver] createDelivery failed — rolling back:", { deliveryId: id, filesUploaded: uploaded.length, deliveryRowInserted: deliveryInserted, message: error?.message, code: error?.code });
    // Roll back EVERYTHING that succeeded before the failure — not just
    // storage. Leaving the deliveries row in place after storage cleanup
    // (the previous bug) is exactly what produced an orphaned delivery
    // record pointing at a deleted object.
    if (uploaded.length) {
      const { error: removeError } = await supabase().storage.from(config.storageBucket).remove(uploaded.map(file => file.file_path));
      if (removeError) console.error("[Boztik Deliver] Rollback: failed to remove uploaded storage objects:", removeError);
    }
    if (deliveryInserted) {
      const { error: deleteError } = await supabase().from("deliveries").delete().eq("id", id);
      if (deleteError) console.error("[Boztik Deliver] Rollback: failed to delete orphaned deliveries row:", deleteError);
    }
    throw error;
  }
}
export async function deleteDelivery(delivery) { const files = delivery.delivery_files?.length ? delivery.delivery_files : [{ file_path: delivery.file_path }]; const { error: storageError } = await supabase().storage.from(config.storageBucket).remove(files.map(file => file.file_path)); if (storageError) throw storageError; const { error } = await supabase().from("deliveries").delete().eq("id", delivery.id); if (error) throw error; }
export async function duplicateDelivery(delivery) { const { delivery_files, id, created_at, download_count, ...copy } = delivery; const newId = `${id}-COPY-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; const { error } = await supabase().from("deliveries").insert({ ...copy, id: newId, project_name: `${copy.project_name} (copy)`, expires_at: new Date(Date.now() + 24 * 3600000).toISOString() }); if (error) throw error; return newId; }
export async function getPublicDelivery(id) {
  console.log("[Boztik Deliver] Looking up delivery:", id);
  const { data, error } = await supabase().from("deliveries_public").select("*").eq("id", id).maybeSingle();
  console.log("[Boztik Deliver] deliveries_public result:", { data, error });
  if (error) { console.error("[Boztik Deliver] deliveries_public error:", { message: error.message, code: error.code, details: error.details, hint: error.hint }); throw error; }
  if (!data) { console.warn("[Boztik Deliver] No matching row in deliveries_public for id:", id); return null; }
  try {
    const { data: files, error: filesError } = await supabase().from("delivery_files_public").select("*").eq("delivery_id", id).order("created_at");
    console.log("[Boztik Deliver] delivery_files_public result:", { files, filesError });
    if (filesError) throw filesError;
    return { ...data, delivery_files: files };
  } catch (filesError) {
    // delivery_files_public may not exist / may be unreachable — fall back
    // to the single-file columns already present on deliveries_public so
    // the client page still renders instead of failing the whole delivery.
    console.error("[Boztik Deliver] delivery_files_public error — falling back to single-file mode:", { message: filesError.message, code: filesError.code, details: filesError.details, hint: filesError.hint });
    return { ...data, delivery_files: null };
  }
}
function logStorageError(fnName, file, error) {
  console.error(`[Boztik Deliver] ${fnName} error:`, {
    file_path: file.file_path,
    file_name: file.file_name,
    bucket: config.storageBucket,
    message: error?.message,
    statusCode: error?.statusCode,
    status: error?.status,
    code: error?.code,
    details: error?.details,
    hint: error?.hint
  });
}

async function requestServerSignedUrl(deliveryId, file, mode) {
  if (!file?.file_path) { const error = new Error(`requestServerSignedUrl: file.file_path is missing (mode: ${mode}).`); console.error("[Boztik Deliver]", error.message, { file }); throw error; }
  if (!deliveryId) { const error = new Error("requestServerSignedUrl: no deliveryId provided."); console.error("[Boztik Deliver]", error.message); throw error; }
  console.log(`[Boztik Deliver] Requesting server-signed URL (${mode}):`, { deliveryId, file_path: file.file_path });
  const response = await fetch(`${config.supabaseUrl}/functions/v1/deliver-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": config.supabaseAnonKey, "Authorization": `Bearer ${config.supabaseAnonKey}` },
    body: JSON.stringify({ deliveryId, filePath: file.file_path, mode })
  });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  console.log(`[Boztik Deliver] deliver-file (${mode}) response:`, { status: response.status, payload });
  if (!response.ok || !payload?.signedUrl) {
    const error = new Error(payload?.message || payload?.error || `deliver-file returned ${response.status}`);
    error.statusCode = response.status;
    error.code = payload?.error;
    logStorageError(mode === "preview" ? "signedPreview" : "signedDownload", file, error);
    throw error;
  }
  return payload.signedUrl;
}

export async function signedDownload(deliveryId, file) { return requestServerSignedUrl(deliveryId, file, "download"); }
export async function signedPreview(deliveryId, file) { return requestServerSignedUrl(deliveryId, file, "preview"); }
export async function recordDownload(id) { await supabase().rpc("increment_delivery_downloads", { p_delivery_id: id }); }