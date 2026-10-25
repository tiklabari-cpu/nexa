-- A ticket's conversation (tm 356.1 · SiyahTuş analysis HD-01).
--
-- A ticket held a subject and a status and nothing an agent could answer. Two
-- pieces:
--
--   1. `ticket_messages` — what the player wrote, the agents' replies, internal
--      notes and the product's own lines, oldest first. The service, the mail
--      job and the console arrive in 356.2–356.4; what is fixed here is what the
--      database promises on its own, before any of them relies on it:
--        - an internal note never becomes e-mail: it cannot carry a delivery
--          status, a Message-ID or an In-Reply-To;
--        - only an agent reply has a delivery status, only a player's message
--          keeps (sanitised) HTML;
--        - a message cannot point at another workspace's ticket — the foreign
--          key is (ticket_id, license_id), because a key on `id` alone is
--          checked without RLS and would accept one;
--        - one composer key, and one inbound Message-ID, is one message per
--          licence (NULLs are distinct, so the plain unique index is the
--          partial one the analysis asked for, and Prisma can model it);
--        - what was written stays written: the application may update only a
--          reply's delivery fields, and may not delete a message (it leaves
--          with its ticket — erasure deletes the ticket — or its licence).
--   2. `tickets.first_response_at` / `last_customer_message_at` /
--      `last_agent_message_at` — written by the service from 356.2.
--
-- Expand-only (CONVENTIONS §6.3): a new table, three nullable columns and a
-- unique index over a primary key that is already unique, nothing an earlier
-- release reads or writes. The index is built in this transaction (not
-- CONCURRENTLY): `tickets` is small, and the foreign key below needs it.
-- Vocabularies: `@siyahtus/types` `ticket-messages.ts`.

-- --------------------------------------------------------------------------
-- 1. tickets — the timestamps and the composite key's target
-- --------------------------------------------------------------------------
ALTER TABLE "tickets" ADD COLUMN     "first_response_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_agent_message_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_customer_message_at" TIMESTAMPTZ(6);

-- `id` leads: led by `license_id`, the planner prefers this index to
-- `tickets_license_customer_idx` for the Contacts `has_tickets` probe.
CREATE UNIQUE INDEX "tickets_id_license_id_key" ON "tickets"("id", "license_id");

-- --------------------------------------------------------------------------
-- 2. ticket_messages
-- --------------------------------------------------------------------------
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "ticket_id" VARCHAR(12) NOT NULL,
    "kind" TEXT NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_id" UUID,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "email_message_id" TEXT,
    "in_reply_to" TEXT,
    "delivery_status" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id"),

    CONSTRAINT ticket_messages_kind_check
      CHECK (kind IN ('customer_message', 'agent_reply', 'internal_note', 'system')),
    CONSTRAINT ticket_messages_author_type_check
      CHECK (author_type IN ('customer', 'agent', 'system', 'bot')),
    CONSTRAINT ticket_messages_delivery_status_check
      CHECK (delivery_status IN ('queued', 'sent', 'failed', 'suppressed')),
    -- Who may write what: the player's message is the player's and only the
    -- player writes one; a reply or a note is an agent's (or an AI agent's); a
    -- product line is the product's. An agent's row names the agent.
    CONSTRAINT ticket_messages_author_check CHECK (
      (kind = 'customer_message') = (author_type = 'customer')
      AND (kind NOT IN ('agent_reply', 'internal_note') OR author_type IN ('agent', 'bot'))
      AND (kind <> 'system' OR author_type = 'system')
      AND (author_type <> 'agent' OR author_id IS NOT NULL)
    ),
    -- The data-leak boundary (HD-01): a note has nothing a mail path could
    -- have written, so one picked up by mistake has nowhere to record it went.
    CONSTRAINT ticket_messages_note_not_mailed_check CHECK (
      kind <> 'internal_note'
      OR (delivery_status IS NULL AND email_message_id IS NULL AND in_reply_to IS NULL)
    ),
    CONSTRAINT ticket_messages_delivery_reply_only_check
      CHECK (delivery_status IS NULL OR kind = 'agent_reply'),
    -- Inbound HTML is kept only sanitised and only for what the player sent;
    -- nothing the product or an agent writes is stored as markup.
    CONSTRAINT ticket_messages_html_customer_only_check
      CHECK (body_html IS NULL OR kind = 'customer_message'),
    CONSTRAINT ticket_messages_attachments_array_check
      CHECK (jsonb_typeof(attachments) = 'array'),
    CONSTRAINT ticket_messages_idempotency_key_check
      CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128)
);

-- The thread, oldest first: keyset on (created_at, id). Also serves the
-- cascade from `tickets`.
CREATE INDEX "ticket_messages_ticket_id_created_at_id_idx" ON "ticket_messages"("ticket_id", "created_at", "id");

CREATE UNIQUE INDEX "ticket_messages_license_id_email_message_id_key" ON "ticket_messages"("license_id", "email_message_id");

CREATE UNIQUE INDEX "ticket_messages_license_id_idempotency_key_key" ON "ticket_messages"("license_id", "idempotency_key");

ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_license_id_fkey" FOREIGN KEY ("ticket_id", "license_id") REFERENCES "tickets"("id", "license_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_messages_tenant ON ticket_messages
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant all four; narrow them. A
-- message's text, kind and author are never rewritten — only where a reply's
-- e-mail is (356.3) moves after the insert.
REVOKE UPDATE, DELETE, TRUNCATE ON ticket_messages FROM siyahtus_app;
GRANT SELECT, INSERT ON ticket_messages TO siyahtus_app;
GRANT UPDATE (delivery_status, email_message_id, in_reply_to) ON ticket_messages TO siyahtus_app;
