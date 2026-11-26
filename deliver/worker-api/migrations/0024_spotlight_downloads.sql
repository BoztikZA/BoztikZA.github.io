-- Optional application/product download destinations (Apple App Store, Google Play, Generic HTTPS).
-- Backward-compatible additive column: existing profiles remain NULL (no download links).
ALTER TABLE spotlight_profiles ADD COLUMN download_links TEXT;
