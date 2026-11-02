/**
 * The accept page the offer's e-mail leads to, and the banner that tells the
 * three people a pending offer concerns (RL-05 · tm 328.2).
 *
 * RL-05 is an analysis code, not an Ek A catalogue ID, so no title carries it
 * (CONVENTIONS §7.3).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentConfig } from '@siyahtus/types';
import { OwnershipTransferBanner } from './OwnershipTransferBanner.js';
import { OwnershipTransferPage } from './OwnershipTransferPage.js';
import type { OwnershipTransfer } from './ownership-transfer.js';
import { useAuth } from '../../lib/auth-store.js';
import { resetLocale } from '../../test/i18n.js';

const ORDINARY: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};
const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

const TRANSFER: OwnershipTransfer = {
  id: 'tr-1',
  state: 'pending',
  from_agent: { id: 'acc-dana', name: 'Dana Okonkwo', email: 'dana@acme.test' },
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

let pending: OwnershipTransfer | null;
let acceptAnswer: () => Response;
let accepts: Array<{ path: string; body: Record<string, unknown> }>;
let meReads: number;

function stubFetch(): void {
  accepts = [];
  meReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (path.endsWith('/ownership-transfers/current')) return json(200, { transfer: pending });
      if (path.endsWith('/accept') && method === 'POST') {
        accepts.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return acceptAnswer();
      }
      if (path.endsWith('/auth/me')) {
        meReads += 1;
        return json(200, {
          account_id: 'acc-sam',
          role: 'owner',
          scopes: ['organization--my:rw', 'access_rules:rw'],
        });
      }
      return json(200, {});
    }),
  );
}

function signedInAs(accountId: string, role: string): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: accountId,
      email: `${accountId}@acme.test`,
      name: accountId,
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });
}

function tree(ui: ReactElement, entry = '/'): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  deployment.current = ORDINARY;
  pending = TRANSFER;
  acceptAnswer = () =>
    json(200, { transfer: { ...TRANSFER, state: 'accepted' }, billing_contact: 'none' });
  signedInAs('acc-sam', 'admin');
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('OwnershipTransferPage', () => {
  it('accepts with the token from the link and puts the new role on this tab', async () => {
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1&token=tok-123'));

    expect(
      await screen.findByText(/Dana Okonkwo \(dana@acme.test\) is offering you/),
    ).toBeVisible();
    // The link carried the token, so there is nothing to type.
    expect(screen.queryByLabelText('Token from the e-mail')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));

    await waitFor(() => expect(accepts).toHaveLength(1));
    expect(accepts[0]?.path).toMatch(/\/ownership-transfers\/tr-1\/accept$/);
    expect(accepts[0]?.body).toEqual({ token: 'tok-123' });
    expect(await screen.findByText('You are now the owner of this workspace.')).toBeVisible();
    expect(screen.getByText('Dana Okonkwo is an administrator now.')).toBeVisible();
    await waitFor(() => expect(useAuth.getState().agent?.role).toBe('owner'));
    expect(useAuth.getState().agent?.scopes).toContain('access_rules:rw');
    expect(meReads).toBeGreaterThan(0);
  });

  it('asks for the token when the page is reached without one', async () => {
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1'));

    // Nothing to send until the token is in.
    expect(await screen.findByRole('button', { name: 'Accept ownership' })).toBeDisabled();
    expect(accepts).toHaveLength(0);

    await userEvent.type(screen.getByLabelText('Token from the e-mail'), '  pasted-token ');
    await userEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));
    await waitFor(() => expect(accepts).toHaveLength(1));
    expect(accepts[0]?.body).toEqual({ token: 'pasted-token' });
  });

  it('writes the SSO consequence on the page before and after accepting', async () => {
    pending = { ...TRANSFER, sso_enforced: true };
    acceptAnswer = () =>
      json(200, {
        transfer: { ...TRANSFER, state: 'accepted', sso_enforced: true },
        billing_contact: 'none',
      });
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1&token=t'));

    const note =
      /keep the owner’s password sign-in; Dana Okonkwo will sign in through the provider/;
    expect(await screen.findByText(note)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Accept ownership' }));
    await screen.findByText('You are now the owner of this workspace.');
    expect(screen.getByText(note)).toBeVisible();
  });

  it('says what happened to the invoice address', async () => {
    acceptAnswer = () =>
      json(200, { transfer: { ...TRANSFER, state: 'accepted' }, billing_contact: 'kept' });
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1&token=t'));

    await userEvent.click(await screen.findByRole('button', { name: 'Accept ownership' }));
    expect(await screen.findByText(/invoice e-mail still goes to another address/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review the invoice e-mail' })).toHaveAttribute(
      'href',
      '/app/billing',
    );
  });

  it('leaves the invoice link out of the pilot, which sells nothing', async () => {
    deployment.current = { ...ORDINARY, pilot_mode: true };
    acceptAnswer = () =>
      json(200, { transfer: { ...TRANSFER, state: 'accepted' }, billing_contact: 'kept' });
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1&token=t'));

    await userEvent.click(await screen.findByRole('button', { name: 'Accept ownership' }));
    await screen.findByText(/invoice e-mail still goes to another address/);
    expect(screen.queryByRole('link', { name: 'Review the invoice e-mail' })).toBeNull();
  });

  it('words a wrong token and a transfer that is no longer pending', async () => {
    acceptAnswer = () => refusal(403, 'not_allowed', { reason: 'invalid_token' });
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1&token=bad'));

    await userEvent.click(await screen.findByRole('button', { name: 'Accept ownership' }));
    expect(await screen.findByText(/not the one from the e-mail/)).toBeVisible();
    // Still on the form, to try again.
    expect(screen.getByRole('button', { name: 'Accept ownership' })).toBeEnabled();
  });

  it('says an expired offer is over when the server refuses it as not pending', async () => {
    acceptAnswer = () =>
      refusal(409, 'ownership_transfer_state', { reason: 'not_pending', state: 'expired' });
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1&token=t'));

    await userEvent.click(await screen.findByRole('button', { name: 'Accept ownership' }));
    expect(await screen.findByText('This offer is no longer open.')).toBeVisible();
  });

  it('tells someone signed in as another account whom the offer is for', async () => {
    signedInAs('acc-other', 'agent');
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1&token=t'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This offer is for sam@acme.test, and you are signed in as acc-other@acme.test.',
    );
    expect(screen.queryByRole('button', { name: 'Accept ownership' })).toBeNull();
  });

  it('shows a closed notice when nothing is pending or the link names another transfer', async () => {
    pending = null;
    const first = render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-1'));
    expect(await screen.findByText(/This offer is no longer open\./)).toBeVisible();
    first.unmount();

    pending = TRANSFER;
    render(tree(<OwnershipTransferPage />, '/app/ownership-transfer?transfer=tr-other'));
    expect(await screen.findByText(/This offer is no longer open\./)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept ownership' })).toBeNull();
  });
});

describe('OwnershipTransferBanner', () => {
  it('tells the member offered the workspace, with a way to the accept page', async () => {
    render(tree(<OwnershipTransferBanner />));

    expect(await screen.findByText(/Dana Okonkwo is offering you ownership/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review the offer' })).toHaveAttribute(
      'href',
      '/app/ownership-transfer?transfer=tr-1',
    );
  });

  it('tells the owner who has the offer, with a way to the danger zone', async () => {
    signedInAs('acc-dana', 'owner');
    render(tree(<OwnershipTransferBanner />));

    expect(
      await screen.findByText(/You offered ownership of this workspace to Sam Reyes/),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'See the offer' })).toHaveAttribute(
      'href',
      '/app/settings/company',
    );
  });

  it('only informs another administrator', async () => {
    signedInAs('acc-kim', 'admin');
    render(tree(<OwnershipTransferBanner />));

    expect(
      await screen.findByText(/Dana Okonkwo is handing this workspace over to Sam Reyes/),
    ).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('draws nothing without a pending offer, or when the answer is not a transfer', async () => {
    pending = null;
    const first = render(tree(<OwnershipTransferBanner />));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    // A stand-in answering every path with `{}`.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, {})),
    );
    const second = render(tree(<OwnershipTransferBanner />));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(second.container).toBeEmptyDOMElement();
  });
});
