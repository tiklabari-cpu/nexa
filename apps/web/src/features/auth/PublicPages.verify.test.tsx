/**
 * Sign-up email verification on the panel (tm 257.16, FR-MOD-00.2).
 *
 * A deployment that verifies answers sign-up with 202 and no session: the page
 * stays put, says where to look and offers the link again. One that does not
 * answers 201 and signs straight in, exactly as before — the older tests in
 * `PublicPages.test.tsx` pin that half and are untouched.
 *
 * `ApiClient.prototype.post` is the seam, as there: the pages hold a module-level
 * client that bound `globalThis.fetch` at import.
 */
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { SignUpPage, VerifyEmailPage } from './PublicPages.js';
import { ApiClient, ApiClientError } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import type { DeploymentConfig } from '@siyahtus/types';

const deployment = vi.hoisted(() => ({
  current: {
    pilot_mode: false,
    contact_email: null,
    signup_enabled: true,
    email_verification_required: true,
    privacy_policy_url: null,
    terms_url: null,
    terms_version: null,
  } as DeploymentConfig,
}));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

function renderAt(ui: ReactElement, path = '/'): void {
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

const originalSignIn = useAuth.getState().signIn;
const SENT = 'If that address is waiting to be confirmed, a new link is on its way.';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  useAuth.setState({ signIn: originalSignIn });
});

describe('SignUpPage email verification (FR-MOD-00.2)', () => {
  async function fillAndSubmit(): Promise<void> {
    await userEvent.type(screen.getByLabelText('Workspace name'), 'Acme');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
  }

  it('still signs straight in when the server answers with a session', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      memberships: [{ license_id: '7' }],
    });
    renderAt(<SignUpPage />);
    await fillAndSubmit();

    await vi.waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('robin@example.com', 'longenoughpass', '7'),
    );
    expect(screen.queryByText('Check your inbox')).toBeNull();
  });

  it('shows the check-your-inbox state with the address on a 202, and does not sign in', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({ message: 'Check your inbox.' });
    renderAt(<SignUpPage />);
    await fillAndSubmit();

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByText(/robin@example\.com/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('holds the resend button for 60 seconds, then sends and answers the same way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = vi
      .spyOn(ApiClient.prototype, 'post')
      .mockResolvedValue({ message: 'Check your inbox.' });
    renderAt(<SignUpPage />);
    await fillAndSubmit();
    await screen.findByRole('heading', { name: 'Check your inbox' });

    // The mail went out a moment ago: the button is waiting, not offering.
    expect(screen.getByRole('button', { name: /Send again in \d+ s/ })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const resend = screen.getByRole('button', { name: 'Send the link again' });
    expect(resend).toBeEnabled();

    await userEvent.click(resend);
    expect(post).toHaveBeenLastCalledWith('/auth/verify-email/resend', {
      email: 'robin@example.com',
    });
    await screen.findByText(SENT);
    // And it waits again — a second click inside the minute cannot happen.
    expect(screen.getByRole('button', { name: /Send again in \d+ s/ })).toBeDisabled();
  });

  it('gives the same answer when the resend call is refused', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const post = vi.spyOn(ApiClient.prototype, 'post');
    post.mockResolvedValueOnce({ message: 'Check your inbox.' });
    renderAt(<SignUpPage />);
    await fillAndSubmit();
    await screen.findByRole('heading', { name: 'Check your inbox' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    post.mockRejectedValue(
      new ApiClientError({
        type: 'too_many_requests',
        status: 429,
        message: 'Too many.',
        requestId: 'req_9',
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send the link again' }));
    await screen.findByText(SENT);
  });
});

describe('VerifyEmailPage (FR-MOD-00.2)', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

  it('keeps the button disabled until the password is long enough', async () => {
    renderAt(<VerifyEmailPage />, `/verify-email?token=${TOKEN}`);
    const submit = screen.getByRole('button', { name: 'Confirm and sign in' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    expect(submit).toBeEnabled();
  });

  it('sends the token and password, then signs in to the first workspace', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    const post = vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      account: { email: 'robin@example.com' },
      memberships: [{ license_id: '41' }, { license_id: '42' }],
    });
    renderAt(<VerifyEmailPage />, `/verify-email?token=${TOKEN}`);

    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));

    await vi.waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('robin@example.com', 'longenoughpass', '41'),
    );
    expect(post).toHaveBeenCalledWith('/auth/verify-email', {
      token: TOKEN,
      password: 'longenoughpass',
    });
  });

  it('answers a refusal with one neutral sentence, keeps the password form, and offers a new link', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(
      new ApiClientError({
        type: 'authentication',
        status: 401,
        message: 'Invalid or expired link.',
        requestId: 'req_v1',
      }),
    );
    renderAt(<VerifyEmailPage />, `/verify-email?token=${TOKEN}`);
    // No resend form until something has gone wrong.
    expect(screen.queryByText('Need a new link?')).toBeNull();

    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
    expect(signIn).not.toHaveBeenCalled();
    // A wrong password leaves the link working, so the form stays to retry on.
    expect(screen.getByRole('button', { name: 'Confirm and sign in' })).toBeInTheDocument();
    expect(screen.getByText('Need a new link?')).toBeInTheDocument();
  });

  it('does not ask for a password on a link that cannot be real (UX audit D10)', async () => {
    const post = vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({ message: 'ok' });
    renderAt(<VerifyEmailPage />, '/verify-email?token=garbage');

    // Shorter than any token the API issues: the error comes first, with the
    // way out, and no password field to fill in for nothing.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This link is incomplete. Ask for a new one below.',
    );
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByText('Need a new link?')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('asks for a new link by address and says the same thing whatever the address', async () => {
    const post = vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({ message: 'ok' });
    renderAt(<VerifyEmailPage />, '/verify-email');

    // No token at all: the password form has nothing to spend, so only the
    // way out is on offer.
    expect(
      screen.getByText('This link is incomplete. Ask for a new one below.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm and sign in' })).toBeNull();

    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send link' }));

    expect(post).toHaveBeenCalledWith('/auth/verify-email/resend', { email: 'robin@example.com' });
    await screen.findByText(SENT);
  });

  it('says the address is confirmed when sign-in fails afterwards', async () => {
    useAuth.setState({
      signIn: vi.fn(async () => {
        throw new Error('network');
      }),
    });
    vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      account: { email: 'robin@example.com' },
      memberships: [{ license_id: '41' }],
    });
    renderAt(<VerifyEmailPage />, `/verify-email?token=${TOKEN}`);
    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/address is confirmed/i);
  });
});
