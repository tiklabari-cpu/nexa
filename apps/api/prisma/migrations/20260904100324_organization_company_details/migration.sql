-- Company details (FR-MOD-08.3 · M-CO-a · denetim YOK listesi · tm 182.1).
--
-- Settings → Company details had no columns to back it: `Organization` held
-- only `name` and `region`. PRD §8.4 calls the sector/address/timezone triple
-- "fatura/marka/rapor temeli" (billing/brand/report basis), so all three land
-- here rather than on `licenses` — one workspace, one set of company facts,
-- shared by every license it holds.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "address" TEXT,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- `sector` is a closed list, not free text — reportable rather than merely
-- descriptive, the same reasoning `organizations_region_check` and
-- `licenses_billing_cycle_check` already apply to their own columns. The
-- value set is `COMPANY_SECTORS` (`@nexa/types`); this CHECK is Prisma's
-- schema comment made enforceable, not a second copy of the list to keep in
-- sync by hand — a value the API's zod schema would refuse can never reach
-- this table by any other writer either.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_sector_check" CHECK (
    sector IS NULL OR sector IN (
      'ecommerce_retail',
      'saas_technology',
      'financial_services',
      'healthcare',
      'travel_hospitality',
      'education',
      'real_estate',
      'telecommunications',
      'media_entertainment',
      'gaming_gambling',
      'nonprofit_government',
      'professional_services',
      'manufacturing_logistics',
      'other'
    )
  );
