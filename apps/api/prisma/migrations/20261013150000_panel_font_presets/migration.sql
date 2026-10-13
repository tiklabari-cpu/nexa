-- Panel font presets (owner, 2026-10-13): five fonts the panel can be shown in,
-- in two layers over the built-in Inter.
--
--   * workspace_appearance_settings — one row per license: the workspace's
--     default preset, which only the owner sets, and when it was set.
--   * agent_memberships.font_preset / font_preset_set_at — each member's own
--     choice in that workspace, and when it was made.
--
-- Whichever of the two was set later applies (`resolvePanelFontPreset`,
-- apps/api); NULL in both is the built-in look. The keys are
-- `@siyahtus/types` · `PANEL_FONT_PRESETS`; keep the CHECKs below in step.
--
-- License-scoped, not brand-scoped, like `sales_tracker_settings`: the panel
-- is the team's tool, and its look does not change with the brand a member
-- happens to be working under.
--
-- The structural statements are what `prisma migrate diff` emits for the
-- schema change; the CHECKs and the RLS policy are added by hand, as on every
-- other tenant table.

-- AlterTable
ALTER TABLE "agent_memberships" ADD COLUMN     "font_preset" TEXT,
ADD COLUMN     "font_preset_set_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "workspace_appearance_settings" (
    "license_id" BIGINT NOT NULL,
    "font_preset" TEXT,
    "font_preset_set_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_appearance_settings_pkey" PRIMARY KEY ("license_id")
);

-- AddForeignKey
ALTER TABLE "workspace_appearance_settings" ADD CONSTRAINT "workspace_appearance_settings_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A key the stylesheet has no design for would paint the built-in fallback
-- while the settings screen named something else.
ALTER TABLE "workspace_appearance_settings" ADD CONSTRAINT "workspace_appearance_settings_font_preset_check"
  CHECK ("font_preset" IS NULL OR "font_preset" IN ('inter', 'plus-jakarta', 'manrope-dm-sans', 'nunito', 'figtree'));
ALTER TABLE "agent_memberships" ADD CONSTRAINT "agent_memberships_font_preset_check"
  CHECK ("font_preset" IS NULL OR "font_preset" IN ('inter', 'plus-jakarta', 'manrope-dm-sans', 'nunito', 'figtree'));

-- A choice and its time travel together: "latest wins" cannot order a preset
-- with no time, and a time with no preset orders nothing.
ALTER TABLE "workspace_appearance_settings" ADD CONSTRAINT "workspace_appearance_settings_font_preset_set_at_check"
  CHECK (("font_preset" IS NULL) = ("font_preset_set_at" IS NULL));
ALTER TABLE "agent_memberships" ADD CONSTRAINT "agent_memberships_font_preset_set_at_check"
  CHECK (("font_preset" IS NULL) = ("font_preset_set_at" IS NULL));

-- License-scoped like every other tenant table.
ALTER TABLE workspace_appearance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_appearance_settings_tenant ON workspace_appearance_settings
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- No GRANT statement: the ALTER DEFAULT PRIVILEGES in 20260722090000 already
-- hands siyahtus_app SELECT, INSERT, UPDATE, DELETE on every table created
-- after it.
