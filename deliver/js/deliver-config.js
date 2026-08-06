/**
 * Boztik Deliver — Supabase configuration
 * -----------------------------------------------------------------------
 * SAFE TO EXPOSE: the anon key is designed to be public. It only ever
 * grants what your Row Level Security (RLS) policies allow — see
 * /supabase/schema.sql. Never put a service_role key in this file or
 * anywhere in the repo.
 */
window.BOZTIK_DELIVER_CONFIG = {
  SUPABASE_URL: "https://hwcxxotgtqchcriascti.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3Y3h4b3RndHFjaGNyaWFzY3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTI5MzMsImV4cCI6MjEwMTUyODkzM30.bLyXIjvw0NcZQsyStPvq6d7nwDrMSycsTKuJkOtd9wU", // Project Settings → API → anon public key

  // Storage bucket that holds the ZIP deliveries (see supabase/schema.sql)
  STORAGE_BUCKET: "deliveries",

  // Default expiration window for a new delivery, in hours
  DEFAULT_EXPIRY_HOURS: 24,

  // Hard upload cap enforced client-side (Supabase Free tier default is
  // also capped — raise both together if you upgrade your plan)
  MAX_UPLOAD_BYTES: 250 * 1024 * 1024, // 250MB

  // Public base URL used to build shareable client links
  PUBLIC_BASE_URL: "https://boztikza.github.io/deliver/"
};
