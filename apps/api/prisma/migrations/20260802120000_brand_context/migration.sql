-- Brand isolation core — `app.current_brand` context + brand-scoped RLS on
-- channels (MULTIBRAND-b · PRD §5.3 · NFR-S4/S5).
--
-- 78.1 laid down `brands` (license-scoped, one `Default` per license). This adds
-- the *isolation boundary*: a third tenant-context setting, `app.current_brand`,
-- and the RLS that reads it so a query opened in one brand's context cannot see
-- another brand's channel — while a license-wide query (no brand set) still sees
-- them all, keeping single-brand workspaces byte-for-byte unchanged.
--
-- The structural statements on `channels` (the `brand_id` column, the foreign
-- key, the swapped unique index) are what `prisma migrate diff` emits for the
-- schema change; the three-step add→backfill→NOT NULL, the tenant-context
-- function, the policy rewrite and the GRANT are invisible to Prisma and are
-- written here by hand, the same way every other tenant table does.

-- ---------------------------------------------------------------------------
-- Tenant context helper — the brand twin of nexa_current_license()
-- ---------------------------------------------------------------------------
-- Empty string ('') means "no brand selected" → the license-wide view. A
-- malformed value raises on the ::UUID cast rather than silently matching
-- nothing, exactly like the license/organization helpers.
CREATE OR REPLACE FUNCTION nexa_current_brand() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_brand', true), '')::UUID;
$$;

GRANT EXECUTE ON FUNCTION nexa_current_brand() TO nexa_app;

-- ---------------------------------------------------------------------------
-- channels.brand_id — add nullable, backfill to the license default, enforce
-- ---------------------------------------------------------------------------
ALTER TABLE "channels" ADD COLUMN "brand_id" UUID;

-- Every existing channel belongs to its license's default brand. 78.1's backfill
-- guarantees each license has exactly one `is_default` brand, so this resolves to
-- a single row per channel.
UPDATE "channels" c
SET "brand_id" = b."id"
FROM "brands" b
WHERE b."license_id" = c."license_id" AND b."is_default";

ALTER TABLE "channels" ALTER COLUMN "brand_id" SET NOT NULL;

ALTER TABLE "channels"
  ADD CONSTRAINT "channels_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One channel type per brand, not per license: a license may now connect the
-- same channel type once for each of its brands.
DROP INDEX "channels_license_id_type_key";
CREATE UNIQUE INDEX "channels_license_id_brand_id_type_key"
  ON "channels"("license_id", "brand_id", "type");

-- ---------------------------------------------------------------------------
-- Brand-scoped RLS on channels
-- ---------------------------------------------------------------------------
-- NULL brand context = "all brands of the license", so a license-wide query is
-- unchanged. A set brand context narrows both read and write to that brand — a
-- channel from another brand is invisible (SELECT/UPDATE/DELETE see zero rows)
-- and unwritable (WITH CHECK rejects a row for a different brand).
DROP POLICY channels_tenant ON channels;
CREATE POLICY channels_tenant ON channels
  USING (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  )
  WITH CHECK (
    license_id = nexa_current_license()
    AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())
  );

-- ---------------------------------------------------------------------------
-- Signup now lays down the license default brand
-- ---------------------------------------------------------------------------
-- The "every license has exactly one default brand" invariant held for existing
-- data (78.1 backfill) and the seed, but a workspace created through signup was
-- born brandless — and a brandless license cannot connect a channel now that
-- `brand_id` is NOT NULL. auth_signup lays the `Default` brand down in the same
-- transaction as the license, so the invariant holds for every license there is.
-- SECURITY DEFINER, so the insert is not subject to the brands RLS policy.
CREATE OR REPLACE FUNCTION auth_signup(
  p_email             CITEXT,
  p_name              TEXT,
  p_password_hash     TEXT,
  p_organization_name TEXT,
  p_trial_days        INT
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

  INSERT INTO organizations (id, name, region) VALUES (v_org, p_organization_name, 'eu');

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
