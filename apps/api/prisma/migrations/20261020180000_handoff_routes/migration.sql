-- Hand-over routes and why a connection's priority was raised (tm 307.1 ·
-- SiyahTuş analysis AI-12, shared with AU-01; ADR-14b §2.12 ·
-- `@siyahtus/types` `handoff-routes.ts`).
--
--   * handoff_routes          — which team a conversation goes to for a key: a
--                               routing topic (`match_type = 'topic'`, the six
--                               queue roles of ADR-08a) or the reason the AI
--                               handed it over (`'reason'`, a `HANDOFF_REASONS`
--                               code), for one brand or — `brand_id` null — for
--                               every brand. It may require an expertise of
--                               whoever takes the conversation and carries the
--                               priority a conversation routed by it starts
--                               with. The team is held by id, never by name,
--                               so renaming a team keeps every route.
--   * threads.priority_reason — the `HANDOFF_REASONS` code of the hand-over
--                               that raised `threads.priority`, written with
--                               it. The CHECK holds the shape, not the list, so
--                               a new reason needs no migration.
--
-- An editing table (ADR-14b §2.1, §2.12): no publish state — `active` is "on
-- in this version" — and every write goes through
-- `services/ai/config-draft.ts`, which stamps `updated_at`. Human routing
-- reads it live; the AI resolves from its published package once tm 316
-- versions it.
--
-- One route per key and brand: two partial unique indexes, one for the
-- every-brand row (`brand_id` NULL is not equal to itself in a plain unique
-- index) and one per brand. Prisma cannot express their predicates; they are
-- hand-written below.
--
-- `group_id` and `required_expertise_id` are soft references, like
-- `ai_handoff_rules.target_group_id`: a team's or an expertise's delete must
-- not be blocked by a route, and the resolver checks both still exist (a
-- requirement whose expertise is gone is met by nobody, so the conversation
-- waits rather than reach an untrained agent). The route checks both are the
-- workspace's when it is written. `brand_id` is a real foreign key — a brand's
-- delete takes its routes with it — guarded by a trigger, because a foreign
-- key is checked past RLS.
--
-- Expand only (CONVENTIONS §6.3): a new table and a nullable column the
-- previous release neither reads nor writes. Lengths by byte, four per
-- character: the development database is SQL_ASCII (the 20261019210000 note).
--
-- The structural statements are what `prisma migrate diff` emits for the
-- schema change; the CHECKs, the partial unique indexes, the trigger, RLS and
-- the GRANTs are invisible to Prisma and added by hand.

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "priority_reason" TEXT;

-- CreateTable
CREATE TABLE "handoff_routes" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "brand_id" UUID,
    "match_type" TEXT NOT NULL,
    "match_key" TEXT NOT NULL,
    "group_id" BIGINT NOT NULL,
    "required_expertise_id" BIGINT,
    "default_priority" TEXT NOT NULL DEFAULT 'normal',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handoff_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handoff_routes_license_id_match_type_match_key_idx" ON "handoff_routes"("license_id", "match_type", "match_key");

-- AddForeignKey
ALTER TABLE "handoff_routes" ADD CONSTRAINT "handoff_routes_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_routes" ADD CONSTRAINT "handoff_routes_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `HANDOFF_ROUTE_MATCH_TYPES`, and the keys each matches: `QUEUE_TOPIC_ROLES`
-- and `HANDOFF_REASONS` (`handoff-routes.test.ts` compares the lists).
ALTER TABLE handoff_routes ADD CONSTRAINT handoff_routes_match_check CHECK (
  CASE match_type
    WHEN 'topic' THEN match_key IN
      ('finance', 'kyc_risk', 'bonus', 'responsible_gambling', 'technical', 'complaint')
    WHEN 'reason' THEN match_key IN
      ('guardrail_self_harm', 'guardrail_minor', 'guardrail_rg', 'risk_flag',
       'guardrail_account_security', 'guardrail_complaint', 'guardrail_output_block',
       'guardrail_workspace_rule', 'abuse', 'player_request', 'tenant_rule', 'procedure_rule',
       'missing_required_info', 'repeat_same_day', 'negative_sentiment',
       'player_said_unresolved', 'no_knowledge', 'not_understood', 'loop_detected',
       'max_turns', 'unsupported_language', 'ai_failure')
    ELSE false
  END
);

ALTER TABLE handoff_routes ADD CONSTRAINT handoff_routes_ids_check
  CHECK (group_id > 0 AND (required_expertise_id IS NULL OR required_expertise_id > 0));

-- `THREAD_PRIORITIES`.
ALTER TABLE handoff_routes ADD CONSTRAINT handoff_routes_default_priority_check
  CHECK (default_priority IN ('urgent', 'high', 'normal'));

-- `THREAD_PRIORITY_REASON_PATTERN`.
ALTER TABLE threads ADD CONSTRAINT threads_priority_reason_check
  CHECK (priority_reason IS NULL OR priority_reason ~ '^[a-z][a-z0-9_]{0,63}$');

-- One route per key for every brand, and one per key and brand.
CREATE UNIQUE INDEX "handoff_routes_every_brand_key" ON "handoff_routes"("license_id", "match_type", "match_key")
  WHERE brand_id IS NULL;
CREATE UNIQUE INDEX "handoff_routes_brand_key" ON "handoff_routes"("license_id", "brand_id", "match_type", "match_key")
  WHERE brand_id IS NOT NULL;

-- Brand-scoped like `channels` (20260802120000_brand_context): no brand context
-- is "every brand of the licence"; a set one narrows read and write to that
-- brand's routes and the every-brand routes (`brand_id` NULL), which apply to
-- it too.
ALTER TABLE handoff_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY handoff_routes_tenant ON handoff_routes
  USING (
    license_id = siyahtus_current_license()
    AND (siyahtus_current_brand() IS NULL OR brand_id IS NULL OR brand_id = siyahtus_current_brand())
  )
  WITH CHECK (
    license_id = siyahtus_current_license()
    AND (siyahtus_current_brand() IS NULL OR brand_id IS NULL OR brand_id = siyahtus_current_brand())
  );

-- --------------------------------------------------------------------------
-- The brand is the licence's own
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write a route, under its own licence, for another
-- workspace's brand id (the `ai_handoff_rules` pattern, 20261019230000).
CREATE FUNCTION handoff_routes_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands b
     WHERE b.id = NEW.brand_id
       AND b.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'handoff_routes: brand % is not this workspace''s', NEW.brand_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER handoff_routes_before_write
  BEFORE INSERT OR UPDATE OF brand_id, license_id ON handoff_routes
  FOR EACH ROW
  EXECUTE FUNCTION handoff_routes_before_write();

-- The default privileges (20260722090000) grant all four; a workspace never
-- empties the table wholesale.
REVOKE TRUNCATE ON handoff_routes FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON handoff_routes TO siyahtus_app;
