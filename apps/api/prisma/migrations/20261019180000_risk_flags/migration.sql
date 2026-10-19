-- Risk flags (tm 302.1 · SiyahTuş analysis AI-27 · `@siyahtus/types`
-- `risk-flags.ts`): structured marks on a conversation, and on the player
-- behind it, that keep promotions and bonus talk away from a player at risk
-- and the AI out of a conversation that must stay with a person.
--
-- One table for both scopes (AI-27-S1). A `chat` flag is its conversation's
-- (the day container, panel "Thread ID"). A `member` flag — `rg_signal`,
-- `self_exclusion_request`, `underage_suspected` — is the player's as well,
-- in every later conversation, with no end date; it still names the chat it
-- was raised in. EN-01's `customer_risk_flags` need is this table's member
-- scope: there is no second table.
--
-- A flag is never deleted and never rewritten. The one change a row takes is
-- `active` → `cleared`, once, with who, when and why (AI-27-S2; the API holds
-- who may, tm 302.2) — the trigger below refuses every other edit, and
-- `siyahtus_app` holds no DELETE. Two foreign keys still move a row:
--
--   - `chat_id`, `thread_id` — SET NULL. The retention sweep deletes a
--     conversation; a member flag must outlive it (a self-exclusion request
--     is not forgotten with the chat it was made in). A chat flag stays too,
--     as the record that the conversation was flagged.
--   - `customer_id` — CASCADE. An erasure (`retention/erasure.ts`) removes
--     the subject and everything said about them; a flag's note can be about
--     their health. Whether a self-exclusion mark must survive an erasure is
--     the legal opinion AI-27 asks for (KVKK); until then it follows the
--     subject, like the AI decision records. Every flag raised in a chat
--     carries the chat's customer (the trigger fills it in), so none is left
--     behind.
--
-- In F1 a player's identity is their own claim (ID-03), so `basis` is
-- `declared` (AI-27-S3). `member_key` is the player's key on the operator's
-- site when it is known — the folded pre-chat username in F1, the platform's
-- player id once F2 verifies it — what a member flag can follow when the
-- customer record cannot.
--
-- `raised_by` and `cleared_by` are accounts, with no foreign key (an account
-- removed later does not take the record with it). An AI-raised flag has no
-- `raised_by`; `rule_ref` names the guardrail rule (G1…G19) when one raised it.
--
-- The CHECKs and the constants of `risk-flags.ts` are one list
-- (`risk-flags.test.ts` in the api's integration suite compares them).
--
-- Expand only (CONVENTIONS §6.3): a new table the previous release does not
-- read.

CREATE TABLE "risk_flags" (
    "id"                 UUID           NOT NULL,
    "license_id"         BIGINT         NOT NULL,
    "scope"              TEXT           NOT NULL,
    "chat_id"            VARCHAR(12),
    "thread_id"          VARCHAR(12),
    "customer_id"        UUID,
    "member_key"         TEXT,
    "type"               TEXT           NOT NULL,
    "severity"           TEXT           NOT NULL,
    "source"             TEXT           NOT NULL,
    "rule_ref"           TEXT,
    "evidence_event_ids" TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "note"               TEXT,
    "basis"              TEXT           NOT NULL DEFAULT 'declared',
    "status"             TEXT           NOT NULL DEFAULT 'active',
    "raised_by"          UUID,
    "raised_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_by"         UUID,
    "cleared_at"         TIMESTAMPTZ(6),
    "clear_reason"       TEXT,

    CONSTRAINT "risk_flags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "risk_flags_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "risk_flags_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "risk_flags_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "risk_flags_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    -- `RISK_FLAG_SCOPES`, `RISK_FLAG_TYPES`, `RISK_FLAG_SEVERITIES`,
    -- `RISK_FLAG_SOURCES`, `RISK_FLAG_BASES`, `RISK_FLAG_STATUSES`.
    CONSTRAINT risk_flags_scope_check CHECK (scope IN ('chat', 'member')),
    CONSTRAINT risk_flags_type_check CHECK (type IN (
      'rg_signal', 'self_exclusion_request', 'underage_suspected', 'self_harm', 'complaint_formal',
      'fraud_suspected', 'account_takeover_suspected', 'multi_account', 'abusive', 'account_security'
    )),
    CONSTRAINT risk_flags_severity_check CHECK (severity IN ('info', 'high', 'urgent')),
    CONSTRAINT risk_flags_source_check CHECK (source IN ('ai_rule', 'ai_classifier', 'agent', 'qa')),
    CONSTRAINT risk_flags_basis_check CHECK (basis IN ('declared', 'verified')),
    CONSTRAINT risk_flags_status_check CHECK (status IN ('active', 'cleared')),
    -- A flag is about a player: the customer record, or their key on the site.
    CONSTRAINT risk_flags_subject_check CHECK (customer_id IS NOT NULL OR member_key IS NOT NULL),
    -- A rule's flag names the rule; nobody else's does.
    CONSTRAINT risk_flags_rule_ref_check CHECK (
      (source = 'ai_rule') = (rule_ref IS NOT NULL)
      AND (rule_ref IS NULL OR rule_ref ~ '^G([1-9]|1[0-9])$')
    ),
    -- A person's flag names the person; the AI's names nobody.
    CONSTRAINT risk_flags_raised_by_check CHECK (
      (source IN ('agent', 'qa')) = (raised_by IS NOT NULL)
    ),
    -- Cleared means by someone, at a time, for a reason — and only then.
    CONSTRAINT risk_flags_cleared_check CHECK (
      (status = 'cleared') = (cleared_at IS NOT NULL)
      AND (status = 'cleared') = (cleared_by IS NOT NULL)
      AND (status = 'cleared') = (clear_reason IS NOT NULL)
    ),
    -- `RISK_FLAG_NOTE_MAX`, `RISK_FLAG_CLEAR_REASON_MAX`, `RISK_FLAG_EVIDENCE_MAX`,
    -- `RISK_FLAG_MEMBER_KEY_MAX`.
    CONSTRAINT risk_flags_note_check CHECK (
      note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 1000
    ),
    CONSTRAINT risk_flags_clear_reason_check CHECK (
      clear_reason IS NULL OR char_length(btrim(clear_reason)) BETWEEN 1 AND 500
    ),
    CONSTRAINT risk_flags_evidence_check CHECK (cardinality(evidence_event_ids) <= 20),
    CONSTRAINT risk_flags_member_key_check CHECK (
      member_key IS NULL OR char_length(member_key) BETWEEN 1 AND 200
    )
);

-- The report and archive filter (`GET /risk-flags`): a workspace's flags by
-- status and type. A player's active flags, read on every AI turn and by the
-- campaign engine: only active rows, so its size follows the flagged players,
-- not history — Prisma cannot express the WHERE (`scripts/check-drift.ts`
-- allows it by name). A conversation's flags, oldest first. The two foreign
-- keys a delete follows.
CREATE INDEX "risk_flags_license_id_status_type_idx"
  ON "risk_flags"("license_id", "status", "type");
CREATE INDEX "risk_flags_active_customer_idx"
  ON "risk_flags"("license_id", "customer_id") WHERE status = 'active';
CREATE INDEX "risk_flags_chat_id_raised_at_idx" ON "risk_flags"("chat_id", "raised_at");
CREATE INDEX "risk_flags_thread_id_idx" ON "risk_flags"("thread_id");
CREATE INDEX "risk_flags_customer_id_idx" ON "risk_flags"("customer_id");

-- --------------------------------------------------------------------------
-- What a row may be written as, and the one change it takes
-- --------------------------------------------------------------------------
-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace flag, under its own licence, another workspace's chat or
-- customer. This looks them up as the writer, under the writer's RLS (the
-- `ai_guardrails_before_write` pattern, 20261019150000).
--
-- On INSERT: a flag starts active; a chat flag names its chat; a connection
-- is of the flag's chat; the customer is the chat's (filled in when absent).
-- On UPDATE: `active` → `cleared` with its three fields, once, and nothing
-- else — but the foreign keys' SET NULL is an UPDATE too, so `chat_id` and
-- `thread_id` may still go to null.
CREATE FUNCTION risk_flags_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  chat_customer UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'risk_flags: a flag is raised active'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.scope = 'chat' AND NEW.chat_id IS NULL THEN
      RAISE EXCEPTION 'risk_flags: a chat flag names its chat'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.thread_id IS NOT NULL AND NEW.chat_id IS NULL THEN
      RAISE EXCEPTION 'risk_flags: a connection is named with its chat'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.chat_id IS NOT NULL THEN
      SELECT c.customer_id INTO chat_customer
        FROM chats c
       WHERE c.id = NEW.chat_id
         AND c.license_id = NEW.license_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'risk_flags: chat % is not this workspace''s', NEW.chat_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF NEW.customer_id IS NULL THEN
        NEW.customer_id := chat_customer;
      ELSIF NEW.customer_id <> chat_customer THEN
        RAISE EXCEPTION 'risk_flags: customer % is not chat %''s', NEW.customer_id, NEW.chat_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF NEW.thread_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM threads t
       WHERE t.id = NEW.thread_id
         AND t.chat_id = NEW.chat_id
         AND t.license_id = NEW.license_id
    ) THEN
      RAISE EXCEPTION 'risk_flags: thread % is not chat %''s', NEW.thread_id, NEW.chat_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.chat_id IS NULL AND NEW.customer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM customers k WHERE k.id = NEW.customer_id
    ) THEN
      RAISE EXCEPTION 'risk_flags: customer % is not this workspace''s', NEW.customer_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE.
  IF (NEW.id, NEW.license_id, NEW.scope, NEW.customer_id, NEW.member_key, NEW.type,
      NEW.severity, NEW.source, NEW.rule_ref, NEW.evidence_event_ids, NEW.note, NEW.basis,
      NEW.raised_by, NEW.raised_at)
     IS DISTINCT FROM
     (OLD.id, OLD.license_id, OLD.scope, OLD.customer_id, OLD.member_key, OLD.type,
      OLD.severity, OLD.source, OLD.rule_ref, OLD.evidence_event_ids, OLD.note, OLD.basis,
      OLD.raised_by, OLD.raised_at)
     OR (NEW.chat_id IS DISTINCT FROM OLD.chat_id AND NEW.chat_id IS NOT NULL)
     OR (NEW.thread_id IS DISTINCT FROM OLD.thread_id AND NEW.thread_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'risk_flags: a flag is not rewritten — only cleared'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'cleared'
     AND (NEW.status, NEW.cleared_by, NEW.cleared_at, NEW.clear_reason)
         IS DISTINCT FROM (OLD.status, OLD.cleared_by, OLD.cleared_at, OLD.clear_reason)
  THEN
    RAISE EXCEPTION 'risk_flags: a cleared flag stays cleared, as it was'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER risk_flags_before_write
  BEFORE INSERT OR UPDATE ON risk_flags
  FOR EACH ROW
  EXECUTE FUNCTION risk_flags_before_write();

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------
-- Licence-scoped, though customers are the organization's: a flag is one
-- workspace's judgement about a player, not the organization's.

ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY risk_flags_tenant ON risk_flags
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant all four; a flag is never
-- deleted, and a workspace never empties the table.
GRANT SELECT, INSERT, UPDATE ON risk_flags TO siyahtus_app;
REVOKE DELETE, TRUNCATE ON risk_flags FROM siyahtus_app;
