-- CreateTable
CREATE TABLE "groups" (
    "id" BIGSERIAL NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "language_code" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("license_id","id")
);

-- CreateTable
CREATE TABLE "group_agents" (
    "license_id" BIGINT NOT NULL,
    "group_id" BIGINT NOT NULL,
    "agent_id" UUID NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',

    CONSTRAINT "group_agents_pkey" PRIMARY KEY ("license_id","group_id","agent_id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" VARCHAR(12) NOT NULL,
    "license_id" BIGINT NOT NULL,
    "customer_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" VARCHAR(12) NOT NULL,
    "chat_id" VARCHAR(12) NOT NULL,
    "license_id" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "queue_position" INTEGER,
    "queued_at" TIMESTAMPTZ(6),
    "assignee_id" UUID,
    "summary" TEXT,
    "summary_updated_at" TIMESTAMPTZ(6),
    "event_sequence" INTEGER NOT NULL DEFAULT 0,
    "first_response_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- `events` is range-partitioned by month (PRD §8.4 / rapor-2 §5.5).
--
-- This is by far the largest table in the system, and partitioning is what
-- keeps three separate costs bounded as it grows: transcript queries prune to
-- one or two partitions, VACUUM works on a partition rather than the whole
-- history, and archiving old conversations becomes a DETACH instead of a
-- multi-million-row DELETE.
--
-- Hand-written because Prisma has no partitioning syntax. Queries are
-- unaffected — the client sees one table.
--
-- `created_at` is part of the primary key because Postgres requires the
-- partition key to appear in every unique constraint.
CREATE TABLE "events" (
    "id" VARCHAR(40) NOT NULL,
    "thread_id" VARCHAR(12) NOT NULL,
    "chat_id" VARCHAR(12) NOT NULL,
    "license_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "author_id" TEXT,
    "author_type" TEXT NOT NULL,
    "recipients" TEXT NOT NULL DEFAULT 'all',
    "attachment_url" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "chat_users" (
    "chat_id" VARCHAR(12) NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_type" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "seen_up_to" TIMESTAMPTZ(6),
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_users_pkey" PRIMARY KEY ("chat_id","user_id")
);

-- CreateTable
CREATE TABLE "chat_access" (
    "chat_id" VARCHAR(12) NOT NULL,
    "group_id" BIGINT NOT NULL,

    CONSTRAINT "chat_access_pkey" PRIMARY KEY ("chat_id","group_id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "author_id" TEXT,
    "group_ids" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_tags" (
    "thread_id" VARCHAR(12) NOT NULL,
    "tag_id" UUID NOT NULL,
    "tagged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_tags_pkey" PRIMARY KEY ("thread_id","tag_id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" VARCHAR(12) NOT NULL,
    "license_id" BIGINT NOT NULL,
    "customer_id" UUID,
    "source_chat_id" VARCHAR(12),
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignee_id" UUID,
    "group_id" BIGINT,
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "chat_id" VARCHAR(12) NOT NULL,
    "license_id" BIGINT NOT NULL,
    "thread_id" VARCHAR(12),
    "value" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'chat',
    "shortcut" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "group_id" BIGINT,
    "visibility" TEXT NOT NULL DEFAULT 'all',
    "updated_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'targeted_message',
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "content" JSONB NOT NULL DEFAULT '{}',
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "came_from" TEXT,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "ip" TEXT,
    "os" TEXT,
    "browser" TEXT,
    "user_agent" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ai_agent',
    "name" TEXT NOT NULL,
    "persona" JSONB NOT NULL DEFAULT '{}',
    "tone" TEXT,
    "avatar_url" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instruction" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "ai_agent_id" UUID,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "instruction" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "trigger" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "runs_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_runs" (
    "id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "chat_id" VARCHAR(12),
    "license_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'succeeded',
    "log" JSONB NOT NULL DEFAULT '[]',
    "ran_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "ai_agent_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_url" TEXT,
    "content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "added_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "token_count" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_rules" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "target_group_id" BIGINT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'off',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "websites" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "domain" TEXT NOT NULL,
    "created_by" TEXT,
    "connected_at" TIMESTAMPTZ(6),
    "setup" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "client_id" TEXT,
    "url" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "secret_key" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'license',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_settings" (
    "license_id" BIGINT NOT NULL,
    "banned_customer_ips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "spam_filter_enabled" BOOLEAN NOT NULL DEFAULT true,
    "file_sharing_enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowed_file_types" TEXT[] DEFAULT ARRAY['image/png', 'image/jpeg', 'application/pdf']::TEXT[],
    "max_file_size_bytes" INTEGER NOT NULL DEFAULT 10485760,
    "require_two_factor" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "security_settings_pkey" PRIMARY KEY ("license_id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'growth',
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER NOT NULL DEFAULT 9900,
    "ai_resolutions_included" INTEGER NOT NULL DEFAULT 200,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" CHAR(6) NOT NULL,
    "quantity" BIGINT NOT NULL DEFAULT 0,
    "included" BIGINT NOT NULL DEFAULT 0,
    "overage_unit" INTEGER NOT NULL DEFAULT 1,
    "overage_unit_price_cents" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL DEFAULT 'agent',
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_agents_agent_id_idx" ON "group_agents"("agent_id");

-- CreateIndex
CREATE INDEX "chats_license_id_created_at_idx" ON "chats"("license_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "chats_customer_id_idx" ON "chats"("customer_id");

-- CreateIndex
CREATE INDEX "threads_chat_id_created_at_idx" ON "threads"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "threads_license_id_active_created_at_idx" ON "threads"("license_id", "active", "created_at" DESC);

-- CreateIndex
CREATE INDEX "threads_assignee_id_idx" ON "threads"("assignee_id");

-- CreateIndex
CREATE INDEX "events_thread_id_created_at_idx" ON "events"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "events_chat_id_created_at_idx" ON "events"("chat_id", "created_at");

-- CreateIndex
CREATE INDEX "events_license_id_created_at_idx" ON "events"("license_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_users_user_id_idx" ON "chat_users"("user_id");

-- CreateIndex
CREATE INDEX "chat_access_group_id_idx" ON "chat_access"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_license_id_name_key" ON "tags"("license_id", "name");

-- CreateIndex
CREATE INDEX "thread_tags_tag_id_idx" ON "thread_tags"("tag_id");

-- CreateIndex
CREATE INDEX "tickets_license_id_status_last_message_at_idx" ON "tickets"("license_id", "status", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_assignee_id_idx" ON "tickets"("assignee_id");

-- CreateIndex
CREATE INDEX "ratings_license_id_created_at_idx" ON "ratings"("license_id", "created_at");

-- CreateIndex
CREATE INDEX "canned_responses_license_id_group_id_idx" ON "canned_responses"("license_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "canned_responses_license_id_scope_shortcut_key" ON "canned_responses"("license_id", "scope", "shortcut");

-- CreateIndex
CREATE INDEX "campaigns_license_id_status_idx" ON "campaigns"("license_id", "status");

-- CreateIndex
CREATE INDEX "goals_license_id_active_idx" ON "goals"("license_id", "active");

-- CreateIndex
CREATE INDEX "visits_customer_id_started_at_idx" ON "visits"("customer_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "visits_license_id_started_at_idx" ON "visits"("license_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "ai_agents_license_id_kind_idx" ON "ai_agents"("license_id", "kind");

-- CreateIndex
CREATE INDEX "skills_license_id_kind_active_idx" ON "skills"("license_id", "kind", "active");

-- CreateIndex
CREATE INDEX "skill_runs_skill_id_ran_at_idx" ON "skill_runs"("skill_id", "ran_at" DESC);

-- CreateIndex
CREATE INDEX "skill_runs_license_id_ran_at_idx" ON "skill_runs"("license_id", "ran_at" DESC);

-- CreateIndex
CREATE INDEX "workflows_license_id_status_idx" ON "workflows"("license_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_sources_ai_agent_id_type_idx" ON "knowledge_sources"("ai_agent_id", "type");

-- CreateIndex
CREATE INDEX "knowledge_sources_license_id_idx" ON "knowledge_sources"("license_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_source_id_position_idx" ON "knowledge_chunks"("source_id", "position");

-- CreateIndex
CREATE INDEX "knowledge_chunks_license_id_idx" ON "knowledge_chunks"("license_id");

-- CreateIndex
CREATE INDEX "routing_rules_license_id_kind_enabled_priority_idx" ON "routing_rules"("license_id", "kind", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "channels_license_id_type_key" ON "channels"("license_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "websites_license_id_domain_key" ON "websites"("license_id", "domain");

-- CreateIndex
CREATE INDEX "webhooks_license_id_action_enabled_idx" ON "webhooks"("license_id", "action", "enabled");

-- CreateIndex
CREATE INDEX "subscriptions_license_id_status_idx" ON "subscriptions"("license_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_license_id_metric_period_key" ON "usage_records"("license_id", "metric", "period");

-- CreateIndex
CREATE INDEX "audit_log_license_id_created_at_idx" ON "audit_log"("license_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_license_id_action_created_at_idx" ON "audit_log"("license_id", "action", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_agents" ADD CONSTRAINT "group_agents_license_id_group_id_fkey" FOREIGN KEY ("license_id", "group_id") REFERENCES "groups"("license_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_agents" ADD CONSTRAINT "group_agents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_users" ADD CONSTRAINT "chat_users_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_access" ADD CONSTRAINT "chat_access_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_tags" ADD CONSTRAINT "thread_tags_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_tags" ADD CONSTRAINT "thread_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_source_chat_id_fkey" FOREIGN KEY ("source_chat_id") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_ai_agent_id_fkey" FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_ai_agent_id_fkey" FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_rules" ADD CONSTRAINT "routing_rules_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "websites" ADD CONSTRAINT "websites_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_settings" ADD CONSTRAINT "security_settings_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Event partitions
-- ===========================================================================

-- Creates the monthly partition covering `p_when`, if it does not exist.
-- Idempotent so it is safe to call on every insert path and from a scheduler.
CREATE OR REPLACE FUNCTION events_ensure_partition(p_when TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start DATE := date_trunc('month', p_when AT TIME ZONE 'UTC')::date;
  v_end   DATE := (date_trunc('month', p_when AT TIME ZONE 'UTC') + INTERVAL '1 month')::date;
  v_name  TEXT := format('events_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
  IF to_regclass(format('public.%I', v_name)) IS NOT NULL THEN
    RETURN v_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.events FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start, v_end
  );
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO nexa_app', v_name);
  RETURN v_name;
END;
$$;

-- Keeps a rolling window of partitions ahead of "now".
--
-- An insert into a month with no partition fails outright, so the window must
-- never be allowed to run out. Called at boot and from the scheduler; the
-- backward months exist so importing historical data does not error.
CREATE OR REPLACE FUNCTION events_maintain_partitions(p_months_ahead INT DEFAULT 3,
                                                      p_months_behind INT DEFAULT 1)
RETURNS INT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offset INT;
  v_count  INT := 0;
BEGIN
  FOR v_offset IN -p_months_behind..p_months_ahead LOOP
    PERFORM events_ensure_partition(now() + (v_offset || ' months')::INTERVAL);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION events_ensure_partition(TIMESTAMPTZ) TO nexa_app;
GRANT EXECUTE ON FUNCTION events_maintain_partitions(INT, INT) TO nexa_app;

SELECT events_maintain_partitions(6, 2);

-- A row whose timestamp falls outside every partition would otherwise raise a
-- bare "no partition of relation" error. This catch-all keeps such a row —
-- clock skew, a bad backfill — rather than losing a customer's message, and
-- makes the anomaly findable.
CREATE TABLE IF NOT EXISTS events_default PARTITION OF events DEFAULT;
GRANT SELECT, INSERT, UPDATE, DELETE ON events_default TO nexa_app;

-- ===========================================================================
-- Invariants
-- ===========================================================================

-- At most one active chat per license+customer (PRD §8.4).
--
-- Enforced by the database, not the application: this is the rule the entire
-- inbox model rests on, and two concurrent `start_chat` calls from the same
-- visitor would otherwise both pass an application-level check.
CREATE UNIQUE INDEX uq_one_active_chat
  ON chats (license_id, customer_id) WHERE active;

-- At most one active thread per chat. A chat with two open threads would show
-- the same conversation twice in the inbox and split its replies.
CREATE UNIQUE INDEX uq_one_active_thread
  ON threads (chat_id) WHERE active;

-- At most one fallback routing rule per license and kind (ADR-08 step 5).
CREATE UNIQUE INDEX uq_one_fallback_routing_rule
  ON routing_rules (license_id, kind) WHERE is_fallback;

-- pgvector: ivfflat with cosine distance, matching the retrieval query.
-- `lists` is tuned for the tens-of-thousands range MVP knowledge bases occupy.
CREATE INDEX idx_chunks_embedding ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Property filtering in Reports scans jsonb; GIN makes that an index lookup.
CREATE INDEX idx_events_properties ON events USING gin (properties jsonb_path_ops);

-- Unassigned/queued inbox views are read constantly and would otherwise scan
-- every thread in the license.
CREATE INDEX idx_threads_queue ON threads (license_id, queue_position)
  WHERE active AND queue_position IS NOT NULL;

-- ===========================================================================
-- CHECK constraints (PRD §8.4)
-- ===========================================================================

ALTER TABLE groups
  ADD CONSTRAINT groups_language_code_check CHECK (language_code ~ '^[a-z]{2}(-[A-Z]{2})?$');

ALTER TABLE group_agents
  ADD CONSTRAINT group_agents_priority_check
    CHECK (priority IN ('primary', 'first', 'normal', 'last'));

ALTER TABLE events
  ADD CONSTRAINT events_type_check
    CHECK (type IN ('message', 'system_message', 'rich_message', 'file', 'filled_form')),
  ADD CONSTRAINT events_author_type_check
    CHECK (author_type IN ('agent', 'customer', 'bot', 'system')),
  ADD CONSTRAINT events_recipients_check CHECK (recipients IN ('all', 'agents'));

ALTER TABLE chat_users
  ADD CONSTRAINT chat_users_user_type_check CHECK (user_type IN ('agent', 'customer'));

ALTER TABLE threads
  ADD CONSTRAINT threads_queue_position_check
    CHECK (queue_position IS NULL OR queue_position >= 0),
  -- An active thread cannot already be closed; the two states contradict.
  ADD CONSTRAINT threads_closed_consistency_check
    CHECK ((active AND closed_at IS NULL) OR (NOT active AND closed_at IS NOT NULL)),
  ADD CONSTRAINT threads_event_sequence_check CHECK (event_sequence >= 0);

ALTER TABLE tickets
  ADD CONSTRAINT tickets_status_check
    CHECK (status IN ('open', 'pending', 'solved', 'closed', 'spam'));

ALTER TABLE ratings
  ADD CONSTRAINT ratings_value_check CHECK (value IN ('good', 'bad'));

ALTER TABLE canned_responses
  ADD CONSTRAINT canned_responses_scope_check CHECK (scope IN ('chat', 'ticket')),
  ADD CONSTRAINT canned_responses_shortcut_check
    CHECK (shortcut ~ '^[A-Za-z0-9_-]{1,40}$');

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_type_check CHECK (type IN ('greeting', 'targeted_message')),
  ADD CONSTRAINT campaigns_status_check
    CHECK (status IN ('ongoing', 'scheduled', 'inactive')),
  ADD CONSTRAINT campaigns_window_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);

ALTER TABLE ai_agents
  ADD CONSTRAINT ai_agents_kind_check CHECK (kind IN ('ai_agent', 'copilot'));

ALTER TABLE skills
  ADD CONSTRAINT skills_kind_check CHECK (kind IN ('ai_agent', 'workspace')),
  ADD CONSTRAINT skills_runs_count_check CHECK (runs_count >= 0),
  -- Steps must be a JSON array; an object here would break every consumer that
  -- iterates them.
  ADD CONSTRAINT skills_steps_is_array_check CHECK (jsonb_typeof(steps) = 'array');

ALTER TABLE skill_runs
  ADD CONSTRAINT skill_runs_status_check
    CHECK (status IN ('succeeded', 'failed', 'aborted'));

ALTER TABLE workflows
  ADD CONSTRAINT workflows_status_check CHECK (status IN ('draft', 'active', 'paused'));

ALTER TABLE knowledge_sources
  ADD CONSTRAINT knowledge_sources_type_check
    CHECK (type IN ('website', 'file', 'article', 'faq')),
  ADD CONSTRAINT knowledge_sources_status_check
    CHECK (status IN ('pending', 'indexing', 'ready', 'failed'));

ALTER TABLE routing_rules
  ADD CONSTRAINT routing_rules_kind_check CHECK (kind IN ('chat', 'ticket')),
  -- A non-fallback rule that targets nothing can never route anything.
  ADD CONSTRAINT routing_rules_target_check
    CHECK (is_fallback OR target_group_id IS NOT NULL);

ALTER TABLE channels
  ADD CONSTRAINT channels_type_check
    CHECK (type IN ('website_widget', 'email', 'messenger', 'twilio', 'whatsapp',
                    'instagram', 'telegram', 'chat_page')),
  ADD CONSTRAINT channels_status_check CHECK (status IN ('connected', 'off', 'soon'));

ALTER TABLE websites
  ADD CONSTRAINT websites_setup_check CHECK (setup IN ('manual', 'platform')),
  ADD CONSTRAINT websites_status_check CHECK (status IN ('pending', 'connected', 'error'));

ALTER TABLE webhooks
  ADD CONSTRAINT webhooks_type_check CHECK (type IN ('license', 'bot')),
  -- Only http(s), and never a fragment: the SSRF guard in the delivery path
  -- assumes this shape (v2-04 §6.3).
  ADD CONSTRAINT webhooks_url_check CHECK (url ~ '^https?://' AND url !~ '#');

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_billing_cycle_check
    CHECK (billing_cycle IN ('monthly', 'annual')),
  ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'read_only', 'canceled')),
  ADD CONSTRAINT subscriptions_seats_check CHECK (seats >= 1),
  ADD CONSTRAINT subscriptions_price_check CHECK (unit_price_cents >= 0);

ALTER TABLE usage_records
  ADD CONSTRAINT usage_records_metric_check
    CHECK (metric IN ('api_calls', 'ai_resolutions')),
  ADD CONSTRAINT usage_records_period_check CHECK (period ~ '^\d{6}$'),
  ADD CONSTRAINT usage_records_quantity_check CHECK (quantity >= 0);

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_actor_type_check
    CHECK (actor_type IN ('agent', 'bot', 'customer', 'system'));

ALTER TABLE visits
  ADD CONSTRAINT visits_window_check CHECK (ended_at IS NULL OR ended_at >= started_at);

-- ===========================================================================
-- Row level security
-- ===========================================================================
--
-- Same rule as slice 2: every tenant table gets a policy, and a query without a
-- tenant context sees nothing. Tables keyed by license use the license setting;
-- those keyed by organization use the organization setting.
--
-- Child tables (events, chat_users, thread_tags, knowledge_chunks) carry their
-- own license_id or are constrained through their parent, so no policy has to
-- traverse more than one join.

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY groups_tenant ON groups
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE group_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_agents_tenant ON group_agents
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY chats_tenant ON chats
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY threads_tenant ON threads
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_tenant ON events
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- chat_users and chat_access have no license column of their own (PRD §8.4),
-- so they inherit visibility from the chat they belong to.
ALTER TABLE chat_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_users_tenant ON chat_users
  USING (EXISTS (SELECT 1 FROM chats c
                 WHERE c.id = chat_users.chat_id AND c.license_id = nexa_current_license()))
  WITH CHECK (EXISTS (SELECT 1 FROM chats c
                      WHERE c.id = chat_users.chat_id AND c.license_id = nexa_current_license()));

ALTER TABLE chat_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_access_tenant ON chat_access
  USING (EXISTS (SELECT 1 FROM chats c
                 WHERE c.id = chat_access.chat_id AND c.license_id = nexa_current_license()))
  WITH CHECK (EXISTS (SELECT 1 FROM chats c
                      WHERE c.id = chat_access.chat_id AND c.license_id = nexa_current_license()));

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tags_tenant ON tags
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE thread_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY thread_tags_tenant ON thread_tags
  USING (EXISTS (SELECT 1 FROM threads t
                 WHERE t.id = thread_tags.thread_id AND t.license_id = nexa_current_license()))
  WITH CHECK (EXISTS (SELECT 1 FROM threads t
                      WHERE t.id = thread_tags.thread_id AND t.license_id = nexa_current_license()));

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tickets_tenant ON tickets
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ratings_tenant ON ratings
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE canned_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY canned_responses_tenant ON canned_responses
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaigns_tenant ON campaigns
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY goals_tenant ON goals
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY visits_tenant ON visits
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_agents_tenant ON ai_agents
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY skills_tenant ON skills
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE skill_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY skill_runs_tenant ON skill_runs
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflows_tenant ON workflows
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_sources_tenant ON knowledge_sources
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_chunks_tenant ON knowledge_chunks
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY routing_rules_tenant ON routing_rules
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY channels_tenant ON channels
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE websites ENABLE ROW LEVEL SECURITY;
CREATE POLICY websites_tenant ON websites
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhooks_tenant ON webhooks
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE security_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_settings_tenant ON security_settings
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant ON subscriptions
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_records_tenant ON usage_records
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The audit log is append-only from the application's point of view: an actor
-- who could edit it could erase the evidence of what they did.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_read ON audit_log FOR SELECT
  USING (license_id = nexa_current_license());
CREATE POLICY audit_log_append ON audit_log FOR INSERT
  WITH CHECK (license_id = nexa_current_license());

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexa_app;
-- audit_log deliberately excluded from UPDATE/DELETE by the policies above.
REVOKE UPDATE, DELETE ON audit_log FROM nexa_app;

-- Events belong to their thread, and must not outlive it.
--
-- Without this, deleting a chat (or honouring an erasure request) leaves the
-- message rows behind: invisible to the application, still holding the
-- customer's words. Postgres supports foreign keys from a partitioned table to
-- a regular one, so partitioning is no reason to give up referential integrity.
ALTER TABLE events
  ADD CONSTRAINT events_thread_id_fkey
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE ON UPDATE CASCADE;
