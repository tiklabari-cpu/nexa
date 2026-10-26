/**
 * The account pages against a fake platform API (tm 389.11 · FR-ADMIN-11). The server's rules,
 * both audit trails and the tenant-side effects have their own suite
 * (`platform-accounts.test.ts`); here: the search, the detail, what the menu offers each role,
 * what each dialog asks for before it lets the operator confirm, and what it sends.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_ID } from '../../test/fake-accounts.js';
import type { FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

const user = () => userEvent.setup();

async function open(
  path: string,
  heading: string,
  options: { role?: PlatformRole; accountSoleOwner?: boolean } = {},
): Promise<FakePlatform> {
  const fake = installFakePlatform({ role: options.role ?? 'superadmin', ...options });
  renderApp(path);
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: heading });
  return fake;
}

async function menuItems(): Promise<string[]> {
  await user().click(screen.getByRole('button', { name: 'Actions' }));
  const items = screen
    .getAllByRole('button')
    .filter((button) => button.closest('details') !== null && button.tagName === 'BUTTON')
    .map((button) => button.textContent ?? '');
  await user().keyboard('{Escape}');
  return items;
}

async function choose(label: string): Promise<HTMLElement> {
  await user().click(screen.getByRole('button', { name: 'Actions' }));
  await user().click(screen.getByRole('button', { name: label }));
  return screen.findByRole('dialog');
}

const sent = (fake: FakePlatform, path: string) =>
  fake.requests
    .filter((request) => request.path === path && request.method !== 'GET')
    .map((request) => request.body);

describe('the account search', () => {
  it('lists accounts, searches on submit, and loads the next page', async () => {
    const fake = await open('/accounts', 'Accounts');
    expect(await screen.findByRole('link', { name: 'Lead Person' })).toHaveAttribute(
      'href',
      `/accounts/${ACCOUNT_ID}`,
    );
    await user().click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Zed' })).toBeVisible();

    await user().type(screen.getByLabelText('Search'), 'nobody');
    expect(fake.requests.some((r) => r.path === '/accounts' && r.method === 'GET')).toBe(true);
    await user().click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No account matches.')).toBeVisible();
  });
});

describe('one account', () => {
  it('shows the profile, the second factor and every membership with a link to its workspace', async () => {
    await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person');
    expect(screen.getByText('On · 8 recovery codes left')).toBeVisible();
    expect(screen.getByText('Not verified')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Acme Gaming' })).toHaveAttribute(
      'href',
      '/workspaces/42',
    );
    expect(screen.getByRole('link', { name: 'Beta Casino' })).toHaveAttribute(
      'href',
      '/workspaces/9',
    );
    expect(screen.getByText('Team Lead')).toBeVisible();
  });

  it('offers each role what it may do', async () => {
    await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person');
    expect(await menuItems()).toEqual([
      'Resend verification email',
      'Force a password reset',
      'Sign out everywhere',
      'Revoke all tokens',
      'Reset two-factor authentication',
      'Suspend account',
      'Export account data',
      'Erase account',
    ]);
  });

  it('offers support the desk’s actions only', async () => {
    await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person', { role: 'support' });
    expect(await menuItems()).toEqual([
      'Resend verification email',
      'Force a password reset',
      'Sign out everywhere',
      'Revoke all tokens',
    ]);
  });

  it('shows readonly no menu', async () => {
    await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person', { role: 'readonly' });
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('suspends with a reason, shows the banner and offers to lift it', async () => {
    const fake = await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person');
    const dialog = await choose('Suspend account');
    await user().type(within(dialog).getByLabelText('Reason'), 'Account takeover suspected');
    await user().click(within(dialog).getByRole('button', { name: 'Suspend' }));

    expect(await screen.findByText('Suspend account: done.')).toBeVisible();
    expect(sent(fake, `/accounts/${ACCOUNT_ID}/suspend`)).toEqual([
      { reason: 'Account takeover suspected' },
    ]);
    expect(screen.getByText('This account is suspended')).toBeVisible();
    expect(screen.getByText(/Reason: Account takeover suspected/)).toBeVisible();
    const items = await menuItems();
    expect(items).toContain('Lift suspension');
    expect(items).not.toContain('Suspend account');
  });

  it('asks for a fresh code to reset the second factor', async () => {
    const fake = await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person');
    const dialog = await choose('Reset two-factor authentication');
    await user().type(within(dialog).getByLabelText('Reason'), 'Lost phone, identity checked');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Reset 2FA' }));
    expect(await screen.findByText('Reset two-factor authentication: done.')).toBeVisible();
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
    expect(screen.getByText('Off')).toBeVisible();
  });

  it('says so when the reset mail could not be sent', async () => {
    await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person');
    const dialog = await choose('Force a password reset');
    await user().type(within(dialog).getByLabelText('Reason'), 'Credential leak reported');
    await user().click(within(dialog).getByRole('button', { name: 'Reset password' }));
    expect(
      await screen.findByText('Force a password reset: done, but the email could not be sent.'),
    ).toBeVisible();
  });

  it('holds the erasure until the address is typed, and words the Founder refusal', async () => {
    const fake = await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person', { accountSoleOwner: true });
    const dialog = await choose('Erase account');
    const confirm = within(dialog).getByRole('button', { name: 'Erase' });
    await user().type(within(dialog).getByLabelText('Reason'), 'GDPR erasure request');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    const field = within(dialog).getByLabelText('Type the email address to confirm');
    await user().type(field, 'lead@acme');
    expect(confirm).toBeDisabled();
    await user().type(field, '.example');
    expect(confirm).toBeEnabled();
    await user().click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This person is the Founder of a workspace.',
    );
    expect(sent(fake, `/accounts/${ACCOUNT_ID}/erase`)).toEqual([
      { confirm_email: 'lead@acme.example', reason: 'GDPR erasure request' },
    ]);
  });

  it('erases and says so', async () => {
    await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person');
    const dialog = await choose('Erase account');
    await user().type(within(dialog).getByLabelText('Reason'), 'GDPR erasure request');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().type(
      within(dialog).getByLabelText('Type the email address to confirm'),
      'lead@acme.example',
    );
    await user().click(within(dialog).getByRole('button', { name: 'Erase' }));
    expect(await screen.findByText('The account was erased.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to accounts' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });

  it('exports with a reason', async () => {
    const fake = await open(`/accounts/${ACCOUNT_ID}`, 'Lead Person');
    const dialog = await choose('Export account data');
    await user().type(within(dialog).getByLabelText('Reason'), 'Subject access request');
    await user().click(within(dialog).getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Export account data: done.')).toBeVisible();
    expect(sent(fake, `/accounts/${ACCOUNT_ID}/export`)).toEqual([
      { reason: 'Subject access request' },
    ]);
  });

  it('says an unknown account does not exist', async () => {
    installFakePlatform({ role: 'superadmin' });
    renderApp('/accounts/00000000-0000-4000-8000-000000000999');
    await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
    await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user().click(screen.getByRole('button', { name: 'Continue' }));
    await user().type(await screen.findByLabelText('Authenticator code'), '123456');
    await user().click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('No such account')).toBeVisible();
  });
});
