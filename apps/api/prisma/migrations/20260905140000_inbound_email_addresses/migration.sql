-- Multiple inbound forwarding addresses (FR-MOD-08.5.3).
--
-- Until now a workspace had exactly one address, `<organization_id>@<domain>`,
-- derived on the fly from the local part of whatever a provider addressed. That
-- is one mailbox for every kind of mail a company receives: support, billing and
-- returns all landed in the same undifferentiated queue, and nothing recorded
-- *which* address a ticket came in on.
--
-- The scheme this opens keeps the organization id in front, as a label suffix:
--
--     <organization_id>@<domain>            the default address (label IS NULL)
--     <organization_id>+support@<domain>    a defined address
--
-- Two reasons for the `+` form rather than a free local part (`support@domain`):
-- a real mail provider already delivers `a+b@d` to the mailbox `a`, so a
-- catch-all forward keeps working unchanged; and the organization id in front
-- makes a collision between two workspaces arithmetically impossible rather than
-- merely refused. The refusal exists anyway — `local_part` is UNIQUE across the
-- whole table, so the database, not a parsing rule, is what guarantees that one
-- address resolves to at most one workspace (NFR-S4/S5).
--
-- Expand-only (CONVENTIONS 6.3): nothing existing is narrowed or renamed. The
-- old address keeps resolving through the path it always did, so a deployment
-- running the previous code against this schema behaves exactly as before.

-- CreateTable
CREATE TABLE "inbound_email_addresses" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "label" TEXT,
    "local_part" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_email_addresses_pkey" PRIMARY KEY ("id")
);

-- The platform-wide rule: one address, one workspace. Two tenants cannot hold
-- the same forwarding address even if a future addressing scheme stops putting
-- the organization id in front of the label.
CREATE UNIQUE INDEX "inbound_email_addresses_local_part_key"
    ON "inbound_email_addresses"("local_part");

-- And within a workspace, one row per label.
CREATE UNIQUE INDEX "inbound_email_addresses_license_id_label_key"
    ON "inbound_email_addresses"("license_id", "label");

-- A NULL label is the workspace's default address. NULLs do not collide in a
-- plain unique index, so the "exactly one default" rule needs a partial one.
-- (Prisma can express neither this nor the CHECK below; both are registered in
-- scripts/check-drift.ts.)
CREATE UNIQUE INDEX "inbound_email_addresses_one_default_per_license"
    ON "inbound_email_addresses"("license_id") WHERE "label" IS NULL;

-- The label is part of an e-mail local part, so it is constrained to a
-- conservative slug: lowercase letters, digits and interior hyphens, 1-32 long.
-- Uppercase is excluded rather than folded because the routing lookup compares
-- the local part with plain equality after lower-casing it; a stored uppercase
-- label would be an address that can never be addressed.
ALTER TABLE "inbound_email_addresses"
  ADD CONSTRAINT "inbound_email_addresses_label_check"
  CHECK ("label" IS NULL OR "label" ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$');

-- AddForeignKey
ALTER TABLE "inbound_email_addresses" ADD CONSTRAINT "inbound_email_addresses_license_id_fkey"
    FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security, on the same model as every other tenant-scoped table: one
-- workspace's forwarding addresses are invisible to another (NFR-S5).
ALTER TABLE inbound_email_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbound_email_addresses_tenant ON inbound_email_addresses
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- Which address a ticket arrived at. Nullable, with no backfill: a ticket that
-- predates this column, or one that never came from e-mail at all, has no
-- address to name. `ON DELETE SET NULL` so removing an address does not remove
-- the history of what it received — the ticket outlives the mailbox.
ALTER TABLE "tickets" ADD COLUMN "inbound_address_id" UUID;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_inbound_address_id_fkey"
    FOREIGN KEY ("inbound_address_id") REFERENCES "inbound_email_addresses"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- A provider webhook names a forwarding address as the recipient, but no session
-- exists yet — so the address must resolve to a licence before any tenant
-- context is set. The same kind of small, reviewable pre-tenant hole as
-- auth_resolve_organization_license and channel_resolve_license: SECURITY
-- DEFINER, one question, one row.
CREATE OR REPLACE FUNCTION email_resolve_inbound_address(p_local_part TEXT)
RETURNS TABLE (address_id UUID, license_id BIGINT, organization_id UUID, license_status TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.license_id, l.organization_id, l.status
  FROM inbound_email_addresses a
  JOIN licenses l ON l.id = a.license_id
  WHERE a.local_part = lower(p_local_part);
$$;

-- SECURITY DEFINER runs as the function owner, so EXECUTE is granted narrowly
-- and never to PUBLIC.
REVOKE EXECUTE ON FUNCTION email_resolve_inbound_address(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION email_resolve_inbound_address(TEXT) TO nexa_app;

-- The API connects as nexa_app. Default privileges already cover new tables, but
-- grant explicitly so this migration is correct regardless of who owns it.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_email_addresses TO nexa_app;
