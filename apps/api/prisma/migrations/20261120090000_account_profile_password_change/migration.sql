-- "My profile" (tm 327 · SiyahTuş analysis RL-06): the name visitors see, and
-- changing the password from inside the panel.
--
--   - `accounts.public_name` — optional; the widget shows it instead of
--     `name` (RL-06-S2). The account's, like `name`: one person, one face,
--     in every workspace. Trimmed by the API; the CHECK is the same bound.
--   - `auth_change_password` — the password is account-wide and the sessions
--     it ends live in every workspace the account reaches, which the tenant
--     role cannot see past RLS. So, like `auth_consume_password_reset`, the
--     write is a SECURITY DEFINER function. Unlike the reset it keeps one
--     session — the one asking (RL-06-S1) — and leaves personal access
--     tokens alone: the caller proved the current password, nothing says
--     the account was lost. The route verifies that password before calling.
--
-- Expand only (CONVENTIONS §6.3): a nullable column the previous release
-- never reads, and a new function.

ALTER TABLE "accounts" ADD COLUMN "public_name" TEXT;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_public_name_length
    CHECK (public_name IS NULL OR char_length(public_name) BETWEEN 1 AND 120);

-- `p_keep_token` is the access token of the request (`api_tokens.id`); its
-- refresh family survives, every other one is revoked with its access tokens.
-- A keep token that is not the account's own sign-in token keeps nothing.
-- Returns how many other sessions (refresh families) were ended.
CREATE FUNCTION auth_change_password(
  p_account       UUID,
  p_password_hash TEXT,
  p_keep_token    UUID
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family UUID;
  v_ended  INTEGER;
BEGIN
  SELECT k.family_id INTO v_family
    FROM api_tokens k
   WHERE k.id = p_keep_token
     AND k.owner_id = p_account::TEXT
     AND k.kind = 'oauth';

  UPDATE accounts a SET password_hash = p_password_hash WHERE a.id = p_account;

  WITH ended AS (
    UPDATE oauth_refresh_tokens r SET revoked_at = now()
     WHERE r.account_id = p_account
       AND r.revoked_at IS NULL
       AND r.family_id IS DISTINCT FROM v_family
    RETURNING r.family_id
  )
  SELECT count(DISTINCT e.family_id)::INTEGER INTO v_ended FROM ended e;

  UPDATE api_tokens k SET revoked_at = now()
   WHERE k.owner_id = p_account::TEXT
     AND k.kind IN ('oauth', 'enrollment')
     AND k.revoked_at IS NULL
     AND (v_family IS NULL OR k.family_id IS DISTINCT FROM v_family);

  RETURN v_ended;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_change_password(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_change_password(UUID, TEXT, UUID) TO siyahtus_app;
