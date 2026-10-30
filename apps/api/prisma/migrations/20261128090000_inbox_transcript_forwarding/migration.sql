-- WG-06 (tm 345): where every closed connection is forwarded, and whether the
-- copy carries internal notes. Expand only: two columns with defaults, which
-- the code before this release never reads. The closing mail to the player
-- stops in code (K26), not here — there is no column to turn it back on.
ALTER TABLE "inbox_settings"
  ADD COLUMN "transcript_forward_to" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "transcript_forward_include_notes" BOOLEAN NOT NULL DEFAULT false,
  -- `TRANSCRIPT_FORWARD_MAX`; the endpoint refuses a sixth before this does.
  ADD CONSTRAINT "inbox_settings_transcript_forward_max"
    CHECK (cardinality("transcript_forward_to") <= 5);
