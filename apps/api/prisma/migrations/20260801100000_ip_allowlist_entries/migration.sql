-- IP allowlist entries (FR-MOD-08.9.6): the IP addresses and CIDR ranges a
-- license permits to reach the agent/admin panel. This is the allow-side
-- counterpart to `security_settings.banned_customer_ips` — a deny-list on the
-- customer/widget surface (FR-MOD-08.9.2) — so here a workspace lists the
-- sources it trusts for its own staff instead of the ones it refuses.
--
-- An entry is a single IPv4/IPv6 address or a CIDR range, kept in canonical
-- form, and is unique per (license, entry). CIDR/IP matching (08.9.6-c) and the
-- enforcement gate (08.9.6-e) live elsewhere — this migration only creates the
-- storage and closes it to its tenant.
--
-- The structural statements below are exactly what `prisma migrate diff` emits
-- for the schema change. The RLS policy and the GRANT are invisible to Prisma
-- and are added here by hand, the same way every other tenant table does.

-- CreateTable
CREATE TABLE "ip_allowlist_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "entry" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ip_allowlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ip_allowlist_entries_license_id_idx" ON "ip_allowlist_entries"("license_id");

-- CreateIndex
CREATE UNIQUE INDEX "ip_allowlist_entries_license_id_entry_key" ON "ip_allowlist_entries"("license_id", "entry");

-- AddForeignKey
ALTER TABLE "ip_allowlist_entries" ADD CONSTRAINT "ip_allowlist_entries_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- License-scoped like trusted_domains and the custom-field tables: an entry is
-- visible and writable only within its own license.
ALTER TABLE ip_allowlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ip_allowlist_entries_tenant ON ip_allowlist_entries
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The application role reaches the table only through that policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON ip_allowlist_entries TO nexa_app;
