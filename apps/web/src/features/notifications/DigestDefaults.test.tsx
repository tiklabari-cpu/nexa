/**
 * The workspace default for the summary e-mails (RP-05 · tm 372): a role ×
 * frequency grid the Founder and the Administrators save, unlike the personal
 * switches above it, which write the moment they are flipped.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DigestSettings } from '@siyahtus/types';
import { DigestDefaults } from './DigestDefaults.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const SHIPPED: DigestSettings = {
  daily_roles: ['owner', 'viceowner', 'admin', 'team_lead'],
  weekly_roles: [],
};

let putBodies: Array<Record<string, unknown>>;
let failLoad: boolean;

function stubFetch(current: DigestSettings): void {
  putBodies = [];
  failLoad = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).endsWith('/settings/digests')) return okJson({});
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        putBodies.push(body);
        return okJson({ ...current, ...body });
      }
      if (failLoad) {
        return {
          ok: false,
          status: 500,
          headers: { get: () => null },
          json: async () => ({ error: { type: 'internal', message: 'x', request_id: 'r' } }),
        } as unknown as Response;
      }
      return okJson(current);
    }),
  );
}

function renderDefaults(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DigestDefaults />
    </QueryClientProvider>,
  );
}

const box = (role: string, frequency: 'Daily summary' | 'Weekly summary') =>
  screen.getByRole('checkbox', { name: `${role} · ${frequency}` });

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  stubFetch(SHIPPED);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('DigestDefaults (RP-05)', () => {
  it('shows the workspace default: the managers get the daily one, nobody the weekly', async () => {
    renderDefaults();
    expect(await screen.findByText('Workspace default')).toBeInTheDocument();

    expect(box('Owner', 'Daily summary')).toBeChecked();
    expect(box('Team Lead', 'Daily summary')).toBeChecked();
    expect(box('Agent', 'Daily summary')).not.toBeChecked();
    expect(box('Owner', 'Weekly summary')).not.toBeChecked();
  });

  it('saves the whole role lists on Save, and not before', async () => {
    renderDefaults();
    await screen.findByText('Workspace default');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await userEvent.click(box('Admin', 'Weekly summary'));
    await userEvent.click(box('Team Lead', 'Daily summary'));
    expect(putBodies).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      daily_roles: ['owner', 'viceowner', 'admin'],
      weekly_roles: ['admin'],
    });
  });

  it('discards an edit back to the saved default', async () => {
    renderDefaults();
    await screen.findByText('Workspace default');
    await userEvent.click(box('Agent', 'Daily summary'));
    expect(box('Agent', 'Daily summary')).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(box('Agent', 'Daily summary')).not.toBeChecked();
    expect(putBodies).toEqual([]);
  });

  it('says so when the default cannot be loaded', async () => {
    failLoad = true;
    renderDefaults();
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
  });

  it('paints in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <DigestDefaults />
      </QueryClientProvider>,
      'tr',
    );
    expect(await screen.findByText('Çalışma alanı varsayılanı')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Kurucu · Günlük özet' })).toBeChecked();
  });
});
