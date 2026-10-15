-- An invitation link no longer proves the address (tm 282 · GV-03 · PLAN §D229).
--
-- `POST /invitations` hands the accept link back to the admin ("Copy invite
-- link"), so holding the link means "somebody invited this address", not "I own
-- this mailbox". Until now accepting it as a newcomer created a verified account
-- (the column default) with whatever password the link holder typed, joined it
-- to the workspace and counted a seat: an admin could open an account under a
-- rival's or a celebrity's address, and since one address is one account
-- everywhere, that account followed the real person into every other workspace.
--
-- Now an account the link creates is unverified, and joining waits for the
-- address to be proven — the sign-up verification link (with the password), or
-- a password reset, which proves it too. An already verified account joins as
-- before.
--
-- Expand-only (CONVENTIONS §6.3): one nullable column with its index and foreign
-- key, functions re-created with defaulted trailing arguments, two new ones. An
-- API from before this release calls `auth_accept_invitation` with four
-- arguments and reads the four columns it always read.

-- --------------------------------------------------------------------------
-- 1. invitations.pending_account_id
-- --------------------------------------------------------------------------
-- The account that accepted this invitation and has yet to prove its address.
-- Set by `auth_accept_invitation`, read by `auth_join_pending_invitations`. The
-- invitation stays live meanwhile (`accepted_at IS NULL`): it is still listed,
-- still counted against the seat ceiling, still revocable, and its link still
-- works — so the real invitee can accept after somebody else did. `SET NULL`:
-- an account purged unverified gives the invitation back.
ALTER TABLE invitations ADD COLUMN pending_account_id UUID;

ALTER TABLE invitations
  ADD CONSTRAINT invitations_pending_account_id_fkey
  FOREIGN KEY (pending_account_id) REFERENCES accounts(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX invitations_pending_account_id_idx ON invitations (pending_account_id);

-- --------------------------------------------------------------------------
-- 2. auth_preview_invitation — who still has to choose a password
-- --------------------------------------------------------------------------
-- A password is asked for when no account holds the address, or when the one
-- that does is unverified and belongs to no workspace — an account an earlier
-- accept of an invitation made, perhaps with somebody else's password. Nobody
-- can sign in to anything with that one, so letting the next accept replace its
-- password harms no one, and it is how the real invitee gets past an admin who
-- accepted first.
--
-- An unverified account that does belong somewhere — an owner still waiting on
-- the sign-up link — is not asked: its password is left alone, and the address
-- is proven with that password or a reset.
CREATE OR REPLACE FUNCTION auth_preview_invitation(p_token_hash TEXT)
RETURNS TABLE (organization_name TEXT, email TEXT, role TEXT, needs_password BOOLEAN)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT o.name,
         i.email::TEXT,
         i.role,
         NOT EXISTS (SELECT 1 FROM accounts a
                      WHERE a.email = i.email
                        AND (a.email_verified_at IS NOT NULL
                             OR EXISTS (SELECT 1 FROM agent_memberships m
                                         WHERE m.agent_id = a.id)))
  FROM invitations i
  JOIN organizations o ON o.id = i.organization_id
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL
    AND i.expires_at > now();
$$;

-- --------------------------------------------------------------------------
-- 3. auth_accept_invitation — joins a verified account, parks the rest
-- --------------------------------------------------------------------------
-- Four branches, by the account the address belongs to:
--
--   * none — a password is required; the account is created unverified;
--   * unverified, no workspace — a password is required and replaces the old
--     one (whose sessions are revoked); the name too;
--   * unverified, in a workspace — nothing about the account changes;
--   * verified — joined now, as before.
--
-- The first three return `verification_required` and join nothing: the
-- invitation records who accepted it (`pending_account_id`) and stays live. The
-- caller mails a verification link in the same transaction. `p_hold_until` is
-- that link's expiry: the invitation is kept alive at least that long, so an
-- invitation accepted on its last day can still be joined by the link it sent.
--
-- No longer verifies anything: 20261002120000's branch did, on the grounds that
-- the link was mailed to the address — but the link is also handed to the admin.
-- So `p_trial_days` is no longer read; it stays in the signature because an API
-- from before this release passes it.
--
-- `joined_invitation`, `joined_role` and `joined_organization` are returned for
-- the trail; the route used to look them up again under the tenant's RLS.
DROP FUNCTION IF EXISTS auth_accept_invitation(TEXT, TEXT, TEXT, INT);

CREATE FUNCTION auth_accept_invitation(
  p_token_hash    TEXT,
  p_name          TEXT,
  p_password_hash TEXT,
  p_trial_days    INT DEFAULT NULL,
  p_hold_until    TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  joined_account        UUID,
  joined_license        BIGINT,
  joined_email          TEXT,
  joined_name           TEXT,
  joined_invitation     UUID,
  joined_role           TEXT,
  verification_required BOOLEAN,
  joined_organization   UUID
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite     invitations%ROWTYPE;
  v_account    UUID;
  v_email      TEXT;
  v_name       TEXT;
  v_verified   BOOLEAN;
  v_has_member BOOLEAN;
BEGIN
  -- Locked, not spent: only the verified branch spends it.
  SELECT i.* INTO v_invite
    FROM invitations i
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.expires_at > now()
     FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RETURN;
  END IF;

  SELECT a.id, a.email::TEXT, a.name, a.email_verified_at IS NOT NULL
    INTO v_account, v_email, v_name, v_verified
    FROM accounts a WHERE a.email = v_invite.email
     FOR UPDATE;

  IF v_account IS NULL THEN
    IF p_password_hash IS NULL THEN
      RAISE EXCEPTION 'siyahtus_password_required';
    END IF;
    v_account  := gen_random_uuid();
    v_email    := v_invite.email::TEXT;
    v_name     := COALESCE(p_name, split_part(v_invite.email::TEXT, '@', 1));
    v_verified := FALSE;
    INSERT INTO accounts (id, email, name, password_hash, email_verified_at)
    VALUES (v_account, v_invite.email, v_name, p_password_hash, NULL);
  ELSIF NOT v_verified THEN
    v_has_member := EXISTS (SELECT 1 FROM agent_memberships m WHERE m.agent_id = v_account);
    IF NOT v_has_member THEN
      IF p_password_hash IS NULL THEN
        RAISE EXCEPTION 'siyahtus_password_required';
      END IF;
      v_name := COALESCE(p_name, v_name);
      UPDATE accounts a SET password_hash = p_password_hash, name = v_name
       WHERE a.id = v_account;

      UPDATE oauth_refresh_tokens r SET revoked_at = now()
       WHERE r.account_id = v_account AND r.revoked_at IS NULL;
      UPDATE api_tokens k SET revoked_at = now()
       WHERE k.owner_id = v_account::TEXT
         AND k.kind IN ('pat', 'oauth', 'enrollment')
         AND k.revoked_at IS NULL;
      -- A link mailed for the old password can never be redeemed with the new
      -- one; the caller mails a fresh link.
      UPDATE email_verification_tokens t SET used_at = now()
       WHERE t.account_id = v_account AND t.used_at IS NULL;
    END IF;
  END IF;

  IF NOT v_verified THEN
    UPDATE invitations i
       SET pending_account_id = v_account,
           expires_at = GREATEST(i.expires_at, COALESCE(p_hold_until, i.expires_at))
     WHERE i.id = v_invite.id;

    RETURN QUERY SELECT v_account, v_invite.license_id, v_email, v_name,
                        v_invite.id, v_invite.role, TRUE, v_invite.organization_id;
    RETURN;
  END IF;

  UPDATE invitations i SET accepted_at = now() WHERE i.id = v_invite.id;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_invite.license_id, v_account, v_invite.role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;

  RETURN QUERY SELECT v_account, v_invite.license_id, v_email, v_name,
                      v_invite.id, v_invite.role, FALSE, v_invite.organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT, INT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT, INT, TIMESTAMPTZ) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 4. auth_join_pending_invitations — the join, once the address is proven
-- --------------------------------------------------------------------------
-- Called by the API in the same transaction as whatever proved the address (the
-- verification link, a password reset), and a no-op for an account still
-- unverified — so calling it is never a way round the proof. Joins every live
-- invitation this account accepted and is still addressed to it, spends them,
-- and returns one row per workspace for the seat raise and the trail.
--
-- Its own function rather than a step inside `auth_mark_email_verified`: the
-- caller needs to know which workspaces were joined, to raise their seats in
-- the same transaction (FR-MOD-04.4), and that function's callers return none.
CREATE FUNCTION auth_join_pending_invitations(p_account UUID)
RETURNS TABLE (
  joined_license      BIGINT,
  joined_organization UUID,
  joined_invitation   UUID,
  joined_role         TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.id = p_account AND a.email_verified_at IS NOT NULL) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH spent AS (
    UPDATE invitations i
       SET accepted_at = now()
      FROM accounts a
     WHERE a.id = p_account
       AND i.pending_account_id = p_account
       AND i.email = a.email
       AND i.accepted_at IS NULL
       AND i.expires_at > now()
    RETURNING i.id, i.license_id, i.organization_id, i.role
  ), joined AS (
    INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
    SELECT s.license_id, p_account, s.role, 'accepting_chats' FROM spent s
    ON CONFLICT (license_id, agent_id) DO NOTHING
  )
  SELECT s.license_id, s.organization_id, s.id, s.role FROM spent s;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_join_pending_invitations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_join_pending_invitations(UUID) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 5. Expired unverified invitees (ADR docs/adr/pilot-public-readiness.md K-e(5))
-- --------------------------------------------------------------------------
-- An account an invitation created and nobody verified holds an address and a
-- name, and nothing else: no workspace, so no data of anybody's. It is deleted
-- once it is older than the sign-up TTL and no link mailed to it still works —
-- by the `unverified_signups` job, beside the sign-ups it already purges. Its
-- pending invitation, if still live, becomes plain live again (`SET NULL`).
--
-- `purge_unverified_signups`' shape (20261003190000): one predicate asked twice,
-- each candidate locked `NOWAIT` (account first, then its link rows, the order
-- the redeeming functions cannot deadlock against) and asked again under lock,
-- one subtransaction per account. Nothing is written to any audit trail: the
-- account has no workspace, so there is no trail it belongs to.
CREATE FUNCTION unverified_invitee_purgeable(p_account UUID, p_cutoff TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM accounts a
     WHERE a.id = p_account
       AND a.email_verified_at IS NULL
       AND a.created_at < p_cutoff
       AND NOT EXISTS (SELECT 1 FROM agent_memberships m WHERE m.agent_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.invited_by_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM email_verification_tokens v
                        WHERE v.account_id = a.id
                          AND v.used_at IS NULL
                          AND v.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM password_reset_tokens r
                        WHERE r.account_id = a.id
                          AND r.used_at IS NULL
                          AND r.expires_at > now())
  );
$$;

REVOKE EXECUTE ON FUNCTION unverified_invitee_purgeable(UUID, TIMESTAMPTZ) FROM PUBLIC;

CREATE FUNCTION purge_unverified_invitees(p_ttl INTERVAL, p_limit INT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_cutoff  TIMESTAMPTZ;
  v_account UUID;
  v_purged  INT := 0;
BEGIN
  IF p_ttl IS NULL OR p_ttl <= INTERVAL '0' THEN
    RAISE EXCEPTION 'purge_unverified_invitees: p_ttl must be positive, got %', p_ttl
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'purge_unverified_invitees: p_limit must be at least 1, got %', p_limit
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - p_ttl;

  FOR v_account IN
    SELECT a.id
      FROM accounts a
     WHERE a.email_verified_at IS NULL
       AND a.created_at < v_cutoff
       AND unverified_invitee_purgeable(a.id, v_cutoff)
     ORDER BY a.created_at, a.id
     LIMIT p_limit
  LOOP
    BEGIN
      PERFORM 1 FROM accounts a WHERE a.id = v_account FOR UPDATE NOWAIT;
      PERFORM 1 FROM email_verification_tokens v
        WHERE v.account_id = v_account FOR UPDATE NOWAIT;
      PERFORM 1 FROM password_reset_tokens r
        WHERE r.account_id = v_account FOR UPDATE NOWAIT;

      IF NOT unverified_invitee_purgeable(v_account, v_cutoff) THEN
        RAISE no_data_found;
      END IF;

      DELETE FROM accounts a WHERE a.id = v_account;
      v_purged := v_purged + 1;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected OR no_data_found OR foreign_key_violation THEN
        NULL;
    END;
  END LOOP;

  RETURN v_purged;
END;
$$;

REVOKE EXECUTE ON FUNCTION purge_unverified_invitees(INTERVAL, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_unverified_invitees(INTERVAL, INT) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 6. auth_issue_email_verification — the link, and what it is for
-- --------------------------------------------------------------------------
-- `auth_request_email_verification` (20261002120000) plus the name of the
-- workspace the account is waiting to join, if any: the newest live invitation
-- it accepted unverified. The resend route mails an invitee the invitation's
-- wording rather than the sign-up's ("thanks for signing up" to somebody who
-- never did), and it still makes one database call on every branch.
-- `pending_workspace` is NULL for a sign-up; both columns are NULL when nothing
-- was recorded.
CREATE FUNCTION auth_issue_email_verification(
  p_email      CITEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (recorded_account UUID, pending_workspace TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
BEGIN
  v_account := auth_request_email_verification(p_email, p_token_hash, p_expires_at);

  RETURN QUERY
  SELECT v_account,
         (SELECT o.name
            FROM invitations i
            JOIN organizations o ON o.id = i.organization_id
           WHERE v_account IS NOT NULL
             AND i.pending_account_id = v_account
             AND i.accepted_at IS NULL
             AND i.expires_at > now()
           ORDER BY i.created_at DESC, i.id
           LIMIT 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_issue_email_verification(CITEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_issue_email_verification(CITEXT, TEXT, TIMESTAMPTZ) TO siyahtus_app;
