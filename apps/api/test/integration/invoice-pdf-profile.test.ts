/**
 * Billing profile, the issued invoice PDF and its gapless number (tm 383 ·
 * BL-02 · K24).
 *
 * What the acceptance criteria name, each against the real database and the
 * runtime role:
 *
 *   1. The owner saves the profile; an invalid tax number is refused with the
 *      field and the reason; admins read it, agents and admins cannot write it.
 *   2. A closed period's PDF downloads with the legal name, address, tax
 *      number, the gapless number, how it was paid and its reference, and the
 *      "for information only" notice — Turkish characters intact.
 *   3. Editing the profile afterwards leaves that PDF byte-identical: it is
 *      the document stored at issue, from the snapshot frozen at issue.
 *   4. Two statements issued at once get consecutive numbers; a statement that
 *      fails to commit hands its number back.
 *   5. The e-invoice call goes to the mock provider, with no network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatInvoiceNumber } from '@siyahtus/types';
import {
  createEInvoiceProvider,
  mockEInvoiceReference,
  type EInvoiceProvider,
  type EInvoiceSubmission,
} from '../../src/services/billing/e-invoice.js';
import { InvoiceCloseSweeper } from '../../src/services/billing/invoice-close-sweep.js';
import { issuedAt, previousPeriod } from '../../src/services/billing/invoice-service.js';
import { currentPeriod } from '../../src/services/billing/metering.js';
import { LocalStore } from '../../src/services/storage/local-store.js';
import type { ObjectStore } from '../../src/services/storage/object-store.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** Every text item pdf.js reads off the document, joined by newlines. */
async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: `${join(root, 'standard_fonts')}/`,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const document = await task.promise;
  const parts: string[] = [];
  for (let n = 1; n <= document.numPages; n += 1) {
    const content = await (await document.getPage(n)).getTextContent();
    for (const item of content.items) if ('str' in item) parts.push(item.str);
  }
  await task.destroy();
  return parts.join('\n');
}

const PROFILE = {
  legal_name: 'Işıklı Çağrı Oyun Hizmetleri Ltd. Şti.',
  address_line1: 'Gökdeniz Sk. No: 5',
  address_line2: null,
  city: 'İstanbul',
  postal_code: '34000',
  country: 'tr',
  tax_office: 'Büyük Mükellefler',
  tax_id: '123 456 7890',
  vat_id: null,
  invoice_email: 'Muhasebe@Example.com',
};

describe('billing profile and the issued invoice PDF (tm 383 · BL-02)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let storageDir: string;

  const open = currentPeriod();
  const justClosed = previousPeriod(open);
  const older = previousPeriod(justClosed);
  const year = issuedAt(justClosed).getUTCFullYear();

  const token = async (tenant: 'a' | 'b', who: 'owner' | 'agent' = 'owner') =>
    `Bearer ${await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: who === 'owner' ? fx[tenant].ownerAccountId : fx[tenant].agentAccountId,
      scopes: ['billing_manage', 'reports_read'],
    })}`;

  async function activate(tenant: 'a' | 'b'): Promise<void> {
    await owner.license.update({
      where: { id: fx[tenant].licenseId },
      data: { status: 'active', trialEndsAt: null },
    });
    await owner.subscription.create({
      data: { licenseId: fx[tenant].licenseId, status: 'active', seats: 3, unitPriceCents: 9_900 },
    });
  }

  async function meter(tenant: 'a' | 'b', period: string): Promise<void> {
    await owner.usageRecord.create({
      data: {
        licenseId: fx[tenant].licenseId,
        metric: 'ai_resolutions',
        period,
        quantity: 10n,
        included: 200n,
        overageUnit: 1,
        overageUnitPriceCents: 50,
      },
    });
  }

  function sweeper(
    client: PrismaClient,
    deps: { store?: ObjectStore; eInvoice?: EInvoiceProvider } = {},
  ) {
    return new InvoiceCloseSweeper(client, testEnv({ STORAGE_LOCAL_DIR: storageDir }), deps);
  }

  async function downloadPdf(tenant: 'a' | 'b', period: string) {
    return server.get(`/billing/invoices/${period}/pdf`, {
      authorization: await token(tenant),
    });
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    storageDir = mkdtempSync(join(tmpdir(), 'siyahtus-invoices-'));
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer({ STORAGE_LOCAL_DIR: storageDir });
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await owner.platformSetting.deleteMany({ where: { key: 'billing.issuer_profile' } });
    await clearRateLimits(server.app);
  });

  describe('the profile', () => {
    it('is saved by the owner, normalised, and read back by an admin (FR-MOD-10.3)', async () => {
      const saved = await server.put('/billing/profile', PROFILE, {
        authorization: await token('a'),
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().profile).toMatchObject({
        legal_name: 'Işıklı Çağrı Oyun Hizmetleri Ltd. Şti.',
        country: 'TR',
        tax_id: '1234567890',
        invoice_email: 'muhasebe@example.com',
        address_line2: null,
      });

      await owner.agentMembership.updateMany({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        data: { role: 'admin' },
      });
      const admin = await token('a', 'agent');
      const read = await server.get('/billing/profile', { authorization: admin });
      expect(read.statusCode).toBe(200);
      expect(read.json().profile.legal_name).toBe(PROFILE.legal_name);

      // Admins read; only the owner writes (K7).
      const write = await server.put('/billing/profile', PROFILE, { authorization: admin });
      expect(write.statusCode).toBe(403);

      const audit = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'billing.profile_updated' },
      });
      expect(audit?.metadata).toMatchObject({ country: 'TR', tax_id: true, vat_id: false });
      expect(JSON.stringify(audit?.metadata)).not.toContain('1234567890');
    });

    it('is not readable by an agent, nor by another workspace', async () => {
      await server.put('/billing/profile', PROFILE, { authorization: await token('a') });
      const agent = await server.get('/billing/profile', {
        authorization: await token('a', 'agent'),
      });
      expect(agent.statusCode).toBe(403);
      const other = await server.get('/billing/profile', { authorization: await token('b') });
      expect(other.statusCode).toBe(200);
      expect(other.json()).toEqual({ profile: null });
    });

    it('refuses an invalid tax number with the field and the reason (FR-MOD-10.3)', async () => {
      const auth = { authorization: await token('a') };
      const bad = await server.put('/billing/profile', { ...PROFILE, tax_id: '12345' }, auth);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toMatchObject({
        type: 'validation',
        details: { field: 'tax_id', reason: 'tax_id_invalid' },
      });
      expect(bad.json().error.message).toContain('tax_id');

      // A TCKN whose check digit is off.
      const tckn = await server.put(
        '/billing/profile',
        { ...PROFILE, tax_id: '10000000147' },
        auth,
      );
      expect(tckn.json().error.details).toEqual({ field: 'tax_id', reason: 'tax_id_invalid' });

      const missing = await server.put('/billing/profile', { ...PROFILE, tax_id: null }, auth);
      expect(missing.json().error.details).toEqual({ field: 'tax_id', reason: 'tax_id_required' });

      const vat = await server.put(
        '/billing/profile',
        { ...PROFILE, country: 'DE', tax_id: null, vat_id: '123' },
        auth,
      );
      expect(vat.json().error.details).toEqual({ field: 'vat_id', reason: 'vat_id_invalid' });

      expect(await owner.billingProfile.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('cannot be stored with a malformed tax number even by a direct write', async () => {
      await expect(
        owner.billingProfile.create({
          data: {
            licenseId: fx.a.licenseId,
            legalName: 'X',
            addressLine1: 'Y',
            city: 'Z',
            country: 'TR',
            taxId: '12AB',
          },
        }),
      ).rejects.toThrow(/billing_profiles_tax_id_check/);
    });
  });

  describe('the issued statement', () => {
    it('downloads a PDF with the parties, number, payment and notice, and keeps it when the profile changes (FR-MOD-10.3)', async () => {
      await activate('a');
      await meter('a', justClosed);
      await owner.platformSetting.create({
        data: {
          key: 'billing.issuer_profile',
          value: {
            legal_name: 'SiyahTuş Yazılım A.Ş.',
            address_lines: ['Levent Mah. Çarşı Cd. 1', 'İstanbul'],
            country: 'TR',
            tax_id: '9876543210',
            tax_note: 'Vergi metni şablonu.',
          },
        },
      });
      await owner.paymentTransaction.create({
        data: {
          licenseId: fx.a.licenseId,
          provider: 'swift_manual',
          kind: 'checkout',
          reference: 'ST-TEST-383A',
          amountMinor: 29_700,
          currency: 'usd',
          period: justClosed,
          billingCycle: 'monthly',
          status: 'succeeded',
          termStart: new Date(),
          termEnd: new Date(Date.now() + 30 * 86_400_000),
          settledAt: new Date(),
        },
      });
      const auth = { authorization: await token('a') };
      expect((await server.put('/billing/profile', PROFILE, auth)).statusCode).toBe(200);

      await sweeper(appRole).run();

      const list = (await server.get('/billing/invoices', auth)).json().invoices as {
        period: string;
        number: string;
        pdf_available: boolean;
        payment_method: string | null;
        payment_reference: string | null;
      }[];
      const closed = list.find((invoice) => invoice.period === justClosed)!;
      expect(closed).toMatchObject({
        number: formatInvoiceNumber(year, 1),
        pdf_available: true,
        payment_method: 'swift_manual',
        payment_reference: 'ST-TEST-383A',
      });
      // The open period is not issued and has no document.
      expect(list.find((invoice) => invoice.period === open)!.pdf_available).toBe(false);
      expect((await downloadPdf('a', open)).statusCode).toBe(404);

      const first = await downloadPdf('a', justClosed);
      expect(first.statusCode).toBe(200);
      expect(first.headers['content-type']).toBe('application/pdf');
      expect(first.headers['content-disposition']).toContain(
        `siyahtus-invoice-${closed.number}.pdf`,
      );
      expect(first.headers['cache-control']).toBe('no-store');
      const text = await pdfText(first.rawPayload);
      for (const expected of [
        `No: ${closed.number}`,
        'Işıklı Çağrı Oyun Hizmetleri Ltd. Şti.',
        'Gökdeniz Sk. No: 5',
        '34000 İstanbul',
        'Vergi no / Tax ID: 1234567890',
        'SiyahTuş Yazılım A.Ş.',
        'Vergi no / Tax ID: 9876543210',
        'Banka havalesi (SWIFT)',
        'Referans / Reference: ST-TEST-383A',
        'Bilgi amaçlıdır. Bu belge yasal fatura yerine geçmez.',
        'Vergi metni şablonu.',
      ]) {
        expect(text, expected).toContain(expected);
      }

      // Change the profile: the issued PDF does not move.
      expect(
        (
          await server.put(
            '/billing/profile',
            { ...PROFILE, legal_name: 'Yeni Ünvan A.Ş.', tax_id: '1111111111' },
            auth,
          )
        ).statusCode,
      ).toBe(200);
      const again = await downloadPdf('a', justClosed);
      expect(again.rawPayload.equals(first.rawPayload)).toBe(true);
      expect(await pdfText(again.rawPayload)).not.toContain('Yeni Ünvan');

      // Nor can the snapshot be edited underneath it by the runtime role.
      await expect(
        appRole.$executeRaw`UPDATE invoices SET buyer_snapshot = '{}'::jsonb WHERE period = ${justClosed}`,
      ).rejects.toThrow(/permission denied/);

      // Another workspace cannot reach it.
      expect((await downloadPdf('b', justClosed)).statusCode).toBe(404);
    });

    it('issues under the workspace name, marked incomplete, when no profile exists', async () => {
      await activate('a');
      await meter('a', justClosed);
      await sweeper(appRole).run();
      const row = await owner.invoice.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, period: justClosed },
      });
      const organization = await owner.organization.findUniqueOrThrow({
        where: { id: fx.a.organizationId },
      });
      expect(row.buyerSnapshot).toMatchObject({ legal_name: organization.name, incomplete: true });
      expect(row.sellerSnapshot).toMatchObject({ legal_name: 'SiyahTuş', placeholder: true });
      expect(row.paymentMethod).toBeNull();
      const text = await pdfText((await downloadPdf('a', justClosed)).rawPayload);
      expect(text).toContain('Fatura bilgileri girilmemişti.');
    });
  });

  describe('the number', () => {
    it('gives two statements issued at once consecutive numbers, no gap', async () => {
      await activate('a');
      await activate('b');
      await meter('a', justClosed);
      await meter('b', justClosed);

      // Two passes on their own connections, at the same time — each sees the
      // other's tenant as a candidate too, so the four claims race for two
      // statements and the losers bow out on the period's unique index.
      const second = new PrismaClient({ datasourceUrl: APP_URL });
      try {
        await Promise.all([sweeper(appRole).run(), sweeper(second).run()]);
      } finally {
        await second.$disconnect();
      }

      const rows = await owner.invoice.findMany({
        where: { period: justClosed },
        orderBy: { serial: 'asc' },
      });
      expect(rows.map((row) => row.serial)).toEqual([1, 2]);
      expect(rows.map((row) => row.number)).toEqual([
        formatInvoiceNumber(year, 1),
        formatInvoiceNumber(year, 2),
      ]);
      expect(new Set(rows.map((row) => row.licenseId)).size).toBe(2);
      const counter = await owner.invoiceNumberCounter.findUniqueOrThrow({
        where: { issuer_year: { issuer: 'siyahtus', year } },
      });
      expect(counter.lastSerial).toBe(2);
    });

    it('hands the number back when the statement fails to commit', async () => {
      await activate('a');
      await meter('a', justClosed);
      const broken: ObjectStore = new LocalStore(storageDir);
      vi.spyOn(broken, 'put').mockRejectedValue(new Error('disk full'));

      await expect(sweeper(appRole, { store: broken }).run()).rejects.toThrow('disk full');
      expect(await owner.invoice.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      expect(await owner.invoiceNumberCounter.count()).toBe(0);

      await sweeper(appRole).run();
      const row = await owner.invoice.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } });
      expect(row.number).toBe(formatInvoiceNumber(year, 1));
    });

    it('numbers the years separately, oldest period first', async () => {
      await activate('a');
      await meter('a', older);
      await meter('a', justClosed);
      await sweeper(appRole).run();
      const rows = await owner.invoice.findMany({
        where: { licenseId: fx.a.licenseId },
        orderBy: { period: 'asc' },
      });
      const olderYear = issuedAt(older).getUTCFullYear();
      if (olderYear === year) {
        expect(rows.map((row) => row.number)).toEqual([
          formatInvoiceNumber(year, 1),
          formatInvoiceNumber(year, 2),
        ]);
      } else {
        expect(rows.map((row) => row.number)).toEqual([
          formatInvoiceNumber(olderYear, 1),
          formatInvoiceNumber(year, 1),
        ]);
      }
    });

    it('cannot be given out outside a tenant context, nor read or moved by the runtime role', async () => {
      await expect(
        appRole.$queryRaw`SELECT billing_next_invoice_serial('siyahtus', 2026)`,
      ).rejects.toThrow(/tenant context/);
      await expect(appRole.$queryRaw`SELECT * FROM invoice_number_counters`).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        appRole.$executeRaw`UPDATE invoice_number_counters SET last_serial = 0`,
      ).rejects.toThrow(/permission denied/);
      await expect(appRole.$executeRaw`DELETE FROM billing_profiles`).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('the e-invoice', () => {
    it('goes to the mock provider and makes no network call', async () => {
      await activate('a');
      await meter('a', justClosed);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
      const submitted: EInvoiceSubmission[] = [];
      const mock = createEInvoiceProvider();
      const spy: EInvoiceProvider = {
        id: mock.id,
        submit: async (submission) => {
          submitted.push(submission);
          return mock.submit(submission);
        },
      };
      try {
        await sweeper(appRole, { eInvoice: spy }).run();
      } finally {
        fetchSpy.mockRestore();
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(submitted).toHaveLength(1);
      const invoice = await owner.invoice.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
        include: { eSubmission: true },
      });
      expect(submitted[0]!.number).toBe(invoice.number);
      expect(invoice.eSubmission).toMatchObject({
        provider: 'mock',
        reference: mockEInvoiceReference({ number: invoice.number, pdf: submitted[0]!.pdf }),
      });
      // The stored PDF is the document that was filed.
      const stored = await downloadPdf('a', justClosed);
      expect(stored.rawPayload.equals(submitted[0]!.pdf)).toBe(true);
    });
  });
});
