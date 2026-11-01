/**
 * The e-invoice seam (tm 383 · BL-02 · K24).
 *
 * Whether SiyahTuş must file each invoice with a tax authority — Turkey's
 * e-Fatura / e-Arşiv through a licensed integrator, or nothing at all — turns
 * on the country of the issuing company, which is not decided (07 open risk).
 * So the period-close sweep hands every issued statement to this interface and
 * records the receipt, and the only implementation is a mock: it makes no
 * network call, answers deterministically, and its receipt says it is a mock.
 *
 * A real integrator is a commercial contract and a network call, and must not
 * run inside the statement's transaction (which holds the invoice-number lock):
 * it belongs behind an outbox that submits after commit and records the
 * receipt on its own row. The mock can run inline because it cannot fail
 * slowly — that is the one liberty it takes.
 */
import { createHash } from 'node:crypto';
import type { InvoiceParty } from '@siyahtus/types';

/** What the provider is handed: the statement as issued, and its PDF. */
export interface EInvoiceSubmission {
  licenseId: bigint;
  number: string;
  issuedAt: Date;
  currency: string;
  totalCents: number;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  pdf: Buffer;
}

export interface EInvoiceReceipt {
  /** Which provider took it — `mock` here. */
  provider: string;
  /** The provider's id for the document. */
  reference: string;
}

export interface EInvoiceProvider {
  readonly id: string;
  submit(submission: EInvoiceSubmission): Promise<EInvoiceReceipt>;
}

/**
 * Takes every document and files it nowhere. The reference is a digest of
 * the number and the PDF, so the same document always gets the same receipt
 * and a test can recompute it. Stateless: it keeps nothing it was handed.
 */
export class MockEInvoiceProvider implements EInvoiceProvider {
  readonly id = 'mock';

  async submit(submission: EInvoiceSubmission): Promise<EInvoiceReceipt> {
    return { provider: this.id, reference: mockEInvoiceReference(submission) };
  }
}

export function mockEInvoiceReference(
  submission: Pick<EInvoiceSubmission, 'number' | 'pdf'>,
): string {
  const digest = createHash('sha256')
    .update(submission.number)
    .update(submission.pdf)
    .digest('hex')
    .slice(0, 16);
  return `MOCK-${submission.number}-${digest}`;
}

/** The provider this deployment files with. Mock until the issuer's country is decided. */
export function createEInvoiceProvider(): EInvoiceProvider {
  return new MockEInvoiceProvider();
}
