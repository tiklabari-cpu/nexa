-- Two-factor recovery codes: the only way back in when the phone is gone
-- (NFR-S11 · FR-MOD-00.1 · S11-2FA-c, Faz-5 tm 152.3).
--
-- 20260826150000_two_factor_auth created `two_factor_recovery_codes` with row
-- level security enabled and *no permissive policy*, exactly the shape
-- `password_reset_tokens` has: an ordinary query by `nexa_app` returns nothing
-- and writes nothing, whatever the application layer believes it is doing. The
-- three functions below are therefore the entire access path, and each one is
-- narrow enough to be read as a rule rather than a query.
--
-- No table is altered here, so Prisma sees no change and `db:check-drift`
-- stays quiet — functions are invisible to the schema language, the same way
-- `auth_consume_password_reset` and `events_secure_partition` are.
--
-- Naming: `RETURNS TABLE (...)` declares a plpgsql variable per output column,
-- and 20260724094000_lifecycle_unambiguous_outputs is the record of what
-- happens when one of those names is also a column name — Postgres raises
-- 42702 "column reference is ambiguous", but only on the branch that runs.
-- Hence `consumed_code` / `codes_remaining` rather than `id` / `remaining`.

-- ---------------------------------------------------------------------------
-- Issue a batch, replacing whatever was there
-- ---------------------------------------------------------------------------
--
-- Regeneration invalidates every previous code, used or not: someone who asks
-- for a new sheet is saying the old one is no longer trustworthy, and leaving
-- the unused half of it live would quietly disagree with them.
--
-- The old rows are DELETEd rather than marked spent. There is nothing left to
-- learn from a hash whose code can never be presented again — the audit log is
-- where "a recovery code was used" is recorded — and deleting keeps the table
-- at one small batch per account, so `codes_remaining` is a plain count with no
-- filter to get wrong.
--
-- The account must already have an `account_two_factor` row. Recovery codes for
-- an account with no enrollment at all would not be a second factor; they would
-- be a second password. Enrollment (`activated_at IS NULL`) is enough at this
-- point precisely because activation itself issues the first batch, and
-- requiring `activated_at` here would make the caller's statement order load-
-- bearing for security.
CREATE FUNCTION auth_two_factor_replace_recovery_codes(
  p_account_id  UUID,
  p_code_hashes TEXT[]
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT := COALESCE(array_length(p_code_hashes, 1), 0);
BEGIN
  -- A bound, not a preference: this function is the only writer, and an
  -- unbounded array would let one call fill the table.
  IF v_count < 1 OR v_count > 20 THEN
    RAISE EXCEPTION 'recovery_code_batch_size' USING ERRCODE = 'check_violation';
  END IF;

  -- A repeated hash would be one code that can be spent twice — the exact
  -- property single-use is meant to deny. Cheaper to refuse the batch than to
  -- reason later about which of two identical rows was consumed.
  IF (SELECT count(DISTINCT h) FROM unnest(p_code_hashes) AS h) <> v_count THEN
    RAISE EXCEPTION 'recovery_code_duplicate' USING ERRCODE = 'unique_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM account_two_factor t WHERE t.account_id = p_account_id) THEN
    RAISE EXCEPTION 'two_factor_not_enrolled' USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM two_factor_recovery_codes c WHERE c.account_id = p_account_id;

  -- `id` has no database-level default here (see 20260826150000's comment), so
  -- it is supplied rather than assumed.
  INSERT INTO two_factor_recovery_codes (id, account_id, code_hash)
  SELECT gen_random_uuid(), p_account_id, h FROM unnest(p_code_hashes) AS h;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Spend one code, atomically
-- ---------------------------------------------------------------------------
--
-- The single conditional UPDATE is the whole point. Reading the row, checking
-- `used_at` in the application and then updating would leave a window in which
-- two requests both see an unused code — and the two requests racing for one
-- code is not a hypothetical: it is what someone locked out of their account
-- does when the first attempt seems to hang. Under READ COMMITTED the second
-- UPDATE blocks on the row lock and re-evaluates `used_at IS NULL` against the
-- committed version, so it matches nothing and returns no row.
--
-- `activated_at IS NOT NULL` is checked here but deliberately not above. A code
-- may be *issued* mid-enrollment; it may only be *spent* against live 2FA. This
-- also means a stale batch left behind by a future "disable 2FA" path cannot be
-- used to sign in — the check fails closed even if the cleanup is forgotten.
CREATE FUNCTION auth_two_factor_consume_recovery_code(
  p_account_id UUID,
  p_code_hash  TEXT
)
RETURNS TABLE (consumed_code UUID, codes_remaining INT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM account_two_factor t
     WHERE t.account_id = p_account_id AND t.activated_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  UPDATE two_factor_recovery_codes c
     SET used_at = now()
   WHERE c.account_id = p_account_id
     AND c.code_hash  = p_code_hash
     AND c.used_at IS NULL
  RETURNING c.id INTO v_code;

  IF v_code IS NULL THEN
    -- Unknown, already spent and belonging-to-someone-else are one answer.
    RETURN;
  END IF;

  RETURN QUERY
    SELECT v_code,
           (SELECT count(*)::INT FROM two_factor_recovery_codes c2
             WHERE c2.account_id = p_account_id AND c2.used_at IS NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- How many are left
-- ---------------------------------------------------------------------------
--
-- So the settings screen can say "3 recovery codes left" instead of leaving
-- someone to find out at the moment they need one.
CREATE FUNCTION auth_two_factor_count_recovery_codes(p_account_id UUID)
RETURNS INT
LANGUAGE sql SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::INT FROM two_factor_recovery_codes c
   WHERE c.account_id = p_account_id AND c.used_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION auth_two_factor_replace_recovery_codes(UUID, TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_two_factor_consume_recovery_code(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_two_factor_count_recovery_codes(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_two_factor_replace_recovery_codes(UUID, TEXT[]) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_two_factor_consume_recovery_code(UUID, TEXT) TO nexa_app;
GRANT EXECUTE ON FUNCTION auth_two_factor_count_recovery_codes(UUID) TO nexa_app;
