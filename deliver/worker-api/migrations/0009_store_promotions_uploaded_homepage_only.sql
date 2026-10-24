-- Existing bootstrap artwork belongs in Stores only. Homepage releases must be
-- explicitly created with an image uploaded through Command Centre (R2).
UPDATE store_promotions
SET homepage_featured = 0
WHERE image_ref LIKE '/images/stores/%';
