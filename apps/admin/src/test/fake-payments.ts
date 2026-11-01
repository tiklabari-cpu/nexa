/**
 * Payment operations (tm 389.18) for `fake-platform.ts`: one crypto request, one bank transfer,
 * the three payment settings, an invoice PDF and a refund approval — the writes with the
 * server's rules in miniature, enough to see the SPA react. The real rules have their own suite
 * (`platform-payment-ops.test.ts`).
 */
import { platformRoleHas, type PlatformRole } from '@siyahtus/types';
import { INVOICE_ID } from './fake-billing.js';

const NOW = '2026-10-25T10:00:00.000Z';

export const REQUEST_ID = '00000000-0000-4000-8000-0000000000e1';
export const SWIFT_ID = '00000000-0000-4000-8000-0000000000f1';
export const SWIFT_REFERENCE = 'ST-7K2M-Q9TB';
export const TRC20_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

type Json = (status: number, body: unknown) => Response;
type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;

export interface FakePaymentsState {
  request: Record<string, unknown>;
  swift: Record<string, unknown>;
  providers: { swift_manual: boolean; crypto_manual: boolean; stripe: boolean };
  providersStored: boolean;
  bank: Record<string, unknown> | null;
  issuer: Record<string, unknown> | null;
}

export function initialPaymentsState(): FakePaymentsState {
  return {
    request: {
      id: REQUEST_ID,
      license_id: '42',
      organization_name: 'Acme Gaming',
      network: 'usdt_trc20',
      status: 'requested',
      amount_minor: 19_800,
      currency: 'USD',
      billing_cycle: 'monthly',
      billing_name: 'Acme Gaming Ltd',
      wallet_address: null,
      address_sent_at: null,
      txid: null,
      txid_submitted_at: null,
      closed_reason: null,
      handled_by_email: null,
      created_at: NOW,
      closed_at: null,
    },
    swift: {
      id: SWIFT_ID,
      license_id: '42',
      organization_name: 'Acme Gaming',
      reference: SWIFT_REFERENCE,
      status: 'pending',
      amount_minor: 29_700,
      currency: 'USD',
      billing_cycle: 'monthly',
      created_at: NOW,
      settled_at: null,
      handled_by_email: null,
    },
    providers: { swift_manual: true, crypto_manual: true, stripe: false },
    providersStored: false,
    bank: null,
    issuer: null,
  };
}

const OPEN = ['requested', 'address_sent'];

/** The payment-operations answers, or null for a path this surface does not own. */
export function handlePayments(
  method: string,
  path: string,
  body: unknown,
  search: URLSearchParams,
  role: PlatformRole,
  state: FakePaymentsState,
  json: Json,
  problem: Problem,
): Response | null {
  const input = (body ?? {}) as Record<string, unknown>;
  const write = (): Response | null => {
    if (!platformRoleHas(role, 'billing.manage')) return problem(403, 'authorization');
    const reason = typeof input['reason'] === 'string' ? input['reason'].trim() : '';
    if (reason.length < 3) return problem(400, 'platform_reason_required');
    return null;
  };
  const request = state.request;
  const requestPath = `/billing/payment-requests/${REQUEST_ID}`;

  if (method === 'GET' && path === `/billing/invoices/${INVOICE_ID}/pdf`) {
    return new Response('%PDF-1.7 fake', {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
  }

  if (method === 'GET' && path === '/billing/payment-requests') {
    const filter = search.get('state') ?? 'open';
    const status = String(request['status']);
    const shown =
      filter === 'all' || (filter === 'open' ? OPEN.includes(status) : filter === status);
    return json(200, { data: shown ? [request] : [], next_cursor: null });
  }

  if (method === 'POST' && path === `${requestPath}/send-address`) {
    const refused = write();
    if (refused) return refused;
    if (!OPEN.includes(String(request['status'])) || request['txid']) {
      return problem(409, 'platform_payment_state', 'Not waiting for an address.', {
        reason: 'not_awaiting_address',
      });
    }
    Object.assign(request, {
      status: 'address_sent',
      wallet_address: input['address'],
      address_sent_at: NOW,
      handled_by_email: 'ops@example.com',
    });
    return json(200, { request });
  }

  if (method === 'POST' && path === `${requestPath}/confirm-txid`) {
    const refused = write();
    if (refused) return refused;
    if (request['status'] !== 'address_sent') {
      return problem(409, 'platform_payment_state', 'Nothing to confirm.', {
        reason: 'not_awaiting_confirmation',
      });
    }
    if (input['txid'] === 'f'.repeat(64)) {
      return problem(409, 'platform_payment_state', 'Already used.', { reason: 'txid_used' });
    }
    Object.assign(request, { status: 'paid', txid: input['txid'], closed_at: NOW });
    return json(200, { request });
  }

  if (method === 'POST' && path === `${requestPath}/cancel`) {
    const refused = write();
    if (refused) return refused;
    Object.assign(request, { status: 'rejected', closed_reason: input['reason'], closed_at: NOW });
    return json(200, { request });
  }

  if (method === 'GET' && path === '/billing/swift-payments') {
    const filter = search.get('state') ?? 'pending';
    const shown = filter === 'all' || filter === state.swift['status'];
    return json(200, { data: shown ? [state.swift] : [], next_cursor: null });
  }

  if (method === 'POST' && path === `/billing/swift-payments/${SWIFT_ID}/mark-paid`) {
    const refused = write();
    if (refused) return refused;
    if (String(input['reference']).toUpperCase() !== SWIFT_REFERENCE) {
      return problem(400, 'validation', 'Wrong reference.', { reason: 'reference_mismatch' });
    }
    Object.assign(state.swift, { status: 'succeeded', settled_at: NOW });
    return json(200, { payment: state.swift });
  }

  const providers = () => ({
    providers: state.providers,
    stored: state.providersStored,
    stripe_card_ready: false,
    updated_at: state.providersStored ? NOW : null,
  });
  if (method === 'GET' && path === '/billing/providers') return json(200, providers());
  if (method === 'PUT' && path === '/billing/providers') {
    const refused = write();
    if (refused) return refused;
    state.providers = {
      swift_manual: input['swift_manual'] === true,
      crypto_manual: input['crypto_manual'] === true,
      stripe: input['stripe'] === true,
    };
    state.providersStored = true;
    return json(200, providers());
  }

  if (method === 'GET' && path === '/billing/bank-details') {
    return json(200, { details: state.bank, updated_at: state.bank ? NOW : null });
  }
  if (method === 'PUT' && path === '/billing/bank-details') {
    const refused = write();
    if (refused) return refused;
    const iban = String(input['iban']).replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
      return problem(400, 'validation', 'That is not an IBAN.', { reason: 'iban_invalid' });
    }
    state.bank = {
      beneficiary: input['beneficiary'],
      bank_name: input['bank_name'],
      iban,
      swift_bic: String(input['swift_bic']).toUpperCase(),
      bank_address: input['bank_address'] ?? null,
    };
    return json(200, { details: state.bank, updated_at: NOW });
  }

  if (method === 'GET' && path === '/billing/issuer-profile') {
    return json(200, { profile: state.issuer, updated_at: state.issuer ? NOW : null });
  }
  if (method === 'PUT' && path === '/billing/issuer-profile') {
    const refused = write();
    if (refused) return refused;
    const { reason: _reason, ...profile } = input;
    state.issuer = profile;
    return json(200, { profile: state.issuer, updated_at: NOW });
  }

  if (method === 'POST' && path === '/billing/refund-approvals') {
    const refused = write();
    if (refused) return refused;
    if (input['invoice_id'] !== INVOICE_ID) return problem(404, 'not_found', 'Invoice not found.');
    if (Number(input['amount_minor']) > 27_200) {
      return problem(400, 'validation', 'Too much.', { reason: 'amount_exceeds_invoice' });
    }
    return json(201, {
      credit: {
        id: '00000000-0000-4000-8000-0000000000d9',
        license_id: input['license_id'],
        organization_name: 'Acme Gaming',
        amount_minor: input['amount_minor'],
        currency: 'USD',
        reason: `Refund of SIYAHTUS-202609: ${String(input['reason'])}`,
        admin_email: 'ops@example.com',
        invoice_id: null,
        invoice_number: null,
        invoice_period: null,
        remainder_of: null,
        created_at: NOW,
      },
    });
  }

  return null;
}
