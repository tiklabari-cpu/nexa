/**
 * Settings › My profile (RL-06 · tm 327): the member's own name and the name
 * visitors see, saved through the SaveBar with `PATCH /agents/me`, and a
 * password change with the current password (`POST /auth/password`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyProfile } from './MyProfile.js';
import { useAuth, type CurrentAgent } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

function okJson(body: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function errorJson(status: number, type: string, details?: Record<string, unknown>): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({
      error: { type, message: 'Refused.', request_id: 'req_test', ...(details ? { details } : {}) },
    }),
  } as unknown as Response;
}

const AGENT = {
  account_id: 'acc-1',
  email: 'deniz@acme.test',
  name: 'Deniz Yilmaz',
  public_name: null,
  role: 'agent',
  organization_id: 'org-1',
  license_id: '1',
  scopes: ['accounts--my:rw'],
  routing_status: 'accepting_chats',
} as unknown as CurrentAgent;

let calls: Array<{ method: string; url: string; body: unknown }>;
let passwordAnswer: () => Response;

beforeEach(() => {
  calls = [];
  passwordAnswer = () => okJson(null, 204);
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: AGENT });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url: String(url), body });
      if (String(url).endsWith('/agents/me') && method === 'PATCH') {
        const patch = body as { name?: string; public_name?: string | null };
        return okJson({
          id: 'acc-1',
          name: patch.name ?? AGENT.name,
          public_name: patch.public_name === undefined ? null : patch.public_name,
        });
      }
      if (String(url).endsWith('/auth/password')) return passwordAnswer();
      return okJson({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MyProfile />
    </QueryClientProvider>,
  );
}

const sent = (suffix: string) => calls.filter((call) => call.url.endsWith(suffix));

describe('MyProfile — names', () => {
  it('saves a new name and visitor name, and the account menu reads the new name', async () => {
    renderScreen();
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('Deniz Yilmaz');

    await userEvent.clear(name);
    await userEvent.type(name, 'Deniz Yılmaz');
    await userEvent.type(screen.getByLabelText('Name visitors see (optional)'), 'Deniz');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(sent('/agents/me')).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        body: { name: 'Deniz Yılmaz', public_name: 'Deniz' },
      }),
    ]);
    expect(useAuth.getState().agent).toMatchObject({ name: 'Deniz Yılmaz', public_name: 'Deniz' });
  });

  it('sends only the field that changed, and an emptied visitor name as null', async () => {
    useAuth.setState({ agent: { ...AGENT, public_name: 'Deniz' } });
    renderScreen();

    await userEvent.clear(screen.getByLabelText('Name visitors see (optional)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('/agents/me')).toHaveLength(1));
    expect(sent('/agents/me')[0]?.body).toEqual({ public_name: null });
  });

  it('keeps Save off for an empty name, with the reason under the field', async () => {
    renderScreen();
    await userEvent.clear(screen.getByLabelText('Name'));

    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('MyProfile — password', () => {
  async function fill(current: string, next: string, confirm = next): Promise<void> {
    await userEvent.type(screen.getByLabelText('Current password'), current);
    await userEvent.type(screen.getByLabelText('New password'), next);
    await userEvent.type(screen.getByLabelText('Repeat the new password'), confirm);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
  }

  it('changes the password with the current one and says the other devices were signed out', async () => {
    renderScreen();
    expect(
      screen.getByText(/every other device signed in to your account is signed out/),
    ).toBeInTheDocument();

    await fill('old-password', 'a-brand-new-long-password');

    expect(
      await screen.findByText('Password changed. Your other devices have been signed out.'),
    ).toBeInTheDocument();
    expect(sent('/auth/password')[0]?.body).toEqual({
      current_password: 'old-password',
      new_password: 'a-brand-new-long-password',
    });
    // Nothing of the password stays in the form.
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('shows a wrong current password under that field and keeps the rest', async () => {
    passwordAnswer = () => errorJson(401, 'authentication');
    renderScreen();

    await fill('not-it', 'a-brand-new-long-password');

    expect(await screen.findByText('That is not your current password.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('a-brand-new-long-password');
  });

  it('refuses a mismatched repeat or a short password before asking the server', async () => {
    renderScreen();

    await fill('old-password', 'a-brand-new-long-password', 'a-different-long-password');
    expect(await screen.findByText('The two new passwords do not match.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    expect(screen.getByText('Use 12 to 200 characters.')).toBeInTheDocument();
    expect(sent('/auth/password')).toHaveLength(0);
  });

  it('explains a workspace that signs its members in through an identity provider', async () => {
    passwordAnswer = () => errorJson(403, 'not_allowed', { reason: 'sso_enforced' });
    renderScreen();

    await fill('old-password', 'a-brand-new-long-password');

    expect(
      await screen.findByText(
        'This workspace signs you in through your identity provider. Change your password there.',
      ),
    ).toBeInTheDocument();
  });

  it('reads in Turkish', async () => {
    const view = renderWithLocale(
      <QueryClientProvider client={new QueryClient()}>
        <MyProfile />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByRole('heading', { name: 'Profilim' })).toBeInTheDocument();
    expect(screen.getByLabelText('Oyuncuların gördüğü ad (isteğe bağlı)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Şifreyi değiştir' })).toBeInTheDocument();
    view.restore();
  });
});
