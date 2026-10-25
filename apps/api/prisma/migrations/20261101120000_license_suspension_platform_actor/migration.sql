-- Licence suspension and the platform audit actor (tm 389.2 · docs/platform-admin/design.md §B3).
--
-- Both widen what a row may say; nothing here narrows what an existing row
-- already says, so the code before this migration keeps working against it
-- (CONVENTIONS §6.3 — expand first). The CHECKs are swapped NOT VALID and then
-- validated, so the ACCESS EXCLUSIVE lock the swap takes is held only for the
-- catalogue change and the scan runs under SHARE UPDATE EXCLUSIVE.

-- ---------------------------------------------------------------------------
-- 1. licenses.status += 'suspended'
-- ---------------------------------------------------------------------------
-- A suspended workspace is fully locked (reads included) until the platform
-- lifts it; `read_only` stays the write-only lock it has always been. The
-- three columns say when it was suspended, why (operator's words, shown to
-- nobody in the workspace) and when its data is due to be purged if nobody
-- lifts it. `purge_scheduled_at` may also be set on a canceled licence — the
-- purge job (389.10) reads it either way.
ALTER TABLE licenses
  ADD COLUMN suspended_at TIMESTAMPTZ(6),
  ADD COLUMN suspended_reason TEXT,
  ADD COLUMN purge_scheduled_at TIMESTAMPTZ(6);

ALTER TABLE licenses DROP CONSTRAINT licenses_status_check;
ALTER TABLE licenses ADD CONSTRAINT licenses_status_check
  CHECK (status IN ('trialing', 'active', 'past_due', 'read_only', 'canceled', 'suspended'))
  NOT VALID;
ALTER TABLE licenses VALIDATE CONSTRAINT licenses_status_check;

-- A suspension always says when it began; lifting it clears the stamp. No
-- existing row is suspended, so this cannot refuse anything already stored.
ALTER TABLE licenses ADD CONSTRAINT licenses_suspension_check
  CHECK ((status = 'suspended') = (suspended_at IS NOT NULL)
         AND (suspended_reason IS NULL OR status = 'suspended'))
  NOT VALID;
ALTER TABLE licenses VALIDATE CONSTRAINT licenses_suspension_check;

-- The suspension is the platform's to set and to lift. `licenses` is writable
-- by the tenant role — a workspace edits its own settings there — so a column
-- grant cannot keep it off these, and a status written by the workspace
-- itself (`license-activation.ts` lifting a trial) must not be able to move a
-- licence into or out of `suspended`. A trigger does, the same way
-- `licenses_ai_caps_platform_only` guards the AI caps: the tenant API connects
-- as `siyahtus_app`; the owner (migrations, psql, test fixtures), SECURITY
-- DEFINER functions and `siyahtus_platform` (389.10) run as someone else.
CREATE FUNCTION licenses_reject_tenant_suspension()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'siyahtus_app' THEN
    RAISE EXCEPTION 'a workspace''s suspension is set and lifted by the platform, not by the workspace'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER licenses_suspension_platform_only
  BEFORE UPDATE OF status, suspended_at, suspended_reason, purge_scheduled_at ON licenses
  FOR EACH ROW
  WHEN ((OLD.status IS DISTINCT FROM NEW.status
         AND (OLD.status = 'suspended' OR NEW.status = 'suspended'))
        OR OLD.suspended_at IS DISTINCT FROM NEW.suspended_at
        OR OLD.suspended_reason IS DISTINCT FROM NEW.suspended_reason
        OR OLD.purge_scheduled_at IS DISTINCT FROM NEW.purge_scheduled_at)
  EXECUTE FUNCTION licenses_reject_tenant_suspension();

CREATE TRIGGER licenses_suspension_platform_only_insert
  BEFORE INSERT ON licenses
  FOR EACH ROW
  WHEN (NEW.status = 'suspended' OR NEW.suspended_at IS NOT NULL
        OR NEW.suspended_reason IS NOT NULL OR NEW.purge_scheduled_at IS NOT NULL)
  EXECUTE FUNCTION licenses_reject_tenant_suspension();

-- ---------------------------------------------------------------------------
-- 2. The public resolvers treat a suspension like a cancellation
-- ---------------------------------------------------------------------------
-- The public KB, a shared report link and the hosted Chat page are read
-- before any tenant context exists, through these three SECURITY DEFINER
-- functions; each used to filter `canceled` alone. A suspended workspace is
-- closed the same way — its public pages return no row (the 404 policy,
-- NFR-S5, begins in the function), and the Chat page prefers a live licence.
CREATE OR REPLACE FUNCTION auth_resolve_organization_license(p_organization_id UUID)
RETURNS TABLE (license_id BIGINT, organization_id UUID, license_status TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.organization_id, l.status
  FROM licenses l
  WHERE l.organization_id = p_organization_id
  -- Prefer a live licence; a closed (cancelled or suspended) one sorts last.
  ORDER BY (l.status IN ('canceled', 'suspended')), l.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION kb_resolve_public_slug(p_slug TEXT)
RETURNS TABLE (license_id BIGINT, organization_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.license_id, l.organization_id
  FROM kb_settings s
  JOIN licenses l ON l.id = s.license_id
  WHERE s.public_slug = p_slug
    AND s.enabled = true
    AND l.status NOT IN ('canceled', 'suspended')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION reports_resolve_share_link(p_token_hash TEXT)
RETURNS TABLE (
  share_id UUID,
  license_id BIGINT,
  organization_id UUID,
  group_id TEXT,
  range_from TIMESTAMPTZ,
  range_to TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.license_id, l.organization_id, s.group_id, s.range_from, s.range_to, s.expires_at
  FROM report_share_links s
  JOIN licenses l ON l.id = s.license_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND l.status NOT IN ('canceled', 'suspended')
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. audit_log.actor_type += 'platform', + on_behalf_of
-- ---------------------------------------------------------------------------
-- `platform` is SiyahTuş staff acting from the root panel (389.10 writes the
-- tenant half of its double audit here). `actor_id` is then the operator's
-- `platform_admins.id`; `on_behalf_of` is the member's account id while the
-- operator is signed in as them (impersonation, 389.15) and NULL otherwise.
-- Neither is a foreign key: the trail outlives both rows.
ALTER TABLE audit_log ADD COLUMN on_behalf_of TEXT;

ALTER TABLE audit_log DROP CONSTRAINT audit_log_actor_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('agent', 'bot', 'customer', 'system', 'platform'))
  NOT VALID;
ALTER TABLE audit_log VALIDATE CONSTRAINT audit_log_actor_type_check;

-- Only a platform entry speaks for somebody else.
ALTER TABLE audit_log ADD CONSTRAINT audit_log_on_behalf_of_check
  CHECK (on_behalf_of IS NULL OR actor_type = 'platform')
  NOT VALID;
ALTER TABLE audit_log VALIDATE CONSTRAINT audit_log_on_behalf_of_check;
