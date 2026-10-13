/**
 * Settings → Appearance (owner, 2026-10-13): the owner picks the workspace's
 * default panel font from five cards and saves or removes it; anyone else sees
 * the section read-only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Appearance } from './Appearance.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

function okJson(body: unknown): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as never;
}

let puts: Array<Record<string, unknown>>;
let current: { font_preset: string | null; font_preset_set_at: string | null };

beforeEach(() => {
  puts = [];
  current = { font_preset: null, font_preset_set_at: null };
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/settings/appearance')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { font_preset: string | null };
          puts.push(body);
          current = {
            font_preset: body.font_preset,
            font_preset_set_at: body.font_preset ? '2026-10-13T09:00:00.000Z' : null,
          };
        }
        return okJson(current);
      }
      return okJson({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSection(canEdit: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Appearance canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

describe('Appearance', () => {
  it('shows five cards, each with the sample sentence in its own face', async () => {
    renderSection(true);
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(screen.getAllByText('Pijamalı hasta yağız şoföre çabucak güvendi.')).toHaveLength(5);
    const figtree = screen.getByText('Figtree');
    expect(figtree).toHaveAttribute('lang', 'en');
    expect(figtree.style.fontFamily).toMatch(/Figtree Variable/);
    expect(screen.getByText(/No workspace default/)).toBeInTheDocument();
  });

  it('lets the owner save a default and then remove it', async () => {
    renderSection(true);
    await userEvent.click(await screen.findByRole('radio', { name: /Figtree/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save default' }));
    await waitFor(() => expect(puts).toEqual([{ font_preset: 'figtree' }]));
    expect(await screen.findByRole('status')).toHaveTextContent(/Saved/);
    expect(screen.getByText(/Current default: Figtree/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove default' }));
    await waitFor(() => expect(puts).toEqual([{ font_preset: 'figtree' }, { font_preset: null }]));
    expect(await screen.findByText('Default removed.')).toBeInTheDocument();
  });

  it('is read-only for anyone but the owner', async () => {
    renderSection(false);
    const radios = await screen.findAllByRole('radio');
    for (const radio of radios) expect(radio).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save default' })).toBeNull();
    expect(
      screen.getByText('Only the workspace owner can change this setting.'),
    ).toBeInTheDocument();
  });
});

describe('Appearance localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <Appearance canEdit={false} />
      </QueryClientProvider>,
      'tr',
    );
    expect(
      await screen.findByText('Bu ayarı yalnız çalışma alanı sahibi değiştirebilir.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Inter (varsayılan)')).toBeInTheDocument();
  });
});
