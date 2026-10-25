-- Platform overrides of a workspace's plan (tm 389.2 · docs/platform-admin/design.md §B3).
--
-- PLAN §C-A25 said "no override table, on purpose": a second source of "what
-- may this workspace do" next to the plan is how two answers start to
-- disagree. §D218 revises it for the root panel, on one condition that keeps
-- the spirit — the workspace cannot write here. The platform (389.10/389.12,
-- `siyahtus_platform`) writes; the tenant API only reads, and reads it in one
-- place for each limit:
--
--   * `entitlements` — a partial map over the plan's (`lib/entitlements.ts
--     readEntitlements`): a key present here replaces the plan's value, both
--     ways (the platform may grant a capability or take one away).
--   * `seat_ceiling` — replaces `SEAT_CEILING` (the 200-seat rail on
--     unattended growth) for invitations and SCIM.
--   * `mail_daily_cap` — replaces `MAIL_DAILY_PER_WORKSPACE` in
--     `mail_budget_spend` below.
--
-- An override past `expires_at` is ignored, as if the row were not there. The
-- AI caps are not here: `licenses.ai_daily_*_cap` (tm 283.2) is their one
-- source.

CREATE TABLE "license_overrides" (
    "license_id" BIGINT NOT NULL,
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "seat_ceiling" INTEGER,
    "mail_daily_cap" INTEGER,
    "expires_at" TIMESTAMPTZ(6),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_overrides_pkey" PRIMARY KEY ("license_id")
);

ALTER TABLE "license_overrides" ADD CONSTRAINT "license_overrides_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The entitlement keys are the closed vocabulary `ENTITLEMENTS` in
-- @siyahtus/types, each a boolean; a misspelt key would otherwise sit here
-- doing nothing while the operator believes it granted something.
ALTER TABLE "license_overrides" ADD CONSTRAINT "license_overrides_entitlements_check"
  CHECK (jsonb_typeof(entitlements) = 'object'
         AND NOT jsonb_path_exists(entitlements, '$.keyvalue() ? (@.value.type() != "boolean")')
         AND entitlements - ARRAY['white_label', 'sandbox', 'sla', 'sso', 'hipaa', 'siem_export'] = '{}'::jsonb);
ALTER TABLE "license_overrides" ADD CONSTRAINT "license_overrides_limits_check"
  CHECK ((seat_ceiling IS NULL OR seat_ceiling >= 1)
         AND (mail_daily_cap IS NULL OR mail_daily_cap >= 1));

-- Read by the workspace, written by nobody in it. The default privileges
-- (20260722090000) granted siyahtus_app every privilege on a new table; it
-- keeps SELECT only, under a tenant policy. siyahtus_platform got its
-- privileges from the default privileges 20261101090000 set, and is BYPASSRLS.
ALTER TABLE "license_overrides" ENABLE ROW LEVEL SECURITY;
CREATE POLICY license_overrides_tenant_read ON "license_overrides" FOR SELECT
  USING (license_id = siyahtus_current_license());
REVOKE ALL ON "license_overrides" FROM siyahtus_app;
GRANT SELECT ON "license_overrides" TO siyahtus_app;

-- ---------------------------------------------------------------------------
-- mail_budget_spend — the workspace cap reads the override
-- ---------------------------------------------------------------------------
-- Same signature, same body as 20261003150000 except the first line after the
-- argument check: a live override's `mail_daily_cap` replaces the deployment's
-- per-workspace cap (`p_workspace_cap`). SECURITY DEFINER already, so the
-- override is read whatever context the caller is in — the sweeps and jobs
-- that send most workspace mail run outside any tenant transaction.
CREATE OR REPLACE FUNCTION mail_budget_spend(
  p_license_id    BIGINT,
  p_day           TEXT,
  p_external      BOOLEAN,
  p_recipient     TEXT,
  p_workspace_cap INTEGER,
  p_external_cap  INTEGER,
  p_global_cap    INTEGER,
  p_reserve       INTEGER,
  p_recipient_cap INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_global_limit INTEGER;
  v_workspace_cap INTEGER;
BEGIN
  IF p_day IS NULL OR p_day !~ '^[0-9]{8}$' OR p_external IS NULL
     OR p_workspace_cap IS NULL OR p_workspace_cap < 1
     OR p_external_cap IS NULL OR p_external_cap < 1
     OR p_global_cap IS NULL OR p_global_cap < 1
     OR p_reserve IS NULL OR p_reserve < 0 OR p_reserve >= p_global_cap
     OR p_recipient_cap IS NULL OR p_recipient_cap < 1
     OR (p_recipient IS NOT NULL AND p_recipient !~ '^[0-9a-f]{64}$')
     -- A workspace mail has no per-address count, and an account mail never
     -- leaves a workspace: anything else is a caller mixing the two.
     OR (p_license_id IS NOT NULL AND p_recipient IS NOT NULL)
     OR (p_license_id IS NULL AND p_external) THEN
    RAISE EXCEPTION 'mail_budget_spend: invalid argument' USING ERRCODE = '22023';
  END IF;

  v_workspace_cap := COALESCE(
    (SELECT o.mail_daily_cap FROM license_overrides o
      WHERE o.license_id = p_license_id
        AND (o.expires_at IS NULL OR o.expires_at > now())),
    p_workspace_cap);

  IF p_recipient IS NOT NULL THEN
    INSERT INTO mail_daily_usage AS u (id, license_id, day, meter, recipient_hash, sent, updated_at)
    VALUES (gen_random_uuid(), NULL, p_day, 'recipient', p_recipient, 1, now())
    ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE
       SET sent = u.sent + 1, updated_at = now()
     WHERE u.sent + 1 <= p_recipient_cap;
    IF NOT FOUND THEN
      RETURN 'recipient';
    END IF;
  END IF;

  IF p_license_id IS NOT NULL THEN
    INSERT INTO mail_daily_usage AS u (id, license_id, day, meter, recipient_hash, sent, updated_at)
    VALUES (gen_random_uuid(), p_license_id, p_day, 'workspace', NULL, 1, now())
    ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE
       SET sent = u.sent + 1, updated_at = now()
     WHERE u.sent + 1 <= v_workspace_cap;
    IF NOT FOUND THEN
      RETURN 'workspace';
    END IF;

    IF p_external THEN
      INSERT INTO mail_daily_usage AS u (id, license_id, day, meter, recipient_hash, sent, updated_at)
      VALUES (gen_random_uuid(), p_license_id, p_day, 'external', NULL, 1, now())
      ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE
         SET sent = u.sent + 1, updated_at = now()
       WHERE u.sent + 1 <= p_external_cap;
      IF NOT FOUND THEN
        UPDATE mail_daily_usage u SET sent = u.sent - 1, updated_at = now()
         WHERE u.license_id = p_license_id AND u.day = p_day
           AND u.meter = 'workspace' AND u.recipient_hash IS NULL;
        RETURN 'external';
      END IF;
    END IF;

    v_global_limit := p_global_cap - p_reserve;
  ELSE
    v_global_limit := p_global_cap;
  END IF;

  INSERT INTO mail_daily_usage AS u (id, license_id, day, meter, recipient_hash, sent, updated_at)
  VALUES (gen_random_uuid(), NULL, p_day, 'global', NULL, 1, now())
  ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE
     SET sent = u.sent + 1, updated_at = now()
   WHERE u.sent + 1 <= v_global_limit;
  IF NOT FOUND THEN
    IF p_recipient IS NOT NULL THEN
      UPDATE mail_daily_usage u SET sent = u.sent - 1, updated_at = now()
       WHERE u.license_id IS NULL AND u.day = p_day
         AND u.meter = 'recipient' AND u.recipient_hash = p_recipient;
    END IF;
    IF p_license_id IS NOT NULL THEN
      UPDATE mail_daily_usage u SET sent = u.sent - 1, updated_at = now()
       WHERE u.license_id = p_license_id AND u.day = p_day
         AND u.recipient_hash IS NULL
         AND (u.meter = 'workspace' OR (p_external AND u.meter = 'external'));
    END IF;
    RETURN 'global';
  END IF;

  RETURN NULL;
END;
$$;
