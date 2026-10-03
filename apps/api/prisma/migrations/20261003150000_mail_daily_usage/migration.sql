-- Daily outgoing-mail caps (tm 257.14 · ADR docs/adr/pilot-public-readiness.md
-- K-e(4) · PLAN §D203).
--
-- Sign-up is public in the pilot. Every invitation, ticket notice and visitor
-- transcript leaves from the deployment's own sender, carrying text a tenant
-- or a visitor wrote; nothing counted that per day, so a stranger could open a
-- workspace and spend the sender's reputation — and the mail account itself,
-- which a provider suspends past its daily limit, taking every password reset
-- with it. This table is the day's count, and the two functions below are the
-- only things that write it.
--
-- Expand-only (CONVENTIONS §6.3): a new table and new functions; nothing an
-- API from the previous release reads changes.

-- --------------------------------------------------------------------------
-- 1. mail_daily_usage
-- --------------------------------------------------------------------------
-- Per workspace and UTC day: `workspace` (every mail it sent) and `external`
-- (the part that left the workspace — invitations, ticket notices, a
-- visitor's transcript). With license_id NULL: `global`, one row per day for
-- the deployment, and `recipient`, one row per day and address hash for the
-- account mail an anonymous caller can trigger (password reset, sign-up
-- verification, the account-exists notice). A new day is a new row, so
-- nothing ever resets a counter at midnight.
--
-- The unique key is NULLS NOT DISTINCT so the rows with a NULL license or a
-- NULL hash are one row per key, and `ON CONFLICT` finds them like any other.
-- Prisma has no syntax for that clause and describes the index by its four
-- columns, which is what schema.prisma declares. No database-side id default
-- and `ON UPDATE CASCADE`, as 20261002150000 does, so the drift check has
-- nothing to report.
CREATE TABLE mail_daily_usage (
    "id"             UUID           NOT NULL,
    "license_id"     BIGINT,
    "day"            CHAR(8)        NOT NULL,
    "meter"          TEXT           NOT NULL,
    "recipient_hash" CHAR(64),
    "sent"           INTEGER        NOT NULL DEFAULT 0,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mail_daily_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mail_daily_usage_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX mail_daily_usage_license_id_day_meter_recipient_hash_key
    ON mail_daily_usage (license_id, day, meter, recipient_hash) NULLS NOT DISTINCT;

-- A workspace may read its own rows; the deployment and recipient rows match
-- no licence, so no tenant ever sees them. Nothing but the functions below
-- writes: the application role keeps SELECT only, so the check and the
-- increment cannot be split into two statements by a later caller that found
-- the table writable.
ALTER TABLE mail_daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY mail_daily_usage_tenant ON mail_daily_usage
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

GRANT SELECT ON mail_daily_usage TO siyahtus_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON mail_daily_usage FROM siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. mail_budget_spend — check and count in one statement per row
-- --------------------------------------------------------------------------
-- Called before a mail is handed to the carrier. Counts it on every row it
-- belongs to, or on none, and answers NULL (counted) or the cap that would be
-- crossed: 'recipient', 'workspace', 'external' or 'global'.
--
-- A workspace mail (p_license_id set) counts on its `workspace` row, on its
-- `external` row when it leaves the workspace, and on the `global` row — but
-- only up to the global cap less the reserve: the top of the global cap is
-- kept for account mail. An account mail (p_license_id NULL) counts on its
-- `recipient` row when it carries a hash, and on the `global` row up to the
-- whole cap.
--
-- Each row is one `INSERT … ON CONFLICT DO UPDATE … WHERE` whose WHERE is the
-- cap: Postgres locks the conflicting row and evaluates the WHERE against its
-- latest committed version, so concurrent mails queue on the row and the last
-- one that fits is the last one counted — no read-then-write window. A row
-- that refuses hands back what the rows before it counted, in the same
-- transaction. Rows are always taken in the same order — recipient,
-- workspace, external, global — here and in mail_budget_refund, so two mails
-- never wait on each other in opposite orders.
--
-- The licence is a parameter, unlike ai_budget_reserve's transaction tenant:
-- account mail has no tenant, and the sweeps and command-line jobs that send
-- most workspace mail run outside any tenant transaction. Callers are the
-- server's own mailer, never a request's input.
CREATE FUNCTION mail_budget_spend(
  p_license_id    BIGINT,
  p_day           TEXT,
  p_external      BOOLEAN,
  p_recipient     TEXT,
  p_workspace_cap INTEGER,
  p_external_cap  INTEGER,
  p_global_cap    INTEGER,
  p_reserve       INTEGER,
  p_recipient_cap INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_global_limit INTEGER;
BEGIN
  IF p_day IS NULL OR p_day !~ '^[0-9]{8}$' OR p_external IS NULL
     OR p_workspace_cap IS NULL OR p_workspace_cap < 1
     OR p_external_cap IS NULL OR p_external_cap < 1
     OR p_global_cap IS NULL OR p_global_cap < 1
     OR p_reserve IS NULL OR p_reserve < 0 OR p_reserve >= p_global_cap
     OR p_recipient_cap IS NULL OR p_recipient_cap < 1
     OR (p_recipient IS NOT NULL AND p_recipient !~ '^[0-9a-f]{64}$')
     -- A workspace mail has no per-address count, and an account mail never
     -- leaves a workspace: anything else is a caller mixing the two.
     OR (p_license_id IS NOT NULL AND p_recipient IS NOT NULL)
     OR (p_license_id IS NULL AND p_external) THEN
    RAISE EXCEPTION 'mail_budget_spend: invalid argument' USING ERRCODE = '22023';
  END IF;

  IF p_recipient IS NOT NULL THEN
    INSERT INTO mail_daily_usage AS u (id, license_id, day, meter, recipient_hash, sent, updated_at)
    VALUES (gen_random_uuid(), NULL, p_day, 'recipient', p_recipient, 1, now())
    ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE
       SET sent = u.sent + 1, updated_at = now()
     WHERE u.sent + 1 <= p_recipient_cap;
    IF NOT FOUND THEN
      RETURN 'recipient';
    END IF;
  END IF;

  IF p_license_id IS NOT NULL THEN
    INSERT INTO mail_daily_usage AS u (id, license_id, day, meter, recipient_hash, sent, updated_at)
    VALUES (gen_random_uuid(), p_license_id, p_day, 'workspace', NULL, 1, now())
    ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE
       SET sent = u.sent + 1, updated_at = now()
     WHERE u.sent + 1 <= p_workspace_cap;
    IF NOT FOUND THEN
      RETURN 'workspace';
    END IF;

    IF p_external THEN
      INSERT INTO mail_daily_usage AS u (id, license_id, day, meter, recipient_hash, sent, updated_at)
      VALUES (gen_random_uuid(), p_license_id, p_day, 'external', NULL, 1, now())
      ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE
         SET sent = u.sent + 1, updated_at = now()
       WHERE u.sent + 1 <= p_external_cap;
      IF NOT FOUND THEN
        UPDATE mail_daily_usage u SET sent = u.sent - 1, updated_at = now()
         WHERE u.license_id = p_license_id AND u.day = p_day
           AND u.meter = 'workspace' AND u.recipient_hash IS NULL;
        RETURN 'external';
      END IF;
    END IF;

    v_global_limit := p_global_cap - p_reserve;
  ELSE
    v_global_limit := p_global_cap;
  END IF;

  INSERT INTO mail_daily_usage AS u (id, license_id, day, meter, recipient_hash, sent, updated_at)
  VALUES (gen_random_uuid(), NULL, p_day, 'global', NULL, 1, now())
  ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE
     SET sent = u.sent + 1, updated_at = now()
   WHERE u.sent + 1 <= v_global_limit;
  IF NOT FOUND THEN
    IF p_recipient IS NOT NULL THEN
      UPDATE mail_daily_usage u SET sent = u.sent - 1, updated_at = now()
       WHERE u.license_id IS NULL AND u.day = p_day
         AND u.meter = 'recipient' AND u.recipient_hash = p_recipient;
    END IF;
    IF p_license_id IS NOT NULL THEN
      UPDATE mail_daily_usage u SET sent = u.sent - 1, updated_at = now()
       WHERE u.license_id = p_license_id AND u.day = p_day
         AND u.recipient_hash IS NULL
         AND (u.meter = 'workspace' OR (p_external AND u.meter = 'external'));
    END IF;
    RETURN 'global';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION mail_budget_spend(BIGINT, TEXT, BOOLEAN, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mail_budget_spend(BIGINT, TEXT, BOOLEAN, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 3. mail_budget_refund — a mail the carrier refused for good, given back
-- --------------------------------------------------------------------------
-- Called once per counted mail that did not go out (the server refused it,
-- the carrier's retries ran out), with the day it was counted on. Not for one
-- whose acceptance was never confirmed: that one may have arrived. Without
-- this, a morning of carrier outage would spend the day's caps on mail nobody
-- received. Never below zero — a defect that refunded twice must not mint
-- allowance.
CREATE FUNCTION mail_budget_refund(
  p_license_id BIGINT,
  p_day        TEXT,
  p_external   BOOLEAN,
  p_recipient  TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_day IS NULL OR p_external IS NULL
     OR (p_license_id IS NOT NULL AND p_recipient IS NOT NULL)
     OR (p_license_id IS NULL AND p_external) THEN
    RAISE EXCEPTION 'mail_budget_refund: invalid argument' USING ERRCODE = '22023';
  END IF;

  IF p_recipient IS NOT NULL THEN
    UPDATE mail_daily_usage u SET sent = GREATEST(u.sent - 1, 0), updated_at = now()
     WHERE u.license_id IS NULL AND u.day = p_day
       AND u.meter = 'recipient' AND u.recipient_hash = p_recipient;
  END IF;

  IF p_license_id IS NOT NULL THEN
    UPDATE mail_daily_usage u SET sent = GREATEST(u.sent - 1, 0), updated_at = now()
     WHERE u.license_id = p_license_id AND u.day = p_day
       AND u.meter = 'workspace' AND u.recipient_hash IS NULL;
    IF p_external THEN
      UPDATE mail_daily_usage u SET sent = GREATEST(u.sent - 1, 0), updated_at = now()
       WHERE u.license_id = p_license_id AND u.day = p_day
         AND u.meter = 'external' AND u.recipient_hash IS NULL;
    END IF;
  END IF;

  UPDATE mail_daily_usage u SET sent = GREATEST(u.sent - 1, 0), updated_at = now()
   WHERE u.license_id IS NULL AND u.day = p_day
     AND u.meter = 'global' AND u.recipient_hash IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION mail_budget_refund(BIGINT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mail_budget_refund(BIGINT, TEXT, BOOLEAN, TEXT) TO siyahtus_app;
