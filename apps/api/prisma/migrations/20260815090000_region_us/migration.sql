-- A second region, and the rule that makes the first one mean anything
-- (NFR-C4/C9 · C4-a).
--
-- ADR-12 locked the MVP to one region with two halves to it: the value set was
-- `{eu}`, and `region` was immutable. This migration widens the first half and
-- *implements* the second, which until now was a sentence in a schema comment.
--
-- Widening without enforcing would be the worse of the two changes to ship
-- alone: with one legal value, "immutable" was true by accident — there was
-- nothing else to set it to. With two, a plain UPDATE moves a workspace's
-- declared data residency, which is the one claim the whole compliance item is
-- selling. Everything C4-b and C4-e go on to enforce reads this column.

-- ---------------------------------------------------------------------------
-- The value set
-- ---------------------------------------------------------------------------
-- Existing rows are untouched: every workspace created so far declared `eu` and
-- stays there. A backfill is not merely unnecessary, it is the thing forbidden
-- below — moving a region is exactly what the trigger refuses.
ALTER TABLE organizations
  DROP CONSTRAINT organizations_region_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_region_check CHECK (region IN ('eu', 'us'));

COMMENT ON COLUMN organizations.region IS
  'Where this workspace''s data lives (ADR-12, widened by C4-a). Chosen when the workspace is created and immutable afterwards — enforced by organizations_region_immutable, not by convention.';

-- ---------------------------------------------------------------------------
-- Immutability, in the database
-- ---------------------------------------------------------------------------
-- The decision this slice had to make (PLAN §C-A20.3): where does immutability
-- live? Three candidates were on the table.
--
--   * An `if` in the service that writes it. Rejected: there is no such
--     service — nothing updates `region` today — so the guard would be a rule
--     with no enforcement point, and the first code that did want to write the
--     column would simply not know about it. C4-b and C4-e build their region
--     decisions on top of this value; a guard that a new call site can miss is
--     not a foundation for them.
--   * `REVOKE UPDATE (region) ON organizations FROM nexa_app`. Rejected: it
--     binds one role. A migration, the seed, a psql session as the table owner
--     and any role added later all still move the column, and the failure it
--     does produce reads as `permission denied for table organizations` on
--     unrelated writes to the same row.
--   * A trigger. Chosen: it binds every writer including the table owner, it
--     names the rule in its error, and it lets everything else about the row
--     stay writable (a workspace can still be renamed).
--
-- A workspace *ending* is not a move, so DELETE is untouched; the row leaves
-- with its region intact.
CREATE OR REPLACE FUNCTION organizations_reject_region_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- IS DISTINCT FROM, not <>: the column is NOT NULL today, and an UPDATE that
  -- writes the same value it already held is not a move and must not fail —
  -- ORMs send full rows, and a rename would otherwise be refused for touching
  -- a column it did not change.
  IF NEW.region IS DISTINCT FROM OLD.region THEN
    RAISE EXCEPTION 'nexa_region_immutable'
      USING ERRCODE = 'check_violation',
            DETAIL = format('region is %L and cannot be changed to %L', OLD.region, NEW.region),
            HINT = 'A workspace chooses its region when it is created. Moving one means moving its data across the border the choice exists to draw.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_region_immutable ON organizations;

-- `OF region` so the trigger is not consulted at all by the updates that do not
-- touch the column — a rename pays nothing for this rule.
CREATE TRIGGER organizations_region_immutable
  BEFORE UPDATE OF region ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION organizations_reject_region_change();

-- ---------------------------------------------------------------------------
-- Signup can now say where
-- ---------------------------------------------------------------------------
-- The choice has to be made here or nowhere: after this transaction commits,
-- the trigger above means the row's region is final. So the parameter is not a
-- convenience — it is the only moment the value is writable.
--
-- Dropped and recreated rather than replaced: the signature gains a parameter,
-- and `CREATE OR REPLACE` with a different argument list creates an *overload*
-- instead, leaving the five-argument version live beside the new one. A caller
-- that omitted the region would then resolve to the old function and silently
-- get `eu` — the exact bug this parameter exists to prevent. DROP also drops
-- the grants, so they are restated below.
DROP FUNCTION IF EXISTS auth_signup(CITEXT, TEXT, TEXT, TEXT, INT);

CREATE FUNCTION auth_signup(
  p_email             CITEXT,
  p_name              TEXT,
  p_password_hash     TEXT,
  p_organization_name TEXT,
  p_trial_days        INT,
  p_region            TEXT DEFAULT 'eu'
)
RETURNS TABLE (created_account UUID, created_license BIGINT, created_organization UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org     UUID := gen_random_uuid();
  v_license BIGINT;
  v_account UUID := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM accounts a WHERE a.email = p_email) THEN
    RAISE EXCEPTION 'nexa_account_exists';
  END IF;

  -- No validation of p_region here: `organizations_region_check` is the one
  -- place the legal set is written down, and this insert is inside the same
  -- transaction as everything below it, so a bad value fails the whole signup
  -- rather than half-creating a workspace in a region that does not exist.
  INSERT INTO organizations (id, name, region) VALUES (v_org, p_organization_name, p_region);

  INSERT INTO licenses (organization_id, plan, status, trial_ends_at)
  VALUES (v_org, 'growth', 'trialing', now() + make_interval(days => p_trial_days))
  RETURNING id INTO v_license;

  -- The license default brand — the same row the migration backfill and the seed
  -- lay down, so single-brand behaviour is preserved for a fresh workspace too.
  INSERT INTO brands (id, license_id, name, slug, is_default, updated_at)
  VALUES (gen_random_uuid(), v_license, 'Default', 'default', true, now());

  INSERT INTO accounts (id, email, name, password_hash)
  VALUES (v_account, p_email, p_name, p_password_hash);

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_license, v_account, 'owner', 'accepting_chats');

  -- Public client: OAuth 2.1 uses PKCE rather than a secret for anything
  -- running in a browser, where no secret stays secret.
  INSERT INTO oauth_clients (id, organization_id, display_name, client_type, redirect_uris, scopes)
  VALUES ('nexa-agent-app-' || v_org::TEXT, v_org, 'Nexa Agent App', 'public',
          ARRAY['http://localhost:5173/auth/callback'], ARRAY[]::TEXT[]);

  RETURN QUERY SELECT v_account, v_license, v_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_signup(CITEXT, TEXT, TEXT, TEXT, INT, TEXT) TO nexa_app;
