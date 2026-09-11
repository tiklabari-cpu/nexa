-- The rule bot (FR-MOD-06.6) — a deterministic, LLM-free chatbot, separate from
-- the AI Agent.
--
-- Three tables. PRD:577's `Şema` column names `§8 bots`, but §8.4 — the schema's
-- single source of truth, with rapor-2 §5.3 — defines no such table; `bot` lives
-- there only as a value on `events.author_type`, `webhooks.type` and
-- `api_tokens.kind`. The DDL below is therefore a design decision, recorded in
-- PLAN §C as Assumption A37, and its two load-bearing halves are:
--
--   * `bots` is its OWN table rather than a third `ai_agents.kind`. The
--     requirement's words are "AI Agent'tan AYRI", and the measurement agrees:
--     `GET /ai-agents` filters on no `kind` at all, so a rule bot stored there
--     would be listed by the AI Agent console and counted by the Team → Chatbots
--     KPI as an LLM-backed agent.
--   * `bot_groups` is what makes "gruplara priority ile atanır" true. It cannot
--     be `group_agents`: that table's `agent_id` is a FK to `accounts` and a bot
--     is not an account, which is exactly why the KK's second half was failing
--     before this migration.
--
-- Expand-only (CONVENTIONS §6.3): three new tables, nothing existing dropped,
-- renamed, narrowed or constrained. Code that predates this migration is
-- unaffected by it, which is what makes it safe to run before the old replicas
-- have gone.

-- CreateTable
CREATE TABLE "bots" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_rules" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "bot_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_groups" (
    "license_id" BIGINT NOT NULL,
    "bot_id" UUID NOT NULL,
    "group_id" BIGINT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',

    CONSTRAINT "bot_groups_pkey" PRIMARY KEY ("license_id","bot_id","group_id")
);

-- CreateIndex
-- A workspace's bot names are its own vocabulary, and two bots called "FAQ" in
-- the same console is a support call rather than a feature.
CREATE UNIQUE INDEX "bots_license_id_name_key" ON "bots"("license_id", "name");

-- CreateIndex
CREATE INDEX "bots_license_id_enabled_idx" ON "bots"("license_id", "enabled");

-- CreateIndex
-- The engine's read: this licence's enabled rules for these bots, in evaluation
-- order. One index range scan per incoming message, which is what keeps the
-- deterministic pass off NFR-P2's budget.
CREATE INDEX "bot_rules_license_id_bot_id_enabled_position_idx" ON "bot_rules"("license_id", "bot_id", "enabled", "position");

-- CreateIndex
-- The other direction: which bots serve the teams that can see this chat.
CREATE INDEX "bot_groups_license_id_group_id_idx" ON "bot_groups"("license_id", "group_id");

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_rules" ADD CONSTRAINT "bot_rules_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_rules" ADD CONSTRAINT "bot_rules_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_groups" ADD CONSTRAINT "bot_groups_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_groups" ADD CONSTRAINT "bot_groups_bot_id_fkey"
    FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Composite, because `groups` is keyed by (licence, id) — a per-licence integer
-- id, PRD §8.4. The FK therefore also guarantees a bot cannot be assigned to
-- another workspace's team even if RLS were somehow bypassed: the pair has to
-- exist, and the licence in the pair is this row's own.
ALTER TABLE "bot_groups" ADD CONSTRAINT "bot_groups_license_id_group_id_fkey"
    FOREIGN KEY ("license_id", "group_id") REFERENCES "groups"("license_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The four tiers `group_agents.priority` already uses (GROUP_PRIORITIES in
-- @nexa/types). Constrained here rather than only in the route because the
-- ordering is what the KK's second half is about: a row carrying `urgent` would
-- sort as "unknown tier" and the bot would quietly be tried last.
ALTER TABLE bot_groups
  ADD CONSTRAINT bot_groups_priority_check
    CHECK (priority IN ('primary', 'first', 'normal', 'last'));

-- A rule's position orders it; the ceiling matches every other position column
-- in this schema and stops a row sorting outside the range the editor can show.
ALTER TABLE bot_rules
  ADD CONSTRAINT bot_rules_position_check
    CHECK (position >= 0 AND position <= 1000);

-- Row level security, the plain licence match every other tenant table uses.
-- WITH CHECK on all three: without it a workspace could write a row carrying
-- another licence's id — and for `bot_groups` that would mean attaching a bot to
-- a team it cannot see, which is the one cross-tenant write these tables make
-- possible.
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY bots_tenant ON bots
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE bot_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_rules_tenant ON bot_rules
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE bot_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_groups_tenant ON bot_groups
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches these tables only through the
-- policies above. Granted explicitly: the schema-wide GRANT in 20260722154008
-- covered only the tables that existed then.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bots TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_rules TO nexa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_groups TO nexa_app;
