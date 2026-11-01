/**
 * The billing profile and the invoice PDF (tm 383 · BL-02 · K24).
 *
 *   GET /billing/profile                 admins and the owner (billing read scope)
 *   PUT /billing/profile                 the owner (K7: `exactRole: 'owner'`)
 *   GET /billing/invoices/{period}/pdf   anyone who can read billing
 *
 * The profile is copied onto each statement when it is issued, so saving it
 * changes the next invoice, never one already issued — the PDF route serves the
 * bytes stored at issue, not a fresh rendering. The pilot refuses every
 * `/billing/` write (`pilot-gate.ts`), a sandbox too (`sandbox-gate.ts`).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BILLING_PROFILE_LIMITS } from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { selfAccountId } from '../services/auth/principal.js';
import {
  BillingProfileError,
  normaliseBillingProfile,
  readBillingProfile,
  saveBillingProfile,
} from '../services/billing/billing-profile.js';
import { createObjectStore, type ObjectStore } from '../services/storage/object-store.js';

const BILLING_READ_SCOPES = ['billing_manage', 'billing_admin', 'reports_read'];
const BILLING_WRITE_SCOPES = ['billing_manage', 'billing_admin'];

const L = BILLING_PROFILE_LIMITS;
const optional = (max: number) => z.string().max(max).nullish();

const profileBody = z
  .object({
    legal_name: z.string().trim().min(1).max(L.legalName),
    address_line1: z.string().trim().min(1).max(L.addressLine),
    address_line2: optional(L.addressLine),
    city: z.string().trim().min(1).max(L.city),
    postal_code: optional(L.postalCode),
    country: z.string().trim().length(2),
    tax_office: optional(L.taxOffice),
    // Room for the separators people type; the stored form is checked after.
    tax_id: optional(L.taxId + 16),
    vat_id: optional(L.vatId + 8),
    invoice_email: optional(L.invoiceEmail),
  })
  .strict();

const periodParams = z.object({ period: z.string().regex(/^\d{6}$/) });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
      issue ? { field: issue.path.join('.') } : undefined,
    );
  }
  return result.data;
}

export interface BillingProfileRoutesOptions {
  env: Env;
  /** Tests hand in their own; otherwise the deployment's store. */
  store?: ObjectStore;
}

export default async function billingProfileRoutes(
  app: FastifyInstance,
  options: BillingProfileRoutesOptions,
): Promise<void> {
  const { env } = options;
  const store = options.store ?? createObjectStore(env.STORAGE_PROVIDER, env.storage);

  app.get(
    '/billing/profile',
    { config: { scopes: BILLING_READ_SCOPES, minimumRole: 'admin' } },
    async (request, reply) => {
      const tenant = request.tenant();
      const profile = await request.withTenant((tx) => readBillingProfile(tx, tenant));
      return reply.header('cache-control', 'no-store').send({ profile });
    },
  );

  app.put(
    '/billing/profile',
    // Writable while read-only, like every billing write: the details on the
    // invoice are part of paying, which is how a read-only workspace returns.
    { config: { scopes: BILLING_WRITE_SCOPES, exactRole: 'owner', allowWhenReadOnly: true } },
    async (request, reply) => {
      const body = parse(profileBody, request.body);
      let normalised;
      try {
        normalised = normaliseBillingProfile(body);
      } catch (error) {
        if (error instanceof BillingProfileError) {
          throw ApiError.validation(error.message, {
            field: error.field,
            reason: error.problem,
          });
        }
        throw error;
      }
      const tenant = request.tenant();
      const accountId = selfAccountId(request.requirePrincipal());
      const profile = await request.withTenant(async (tx) => {
        const saved = await saveBillingProfile(tx, tenant, normalised, accountId);
        // Which country and whether numbers are on file — not the numbers,
        // the address or the name, which the trail has no reason to copy.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'billing.profile_updated',
          metadata: {
            country: saved.country,
            tax_id: saved.tax_id !== null,
            vat_id: saved.vat_id !== null,
          },
        });
        return saved;
      });
      return reply.send({ profile });
    },
  );

  app.get(
    '/billing/invoices/:period/pdf',
    { config: { scopes: BILLING_READ_SCOPES } },
    async (request, reply) => {
      const { period } = parse(periodParams, request.params);
      const tenant = request.tenant();
      const invoice = await request.withTenant((tx) =>
        tx.invoice.findUnique({
          where: { licenseId_period: { licenseId: tenant.licenseId, period } },
          select: { number: true, pdfStorageKey: true },
        }),
      );
      // The open period has no statement yet, and one frozen before PDFs
      // existed has no document: both are "no PDF for that period".
      if (!invoice?.pdfStorageKey) throw ApiError.notFound(`No invoice PDF for period ${period}.`);

      const file = await store.get(invoice.pdfStorageKey);
      if (!file) {
        // Written in the statement's own transaction, so a missing file was
        // removed behind our back — worth a line in the log, not a 500 the
        // reader can do nothing with.
        request.log.warn(
          { license_id: tenant.licenseId.toString(), period },
          'invoice pdf missing from the object store',
        );
        throw ApiError.notFound(`No invoice PDF for period ${period}.`);
      }

      return reply
        .header('content-type', 'application/pdf')
        .header(
          'content-disposition',
          `attachment; filename="siyahtus-invoice-${invoice.number}.pdf"`,
        )
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store')
        .send(file.bytes);
    },
  );
}
