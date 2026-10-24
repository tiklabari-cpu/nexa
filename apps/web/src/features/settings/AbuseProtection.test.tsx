/**
 * Settings › Security › Abuse protection (tm 339.3 · GV-01).
 *
 * The enforcement is proven server-side (tm 339.1 / 339.2); this pins the
 * screen: the saved allowance and check mode render, Save writes only what
 * moved to `PATCH /settings/security`, a number the server would refuse never
 * leaves the form, a viewer without `access_rules` write gets no controls, and
 * today's use of the allowance appears only for the roles `GET /ai/usage`
 * answers — as counts, nothing else.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), patch: vi.fn() } }));

let currentRole = 'owner';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { role: string } }) => unknown) =>
      selector({ agent: { role: currentRole } }),
  };
});

const { AbuseProtection } = await import('./AbuseProtection.js');

const SECURITY = {
  banned_customer_ips: [],
  file_sharing_enabled: true,
  allowed_file_types: ['image/png'],
  max_file_size_bytes: 10_485_760,
  spam_filter_enabled: true,
  require_two_factor: false,
  ip_allowlist_enforced: false,
  session_idle_timeout_seconds: null,
  max_concurrent_sessions: null,
  ai_turns_per_customer_day: 40,
  captcha_mode: 'risk',
  updated_at: null,
};

function usage(perMember: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    day: '2026-10-24',
    resets_at: '2026-10-25T00:00:00.000Z',
    window_days: 30,
    time_zone: 'UTC',
    meters: [],
    daily: [],
    surfaces: [],
    alerts: [],
    alert_recipients: [],
    ...(perMember ? { per_member: perMember } : {}),
  };
}

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

let perMember: Record<string, unknown> | undefined;
let usageRequests = 0;

beforeEach(() => {
  currentRole = 'owner';
  perMember = { day: '2026-10-24', cap: 40, members_with_ai: 12, members_at_cap: 2 };
  usageRequests = 0;
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === '/settings/security') return Promise.resolve(SECURITY);
    if (path === '/ai/usage') {
      usageRequests += 1;
      return Promise.resolve(usage(perMember));
    }
    throw new Error(`unexpected GET ${path}`);
  });
  api.patch.mockImplementation((_path: string, body: Record<string, unknown>) =>
    Promise.resolve({ ...SECURITY, ...body }),
  );
});

const allowanceBox = (): HTMLInputElement =>
  screen.getByLabelText('AI replies per visitor per day') as HTMLInputElement;

describe('AbuseProtection', () => {
  it('shows the saved allowance and the saved check mode', async () => {
    renderComponent(<AbuseProtection canEdit />);
    await screen.findByLabelText('AI replies per visitor per day');

    expect(allowanceBox().value).toBe('40');
    expect(screen.getByRole('radio', { name: /Only when something looks wrong/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Never ask/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Before every new conversation/ })).not.toBeChecked();
    // The legend names the group for a screen reader.
    expect(
      screen.getByRole('group', { name: 'Human check in the chat widget' }),
    ).toBeInTheDocument();
  });

  it('saves only the field that moved', async () => {
    renderComponent(<AbuseProtection canEdit />);
    await screen.findByLabelText('AI replies per visitor per day');

    await userEvent.click(screen.getByRole('radio', { name: /Before every new conversation/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/security', {
        captcha_mode: 'always_on_chat_start',
      }),
    );

    await userEvent.clear(allowanceBox());
    await userEvent.type(allowanceBox(), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenLastCalledWith('/settings/security', {
        ai_turns_per_customer_day: 0,
      }),
    );
  });

  it('keeps a number the server would refuse in the form', async () => {
    renderComponent(<AbuseProtection canEdit />);
    await screen.findByLabelText('AI replies per visitor per day');

    for (const bad of ['10001', '1.5', '-3', '']) {
      await userEvent.clear(allowanceBox());
      if (bad) await userEvent.type(allowanceBox(), bad);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText('Enter a whole number from 0 to 10,000.')).toBeVisible();
    }
    expect(api.patch).not.toHaveBeenCalled();
    expect(allowanceBox()).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the server’s refusal instead of claiming it saved', async () => {
    api.patch.mockRejectedValueOnce(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'No.',
        requestId: 'req-1',
      }),
    );
    renderComponent(<AbuseProtection canEdit />);
    await screen.findByLabelText('AI replies per visitor per day');

    await userEvent.click(screen.getByRole('radio', { name: /Never ask/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('gives a viewer without write access the values and no way to change them', async () => {
    renderComponent(<AbuseProtection canEdit={false} />);
    await screen.findByLabelText('AI replies per visitor per day');

    expect(allowanceBox()).toBeDisabled();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('tells the owner where the check runs, for the privacy notice (K25)', async () => {
    renderComponent(<AbuseProtection canEdit />);
    expect(await screen.findByText(/Cloudflare Turnstile/)).toBeInTheDocument();
  });
});

describe('the allowance used today', () => {
  it('shows counts for an admin — the allowance, who the AI answered, who reached it', async () => {
    renderComponent(<AbuseProtection canEdit />);
    const card = (await screen.findByRole('region', { name: 'AI allowance today' })) as HTMLElement;

    expect(within(card).getByText('Allowance per visitor').nextSibling).toHaveTextContent(
      '40 a day',
    );
    expect(within(card).getByText('Visitors the AI answered').nextSibling).toHaveTextContent('12');
    expect(within(card).getByText('Reached the allowance').nextSibling).toHaveTextContent('2');
  });

  it('says there is no limit when the allowance is off', async () => {
    perMember = { day: '2026-10-24', cap: null, members_with_ai: 3, members_at_cap: 0 };
    renderComponent(<AbuseProtection canEdit />);
    const card = (await screen.findByRole('region', { name: 'AI allowance today' })) as HTMLElement;
    expect(within(card).getByText('No limit')).toBeInTheDocument();
  });

  it('asks an agent for nothing and shows no card — the route is admin and above', async () => {
    currentRole = 'agent';
    renderComponent(<AbuseProtection canEdit />);
    await screen.findByLabelText('AI replies per visitor per day');
    expect(usageRequests).toBe(0);
    expect(screen.queryByRole('region', { name: 'AI allowance today' })).toBeNull();
  });

  it('shows nothing, not zeros, from a server that predates the counts', async () => {
    perMember = undefined;
    renderComponent(<AbuseProtection canEdit />);
    await screen.findByLabelText('AI replies per visitor per day');
    await waitFor(() => expect(usageRequests).toBe(1));
    expect(screen.queryByRole('region', { name: 'AI allowance today' })).toBeNull();
  });
});
