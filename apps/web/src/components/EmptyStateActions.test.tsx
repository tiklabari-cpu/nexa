/**
 * The next step an empty screen offers in a new workspace (NY-11 · tm 473).
 *
 * The widget link is a setup step, so it must appear only while the step is
 * undone (no website yet) and only to someone who may take it; everyone else
 * gets the screen's fallback or nothing. `useDeployment` is mocked at its one
 * seam, as `AppShell.pilot.test.tsx` does.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { DeploymentConfig } from '@siyahtus/types';
import { defaultScopesForRole } from '@siyahtus/types';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../lib/auth-store.js';
import { resetLocale, setLocale } from '../test/i18n.js';
import {
  CreateAiAgentAction,
  InstallWidgetAction,
  InstallWidgetHint,
} from './EmptyStateActions.js';

const deployment = vi.hoisted(() => ({
  current: {
    pilot_mode: false,
    contact_email: null,
    signup_enabled: true,
    email_verification_required: false,
    privacy_policy_url: null,
    terms_url: null,
    terms_version: null,
  } as DeploymentConfig,
}));
vi.mock('../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

const fetched = vi.hoisted(() => ({ urls: [] as string[] }));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** `GET /websites` answers `sites`; anything else would be a stray read. */
function stubWebsites(sites: unknown[] | 'error'): void {
  fetched.urls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      fetched.urls.push(input);
      if (input.includes('/websites')) {
        return sites === 'error'
          ? jsonResponse({ type: 'internal', message: 'boom' }, 500)
          : jsonResponse({ items: sites });
      }
      return jsonResponse({ type: 'not_found', message: 'stray' }, 404);
    }),
  );
}

function signInAs(role: 'owner' | 'admin' | 'agent'): void {
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
    },
  });
}

function renderIt(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  deployment.current = { ...deployment.current, pilot_mode: false };
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('InstallWidgetAction', () => {
  it('offers the widget step to an owner whose workspace has no website yet', async () => {
    signInAs('owner');
    stubWebsites([]);
    renderIt(<InstallWidgetAction />);
    const link = await screen.findByRole('link', { name: 'Install the chat widget' });
    expect(link).toHaveAttribute('href', '/app/settings/website-widgets');
  });

  it('offers nothing once a website has the widget, or the fallback when the screen names one', async () => {
    signInAs('owner');
    stubWebsites([{ id: 'w-1', domain: 'shop.example' }]);
    const { unmount } = renderIt(<InstallWidgetAction />);
    await waitFor(() => expect(fetched.urls.some((u) => u.includes('/websites'))).toBe(true));
    // Give the answer a turn to land before asserting absence.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole('link')).toBeNull();
    unmount();

    renderIt(<InstallWidgetAction fallback="inbox" />);
    const inbox = await screen.findByRole('link', { name: 'Go to inbox' });
    expect(inbox).toHaveAttribute('href', '/app/inbox');
    expect(screen.queryByRole('link', { name: 'Install the chat widget' })).toBeNull();
  });

  it('never offers an agent a Settings step they cannot open, and does not ask the server', async () => {
    signInAs('agent');
    stubWebsites([]);
    const { unmount } = renderIt(<InstallWidgetAction />);
    expect(screen.queryByRole('link')).toBeNull();
    unmount();

    renderIt(<InstallWidgetAction fallback="inbox" />);
    expect(screen.getByRole('link', { name: 'Go to inbox' })).toBeInTheDocument();
    expect(fetched.urls.filter((u) => u.includes('/websites'))).toEqual([]);
  });

  it('offers nothing while the read is in flight, and nothing after it fails', async () => {
    signInAs('owner');
    stubWebsites('error');
    renderIt(<InstallWidgetAction />);
    expect(screen.queryByRole('link')).toBeNull();
    await waitFor(() => expect(fetched.urls.some((u) => u.includes('/websites'))).toBe(true));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('speaks Turkish in a Turkish console', async () => {
    setLocale('tr');
    signInAs('owner');
    stubWebsites([]);
    renderIt(<InstallWidgetAction />);
    expect(await screen.findByRole('link', { name: 'Sohbet widget’ını kurun' })).toBeVisible();
  });
});

describe('InstallWidgetHint', () => {
  it('draws its sentence with the link only while the widget step is undone', async () => {
    signInAs('admin');
    stubWebsites([]);
    renderIt(<InstallWidgetHint text="No conversations yet." />);
    expect(await screen.findByRole('link', { name: 'Install the chat widget' })).toBeVisible();
    expect(screen.getByText(/No conversations yet\./)).toBeVisible();
  });

  it('draws nothing at all once a website exists', async () => {
    signInAs('admin');
    stubWebsites([{ id: 'w-1' }]);
    const { container } = renderIt(<InstallWidgetHint text="No conversations yet." />);
    await waitFor(() => expect(fetched.urls.some((u) => u.includes('/websites'))).toBe(true));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CreateAiAgentAction', () => {
  it('links an owner to the AI agent page', () => {
    signInAs('owner');
    stubWebsites([]);
    renderIt(<CreateAiAgentAction />);
    expect(screen.getByRole('link', { name: 'Create an AI agent' })).toHaveAttribute(
      'href',
      '/app/playbook?view=general',
    );
  });

  it('offers an agent, who cannot open the Playbook, nothing', () => {
    signInAs('agent');
    stubWebsites([]);
    const { container } = renderIt(<CreateAiAgentAction />);
    expect(container).toBeEmptyDOMElement();
  });
});
