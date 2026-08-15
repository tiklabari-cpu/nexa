-- The BAA half of HIPAA cover (NFR-C4 · C4-d).
--
-- PRD NFR-C4 makes HIPAA cover conditional on two things at once: a signed
-- Business Associate Agreement *and* US hosting. C4-a gave the second half a
-- column and made it immutable; this migration gives the first half one, and
-- ties the two together so neither can be true on its own.
--
-- The signature itself is mocked (CLAUDE.md: external services are mocked).
-- There is no contract text and no signature provider — the stored fact is
-- "a BAA was accepted for this licence, at this moment", which is what the
-- HIPAA scope constraints (C4-e) go on to read.

ALTER TABLE licenses
  ADD COLUMN hipaa_baa_signed_at TIMESTAMPTZ;

COMMENT ON COLUMN licenses.hipaa_baa_signed_at IS
  'When the owner accepted the HIPAA Business Associate Agreement (NFR-C4), or NULL if never. Only a licence whose organization lives in ''us'' may hold a value — enforced by licenses_baa_requires_us_region.';

-- ---------------------------------------------------------------------------
-- US hosting, enforced where the column is
-- ---------------------------------------------------------------------------
-- The rule spans two tables — the timestamp is on `licenses`, the region is on
-- `organizations` — so a CHECK constraint cannot express it. The alternatives
-- were the same three §C-A20.3 weighed for region immutability, and they fail
-- here for the same reasons: a service-level `if` binds only the call sites
-- that remember it (the seed, a migration and a psql session all write this
-- table), and a column-level REVOKE binds one role while producing an error
-- about permissions rather than about the rule.
--
-- SECURITY DEFINER because `organizations` has row level security: read as the
-- caller, the lookup would return no row whenever the transaction is not
-- already scoped to that organization, and the trigger would then be deciding
-- a compliance question from the caller's visibility rather than from the
-- fact. It reads one column of one row and raises; nothing is returned to the
-- caller that it did not already have.
--
-- `organization_id` is watched alongside the timestamp: without it, moving a
-- licence that already holds a signed BAA under a European organization would
-- carry the agreement across the border the rule exists to draw.
CREATE OR REPLACE FUNCTION licenses_reject_baa_outside_us()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_region TEXT;
BEGIN
  IF NEW.hipaa_baa_signed_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.region INTO v_region
  FROM organizations o
  WHERE o.id = NEW.organization_id;

  -- Default deny: a licence whose organization cannot be found is not a
  -- licence that may claim HIPAA cover. The foreign key makes this
  -- unreachable today, and that is the point of answering it anyway.
  IF v_region IS DISTINCT FROM 'us' THEN
    RAISE EXCEPTION 'nexa_baa_requires_us_region'
      USING ERRCODE = 'check_violation',
            DETAIL = format('workspace region is %L, not %L', COALESCE(v_region, '<unknown>'), 'us'),
            HINT = 'HIPAA cover is conditional on US hosting (NFR-C4). A workspace hosted elsewhere has no cover to sign into.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS licenses_baa_requires_us_region ON licenses;
DROP TRIGGER IF EXISTS licenses_baa_requires_us_region_update ON licenses;

-- INSERT as well as UPDATE: a licence created with the column already set
-- would otherwise walk straight past a rule that only guards later writes.
-- `OF` cannot be used on an INSERT trigger, so the two are separate.
CREATE TRIGGER licenses_baa_requires_us_region
  BEFORE INSERT ON licenses
  FOR EACH ROW
  EXECUTE FUNCTION licenses_reject_baa_outside_us();

CREATE TRIGGER licenses_baa_requires_us_region_update
  BEFORE UPDATE OF hipaa_baa_signed_at, organization_id ON licenses
  FOR EACH ROW
  EXECUTE FUNCTION licenses_reject_baa_outside_us();
