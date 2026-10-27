/**
 * The root panel's announcement and maintenance mode in the console (tm 389.13 ·
 * FR-ADMIN-15), read from `GET /deployment/notice`: the announcement bar in the
 * panel's language and at its level, the read-only maintenance band, and the
 * full-page message that stands in for the console in `full` maintenance. What
 * the API refuses in maintenance is `maintenance-gate`'s suite.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { DeploymentConfig, DeploymentNotice } from '@siyahtus/types';
import { defaultScopesForRole } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { useAuth } from '../lib/auth-store.js';
import { resetLocale, setLocale } from '../test/i18n.js';
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
vi.mock('../lib/deployment.js', () => ({ useDeployment: () => ORDINARY }));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function stubNotice(notice: DeploymentNotice): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.endsWith('/deployment/notice')) return jsonResponse(notice);
      // A paid workspace: no trial bar beside the notice.
      if (input.includes('/billing/subscription')) return jsonResponse({ access: 'active' });
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

const ANNOUNCEMENT = {
  en: 'Planned maintenance tonight at 22:00 UTC.',
  tr: 'Bu gece 22:00 UTC’de planlı bakım var.',
  until: null,
};

beforeEach(() => {
  installFakeWebSocket();
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
  resetLocale();
});

describe('the announcement bar (tm 389.13)', () => {
  it('shows nothing when the operators announce nothing', async () => {
    stubNotice({ announcement: null, maintenance: null });
    renderShell();
    await screen.findByText('Inbox module');
    expect(screen.queryByTestId('notice-bar')).toBeNull();
    expect(screen.queryByTestId('maintenance-band')).toBeNull();
  });

  it('shows the announcement in the panel’s language, as a status', async () => {
    stubNotice({ announcement: { level: 'info', ...ANNOUNCEMENT }, maintenance: null });
    renderShell();
    const bar = await screen.findByTestId('notice-bar');
    expect(bar).toHaveTextContent(ANNOUNCEMENT.en);
    expect(bar).toHaveAttribute('role', 'status');
    expect(bar).toHaveAttribute('data-level', 'info');
  });

  it('reads the Turkish text in Turkish, and announces a critical one as an alert', async () => {
    setLocale('tr');
    stubNotice({ announcement: { level: 'critical', ...ANNOUNCEMENT }, maintenance: null });
    renderShell();
    const bar = await screen.findByTestId('notice-bar');
    expect(bar).toHaveTextContent(ANNOUNCEMENT.tr);
    expect(bar).not.toHaveTextContent(ANNOUNCEMENT.en);
    expect(bar).toHaveAttribute('role', 'alert');
  });
});

describe('maintenance mode in the console (tm 389.13)', () => {
  it('bands a read-only maintenance with the console’s own sentence', async () => {
    stubNotice({ announcement: null, maintenance: { mode: 'read_only', message: null } });
    renderShell();
    expect(await screen.findByTestId('maintenance-band')).toHaveTextContent(
      'Maintenance in progress — the console is read-only for now, and changes are not saved.',
    );
    expect(screen.getByText('Inbox module')).toBeVisible();
  });

  it('uses the operator’s message when there is one', async () => {
    stubNotice({
      announcement: null,
      maintenance: {
        mode: 'read_only',
        message: { en: 'Back by 23:00.', tr: '23:00’te dönüyoruz.' },
      },
    });
    renderShell();
    expect(await screen.findByTestId('maintenance-band')).toHaveTextContent('Back by 23:00.');
  });

  it('puts the full-page message in place of the console in full maintenance', async () => {
    stubNotice({ announcement: null, maintenance: { mode: 'full', message: null } });
    renderShell();
    expect(await screen.findByTestId('maintenance-page')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Down for maintenance' })).toBeVisible();
    expect(screen.queryByText('Inbox module')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Modules' })).toBeNull();
  });
});
