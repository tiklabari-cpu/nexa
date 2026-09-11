/**
 * Display formatting local to this feature — mirrors the wording
 * `apps/web/src/features/billing/BillingPage.tsx` and `apps/web/src/lib/format.ts`
 * use, not their code: a web module cannot be imported across the workspace
 * boundary into a Metro bundle, and the phone has no i18n store yet for a
 * shared locale binding to hang off (same reasoning `features/reports/format.ts`
 * and `features/playbook/format.ts` give).
 *
 * Unlike those two, money and invoice dates are pinned to `en-US` rather than
 * the runtime default (`undefined`): web's own `formatMoney` binds to
 * `setFormatLocale` for exactly this reason — a decimal separator that
 * silently flips between "." and "," depending on which device a workspace
 * owner opens Billing on is the kind of thing that becomes a support ticket
 * about a wrong price. The phone has no i18n store to bind to yet, so a fixed
 * locale is the honest middle ground until it does.
 */
import type { Entitlements, Invoice } from './types';

/** Cents → `"$99.00"`. Money is stored in cents; never format a float. */
export function formatMoney(cents: number | null | undefined, currency = 'USD'): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** ISO timestamp → a short absolute date, or `null` for "no data" (never "0"). */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
}

/** `142` → `"142"`, with thousands separators. */
export function formatCount(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat().format(value);
}

const INVOICE_STATUS_LABEL: Record<Invoice['status'], string> = {
  paid: 'Paid',
  open: 'Open',
  trial: 'Trial',
};

export function formatInvoiceStatus(status: Invoice['status']): string {
  return INVOICE_STATUS_LABEL[status];
}

/**
 * The note a row needs beside its status, or `null` when it needs none
 * (FR-MOD-10.3).
 *
 * `issued` is the normal case — a statement frozen in the month after its
 * period — and labelling every one of those would say nothing. The other two
 * are the rows a total alone would misrepresent: an `estimate` is a month still
 * accruing, whose figure will move before it settles, and a `reconstructed`
 * period had its seat line priced from the subscription as it stood when the
 * row was written rather than as it stood during the period. Same wording the
 * console uses (`billing.invoices.origin.*`), mirrored rather than imported for
 * the reason at the top of this file.
 */
export function formatInvoiceOrigin(origin: Invoice['origin']): string | null {
  if (origin === 'estimate') return 'Estimate';
  if (origin === 'reconstructed') return 'Reconstructed';
  return null;
}

/** The vocabulary order `EntitlementsView.entitlements` always carries — every
 * key present, so the list on screen never silently drops one. */
export const ENTITLEMENT_LABEL: Record<keyof Entitlements['entitlements'], string> = {
  white_label: 'White-label widget',
  sandbox: 'Sandbox workspace',
  sla: 'SLA targets',
  sso: 'SSO & SCIM',
  hipaa: 'HIPAA (BAA + US hosting)',
  siem_export: 'SIEM export',
};
