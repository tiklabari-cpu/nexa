/**
 * Paying for the subscription (tm 382 · BL-01): the three methods' panels, the
 * "payment failed" band and the history, against a mocked API.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PaymentHistorySection, PaymentOptionsSection, PaymentStatusBand } =
  await import('./PaymentMethods.js');

type Options = Record<string, unknown>;

function options(overrides: Options = {}, state: Options = {}): Options {
  return {
    methods: ['swift_manual', 'crypto_manual'],
    card_form: true,
    amount_due: { amount_minor: 19800, currency: 'usd', billing_cycle: 'monthly', seats: 2 },
    swift: { bank: null, pending: null },
    state: {
      license_status: 'trialing',
      provider: null,
      paid_through: null,
      past_due_since: null,
      read_only_after: null,
      next_retry_at: null,
      last_failure: null,
      ...state,
    },
    ...overrides,
  };
}

function cryptoRequest(overrides: Options = {}): Options {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    network: 'usdt_trc20',
    status: 'requested',
    amount_minor: 19800,
    currency: 'usd',
    billing_name: 'Acme Ltd',
    billing_details: null,
    wallet_address: null,
    txid: null,
    txid_submitted_at: null,
    closed_reason: null,
    created_at: '2026-11-01T10:00:00.000Z',
    closed_at: null,
    ...overrides,
  };
}

function serve(paymentOptions: Options, requests: Options[] = [], payments: Options[] = []): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/billing/payment-options') return Promise.resolve(paymentOptions);
    if (path === '/billing/crypto-requests') return Promise.resolve({ requests });
    if (path === '/billing/payments') return Promise.resolve({ payments });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderUi(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('PaymentOptionsSection', () => {
  it('offers only the methods the API lists, with the amount for one term (FR-MOD-10.3)', async () => {
    serve(options());
    renderUi(<PaymentOptionsSection canManage />);
    expect(await screen.findByRole('tab', { name: 'Bank transfer' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Crypto (USDT)' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Card' })).not.toBeInTheDocument();
    expect(screen.getByTestId('payment-amount-due')).toHaveTextContent('$198.00');
    expect(screen.getByTestId('payment-amount-due')).toHaveTextContent('seats: 2');
  });

  it('issues a transfer reference and shows it with the instructions', async () => {
    serve(options());
    api.post.mockResolvedValue({
      reference: 'ST-7K2M-Q9TB',
      amount_minor: 19800,
      currency: 'usd',
      billing_cycle: 'monthly',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    renderUi(<PaymentOptionsSection canManage />);
    expect(await screen.findByText(/bank details are not set up yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Get a transfer reference' }));
    expect(api.post).toHaveBeenCalledWith('/billing/payments/swift');
    expect(await screen.findByTestId('swift-reference')).toHaveTextContent('ST-7K2M-Q9TB');
    expect(screen.getByText(/write this reference in the description/)).toBeInTheDocument();
  });

  it('shows the platform’s bank details and an issued reference', async () => {
    serve(
      options({
        swift: {
          bank: {
            beneficiary: 'Test Beneficiary',
            bank_name: 'Test Bank',
            iban: 'XX00TEST',
            swift_bic: 'TESTXX00',
            bank_address: null,
          },
          pending: {
            reference: 'ST-AAAA-BBBB',
            amount_minor: 19800,
            currency: 'usd',
            billing_cycle: 'monthly',
            created_at: '2026-11-01T10:00:00.000Z',
          },
        },
      }),
    );
    renderUi(<PaymentOptionsSection canManage />);
    expect(await screen.findByText('XX00TEST')).toBeInTheDocument();
    expect(screen.getByTestId('swift-reference')).toHaveTextContent('ST-AAAA-BBBB');
    expect(
      screen.queryByRole('button', { name: 'Get a transfer reference' }),
    ).not.toBeInTheDocument();
  });

  it('asks for a crypto address without showing one, then takes the TXID once it is sent', async () => {
    serve(options());
    api.post.mockResolvedValue(cryptoRequest());
    renderUi(<PaymentOptionsSection canManage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Crypto (USDT)' }));
    expect(screen.getByText(/no address is shown automatically/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Network'), 'usdt_erc20');
    await userEvent.type(screen.getByLabelText('Billing name'), 'Acme Ltd');
    await userEvent.click(screen.getByRole('button', { name: 'Request an address' }));
    expect(api.post).toHaveBeenCalledWith('/billing/crypto-requests', {
      network: 'usdt_erc20',
      billing_name: 'Acme Ltd',
      billing_details: null,
    });
  });

  it('waits for the team’s address on an open request — none is shown', async () => {
    serve(options(), [cryptoRequest()]);
    renderUi(<PaymentOptionsSection canManage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Crypto (USDT)' }));
    expect(await screen.findByText(/Address requested/)).toBeInTheDocument();
    expect(screen.queryByTestId('crypto-wallet-address')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Transaction ID (TXID)')).not.toBeInTheDocument();
  });

  it('shows the team’s reason for rejecting the last request, with the form to ask again', async () => {
    serve(options(), [
      cryptoRequest({
        status: 'rejected',
        closed_reason: 'Billing name does not match the company record.',
        closed_at: '2026-11-02T10:00:00.000Z',
      }),
    ]);
    renderUi(<PaymentOptionsSection canManage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Crypto (USDT)' }));
    const note = await screen.findByTestId('crypto-rejected-reason');
    expect(note).toHaveTextContent('Your last crypto request was rejected.');
    expect(note).toHaveTextContent('Reason from the SiyahTuş team');
    expect(note).toHaveTextContent('Billing name does not match the company record.');
    expect(screen.getByRole('button', { name: 'Request an address' })).toBeInTheDocument();
  });

  it('shows the reason to a member who cannot ask again, without a retry hint', async () => {
    serve(options(), [cryptoRequest({ status: 'rejected', closed_reason: 'Wrong network.' })]);
    renderUi(<PaymentOptionsSection canManage={false} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Crypto (USDT)' }));
    const note = await screen.findByTestId('crypto-rejected-reason');
    expect(note).toHaveTextContent('Wrong network.');
    expect(note).not.toHaveTextContent('request an address again');
    expect(screen.queryByRole('button', { name: 'Request an address' })).not.toBeInTheDocument();
  });

  it('shows no reason box when the team rejected the request without giving one', async () => {
    serve(options(), [cryptoRequest({ status: 'rejected', closed_reason: null })]);
    renderUi(<PaymentOptionsSection canManage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Crypto (USDT)' }));
    expect(await screen.findByRole('button', { name: 'Request an address' })).toBeInTheDocument();
    expect(screen.queryByTestId('crypto-rejected-reason')).not.toBeInTheDocument();
  });

  it('hides an old rejection once a newer request is open', async () => {
    serve(options(), [
      cryptoRequest({ id: '22222222-2222-4222-8222-222222222222', status: 'requested' }),
      cryptoRequest({ status: 'rejected', closed_reason: 'Wrong network.' }),
    ]);
    renderUi(<PaymentOptionsSection canManage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Crypto (USDT)' }));
    expect(await screen.findByTestId('crypto-open-request')).toBeInTheDocument();
    expect(screen.queryByTestId('crypto-rejected-reason')).not.toBeInTheDocument();
  });

  it('shows the address the team sent and submits the TXID; a used TXID is explained', async () => {
    const address = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
    serve(options(), [cryptoRequest({ status: 'address_sent', wallet_address: address })]);
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'used',
        requestId: 'r-1',
        details: { reason: 'txid_used' },
      }),
    );
    renderUi(<PaymentOptionsSection canManage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Crypto (USDT)' }));
    expect(await screen.findByTestId('crypto-wallet-address')).toHaveTextContent(address);
    expect(screen.getByText(/Send exactly 198.00 USDT/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Transaction ID (TXID)'), 'a'.repeat(64));
    await userEvent.click(screen.getByRole('button', { name: 'Submit transaction ID' }));
    expect(api.post).toHaveBeenCalledWith(
      '/billing/crypto-requests/11111111-1111-4111-8111-111111111111/txid',
      { txid: 'a'.repeat(64) },
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This transaction ID has already been submitted.',
    );
  });

  it('sends the browser to the hosted card page when the processor is real', async () => {
    serve(options({ methods: ['swift_manual', 'crypto_manual', 'stripe'], card_form: false }));
    api.post.mockResolvedValue({ url: 'https://checkout.stripe.test/pay/cs_1', reference: 'ST-1' });
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign,
    } as Location);
    renderUi(<PaymentOptionsSection canManage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Card' }));
    expect(screen.getByText(/never sees your card number/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pay with card' }));
    expect(api.post).toHaveBeenCalledWith('/billing/payments/stripe/checkout');
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/pay/cs_1'),
    );
  });

  it('shows a member who is not the owner the same panels with no buttons (K7)', async () => {
    serve(options(), [
      cryptoRequest({
        status: 'address_sent',
        wallet_address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
      }),
    ]);
    renderUi(<PaymentOptionsSection canManage={false} />);
    expect(await screen.findByRole('tab', { name: 'Bank transfer' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Get a transfer reference' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Crypto (USDT)' }));
    expect(await screen.findByTestId('crypto-wallet-address')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw request' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Transaction ID (TXID)')).not.toBeInTheDocument();
  });

  it('has nothing to pay on a quoted plan', async () => {
    serve(options({ amount_due: null }));
    renderUi(<PaymentOptionsSection canManage />);
    expect(await screen.findByText(/invoiced under its contract/)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});

describe('PaymentStatusBand', () => {
  it('says a renewal failed, when the card is tried again and when it turns read-only (FR-MOD-10.2)', async () => {
    serve(
      options(
        {},
        {
          license_status: 'past_due',
          past_due_since: '2026-11-01T09:00:00.000Z',
          next_retry_at: '2026-11-02T09:00:00.000Z',
          read_only_after: '2026-11-08T09:00:00.000Z',
          last_failure: {
            reference: 'ST-X',
            failure_code: 'card_declined',
            at: '2026-11-01T09:00:00.000Z',
          },
        },
      ),
    );
    renderUi(<PaymentStatusBand />);
    const band = await screen.findByRole('alert');
    expect(band).toHaveTextContent("Your payment didn't go through");
    expect(screen.getByTestId('payment-failed-band')).toHaveTextContent(/Nov 2, 2026/);
    expect(screen.getByTestId('payment-failed-band')).toHaveTextContent(/Nov 8, 2026/);
  });

  it('says a checkout did not go through', async () => {
    serve(
      options(
        {},
        {
          last_failure: {
            reference: 'ST-Q9TB-7K2M',
            failure_code: null,
            at: '2026-11-01T09:00:00.000Z',
          },
        },
      ),
    );
    renderUi(<PaymentStatusBand />);
    expect(await screen.findByTestId('payment-failed-band')).toHaveTextContent('ST-Q9TB-7K2M');
  });

  it('greets the way back from the hosted page, and is silent otherwise', async () => {
    window.history.replaceState(null, '', '/billing?payment=success&reference=ST-1');
    serve(options());
    renderUi(<PaymentStatusBand />);
    expect(await screen.findByText('Payment received')).toBeInTheDocument();
  });

  it('shows nothing when payments are in order', async () => {
    serve(options());
    renderUi(<PaymentStatusBand />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId('payment-failed-band')).not.toBeInTheDocument();
  });
});

describe('PaymentHistorySection', () => {
  it('lists every attempt with its method, reference, outcome and the term it paid', async () => {
    serve(
      options(),
      [],
      [
        {
          id: 'p-1',
          reference: 'ST-AAAA-BBBB',
          provider: 'swift_manual',
          kind: 'checkout',
          status: 'succeeded',
          amount_minor: 19800,
          currency: 'usd',
          billing_cycle: 'monthly',
          attempt: 1,
          failure_code: null,
          term_start: '2026-11-01T00:00:00.000Z',
          term_end: '2026-12-01T00:00:00.000Z',
          created_at: '2026-11-01T00:00:00.000Z',
          settled_at: '2026-11-01T00:00:00.000Z',
        },
      ],
    );
    renderUi(<PaymentHistorySection />);
    const table = await screen.findByTestId('payment-history');
    expect(table).toHaveTextContent('Bank transfer');
    expect(table).toHaveTextContent('ST-AAAA-BBBB');
    expect(table).toHaveTextContent('Succeeded');
    expect(table).toHaveTextContent('$198.00');
    expect(table).toHaveTextContent(/Covers/);
  });

  it('says when there is nothing yet', async () => {
    serve(options());
    renderUi(<PaymentHistorySection />);
    expect(await screen.findByTestId('payment-history-empty')).toBeInTheDocument();
  });
});
