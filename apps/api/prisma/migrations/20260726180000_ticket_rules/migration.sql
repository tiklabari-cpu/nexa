-- Ticket rules (FR-MOD-08.6.2): condition + action automation over tickets, and
-- the ticket-level tag table their "add tag" action writes to.
--
--   * ticket_rules — a license-scoped rule: a `conditions` predicate (subject
--                    substring, origin) and an `actions` object (assign, set
--                    priority, tag). Both kept as JSONB so a new condition or
--                    action kind needs no migration. When a ticket is opened,
--                    every enabled rule whose condition matches applies its
--                    action, in `position` order. Both a condition and an action
--                    are required — a rule that could match nobody or do nothing
--                    is rejected in the service (KK "koşul+eylem zorunlu").
--   * ticket_tags  — a tag applied to a ticket. Like thread_tags it has no
--                    license column of its own: it inherits tenant visibility
--                    from the ticket it hangs off, and RLS scopes it through that
--                    foreign key. It reuses the same `tags` library the inbox and
--                    thread tagging already draw on.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change (minus the unrelated pgvector index it always reports —
-- see check-drift.ts). The RLS policies and the GRANT are invisible to Prisma
-- and are added here by hand, the same way every other tenant table does.

-- CreateTable
CREATE TABLE "ticket_tags" (
    "ticket_id" VARCHAR(12) NOT NULL,
    "tag_id" UUID NOT NULL,
    "tagged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_tags_pkey" PRIMARY KEY ("ticket_id","tag_id")
);

-- CreateTable
CREATE TABLE "ticket_rules" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_tags_tag_id_idx" ON "ticket_tags"("tag_id");

-- CreateIndex
CREATE INDEX "ticket_rules_license_id_enabled_position_idx" ON "ticket_rules"("license_id", "enabled", "position");

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_rules" ADD CONSTRAINT "ticket_rules_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ticket_tags has no license_id of its own (mirroring thread_tags), so it
-- inherits visibility from the ticket it belongs to: a row is readable and
-- writable only when its ticket is in the caller's tenant.
ALTER TABLE ticket_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_tags_tenant ON ticket_tags
  USING (EXISTS (SELECT 1 FROM tickets t
                 WHERE t.id = ticket_tags.ticket_id AND t.license_id = nexa_current_license()))
  WITH CHECK (EXISTS (SELECT 1 FROM tickets t
                      WHERE t.id = ticket_tags.ticket_id AND t.license_id = nexa_current_license()));

-- The application role reaches the table only through that policy. No UPDATE: a
-- tag is added or removed, never edited.
GRANT SELECT, INSERT, DELETE ON ticket_tags TO nexa_app;

-- ticket_rules is license-scoped like campaigns and routing_rules: a rule is
-- visible and writable only within its own license.
ALTER TABLE ticket_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_rules_tenant ON ticket_rules
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());
