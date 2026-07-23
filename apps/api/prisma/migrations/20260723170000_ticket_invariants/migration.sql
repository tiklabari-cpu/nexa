-- Ticketing invariants (PRD FR-MOD-02.6).
--
-- At most one *unresolved* ticket per source chat.
--
-- An agent who clicks "Create ticket" twice, or two agents looking at the same
-- conversation, would otherwise split one piece of follow-up work across two
-- tickets — and whichever one nobody opens is the one the customer waits on.
-- Enforced by the database rather than a read-then-write check in the service,
-- because that check is exactly what two concurrent requests slip between.
--
-- Scoped to the unresolved statuses on purpose: a chat that comes back months
-- later, after its first ticket was solved, legitimately earns a new one.
CREATE UNIQUE INDEX uq_one_unresolved_ticket_per_chat
  ON tickets (source_chat_id)
  WHERE source_chat_id IS NOT NULL AND status IN ('open', 'pending');

-- Tickets are worked newest-activity-first (FR-MOD-02.1.3), and the two views
-- an agent lives in are "unassigned" and "mine". The existing index leads on
-- status, which does not serve either ordering.
CREATE INDEX tickets_license_last_message_idx
  ON tickets (license_id, last_message_at DESC, id DESC);

CREATE INDEX tickets_license_assignee_idx
  ON tickets (license_id, assignee_id, last_message_at DESC);

-- A subject is what the list shows; a ticket with an empty one is a blank row.
ALTER TABLE tickets
  ADD CONSTRAINT tickets_subject_present_check
    CHECK (subject IS NOT NULL AND length(btrim(subject)) > 0);
