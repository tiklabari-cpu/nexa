/**
 * The workspace's billing profile and the parties on an invoice (tm 383 ·
 * BL-02 · K24).
 *
 * The profile is who the workspace is on paper — legal name, address, country,
 * tax office, tax number, VAT number, the address invoices go to. It is copied
 * onto each invoice when that invoice is issued (`buyer_snapshot`), next to the
 * issuer's own details (`seller_snapshot`), so editing the profile later never
 * changes a document already issued.
 *
 * The rules live here so the API's check, the database's CHECK and the web
 * form say the same thing. Plain constants and pure functions — no top-level
 * call — so importing this from the web bundle costs nothing beyond the code.
 */

/** Field lengths, the same in the API schema, the CHECKs and the form. */
export const BILLING_PROFILE_LIMITS = {
  legalName: 200,
  addressLine: 200,
  city: 100,
  postalCode: 20,
  taxOffice: 100,
  taxId: 32,
  vatId: 15,
  invoiceEmail: 254,
} as const;

export interface BillingProfileInput {
  legal_name: string;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  postal_code?: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  tax_office?: string | null;
  tax_id?: string | null;
  vat_id?: string | null;
  invoice_email?: string | null;
}

export interface BillingProfile {
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
  updated_at: string;
}

/** Why a profile was refused — one code per rule, so a form can point at its field. */
export type BillingProfileProblem =
  | 'country_invalid'
  | 'tax_id_invalid'
  | 'tax_id_required'
  | 'vat_id_invalid'
  | 'invoice_email_invalid';

/** ISO 3166-1 alpha-2 shape. Which codes exist is the browser's list; the shape is ours. */
export function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

/** Spaces, dots and dashes are how people type a tax number, not part of it. */
export function normaliseTaxId(value: string): string {
  return value.replace(/[\s.-]/g, '').toUpperCase();
}

/** A VAT number is compared without its spaces, upper case (`DE 123 456 789` → `DE123456789`). */
export function normaliseVatId(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}

/**
 * A Turkish citizen number (TCKN, 11 digits) passes its two check digits.
 * A company tax number (VKN, 10 digits) is checked for shape only: its check
 * digit has variants we cannot verify without the tax office, and refusing a
 * real number is worse than accepting a mistyped one the owner sees on the PDF.
 */
function isValidTckn(digits: string): boolean {
  if (!/^[1-9]\d{10}$/.test(digits)) return false;
  const d = digits.split('').map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  const first10 = d.slice(0, 10).reduce((sum, n) => sum + n, 0);
  return first10 % 10 === d[10];
}

/**
 * Whether `taxId` (already normalised) is a tax number for `country`.
 * Turkey: a 10-digit VKN or a valid 11-digit TCKN. Elsewhere: 2–32 letters
 * and digits — every country has its own format, and the invoice only prints it.
 */
export function isValidTaxId(country: string, taxId: string): boolean {
  if (country === 'TR') return /^\d{10}$/.test(taxId) || isValidTckn(taxId);
  return /^[A-Z0-9]{2,32}$/.test(taxId);
}

/** An EU-style VAT number: a two-letter prefix and 2–13 letters or digits. */
export function isValidVatId(vatId: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vatId);
}

/** Deliberately loose — the mail system decides; this only refuses what cannot be an address. */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * The first rule a profile breaks, or null. Expects trimmed values with the
 * tax and VAT numbers normalised. A Turkish workspace must give a tax number
 * (an invoice to a Turkish company without one is not addressable); elsewhere
 * it is optional.
 */
export function billingProfileProblem(input: {
  country: string;
  tax_id?: string | null;
  vat_id?: string | null;
  invoice_email?: string | null;
}): { field: keyof BillingProfileInput; problem: BillingProfileProblem } | null {
  if (!isCountryCode(input.country)) return { field: 'country', problem: 'country_invalid' };
  if (input.tax_id) {
    if (!isValidTaxId(input.country, input.tax_id)) {
      return { field: 'tax_id', problem: 'tax_id_invalid' };
    }
  } else if (input.country === 'TR') {
    return { field: 'tax_id', problem: 'tax_id_required' };
  }
  if (input.vat_id && !isValidVatId(input.vat_id)) {
    return { field: 'vat_id', problem: 'vat_id_invalid' };
  }
  if (input.invoice_email && !isPlausibleEmail(input.invoice_email)) {
    return { field: 'invoice_email', problem: 'invoice_email_invalid' };
  }
  return null;
}

/**
 * One side of an invoice, as it is frozen onto the document. The same shape
 * for the issuer and the customer, so the PDF prints both the same way.
 */
export interface InvoiceParty {
  legal_name: string;
  address_lines: string[];
  country: string | null;
  tax_office: string | null;
  tax_id: string | null;
  vat_id: string | null;
  email: string | null;
  /**
   * The issuer only: the tax wording its country requires (reverse charge,
   * VAT, e-document notice). Empty until the issuing company's country is
   * decided (K24, 07 open risk) — the PDF then prints nothing in its place.
   */
  tax_note?: string | null;
  /**
   * The customer only: no billing profile existed when the invoice was issued,
   * so only the workspace name is on it.
   */
  incomplete?: boolean;
  /** The issuer only: the root panel has not set the issuer's details yet. */
  placeholder?: boolean;
}

/**
 * Who issues invoices until the root panel sets `billing.issuer_profile`
 * (tm 389.18): the brand name and nothing that could pass for a legal entity.
 */
export const PLACEHOLDER_ISSUER: InvoiceParty = {
  legal_name: 'SiyahTuş',
  address_lines: [],
  country: null,
  tax_office: null,
  tax_id: null,
  vat_id: null,
  email: null,
  tax_note: null,
  placeholder: true,
};

/** The issuer every number series belongs to while there is one issuing company. */
export const INVOICE_ISSUER = 'siyahtus';

/** `2026-000123` — year, then the gapless serial for that year, six digits or more. */
export function formatInvoiceNumber(year: number, serial: number): string {
  return `${year}-${String(serial).padStart(6, '0')}`;
}

/** The statement a PDF carries in both languages (K24): it is not a legal invoice. */
export const INVOICE_INFORMATIONAL_NOTICE = {
  tr: 'Bilgi amaçlıdır. Bu belge yasal fatura yerine geçmez.',
  en: 'For information only. This document is not a legal invoice.',
} as const;
