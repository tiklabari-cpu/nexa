-- What a player e-mails reaches the ticket (tm 357 · SiyahTuş analysis HD-02).
--
-- The inbound webhook accepted a body and threw it away; a ticket kept only
-- the subject. From here an inbound mail is the ticket's first
-- `customer_message` (the table is tm 356.1's). Three pieces:
--
--   1. `ticket_messages.body_text_full` — the whole text as it arrived, kept
--      beside `body_text` when the quoted earlier mail and the signature were
--      cut from it. Cutting a quote is a guess; "show full message" is the
--      way back to what the player actually sent. Only a player's message
--      has one, like `body_html`.
--   2. `security_settings.inbound_attachments_sensitive` — the workspace's
--      "treat every e-mailed file as sensitive". Off, only a file whose name or
--      the mail's subject names an ID document is.
--   3. `ticket_message_purge_attachments(...)` — the retention sweep marks a
--      sensitive file it deleted as `purged`. The application may update only
--      a reply's delivery fields (356.1), and that stays so: the sweep gets one
--      narrow SECURITY DEFINER hole that can only set `purged` on sensitive
--      entries of one message of one licence, older than a cutoff strictly in
--      the past — the `audit_prune_expired` pattern.
--
-- Expand-only (CONVENTIONS §6.3): a nullable column, a defaulted boolean, a
-- CHECK every existing row passes (the column is new, so NULL), a function.

-- --------------------------------------------------------------------------
-- 1. ticket_messages.body_text_full
-- --------------------------------------------------------------------------
ALTER TABLE "ticket_messages" ADD COLUMN "body_text_full" TEXT;

ALTER TABLE "ticket_messages" ADD CONSTRAINT ticket_messages_full_text_customer_only_check
  CHECK (body_text_full IS NULL OR kind = 'customer_message');

-- --------------------------------------------------------------------------
-- 2. security_settings.inbound_attachments_sensitive
-- --------------------------------------------------------------------------
ALTER TABLE "security_settings"
  ADD COLUMN "inbound_attachments_sensitive" BOOLEAN NOT NULL DEFAULT false;

-- --------------------------------------------------------------------------
-- 3. The retention sweep's one write on a message
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ticket_message_purge_attachments(
  p_license_id BIGINT,
  p_message_id UUID,
  p_keys TEXT[],
  p_cutoff TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  marked INTEGER;
BEGIN
  -- Fail closed, as `audit_prune_expired` does: SECURITY DEFINER bypasses RLS,
  -- so the licence predicate below is the only tenant boundary, and a cutoff at
  -- or after now() would reach a message the window has not expired yet.
  IF p_license_id IS NULL OR p_message_id IS NULL OR p_keys IS NULL
     OR p_cutoff IS NULL OR p_cutoff >= now() THEN
    RAISE EXCEPTION
      'ticket_message_purge_attachments refuses license=% message=% cutoff=%: needs a tenant, a message, keys and a cutoff strictly before now()',
      p_license_id, p_message_id, p_cutoff;
  END IF;

  -- Only `purged` is added, and only to an entry that is sensitive and whose
  -- key the sweep says it deleted; every other entry, and every other column,
  -- is written back as it was. The order of the list is kept.
  UPDATE ticket_messages AS m
     SET attachments = (
       SELECT COALESCE(
                jsonb_agg(
                  CASE
                    WHEN entry -> 'sensitive' = 'true'::jsonb
                         AND entry ->> 'key' = ANY (p_keys)
                    THEN entry || '{"purged": true}'::jsonb
                    ELSE entry
                  END
                  ORDER BY position
                ),
                '[]'::jsonb
              )
         FROM jsonb_array_elements(m.attachments) WITH ORDINALITY AS list(entry, position)
     )
   WHERE m.license_id = p_license_id
     AND m.id = p_message_id
     AND m.created_at < p_cutoff;

  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN marked;
END;
$$;

REVOKE EXECUTE ON FUNCTION ticket_message_purge_attachments(BIGINT, UUID, TEXT[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ticket_message_purge_attachments(BIGINT, UUID, TEXT[], TIMESTAMPTZ) TO siyahtus_app;
