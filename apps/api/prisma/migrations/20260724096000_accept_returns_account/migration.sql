-- Return the account's email and name from the accept, rather than making the
-- caller look them up afterwards.
--
-- That follow-up query runs as the application role with no tenant context — the
-- person has only just joined — so row level security filtered it away and the
-- request failed *after* the invitation had already been consumed. The function
-- has both values in hand; handing them back removes the second query and the
-- window where the two could disagree.
DROP FUNCTION IF EXISTS auth_accept_invitation(TEXT, TEXT, TEXT);

CREATE FUNCTION auth_accept_invitation(
  p_token_hash    TEXT,
  p_name          TEXT,
  p_password_hash TEXT
)
RETURNS TABLE (joined_account UUID, joined_license BIGINT, joined_email TEXT, joined_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite  invitations%ROWTYPE;
  v_account UUID;
  v_email   TEXT;
  v_name    TEXT;
BEGIN
  UPDATE invitations i
     SET accepted_at = now()
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.expires_at > now()
  RETURNING i.* INTO v_invite;

  IF v_invite.id IS NULL THEN
    RETURN;
  END IF;

  SELECT a.id, a.email::TEXT, a.name INTO v_account, v_email, v_name
  FROM accounts a WHERE a.email = v_invite.email;

  IF v_account IS NULL THEN
    IF p_password_hash IS NULL THEN
      RAISE EXCEPTION 'nexa_password_required';
    END IF;
    v_account := gen_random_uuid();
    v_email   := v_invite.email::TEXT;
    v_name    := COALESCE(p_name, split_part(v_invite.email::TEXT, '@', 1));
    INSERT INTO accounts (id, email, name, password_hash)
    VALUES (v_account, v_invite.email, v_name, p_password_hash);
  END IF;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_invite.license_id, v_account, v_invite.role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;

  RETURN QUERY SELECT v_account, v_invite.license_id, v_email, v_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_accept_invitation(TEXT, TEXT, TEXT) TO nexa_app;
