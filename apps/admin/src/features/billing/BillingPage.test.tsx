/**
 * The Billing page against a fake platform API (tm 389.12 · FR-ADMIN-12). The server's rules,
 * the period close and both audit trails have their own suite (`platform-billing-usage.test.ts`);
 * here: what each section shows, which role is offered the writes, what each dialog asks for
 * before it lets the operator confirm, and what it sends.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVOICE_ID } from '../../test/fake-billing.js';
import type { FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';
import { parseAmount } from './BillingPage.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

const user = () => userEvent.setup();

async function open(role: PlatformRole = 'billing'): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  renderApp('/billing');
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Billing', level: 1 });
  return fake;
}

const sent = (fake: FakePlatform, path: string) =>
  fake.requests
    .filter((request) => request.path === path && request.method !== 'GET')
    .map((request) => request.body);

const section = (name: string) =>
  screen.getByRole('heading', { name, level: 2 }).closest('section') as HTMLElement;

describe('the billing page', () => {
  it('shows revenue by month with the open period apart, and the credits not yet applied', async () => {
    await open();
    const revenue = await screen.findByRole('table', { name: 'Revenue by month' });
    expect(within(revenue).getByText('September 2026')).toBeVisible();
    expect(within(revenue).getByText('$866.00')).toBeVisible();
    expect(screen.getByText('Bought so far in October 2026')).toBeVisible();
    expect(screen.getByText('$134.98')).toBeVisible();
    expect(screen.getByText('$25.00 (1 not yet applied)')).toBeVisible();
  });

  it('lists subscriptions, filters past due, and loads the next page', async () => {
    await open('readonly');
    const subscriptions = section('Subscriptions');
    expect(await within(subscriptions).findByRole('link', { name: 'Acme Gaming' })).toHaveAttribute(
      'href',
      '/workspaces/42',
    );
    await user().click(within(subscriptions).getByRole('button', { name: 'Load more' }));
    expect(await within(subscriptions).findByRole('link', { name: 'Beta Casino' })).toBeVisible();

    await user().click(within(subscriptions).getByLabelText('Past due only'));
    await within(subscriptions).findByRole('link', { name: 'Beta Casino' });
    expect(within(subscriptions).queryByRole('link', { name: 'Acme Gaming' })).toBeNull();
  });

  it('downloads an issued statement and shows the credit taken off it', async () => {
    const fake = await open('support');
    const invoices = section('Issued statements');
    expect(await within(invoices).findByText('SIYAHTUS-202609')).toBeVisible();
    expect(within(invoices).getByText('$25.00')).toBeVisible();
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    // jsdom cannot follow the download link's navigation.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user().click(
      within(invoices).getByRole('button', { name: 'Download SIYAHTUS-202609 (CSV)' }),
    );
    expect(fake.calls(`/billing/invoices/${INVOICE_ID}/download`)).toHaveLength(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('offers the writes to billing only, never to support or readonly', async () => {
    await open('support');
    await screen.findByRole('table', { name: 'Revenue by month' });
    expect(screen.queryByRole('button', { name: 'Grant credit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Subscribe by hand' })).toBeNull();
  });

  it('grants a credit in cents once the licence and amount are valid, and lists it', async () => {
    const fake = await open('billing');
    await user().click(screen.getByRole('button', { name: 'Grant credit' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Grant credit' });
    await user().type(within(dialog).getByLabelText('Licence number'), '42');
    await user().type(within(dialog).getByLabelText('Amount (USD)'), '12.5x');
    await user().type(within(dialog).getByLabelText('Reason'), 'Outage on 3 October');
    expect(confirm).toBeDisabled();
    await user().clear(within(dialog).getByLabelText('Amount (USD)'));
    await user().type(within(dialog).getByLabelText('Amount (USD)'), '12.50');
    expect(confirm).toBeEnabled();
    await user().click(confirm);
    expect(
      await screen.findByText('The credit was granted. It applies when the period closes.'),
    ).toBeVisible();
    expect(sent(fake, '/billing/credits')).toEqual([
      { license_id: '42', amount_minor: 1_250, currency: 'USD', reason: 'Outage on 3 October' },
    ]);
    expect(await within(section('Credits')).findByText('$12.50')).toBeVisible();
  });

  it('subscribes by hand to the end of the chosen day, and words a refusal precisely', async () => {
    const fake = await open('billing');
    await user().click(screen.getByRole('button', { name: 'Subscribe by hand' }));
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Licence number'), '7');
    await user().selectOptions(within(dialog).getByLabelText('Plan'), 'enterprise');
    await user().type(within(dialog).getByLabelText('Paid until'), '2027-01-31');
    await user().type(within(dialog).getByLabelText('Reason'), 'SWIFT transfer confirmed');
    await user().click(within(dialog).getByRole('button', { name: 'Subscribe' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No workspace has that licence number.',
    );

    await user().clear(within(dialog).getByLabelText('Licence number'));
    await user().type(within(dialog).getByLabelText('Licence number'), '42');
    await user().click(within(dialog).getByRole('button', { name: 'Subscribe' }));
    expect(await screen.findByText('The workspace is subscribed.')).toBeVisible();
    expect(sent(fake, '/billing/manual-subscription').at(-1)).toEqual({
      license_id: '42',
      plan: 'enterprise',
      period_end: '2027-01-31T23:59:59.000Z',
      reason: 'SWIFT transfer confirmed',
    });
  });

  it('shows the plans with their daily AI allowance and this period’s package sales', async () => {
    await open('readonly');
    const plans = await screen.findByRole('table', { name: 'Plans and packages' });
    expect(within(plans).getByText('Quoted')).toBeVisible();
    expect(within(plans).getAllByText('Deployment default').length).toBeGreaterThan(0);
    const packages = await screen.findByRole('table', { name: 'Packages on sale' });
    expect(within(packages).getByText('API package Essential — 100,000 calls')).toBeVisible();
    expect(within(packages).getByText('$59.98')).toBeVisible();
  });
});

describe('parseAmount', () => {
  it('reads dollars and cents, and refuses anything else', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('50')).toBe(5_000);
    expect(parseAmount('12.5')).toBe(1_250);
    expect(parseAmount('12,05')).toBe(1_205);
    expect(parseAmount('0')).toBeNaN();
    expect(parseAmount('1.234')).toBeNaN();
    expect(parseAmount('-5')).toBeNaN();
  });
});
