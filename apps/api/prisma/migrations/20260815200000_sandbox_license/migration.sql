-- The sandbox licence (FR-MOD-11.5 · §5.4 "Kurumsal" · 11.5-f).
--
-- A sandbox is not a flag on a workspace. It is a **second tenant**: somewhere
-- an Enterprise customer can point an integration, replay a migration, or let a
-- new hire break things, without any of it reaching the workspace their
-- customers are actually talking to. That framing decides everything below.
--
-- The single design decision, and why it went the way it did
-- ---------------------------------------------------------------------------
-- A sandbox could have been a second `licenses` row inside the *same*
-- organization — one column, no new organization, and the person's existing
-- OAuth client would have kept working untouched. It is refused because of what
-- `nexa_current_organization()` already guards: `customers` carries no
-- `license_id` at all and is scoped to the organization by design ("one person
-- may be known across the licenses of one organization"). A sandbox sharing the
-- organization would therefore have read the production **customer directory**
-- — every name, e-mail and phone number the workspace holds — from the one
-- environment whose whole purpose is that it is safe to be careless in.
--
-- So a sandbox gets its own organization, and this column is the only thread
-- back. `organizations.region` is inherited from the parent, which is also why
-- the sandbox needs a row there at all: residency is a property of the
-- organization, and a sandbox that could land in another region would move
-- customer-shaped data across the border C4 exists to draw.
--
-- What the thread is *for* is the other half. Three questions have to be
-- answerable in one indexed lookup, and all three are commercial:
--
--   * the meter — a sandbox's AI resolutions and API calls never reach
--     `usage_records` (`services/billing/metering.ts`);
--   * the invoice — a sandbox has no subscription, no card and no packages
--     (`plugins/sandbox-gate.ts`);
--   * the seat count — a sandbox's members are members of a *different*
--     licence, so the count that prices the bill never sees them, which is RLS
--     doing the work rather than a rule anybody has to remember.
--
-- Cascade, not SET NULL: a sandbox must not outlive the licence that pays for
-- it. `ON DELETE CASCADE` also makes the reset below possible at all.
--
-- The structural statements are exactly what `prisma migrate diff` emits for the
-- schema change (minus the unrelated pgvector index it always reports — see
-- check-drift.ts). The CHECK constraints, the trigger, the RLS policy and the
-- functions are invisible to Prisma and are added here by hand.

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN     "sandbox_of_license_id" BIGINT,
ADD COLUMN     "sandbox_reset_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "licenses_sandbox_of_license_id_key" ON "licenses"("sandbox_of_license_id");

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_sandbox_of_license_id_fkey" FOREIGN KEY ("sandbox_of_license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON COLUMN licenses.sandbox_of_license_id IS
  'The production licence this one is a sandbox of (FR-MOD-11.5), or null on a real workspace. Unique: at most one sandbox per licence. Nesting is refused by licenses_sandbox_not_nested.';
COMMENT ON COLUMN licenses.sandbox_reset_at IS
  'When this sandbox was last wiped. Only a sandbox may carry a value.';

-- ---------------------------------------------------------------------------
-- What the column may say
-- ---------------------------------------------------------------------------
-- A licence that is its own sandbox would satisfy every query below while
-- meaning nothing, and would make the meter exclude the workspace it is
-- supposed to bill. The unique index above already limits it to one such row;
-- this makes it zero.
ALTER TABLE licenses
  ADD CONSTRAINT licenses_sandbox_not_self_check
    CHECK (sandbox_of_license_id IS NULL OR sandbox_of_license_id <> id);

-- A reset timestamp on a production licence would read, to the settings screen
-- and to anyone querying later, as "this workspace was wiped on this date".
-- Nothing writes it but `sandbox_reset` below; the constraint is what makes that
-- true for every future writer as well.
ALTER TABLE licenses
  ADD CONSTRAINT licenses_sandbox_reset_requires_sandbox_check
    CHECK (sandbox_reset_at IS NULL OR sandbox_of_license_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- No sandboxes of sandboxes
-- ---------------------------------------------------------------------------
-- A CHECK cannot see another row, so the depth rule needs a trigger. Without
-- it the chain "who pays for this?" has no terminating answer: the meter asks
-- one hop ("is this a sandbox?") and would keep excluding a grandchild whose
-- parent is itself excluded, which is a free workspace factory rather than a
-- test environment.
--
-- The API refuses it twice over already — creation needs the `sandbox`
-- entitlement, which a sandbox never has (it holds no subscription, so it reads
-- as the self-serve tier), and the route checks explicitly. This is the layer
-- that binds a migration, the seed and a psql session too.
CREATE OR REPLACE FUNCTION licenses_reject_nested_sandbox()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.sandbox_of_license_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM licenses l
                  WHERE l.id = NEW.sandbox_of_license_id
                    AND l.sandbox_of_license_id IS NOT NULL) THEN
    RAISE EXCEPTION 'nexa_sandbox_nested'
      USING ERRCODE = 'check_violation',
            DETAIL = format('licence %s is itself a sandbox', NEW.sandbox_of_license_id),
            HINT = 'A sandbox belongs to a production workspace. Chaining them leaves nobody paying for the last one.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS licenses_sandbox_not_nested ON licenses;

-- `OF sandbox_of_license_id` so the rule costs nothing on the updates that do
-- not touch the column — the same shape `organizations_region_immutable` uses.
CREATE TRIGGER licenses_sandbox_not_nested
  BEFORE INSERT OR UPDATE OF sandbox_of_license_id ON licenses
  FOR EACH ROW
  EXECUTE FUNCTION licenses_reject_nested_sandbox();

-- ---------------------------------------------------------------------------
-- One licence row the parent may see, and nothing in the other direction
-- ---------------------------------------------------------------------------
-- `licenses_tenant` has always been an organization match, and the sandbox now
-- lives in a different organization — so without this the owner who *created* a
-- sandbox could not read back that it exists. The policy gains exactly one row:
-- the licence whose `sandbox_of_license_id` is the caller's own licence.
--
-- The asymmetry is the point, and it is structural rather than remembered. From
-- the sandbox's context `nexa_current_license()` is the sandbox's own id, and
-- nothing points at it (nesting is refused above), so the added clause matches
-- nothing at all: **a sandbox credential cannot see the production licence
-- row.** The widening is one-directional by construction.
--
-- `WITH CHECK` is deliberately left as it was. Reading the child row is what the
-- parent needs; writing it is not, and a policy that let one organization
-- UPDATE a row belonging to another is a different and much larger claim.
-- `sandbox_reset` runs SECURITY DEFINER precisely so it does not need one.
DROP POLICY IF EXISTS licenses_tenant ON licenses;
CREATE POLICY licenses_tenant ON licenses
  USING (organization_id = nexa_current_organization()
         OR sandbox_of_license_id = nexa_current_license())
  WITH CHECK (organization_id = nexa_current_organization());

-- ---------------------------------------------------------------------------
-- Creating one
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason `auth_signup` is: this builds a
-- workspace in an organization that does not exist yet, so there is no tenant
-- context under which the inserts could be made. Everything caller-supplied is
-- checked here rather than trusted from the route — the route's checks are the
-- ones that produce good error messages, these are the ones that hold.
--
-- The shape mirrors `auth_signup` exactly: organization, licence, default
-- brand, owner membership, OAuth client. A sandbox missing any of them would be
-- a workspace nobody can sign in to, or one whose first brand-scoped write
-- fails with "this workspace has no default brand".
CREATE FUNCTION sandbox_create(p_parent_license BIGINT, p_owner_account UUID)
RETURNS TABLE (created_license BIGINT, created_organization UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_parent    licenses;
  v_org_name  TEXT;
  v_region    TEXT;
  v_org       UUID := gen_random_uuid();
  v_license   BIGINT;
  v_redirects TEXT[];
  v_scopes    TEXT[];
BEGIN
  -- Locked, so two owners clicking at once serialise here rather than racing to
  -- the unique index and producing one success and one unexplained 500.
  SELECT l.* INTO v_parent FROM licenses l WHERE l.id = p_parent_license FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nexa_sandbox_parent_missing' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_parent.sandbox_of_license_id IS NOT NULL THEN
    RAISE EXCEPTION 'nexa_sandbox_nested' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM licenses l WHERE l.sandbox_of_license_id = p_parent_license) THEN
    RAISE EXCEPTION 'nexa_sandbox_exists' USING ERRCODE = 'unique_violation';
  END IF;

  -- The new workspace's owner has to be someone who already works for the old
  -- one. Checked here as well as at the route because this function runs as the
  -- table owner: an account id arriving from anywhere else would otherwise mint
  -- a workspace for a stranger.
  IF NOT EXISTS (SELECT 1 FROM agent_memberships m
                  WHERE m.license_id = p_parent_license
                    AND m.agent_id = p_owner_account
                    AND NOT m.suspended) THEN
    RAISE EXCEPTION 'nexa_sandbox_owner_not_member' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT o.name, o.region INTO v_org_name, v_region
    FROM organizations o WHERE o.id = v_parent.organization_id;

  -- Region is inherited, never chosen. A sandbox holds data shaped exactly like
  -- production's, so letting it land elsewhere would be a residency decision
  -- taken by a test environment — and `organizations_region_immutable` means
  -- this INSERT is the only moment the value is writable at all (C4-a).
  INSERT INTO organizations (id, name, region)
  VALUES (v_org, left(v_org_name || ' (Sandbox)', 255), v_region);

  -- `status = 'active'` with no trial end: a sandbox is not sold, so there is
  -- nothing for it to expire out of, and a read-only sandbox would be a
  -- confusing way to say "your parent workspace is fine". What ends it is the
  -- parent licence being deleted, which cascades through the column above.
  INSERT INTO licenses (organization_id, plan, status, trial_ends_at, sandbox_of_license_id)
  VALUES (v_org, 'growth', 'active', NULL, p_parent_license)
  RETURNING id INTO v_license;

  INSERT INTO brands (id, license_id, name, slug, is_default, updated_at)
  VALUES (gen_random_uuid(), v_license, 'Default', 'default', true, now());

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_license, p_owner_account, 'owner', 'accepting_chats');

  -- The console reaches a workspace through its organization's OAuth client
  -- (`auth_list_memberships` hands the client id back with the membership), so
  -- a sandbox with no client is a sandbox nobody can open. The parent's
  -- registered redirects are copied rather than hard-coded: whatever URL this
  -- deployment's console actually runs on is already correct there, and
  -- inventing `localhost` here would work in development and nowhere else.
  SELECT c.redirect_uris, c.scopes INTO v_redirects, v_scopes
    FROM oauth_clients c
   WHERE c.organization_id = v_parent.organization_id
   ORDER BY c.created_at
   LIMIT 1;

  INSERT INTO oauth_clients (id, organization_id, display_name, client_type, redirect_uris, scopes)
  VALUES ('nexa-sandbox-app-' || v_org::TEXT, v_org, 'Nexa Agent App (Sandbox)', 'public',
          COALESCE(v_redirects, ARRAY['http://localhost:5173/auth/callback']),
          COALESCE(v_scopes, ARRAY[]::TEXT[]));

  RETURN QUERY SELECT v_license, v_org;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION sandbox_create(BIGINT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox_create(BIGINT, UUID) TO nexa_app;

-- ---------------------------------------------------------------------------
-- Emptying one
-- ---------------------------------------------------------------------------
-- Reset deletes the licence row and puts it back, with the same id, the same
-- organization and the same members. That is a strange-looking way to write
-- "delete the data", and it is the whole reason it is correct: Postgres already
-- knows the dependency graph. Fifty-four tables carry a licence foreign key,
-- every one of them `ON DELETE CASCADE`, and `events` reaches the same fate
-- through its thread. A hand-written list of DELETEs would be complete on the
-- day it was written and quietly incomplete on the day the next slice adds a
-- table — and what it would leave behind is production-shaped data in the
-- environment people are careless in. `helpers/fixtures.ts` refuses a
-- hard-coded table list for exactly this reason; this is the same refusal,
-- using the cascade instead of the catalogue.
--
-- `customers` is the one table the cascade cannot reach: it is scoped to the
-- organization and carries no licence column, which is precisely the fact that
-- made a sandbox need its own organization in the first place. It is deleted by
-- organization, after the licence, when its chats and tickets are already gone.
--
-- What this costs: every credential inside the sandbox dies with the licence
-- row (`api_tokens`, `oauth_refresh_tokens` cascade), so whoever resets it is
-- signed out of it. That is the honest outcome — a session holding ids that no
-- longer exist is worse — and it is why the route says so in its response.
--
-- The reset is not written to any audit trail. The sandbox's own trail is
-- inside what gets deleted, and writing into the *parent's* would be the single
-- cross-licence write this whole slice exists to make impossible. The evidence
-- lives on the row instead: `sandbox_reset_at`, which the parent can read
-- through the policy above and nothing else can set.
CREATE FUNCTION sandbox_reset(p_license BIGINT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_license licenses;
  v_members agent_memberships[];
  v_now     TIMESTAMPTZ := now();
BEGIN
  SELECT l.* INTO v_license FROM licenses l WHERE l.id = p_license FOR UPDATE;
  IF NOT FOUND OR v_license.sandbox_of_license_id IS NULL THEN
    -- One answer for "no such licence" and "that is a production workspace".
    -- The route turns it into a refusal; the caller is standing in the licence
    -- either way, so nothing is concealed from them they could not already read.
    RAISE EXCEPTION 'nexa_not_a_sandbox' USING ERRCODE = 'check_violation';
  END IF;

  -- Snapshotted as whole rows rather than named columns, so a column added to
  -- `agent_memberships` later survives a reset without anybody remembering to
  -- come back here.
  SELECT array_agg(m) INTO v_members FROM agent_memberships m WHERE m.license_id = p_license;

  DELETE FROM licenses WHERE id = p_license;
  DELETE FROM customers WHERE organization_id = v_license.organization_id;

  -- Same row, cleared of the things a fresh workspace has not done yet: the
  -- first-run wizard runs again, the demo seed may be laid again, and the reset
  -- is stamped. Everything else — created_at, plan, the link to the parent — is
  -- carried over, because the sandbox is the same sandbox.
  v_license.onboarding_completed_at := NULL;
  v_license.demo_seeded_at          := NULL;
  v_license.sandbox_reset_at        := v_now;
  INSERT INTO licenses SELECT (v_license).*;

  INSERT INTO brands (id, license_id, name, slug, is_default, updated_at)
  VALUES (gen_random_uuid(), p_license, 'Default', 'default', true, now());

  IF v_members IS NOT NULL THEN
    INSERT INTO agent_memberships SELECT * FROM unnest(v_members);
  END IF;

  RETURN v_now;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION sandbox_reset(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sandbox_reset(BIGINT) TO nexa_app;
