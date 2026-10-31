/**
 * The workspace actions against a fake platform API (tm 389.10 · FR-ADMIN-09). The server's
 * rules, both audit trails and the tenant-side effects have their own suite
 * (`platform-workspace-actions.test.ts`); here: what the menu offers, what each dialog asks for
 * before it lets the operator confirm, what it sends, and how the page shows the answer.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, WORKSPACE_ID, type FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';
import { daysUntil } from './WorkspaceActions.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

async function open(path: string, role: PlatformRole = 'superadmin'): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  const user = userEvent.setup();
  renderApp(path);
  await user.type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Acme Gaming' });
  return fake;
}

const user = () => userEvent.setup();

/** The menu's items, as the operator sees them. */
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

describe('the actions menu', () => {
  it('offers a superadmin what the workspace’s state allows', async () => {
    await open(`/workspaces/${WORKSPACE_ID}`);
    const items = await menuItems();
    expect(items).toEqual([
      'Extend trial',
      'Activate licence',
      'Change plan',
      'Overrides',
      'Reset sandbox',
      'Make read-only',
      'Cancel subscription',
      'Resume subscription',
      'Suspend',
      'Transfer ownership',
      'Delete workspace',
    ]);
  });

  it('offers support its own actions only', async () => {
    await open(`/workspaces/${WORKSPACE_ID}`, 'support');
    expect(await menuItems()).toEqual(['Extend trial', 'Reset sandbox']);
  });

  it('offers a read-only operator none', async () => {
    await open(`/workspaces/${WORKSPACE_ID}`, 'readonly');
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });
});

describe('the dialogs', () => {
  it('suspends with a reason and a fresh code, then shows the banner and offers to lift it', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}`);
    const dialog = await choose('Suspend');
    expect(within(dialog).getByLabelText('Authenticator code')).toBeVisible();
    await user().type(within(dialog).getByLabelText('Reason'), 'Chargeback investigation');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().click(within(dialog).getByRole('button', { name: 'Suspend' }));

    expect(await screen.findByText('Suspend: done.')).toBeVisible();
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
    expect(sent(fake, `/workspaces/${WORKSPACE_ID}/suspend`)).toEqual([
      { reason: 'Chargeback investigation' },
    ]);
    expect(screen.getByText('Suspended', { selector: 'strong, p, span, div' })).toBeVisible();
    expect(screen.getByText(/Reason: Chargeback investigation/)).toBeVisible();
    const items = await menuItems();
    expect(items).toContain('Lift suspension');
    expect(items).not.toContain('Suspend');
  });

  it('holds the deletion until the name is typed, then counts the days down and lets it be cancelled', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}`);
    const dialog = await choose('Delete workspace');
    const confirm = within(dialog).getByRole('button', { name: 'Schedule deletion' });
    await user().type(within(dialog).getByLabelText('Reason'), 'Owner asked to close it');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    await user().type(within(dialog).getByLabelText('Workspace name'), 'Acme');
    expect(confirm).toBeDisabled();
    await user().type(within(dialog).getByLabelText('Workspace name'), ' Gaming');
    expect(confirm).toBeEnabled();
    await user().click(confirm);

    expect(await screen.findByText('Scheduled for deletion')).toBeVisible();
    expect(sent(fake, `/workspaces/${WORKSPACE_ID}/delete`)).toEqual([
      { confirm_name: 'Acme Gaming', reason: 'Owner asked to close it' },
    ]);
    expect(
      screen.getByText(new RegExp(`Days left: ${daysUntil('2026-11-08T10:00:00.000Z')}`)),
    ).toBeVisible();

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Scheduled for deletion');
    await user().click(within(banner).getByRole('button', { name: 'Cancel deletion' }));
    const cancel = await screen.findByRole('dialog');
    await user().type(within(cancel).getByLabelText('Reason'), 'Owner changed their mind');
    await user().click(within(cancel).getByRole('button', { name: 'Cancel deletion' }));
    expect(await screen.findByText('Cancel deletion: done.')).toBeVisible();
    expect(screen.queryByText('Scheduled for deletion')).not.toBeInTheDocument();
    // Still suspended: lifting that is its own decision.
    expect(await menuItems()).toContain('Lift suspension');
  });

  it('extends the trial by the days typed, between 1 and 90', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}`);
    const dialog = await choose('Extend trial');
    const days = within(dialog).getByLabelText('Days to add');
    const confirm = within(dialog).getByRole('button', { name: 'Extend' });
    await user().type(within(dialog).getByLabelText('Reason'), 'Asked for more time');
    await user().clear(days);
    await user().type(days, '91');
    expect(confirm).toBeDisabled();
    await user().clear(days);
    await user().type(days, '10');
    await user().click(confirm);
    expect(await screen.findByText('Extend trial: done.')).toBeVisible();
    expect(sent(fake, `/workspaces/${WORKSPACE_ID}/extend-trial`)).toEqual([
      { days: 10, reason: 'Asked for more time' },
    ]);
  });

  it('transfers ownership only with a member chosen and every identity check done', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}`);
    const dialog = await choose('Transfer ownership');
    const confirm = within(dialog).getByRole('button', { name: 'Transfer ownership' });
    await user().type(within(dialog).getByLabelText('Reason'), 'Owner left the company');
    await user().type(within(dialog).getByLabelText('Authenticator code'), '123456');
    const select = within(dialog).getByLabelText('New owner');
    await within(select).findByRole('option', { name: /Lead Person/ });
    // The owner is not offered.
    expect(within(select).queryByRole('option', { name: /Ayşe Kurucu/ })).not.toBeInTheDocument();
    await user().selectOptions(select, '00000000-0000-4000-8000-0000000000b2');
    await user().type(within(dialog).getByLabelText('Support ticket'), 'SUP-77');
    await user().click(
      within(dialog).getByLabelText('A signed request from the organization is on file'),
    );
    expect(confirm).toBeDisabled();
    await user().click(
      within(dialog).getByLabelText(
        'I called the requester back on a number the workspace already had',
      ),
    );
    expect(confirm).toBeEnabled();
    await user().click(confirm);
    expect(await screen.findByText('Transfer ownership: done.')).toBeVisible();
    expect(sent(fake, `/workspaces/${WORKSPACE_ID}/force-ownership-transfer`)).toEqual([
      {
        to_account_id: '00000000-0000-4000-8000-0000000000b2',
        verification_checklist: { ticket_id: 'SUP-77', signed_request: true, phone_verified: true },
        reason: 'Owner left the company',
      },
    ]);
  });

  it('saves the override row it shows, and says so when nothing changed', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}`);
    const dialog = await choose('Overrides');
    const seats = await within(dialog).findByLabelText('Seat ceiling');
    await user().type(seats, '5');
    await user().selectOptions(within(dialog).getByLabelText('Single sign-on'), 'on');
    await user().type(within(dialog).getByLabelText('Reason'), 'Signed an SSO contract');
    await user().click(within(dialog).getByRole('button', { name: 'Save overrides' }));
    expect(await screen.findByText('Overrides: done.')).toBeVisible();
    expect(sent(fake, `/workspaces/${WORKSPACE_ID}/overrides`)).toEqual([
      {
        entitlements: { sso: true },
        seat_ceiling: 5,
        mail_daily_cap: null,
        expires_at: null,
        reason: 'Signed an SSO contract',
      },
    ]);

    for (const round of [1, 2]) {
      const cancel = await choose('Cancel subscription');
      await user().type(within(cancel).getByLabelText('Reason'), `Round ${round} of the cancel`);
      await user().click(within(cancel).getByRole('button', { name: 'Cancel subscription' }));
    }
    expect(
      await screen.findByText(
        'Cancel subscription: nothing changed — the workspace was already in that state.',
      ),
    ).toBeVisible();
  });

  it('words a refusal by the state that caused it, and keeps the dialog open', async () => {
    await open(`/workspaces/${WORKSPACE_ID}`);
    const dialog = await choose('Reset sandbox');
    await user().type(within(dialog).getByLabelText('Reason'), 'Customer asked for a reset');
    await user().click(within(dialog).getByRole('button', { name: 'Reset' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The workspace has no sandbox.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});

describe('the purge queue', () => {
  it('lists the scheduled deletions above the workspace list', async () => {
    const fake = installFakePlatform();
    fake.override('GET', '/workspaces/purge-queue', () =>
      json(200, {
        data: [
          {
            license_id: '9',
            organization_name: 'Beta Casino',
            status: 'suspended',
            suspended_at: '2026-10-25T10:00:00.000Z',
            purge_scheduled_at: '2026-11-08T10:00:00.000Z',
          },
        ],
      }),
    );
    renderApp('/workspaces');
    await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
    await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user().click(screen.getByRole('button', { name: 'Continue' }));
    await user().type(await screen.findByLabelText('Authenticator code'), '123456');
    await user().click(screen.getByRole('button', { name: 'Verify' }));
    const table = await screen.findByRole('table', { name: 'Scheduled deletions' });
    expect(within(table).getByRole('link', { name: 'Beta Casino' })).toHaveAttribute(
      'href',
      '/workspaces/9',
    );
    // More than one cell can read the same number (the licence id is 9 too).
    expect(
      within(table).getAllByText(String(daysUntil('2026-11-08T10:00:00.000Z'))).length,
    ).toBeGreaterThan(0);
  });

  it('counts whole days, never below zero', () => {
    const now = Date.parse('2026-10-25T10:00:00.000Z');
    expect(daysUntil('2026-11-08T10:00:00.000Z', now)).toBe(14);
    expect(daysUntil('2026-11-08T09:00:00.000Z', now)).toBe(14);
    expect(daysUntil('2026-10-24T10:00:00.000Z', now)).toBe(0);
  });
});
