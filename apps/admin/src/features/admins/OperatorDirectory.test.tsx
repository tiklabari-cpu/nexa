/**
 * The operator directory against a fake platform API (tm 391 · FR-ADMIN-04). The server's rules
 * (who may manage, the last superadmin, the invitation token, the mail) have their own suite
 * (`platform-admins.test.ts`); here: what the page shows each role, what each action asks for
 * before it lets the operator confirm, what it sends, and how a refusal reads.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAV_ITEMS } from '../../lib/navigation.js';
import { OTHER_ID } from '../../test/fake-admins.js';
import type { FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

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
  await screen.findByRole('table', { name: 'Operators' });
  return fake;
}

// Every row has its own menu, and jsdom applies no stylesheet, so a closed menu's items are
// "visible" too: look inside the row's own menu only.
async function menuOf(email: string): Promise<string[]> {
  const trigger = screen.getByRole('button', { name: `Actions for ${email}` });
  await user().click(trigger);
  const items = within(trigger.closest('details')!)
    .getAllByRole('button')
    .filter((button) => button.tagName === 'BUTTON')
    .map((button) => button.textContent ?? '');
  await user().keyboard('{Escape}');
  return items;
}

async function choose(email: string, label: string): Promise<HTMLElement> {
  const trigger = screen.getByRole('button', { name: `Actions for ${email}` });
  await user().click(trigger);
  await user().click(within(trigger.closest('details')!).getByRole('button', { name: label }));
  return screen.findByRole('dialog');
}

const sent = (fake: FakePlatform, path: string) =>
  fake.requests
    .filter((request) => request.path === path && request.method !== 'GET')
    .map((request) => request.body);

describe('Admins — the directory', () => {
  it('lists the operators with their role, state, authenticator and sessions', async () => {
    await open();
    const table = screen.getByRole('table', { name: 'Operators' });
    const rows = within(table).getAllByRole('row');
    // header + three operators
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getByText('ops@example.com')).toBeVisible();
    expect(within(rows[1]!).getByText('(you)')).toBeVisible();
    expect(within(rows[1]!).getByText('Superadmin')).toBeVisible();
    expect(within(rows[2]!).getByText('second@example.com')).toBeVisible();
    expect(within(rows[2]!).getByText('Support')).toBeVisible();
    expect(within(rows[2]!).getByText('Active')).toBeVisible();
    expect(within(rows[3]!).getByText(/^Disabled /)).toBeVisible();
    expect(within(rows[3]!).getByText('Not set up yet')).toBeVisible();
    expect(within(rows[3]!).getByText('Never')).toBeVisible();
  });

  it('lists the pending invitations with who invited them', async () => {
    await open();
    const table = await screen.findByRole('table', { name: 'Pending invitations' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('newcomer@example.com')).toBeVisible();
    expect(within(row).getByText('Billing')).toBeVisible();
    expect(within(row).getByText('ops@example.com')).toBeVisible();
  });

  it('offers each row the actions its state allows', async () => {
    await open();
    expect(await menuOf('second@example.com')).toEqual([
      'Change role',
      'Disable',
      'Reset authenticator',
      'End sessions',
    ]);
    // Disabled, no authenticator, no session: only the role and the way back in.
    expect(await menuOf('gone@example.com')).toEqual(['Change role', 'Enable']);
  });

  it('shows a read-only role the lists and no buttons', async () => {
    await open('support');
    expect(screen.getByRole('table', { name: 'Operators' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Invite an operator' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for / })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Revoke the invitation/ })).toBeNull();
  });
});

describe('Admins — inviting', () => {
  it('holds Send until the address is plausible, then sends it with the role, the reason and a fresh code', async () => {
    const fake = await open();
    await user().click(screen.getByRole('button', { name: 'Invite an operator' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send invitation' });
    expect(send).toBeDisabled();
    await user().type(within(dialog).getByLabelText('Email address'), 'New.Person@Example.com');
    await user().selectOptions(within(dialog).getByLabelText('Role'), 'billing');
    await user().type(within(dialog).getByLabelText('Reason'), 'Joins the finance rota');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    expect(send).toBeEnabled();
    await user().click(send);

    expect(await screen.findByText('Invitation sent to New.Person@Example.com.')).toBeVisible();
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
    expect(sent(fake, '/admins/invites')).toEqual([
      { email: 'New.Person@Example.com', role: 'billing', reason: 'Joins the finance rota' },
    ]);
    // The pending list was read again and now carries the invitation.
    const table = await screen.findByRole('table', { name: 'Pending invitations' });
    expect(await within(table).findByText('new.person@example.com')).toBeVisible();
  });

  it('hands the link over when the mail did not go', async () => {
    const fake = await open();
    fake.adminsState.mailFails = true;
    await user().click(screen.getByRole('button', { name: 'Invite an operator' }));
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Email address'), 'late@example.com');
    await user().type(within(dialog).getByLabelText('Reason'), 'Joins the support rota');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText(/could not be sent/)).toBeVisible();
    expect(screen.getByText('https://admin.test/invite#token=abc123')).toBeVisible();
  });

  it('says so when the address already belongs to an operator', async () => {
    await open();
    await user().click(screen.getByRole('button', { name: 'Invite an operator' }));
    const dialog = await screen.findByRole('dialog');
    await user().type(within(dialog).getByLabelText('Email address'), 'second@example.com');
    await user().type(within(dialog).getByLabelText('Reason'), 'Joins the support rota');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That email address already has an account.',
    );
  });

  it('revokes a pending invitation with a reason and no code', async () => {
    const fake = await open();
    await user().click(
      await screen.findByRole('button', { name: 'Revoke the invitation for newcomer@example.com' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Authenticator code')).toBeNull();
    await user().type(within(dialog).getByLabelText('Reason'), 'Wrong address');
    await user().click(within(dialog).getByRole('button', { name: 'Revoke invitation' }));
    expect(
      await screen.findByText('The invitation for newcomer@example.com was revoked.'),
    ).toBeVisible();
    expect(await screen.findByText('No invitation is waiting.')).toBeVisible();
    expect(fake.adminsState.invites).toEqual([]);
  });
});

describe('Admins — acting on an operator', () => {
  it('holds a role change until the role differs, then sends it with a fresh code', async () => {
    const fake = await open();
    const dialog = await choose('second@example.com', 'Change role');
    const confirm = within(dialog).getByRole('button', { name: 'Change role' });
    expect(confirm).toBeDisabled();
    await user().selectOptions(within(dialog).getByLabelText('Role'), 'readonly');
    await user().type(within(dialog).getByLabelText('Reason'), 'Moved to the audit desk');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(confirm);

    expect(await screen.findByText('second@example.com is now Read-only.')).toBeVisible();
    expect(sent(fake, `/admins/${OTHER_ID}/role`)).toEqual([
      { role: 'readonly', reason: 'Moved to the audit desk' },
    ]);
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
    const row = within(screen.getByRole('table', { name: 'Operators' }))
      .getByText('second@example.com')
      .closest('tr')!;
    expect(await within(row).findByText('Read-only')).toBeVisible();
  });

  it('disables an operator, and enables them again', async () => {
    const fake = await open();
    let dialog = await choose('second@example.com', 'Disable');
    await user().type(within(dialog).getByLabelText('Reason'), 'Left the company');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Disable' }));
    expect(await screen.findByText('second@example.com was disabled.')).toBeVisible();
    expect(sent(fake, `/admins/${OTHER_ID}/disable`)).toEqual([{ reason: 'Left the company' }]);
    expect(await menuOf('second@example.com')).toContain('Enable');

    dialog = await choose('second@example.com', 'Enable');
    await user().type(within(dialog).getByLabelText('Reason'), 'Came back');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText('second@example.com was enabled.')).toBeVisible();
    expect(sent(fake, `/admins/${OTHER_ID}/enable`)).toEqual([{ reason: 'Came back' }]);
  });

  it('holds an authenticator reset until the identity check is ticked', async () => {
    const fake = await open();
    const dialog = await choose('second@example.com', 'Reset authenticator');
    const confirm = within(dialog).getByRole('button', { name: 'Reset authenticator' });
    await user().type(within(dialog).getByLabelText('Reason'), 'Lost phone, called back');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    expect(confirm).toBeDisabled();
    await user().click(within(dialog).getByRole('checkbox', { name: /this really is/ }));
    expect(confirm).toBeEnabled();
    await user().click(confirm);

    expect(
      await screen.findByText('The authenticator of second@example.com was reset.'),
    ).toBeVisible();
    expect(sent(fake, `/admins/${OTHER_ID}/reset-two-factor`)).toEqual([
      { reason: 'Lost phone, called back' },
    ]);
  });

  it('ends an operator’s sessions with a reason and no code, and counts them', async () => {
    const fake = await open();
    const dialog = await choose('second@example.com', 'End sessions');
    expect(within(dialog).queryByLabelText('Authenticator code')).toBeNull();
    await user().type(within(dialog).getByLabelText('Reason'), 'Laptop lost');
    await user().click(within(dialog).getByRole('button', { name: 'End sessions' }));
    expect(
      await screen.findByText('The sessions of second@example.com ended. Sessions ended: 1.'),
    ).toBeVisible();
    expect(sent(fake, `/admins/${OTHER_ID}/revoke-sessions`)).toEqual([{ reason: 'Laptop lost' }]);
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(0);
  });

  it('words the refusal to remove the last superadmin', async () => {
    // The signed-in operator is the only active superadmin: disabling them would leave none.
    await open();
    const dialog = await choose('ops@example.com', 'Disable');
    await user().type(within(dialog).getByLabelText('Reason'), 'Testing the guard');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Disable' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This is the last active superadmin, and the platform needs one.',
    );
    // Nothing changed on the page behind it.
    expect(
      within(screen.getByRole('table', { name: 'Operators' })).queryByText(/^Disabled 2026-/),
    ).toBeNull();
  });

  it('keeps the last superadmin from being moved to another role', async () => {
    await open();
    const dialog = await choose('ops@example.com', 'Change role');
    await user().selectOptions(within(dialog).getByLabelText('Role'), 'support');
    await user().type(within(dialog).getByLabelText('Reason'), 'Testing the guard');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Change role' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('last active superadmin');
  });
});
