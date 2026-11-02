/**
 * Settings › Company › "Danger zone" (RL-05 · tm 328.2): only the owner is shown
 * it; the offer needs the member, the password (or a code) and the workspace's
 * name typed out; what the server refuses is said in words of its own; a
 * pending offer replaces the form and can be taken back.
 *
 * RL-05 is an analysis code, not an Ek A catalogue ID, so no title carries it
 * (CONVENTIONS §7.3).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnershipTransferZone } from './OwnershipTransferZone.js';
import type { OwnershipTransfer } from './ownership-transfer.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const MEMBERS = [
  {
    id: 'acc-owner',
    name: 'Dana Okonkwo',
    email: 'dana@acme.test',
    role: 'owner',
    suspended: false,
  },
  { id: 'acc-sam', name: 'Sam Reyes', email: 'sam@acme.test', role: 'admin', suspended: false },
  { id: 'acc-lee', name: 'Lee Tan', email: 'lee@acme.test', role: 'agent', suspended: true },
];

const PENDING: OwnershipTransfer = {
  id: 'tr-1',
  state: 'pending',
  from_agent: { id: 'acc-owner', name: 'Dana Okonkwo', email: 'dana@acme.test' },
  to_agent: { id: 'acc-sam', name: 'Sam Reyes', email: 'sam@acme.test' },
  created_at: '2026-11-01T10:00:00.000Z',
  expires_at: '2026-11-04T10:00:00.000Z',
  decided_at: null,
  sso_enforced: false,
};

function json(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function refusal(status: number, type: string, details?: Record<string, unknown>): Response {
  return json(status, {
    error: { type, message: 'Refused.', request_id: 'req_test', ...(details ? { details } : {}) },
  });
}

interface Calls {
  starts: Array<Record<string, unknown>>;
  deletes: string[];
}

let calls: Calls;
let pending: OwnershipTransfer | null;
let startAnswer: () => Response;

function stubFetch(): void {
  calls = { starts: [], deletes: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (path.endsWith('/ownership-transfers/current')) return json(200, { transfer: pending });
      if (path.endsWith('/ownership-transfers') && method === 'POST') {
        calls.starts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return startAnswer();
      }
      if (path.includes('/ownership-transfers/') && method === 'DELETE') {
        calls.deletes.push(path);
        pending = null;
        return json(204, null);
      }
      if (path.endsWith('/settings/company')) {
        return json(200, { name: 'Acme Support', timezone: 'UTC' });
      }
      if (path.endsWith('/agents')) return json(200, { items: MEMBERS });
      return json(200, {});
    }),
  );
}

function signedInAs(role: string): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'acc-owner',
      email: 'dana@acme.test',
      name: 'Dana Okonkwo',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['organization--my:rw'],
      routing_status: 'accepting_chats',
    },
  });
}

function tree(isOwner: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OwnershipTransferZone isOwner={isOwner} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function openForm(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Transfer ownership…' }));
  await screen.findByRole('dialog');
}

beforeEach(() => {
  pending = null;
  startAnswer = () => json(201, { transfer: PENDING, mail: 'sent' });
  signedInAs('owner');
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('OwnershipTransferZone', () => {
  it('is not drawn for anyone but the owner', () => {
    render(tree(false));
    expect(screen.queryByRole('heading', { name: 'Danger zone' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('offers the other active members and leaves out the owner and the suspended', async () => {
    render(tree(true));
    await openForm();

    const select = screen.getByLabelText('New owner');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choose a member', 'Sam Reyes (sam@acme.test)']);
  });

  it('keeps Offer disabled until the member, a credential and the workspace name are in', async () => {
    render(tree(true));
    await openForm();
    const offer = screen.getByRole('button', { name: 'Offer ownership' });
    expect(offer).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'acc-sam');
    await userEvent.type(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme');
    await userEvent.tab();
    expect(offer).toBeDisabled();
    expect(
      await screen.findByText('Type the workspace name exactly as shown.'),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Workspace name'), ' Support');
    expect(offer).toBeEnabled();
    expect(calls.starts).toHaveLength(0);
  });

  it('sends the member, the password and the code, then shows the pending offer', async () => {
    render(tree(true));
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'acc-sam');
    await userEvent.type(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await userEvent.type(screen.getByLabelText('Authenticator or recovery code'), '123456');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme Support');
    await userEvent.click(screen.getByRole('button', { name: 'Offer ownership' }));

    await waitFor(() => expect(calls.starts).toHaveLength(1));
    expect(calls.starts[0]).toEqual({
      target_agent_id: 'acc-sam',
      password: 'hunter2hunter2',
      totp: '123456',
    });
    expect(await screen.findByText('Ownership offered to Sam Reyes')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('The link was sent to sam@acme.test.')).toBeInTheDocument();
  });

  it('leaves the password out of the body when only a code proves the owner', async () => {
    render(tree(true));
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'acc-sam');
    await userEvent.type(screen.getByLabelText('Authenticator or recovery code'), 'ABCD-EFGH');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme Support');
    await userEvent.click(screen.getByRole('button', { name: 'Offer ownership' }));

    await waitFor(() => expect(calls.starts).toHaveLength(1));
    expect(calls.starts[0]).toEqual({ target_agent_id: 'acc-sam', totp: 'ABCD-EFGH' });
  });

  it('asks for a credential rather than sending none', async () => {
    render(tree(true));
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'acc-sam');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme Support');
    await userEvent.click(screen.getByRole('button', { name: 'Offer ownership' }));

    expect(
      await screen.findByText('Enter your password, or a code if you have no password.'),
    ).toBeInTheDocument();
    expect(calls.starts).toHaveLength(0);
  });

  it('says a wrong password is a wrong password, not an expired session', async () => {
    startAnswer = () => refusal(401, 'authentication');
    render(tree(true));
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'acc-sam');
    await userEvent.type(screen.getByLabelText('Your password'), 'nope-nope-nope');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme Support');
    await userEvent.click(screen.getByRole('button', { name: 'Offer ownership' }));

    expect(await screen.findByText('That password or code is not correct.')).toBeInTheDocument();
    // Still in the dialog, with the person's input.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Your password')).toHaveValue('nope-nope-nope');
  });

  it('asks for the code when the server says two-factor is on', async () => {
    startAnswer = () => refusal(401, 'two_factor_required');
    render(tree(true));
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'acc-sam');
    await userEvent.type(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme Support');
    await userEvent.click(screen.getByRole('button', { name: 'Offer ownership' }));

    expect(await screen.findByText('Enter your two-factor code to continue.')).toBeInTheDocument();
  });

  it.each([
    ['target_unverified', 'That member hasn’t confirmed their e-mail address yet.'],
    [
      'target_two_factor_required',
      'This workspace requires two-factor authentication, and that member hasn’t set it up.',
    ],
    ['target_suspended', 'That member is suspended or blocked and can’t take the workspace over.'],
    ['pending_exists', 'An offer is already waiting. Cancel it before making another.'],
  ])('words the refusal %s in its own sentence', async (reason, sentence) => {
    startAnswer = () => refusal(409, 'ownership_transfer_state', { reason });
    render(tree(true));
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'acc-sam');
    await userEvent.type(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme Support');
    await userEvent.click(screen.getByRole('button', { name: 'Offer ownership' }));

    expect(await screen.findByText(sentence)).toBeInTheDocument();
  });

  it('says so when the offer is recorded but the e-mail did not go', async () => {
    startAnswer = () => json(201, { transfer: PENDING, mail: 'failed' });
    render(tree(true));
    await openForm();
    await userEvent.selectOptions(screen.getByLabelText('New owner'), 'acc-sam');
    await userEvent.type(screen.getByLabelText('Your password'), 'hunter2hunter2');
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme Support');
    await userEvent.click(screen.getByRole('button', { name: 'Offer ownership' }));

    expect(
      await screen.findByText(/e-mail to sam@acme.test could not be sent/),
    ).toBeInTheDocument();
  });

  it('shows a pending offer instead of the form, and takes it back after a confirmation', async () => {
    pending = PENDING;
    render(tree(true));

    expect(await screen.findByText('Ownership offered to Sam Reyes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transfer ownership…' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel offer' }));
    const dialog = await screen.findByRole('dialog');
    expect(calls.deletes).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel offer' }));

    await waitFor(() =>
      expect(calls.deletes).toEqual([expect.stringMatching(/\/ownership-transfers\/tr-1$/)]),
    );
    expect(await screen.findByRole('button', { name: 'Transfer ownership…' })).toBeInTheDocument();
  });

  it('speaks Turkish', async () => {
    renderWithLocale(tree(true), 'tr');
    expect(await screen.findByRole('heading', { name: 'Tehlikeli bölge' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Sahipliği devret…' })).toBeInTheDocument();
  });
});
