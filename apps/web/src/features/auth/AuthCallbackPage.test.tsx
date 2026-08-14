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
import { useAuth } from '../../lib/auth-store.js';

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
        throw new Error('This sign-in did not start in this browser.');
      }),
    });

    await renderCallback('?code=abc123&state=xyz');

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not start in this browser/);
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });
});
