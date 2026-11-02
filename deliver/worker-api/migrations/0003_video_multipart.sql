-- Persist the R2 multipart session while a video is being uploaded.
-- The reservation remains in pending_uploads and continues to protect the 3 GiB ledger.
ALTER TABLE pending_uploads ADD COLUMN multipart_upload_id TEXT;
