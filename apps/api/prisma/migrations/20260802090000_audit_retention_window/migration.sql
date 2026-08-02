-- Time-based pruning of the append-only audit log (NFR-S12: "basic audit …
-- the last 30 days, on every plan").
--
-- The audit log is append-only from the application's point of view: migration
-- 20260722154008 enables RLS with only a SELECT and an INSERT policy, then
-- `REVOKE UPDATE, DELETE ON audit_log FROM nexa_app`. That is exactly what a
-- tamper-proof trail needs — an actor who could edit the log could erase the
-- evidence of what they did — but it also means the 30-day retention window
-- cannot be applied through the normal `nexa_app` + `withTenant` path the rest
-- of the retention sweep uses: that role has no DELETE on this table at all.
--
-- So the window is opened by one narrow SECURITY DEFINER function, mirroring
-- `retention_list_tenants()`: a small, named, reviewable hole that does exactly
-- one thing. Because SECURITY DEFINER runs as the owner and bypasses RLS, the
-- explicit `license_id = p_license_id` predicate is the *only* thing keeping a
-- prune inside its own tenant — so it is written first, the age predicate
-- second, and there is no path that deletes without both. A null or
-- not-yet-past cutoff would select live rows, so the function refuses it
-- outright rather than run: retention must never be one bad argument away from
-- erasing a tenant's — or every tenant's — trail. The table-level DELETE revoke
-- on `nexa_app` stays exactly as it was; `nexa_app` gains only EXECUTE on this
-- function, and PUBLIC gains nothing.

CREATE OR REPLACE FUNCTION audit_prune_expired(p_license_id BIGINT, p_cutoff TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted BIGINT;
BEGIN
  -- Fail closed. Without a tenant there is nothing to scope the RLS-bypassing
  -- delete to; without a cutoff strictly before now() the age predicate would
  -- match live rows and turn a prune into a wipe.
  IF p_license_id IS NULL OR p_cutoff IS NULL OR p_cutoff >= now() THEN
    RAISE EXCEPTION
      'audit_prune_expired refuses license=% cutoff=%: needs a tenant and a cutoff strictly before now()',
      p_license_id, p_cutoff;
  END IF;

  DELETE FROM audit_log
   WHERE license_id = p_license_id
     AND created_at < p_cutoff;

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- EXECUTE defaults to PUBLIC for a new function; take it back and grant only the
-- application role, so the one hole in the append-only log is reachable from
-- exactly one place. The table's UPDATE/DELETE revoke on nexa_app is untouched.
REVOKE EXECUTE ON FUNCTION audit_prune_expired(BIGINT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_prune_expired(BIGINT, TIMESTAMPTZ) TO nexa_app;
