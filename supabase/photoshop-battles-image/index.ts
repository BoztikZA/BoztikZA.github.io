import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function getExtension(pathname: string) {
  return pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
}

function getRouteValues(pathname: string) {
  const marker = "/photoshop-battles-image/";
  const index = pathname.indexOf(marker);

  if (index === -1) {
    return {
      deliveryId: "",
      directToken: ""
    };
  }

  const value = pathname
    .slice(index + marker.length)
    .replace(/\.[a-z0-9]+$/i, "");

  const separator = value.indexOf("--");

  if (separator === -1) {
    return {
      deliveryId: "",
      directToken: ""
    };
  }

  try {
    return {
      deliveryId: decodeURIComponent(
        value.slice(0, separator)
      ),
      directToken: decodeURIComponent(
        value.slice(separator + 2)
      )
    };
  } catch {
    return {
      deliveryId: "",
      directToken: ""
    };
  }
}

function contentType(extension: string) {
  return extension === "png"
    ? "image/png"
    : "image/jpeg";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (request.method !== "GET") {
    return json(
      {
        error: "Method not allowed."
      },
      405
    );
  }

  const url = new URL(request.url);

  const {
    deliveryId,
    directToken
  } = getRouteValues(url.pathname);

  const requestedExtension =
    getExtension(url.pathname);

  if (
    !deliveryId ||
    !directToken ||
    !["jpg", "jpeg", "png"].includes(
      requestedExtension
    )
  ) {
    return json(
      {
        error:
          "Invalid PhotoshopBattles image URL."
      },
      400
    );
  }

  const supabaseUrl =
    Deno.env.get("SUPABASE_URL");

  const serviceRoleKey =
    Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    );

  const storageBucket =
    Deno.env.get(
      "DELIVER_STORAGE_BUCKET"
    ) || "deliveries";

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    console.error(
      "Missing Supabase server configuration."
    );

    return json(
      {
        error:
          "Server configuration error."
      },
      500
    );
  }

  const admin = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  const {
    data: delivery,
    error: deliveryError
  } = await admin
    .from("deliveries")
    .select(
      "id, expires_at, source, source_meta, file_path, file_name"
    )
    .eq("id", deliveryId)
    .maybeSingle();

  if (deliveryError) {
    console.error(
      "Delivery lookup failed:",
      deliveryError
    );

    return json(
      {
        error:
          "Could not locate the image."
      },
      500
    );
  }

  if (!delivery) {
    return json(
      {
        error: "Image not found."
      },
      404
    );
  }

  if (
    delivery.source !== "reddit" ||
    delivery.source_meta?.type !==
      "photoshop_battles" ||
    delivery.source_meta?.direct_token !==
      directToken
  ) {
    return json(
      {
        error:
          "This is not a valid PhotoshopBattles image."
      },
      404
    );
  }

  const expiresAt =
    delivery.expires_at
      ? new Date(
          delivery.expires_at
        ).getTime()
      : NaN;

  if (
    Number.isFinite(expiresAt) &&
    expiresAt <= Date.now()
  ) {
    return json(
      {
        error:
          "This image has expired."
      },
      410
    );
  }

  const fileName =
    delivery.file_name ||
    "image.jpg";

  const actualExtensionRaw =
    fileName
      .split(".")
      .pop()
      ?.toLowerCase() || "";

  const actualExtension =
    actualExtensionRaw === "jpeg"
      ? "jpg"
      : actualExtensionRaw;

  const requestedExtensionNormalised =
    requestedExtension === "jpeg"
      ? "jpg"
      : requestedExtension;

  if (
    !["jpg", "png"].includes(
      actualExtension
    ) ||
    actualExtension !==
      requestedExtensionNormalised
  ) {
    return json(
      {
        error:
          "Image type does not match the requested URL."
      },
      404
    );
  }

  const {
    data: fileRow,
    error: fileError
  } = await admin
    .from("delivery_files")
    .select(
      "file_path, file_name, file_size"
    )
    .eq("delivery_id", deliveryId)
    .eq(
      "file_path",
      delivery.file_path
    )
    .maybeSingle();

  if (fileError) {
    console.error(
      "File lookup failed:",
      fileError
    );

    return json(
      {
        error:
          "Could not locate the image file."
      },
      500
    );
  }

  if (!fileRow) {
    return json(
      {
        error:
          "Image file not found."
      },
      404
    );
  }

  const {
    data: imageData,
    error: storageError
  } = await admin
    .storage
    .from(storageBucket)
    .download(
      fileRow.file_path
    );

  if (
    storageError ||
    !imageData
  ) {
    console.error(
      "Storage download failed:",
      storageError
    );

    return json(
      {
        error:
          "Could not load the image."
      },
      500
    );
  }

  /*
   * Count actual image requests as views
   * using the existing Boztik analytics RPC.
   *
   * We intentionally do not count downloads here.
   * A direct image request can represent:
   *
   * - Reddit rendering the image
   * - browser preview
   * - browser cache validation
   * - user opening the image
   * - another image request
   *
   * Therefore it cannot reliably represent
   * a user-initiated download.
   */
  const isPreview =
    url.searchParams.get(
      "preview"
    ) === "1";

  if (!isPreview) {
    const {
      error: analyticsError
    } = await admin.rpc(
      "record_delivery_view",
      {
        p_delivery_id:
          deliveryId
      }
    );

    if (analyticsError) {
      console.error(
        "PhotoshopBattles view analytics failed:",
        analyticsError
      );
    }
  }

  const safeFileName =
    fileName.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

  return new Response(
    imageData,
    {
      status: 200,
      headers: {
        ...corsHeaders,

        "Content-Type":
          contentType(
            actualExtension
          ),

        "Content-Disposition":
          `inline; filename="${safeFileName}"`,

        "Cache-Control":
          "private, no-store, max-age=0",

        "X-Content-Type-Options":
          "nosniff"
      }
    }
  );
});