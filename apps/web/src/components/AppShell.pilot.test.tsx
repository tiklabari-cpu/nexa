/**
 * The shell in the public pilot (tm 257.2 · ADR docs/adr/pilot-public-readiness.md
 * K-d): Billing leaves the rail and the command palette, and the trial banner
 * loses Subscribe — since tm 257.15 it is fed by `/auth/me`, shows to every role
 * and offers the contact address instead. Every case is paired with the same
 * render on an ordinary deployment, where the door is still there — the
 * flag-off behaviour `AppShell.test.tsx` and `CommandPalette.test.tsx` pin is
 * left to them, unchanged.
 *
 * `useDeployment` is mocked at its one seam, as `SignInPage.test.tsx` does.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeploymentConfig } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { defaultScopesForRole } from '@siyahtus/types';
import { AppShell } from './AppShell.js';
import { useAuth } from '../lib/auth-store.js';
import { installFakeWebSocket } from '../test/fake-socket.js';

const ORDINARY: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};
const PILOT: DeploymentConfig = {
  pilot_mode: true,
  contact_email: 'pilot-contact@example.test',
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const MAILTO = 'mailto:pilot-contact@example.test';

/** The calls the shell made, for "it did not read billing" assertions. */
const fetched = vi.hoisted(() => ({ urls: [] as string[] }));

type License = NonNullable<NonNullable<ReturnType<typeof useAuth.getState>['agent']>['license']>;

const DAY = 86_400_000;
const trialing = (days: number): License => ({
  access: 'trialing',
  trial_ends_at: new Date(Date.now() + days * DAY - 60_000).toISOString(),
});
const readOnly: License = {
  access: 'read_only',
  trial_ends_at: new Date(Date.now() - DAY).toISOString(),
};

/** Signs in as `role` (an agent carries no billing scope), with `license` from `/auth/me`. */
function signInAs(role: 'owner' | 'agent', license?: License): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: defaultScopesForRole(role),
      routing_status: 'accepting_chats',
      ...(license ? { license } : {}),
    },
  });
}

/** A workspace nine days into its trial; every other read answers empty. */
function stubTrial(): void {
  fetched.urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      fetched.urls.push(input);
      if (input.includes('/billing/subscription')) {
        return jsonResponse({ access: 'trialing', trial: { days_remaining: 9 } });
      }
      return jsonResponse({ items: [] });
    }),
  );
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/inbox']}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="inbox" element={<p>Inbox module</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  installFakeWebSocket();
  stubTrial();
  signInAs('owner', trialing(9));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the shell in the public pilot (tm 257.2)', () => {
  it('leaves Billing out of the rail and keeps every other door', () => {
    deployment.current = PILOT;
    renderShell();
    const rail = screen.getByRole('navigation', { name: 'Modules' });
    expect(within(rail).queryByRole('link', { name: 'Billing' })).toBeNull();
    for (const name of ['Inbox', 'Reports', 'Settings', 'Developers']) {
      expect(within(rail).getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('counts the trial down with the contact address, and no Subscribe', async () => {
    deployment.current = PILOT;
    renderShell();
    const banner = await screen.findByTestId('trial-badge');
    expect(banner).toHaveTextContent(
      'Your pilot trial ends in 9 days — to continue, contact pilot-contact@example.test.',
    );
    expect(within(banner).getByRole('link')).toHaveAttribute('href', MAILTO);
    expect(within(banner).queryByRole('link', { name: 'Subscribe' })).toBeNull();
  });

  describe('the trial bar reaches every role (tm 257.15)', () => {
    it.each(['owner', 'agent'] as const)('shows a %s the countdown', async (role) => {
      deployment.current = PILOT;
      signInAs(role, trialing(3));
      renderShell();
      const banner = await screen.findByTestId('trial-badge');
      expect(banner).toHaveTextContent('Your pilot trial ends in 3 days');
      expect(within(banner).getByRole('link')).toHaveAttribute('href', MAILTO);
    });

    it.each(['owner', 'agent'] as const)(
      'tells a %s the trial is over, with the address',
      async (role) => {
        deployment.current = PILOT;
        signInAs(role, readOnly);
        renderShell();
        const banner = await screen.findByTestId('trial-badge');
        expect(banner).toHaveTextContent(
          'Your pilot trial has ended — to continue, contact pilot-contact@example.test.',
        );
        expect(
          within(banner).getByRole('link', { name: 'pilot-contact@example.test' }),
        ).toHaveAttribute('href', MAILTO);
        expect(within(banner).queryByRole('link', { name: 'Subscribe' })).toBeNull();
      },
    );

    it('reads the state from the profile, never from the billing endpoint', async () => {
      deployment.current = PILOT;
      signInAs('agent', trialing(3));
      renderShell();
      await screen.findByTestId('trial-badge');
      expect(fetched.urls.some((url) => url.includes('/billing/subscription'))).toBe(false);
    });

    it('says nothing for an active workspace, or a profile that carries no licence', async () => {
      deployment.current = PILOT;
      signInAs('agent', { access: 'active', trial_ends_at: null });
      const { unmount } = renderShell();
      await screen.findByText('Inbox module');
      expect(screen.queryByTestId('trial-badge')).toBeNull();
      unmount();

      signInAs('agent');
      renderShell();
      await screen.findByText('Inbox module');
      expect(screen.queryByTestId('trial-badge')).toBeNull();
    });

    it('drops the address, and the link, when the deployment names none', async () => {
      deployment.current = { ...PILOT, contact_email: null };
      signInAs('agent', readOnly);
      renderShell();
      const banner = await screen.findByTestId('trial-badge');
      expect(banner).toHaveTextContent('Your pilot trial has ended.');
      expect(within(banner).queryByRole('link')).toBeNull();
    });
  });

  it('offers no Billing in the command palette, by name or by keyword', async () => {
    deployment.current = PILOT;
    const user = userEvent.setup();
    renderShell();
    await user.keyboard('{Meta>}k{/Meta}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByRole('option', { name: /Reports/ })).toBeInTheDocument();
    expect(within(palette).queryByRole('option', { name: /Billing/ })).toBeNull();

    await user.type(within(palette).getByRole('combobox'), 'subscription');
    expect(within(palette).queryByRole('option', { name: /Billing/ })).toBeNull();
  });

  it('leaves the marketplace link out of the app menu, and keeps the menu (tm 257.18)', async () => {
    deployment.current = PILOT;
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'App menu' }));
    expect(screen.queryByRole('link', { name: 'Apps' })).toBeNull();
  });

  describe('on an ordinary deployment', () => {
    it('links the app menu to the marketplace (tm 257.18)', async () => {
      deployment.current = ORDINARY;
      const user = userEvent.setup();
      renderShell();
      await user.click(screen.getByRole('button', { name: 'App menu' }));
      expect(screen.getByRole('link', { name: 'Apps' })).toHaveAttribute('href', '/app/apps');
    });

    it('shows Billing in the rail', () => {
      deployment.current = ORDINARY;
      renderShell();
      const rail = screen.getByRole('navigation', { name: 'Modules' });
      expect(within(rail).getByRole('link', { name: 'Billing' })).toHaveAttribute(
        'href',
        '/app/billing',
      );
    });

    it('offers Subscribe beside the countdown', async () => {
      deployment.current = ORDINARY;
      renderShell();
      const banner = await screen.findByTestId('trial-badge');
      expect(within(banner).getByRole('link', { name: 'Subscribe' })).toHaveAttribute(
        'href',
        '/app/billing',
      );
    });

    it('keeps the bar billing-fed: an agent, refused the billing read, sees none', async () => {
      deployment.current = ORDINARY;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) =>
          input.includes('/billing/subscription')
            ? ({
                ok: false,
                status: 403,
                headers: { get: () => null },
                json: async () => ({
                  error: { type: 'forbidden', message: 'no', request_id: 'rq' },
                }),
              } as unknown as Response)
            : jsonResponse({ items: [] }),
        ),
      );
      signInAs('agent', readOnly);
      renderShell();
      await screen.findByText('Inbox module');
      expect(screen.queryByTestId('trial-badge')).toBeNull();
    });

    it('offers Billing in the command palette', async () => {
      deployment.current = ORDINARY;
      const user = userEvent.setup();
      renderShell();
      await user.keyboard('{Meta>}k{/Meta}');
      const palette = await screen.findByRole('dialog', { name: 'Command palette' });
      await user.type(within(palette).getByRole('combobox'), 'subscription');
      expect(within(palette).getByRole('option', { name: /Billing/ })).toBeInTheDocument();
    });
  });
});
