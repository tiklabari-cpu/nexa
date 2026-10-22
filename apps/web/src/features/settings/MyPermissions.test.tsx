/**
 * Settings › My permissions — "Yetkilerim" (RL-02 · tm 325.4).
 *
 * Read-only, from the session's own `GET /auth/me` `capabilities`: what the
 * servers enforce for this person now, not what their role holds by default.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { MyPermissions } = await import('./MyPermissions.js');

function renderScreen(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MyPermissions />
    </QueryClientProvider>,
  );
}

function valueOf(capability: string): string | null | undefined {
  return document.querySelector(`dd[data-capability="${capability}"]`)?.textContent;
}

beforeEach(() => {
  api.get.mockReset();
});

describe('MyPermissions (RL-02)', () => {
  it("lists the session's own capabilities by group, with the role, from /auth/me", async () => {
    api.get.mockResolvedValue({
      role: 'team_lead',
      capabilities: {
        'chats.view': 'team',
        'reports.view': 'all',
        'settings.tags': 'off',
        'billing.manage': 'off',
      },
    });

    renderScreen();

    expect(await screen.findByText('Your role: Team Lead')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/auth/me');
    // The value the matrix gives this session — a Team Lead lent reports reads "All".
    expect(valueOf('reports.view')).toBe('All');
    expect(valueOf('chats.view')).toBe('Team');
    expect(valueOf('settings.tags')).toBe('Off');

    const reports = screen.getByRole('region', { name: 'Reports' });
    expect(within(reports).getByText('View reports')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Billing' })).toBeInTheDocument();
    // A group the profile names nothing in is not drawn as an empty heading.
    expect(screen.queryByRole('region', { name: 'Logs' })).toBeNull();
    // Nothing on the page is a control.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('ignores a capability this panel has no row for', async () => {
    api.get.mockResolvedValue({
      role: 'agent',
      capabilities: { 'chats.view': 'own', 'future.capability': 'on' },
    });

    renderScreen();

    expect(await screen.findByText('Your role: Agent')).toBeInTheDocument();
    expect(valueOf('chats.view')).toBe('Own');
    expect(document.querySelector('dd[data-capability="future.capability"]')).toBeNull();
  });

  it('says so when the profile cannot be read', async () => {
    api.get.mockRejectedValue(new Error('offline'));

    renderScreen();

    expect(await screen.findByText('Your permissions could not be loaded.')).toBeInTheDocument();
  });
});
