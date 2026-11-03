-- Custom panels: an operator's own page in the Inbox right panel (KN-05 ·
-- owner decision K29 · tm 379).
--
-- A new table only: nothing existing is read differently, so old and new code
-- both run against it (CONVENTIONS §6.3).
--
-- The panel CSP is a broad `frame-src https:` (apps/web/nginx.conf, K29), so
-- the address list below is the gate that decides what an agent's console
-- frames: only what an admin saved, only `https://`.

-- CreateTable
CREATE TABLE "custom_panels" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "visible_group_ids" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "signing_secret_ciphertext" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_panels_pkey" PRIMARY KEY ("id")
);

-- The settings list and the per-conversation read are both "this licence's
-- panels, oldest first".
--
-- CreateIndex
CREATE INDEX "custom_panels_license_id_created_at_idx" ON "custom_panels"("license_id", "created_at");

-- AddForeignKey
ALTER TABLE "custom_panels" ADD CONSTRAINT "custom_panels_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The address the console frames: `https://`, a host with no `user:pass@`, and
-- no fragment (the console writes its own channel nonce there). The API
-- applies the same rule (`customPanelUrlProblem`, @siyahtus/types); this is
-- the floor a raw write cannot go under.
ALTER TABLE "custom_panels" ADD CONSTRAINT "custom_panels_url_check"
  CHECK ("url" ~ '^https://[^/?#@[:space:]]+([/?][^#[:space:]]*)?$');

ALTER TABLE "custom_panels" ADD CONSTRAINT "custom_panels_name_check"
  CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 60);

-- Prisma models a list as a nullable column; the table never holds a NULL list
-- nor a NULL element, and at most 50 teams.
ALTER TABLE "custom_panels" ADD CONSTRAINT "custom_panels_visible_group_ids_check"
  CHECK (
    "visible_group_ids" IS NOT NULL
    AND cardinality("visible_group_ids") <= 50
    AND array_position("visible_group_ids", NULL) IS NULL
  );

-- License-scoped like every other tenant table.
ALTER TABLE custom_panels ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_panels_tenant ON custom_panels
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- No GRANT statement: the ALTER DEFAULT PRIVILEGES in 20260722090000 already
-- hands siyahtus_app SELECT, INSERT, UPDATE, DELETE on every table created
-- after it, and all four are the settings screen's (a panel is removed, not
-- archived — its changes are in the audit trail).
