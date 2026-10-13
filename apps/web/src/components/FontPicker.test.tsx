/**
 * The account menu's font picker (owner, 2026-10-13): each option in its own
 * face, a pick saved to the caller's own preferences and then replaced by the
 * server's resolved answer, and a note saying where the font comes from.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelAppearance } from '@siyahtus/types';
import { FontPicker } from './FontPicker.js';
import { useAuth, type CurrentAgent } from '../lib/auth-store.js';
import { useFontStore } from '../lib/font.js';

const WORKSPACE_FIGTREE: PanelAppearance = {
  effective_font_preset: 'figtree',
  source: 'workspace',
  workspace_font_preset: 'figtree',
  workspace_font_preset_set_at: '2026-10-12T09:00:00.000Z',
  user_font_preset: null,
  user_font_preset_set_at: null,
};

const USER_NUNITO: PanelAppearance = {
  ...WORKSPACE_FIGTREE,
  effective_font_preset: 'nunito',
  source: 'user',
  user_font_preset: 'nunito',
  user_font_preset_set_at: '2026-10-13T09:00:00.000Z',
};

function okJson(body: unknown): Response {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as never;
}

let puts: Array<Record<string, unknown>>;
let putFails: boolean;

beforeEach(() => {
  puts = [];
  putFails = false;
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: { account_id: 'a', role: 'agent', scopes: [] } as unknown as CurrentAgent,
  });
  useFontStore.getState().setAppearance(WORKSPACE_FIGTREE);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/agents/me/ui-preferences') && init?.method === 'PUT') {
        if (putFails) {
          return {
            ok: false,
            status: 500,
            headers: { get: () => null },
            json: async () => ({ error: { type: 'internal', message: 'x', request_id: 'r' } }),
          } as never;
        }
        puts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return okJson({});
      }
      if (String(url).endsWith('/auth/me')) return okJson({ appearance: USER_NUNITO });
      return okJson({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  useFontStore.getState().setAppearance(undefined);
});

describe('FontPicker', () => {
  it('offers the workspace default and the five presets, each in its own face', () => {
    render(<FontPicker />);
    const select = screen.getByRole('combobox', { name: 'Font' });
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Workspace default',
      'Inter (default)',
      'Plus Jakarta Sans',
      'Manrope + DM Sans',
      'Nunito',
      'Figtree',
    ]);
    expect(options[5]!.style.fontFamily).toMatch(/Figtree Variable/);
    expect(options[5]).toHaveAttribute('lang', 'en');
    expect(select).toHaveValue('');
  });

  it('says the font comes from the workspace default', () => {
    render(<FontPicker />);
    expect(screen.getByTestId('font-source')).toHaveTextContent(/^Workspace default: Figtree · /);
  });

  it('paints a pick at once, saves it, then shows the server answer', async () => {
    render(<FontPicker />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Font' }), 'nunito');
    expect(document.documentElement.dataset.font).toBe('nunito');
    await waitFor(() => expect(puts).toEqual([{ font_preset: 'nunito' }]));
    await waitFor(() =>
      expect(screen.getByTestId('font-source')).toHaveTextContent(/^Your choice: Nunito · /),
    );
    expect(screen.getByRole('combobox', { name: 'Font' })).toHaveValue('nunito');
  });

  it('rolls the pick back and says so when the save fails', async () => {
    putFails = true;
    render(<FontPicker />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Font' }), 'nunito');
    expect(await screen.findByRole('alert')).toHaveTextContent('The font could not be saved.');
    expect(document.documentElement.dataset.font).toBe('figtree');
  });
});
