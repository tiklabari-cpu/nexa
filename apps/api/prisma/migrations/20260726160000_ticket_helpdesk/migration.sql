-- Omnichannel HelpDesk layer on the ticket core (FR-MOD-13.6).
--
-- The ticket core (slice 11) gave a ticket a status, an assignee and a link back
-- to the chat it came from. This adds the HelpDesk operations on top:
--
--   * priority   — an integer the queue can be worked by; higher is more urgent.
--   * merged_into — a self reference. A merge is non-destructive: it only points
--                   a secondary at its primary, so an unmerge is a clean inverse
--                   (clear the pointer) rather than a reconstruction. The FK is
--                   ON DELETE SET NULL, and a CHECK forbids pointing at itself;
--                   "no chains" (a merged ticket cannot itself be a target) is a
--                   service invariant, not expressible as a column constraint.
--   * followers  — a join table of agents watching a ticket. Like thread_tags it
--                   has no license column of its own: it inherits tenant
--                   visibility from the ticket it hangs off, and RLS scopes it
--                   through that foreign key.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change (minus the unrelated pgvector index it always reports —
-- see check-drift.ts). The CHECK, the RLS policy and the GRANT are invisible to
-- Prisma and are added here by hand, the same way every other tenant table does.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "merged_into_id" VARCHAR(12),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ticket_followers" (
    "ticket_id" VARCHAR(12) NOT NULL,
    "account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_followers_pkey" PRIMARY KEY ("ticket_id","account_id")
);

-- CreateIndex
CREATE INDEX "ticket_followers_account_id_idx" ON "ticket_followers"("account_id");

-- CreateIndex
CREATE INDEX "tickets_merged_into_id_idx" ON "tickets"("merged_into_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_followers" ADD CONSTRAINT "ticket_followers_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_followers" ADD CONSTRAINT "ticket_followers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A ticket cannot be merged into itself. This is the one merge invariant a
-- column constraint can hold; the rest ("no chains", same tenant, source not
-- already merged) need a query and live in the service.
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_no_self_merge_check"
  CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");

-- ticket_followers has no license_id of its own (PRD §8.4 gives followers no
-- such column), so it inherits visibility from the ticket it belongs to — the
-- same shape as thread_tags against threads. A follower row is readable and
-- writable only when its ticket is in the caller's tenant.
ALTER TABLE ticket_followers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_followers_tenant ON ticket_followers
  USING (EXISTS (SELECT 1 FROM tickets t
                 WHERE t.id = ticket_followers.ticket_id AND t.license_id = nexa_current_license()))
  WITH CHECK (EXISTS (SELECT 1 FROM tickets t
                      WHERE t.id = ticket_followers.ticket_id AND t.license_id = nexa_current_license()));

-- The application role reaches the table only through that policy. No UPDATE:
-- a follow is added or removed, never edited.
GRANT SELECT, INSERT, DELETE ON ticket_followers TO nexa_app;
