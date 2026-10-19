-- The AI agent's default "resolved" criteria (tm 303.4 · SiyahTuş analysis
-- AI-09; owner decision K9).
--
-- K9: the AI decides whether a conversation is solved, by the workspace's
-- criteria — a procedure's own `resolution_criteria` (in the skill's
-- `procedure` JSON, no column), else this default, else the platform's: the
-- player's explicit yes (`DEFAULT_RESOLUTION_CRITERIA`, `@siyahtus/types`
-- `resolution.ts`). The value is a procedure condition (`Cond`) over no
-- procedure's slots — `player_confirmed()`, an `ai` question, `all` / `any` /
-- `not` of them — judged by `validateResolutionCriteria` before it is written;
-- a stored value that does not read as one is no default
-- (`readResolutionCriteria`).
--
-- A draft column like the triggers (20261019210000, ADR-14b §2.12): written
-- through `config-draft.ts`, read by the turn from its configuration.
--
-- Expand-only (CONVENTIONS §6.3): a nullable column nothing earlier reads.

ALTER TABLE "ai_handoff_settings"
  ADD COLUMN "resolution_criteria" JSONB;

-- An object, and no larger than a condition can be: the route caps the
-- nesting and the lists (`COND_DEPTH_MAX`, `COND_LIST_MAX`), this keeps a
-- writer past the route from storing a blob.
ALTER TABLE "ai_handoff_settings"
  ADD CONSTRAINT ai_handoff_settings_resolution_criteria_check
    CHECK (
      resolution_criteria IS NULL
      OR (
        jsonb_typeof(resolution_criteria) = 'object'
        AND octet_length(resolution_criteria::text) <= 16384
      )
    );

-- The runtime may change it, as it may the other settings on the row.
GRANT UPDATE (resolution_criteria) ON ai_handoff_settings TO siyahtus_app;
