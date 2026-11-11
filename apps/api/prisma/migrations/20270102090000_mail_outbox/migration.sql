-- The durable outgoing-mail queue (tm 464.1 · G-05 / NY-44).
--
-- Every mail today leaves through `deliver()` in the process that decided to
-- send it, and the only retry is the SMTP carrier's own three tries inside that
-- call (`services/mail/smtp-mailer.ts`). A restart, a deploy or a crash between
-- the decision and the carrier's `250` loses the mail; so does a carrier outage
-- longer than those few seconds. This is where a mail will wait instead:
--
--   1. `mail_outbox` — one row per mail. A caller writes it with
--      `enqueueMail(tx, …)` (`services/mail/outbox.ts`) in the transaction that
--      decided to send, so a committed decision has its mail and a rolled-back
--      one has none. `(license_id, idempotency_key)` is unique: a second
--      enqueue of the same mail adds nothing.
--   2. `mail_outbox_claim` — the sender's one cross-workspace read (the
--      `mail_outbox` scheduler job). Takes due rows under
--      `FOR UPDATE SKIP LOCKED`, counts the attempt and leases them, so two
--      senders never hold one row.
--   3. `mail_outbox_renew`, `mail_outbox_settle`, `mail_outbox_release` — the
--      claim that still holds a row extends its lease right before handing the
--      mail to the carrier, records how the send went, or gives back a row it
--      never tried (a shutdown mid-batch).
--   4. `mail_outbox_prune` — settled rows older than the kept window go.
--
-- Account mail (a password reset, a sign-up link — `Message.licenseId` null)
-- has no workspace, so the sender cannot work tenant by tenant the way the
-- WhatsApp inbox does: like `ai_jobs`, every state change is a SECURITY DEFINER
-- function, and the application role keeps SELECT and INSERT only.
--
-- Expand-only (CONVENTIONS §6.3): a new table and new functions; nothing an
-- earlier release reads or writes.

-- --------------------------------------------------------------------------
-- 1. mail_outbox
-- --------------------------------------------------------------------------
-- `recipient` is stored as typed (the carrier needs it) and never logged.
-- `payload` is the rest of the message — subject, bodies, attachments, the
-- threading headers — and is emptied the moment a row settles: a reset link or
-- a customer's transcript does not outlive its delivery here. What stays until
-- the prune is who, what kind, how it went and how many tries it took.
--
-- No database-side id default (the enqueue names the id, so an INSERT needs no
-- RETURNING — which the SELECT policy would refuse for account mail) and
-- `ON UPDATE CASCADE`, as 20261003150000 does, so the drift check has nothing
-- to report.
CREATE TABLE "mail_outbox" (
    "id"              UUID           NOT NULL,
    "license_id"      BIGINT,
    "kind"            TEXT           NOT NULL,
    "recipient"       TEXT           NOT NULL,
    "payload"         JSONB          NOT NULL,
    "status"          TEXT           NOT NULL DEFAULT 'pending',
    "attempts"        INTEGER        NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error"      TEXT,
    "idempotency_key" TEXT           NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at"      TIMESTAMPTZ(6),

    CONSTRAINT "mail_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mail_outbox_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `Message['kind']` (`services/mail/mailer.ts`) is the closed list; the
    -- column only refuses what is not a code, so a new kind needs no migration.
    CONSTRAINT mail_outbox_kind_check CHECK (kind ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT mail_outbox_recipient_check CHECK (char_length(recipient) BETWEEN 1 AND 320),
    -- `MailOutcome` (`services/mail/delivery.ts`) plus the waiting state.
    -- `unconfirmed` is its own end: handed over, acceptance never confirmed —
    -- neither "sent" nor something to send again (§D178).
    CONSTRAINT mail_outbox_status_check CHECK (
      status IN ('pending', 'sent', 'unconfirmed', 'failed')
    ),
    CONSTRAINT mail_outbox_attempts_check CHECK (attempts >= 0),
    -- A code (`MailErrorCode`, `unexpected`, `attempts_exhausted`), never text a
    -- server or a person wrote.
    CONSTRAINT mail_outbox_last_error_check CHECK (
      last_error IS NULL OR last_error ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
    CONSTRAINT mail_outbox_idempotency_key_check CHECK (
      char_length(idempotency_key) BETWEEN 1 AND 200
    ),
    -- Settled exactly when no longer pending, and a settled row carries no body.
    CONSTRAINT mail_outbox_settled_check CHECK ((status = 'pending') = (settled_at IS NULL)),
    CONSTRAINT mail_outbox_payload_check CHECK (status = 'pending' OR payload = '{}'::jsonb)
);

-- One mail per workspace and key; account mail (NULL licence) shares one key
-- space, hence NULLS NOT DISTINCT. Prisma has no syntax for that clause and
-- describes the index by its two columns, which is what schema.prisma declares.
-- The licence leads, so the index also serves the licence's cascade.
CREATE UNIQUE INDEX "mail_outbox_license_id_idempotency_key_key"
    ON "mail_outbox"("license_id", "idempotency_key") NULLS NOT DISTINCT;
-- The claim's entry point (due pending rows) and the queue's depth.
CREATE INDEX "mail_outbox_status_next_attempt_at_idx" ON "mail_outbox"("status", "next_attempt_at");
-- The prune.
CREATE INDEX "mail_outbox_settled_at_idx" ON "mail_outbox"("settled_at");

-- A workspace reads its own rows; account mail matches no licence, so no
-- tenant ever sees it. An enqueue is a new row — pending, untried — written in
-- its own workspace, or account mail from anywhere: a two-factor notice is
-- account mail even when a workspace request sets it off.
ALTER TABLE mail_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY mail_outbox_tenant_read ON mail_outbox FOR SELECT
  USING (license_id = siyahtus_current_license());
CREATE POLICY mail_outbox_enqueue ON mail_outbox FOR INSERT
  WITH CHECK ((license_id IS NULL OR license_id = siyahtus_current_license())
              AND status = 'pending'
              AND attempts = 0
              AND last_error IS NULL
              AND settled_at IS NULL);

-- The default privileges (20260722090000) granted every verb. State moves
-- through the functions below; rows leave with their licence or the prune.
REVOKE ALL ON mail_outbox FROM siyahtus_app;
GRANT SELECT, INSERT ON mail_outbox TO siyahtus_app;

-- The root panel may read the queue; it never writes it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON mail_outbox FROM siyahtus_platform;
    GRANT SELECT ON mail_outbox TO siyahtus_platform;
  END IF;
END
$$;

-- --------------------------------------------------------------------------
-- 2. mail_outbox_claim — take due rows, oldest due first
-- --------------------------------------------------------------------------
-- Returns at most `p_limit` rows, each with `attempts` counted up and leased
-- for `p_lease_seconds` (`next_attempt_at` moves to the lease's end, so the row
-- is not due again until the lease runs out). A row is due when it is
-- `pending` and its `next_attempt_at` has come: new, a retry whose backoff
-- has passed, or one whose sender died holding it.
--
-- Why two senders never hold the same row: the candidates are read
-- `FOR UPDATE SKIP LOCKED`, so a row another claim is taking is skipped
-- rather than waited for, and the lock re-reads its newest committed version
-- (READ COMMITTED), so a row another claim already leased is no longer due.
--
-- Attempts. A row is handed out at most `p_max_attempts` times. One still
-- pending with every attempt spent is one whose sender died during the last
-- (it may have gone out): it is settled `failed` (`attempts_exhausted`) here,
-- never sent again.
--
-- `clock_timestamp()`, not `now()`, so "due" and the lease are right even when
-- a caller runs this inside a longer transaction.
CREATE FUNCTION mail_outbox_claim(
  p_limit         INTEGER,
  p_lease_seconds INTEGER,
  p_max_attempts  INTEGER
)
RETURNS TABLE (
  id          UUID,
  license_id  BIGINT,
  kind        TEXT,
  recipient   TEXT,
  payload     JSONB,
  attempts    INTEGER,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600
     OR p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 20 THEN
    RAISE EXCEPTION 'mail_outbox_claim: invalid argument' USING ERRCODE = '22023';
  END IF;

  UPDATE mail_outbox r
     SET status = 'failed',
         last_error = 'attempts_exhausted',
         payload = '{}'::jsonb,
         settled_at = v_now
   WHERE r.id IN (
     SELECT o.id FROM mail_outbox o
      WHERE o.status = 'pending'
        AND o.next_attempt_at <= v_now
        AND o.attempts >= p_max_attempts
      FOR UPDATE SKIP LOCKED);

  RETURN QUERY
  UPDATE mail_outbox r
     SET attempts = r.attempts + 1,
         next_attempt_at = v_now + make_interval(secs => p_lease_seconds)
   WHERE r.id IN (
     SELECT o.id FROM mail_outbox o
      WHERE o.status = 'pending'
        AND o.next_attempt_at <= v_now
        AND o.attempts < p_max_attempts
      ORDER BY o.next_attempt_at, o.created_at, o.id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED)
  RETURNING r.id, r.license_id, r.kind, r.recipient, r.payload, r.attempts, r.created_at;
END
$$;

-- --------------------------------------------------------------------------
-- 3. renew / settle / release — only for the claim that still holds the row
-- --------------------------------------------------------------------------
-- A claim is identified by the attempt it counted: `(p_id, p_attempts)` holds
-- the row while it is pending with that many attempts. Once a lease runs out
-- and another claim takes the row, `attempts` moves on and every call below
-- from the old claim answers false and changes nothing.

-- Right before a mail is handed to the carrier: still ours, and still inside
-- the lease? Then the lease starts over, so the send — however long the
-- carrier takes, up to the lease — cannot overlap another claim's. A claim
-- whose lease ran out gives the row up even when nobody has taken it yet.
CREATE FUNCTION mail_outbox_renew(p_id UUID, p_attempts INTEGER, p_lease_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_id IS NULL OR p_attempts IS NULL
     OR p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'mail_outbox_renew: invalid argument' USING ERRCODE = '22023';
  END IF;
  UPDATE mail_outbox
     SET next_attempt_at = v_now + make_interval(secs => p_lease_seconds)
   WHERE id = p_id
     AND attempts = p_attempts
     AND status = 'pending'
     AND next_attempt_at > v_now;
  RETURN FOUND;
END
$$;

-- How the send went. `pending` is a retry after `p_retry_after_seconds`; the
-- three ends empty the payload. No lease check: a sender that outlived its
-- lease but whose row nobody took records what really happened.
CREATE FUNCTION mail_outbox_settle(
  p_id                  UUID,
  p_attempts            INTEGER,
  p_status              TEXT,
  p_error               TEXT,
  p_retry_after_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_id IS NULL OR p_attempts IS NULL
     OR p_status IS NULL OR p_status NOT IN ('pending', 'sent', 'unconfirmed', 'failed')
     OR p_retry_after_seconds IS NULL OR p_retry_after_seconds < 0
     OR p_retry_after_seconds > 86400 THEN
    RAISE EXCEPTION 'mail_outbox_settle: invalid argument' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'pending' THEN
    UPDATE mail_outbox
       SET next_attempt_at = v_now + make_interval(secs => p_retry_after_seconds),
           last_error = p_error
     WHERE id = p_id AND attempts = p_attempts AND status = 'pending';
  ELSE
    UPDATE mail_outbox
       SET status = p_status,
           last_error = p_error,
           payload = '{}'::jsonb,
           settled_at = v_now
     WHERE id = p_id AND attempts = p_attempts AND status = 'pending';
  END IF;
  RETURN FOUND;
END
$$;

-- A claimed row this claim never tried (the pass was stopped before reaching
-- it): its attempt is given back and it is due at once.
CREATE FUNCTION mail_outbox_release(p_id UUID, p_attempts INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_id IS NULL OR p_attempts IS NULL OR p_attempts < 1 THEN
    RAISE EXCEPTION 'mail_outbox_release: invalid argument' USING ERRCODE = '22023';
  END IF;
  UPDATE mail_outbox
     SET attempts = attempts - 1,
         next_attempt_at = clock_timestamp()
   WHERE id = p_id AND attempts = p_attempts AND status = 'pending';
  RETURN FOUND;
END
$$;

-- --------------------------------------------------------------------------
-- 4. mail_outbox_prune — settled rows past the kept window
-- --------------------------------------------------------------------------
-- Pending rows are never pruned, however old. At most `p_limit` per call.
CREATE FUNCTION mail_outbox_prune(p_keep_days INTEGER, p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 OR p_keep_days > 3650
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'mail_outbox_prune: invalid argument' USING ERRCODE = '22023';
  END IF;
  DELETE FROM mail_outbox
   WHERE id IN (
     SELECT o.id FROM mail_outbox o
      WHERE o.status <> 'pending'
        AND o.settled_at < clock_timestamp() - make_interval(days => p_keep_days)
      ORDER BY o.settled_at
      LIMIT p_limit);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END
$$;

REVOKE EXECUTE ON FUNCTION mail_outbox_claim(INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mail_outbox_renew(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mail_outbox_settle(UUID, INTEGER, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mail_outbox_release(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mail_outbox_prune(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mail_outbox_claim(INTEGER, INTEGER, INTEGER) TO siyahtus_app;
GRANT EXECUTE ON FUNCTION mail_outbox_renew(UUID, INTEGER, INTEGER) TO siyahtus_app;
GRANT EXECUTE ON FUNCTION mail_outbox_settle(UUID, INTEGER, TEXT, TEXT, INTEGER) TO siyahtus_app;
GRANT EXECUTE ON FUNCTION mail_outbox_release(UUID, INTEGER) TO siyahtus_app;
GRANT EXECUTE ON FUNCTION mail_outbox_prune(INTEGER, INTEGER) TO siyahtus_app;
