import { config } from "./config.js";
import { supabase, safeFileName } from "./shared.js";

const DELIVER_FILE_FUNCTION =
  `${config.supabaseUrl}/functions/v1/deliver-file`;

const REDDIT_METADATA_FUNCTION =
  `${config.supabaseUrl}/functions/v1/reddit-metadata`;

/*
 * Known delivery source values. "other" and legacy rows with no
 * source at all are both treated as a generic/private delivery
 * wherever this list is consulted — nothing breaks for old rows.
 */
export const DELIVERY_SOURCES = Object.freeze([
  "reddit",
  "private",
  "paid",
  "free",
  "returning",
  "other"
]);


/* =========================================================
   SIGNED STORAGE URL HELPERS
========================================================= */

async function requestStorageSignedUrl(file, mode) {
  const options =
    mode === "download"
      ? {
          download:
            file.file_name ||
            file.file_path.split("/").pop()
        }
      : undefined;

  const { data, error } =
    await supabase()
      .storage
      .from(config.storageBucket)
      .createSignedUrl(
        file.file_path,
        mode === "preview" ? 300 : 60,
        options
      );

  if (error || !data?.signedUrl) {
    throw (
      error ||
      new Error("Could not prepare this file.")
    );
  }

  return data.signedUrl;
}


async function requestServerSignedUrl(file, mode) {
  if (!file?.file_path) {
    const error = new Error(
      `requestServerSignedUrl: file.file_path is missing — cannot request a signed URL for an unknown object.`
    );

    console.error(
      "[Boztik Deliver]",
      error.message,
      { file, mode }
    );

    throw error;
  }

  const deliveryId =
    file.delivery_id ||
    file.deliveryId;

  if (!deliveryId) {
    const error = new Error(
      "requestServerSignedUrl: delivery ID is missing."
    );

    console.error(
      "[Boztik Deliver]",
      error.message,
      { file, mode }
    );

    throw error;
  }

  const response = await fetch(
    /*
     * The apikey is also passed as a URL param (in addition to
     * the header below) as a defensive fallback. Supabase's
     * gateway accepts either — this guards against any
     * intermediary stripping custom headers on this cross-origin
     * POST without changing what key is used or how it's
     * validated.
     */
    `${DELIVER_FILE_FUNCTION}?apikey=${encodeURIComponent(config.supabaseAnonKey)}`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "apikey": config.supabaseAnonKey,
        "Authorization":
          `Bearer ${config.supabaseAnonKey}`
      },

      body: JSON.stringify({
        deliveryId,
        filePath: file.file_path,
        fileName: file.file_name,
        mode
      })
    }
  );

  let result = null;

  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    /*
     * A private Storage policy remains the fallback
     * trust boundary. This keeps previously deployed
     * delivery pages working while the optional Edge
     * Function is being deployed or updated.
     */
    if (
      response.status === 404 ||
      response.status >= 500
    ) {
      return requestStorageSignedUrl(
        file,
        mode
      );
    }

    const message =
      result?.message ||
      result?.error ||
      `Edge Function request failed with HTTP ${response.status}.`;

    throw new Error(message);
  }

  if (!result?.signedUrl) {
    return requestStorageSignedUrl(
      file,
      mode
    );
  }

  return result.signedUrl;
}


/* =========================================================
   LIST DELIVERIES
========================================================= */

export async function listDeliveries() {
  const {
    data: deliveries,
    error
  } = await supabase()
    .from("deliveries")
    .select("*")
    .order("created_at", {
      ascending: false
    })
    .limit(100);

  if (error) {
    throw error;
  }

  if (!deliveries.length) {
    return deliveries;
  }

  const ids =
    deliveries.map(
      delivery => delivery.id
    );

  const {
    data: files,
    error: filesError
  } = await supabase()
    .from("delivery_files")
    .select("*")
    .in("delivery_id", ids)
    .order("created_at");

  if (filesError) {
    throw filesError;
  }

  const filesByDelivery = {};

  for (const file of files || []) {
    (
      filesByDelivery[file.delivery_id] ??=
        []
    ).push(file);
  }


  /*
   * Current-month analytics.
   *
   * We calculate the month using UTC so that it
   * matches Supabase/Postgres:
   *
   * date_trunc('month', now())
   */

  const now = new Date();

  const monthStart =
    new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1
      )
    )
      .toISOString()
      .slice(0, 10);

  const {
    data: analytics,
    error: analyticsError
  } = await supabase()
    .from("delivery_analytics")
    .select("*")
    .in("delivery_id", ids)
    .eq("month_start", monthStart);

  if (analyticsError) {
    console.warn(
      "[Boztik Deliver] Monthly analytics could not be loaded:",
      analyticsError
    );
  }

  const analyticsByDelivery = {};

  for (const row of analytics || []) {
    analyticsByDelivery[row.delivery_id] =
      row;
  }

  return deliveries.map(delivery => {
    const monthly =
      analyticsByDelivery[
        delivery.id
      ] || {};

    return {
      ...delivery,

      delivery_files:
        filesByDelivery[
          delivery.id
        ] || [],

      monthly_views:
        Number(
          monthly.view_count || 0
        ),

      monthly_downloads:
        Number(
          monthly.download_count || 0
        ),

      lifetime_views:
        Number(
          delivery.view_count || 0
        ),

      lifetime_downloads:
        Number(
          delivery.download_count || 0
        ),

      last_viewed_at:
        delivery.last_viewed_at ||
        null,

      last_downloaded_at:
        delivery.last_downloaded_at ||
        null
    };
  });
}


/* =========================================================
   CREATE DELIVERY
========================================================= */

export async function createDelivery(
  metadata,
  files,
  onProgress
) {
  const id = metadata.id;

  const uploaded = [];

  let deliveryInserted = false;

  try {
    for (
      let i = 0;
      i < files.length;
      i++
    ) {
      const file = files[i];

      const path =
        `${id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;

      const { error } =
        await supabase()
          .storage
          .from(config.storageBucket)
          .upload(
            path,
            file,
            {
              cacheControl: "3600",
              upsert: false,
              contentType:
                file.type ||
                "application/octet-stream"
            }
          );

      if (error) {
        throw error;
      }

      uploaded.push({
        delivery_id: id,
        file_path: path,
        file_name: file.name,
        file_size: file.size
      });

      onProgress?.(
        (i + 1) / files.length
      );
    }

    const { error } =
      await supabase()
        .from("deliveries")
        .insert({
          ...metadata,

          file_path:
            uploaded[0].file_path,

          file_name:
            uploaded[0].file_name,

          file_size:
            uploaded.reduce(
              (total, file) =>
                total +
                file.file_size,
              0
            )
        });

    if (error) {
      throw error;
    }

    deliveryInserted = true;

    const {
      error: filesError
    } = await supabase()
      .from("delivery_files")
      .insert(uploaded);

    if (filesError) {
      throw filesError;
    }

  } catch (error) {

    console.error(
      "[Boztik Deliver] createDelivery failed — rolling back:",
      error
    );

    if (uploaded.length) {
      await supabase()
        .storage
        .from(config.storageBucket)
        .remove(
          uploaded.map(
            file =>
              file.file_path
          )
        );
    }

    if (deliveryInserted) {
      await supabase()
        .from("deliveries")
        .delete()
        .eq("id", id);
    }

    throw error;
  }
}


/* =========================================================
   UPDATE DELIVERY
   NEW
========================================================= */

/**
 * Updates an existing delivery in place.
 *
 * IMPORTANT:
 * - Does NOT create a new delivery.
 * - Does NOT change the delivery ID.
 * - Does NOT touch Storage.
 * - Does NOT touch analytics.
 * - Existing public URL therefore remains unchanged.
 *
 * Supported fields:
 * - project_name
 * - expires_at
 *
 * Additional fields can be added here only after confirming
 * their real database column names.
 */
export async function updateDelivery(
  deliveryId,
  updates = {}
) {
  if (!deliveryId) {
    throw new Error(
      "updateDelivery: delivery ID is required."
    );
  }

  if (
    !updates ||
    typeof updates !== "object"
  ) {
    throw new Error(
      "updateDelivery: updates must be an object."
    );
  }


  /*
   * Only allow known delivery metadata fields.
   *
   * This is deliberately restrictive so the dashboard
   * cannot accidentally overwrite analytics, IDs,
   * storage paths, timestamps, etc.
   */

  const allowed = [
    "project_name",
    "client_name",
    "notes",
    "expires_at",
    "source",
    "source_meta",
    "reddit_source"
  ];

  const payload = {};

  for (const field of allowed) {
    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        field
      )
    ) {
      payload[field] =
        updates[field];
    }
  }


  /*
   * Nothing to update.
   */

  if (
    Object.keys(payload).length === 0
  ) {
    throw new Error(
      "updateDelivery: no editable fields were supplied."
    );
  }


  /*
   * Validate project name.
   */

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "project_name"
    )
  ) {
    if (
      typeof payload.project_name !==
      "string"
    ) {
      throw new Error(
        "Delivery name must be text."
      );
    }

    payload.project_name =
      payload.project_name.trim();

    if (
      !payload.project_name
    ) {
      throw new Error(
        "Delivery name cannot be empty."
      );
    }

    if (
      payload.project_name.length >
      200
    ) {
      throw new Error(
        "Delivery name cannot exceed 200 characters."
      );
    }
  }


  /*
   * Validate client name.
   */

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "client_name"
    )
  ) {
    if (
      typeof payload.client_name !==
      "string"
    ) {
      throw new Error(
        "Client name must be text."
      );
    }

    payload.client_name =
      payload.client_name.trim();

    if (!payload.client_name) {
      throw new Error(
        "Client name cannot be empty."
      );
    }

    if (
      payload.client_name.length >
      120
    ) {
      throw new Error(
        "Client name cannot exceed 120 characters."
      );
    }
  }


  /*
   * Validate notes. Empty string / null both mean
   * "no notes" — normalise to null so the column
   * matches how createDelivery treats an empty field.
   */

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "notes"
    )
  ) {
    if (
      payload.notes !== null &&
      typeof payload.notes !== "string"
    ) {
      throw new Error(
        "Notes must be text."
      );
    }

    const trimmed =
      (payload.notes || "").trim();

    if (trimmed.length > 2000) {
      throw new Error(
        "Notes cannot exceed 2000 characters."
      );
    }

    payload.notes = trimmed || null;
  }


  /*
   * Validate source. Must be one of the known values,
   * or null to clear it back to "unknown/private".
   */

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "source"
    )
  ) {
    if (
      payload.source !== null &&
      !DELIVERY_SOURCES.includes(payload.source)
    ) {
      throw new Error(
        `Delivery source must be one of: ${DELIVERY_SOURCES.join(", ")}.`
      );
    }
  }


  /*
   * Validate source_meta. Kept as a plain object/null —
   * never trust it blindly since it can carry data pulled
   * from an external Reddit fetch.
   */

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "source_meta"
    )
  ) {
    if (
      payload.source_meta !== null &&
      (
        typeof payload.source_meta !== "object" ||
        Array.isArray(payload.source_meta)
      )
    ) {
      throw new Error(
        "source_meta must be a plain object or null."
      );
    }
  }


  /*
   * Validate reddit_source. Same shape rules as source_meta above —
   * plain object or null. This is independent of source/source_meta:
   * it is the optional "original Reddit post" attribution shown to
   * clients, not the delivery channel.
   */

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "reddit_source"
    )
  ) {
    if (
      payload.reddit_source !== null &&
      (
        typeof payload.reddit_source !== "object" ||
        Array.isArray(payload.reddit_source)
      )
    ) {
      throw new Error(
        "reddit_source must be a plain object or null."
      );
    }
  }


  /*
   * Validate expiry.
   *
   * We allow null only if the existing database
   * column permits it. Otherwise the database will
   * reject it safely.
   */

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "expires_at"
    )
  ) {
    if (
      payload.expires_at !== null
    ) {
      const expiryDate =
        new Date(
          payload.expires_at
        );

      if (
        Number.isNaN(
          expiryDate.getTime()
        )
      ) {
        throw new Error(
          "The expiry date/time is invalid."
        );
      }

      payload.expires_at =
        expiryDate.toISOString();
    }
  }


  const {
    data,
    error
  } = await supabase()
    .from("deliveries")
    .update(payload)
    .eq("id", deliveryId)
    .select("*")
    .single();

  if (error) {
    console.error(
      "[Boztik Deliver] updateDelivery failed:",
      error
    );

    throw error;
  }

  return data;
}


/* =========================================================
   DELETE DELIVERY
========================================================= */

export async function deleteDelivery(
  delivery
) {
  const files =
    delivery.delivery_files?.length
      ? delivery.delivery_files
      : [
          {
            file_path:
              delivery.file_path
          }
        ];

  const {
    error: storageError
  } = await supabase()
    .storage
    .from(config.storageBucket)
    .remove(
      files.map(
        file =>
          file.file_path
      )
    );

  if (storageError) {
    throw storageError;
  }

  const { error } =
    await supabase()
      .from("deliveries")
      .delete()
      .eq("id", delivery.id);

  if (error) {
    throw error;
  }
}


/* =========================================================
   DUPLICATE DELIVERY
========================================================= */

export async function duplicateDelivery(
  delivery
) {
  const {
    delivery_files,
    id,
    created_at,
    download_count,
    view_count,
    last_viewed_at,
    last_downloaded_at,
    ...copy
  } = delivery;

  const newId =
    `${id}-COPY-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

  const sourceFiles =
    delivery_files?.length
      ? delivery_files
      : [
          {
            file_path:
              delivery.file_path,

            file_name:
              delivery.file_name,

            file_size:
              delivery.file_size
          }
        ];

  const copiedFiles = [];

  try {

    for (
      const source of sourceFiles
    ) {
      const filePath =
        `${newId}/${crypto.randomUUID()}-${safeFileName(source.file_name)}`;

      const {
        error: copyError
      } =
        await supabase()
          .storage
          .from(
            config.storageBucket
          )
          .copy(
            source.file_path,
            filePath
          );

      if (copyError) {
        throw copyError;
      }

      copiedFiles.push({
        delivery_id: newId,
        file_path: filePath,
        file_name:
          source.file_name,
        file_size:
          source.file_size
      });
    }


    const { error } =
      await supabase()
        .from("deliveries")
        .insert({
          ...copy,

          id: newId,

          file_path:
            copiedFiles[0].file_path,

          file_name:
            copiedFiles[0].file_name,

          file_size:
            copiedFiles.reduce(
              (total, file) =>
                total +
                Number(
                  file.file_size || 0
                ),
              0
            ),

          project_name:
            `${copy.project_name} (copy)`,

          expires_at:
            new Date(
              Date.now() +
              24 * 3600000
            ).toISOString()
        });

    if (error) {
      throw error;
    }


    const {
      error: filesError
    } =
      await supabase()
        .from("delivery_files")
        .insert(copiedFiles);

    if (filesError) {
      throw filesError;
    }

  } catch (error) {

    if (copiedFiles.length) {
      await supabase()
        .storage
        .from(
          config.storageBucket
        )
        .remove(
          copiedFiles.map(
            file =>
              file.file_path
          )
        );
    }

    await supabase()
      .from("deliveries")
      .delete()
      .eq("id", newId);

    throw error;
  }

  return newId;
}


/* =========================================================
   PUBLIC DELIVERY
========================================================= */

export async function getPublicDelivery(
  id
) {
  const {
    data,
    error
  } = await supabase()
    .from("deliveries_public")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  try {

    const {
      data: files,
      error: filesError
    } =
      await supabase()
        .from(
          "delivery_files_public"
        )
        .select("*")
        .eq(
          "delivery_id",
          id
        )
        .order("created_at");

    if (filesError) {
      throw filesError;
    }

    return {
      ...data,
      delivery_files: files
    };

  } catch {

    return {
      ...data,
      delivery_files: null
    };
  }
}


/* =========================================================
   ANALYTICS — VIEW
========================================================= */

/*
 * Records a client opening the delivery page.
 *
 * This uses the SECURITY DEFINER Supabase RPC
 * created in the analytics SQL.
 */

export async function recordView(
  id
) {
  const {
    error
  } =
    await supabase()
      .rpc(
        "record_delivery_view",
        {
          p_delivery_id: id
        }
      );

  if (error) {

    console.error(
      "[Boztik Deliver] recordView failed:",
      error
    );

    return false;
  }

  return true;
}


/* =========================================================
   ANALYTICS — DOWNLOAD
========================================================= */

/*
 * Records an actual download.
 *
 * IMPORTANT:
 * We use the new analytics RPC instead of the old
 * increment_delivery_downloads RPC so the lifetime
 * and monthly counters stay synchronized.
 */

export async function recordDownload(
  id
) {
  const {
    error
  } =
    await supabase()
      .rpc(
        "record_delivery_download",
        {
          p_delivery_id: id
        }
      );

  if (error) {

    console.error(
      "[Boztik Deliver] recordDownload failed:",
      error
    );

    return false;
  }

  return true;
}


/* =========================================================
   SIGNED DOWNLOAD
========================================================= */

export async function signedDownload(
  file
) {
  return requestServerSignedUrl(
    file,
    "download"
  );
}


/* =========================================================
   SIGNED PREVIEW
========================================================= */

export async function signedPreview(
  file
) {
  return requestServerSignedUrl(
    file,
    "preview"
  );
}


/* =========================================================
   REDDIT METADATA
   Best-effort only. Callers must treat any thrown error as
   "auto-fill unavailable" and fall back to manual entry —
   never block delivery creation on this.
========================================================= */

export async function fetchRedditMetadata(
  url
) {
  const trimmedUrl =
    (url || "").trim();

  if (!trimmedUrl) {
    throw new Error(
      "No Reddit URL supplied."
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      8000
    );

  let response;

  try {
    response = await fetch(
      REDDIT_METADATA_FUNCTION,
      {
        method: "POST",
        signal: controller.signal,

        headers: {
          "Content-Type": "application/json",
          "apikey": config.supabaseAnonKey,
          "Authorization":
            `Bearer ${config.supabaseAnonKey}`
        },

        body: JSON.stringify({
          url: trimmedUrl
        })
      }
    );
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    throw new Error(
      timedOut
        ? "Reddit took too long to respond."
        : "Could not reach the metadata service."
    );
  } finally {
    clearTimeout(timeout);
  }

  let result = null;

  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok || !result?.title) {
    throw new Error(
      result?.message ||
      "Could not read this Reddit thread's title."
    );
  }

  return {
    title: result.title,
    subreddit: result.subreddit || null,
    author: result.author || null,
    canonicalUrl: result.canonicalUrl || result.redditUrl || trimmedUrl,
    redditUrl: result.redditUrl || trimmedUrl
  };
}