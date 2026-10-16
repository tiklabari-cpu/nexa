/**
 * Settings › Security › Member recognition (ID-03 · tm 287.5): the saved
 * lifetime lands in the form, only what changed is PATCHed, the bounds are held
 * before the network, the key is described and never shown, a rotation and the
 * bulk "forget everyone" both ask first (and say what a zero grace window
 * does), and a caller without `access_rules:rw` gets a read-only screen.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberRecognition } from './MemberRecognition.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const DAY = 86_400;

interface View {
  token_ttl_seconds: number;
  possible_matches_enabled: boolean;
  key: {
    version: number;
    created_at: string;
    previous_version: number | null;
    previous_valid_until: string | null;
  } | null;
  tokens_revoked_before: string | null;
  updated_at: string | null;
}

const DEFAULTS: View = {
  token_ttl_seconds: 30 * DAY,
  possible_matches_enabled: true,
  key: null,
  tokens_revoked_before: null,
  updated_at: null,
};

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function errorJson(status: number, message: string): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({ error: { type: 'validation', message, request_id: 'req_test' } }),
  } as unknown as Response;
}

let current: View;
let patches: Array<Record<string, unknown>>;
let rotations: Array<Record<string, unknown>>;
let revocations: number;
let nextRotateFails: boolean;

function stubFetch(view: View): void {
  current = view;
  patches = [];
  rotations = [];
  revocations = 0;
  nextRotateFails = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = new URL(String(url), 'http://localhost').pathname;
      if (path.endsWith('/settings/member-recognition') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        patches.push(body);
        current = {
          ...current,
          ...body,
          updated_at: '2026-10-16T10:00:00.000Z',
        } as View;
        return okJson(current);
      }
      if (path.endsWith('/rotate-key') && method === 'POST') {
        if (nextRotateFails) return errorJson(500, 'The key store is busy.');
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        rotations.push(body);
        current = {
          ...current,
          key: {
            version: (current.key?.version ?? 0) + 1,
            created_at: '2026-10-16T10:05:00.000Z',
            previous_version: current.key?.version ?? null,
            previous_valid_until: current.key ? '2026-10-23T10:05:00.000Z' : null,
          },
        };
        return okJson(current);
      }
      if (path.endsWith('/revoke-all') && method === 'POST') {
        revocations += 1;
        current = { ...current, tokens_revoked_before: '2026-10-16T10:10:00.000Z' };
        return okJson(current);
      }
      return okJson(current);
    }),
  );
}

function renderScreen(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemberRecognition canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  stubFetch(DEFAULTS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('MemberRecognition', () => {
  it('reads a never-saved workspace as 30 days with possible matches on', async () => {
    renderScreen();

    expect(await screen.findByLabelText('Remember for')).toHaveValue(30);
    expect(screen.getByLabelText('Unit')).toHaveValue('days');
    expect(screen.getByRole('checkbox', { name: /Show possible matches/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a lifetime that is not a whole number of days in hours', async () => {
    stubFetch({ ...DEFAULTS, token_ttl_seconds: 36 * 3600 });
    renderScreen();

    expect(await screen.findByLabelText('Remember for')).toHaveValue(36);
    expect(screen.getByLabelText('Unit')).toHaveValue('hours');
  });

  it('saves the lifetime as whole seconds and sends only what changed', async () => {
    const user = userEvent.setup();
    renderScreen();

    const amount = await screen.findByLabelText('Remember for');
    await user.clear(amount);
    await user.type(amount, '90');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toStrictEqual({ token_ttl_seconds: 90 * DAY });
  });

  it('saves the possible-match switch alone', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('checkbox', { name: /Show possible matches/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toStrictEqual({ possible_matches_enabled: false });
  });

  it.each([
    ['0', 'days'],
    ['366', 'days'],
    ['12', 'hours'],
    ['1.5', 'days'],
  ])('refuses %s %s before it reaches the network', async (amountText, unit) => {
    const user = userEvent.setup();
    renderScreen();

    const amount = await screen.findByLabelText('Remember for');
    await user.selectOptions(screen.getByLabelText('Unit'), unit);
    await user.clear(amount);
    await user.type(amount, amountText);
    await user.tab();

    expect(await screen.findByText('Enter a whole number from 1 day to 365 days.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(patches).toHaveLength(0);
  });

  it('accepts exactly 24 hours and exactly 365 days', async () => {
    const user = userEvent.setup();
    renderScreen();

    const amount = await screen.findByLabelText('Remember for');
    await user.selectOptions(screen.getByLabelText('Unit'), 'hours');
    await user.clear(amount);
    await user.type(amount, '24');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toStrictEqual({ token_ttl_seconds: DAY });

    await user.selectOptions(screen.getByLabelText('Unit'), 'days');
    await user.clear(amount);
    await user.type(amount, '365');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toStrictEqual({ token_ttl_seconds: 365 * DAY });
  });

  it('describes the key without showing one, and the previous key’s deadline', async () => {
    stubFetch({
      ...DEFAULTS,
      key: {
        version: 3,
        created_at: '2026-10-10T08:00:00.000Z',
        previous_version: 2,
        previous_valid_until: '2026-10-17T08:00:00.000Z',
      },
    });
    renderScreen();

    expect(await screen.findByText('Current version')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText(/Version 2, still accepted until/)).toBeVisible();
  });

  it('says there is no key yet', async () => {
    renderScreen();
    expect(await screen.findByText(/No key yet\./)).toBeVisible();
  });

  it('asks before rotating, then sends the grace window in seconds', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Rotate the key' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the signing key?' });
    expect(dialog).toHaveTextContent('still recognised for 7 days');
    expect(rotations).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    await waitFor(() => expect(rotations).toHaveLength(1));
    expect(rotations[0]).toStrictEqual({ grace_period_seconds: 7 * DAY });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Current version')).toBeVisible();
  });

  it('names the emergency rotation when the grace window is 0', async () => {
    const user = userEvent.setup();
    renderScreen();

    const grace = await screen.findByLabelText('Keep the old key for (days)');
    await user.clear(grace);
    await user.type(grace, '0');
    expect(screen.getByText(/0 retires the old key at once/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Rotate the key' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the signing key?' });
    expect(dialog).toHaveTextContent('starts again as a new visitor');
    await user.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    await waitFor(() => expect(rotations).toHaveLength(1));
    expect(rotations[0]).toStrictEqual({ grace_period_seconds: 0 });
  });

  it('holds the grace window to 0–30 days', async () => {
    const user = userEvent.setup();
    renderScreen();

    const grace = await screen.findByLabelText('Keep the old key for (days)');
    await user.clear(grace);
    await user.type(grace, '31');
    expect(screen.getByText('Enter a whole number from 0 to 30.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rotate the key' })).toBeDisabled();
  });

  it('keeps the dialog open and says so when the rotation is refused', async () => {
    const user = userEvent.setup();
    renderScreen();
    nextRotateFails = true;

    await user.click(await screen.findByRole('button', { name: 'Rotate the key' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the signing key?' });
    await user.click(within(dialog).getByRole('button', { name: 'Rotate key' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The key could not be rotated.',
    );
    expect(rotations).toHaveLength(0);
  });

  it('asks before forgetting every visitor, and shows when it last happened', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Forget all visitors' }));
    const dialog = screen.getByRole('dialog', { name: 'Forget every returning visitor?' });
    expect(dialog).toHaveTextContent('This cannot be undone.');
    expect(revocations).toBe(0);

    await user.click(within(dialog).getByRole('button', { name: 'Forget all visitors' }));
    await waitFor(() => expect(revocations).toBe(1));
    expect(await screen.findByText(/Last done/)).toBeVisible();
  });

  it('cancelling the dialog forgets nobody', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Forget all visitors' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Forget every returning visitor?' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );
    expect(revocations).toBe(0);
  });

  it('is read-only without write access: values shown, no way to change or forget', async () => {
    renderScreen(false);

    expect(await screen.findByLabelText('Remember for')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Show possible matches/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rotate the key' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forget all visitors' })).not.toBeInTheDocument();
  });

  it('renders in Turkish', async () => {
    renderWithLocale(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemberRecognition canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByLabelText('Hatırlama süresi')).toHaveValue(30);
    expect(screen.getByRole('button', { name: 'Anahtarı yenile' })).toBeVisible();
  });
});
