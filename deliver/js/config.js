export const config = Object.freeze({
  supabaseUrl: "https://hwcxxotgtqchcriascti.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3Y3h4b3RndHFjaGNyaWFzY3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTI5MzMsImV4cCI6MjEwMTUyODkzM30.bLyXIjvw0NcZQsyStPvq6d7nwDrMSycsTKuJkOtd9wU",
  storageBucket: "deliveries",
  publicBaseUrl: "https://www.boztik.com/deliver/",
  defaultExpiryHours: 24,
  // Per-file upload cap. Lowered from 250 MB to guard against accidental
  // multi-hundred-megabyte uploads that quickly burn the (Free-plan) egress
  // and storage quota. A professional-photography delivery places high-res
  // JPG/TIFF/PSD files typically well under this cap; oversized single files
  // are almost always mis-drags or merged layered exports. The storage bucket
  // file_size_limit (250 MB) still applies server-side above this.
  maxUploadBytes: 50 * 1024 * 1024,
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
  storagePlanBytes: 1024 * 1024 * 1024,
  // Optional human-readable plan name, shown next to the allowance (e.g. "Pro plan").
  // Only used when storagePlanBytes is set.
  storagePlanName: "Free plan",
  // Hard INTERNAL safety limit for Boztik Deliver uploads (see storage-guard.js).
  // The Free plan has ~1 GB, but uploads are refused at 500 MB so there is always
  // a buffer. Enforced by api.js (fresh authoritative usage check immediately
  // before every Storage write) and shown by the Command Centre floating monitor.
  storageSafetyLimitBytes: 500 * 1024 * 1024,
  // How often the Command Centre floating storage monitor re-reads usage.
  storageMonitorRefreshMs: 60 * 1000,
  storageWarningLevels: Object.freeze([
    { minPercent: 100, key: "over_quota", label: "Over quota" },
    { minPercent: 95, key: "critical", label: "Critical" },
    { minPercent: 90, key: "high", label: "High / urgent" },
    { minPercent: 80, key: "warning", label: "Warning" },
    { minPercent: 70, key: "notice", label: "Notice" },
    { minPercent: 0, key: "healthy", label: "Healthy" }
  ])
});
