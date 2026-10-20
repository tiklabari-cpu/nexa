-- Team queues (tm 305.1 · SiyahTuş analysis AU-01, owner decisions K14 and
-- K18, ADR-08a `docs/adr/routing-team-queues.md`).
--
-- Today the queue is one line per workspace: positions are numbered across
-- the licence and the drain stops at the first conversation nobody can take
-- (`routing-service.ts` drainQueue), so one Responsible Gambling chat waiting
-- for a trained agent holds up every Finance chat behind it. ADR-08a makes the
-- queue a team: a connection waits in one team's queue, ordered within it by
-- how pressing it is, then by how long it has waited. This migration lays the
-- data down; routing starts reading it in tm 305.2.
--
--   * groups.topic_role       — the topic a team's queue is for (K14's six,
--                               `QUEUE_TOPIC_ROLES`). The AI's hand-over and
--                               the pre-chat topic resolve the role, not the
--                               name, so a renamed team still gets its topic;
--                               hence at most one team per licence holds one.
--   * groups.after_hours_mode — what the queue does when nobody is on shift
--                               (`AFTER_HOURS_MODES`); 'queue' is what every
--                               team did until now.
--   * group_expertise         — the expertise areas a team requires, every one
--                               of them, of the agents it gives conversations
--                               to. Routing and draining ask it of every team;
--                               the Responsible Gambling team admits only
--                               trained agents through it (ADR-08a §2.6).
--   * threads.queue_group_id  — the team whose queue the connection waits in;
--                               read while `queue_position` is set. Not
--                               `group_id`, which records who handled the
--                               connection. Filled for the conversations
--                               waiting now by the next migration.
--   * threads.priority        — how pressing the connection is, as a rank:
--                               0 normal, 1 high, 2 urgent
--                               (`THREAD_PRIORITY_RANK`). A rank rather than
--                               the word, because a queue orders by it and
--                               text sorts 'urgent' > 'normal' > 'high'
--                               (ADR-08a §2.3). AI-12 (tm 307) raises it.
--
-- Expand-only (CONVENTIONS §6.3): the previous release neither reads nor
-- writes any of it. Both NOT NULL columns carry a constant default, so adding
-- them rewrites nothing and an old writer that names neither still inserts.
-- No CHECK ties `queue_group_id` to `queue_position`: an old replica clearing
-- the position would violate it mid-rollout.
--
-- No foreign key on `queue_group_id`, on `threads.group_id`'s terms
-- (20261015170000_thread_group): group ids come from a sequence and are never
-- reused, and a team's delete must not be blocked or cascaded by a row here —
-- what happens to a deleted team's queue is routing's decision (tm 305.2/3).
--
-- The CHECKs on `threads` scan the table once under this migration's lock; at
-- today's size (the pilot) that is milliseconds (the
-- 20261017100000_thread_ai_mode reasoning). `groups` is a handful of rows per
-- licence, so its unique index is built in place rather than CONCURRENTLY.
-- No index for the queue order yet: tm 305.2 adds it beside the queries that
-- read it.
--
-- The structural statements are what `prisma migrate diff` emits for the
-- schema change (minus the unmodellable statements `check-drift.ts` allows);
-- the CHECKs, the partial unique index, RLS and the GRANTs are invisible to
-- Prisma and added by hand.

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "after_hours_mode" TEXT NOT NULL DEFAULT 'queue',
ADD COLUMN     "topic_role" TEXT;

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "priority" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "queue_group_id" BIGINT;

-- CreateTable
CREATE TABLE "group_expertise" (
    "license_id" BIGINT NOT NULL,
    "group_id" BIGINT NOT NULL,
    "expertise_id" BIGINT NOT NULL,

    CONSTRAINT "group_expertise_pkey" PRIMARY KEY ("license_id","group_id","expertise_id")
);

-- CreateIndex
CREATE INDEX "group_expertise_license_id_expertise_id_idx" ON "group_expertise"("license_id", "expertise_id");

-- AddForeignKey
ALTER TABLE "group_expertise" ADD CONSTRAINT "group_expertise_license_id_group_id_fkey" FOREIGN KEY ("license_id", "group_id") REFERENCES "groups"("license_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_expertise" ADD CONSTRAINT "group_expertise_license_id_expertise_id_fkey" FOREIGN KEY ("license_id", "expertise_id") REFERENCES "expertise"("license_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `QUEUE_TOPIC_ROLES` and `AFTER_HOURS_MODES` (`@siyahtus/types`);
-- `team-queue-schema.test.ts` compares both with these lists.
ALTER TABLE groups ADD CONSTRAINT groups_topic_role_check CHECK (
  topic_role IS NULL
  OR topic_role IN ('finance', 'kyc_risk', 'bonus', 'responsible_gambling', 'technical', 'complaint')
);

ALTER TABLE groups ADD CONSTRAINT groups_after_hours_mode_check
  CHECK (after_hours_mode IN ('queue', 'ticket'));

-- One team per role per licence: the role is what a hand-over resolves, and
-- two answers would make the team it lands in depend on row order. Teams with
-- no role are not constrained.
CREATE UNIQUE INDEX "groups_license_id_topic_role_key" ON "groups"("license_id", "topic_role")
  WHERE topic_role IS NOT NULL;

-- `THREAD_PRIORITY_RANK` (`@siyahtus/types`): normal, high, urgent.
ALTER TABLE threads ADD CONSTRAINT threads_priority_check CHECK (priority BETWEEN 0 AND 2);

-- License-scoped like agent_expertise: the row carries its own license_id (part
-- of the key), so the plain license match is the whole policy.
ALTER TABLE group_expertise ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_expertise_tenant ON group_expertise
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant all four; a requirement is
-- only ever added or removed, never edited (agent_expertise's grant).
REVOKE UPDATE ON group_expertise FROM siyahtus_app;
GRANT SELECT, INSERT, DELETE ON group_expertise TO siyahtus_app;
