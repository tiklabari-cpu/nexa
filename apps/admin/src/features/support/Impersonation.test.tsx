/**
 * "Enter as the customer" in the root panel (tm 389.15 · FR-ADMIN-21), against a fake platform
 * API. The server's rules and both audit trails have their own suite
 * (`platform-impersonation.test.ts`); here: who sees the button, what the dialog asks for and
 * sends, the one-time link it hands back, and the Support page's open sessions with End.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no title carries one as a requirement tag
 * (CONVENTIONS §7.3).
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_ID, WORKSPACE_MEMBERS, type FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

const OWNER = WORKSPACE_MEMBERS.data[0]!;
const LEAD = WORKSPACE_MEMBERS.data[1]!;

async function open(
  path: string,
  role: PlatformRole = 'superadmin',
  heading = 'Acme Gaming',
  prepare: (fake: FakePlatform) => void = () => undefined,
): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  prepare(fake);
  const user = userEvent.setup();
  renderApp(path);
  await user.type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: heading });
  return fake;
}

const sent = (fake: FakePlatform, path: string) =>
  fake.requests
    .filter((request) => request.path === path && request.method === 'POST')
    .map((request) => request.body);

describe('entering a workspace as a member', () => {
  it('opens a read-only session by default and hands back the one-time link, once', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}`, 'support');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Enter as customer' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('radio', { name: /Read-only/ })).toBeChecked();
    // Support may not act as the member.
    expect(within(dialog).getByRole('radio', { name: /Full/ })).toBeDisabled();
    expect(within(dialog).getByText('Superadmins only.')).toBeInTheDocument();
    // No member chosen yet: nothing to confirm.
    expect(within(dialog).getByRole('button', { name: 'Create the link' })).toBeDisabled();

    await user.selectOptions(within(dialog).getByLabelText('Member'), LEAD.account_id);
    await user.type(within(dialog).getByLabelText('Reason'), 'Inbox shows no chats');
    await user.click(within(dialog).getByRole('button', { name: 'Create the link' }));

    const ready = await screen.findByTestId('impersonation-handoff');
    expect(ready).toHaveTextContent(`Read-only session as ${LEAD.email}.`);
    expect(ready).toHaveTextContent('The workspace’s owner has been emailed.');
    const link = within(ready).getByRole('link', { name: 'Open the workspace' });
    expect(link).toHaveAttribute(
      'href',
      'http://localhost:5173/auth/impersonate#code=one-time-code',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    expect(sent(fake, '/support/impersonations')).toEqual([
      {
        license_id: WORKSPACE_ID,
        account_id: LEAD.account_id,
        mode: 'read_only',
        reason: 'Inbox shows no chats',
      },
    ]);

    await user.click(within(ready).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('impersonation-handoff')).toBeNull();
  });

  it('lets a superadmin open a full session, with a fresh code first', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}`, 'superadmin');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Enter as customer' }));
    const dialog = await screen.findByRole('dialog');

    await user.selectOptions(within(dialog).getByLabelText('Member'), OWNER.account_id);
    await user.click(within(dialog).getByRole('radio', { name: /Full/ }));
    // Full acts as the member: the dialog asks for a fresh code up front.
    const code = await within(dialog).findByLabelText('Authenticator code');
    await user.type(within(dialog).getByLabelText('Reason'), 'Fix a routing rule with them');
    await user.type(code, '123456');
    await user.click(within(dialog).getByRole('button', { name: 'Create the link' }));

    const ready = await screen.findByTestId('impersonation-handoff');
    expect(ready).toHaveTextContent(`Full session as ${OWNER.email}.`);
    expect(sent(fake, '/support/impersonations').at(-1)).toMatchObject({ mode: 'full' });
    expect(fake.calls('/auth/totp/reverify')).toHaveLength(1);
  });

  it('is not offered to a role that may not impersonate', async () => {
    await open(`/workspaces/${WORKSPACE_ID}`, 'readonly');
    expect(screen.queryByRole('button', { name: 'Enter as customer' })).toBeNull();
  });
});

describe('the open sessions', () => {
  it('says when nobody is inside a workspace', async () => {
    await open('/support', 'support', 'Support');
    expect(await screen.findByText('No operator is inside a workspace right now.')).toBeVisible();
  });

  it('lists them on the Support page and ends one behind a reason', async () => {
    const seed = (fake: FakePlatform) =>
      fake.impersonationState.sessions.push({
        id: '00000000-0000-4000-8000-0000000000e1',
        license_id: WORKSPACE_ID,
        organization_name: 'Acme Gaming',
        account_id: LEAD.account_id,
        account_email: LEAD.email,
        admin_id: '00000000-0000-4000-8000-0000000000aa',
        admin_email: 'ops@example.com',
        mode: 'read_only',
        started_at: '2026-10-26T12:00:00.000Z',
        ends_at: '2026-10-26T12:30:00.000Z',
        ended_at: null,
        end_reason: null,
        active: true,
      });
    const fake = await open('/support', 'support', 'Support', seed);
    const user = userEvent.setup();
    const row = (await screen.findByText(LEAD.email)).closest('tr')!;
    expect(row).toHaveTextContent('Acme Gaming');
    expect(row).toHaveTextContent('Read-only');

    await user.click(within(row).getByRole('button', { name: 'End session' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Done looking');
    await user.click(within(dialog).getByRole('button', { name: 'End session' }));
    expect(await screen.findByText('No operator is inside a workspace right now.')).toBeVisible();
    expect(sent(fake, '/support/impersonations/00000000-0000-4000-8000-0000000000e1/end')).toEqual([
      { reason: 'Done looking' },
    ]);
  });
});
