-- Who is supervising which chat (FR-MOD-13.2 · FR-MOD-03.1.1 · NFR-S4) — the
-- data layer for 13.2-c. One table, no data written: the register/release
-- endpoint that fills it is 13.2-d, and the Traffic funnel that reads it is
-- 13.2-e.
--
--   * chat_supervisions — one row per (chat, agent) pair an agent is currently
--     watching without owning.
--
-- Supervising is deliberately *not* assignment: the supervisor reads a
-- conversation someone else is handling, so nothing in `threads` records it and
-- the Traffic board's `supervised` state has no source at all today. The
-- Supervise button only navigates to the inbox — it writes nowhere — which is
-- why the state added to the dictionary in 13.2-a can never be produced until
-- this table exists.
--
-- Postgres rather than Redis presence, on purpose: the tenant boundary then
-- rests on the policy below, which the database enforces on every statement,
-- and a row is deterministic evidence the DoD gate can assert on. Redis
-- presence would put the boundary back in application code and leave the gate
-- with nothing to check.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change. The RLS policy is invisible to Prisma and is added
-- here by hand, the same way every other tenant table does.

-- CreateTable
CREATE TABLE "chat_supervisions" (
    "chat_id" VARCHAR(12) NOT NULL,
    "agent_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_supervisions_pkey" PRIMARY KEY ("chat_id","agent_id")
);

-- The read side (13.2-e) asks one question per board refresh: which chats in
-- *this* license have been seen recently. `(license_id, last_seen_at DESC)`
-- answers it from the index alone — a stale row is an abandoned tab, not a
-- watcher, so the query is always bounded by time and never by row existence.
--
-- CreateIndex
CREATE INDEX "chat_supervisions_license_id_last_seen_at_idx" ON "chat_supervisions"("license_id", "last_seen_at" DESC);

-- Cascades in all three directions, because a supervision is meaningful only
-- while all three ends of it exist: closing the workspace, deleting the agent
-- or purging the chat each leave a row that names a watcher of nothing.
--
-- AddForeignKey
ALTER TABLE "chat_supervisions" ADD CONSTRAINT "chat_supervisions_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_supervisions" ADD CONSTRAINT "chat_supervisions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_supervisions" ADD CONSTRAINT "chat_supervisions_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: a supervision is visible and writable only within its own
-- license, exactly like campaign_sends and every other tenant-scoped table.
-- What is behind this policy is who is watching whom — a cross-tenant read
-- names another workspace's agents and the conversations they are watching, and
-- a cross-tenant write plants a supervisor nobody in that workspace appointed.
-- Identical in shape to `campaign_sends_tenant`; the column is the plain
-- license match, so nothing here is bespoke.
ALTER TABLE chat_supervisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_supervisions_tenant ON chat_supervisions
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- No GRANT statement: the ALTER DEFAULT PRIVILEGES in 20260722090000 already
-- hands nexa_app SELECT, INSERT, UPDATE, DELETE on every table created after
-- it, and a supervision needs all four (register, heartbeat, release, read).
-- Unlike audit_log or api_package_purchases there is nothing to withhold — this
-- table is live state, not a record of something that happened, so rewriting a
-- row destroys no evidence.
--
-- Note for 13.2-d: the FK above is enforced by the table owner, which is exempt
-- from RLS, so referential integrity alone will accept a chat_id belonging to
-- another license as long as license_id matches the caller's. The policy stops
-- the row being *read* cross-tenant, not the pointer being formed. The register
-- endpoint must therefore resolve the chat under the tenant session first —
-- `chats` RLS makes a foreign chat invisible there — and refuse when it is not
-- found. `ratings` and `campaign_sends` carry the same chat_id + license_id
-- shape and are guarded the same way.
