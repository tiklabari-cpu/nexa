-- Goals: the record that a goal was reached (FR-MOD-13.3 · NFR-S4 · NFR-S5) —
-- the data layer for 13.3-b. One table, no data written: the matcher that fills
-- it is 13.3-d and the funnel report that reads it is 13.3-e/-f.
--
--   * goal_achievements — one row per (goal, visitor), stamped with the moment
--     the visitor first reached it.
--
-- `goals` (20260722154008) already holds what counts as a conversion, but only
-- the *definition*: name, predicate, active. Nothing anywhere records that a
-- conversion happened, so "achieved goals, last 7 days" is not a question this
-- database can answer today, and neither is the third stage of the
-- visitor -> chat -> conversion funnel the slice is built around. A definition
-- cannot be counted over a window; a timestamped row can.
--
-- `campaign_sends.converted` is not that row and cannot be made into one: it is
-- a free boolean with no `goal_id`, so it never says *which* goal was reached,
-- and it only exists for the visitors some campaign happened to fire at. It is
-- deliberately left alone here — see the note at the end.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change. The RLS policy is invisible to Prisma and is added
-- here by hand, the same way every other tenant table does.

-- CreateTable
CREATE TABLE "goal_achievements" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "goal_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "chat_id" VARCHAR(12),
    "achieved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_achievements_pkey" PRIMARY KEY ("id")
);

-- Every read this table exists for is "conversions in *this* license, between
-- these two instants" — the Overview counter compares a window with the one
-- before it, so the same shape is asked twice per report. `(license_id,
-- achieved_at)` answers it from the index alone.
--
-- CreateIndex
CREATE INDEX "goal_achievements_license_id_achieved_at_idx" ON "goal_achievements"("license_id", "achieved_at");

-- The idempotency constraint, and the reason this is a unique index rather than
-- a convention the matcher is trusted to keep. 13.3-d re-evaluates a visitor on
-- every page view, and a visitor may be evaluated concurrently by more than one
-- request; a person converts on a goal once. Without this pair the funnel
-- inflates silently — nothing looks broken, the conversion count is simply
-- wrong, and it is wrong in the direction that flatters the product.
--
-- CreateIndex
CREATE UNIQUE INDEX "goal_achievements_goal_id_customer_id_key" ON "goal_achievements"("goal_id", "customer_id");

-- License, goal and visitor all cascade: an achievement that names a deleted
-- goal or a purged visitor is a conversion of nothing, and it would keep being
-- counted.
--
-- AddForeignKey
ALTER TABLE "goal_achievements" ADD CONSTRAINT "goal_achievements_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_achievements" ADD CONSTRAINT "goal_achievements_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_achievements" ADD CONSTRAINT "goal_achievements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The chat is the one end that does NOT cascade. It records which conversation
-- the visitor was in when they converted — the funnel's middle stage — and
-- chats are purged on a retention schedule the conversion history must outlive.
-- Cascading here would delete last quarter's conversions along with last
-- quarter's transcripts, so the number would shrink after the fact. `SET NULL`
-- keeps the conversion and drops only the pointer, the same choice
-- `tickets.source_chat_id` and `skill_runs.chat_id` already make.
--
-- AddForeignKey
ALTER TABLE "goal_achievements" ADD CONSTRAINT "goal_achievements_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security: an achievement is visible and writable only within its
-- own license, exactly like campaign_sends and every other tenant-scoped table.
-- What is behind this policy is a workspace's conversion performance — a
-- cross-tenant read hands a competitor its rival's funnel, and a cross-tenant
-- write plants conversions in a report nobody there earned. Identical in shape
-- to `campaign_sends_tenant` and `goals_tenant`; the column is the plain
-- license match, so nothing here is bespoke.
ALTER TABLE goal_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_achievements_tenant ON goal_achievements
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- No GRANT statement: the ALTER DEFAULT PRIVILEGES in 20260722090000 already
-- hands nexa_app SELECT, INSERT, UPDATE, DELETE on every table created after
-- it. UPDATE and DELETE are wider than 13.3-d needs (it only inserts), but this
-- table is not an audit trail — a mis-attributed conversion should be
-- correctable, and a visitor exercising erasure takes their achievements with
-- them through the cascade above.
--
-- Out of scope on purpose: no `goal_id` is added to `campaign_sends`. Its
-- `converted` boolean stays exactly as it is. Backfilling it would mean
-- inventing which goal each historical conversion belonged to, and the
-- Campaigns tests assert today's conversion numbers — 13.3-d decides how the
-- two meet, with data in hand.
