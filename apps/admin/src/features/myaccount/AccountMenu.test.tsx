/**
 * "My account" against a fake platform API (tm 391 · FR-ADMIN-02): renewing the recovery sheet
 * and the operator's own sessions. The server's rules (the recent-code gate, what a session
 * list leaves out) have their own suite (`platform-auth.test.ts`); here: what the dialogs ask
 * for, what they send, and that the new sheet is held on the one-time page until it is saved.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function open(role: PlatformRole = 'superadmin'): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  renderApp('/');
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
  return fake;
}

async function choose(label: string): Promise<HTMLElement> {
  await user().click(screen.getByRole('button', { name: 'My account' }));
  await user().click(screen.getByRole('button', { name: label }));
  return screen.findByRole('dialog');
}

describe('My account — the menu', () => {
  it.each(['superadmin', 'support', 'billing', 'readonly'] as const)(
    'is open to the %s role',
    async (role) => {
      await open(role);
      await user().click(screen.getByRole('button', { name: 'My account' }));
      expect(screen.getByRole('button', { name: 'Renew recovery codes' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'My sessions' })).toBeVisible();
    },
  );
});

describe('My account — recovery codes', () => {
  it('asks for a fresh code, then shows the new sheet on the one-time page', async () => {
    const fake = await open();
    const dialog = await choose('Renew recovery codes');
    expect(within(dialog).getByText('Unused recovery codes left: 10')).toBeVisible();
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Renew codes' }));

    // The same page that follows enrolment: the new codes, held until they are saved.
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toBeVisible();
    expect(screen.getByText('NEW10-ABCDE')).toBeVisible();
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
    expect(fake.calls('/auth/recovery/regenerate')).toHaveLength(1);
    expect(fake.adminsState.sheets).toBe(1);
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull();

    const next = screen.getByRole('button', { name: 'Continue to the panel' });
    expect(next).toBeDisabled();
    await user().click(screen.getByRole('checkbox'));
    await user().click(next);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    // The sheet is gone from memory: renewing again shows a different one, not this one.
    expect(screen.queryByText('NEW10-ABCDE')).toBeNull();
  });

  it('says so when the code is wrong and renews nothing', async () => {
    const fake = await open();
    const dialog = await choose('Renew recovery codes');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '654321');
    await user().click(within(dialog).getByRole('button', { name: 'Renew codes' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That code did not work.');
    expect(fake.calls('/auth/recovery/regenerate')).toHaveLength(0);
  });

  it('does not send a code that is too short', async () => {
    const fake = await open();
    const dialog = await choose('Renew recovery codes');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123');
    await user().click(within(dialog).getByRole('button', { name: 'Renew codes' }));
    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(0);
  });
});

describe('My account — sessions', () => {
  it('lists the sessions with the current one marked', async () => {
    await open();
    const dialog = await choose('My sessions');
    const table = await within(dialog).findByRole('table', { name: 'My sessions' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('This session')).toBeVisible();
    expect(within(rows[1]!).getByText('198.51.100.4')).toBeVisible();
    expect(within(rows[2]!).getByText('Safari on macOS')).toBeVisible();
    expect(within(rows[2]!).queryByText('This session')).toBeNull();
  });

  it('ends every other session and says how many', async () => {
    const fake = await open();
    const dialog = await choose('My sessions');
    await within(dialog).findByRole('table', { name: 'My sessions' });
    await user().click(within(dialog).getByRole('button', { name: 'Sign out all other sessions' }));

    expect(await within(dialog).findByText('Other sessions ended: 1.')).toBeVisible();
    expect(
      fake.requests.filter((r) => r.method === 'DELETE' && r.path === '/auth/sessions'),
    ).toHaveLength(1);
    await vi.waitFor(() =>
      expect(
        within(within(dialog).getByRole('table', { name: 'My sessions' })).getAllByRole('row'),
      ).toHaveLength(2),
    );
    expect(
      within(dialog).getByRole('button', { name: 'Sign out all other sessions' }),
    ).toBeDisabled();
  });
});
