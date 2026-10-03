-- Expired unverified sign-ups (tm 257.19 · ADR docs/adr/pilot-public-readiness.md
-- K-e(1) · PLAN §D203).
--
-- With `SIGNUP_EMAIL_VERIFICATION=true`, `auth_signup` (20261002120000, last
-- re-created by 20261003120000) builds the whole workspace before anybody has
-- proven the address: an organization, its licence and default brand, the
-- owner's account and membership, and an OAuth client. On a public sign-up
-- some of those mailboxes never answer — a bot's, a typo's — and nothing ever
-- removed what they left behind. `purge_unverified_signups` does, called by
-- the `unverified_signups` scheduler job, which runs only while the flag is on.
--
-- Expand-only (CONVENTIONS §6.3): two new functions, nothing existing is
-- altered, and an API from before this release calls neither.

-- --------------------------------------------------------------------------
-- 1. What may go — one predicate, asked twice
-- --------------------------------------------------------------------------
-- The candidate scan and the re-check under lock below both ask exactly this,
-- so the two can never disagree about what a purgeable sign-up is. One row —
-- the workspace that would go with the account — or none:
--
--   * unverified, and created before the cutoff;
--   * its own sign-up workspace: the account owns a licence created in the
--     same transaction as the account. `auth_signup` writes the organization,
--     the licence and the account in one transaction, so their `created_at`
--     (each `CURRENT_TIMESTAMP`) are the same instant; a workspace the account
--     came to own any other way does not match;
--   * not a sandbox, and no sandbox of its own;
--   * the account belongs to nothing else; nobody else belongs to the
--     workspace or holds an open invitation into it; no other licence shares
--     its organization — so deleting the organization deletes this workspace
--     and nothing more;
--   * no customer has reached it: no chat, no ticket;
--   * nobody has asked the address in anywhere: an open invitation addressed
--     to it, from any workspace, keeps it;
--   * no link mailed to it still works. A verification link — or a password
--     reset link, which verifies too — is a promise the deployment made, so
--     the account stays until the newest one has lapsed and a late click never
--     lands on a deleted account. It also keeps the purge and the redeeming
--     functions apart: each of them can only act on an account this excludes.
--
-- Not callable by the application role: it reads across every tenant, and is
-- only ever run from inside the SECURITY DEFINER function below, as its owner.
CREATE FUNCTION unverified_signup_purgeable(p_account UUID, p_cutoff TIMESTAMPTZ)
RETURNS TABLE (purge_license BIGINT, purge_organization UUID)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.organization_id
    FROM accounts a
    JOIN agent_memberships m ON m.agent_id = a.id AND m.role = 'owner'
    JOIN licenses l ON l.id = m.license_id
   WHERE a.id = p_account
     AND a.email_verified_at IS NULL
     AND a.created_at < p_cutoff
     AND l.created_at = a.created_at
     AND l.sandbox_of_license_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM agent_memberships x
                      WHERE x.agent_id = a.id AND x.license_id <> l.id)
     AND NOT EXISTS (SELECT 1 FROM agent_memberships x
                      WHERE x.license_id = l.id AND x.agent_id <> a.id)
     AND NOT EXISTS (SELECT 1 FROM invitations i
                      WHERE i.license_id = l.id
                        AND i.accepted_at IS NULL
                        AND i.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM licenses o
                      WHERE o.organization_id = l.organization_id AND o.id <> l.id)
     AND NOT EXISTS (SELECT 1 FROM licenses s WHERE s.sandbox_of_license_id = l.id)
     AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.license_id = l.id)
     AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.license_id = l.id)
     AND NOT EXISTS (SELECT 1 FROM invitations i
                      WHERE i.email = a.email
                        AND i.accepted_at IS NULL
                        AND i.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM email_verification_tokens v
                      WHERE v.account_id = a.id
                        AND v.used_at IS NULL
                        AND v.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM password_reset_tokens r
                      WHERE r.account_id = a.id
                        AND r.used_at IS NULL
                        AND r.expires_at > now());
$$;

REVOKE EXECUTE ON FUNCTION unverified_signup_purgeable(UUID, TIMESTAMPTZ) FROM PUBLIC;

-- --------------------------------------------------------------------------
-- 2. The purge
-- --------------------------------------------------------------------------
-- SECURITY DEFINER, like `sandbox_reset` (20260815200000): every candidate is
-- a different workspace, the caller (the scheduler) has no tenant context, RLS
-- would show it none of them, and the application role holds no DELETE on
-- `audit_log` (20260722154008), which the licence's cascade has to remove.
-- EXECUTE goes to the application role alone.
--
-- What goes. Deleting the organization takes its licence and OAuth client,
-- and the licence takes every table that carries its foreign key — all
-- `ON DELETE CASCADE`, `audit_log` and `audit_chain_heads` among them — the
-- same reliance on the catalogue `sandbox_reset` explains: a hand-written list
-- would be quietly incomplete the day the next table arrives. Two tables carry
-- no key the cascade can follow and are deleted by hand: `customers` (scoped to
-- the organization; their visits follow) and `trusted_domains`. The account
-- goes last and takes its tokens with it. Nothing is written to an audit trail:
-- the workspace's own trail is part of what is deleted, and no other
-- workspace's trail is the place for it. The job logs a count instead.
--
-- Locks. A request can change the answer between the scan and the delete: a
-- verification, a membership somewhere else (SCIM, an invitation), a visitor's
-- first chat. So each candidate is locked — account, organization, licence and
-- the account's link rows — and the predicate asked again in a fresh
-- statement, which sees everything committed before the locks were granted.
-- Whatever commits later has to get past those locks first: a membership or a
-- token row names the account by foreign key, a chat or a ticket names the
-- licence, and a foreign key check takes a share lock on the row it names.
--
-- `NOWAIT`: the purge never queues behind a request. A row somebody holds right
-- now means the candidate is in use; its subtransaction is rolled back, which
-- releases what it had locked, and it is looked at again on the next pass. The
-- redeeming functions take a link row before the account
-- (`auth_consume_email_verification`, `auth_request_email_verification`), so a
-- purge that held the account while waiting for a link row would be one half
-- of a deadlock. `lock_timeout` bounds the cascade's own waits the same way:
-- a row deep in the cascade held for longer than that defers the candidate. A
-- candidate the re-check no longer finds purgeable is rolled back the same way
-- rather than skipped, so an account that was verified a moment ago is not
-- held locked — its owner's first sign-in waiting on it — until the batch ends.
--
-- What the locks cannot hold back is a row that names the workspace by no
-- foreign key at all: a customer the widget creates in the instant between the
-- delete and its commit stays behind, unreachable — as it would after
-- `sandbox_reset`.
--
-- Up to `p_limit` accounts per call, oldest first; returns how many it deleted.
CREATE FUNCTION purge_unverified_signups(p_ttl INTERVAL, p_limit INT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_cutoff    TIMESTAMPTZ;
  v_candidate RECORD;
  v_purged    INT := 0;
BEGIN
  IF p_ttl IS NULL OR p_ttl <= INTERVAL '0' THEN
    RAISE EXCEPTION 'purge_unverified_signups: p_ttl must be positive, got %', p_ttl
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'purge_unverified_signups: p_limit must be at least 1, got %', p_limit
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - p_ttl;

  FOR v_candidate IN
    SELECT a.id AS account_id, p.purge_license, p.purge_organization
      FROM accounts a
      CROSS JOIN LATERAL unverified_signup_purgeable(a.id, v_cutoff) p
     WHERE a.email_verified_at IS NULL
       AND a.created_at < v_cutoff
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  LOOP
    BEGIN
      PERFORM 1 FROM accounts a
        WHERE a.id = v_candidate.account_id FOR UPDATE NOWAIT;
      PERFORM 1 FROM organizations o
        WHERE o.id = v_candidate.purge_organization FOR UPDATE NOWAIT;
      PERFORM 1 FROM licenses l
        WHERE l.id = v_candidate.purge_license FOR UPDATE NOWAIT;
      PERFORM 1 FROM email_verification_tokens v
        WHERE v.account_id = v_candidate.account_id FOR UPDATE NOWAIT;
      PERFORM 1 FROM password_reset_tokens r
        WHERE r.account_id = v_candidate.account_id FOR UPDATE NOWAIT;

      -- Asked again now that nothing can change underneath: the same workspace,
      -- still purgeable.
      IF NOT EXISTS (
        SELECT 1 FROM unverified_signup_purgeable(v_candidate.account_id, v_cutoff) p
         WHERE p.purge_license = v_candidate.purge_license
           AND p.purge_organization = v_candidate.purge_organization
      ) THEN
        RAISE no_data_found;
      END IF;

      DELETE FROM organizations o WHERE o.id = v_candidate.purge_organization;
      DELETE FROM customers c WHERE c.organization_id = v_candidate.purge_organization;
      DELETE FROM trusted_domains d
       WHERE d.organization_id = v_candidate.purge_organization
          OR d.license_id = v_candidate.purge_license;
      DELETE FROM accounts a WHERE a.id = v_candidate.account_id;

      v_purged := v_purged + 1;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected OR no_data_found THEN
        -- In use right now, or no longer purgeable. Rolled back: nothing of it
        -- was deleted, what it locked is released, and the next pass asks again.
        NULL;
    END;
  END LOOP;

  RETURN v_purged;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_unverified_signups(INTERVAL, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_unverified_signups(INTERVAL, INT) TO siyahtus_app;
