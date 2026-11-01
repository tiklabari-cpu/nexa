/**
 * The workspace's billing profile and the two parties frozen onto an invoice
 * (tm 383 · BL-02).
 *
 * The owner writes the profile, admins read it (`routes/billing-profile.ts`).
 * It matters only at the moment a statement is issued: the period-close sweep
 * copies it into `invoices.buyer_snapshot` beside the issuer's details
 * (`seller_snapshot`), and from then on the statement and its PDF read the
 * snapshot, never the profile. A workspace without a profile is still invoiced
 * — under its workspace name, marked `incomplete`, and the billing screen asks
 * for the details.
 */
import {
  billingProfileProblem,
  isPaymentMethodId,
  normaliseTaxId,
  normaliseVatId,
  PLACEHOLDER_ISSUER,
  type BillingProfile,
  type BillingProfileInput,
  type BillingProfileProblem,
  type InvoiceParty,
  type PaymentMethodId,
} from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { periodWindow } from './invoice-service.js';

/** A profile that breaks a rule; `field` is the body field to point at. */
export class BillingProfileError extends Error {
  constructor(
    readonly field: keyof BillingProfileInput,
    readonly problem: BillingProfileProblem,
  ) {
    super(`${field}: ${PROBLEM_MESSAGES[problem]}`);
    this.name = 'BillingProfileError';
  }
}

const PROBLEM_MESSAGES: Record<BillingProfileProblem, string> = {
  country_invalid: 'must be a two-letter ISO 3166-1 country code',
  tax_id_invalid:
    'is not a valid tax number for this country (Turkey: a 10-digit VKN or an 11-digit TCKN)',
  tax_id_required: 'is required for a company in Turkey',
  vat_id_invalid: 'must be a two-letter country prefix followed by 2–13 letters or digits',
  invoice_email_invalid: 'must be an e-mail address',
};

/** An optional field: trimmed, and an empty one is no value. */
function optional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** What is stored: trimmed text, the country upper case, tax and VAT numbers normalised. */
export interface NormalisedBillingProfile {
  legal_name: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postal_code: string | null;
  country: string;
  tax_office: string | null;
  tax_id: string | null;
  vat_id: string | null;
  invoice_email: string | null;
}

/** Normalise a submitted profile and check it, or throw {@link BillingProfileError}. */
export function normaliseBillingProfile(input: BillingProfileInput): NormalisedBillingProfile {
  const taxId = optional(input.tax_id);
  const vatId = optional(input.vat_id);
  const profile: NormalisedBillingProfile = {
    legal_name: input.legal_name.trim(),
    address_line1: input.address_line1.trim(),
    address_line2: optional(input.address_line2),
    city: input.city.trim(),
    postal_code: optional(input.postal_code),
    country: input.country.trim().toUpperCase(),
    tax_office: optional(input.tax_office),
    tax_id: taxId === null ? null : normaliseTaxId(taxId),
    vat_id: vatId === null ? null : normaliseVatId(vatId),
    invoice_email: optional(input.invoice_email)?.toLowerCase() ?? null,
  };
  const problem = billingProfileProblem(profile);
  if (problem) throw new BillingProfileError(problem.field, problem.problem);
  return profile;
}

interface BillingProfileRow {
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  postalCode: string | null;
  country: string;
  taxOffice: string | null;
  taxId: string | null;
  vatId: string | null;
  invoiceEmail: string | null;
  updatedAt: Date;
}

function serialise(row: BillingProfileRow): BillingProfile {
  return {
    legal_name: row.legalName,
    address_line1: row.addressLine1,
    address_line2: row.addressLine2,
    city: row.city,
    postal_code: row.postalCode,
    country: row.country,
    tax_office: row.taxOffice,
    tax_id: row.taxId,
    vat_id: row.vatId,
    invoice_email: row.invoiceEmail,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function readBillingProfile(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<BillingProfile | null> {
  const row = await tx.billingProfile.findUnique({ where: { licenseId: tenant.licenseId } });
  return row ? serialise(row) : null;
}

/** Create or replace the profile. Whatever was issued before keeps its own copy. */
export async function saveBillingProfile(
  tx: TenantClient,
  tenant: TenantContext,
  profile: NormalisedBillingProfile,
  actorId: string | null,
): Promise<BillingProfile> {
  const data = {
    legalName: profile.legal_name,
    addressLine1: profile.address_line1,
    addressLine2: profile.address_line2,
    city: profile.city,
    postalCode: profile.postal_code,
    country: profile.country,
    taxOffice: profile.tax_office,
    taxId: profile.tax_id,
    vatId: profile.vat_id,
    invoiceEmail: profile.invoice_email,
    updatedBy: actorId,
  };
  const row = await tx.billingProfile.upsert({
    where: { licenseId: tenant.licenseId },
    create: { licenseId: tenant.licenseId, ...data },
    update: data,
  });
  return serialise(row);
}

/**
 * The customer as the statement will carry it: the profile when there is one,
 * otherwise the workspace's name marked `incomplete`.
 */
export async function buyerSnapshot(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<InvoiceParty> {
  const profile = await tx.billingProfile.findUnique({ where: { licenseId: tenant.licenseId } });
  if (profile) {
    const cityLine = [profile.postalCode, profile.city].filter(Boolean).join(' ');
    return {
      legal_name: profile.legalName,
      address_lines: [profile.addressLine1, profile.addressLine2, cityLine].filter(
        (line): line is string => Boolean(line),
      ),
      country: profile.country,
      tax_office: profile.taxOffice,
      tax_id: profile.taxId,
      vat_id: profile.vatId,
      email: profile.invoiceEmail,
    };
  }
  const organization = await tx.organization.findUnique({
    where: { id: tenant.organizationId },
    select: { name: true },
  });
  return {
    legal_name: organization?.name ?? 'Workspace',
    address_lines: [],
    country: null,
    tax_office: null,
    tax_id: null,
    vat_id: null,
    email: null,
    incomplete: true,
  };
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}

/**
 * The issuer's details from the root panel's `billing.issuer_profile`
 * (tm 389.18 writes it), or null when unset or not usable. A legal name is
 * the one thing it must have; everything else prints when present.
 */
export function readIssuerProfile(value: unknown): InvoiceParty | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const legalName = text(raw['legal_name'], 200);
  if (!legalName) return null;
  const lines = Array.isArray(raw['address_lines']) ? raw['address_lines'] : [];
  return {
    legal_name: legalName,
    address_lines: lines
      .map((line) => text(line, 200))
      .filter((line): line is string => line !== null)
      .slice(0, 6),
    country: text(raw['country'], 2)?.toUpperCase() ?? null,
    tax_office: text(raw['tax_office'], 100),
    tax_id: text(raw['tax_id'], 32),
    vat_id: text(raw['vat_id'], 15),
    email: text(raw['email'], 254),
    tax_note: text(raw['tax_note'], 1000),
  };
}

/** The issuer as the statement will carry it — the root panel's profile, or the placeholder. */
export async function sellerSnapshot(tx: TenantClient): Promise<InvoiceParty> {
  const rows = await tx.$queryRaw<Array<{ issuer_profile: unknown }>>`
    SELECT issuer_profile FROM platform_billing_settings()`;
  return readIssuerProfile(rows[0]?.issuer_profile) ?? PLACEHOLDER_ISSUER;
}

/**
 * How a period was paid (K16): the latest succeeded payment started in it or
 * whose term covers it, with the reference a reader can trace — the SWIFT
 * transfer description, the TXID, the Stripe payment id. Null when nothing
 * was paid (a trial, the pilot, an unpaid month).
 */
export async function periodPayment(
  tx: TenantClient,
  tenant: TenantContext,
  period: string,
): Promise<{ method: PaymentMethodId; reference: string | null } | null> {
  const window = periodWindow(period);
  const payment = await tx.paymentTransaction.findFirst({
    where: {
      licenseId: tenant.licenseId,
      status: 'succeeded',
      OR: [{ period }, { termStart: { lt: window.end }, termEnd: { gt: window.start } }],
    },
    orderBy: [{ settledAt: 'desc' }, { createdAt: 'desc' }],
    select: { provider: true, reference: true, providerRef: true },
  });
  if (!payment || !isPaymentMethodId(payment.provider)) return null;
  const reference =
    payment.provider === 'swift_manual'
      ? payment.reference
      : (payment.providerRef ?? payment.reference);
  return { method: payment.provider, reference };
}
