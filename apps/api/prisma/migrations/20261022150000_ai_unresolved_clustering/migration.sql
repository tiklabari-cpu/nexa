-- The unresolved questions' clustering (tm 317.2 · SiyahTuş analysis AI-22
-- §4–§8, AI-22-S2 · `@siyahtus/types` `ai-unresolved.ts`).
--
--   - `ai_unresolved_clusters` learns three things the clustering job keeps:
--     the action its title writer suggested (`suggested_action`), how many
--     items it had when its title was written (`labelled_count` — a cluster
--     grown by half is titled again) and when it last alarmed (`alerted_at` —
--     at most once in six hours, claimed by one UPDATE);
--   - `ai_unresolved_settings` is the workspace's surge threshold (AI-22-S2:
--     20 in 60 minutes unless it says otherwise). One row per workspace; none
--     is the default.
--
-- The CHECKs and the constants of `ai-unresolved.ts` are one list
-- (`ai-unresolved-clustering.test.ts` compares them).
--
-- Expand only (CONVENTIONS §6.3): nullable or defaulted columns and a new
-- table the previous release does not read.

ALTER TABLE "ai_unresolved_clusters"
  ADD COLUMN "suggested_action" TEXT,
  ADD COLUMN "labelled_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "alerted_at"       TIMESTAMPTZ(6);

-- `UNRESOLVED_SUGGESTED_ACTIONS`.
ALTER TABLE "ai_unresolved_clusters"
  ADD CONSTRAINT ai_unresolved_clusters_suggested_action_check CHECK (
    suggested_action IS NULL
    OR suggested_action IN ('add_knowledge', 'add_examples', 'new_procedure', 'review')
  ),
  ADD CONSTRAINT ai_unresolved_clusters_labelled_count_check CHECK (labelled_count >= 0);

CREATE TABLE "ai_unresolved_settings" (
    "license_id"      BIGINT         NOT NULL,
    "spike_threshold" INTEGER        NOT NULL DEFAULT 20,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_unresolved_settings_pkey" PRIMARY KEY ("license_id"),
    CONSTRAINT "ai_unresolved_settings_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `UNRESOLVED_SPIKE_THRESHOLD_MIN`, `UNRESOLVED_SPIKE_THRESHOLD_MAX`.
    CONSTRAINT ai_unresolved_settings_spike_threshold_check CHECK (
      spike_threshold BETWEEN 5 AND 1000
    )
);

ALTER TABLE ai_unresolved_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_unresolved_settings_tenant ON ai_unresolved_settings
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- Written by the report's settings (tm 317.3); never deleted but with the licence.
REVOKE ALL ON ai_unresolved_settings FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE ON ai_unresolved_settings TO siyahtus_app;
