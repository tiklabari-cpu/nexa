-- Per-workspace retention windows (NFR-C8).
--
-- Until now the four retention windows lived only in `apps/api/src/config/env.ts`
-- (`RETENTION_THREAD_DAYS` and friends), which made them a property of the
-- *deployment*: every workspace on one installation aged its conversations out
-- on the same schedule, and none of them could choose. PRD §7 NFR-C8 asks for
-- the opposite — "yapılandırılabilir (30/60/365/sınırsız)" — so the choice has
-- to live somewhere per tenant.
--
-- ## Why on `licenses` and not on `security_settings`
--
-- `services/retention/policy.ts` predicted "a column on `security_settings`",
-- and that was the wrong guess. `security_settings` is keyed
-- `(license_id, brand_id)`: it is *brand*-scoped. The data these windows govern
-- is not. `threads` hang off `chats`, which are keyed by `license_id` alone;
-- `visits` likewise. A workspace running three brands would therefore hold
-- three candidate windows for one undivided pile of conversations, and the
-- sweep would have to invent a rule for picking between them (the shortest?
-- the default brand's?) — a rule no requirement asks for and nobody could
-- predict from the screen. The unit the sweep already iterates is the licence
-- (`retention_list_tenants()` returns exactly `license_id, organization_id`),
-- and the HIPAA ceiling it interacts with is read from `licenses` too
-- (`hipaa_baa_signed_at`, C4-d). One row, one window, one place to look.
--
-- ## Why a tier string and not an integer number of days
--
-- Because "unlimited" is one of the four values, and the natural integer
-- encoding for it is `0` — which is precisely the value `cutoffFor` refuses,
-- because a zero window puts the cutoff at "now" and therefore matches every
-- row. Encoding "never delete anything" as the one number that means "delete
-- everything" is a defect waiting for a careless read. The column stores the
-- tier as itself (`@nexa/types#RETENTION_TIERS`), so the off state is not a
-- number at all and no arithmetic can reach it.
--
-- NULL means "no choice made — inherit the deployment default", which is a
-- different fact from `'unlimited'` ("we decided never to delete") and stays a
-- different value. That is also what makes this migration safe to deploy on its
-- own: every existing row reads as "inherit", so the sweep behaves exactly as
-- it did before this ran.
--
-- ## CONVENTIONS §6.3 — expand only
--
-- Two nullable columns with no default and no backfill; nothing is dropped,
-- renamed or narrowed. The CHECK constraints are safe to add in the same
-- release for the reason §6.3's rule turns on: the previous release cannot
-- violate them, because its Prisma client does not know these columns exist
-- and has no statement that writes them. They are added now rather than later
-- so the vocabulary is enforced by the database from the first row — a route
-- is not the only way in, and a row carrying `'90d'` would be read by the
-- sweep as an unknown tier.

ALTER TABLE licenses
  ADD COLUMN retention_thread_window TEXT,
  ADD COLUMN retention_visit_window  TEXT;

ALTER TABLE licenses
  ADD CONSTRAINT licenses_retention_thread_window_check
  CHECK (
    retention_thread_window IS NULL
    OR retention_thread_window IN ('30d', '60d', '365d', 'unlimited')
  );

ALTER TABLE licenses
  ADD CONSTRAINT licenses_retention_visit_window_check
  CHECK (
    retention_visit_window IS NULL
    OR retention_visit_window IN ('30d', '60d', '365d', 'unlimited')
  );

COMMENT ON COLUMN licenses.retention_thread_window IS
  'NFR-C8: this workspace''s window for closed conversations, or NULL to inherit RETENTION_THREAD_DAYS. Capped by HIPAA_RETENTION_CEILING when a BAA is signed.';
COMMENT ON COLUMN licenses.retention_visit_window IS
  'NFR-C8: this workspace''s window for visitor telemetry, or NULL to inherit RETENTION_VISIT_DAYS.';
