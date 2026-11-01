import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_ISSUER, type InvoiceParty } from '@siyahtus/types';
import { formatAmount, renderInvoicePdf, type InvoiceDocument } from './invoice-pdf.js';

/** Every text item pdf.js reads off the document, page by page, joined. */
async function readText(bytes: Buffer): Promise<{ pages: number; text: string }> {
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
    const page = await document.getPage(n);
    const content = await page.getTextContent();
    for (const item of content.items) if ('str' in item) parts.push(item.str);
  }
  const pages = document.numPages;
  await task.destroy();
  return { pages, text: parts.join('\n') };
}

const buyer: InvoiceParty = {
  legal_name: 'Işıklı Çağrı Oyun Hizmetleri Ltd. Şti.',
  address_lines: ['Gökdeniz Sk. No: 5', '34000 İstanbul'],
  country: 'TR',
  tax_office: 'Büyük Mükellefler',
  tax_id: '1234567890',
  vat_id: null,
  email: 'muhasebe@example.com',
};

function document(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    number: '2026-000042',
    issuedAt: new Date('2026-10-31T00:00:00Z'),
    period: '202610',
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-11-01T00:00:00Z'),
    currency: 'usd',
    lineItems: [
      { description: 'Subscription — 3 seats (monthly)', amountCents: 29_700 },
      { description: 'Account credit', amountCents: -2_000 },
    ],
    subtotalCents: 29_700,
    totalCents: 27_700,
    status: 'paid',
    seller: {
      ...PLACEHOLDER_ISSUER,
      tax_note: 'Ters yükleme (sorumlu sıfatıyla KDV) — reverse charge.',
    },
    buyer,
    payment: { method: 'swift_manual', reference: 'ST-ABCD-1234' },
    ...overrides,
  };
}

describe('the informational invoice PDF (tm 383 · BL-02 · K24)', () => {
  it('prints the parties, number, lines, payment and the notice, Turkish characters intact', async () => {
    const bytes = renderInvoicePdf(document());
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7');

    const { pages, text } = await readText(bytes);
    expect(pages).toBe(1);
    for (const expected of [
      'FATURA / INVOICE',
      'No: 2026-000042',
      'Bilgi amaçlıdır. Bu belge yasal fatura yerine geçmez.',
      'For information only. This document is not a legal invoice.',
      'Işıklı Çağrı Oyun Hizmetleri Ltd. Şti.',
      'Gökdeniz Sk. No: 5',
      '34000 İstanbul',
      'Vergi dairesi / Tax office: Büyük Mükellefler',
      'Vergi no / Tax ID: 1234567890',
      'Subscription — 3 seats (monthly)',
      'USD 297.00',
      'USD -20.00',
      'USD 277.00',
      'Yöntem / Method: Banka havalesi (SWIFT) / Bank transfer (SWIFT)',
      'Referans / Reference: ST-ABCD-1234',
      'Ters yükleme (sorumlu sıfatıyla KDV) — reverse charge.',
      'Satıcı bilgileri henüz tanımlanmadı.',
      'Issuer details not set yet.',
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it('embeds its font rather than leaning on the reader’s', () => {
    const raw = renderInvoicePdf(document()).toString('latin1');
    expect(raw).toContain('/FontFile2');
    expect(raw).toContain('/Encoding /Identity-H');
    expect(raw).toContain('/ToUnicode');
    expect(raw).not.toContain('/BaseFont /Helvetica');
  });

  it('renders the same document to the same bytes — no clock, no randomness', () => {
    expect(renderInvoicePdf(document()).equals(renderInvoicePdf(document()))).toBe(true);
  });

  it('says so when no billing details were on file and nothing was paid', async () => {
    const { text } = await readText(
      renderInvoicePdf(
        document({
          buyer: {
            legal_name: 'Acme',
            address_lines: [],
            country: null,
            tax_office: null,
            tax_id: null,
            vat_id: null,
            email: null,
            incomplete: true,
          },
          payment: null,
        }),
      ),
    );
    expect(text).toContain('Fatura bilgileri girilmemişti.');
    expect(text).toContain('No billing details were on file.');
    expect(text).toContain(
      'Bu dönem için kayıtlı ödeme yok. / No payment is recorded for this period.',
    );
  });

  it('runs onto a second page rather than off the first', async () => {
    const lineItems = Array.from({ length: 70 }, (_, i) => ({
      description: `API package — Ölçek ${i + 1} (10000 calls)`,
      amountCents: 1_000,
    }));
    const { pages, text } = await readText(renderInvoicePdf(document({ lineItems })));
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain('API package — Ölçek 70 (10000 calls)');
  });

  it('formats money with fixed separators', () => {
    expect(formatAmount(123_456_789, 'usd')).toBe('USD 1,234,567.89');
    expect(formatAmount(-5, 'usd')).toBe('USD -0.05');
  });
});
