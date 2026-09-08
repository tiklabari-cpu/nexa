-- Company size (FR-MOD-00.4 · FR-MOD-08.3 · tm 216).
--
-- The onboarding wizard's "şirket büyüklüğü" step needed a place to write —
-- `organizations` already carries the rest of PRD §8.4's company-details
-- triple (sector/address/timezone, migration
-- `20260904100324_organization_company_details`), so head count lands here
-- too rather than opening a second table for the same workspace's facts.
-- Expand-only: nullable, no backfill, every existing row reads `NULL` (not
-- set) exactly like `sector` did the day it was added.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "company_size" TEXT;

-- A closed list, not free text — the same reasoning `organizations_sector_check`
-- already applies to its own column. The value set is `COMPANY_SIZES`
-- (`@nexa/types`); this CHECK is Prisma's schema comment made enforceable.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_company_size_check" CHECK (
    company_size IS NULL OR company_size IN (
      '1_10',
      '11_50',
      '51_200',
      '201_1000',
      '1000_plus'
    )
  );
