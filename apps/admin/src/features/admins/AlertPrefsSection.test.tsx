/**
 * The alert preferences against a fake platform API (tm 389.20 · FR-ADMIN-24). The server's rules —
 * who is mailed what, the closed list, the language — have their own suite (`platform-alerts.test.ts`);
 * here: what the form shows each role, what it sends, and that it holds Save until something changed.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';
import { NAV_ITEMS } from '../../lib/navigation.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

// The page address, taken from the menu table: a literal page path would read as an API call to
// the endpoint-ui audit.
const ADMINS_PATH = NAV_ITEMS.find((item) => item.id === 'admins')!.path;

const user = () => userEvent.setup();

async function open(role: PlatformRole = 'superadmin'): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  renderApp(ADMINS_PATH);
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Admins' });
  return fake;
}

const sent = (fake: FakePlatform) =>
  fake.requests.filter((r) => r.method === 'PUT' && r.path === '/auth/me/alert-prefs');

describe('Admins — alert preferences', () => {
  it('shows a superadmin every alert ticked and says the choice is not final yet', async () => {
    await open();
    const form = await screen.findByRole('form', { name: 'Alert e-mails' });
    expect(within(form).getAllByRole('checkbox')).toHaveLength(6);
    for (const box of within(form).getAllByRole('checkbox')) expect(box).toBeChecked();
    expect(screen.getByText(/You have not chosen yet: superadmins get every alert/)).toBeVisible();
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the other roles nothing ticked', async () => {
    await open('support');
    const form = await screen.findByRole('form', { name: 'Alert e-mails' });
    for (const box of within(form).getAllByRole('checkbox')) expect(box).not.toBeChecked();
  });

  it('sends the ticked kinds in list order and the language, with no reason', async () => {
    const fake = await open('support');
    const form = await screen.findByRole('form', { name: 'Alert e-mails' });
    await user().click(within(form).getByLabelText('The health check turns red'));
    await user().click(within(form).getByLabelText('A trial ends within 3 days'));
    await user().selectOptions(within(form).getByLabelText('Language of the e-mails'), 'tr');
    await user().click(within(form).getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(sent(fake)).toHaveLength(1));
    expect(sent(fake)[0]!.body).toEqual({ kinds: ['trial_ending', 'health_red'], locale: 'tr' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // The saved choice is what the form now reads, and the "not chosen yet" line is gone.
    await vi.waitFor(() => expect(screen.queryByText(/You have not chosen yet/)).toBeNull());
    const after = screen.getByRole('form', { name: 'Alert e-mails' });
    expect(within(after).getByLabelText('A trial ends within 3 days')).toBeChecked();
    expect(within(after).getByLabelText('The health check turns red')).toBeChecked();
    expect(within(after).getByLabelText('The audit chain no longer verifies')).not.toBeChecked();
    expect(within(after).getByLabelText('Language of the e-mails')).toHaveValue('tr');
    expect(within(after).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('lets an operator turn every alert off', async () => {
    const fake = await open();
    const form = await screen.findByRole('form', { name: 'Alert e-mails' });
    for (const box of within(form).getAllByRole('checkbox')) await user().click(box);
    await user().click(within(form).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(sent(fake)).toHaveLength(1));
    expect(sent(fake)[0]!.body).toEqual({ kinds: [], locale: 'en' });
  });
});
