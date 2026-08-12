-- Certificate rotation overlap for SSO connections (NFR-S11 · S11-a2).
--
-- S11-a left the table with a single trust anchor per connection. The write
-- surface this migration serves has to answer a question that storage alone
-- could not: when an admin writes a new IdP certificate, does the old one stop
-- being trusted immediately, or do both work for a while?
--
-- THE DECISION (also recorded in PLAN §C): replacement revokes the old
-- certificate at commit, UNLESS the rotation explicitly asks to keep it for a
-- bounded window. Immediate is the default because the rotation that matters
-- most is the one answering a compromised IdP key — and an overlap there keeps
-- the attacker's certificate valid for exactly as long as it is convenient. The
-- opt-in window exists because the *ordinary* rotation is a planned key roll
-- where the IdP signs with either key for a period, and refusing to bridge that
-- would make every planned rotation a sign-in outage. So both rotations are
-- served, and the dangerous one is never inherited by default.
--
-- The window is bounded (7 days at the endpoint) and interpreted in exactly one
-- place, `lib/sso-connection.ts#activePreviousCertificate`. A lapsed overlap
-- reads as no overlap everywhere above that function, so the row keeping its
-- bytes until the next write can never mean a lapsed certificate verifies
-- something. S11-b/S11-d consume the pair through that helper.

-- AlterTable
ALTER TABLE "sso_connections" ADD COLUMN     "previous_certificate_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "previous_certificate_pem" TEXT;

-- An overlap is a certificate *and* a deadline; either alone is meaningless. A
-- PEM with no expiry would be a second trust anchor with no end — precisely the
-- unbounded overlap this design refuses — and an expiry with no PEM is a window
-- onto nothing. Enforced here so no path (a later endpoint, a console session)
-- can leave half of one behind.
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_previous_certificate_check"
  CHECK (num_nonnulls("previous_certificate_pem", "previous_certificate_expires_at") <> 1);

-- Same shape rule the current certificate carries: whatever is trusted has to at
-- least be a PEM certificate block.
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_previous_certificate_pem_check"
  CHECK ("previous_certificate_pem" IS NULL OR "previous_certificate_pem" LIKE '%-----BEGIN CERTIFICATE-----%');

-- No RLS change: the policy created in 20260812090000 is on the table, so the
-- new columns are behind it already. No GRANT either — the ALTER DEFAULT
-- PRIVILEGES in 20260722090000 covers the table, and column privileges follow.
