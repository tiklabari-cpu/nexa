/**
 * The landing point of a federated sign-in (NFR-S11 · S11-i).
 *
 * Three things are worth pinning, and all three are failures the screen has to
 * survive rather than happy paths: the code is redeemed exactly once (the
 * exchange is single-use, and StrictMode mounts every effect twice), a callback
 * with nothing to redeem says so instead of hanging on "Signing you in…", and a
 * refused exchange leaves a way back to the sign-in page.
 */
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthCallbackPage } from './AuthCallbackPage.js';
import { ApiClientError } from '../../lib/api-client.js';
import { AuthFlowError } from '../../lib/auth-flow-error.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const original = useAuth.getState();

/**
 * Awaited, because the redemption this page runs on mount settles in a
 * microtask: rendering without draining it leaves the resulting `setState`
 * outside `act`, which React reports as a warning on a test that then passes
 * anyway — noise that trains a reader to ignore the warning that matters.
 */
async function renderCallback(search: string): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/auth/callback${search}`]}>
        <AuthCallbackPage />
      </MemoryRouter>,
    );
  });
}

afterEach(() => {
  useAuth.setState({ completeSsoLogin: original.completeSsoLogin });
});

describe('AuthCallbackPage', () => {
  it('redeems the code once, with the state the server echoed back', async () => {
    const completeSsoLogin = vi.fn(async () => undefined);
    useAuth.setState({ completeSsoLogin });

    await renderCallback('?code=abc123&state=xyz');

    await waitFor(() => expect(completeSsoLogin).toHaveBeenCalledWith('abc123', 'xyz'));
    // An authorization code is single-use: a second attempt would report a
    // failure on a sign-in that worked.
    expect(completeSsoLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/Signing you in/);
  });

  it('does not sit waiting when there is no code to redeem', async () => {
    const completeSsoLogin = vi.fn(async () => undefined);
    useAuth.setState({ completeSsoLogin });

    await renderCallback('?error=access_denied');

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not complete/);
    expect(completeSsoLogin).not.toHaveBeenCalled();
  });

  it('shows why a refused exchange failed, and offers the way back', async () => {
    useAuth.setState({
      completeSsoLogin: vi.fn(async () => {
        throw new AuthFlowError('sso_not_started');
      }),
    });

    await renderCallback('?code=abc123&state=xyz');

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not start in this browser/);
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('says to confirm the address, not the API prose, when that is the refusal (tm 257.16)', async () => {
    useAuth.setState({
      completeSsoLogin: vi.fn(async () => {
        throw new ApiClientError({
          type: 'not_allowed',
          status: 403,
          message: 'Confirm your email address first.',
          requestId: 'req_cb1',
          details: { reason: 'email_unverified' },
        });
      }),
    });

    await renderCallback('?code=abc123&state=xyz');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Confirm your email address before signing in/);
    expect(alert).not.toHaveTextContent('Confirm your email address first.');
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });
});

describe('AuthCallbackPage localisation (NFR-I18N2)', () => {
  afterEach(() => resetLocale());

  it('shows the waiting status in Turkish when that is the active locale', async () => {
    useAuth.setState({ completeSsoLogin: vi.fn(async () => undefined) });

    await act(async () => {
      renderWithLocale(
        <MemoryRouter initialEntries={['/auth/callback?code=abc123&state=xyz']}>
          <AuthCallbackPage />
        </MemoryRouter>,
        'tr',
      );
    });

    expect(screen.getByRole('status')).toHaveTextContent('Oturumunuz açılıyor…');
  });

  it('words a refused exchange in Turkish, from the store’s code and not its message (O14, tm 259.18)', async () => {
    useAuth.setState({
      completeSsoLogin: vi.fn(async () => {
        throw new AuthFlowError('sso_not_started');
      }),
    });

    await act(async () => {
      renderWithLocale(
        <MemoryRouter initialEntries={['/auth/callback?code=abc123&state=xyz']}>
          <AuthCallbackPage />
        </MemoryRouter>,
        'tr',
      );
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bu oturum açma bu tarayıcıda başlatılmamış.');
    expect(alert).not.toHaveTextContent(/did not start/);
  });

  it('puts an unexpected thrown value in the generic Turkish sentence, never its text', async () => {
    useAuth.setState({
      completeSsoLogin: vi.fn(async () => {
        throw new Error('Failed to fetch');
      }),
    });

    await act(async () => {
      renderWithLocale(
        <MemoryRouter initialEntries={['/auth/callback?code=abc123&state=xyz']}>
          <AuthCallbackPage />
        </MemoryRouter>,
        'tr',
      );
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Oturum açma başarısız oldu.');
  });
});
