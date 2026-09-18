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
  // Set the project's plan Storage allowance (in bytes) to enable the quota
  // meter + warnings. Leave `null` to show raw usage only (no percentage).
  //   Free plan:  1073741824        (1 GB)
  //   Pro plan:   107374182400      (100 GB)
  //   Team plan:  107374182400      (100 GB)
  storagePlanBytes: null,
  // Human-readable plan name, shown next to the meter (only used when quota set).
  storagePlanName: ""
});
