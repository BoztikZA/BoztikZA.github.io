import { config } from "./config.js";
import { supabase, safeFileName } from "./shared.js";

const DELIVER_FILE_FUNCTION =
  `${config.supabaseUrl}/functions/v1/deliver-file`;

async function requestServerSignedUrl(file, mode) {
  if (!file?.file_path) {
    const error = new Error(
      `requestServerSignedUrl: file.file_path is missing — cannot request a signed URL for an unknown object.`
    );

    console.error("[Boztik Deliver]", error.message, { file, mode });
    throw error;
  }

  const deliveryId = file.delivery_id || file.deliveryId;

  if (!deliveryId) {
    const error = new Error(
      "requestServerSignedUrl: delivery ID is missing."
    );

    console.error("[Boztik Deliver]", error.message, { file, mode });
    throw error;
  }

  console.log("[Boztik Deliver] Requesting server-side signed URL:", {
    deliveryId,
    filePath: file.file_path,
    fileName: file.file_name,
    mode
  });

  const response = await fetch(DELIVER_FILE_FUNCTION, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": config.supabaseAnonKey,
      "Authorization": `Bearer ${config.supabaseAnonKey}`
    },
    body: JSON.stringify({
      deliveryId,
      filePath: file.file_path,
      mode
    })
  });

  let result = null;

  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Edge Function request failed with HTTP ${response.status}.`;

    const error = new Error(message);

    console.error("[Boztik Deliver] Edge Function failed:", {
      status: response.status,
      statusText: response.statusText,
      deliveryId,
      filePath: file.file_path,
      mode,
      result
    });

    throw error;
  }

  if (!result?.signedUrl) {
    const error = new Error(
      "The server did not return a signed download URL."
    );

    console.error("[Boztik Deliver] Invalid Edge Function response:", {
      deliveryId,
      filePath: file.file_path,
      mode,
      result
    });

    throw error;
  }

  console.log("[Boztik Deliver] Server-side signed URL received:", {
    deliveryId,
    filePath: file.file_path,
    mode,
    expiresIn: result.expiresIn
  });

  return result.signedUrl;
}

export async function listDeliveries() {
  const {
    data: deliveries,
    error
  } = await supabase()
    .from("deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  if (!deliveries.length) return deliveries;

  const ids = deliveries.map(d => d.id);

  const {
    data: files,
    error: filesError
  } = await supabase()
    .from("delivery_files")
    .select("*")
    .in("delivery_id", ids)
    .order("created_at");

  if (filesError) throw filesError;

  const filesByDelivery = {};

  for (const file of files) {
    (filesByDelivery[file.delivery_id] ??= []).push(file);
  }

  return deliveries.map(d => ({
    ...d,
    delivery_files: filesByDelivery[d.id] || []
  }));
}

export async function createDelivery(metadata, files, onProgress) {
  const id = metadata.id;
  const uploaded = [];
  let deliveryInserted = false;

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const path =
        `${id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;

      const { error } = await supabase()
        .storage
        .from(config.storageBucket)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "application/octet-stream"
        });

      if (error) throw error;

      uploaded.push({
        delivery_id: id,
        file_path: path,
        file_name: file.name,
        file_size: file.size
      });

      onProgress?.((i + 1) / files.length);
    }

    const { error } = await supabase()
      .from("deliveries")
      .insert({
        ...metadata,
        file_path: uploaded[0].file_path,
        file_name: uploaded[0].file_name,
        file_size: uploaded.reduce(
          (total, file) => total + file.file_size,
          0
        )
      });

    if (error) throw error;

    deliveryInserted = true;

    const { error: filesError } = await supabase()
      .from("delivery_files")
      .insert(uploaded);

    if (filesError) throw filesError;

  } catch (error) {
    console.error(
      "[Boztik Deliver] createDelivery failed — rolling back:",
      {
        deliveryId: id,
        filesUploaded: uploaded.length,
        deliveryRowInserted: deliveryInserted,
        message: error?.message,
        code: error?.code
      }
    );

    if (uploaded.length) {
      const { error: removeError } = await supabase()
        .storage
        .from(config.storageBucket)
        .remove(uploaded.map(file => file.file_path));

      if (removeError) {
        console.error(
          "[Boztik Deliver] Rollback: failed to remove uploaded storage objects:",
          removeError
        );
      }
    }

    if (deliveryInserted) {
      const { error: deleteError } = await supabase()
        .from("deliveries")
        .delete()
        .eq("id", id);

      if (deleteError) {
        console.error(
          "[Boztik Deliver] Rollback: failed to delete orphaned deliveries row:",
          deleteError
        );
      }
    }

    throw error;
  }
}

export async function deleteDelivery(delivery) {
  const files = delivery.delivery_files?.length
    ? delivery.delivery_files
    : [{ file_path: delivery.file_path }];

  const { error: storageError } = await supabase()
    .storage
    .from(config.storageBucket)
    .remove(files.map(file => file.file_path));

  if (storageError) throw storageError;

  const { error } = await supabase()
    .from("deliveries")
    .delete()
    .eq("id", delivery.id);

  if (error) throw error;
}

export async function duplicateDelivery(delivery) {
  const {
    delivery_files,
    id,
    created_at,
    download_count,
    ...copy
  } = delivery;

  const newId =
    `${id}-COPY-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const { error } = await supabase()
    .from("deliveries")
    .insert({
      ...copy,
      id: newId,
      project_name: `${copy.project_name} (copy)`,
      expires_at: new Date(Date.now() + 24 * 3600000).toISOString()
    });

  if (error) throw error;

  return newId;
}

export async function getPublicDelivery(id) {
  console.log("[Boztik Deliver] Looking up delivery:", id);

  const {
    data,
    error
  } = await supabase()
    .from("deliveries_public")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  console.log("[Boztik Deliver] deliveries_public result:", {
    data,
    error
  });

  if (error) {
    console.error("[Boztik Deliver] deliveries_public error:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint
    });

    throw error;
  }

  if (!data) {
    console.warn(
      "[Boztik Deliver] No matching row in deliveries_public for id:",
      id
    );

    return null;
  }

  try {
    const {
      data: files,
      error: filesError
    } = await supabase()
      .from("delivery_files_public")
      .select("*")
      .eq("delivery_id", id)
      .order("created_at");

    console.log(
      "[Boztik Deliver] delivery_files_public result:",
      {
        files,
        filesError
      }
    );

    if (filesError) throw filesError;

    return {
      ...data,
      delivery_files: files
    };

  } catch (filesError) {
    console.error(
      "[Boztik Deliver] delivery_files_public error — falling back to single-file mode:",
      {
        message: filesError.message,
        code: filesError.code,
        details: filesError.details,
        hint: filesError.hint
      }
    );

    return {
      ...data,
      delivery_files: null
    };
  }
}

export async function signedDownload(file) {
  return requestServerSignedUrl(file, "download");
}

export async function signedPreview(file) {
  return requestServerSignedUrl(file, "preview");
}

export async function recordDownload(id) {
  await supabase().rpc(
    "increment_delivery_downloads",
    {
      p_delivery_id: id
    }
  );
}