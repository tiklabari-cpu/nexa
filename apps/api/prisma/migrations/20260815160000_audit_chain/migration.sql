-- Export integrity: the audit trail proves its own completeness (NFR-C6 · C6-c).
--
-- The log has been append-only to `nexa_app` since slice 12 — INSERT and SELECT
-- granted, UPDATE and DELETE revoked, one SECURITY DEFINER hole for retention.
-- That stops the application erasing evidence. It does not stop anyone who
-- reaches the database *underneath* the application, and it says nothing at all
-- about a file that left the building: a `.ndjson` on an auditor's desk is a
-- claim about what happened, and until now the only reason to believe it was
-- that we said so.
--
-- Three things are added here, and they are one mechanism, not three features:
--
--   * chain columns on audit_log  — each entry carries an HMAC over its own
--                                   content and the hash of the entry before
--                                   it, plus a per-workspace position. A
--                                   changed row no longer matches the link
--                                   pointing at it; a removed row leaves a hole
--                                   in the numbering.
--   * audit_chain_heads           — the next position and hash, per workspace.
--                                   Advanced under a row lock (so concurrent
--                                   writers cannot fork the chain) and outliving
--                                   the rows themselves (so pruning cannot
--                                   reset the numbering or hide a deletion at
--                                   the front of what remains).
--   * audit_prune_expired         — rewritten so retention can no longer delete
--                                   an entry that has not been shipped yet.
--
-- The key is deliberately NOT here. It is derived per licence from a secret the
-- application holds (`AUDIT_CHAIN_SECRET`), so an attacker holding the database
-- can delete rows — they always could — but cannot recompute a chain that hides
-- it. A key stored alongside the data it authenticates makes the signature a
-- decoration. That is also why the columns are nullable: entries written before
-- this migration cannot be back-computed without the key, and a migration that
-- invented hashes for them would be forging exactly the assurance this control
-- exists to provide. They are honestly left unchained, and the verifier reports
-- an unchained row written *after* the chain began as a finding.

-- ---------------------------------------------------------------------------
-- The chain columns
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "chain_seq" BIGINT,
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prev_hash" TEXT;

-- CreateTable
CREATE TABLE "audit_chain_heads" (
    "license_id" BIGINT NOT NULL,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "hash" TEXT,
    "genesis_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pruned_through_seq" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_chain_heads_pkey" PRIMARY KEY ("license_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_license_id_chain_seq_key" ON "audit_log"("license_id", "chain_seq");

-- AddForeignKey
ALTER TABLE "audit_chain_heads" ADD CONSTRAINT "audit_chain_heads_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE audit_chain_heads IS
  'Next position and hash of each workspace''s tamper-evident audit chain (NFR-C6), plus how far retention has legitimately pruned it.';

-- The unique index above is what makes a position a *claim*. Postgres treats
-- NULLs as distinct, so it binds only the rows that carry a sequence number and
-- leaves the pre-chain rows alone — which is the behaviour wanted here, not an
-- accident of the default: `NULLS NOT DISTINCT` would make the migration fail
-- on any deployment with more than one existing entry.

-- A row is chained or it is not; there is no half-chained state. Without this a
-- row could carry a position with no hash (a claim to a slot backed by nothing)
-- or a hash with no position (unverifiable, because nothing says where in the
-- chain it belongs). `prev_hash` is deliberately outside the constraint: the
-- first entry of a chain genuinely has no predecessor.
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_chain_halves_check
    CHECK ((chain_seq IS NULL) = (hash IS NULL));

-- Positions count upward from 1. Zero is the head's "nothing yet" value and
-- must never appear on a row, or `pruned_through_seq = 0` (nothing pruned) and
-- "entry number zero" would be the same statement.
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_chain_seq_positive_check
    CHECK (chain_seq IS NULL OR chain_seq > 0);

-- ---------------------------------------------------------------------------
-- Row level security on the head
-- ---------------------------------------------------------------------------
-- The plain licence match every tenant table uses. What sits behind it is worth
-- naming: a cross-tenant write here is more dangerous than a read. Rolling
-- another workspace's head backwards would hand the next entries positions that
-- are already taken (the unique index refuses them, so their audit writes start
-- failing), and moving `pruned_through_seq` forward would make the verifier
-- treat entries somebody deleted as legitimately pruned. Neither leaks data.
-- Both destroy the trail's ability to speak.
ALTER TABLE audit_chain_heads ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_chain_heads_tenant ON audit_chain_heads
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- INSERT and UPDATE, because advancing the chain is the writer's whole job.
-- SELECT, because the verifier reads the anchor. Explicit, like every table
-- created after the schema-wide grant in 20260722154008.
GRANT SELECT, INSERT, UPDATE ON public.audit_chain_heads TO nexa_app;

-- No DELETE, and withholding it takes an explicit REVOKE (ALTER DEFAULT
-- PRIVILEGES in 20260722090000 hands all four to nexa_app on every new table).
-- Deleting the head is how you erase the memory that a chain ever existed: the
-- next entry would start at 1 with no predecessor and the whole preceding trail
-- would read as "before genesis", i.e. as rows nobody has to account for.
-- Erasing the workspace still clears it — the ON DELETE CASCADE above is
-- carried out by the referencing table's owner, not by nexa_app — which is what
-- NFR-C8 needs.
REVOKE DELETE ON public.audit_chain_heads FROM nexa_app;

-- ---------------------------------------------------------------------------
-- Retention may not delete what has not been shipped
-- ---------------------------------------------------------------------------
-- The invariant this whole slice turns on. `RETENTION_AUDIT_DAYS` (30 by
-- default) is a promise about how long the trail is *kept here*; it was never
-- meant to be a deadline for the SIEM to collect it. Before this change the two
-- were unrelated, so a workspace whose sink had been broken for a month lost
-- those entries permanently — and lost them in the one way the chain cannot
-- repair, because the rows that would prove the loss are the rows that went.
-- The result would be an export that verifies perfectly and is missing a month.
--
-- So: if a workspace ships its trail anywhere, retention may only remove what
-- that destination has already received. The rule is deliberately conservative
-- in the two places it could go either way:
--
--   * A configured-but-never-run export blocks pruning entirely. A sink that
--     has never delivered has a backlog of everything, and "nothing has been
--     shipped yet" is not a reason to start deleting. The visible cost is
--     storage that stops shrinking, which is a symptom an operator can see and
--     act on. The alternative cost is invisible.
--   * `enabled = false` does not block. Turning the feed off is a decision that
--     the trail is not being shipped; retention is then the only policy there
--     is, and honouring a stale cursor would freeze the log forever.
--
-- With several destinations the bar is the *least* advanced of them: an entry
-- is expendable once everyone who was going to receive it has.
CREATE OR REPLACE FUNCTION audit_prune_expired(p_license_id BIGINT, p_cutoff TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted BIGINT;
  pruned_to BIGINT;
  shipping INT;
  undelivered INT;
  delivered_at TIMESTAMPTZ;
  delivered_id UUID;
BEGIN
  -- Fail closed. Without a tenant there is nothing to scope the RLS-bypassing
  -- delete to; without a cutoff strictly before now() the age predicate would
  -- match live rows and turn a prune into a wipe.
  IF p_license_id IS NULL OR p_cutoff IS NULL OR p_cutoff >= now() THEN
    RAISE EXCEPTION
      'audit_prune_expired refuses license=% cutoff=%: needs a tenant and a cutoff strictly before now()',
      p_license_id, p_cutoff;
  END IF;

  SELECT count(*) FILTER (WHERE enabled),
         count(*) FILTER (WHERE enabled AND last_exported_at IS NULL)
    INTO shipping, undelivered
    FROM siem_export_cursors
   WHERE license_id = p_license_id;

  -- Enabled but nothing delivered yet: every entry is still owed to somebody.
  IF shipping > 0 AND undelivered > 0 THEN
    RETURN 0;
  END IF;

  IF shipping > 0 THEN
    -- The least advanced destination, on the same `(created_at, id)` keyset the
    -- export pages on, so "already delivered" here means exactly what it means
    -- there.
    SELECT last_exported_at, last_exported_id
      INTO delivered_at, delivered_id
      FROM siem_export_cursors
     WHERE license_id = p_license_id AND enabled
     ORDER BY last_exported_at ASC, last_exported_id ASC
     LIMIT 1;
  END IF;

  WITH gone AS (
    DELETE FROM audit_log
     WHERE license_id = p_license_id
       AND created_at < p_cutoff
       AND (
         shipping = 0
         OR (created_at, id) <= (delivered_at, delivered_id)
       )
    RETURNING chain_seq
  )
  SELECT count(*), max(chain_seq) INTO deleted, pruned_to FROM gone;

  -- Record how far the chain was legitimately shortened, so the verifier can
  -- tell this from somebody removing the oldest rows by hand. GREATEST, never
  -- backwards: a watermark that could retreat would re-open the window it was
  -- there to close.
  IF pruned_to IS NOT NULL THEN
    UPDATE audit_chain_heads
       SET pruned_through_seq = GREATEST(COALESCE(pruned_through_seq, 0), pruned_to),
           updated_at = now()
     WHERE license_id = p_license_id;
  END IF;

  RETURN deleted;
END;
$$;

-- Unchanged from 20260802090000, and restated because CREATE OR REPLACE resets
-- nothing: EXECUTE defaults to PUBLIC for a new function, so the one hole in the
-- append-only log stays reachable from exactly one role.
REVOKE EXECUTE ON FUNCTION audit_prune_expired(BIGINT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_prune_expired(BIGINT, TIMESTAMPTZ) TO nexa_app;
