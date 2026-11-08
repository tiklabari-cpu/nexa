-- A verified account joins a workspace only once it has shown it is the one
-- joining (tm 421 · audit 2026-11-06 F04 · PLAN §D456).
--
-- `POST /invitations` hands the accept link to the admin who sent it ("Copy
-- invite link", GV-03-S1), so holding the link proves nobody's identity. Until
-- now the accept joined a verified account on the link alone: an admin could
-- invite anybody's address, accept the link themselves, and put that person in
-- their workspace without their say — and the answer listed every workspace
-- the person belonged to.
--
-- Now the verified branch of `auth_accept_invitation` joins only an account
-- the caller has proven. The API checks the account's password, or a signed-in
-- session of the same account, and passes what it proved: `p_proof_account`,
-- and for a password the hash it checked against (`p_proof_password_hash`).
-- The function compares them with the account row it already locks, so the
-- proof is about the account as it is when the join is written — a password
-- changed after the API checked it matches nothing. Anything short of that is
-- refused before a row is written (`siyahtus_sign_in_required`); the
-- invitation stays live.
--
-- The three unverified branches are unchanged: they join nothing at the accept,
-- and the address is proven by the mailed link with the password (tm 282).
--
-- `auth_find_invitee` is the route's reader: the account a live invitation's
-- address belongs to, whether it is verified, and — only then — its password
-- hash, so the API can check a password before the accept. The hash leaves the
-- database the way `auth_find_account_for_login` hands it to sign-in.
--
-- Not expand-only, on purpose (CONVENTIONS §6.3 · §D456): an API from before
-- this release calls the five-argument form, names no proof, and is refused for
-- a verified account until it is replaced — on that API a 500, with nothing
-- written and the invitation still live. Failing closed for the length of a
-- rollout is the fix; the old answer was the defect. Every other branch works
-- for it unchanged.

-- --------------------------------------------------------------------------
-- 1. auth_find_invitee — whose account a live invitation would join
-- --------------------------------------------------------------------------
CREATE FUNCTION auth_find_invitee(p_token_hash TEXT)
RETURNS TABLE (
  invitee_account       UUID,
  invitee_verified      BOOLEAN,
  invitee_password_hash TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.id,
         a.email_verified_at IS NOT NULL,
         -- Only a verified account is asked for its password here; nothing
         -- else needs the hash.
         CASE WHEN a.email_verified_at IS NOT NULL THEN a.password_hash END
    FROM invitations i
    JOIN accounts a ON a.email = i.email
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.expires_at > now();
$$;

REVOKE EXECUTE ON FUNCTION auth_find_invitee(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_invitee(TEXT) TO siyahtus_app;

-- --------------------------------------------------------------------------
-- 2. auth_accept_invitation — 20261022190000's, plus the proof
-- --------------------------------------------------------------------------
-- Two defaulted trailing arguments, so the signature changes: dropped and
-- created, as 20261015120000 did, rather than replaced.
DROP FUNCTION IF EXISTS auth_accept_invitation(TEXT, TEXT, TEXT, INT, TIMESTAMPTZ);

CREATE FUNCTION auth_accept_invitation(
  p_token_hash          TEXT,
  p_name                TEXT,
  p_password_hash       TEXT,
  p_trial_days          INT DEFAULT NULL,
  p_hold_until          TIMESTAMPTZ DEFAULT NULL,
  p_proof_account       UUID DEFAULT NULL,
  p_proof_password_hash TEXT DEFAULT NULL
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
  v_invite        invitations%ROWTYPE;
  v_account       UUID;
  v_email         TEXT;
  v_name          TEXT;
  v_verified      BOOLEAN;
  v_password_hash TEXT;
  v_has_member    BOOLEAN;
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

  SELECT a.id, a.email::TEXT, a.name, a.email_verified_at IS NOT NULL, a.password_hash
    INTO v_account, v_email, v_name, v_verified, v_password_hash
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

  -- A verified account: the caller must have proven it is this one (tm 421).
  -- A session proves the account; a password proves it only while it is still
  -- the account's password.
  IF p_proof_account IS DISTINCT FROM v_account
     OR (p_proof_password_hash IS NOT NULL
         AND p_proof_password_hash IS DISTINCT FROM v_password_hash) THEN
    RAISE EXCEPTION 'siyahtus_sign_in_required';
  END IF;

  UPDATE invitations i SET accepted_at = now() WHERE i.id = v_invite.id;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_invite.license_id, v_account, v_invite.role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;

  -- FOUND: the insert above created the membership, rather than finding one.
  IF FOUND THEN
    PERFORM auth_apply_invitation_groups(v_invite.id, v_invite.license_id, v_account);
  END IF;

  RETURN QUERY SELECT v_account, v_invite.license_id, v_email, v_name,
                      v_invite.id, v_invite.role, FALSE, v_invite.organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT, INT, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT, INT, TIMESTAMPTZ, UUID, TEXT) TO siyahtus_app;
