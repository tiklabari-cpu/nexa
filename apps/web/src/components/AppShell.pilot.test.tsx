/**
 * The shell in the public pilot (tm 257.2 · ADR docs/adr/pilot-public-readiness.md
 * K-d): Billing leaves the rail and the command palette, and the trial banner
 * keeps its countdown but loses Subscribe. Every case is paired with the same
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
};
const PILOT: DeploymentConfig = {
  pilot_mode: true,
  contact_email: 'pilot-contact@example.test',
  signup_enabled: true,
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

/** A workspace nine days into its trial; every other read answers empty. */
function stubTrial(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
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
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: defaultScopesForRole('owner'),
      routing_status: 'accepting_chats',
    },
  });
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

  it('keeps the trial countdown but offers no Subscribe', async () => {
    deployment.current = PILOT;
    renderShell();
    const banner = await screen.findByTestId('trial-badge');
    expect(banner).toHaveTextContent('9');
    expect(within(banner).queryByRole('link')).toBeNull();
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

  describe('on an ordinary deployment', () => {
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
