-- The AI configuration change history (tm 315 · SiyahTuş analysis AI-21).
--
-- WHY THIS EXISTS. A player says "the AI told me yesterday that…" and the
-- workspace must be able to show the rule or the knowledge that held at that
-- moment (CGA, UKGC). Until now only deletions left a trace (`data.deleted`),
-- the audit log may not carry values (field names only) and it is pruned after
-- 30 days. This table keeps, per save of an AI editing table (ADR-14b §2.5
-- step 3), the row before and after, the JSON-path difference, the actor and
-- the role they held then.
--
-- APPEND-ONLY. `siyahtus_app` holds SELECT and INSERT and nothing else — the
-- `invoices` pattern. Whoever can rewrite this record can rewrite what the AI
-- was told. The root panel reads a count (tm 389.19) and writes nothing here,
-- so `siyahtus_platform` keeps SELECT only.
--
-- RETENTION (AI-21-S1). Five years (`aiConfigHistoryDays`, 1825), applied by
-- the retention sweep through `ai_config_changes_prune_expired` — the audit
-- log's own prune never reaches this table. The workspace's deletion takes it
-- (the licence foreign key cascades).
--
-- Expand-only (CONVENTIONS §6.3): a new table nothing existing reads.

-- CreateTable
CREATE TABLE "ai_config_changes" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "ai_agent_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_role" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version_id" UUID,
    "draft_revision" BIGINT,
    "before" JSONB,
    "after" JSONB,
    "diff" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "request_id" TEXT,

    CONSTRAINT "ai_config_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_config_changes_license_id_at_id_idx" ON "ai_config_changes"("license_id", "at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ai_config_changes_license_id_entity_type_entity_id_at_idx" ON "ai_config_changes"("license_id", "entity_type", "entity_id", "at" DESC);

-- AddForeignKey
ALTER TABLE "ai_config_changes" ADD CONSTRAINT "ai_config_changes_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The closed vocabularies (`@siyahtus/types` `ai-config-history.ts`). Widening
-- a list later is expand-only; narrowing one is not.
ALTER TABLE ai_config_changes
  ADD CONSTRAINT ai_config_changes_entity_type_check CHECK (entity_type IN (
    'persona', 'guidance_rule', 'procedure', 'skill', 'knowledge_source',
    'knowledge_table_row', 'handoff_rule', 'handoff_route', 'guardrail',
    'risk_policy', 'access_info', 'config_version'
  ));

ALTER TABLE ai_config_changes
  ADD CONSTRAINT ai_config_changes_action_check CHECK (action IN (
    'created', 'updated', 'deleted', 'submitted', 'approved', 'rejected',
    'published', 'rolled_back', 'paused', 'resumed', 'crawled'
  ));

-- A customer never changes the AI's configuration, and the root panel's own
-- actions are audited on the platform side, never here. `platform` is an
-- operator signed in as a member (impersonation, tm 389.15) writing through
-- the workspace API: the row names the operator, as the audit log does.
ALTER TABLE ai_config_changes
  ADD CONSTRAINT ai_config_changes_actor_type_check
  CHECK (actor_type IN ('agent', 'bot', 'system', 'platform'));

-- A creation has nothing before it, a deletion nothing after it — the row
-- says what the entity was, so the side that cannot exist must be empty.
ALTER TABLE ai_config_changes
  ADD CONSTRAINT ai_config_changes_created_check CHECK (action <> 'created' OR before IS NULL);
ALTER TABLE ai_config_changes
  ADD CONSTRAINT ai_config_changes_deleted_check CHECK (action <> 'deleted' OR after IS NULL);

ALTER TABLE ai_config_changes
  ADD CONSTRAINT ai_config_changes_diff_check CHECK (jsonb_typeof(diff) = 'array');

ALTER TABLE ai_config_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_config_changes_tenant ON ai_config_changes
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT, INSERT ON public.ai_config_changes TO siyahtus_app;
REVOKE UPDATE, DELETE, TRUNCATE ON public.ai_config_changes FROM siyahtus_app;

-- The root panel counts the last 30 days (tm 389.19); it never writes here.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_config_changes FROM siyahtus_platform;
    GRANT SELECT ON public.ai_config_changes TO siyahtus_platform;
  END IF;
END
$$;

-- The one hole in the append-only grant: the retention sweep's prune of rows
-- past `aiConfigHistoryDays`. SECURITY DEFINER bypasses RLS, so the licence is
-- a parameter and the predicate below keeps the delete inside it. Fail closed,
-- as `audit_prune_expired` does: no tenant, or a cutoff that is not strictly
-- in the past, deletes nothing and raises.
CREATE OR REPLACE FUNCTION ai_config_changes_prune_expired(p_license_id BIGINT, p_cutoff TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted BIGINT;
BEGIN
  IF p_license_id IS NULL OR p_cutoff IS NULL OR p_cutoff >= now() THEN
    RAISE EXCEPTION
      'ai_config_changes_prune_expired refuses license=% cutoff=%: needs a tenant and a cutoff strictly before now()',
      p_license_id, p_cutoff;
  END IF;
  DELETE FROM ai_config_changes
   WHERE license_id = p_license_id
     AND at < p_cutoff;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION ai_config_changes_prune_expired(BIGINT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_config_changes_prune_expired(BIGINT, TIMESTAMPTZ) TO siyahtus_app;
