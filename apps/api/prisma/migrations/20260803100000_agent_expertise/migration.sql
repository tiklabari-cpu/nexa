-- Agent expertise (FR-MOD-08.6.3): the data layer for "expertise/skill based"
-- routing — which agents are qualified for which kind of conversation.
--
--   * expertise       — a license-scoped catalogue entry (a "skill" in product
--                       terms): a `name`, a `slug` unique within the license,
--                       and an `archived` flag so an area can be retired without
--                       losing the history that referenced it. It carries a
--                       Group-style composite key (license_id, id) so an id is a
--                       small per-license integer, not a uuid. Named `expertise`
--                       rather than `skills` because that table is already the
--                       AI-automation Skill (ADR-14), a wholly different concept.
--   * agent_expertise — the tie between an agent and an area of expertise, the
--                       row routing reads (08.6.3-c) to decide who can take a
--                       chat. Like group_agents it has a composite key and its
--                       own license_id, and is indexed by agent for the "what is
--                       this agent good at" lookup.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change (minus the unrelated pgvector index it always reports —
-- see check-drift.ts). The RLS policies and the GRANTs are invisible to Prisma
-- and are added here by hand, the same way every other tenant table does.

-- CreateTable
CREATE TABLE "expertise" (
    "id" BIGSERIAL NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expertise_pkey" PRIMARY KEY ("license_id","id")
);

-- CreateTable
CREATE TABLE "agent_expertise" (
    "license_id" BIGINT NOT NULL,
    "agent_id" UUID NOT NULL,
    "expertise_id" BIGINT NOT NULL,

    CONSTRAINT "agent_expertise_pkey" PRIMARY KEY ("license_id","agent_id","expertise_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expertise_license_id_slug_key" ON "expertise"("license_id", "slug");

-- CreateIndex
CREATE INDEX "agent_expertise_agent_id_idx" ON "agent_expertise"("agent_id");

-- AddForeignKey
ALTER TABLE "expertise" ADD CONSTRAINT "expertise_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_expertise" ADD CONSTRAINT "agent_expertise_license_id_expertise_id_fkey" FOREIGN KEY ("license_id", "expertise_id") REFERENCES "expertise"("license_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_expertise" ADD CONSTRAINT "agent_expertise_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Both tables are license-scoped like custom_field_definitions and group_agents:
-- a row is visible and writable only within its own license. agent_expertise
-- carries its own license_id (it is part of the key), so the direct policy is
-- enough — no join back through expertise is needed.
ALTER TABLE expertise ENABLE ROW LEVEL SECURITY;
CREATE POLICY expertise_tenant ON expertise
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE agent_expertise ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_expertise_tenant ON agent_expertise
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The application role reaches the tables only through those policies. An
-- expertise entry is edited (rename, archive); an assignment is only ever added
-- or removed, never edited, so agent_expertise gets no UPDATE (mirroring
-- ticket_tags).
GRANT SELECT, INSERT, UPDATE, DELETE ON expertise TO nexa_app;
GRANT SELECT, INSERT, DELETE ON agent_expertise TO nexa_app;
