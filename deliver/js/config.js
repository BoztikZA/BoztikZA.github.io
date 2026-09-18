export const config = Object.freeze({
  supabaseUrl: "https://hwcxxotgtqchcriascti.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3Y3h4b3RndHFjaGNyaWFzY3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTI5MzMsImV4cCI6MjEwMTUyODkzM30.bLyXIjvw0NcZQsyStPvq6d7nwDrMSycsTKuJkOtd9wU",
  storageBucket: "deliveries",
  publicBaseUrl: "https://www.boztik.com/deliver/",
  defaultExpiryHours: 24,
  maxUploadBytes: 250 * 1024 * 1024,
  allowedExtensions: ["zip", "jpg", "jpeg", "png", "psd", "tif", "tiff", "webp", "pdf", "ai", "eps"],
  paypalUrl: "https://paypal.me/angry5p1c3",

  // Command Centre "Storage & usage" panel.
  // Project ref (from supabaseUrl) — used to deep-link to the Supabase usage page.
  supabaseProjectRef: "hwcxxotgtqchcriascti",
  // CONFIGURED plan allowance (in bytes) — entered manually by the operator.
  // Supabase does NOT expose the project's Storage plan allowance through any
  // runtime API, so this is the only reliable source for a quota meter. The
  // UI therefore labels it "Configured plan allowance" and never implies the
  // figure came from Supabase. Leave `null` to show raw usage only (allowance
  // and remaining shown as "Unavailable", no percentage / no warnings).
  // Published plan Storage quotas (from Supabase's docs):
  //   Free plan:  1073741824        (1 GB)
  //   Pro plan:   107374182400      (100 GB)
  //   Team plan:  107374182400      (100 GB)
  // Only set this once, intentionally, to the project's actual plan.
  storagePlanBytes: null,
  // Optional human-readable plan name, shown next to the allowance (e.g. "Pro plan").
  // Only used when storagePlanBytes is set.
  storagePlanName: ""
});
