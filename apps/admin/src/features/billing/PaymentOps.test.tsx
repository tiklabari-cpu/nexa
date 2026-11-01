/**
 * Billing › Payment queue and Payment settings against a fake platform API (tm 389.18 ·
 * FR-ADMIN-14). The server's rules — settling, the TXID once, both audit trails, the tenant's
 * side — have their own suite (`platform-payment-ops.test.ts`); here: what each tab shows, which
 * role is offered the actions, what each dialog asks for before it lets the operator confirm,
 * what it sends, and how a refusal is worded.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVOICE_ID } from '../../test/fake-billing.js';
import type { FakePlatform } from '../../test/fake-platform.js';
import { REQUEST_ID, SWIFT_ID, SWIFT_REFERENCE, TRC20_ADDRESS } from '../../test/fake-payments.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

const user = () => userEvent.setup();
const REASON = 'Checked on the chain';

async function open(role: PlatformRole, tab: string): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  renderApp('/billing');
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Billing', level: 1 });
  if (tab !== 'Overview') await user().click(screen.getByRole('tab', { name: tab }));
  return fake;
}

const sent = (fake: FakePlatform, path: string) =>
  fake.requests
    .filter((request) => request.path === path && request.method !== 'GET')
    .map((request) => request.body);

describe('the payment queue', () => {
  it('sends the wallet address once it has the network’s shape, then confirms the TXID', async () => {
    const fake = await open('billing', 'Payment queue');
    const crypto = await screen.findByRole('table', { name: 'Crypto payment requests' });
    expect(within(crypto).getByText('Acme Gaming Ltd')).toBeVisible();
    expect(within(crypto).getByText('$198.00')).toBeVisible();
    expect(within(crypto).getByText('Address requested')).toBeVisible();

    await user().click(
      within(crypto).getByRole('button', { name: 'Send the address to Acme Gaming' }),
    );
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Send the address' });
    await user().type(within(dialog).getByLabelText('Wallet address'), `0x${'ab'.repeat(20)}`);
    await user().type(within(dialog).getByLabelText('Reason'), REASON);
    // An Ethereum address on a TRON request is held back before it is sent.
    expect(confirm).toBeDisabled();
    await user().clear(within(dialog).getByLabelText('Wallet address'));
    await user().type(within(dialog).getByLabelText('Wallet address'), TRC20_ADDRESS);
    expect(confirm).toBeEnabled();
    await user().click(confirm);
    expect(
      await screen.findByText('The address is on the request and the owner has been told.'),
    ).toBeVisible();
    expect(sent(fake, `/billing/payment-requests/${REQUEST_ID}/send-address`)).toEqual([
      { network: 'usdt_trc20', address: TRC20_ADDRESS, reason: REASON },
    ]);

    const table = await screen.findByRole('table', { name: 'Crypto payment requests' });
    expect(await within(table).findByText('Address sent')).toBeVisible();
    await user().click(
      within(table).getByRole('button', { name: 'Confirm the payment of Acme Gaming' }),
    );
    const txidDialog = await screen.findByRole('dialog');
    await user().type(within(txidDialog).getByLabelText('Transaction id (TXID)'), 'f'.repeat(64));
    await user().type(within(txidDialog).getByLabelText('Reason'), REASON);
    await user().click(within(txidDialog).getByRole('button', { name: 'Confirm the payment' }));
    expect(await within(txidDialog).findByRole('alert')).toHaveTextContent(
      'This transaction id is already on another payment.',
    );
    await user().clear(within(txidDialog).getByLabelText('Transaction id (TXID)'));
    await user().type(within(txidDialog).getByLabelText('Transaction id (TXID)'), 'c'.repeat(64));
    await user().click(within(txidDialog).getByRole('button', { name: 'Confirm the payment' }));
    expect(
      await screen.findByText('The payment is confirmed and the subscription is active.'),
    ).toBeVisible();
    expect(sent(fake, `/billing/payment-requests/${REQUEST_ID}/confirm-txid`).at(-1)).toEqual({
      txid: 'c'.repeat(64),
      reason: REASON,
    });
    // Paid is no longer open.
    expect(await screen.findByText('No request in this state.')).toBeVisible();
  });

  it('refuses a request with the reason the owner will read', async () => {
    const fake = await open('superadmin', 'Payment queue');
    const crypto = await screen.findByRole('table', { name: 'Crypto payment requests' });
    await user().click(
      within(crypto).getByRole('button', { name: 'Refuse the request of Acme Gaming' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Reason'), 'Wrong plan for this workspace');
    await user().click(within(dialog).getByRole('button', { name: 'Refuse the request' }));
    expect(await screen.findByText('The request is refused.')).toBeVisible();
    expect(sent(fake, `/billing/payment-requests/${REQUEST_ID}/cancel`)).toEqual([
      { reason: 'Wrong plan for this workspace' },
    ]);
  });

  it('marks a bank transfer paid only with its reference typed back', async () => {
    const fake = await open('billing', 'Payment queue');
    const swift = await screen.findByRole('table', { name: 'Bank transfers' });
    expect(within(swift).getByText(SWIFT_REFERENCE)).toBeVisible();
    await user().click(within(swift).getByRole('button', { name: `Mark ${SWIFT_REFERENCE} paid` }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Mark paid' });
    await user().type(within(dialog).getByLabelText('Reference'), 'ST-0000-0000');
    await user().type(within(dialog).getByLabelText('Reason'), REASON);
    expect(confirm).toBeDisabled();
    await user().clear(within(dialog).getByLabelText('Reference'));
    await user().type(within(dialog).getByLabelText('Reference'), SWIFT_REFERENCE.toLowerCase());
    await user().click(confirm);
    expect(
      await screen.findByText('The transfer is marked paid and the subscription is active.'),
    ).toBeVisible();
    expect(sent(fake, `/billing/swift-payments/${SWIFT_ID}/mark-paid`)).toEqual([
      { reference: SWIFT_REFERENCE.toLowerCase(), reason: REASON },
    ]);
  });

  it('shows support the queues without a single action', async () => {
    await open('support', 'Payment queue');
    const crypto = await screen.findByRole('table', { name: 'Crypto payment requests' });
    const swift = await screen.findByRole('table', { name: 'Bank transfers' });
    expect(within(crypto).queryAllByRole('button')).toEqual([]);
    expect(within(swift).queryAllByRole('button')).toEqual([]);
  });
});

describe('the payment settings', () => {
  it('switches a method off through a reason, and says when cards cannot be offered anyway', async () => {
    const fake = await open('billing', 'Payment settings');
    const swift = await screen.findByLabelText('Bank transfer (SWIFT)');
    expect(swift).toBeChecked();
    expect(
      screen.getByText(
        'The card processor runs on the stand-in here, so no workspace is offered cards whatever this says.',
      ),
    ).toBeVisible();
    const save = within(
      screen.getByRole('heading', { name: 'Payment methods' }).closest('section') as HTMLElement,
    ).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user().click(swift);
    await user().click(save);
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Reason'), 'Bank account closing');
    await user().click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(sent(fake, '/billing/providers')).toEqual([
      { swift_manual: false, crypto_manual: true, stripe: false, reason: 'Bank account closing' },
    ]);
  });

  it('saves the bank account, and words an IBAN the server refuses', async () => {
    const fake = await open('billing', 'Payment settings');
    const bank = (await screen.findByRole('heading', { name: 'Bank account' })).closest(
      'section',
    ) as HTMLElement;
    await user().type(within(bank).getByLabelText('Beneficiary'), 'Example Ltd');
    await user().type(within(bank).getByLabelText('Bank'), 'Example Bank');
    await user().type(within(bank).getByLabelText('IBAN'), 'not an iban');
    await user().type(within(bank).getByLabelText('SWIFT/BIC'), 'EXMPXX00');
    await user().click(within(bank).getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Reason'), 'New account');
    await user().click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That is not an IBAN.');
    // Leaving with a reason typed asks first; the operator says yes.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user().click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user().clear(within(bank).getByLabelText('IBAN'));
    await user().type(within(bank).getByLabelText('IBAN'), 'XX00 TEST 0000 0000 0001');
    await user().click(within(bank).getByRole('button', { name: 'Save' }));
    const again = await screen.findByRole('dialog');
    await user().type(within(again).getByLabelText('Reason'), 'New account');
    await user().click(within(again).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(sent(fake, '/billing/bank-details').at(-1)).toEqual({
      beneficiary: 'Example Ltd',
      bank_name: 'Example Bank',
      iban: 'XX00 TEST 0000 0000 0001',
      swift_bic: 'EXMPXX00',
      bank_address: null,
      reason: 'New account',
    });
    expect(await within(bank).findByDisplayValue('XX00TEST000000000001')).toBeVisible();
  });

  it('saves the issuer with one address line per row', async () => {
    const fake = await open('superadmin', 'Payment settings');
    const issuer = (await screen.findByRole('heading', { name: 'Statement issuer' })).closest(
      'section',
    ) as HTMLElement;
    expect(
      within(issuer).getByText('Not set: statements carry a placeholder issuer until it is.'),
    ).toBeVisible();
    await user().type(within(issuer).getByLabelText('Legal name'), 'Example Software Ltd');
    await user().type(within(issuer).getByLabelText('Country (optional)'), 'tr');
    await user().type(
      within(issuer).getByLabelText('Address'),
      '1 Example Street{Enter}  {Enter}Istanbul',
    );
    await user().click(within(issuer).getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Reason'), 'Company registered');
    await user().click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeVisible();
    expect(sent(fake, '/billing/issuer-profile')).toEqual([
      {
        legal_name: 'Example Software Ltd',
        address_lines: ['1 Example Street', 'Istanbul'],
        country: 'TR',
        tax_office: null,
        tax_id: null,
        vat_id: null,
        email: null,
        tax_note: null,
        reason: 'Company registered',
      },
    ]);
  });

  it('shows support the settings read-only', async () => {
    await open('support', 'Payment settings');
    expect(await screen.findByRole('checkbox', { name: /^Card \(Stripe\)/ })).toBeDisabled();
    expect(screen.getByLabelText('IBAN')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('a statement’s PDF and a refund', () => {
  it('offers the PDF and approves a refund as a credit, at most the statement’s total', async () => {
    const fake = await open('billing', 'Overview');
    const invoices = await screen.findByRole('table', { name: 'Issued statements' });
    expect(
      within(invoices).getByRole('button', { name: 'Download SIYAHTUS-202609 (PDF)' }),
    ).toBeVisible();
    await user().click(
      within(invoices).getByRole('button', { name: 'Approve a refund for SIYAHTUS-202609' }),
    );
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Approve as a credit' });
    await user().type(within(dialog).getByLabelText('Amount (USD)'), '272.01');
    await user().type(within(dialog).getByLabelText('Reason'), 'Annual plan exception');
    expect(confirm).toBeDisabled();
    await user().clear(within(dialog).getByLabelText('Amount (USD)'));
    await user().type(within(dialog).getByLabelText('Amount (USD)'), '99');
    await user().click(confirm);
    expect(
      await screen.findByText('The refund is approved as a credit on the next statement.'),
    ).toBeVisible();
    expect(sent(fake, '/billing/refund-approvals')).toEqual([
      {
        license_id: '42',
        invoice_id: INVOICE_ID,
        amount_minor: 9_900,
        reason: 'Annual plan exception',
      },
    ]);
  });

  it('offers no refund to a role that cannot manage billing', async () => {
    await open('support', 'Overview');
    const invoices = await screen.findByRole('table', { name: 'Issued statements' });
    expect(within(invoices).queryByRole('button', { name: /Approve a refund/ })).toBeNull();
    expect(
      within(invoices).getByRole('button', { name: 'Download SIYAHTUS-202609 (PDF)' }),
    ).toBeVisible();
  });
});
