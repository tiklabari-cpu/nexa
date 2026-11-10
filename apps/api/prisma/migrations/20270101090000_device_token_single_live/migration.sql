-- One push token, one live registration (tm 443 · F36 · FR-MOD-13.7).
--
-- The phone revokes its registration when a session ends, but only when it
-- still holds a credential to revoke with. A session that is *dropped* — the
-- refresh token expired, or was refused — has none, so the phone forgets its
-- device id locally and the server row in that workspace stays live. Signing
-- in to workspace B then registers the same handset there, and workspace A
-- keeps pushing its conversations to a phone that is now showing B's inbox.
--
-- The app holds one session at a time, so a handset that registers in B has,
-- by its own act, stopped being A's. Registration now says so on the server:
-- `device_tokens_release_elsewhere(token)` marks every *other* workspace's live
-- row for the same token revoked, inside the registering request's tenant
-- transaction. The fix does not depend on the phone having been able to say
-- goodbye, which is the case that failed.
--
-- Why a SECURITY DEFINER function rather than a query: the rows to release are
-- in other tenants, which RLS hides from `siyahtus_app` — correctly, and that
-- does not change. The function is the one narrow cross-tenant write: it can
-- only *revoke*, only rows whose token the caller has just proved it holds,
-- only in licences other than the caller's own, and it returns nothing, so the
-- registering workspace cannot learn whether the handset was registered
-- anywhere else (the same reason the unique index stays licence-scoped).
--
-- The transaction-scoped advisory lock serialises two registrations of one
-- token: the second waits for the first to commit, and its UPDATE (a new
-- snapshot under READ COMMITTED) then sees and releases the first's row. Without
-- it, two simultaneous registrations in two workspaces would each miss the
-- other's uncommitted insert and both stay live.
--
-- `revoked_at` is clamped to the row's `created_at` because the CHECK forbids a
-- revoke before the registration, and `now()` is this transaction's start —
-- which can precede a row another transaction created after we began.
--
-- Expand only (CONVENTIONS §6.3): a new function and a new index; old code
-- calls neither.

CREATE INDEX "device_tokens_token_idx" ON "device_tokens"("token");

CREATE OR REPLACE FUNCTION device_tokens_release_elsewhere(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_license BIGINT := siyahtus_current_license();
BEGIN
  -- Outside a tenant transaction there is no "elsewhere" to measure from, and
  -- `license_id <> NULL` matches nothing — refuse loudly instead of no-op'ing.
  IF v_license IS NULL THEN
    RAISE EXCEPTION 'device_tokens_release_elsewhere called without a tenant';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('siyahtus.device-token'), hashtext(p_token));

  UPDATE device_tokens
     SET revoked_at = GREATEST(now(), created_at)
   WHERE token = p_token
     AND license_id <> v_license
     AND revoked_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION device_tokens_release_elsewhere(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_tokens_release_elsewhere(TEXT) TO siyahtus_app;
