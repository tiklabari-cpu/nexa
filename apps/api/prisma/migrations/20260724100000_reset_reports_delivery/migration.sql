-- Report whether a reset token was actually recorded.
--
-- The function returned void, and the service worked out "was that address
-- real?" with its own `SELECT ... FROM accounts` — which runs as the
-- application role with no tenant context, so row level security returned zero
-- rows every time. The token was written and the email was never sent, for
-- anybody. The integration tests missed it because they assert on the table the
-- SECURITY DEFINER function writes, not on the mail that follows.
--
-- Returning the boolean is safe: the *service* may know, and does — it is the
-- *route* that must answer identically either way, and it still does.
-- Dropped first: Postgres will not let CREATE OR REPLACE change a function's
-- return type, and this one goes from void to boolean.
DROP FUNCTION IF EXISTS auth_request_password_reset(CITEXT, TEXT, TIMESTAMPTZ);

CREATE FUNCTION auth_request_password_reset(
  p_email      CITEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT a.id INTO v_account FROM accounts a WHERE a.email = p_email;
  IF v_account IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE password_reset_tokens
     SET used_at = now()
   WHERE account_id = v_account AND used_at IS NULL;

  INSERT INTO password_reset_tokens (id, account_id, token_hash, expires_at)
  VALUES (gen_random_uuid(), v_account, p_token_hash, p_expires_at);

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_request_password_reset(CITEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_request_password_reset(CITEXT, TEXT, TIMESTAMPTZ) TO nexa_app;
