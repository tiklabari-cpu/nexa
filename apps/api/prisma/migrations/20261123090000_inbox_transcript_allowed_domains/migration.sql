-- AR-04-S3 (tm 338): where a transcript may be mailed besides the player's own
-- address. Expand only: a column with a default, which the code before this
-- release never reads.
ALTER TABLE "inbox_settings"
  ADD COLUMN "transcript_allowed_domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
