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
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { JoinPage, SignUpPage, VerifyEmailPage } from './PublicPages.js';
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

describe('an invitation accepted before the address is proven (tm 282 · GV-03)', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

  it('signs in to the workspace the verification joined, not the first membership', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      account: { email: 'robin@example.com' },
      memberships: [{ license_id: '41' }, { license_id: '42' }],
      joined_license_ids: ['42'],
    });
    renderAt(<VerifyEmailPage />, `/verify-email?token=${TOKEN}`);

    await userEvent.type(screen.getByLabelText('Password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));

    await vi.waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('robin@example.com', 'longenoughpass', '42'),
    );
  });

  it('shows "confirm your email" on a 202 from the accept, offers the link again, and signs nobody in', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    vi.spyOn(ApiClient.prototype, 'get').mockResolvedValue({
      organization_name: 'Acme',
      email: 'robin@example.com',
      role: 'agent',
      needs_password: true,
    });
    const post = vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      verification_required: true,
      message: 'Check your inbox: confirm your email address to finish joining.',
    });
    renderAt(<JoinPage />, `/join?token=${TOKEN}`);

    await userEvent.type(await screen.findByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));

    expect(
      await screen.findByRole('heading', { name: 'Confirm your email to join' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/We sent a link to robin@example\.com\..*join Acme/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a password')).toBeNull();
    // The mail went out a moment ago: the resend waits first.
    expect(screen.getByRole('button', { name: /Send again in \d+ s/ })).toBeDisabled();
    expect(post).toHaveBeenCalledWith('/auth/invitations/accept', {
      token: TOKEN,
      name: 'Robin',
      password: 'longenoughpass',
    });
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('an existing account signs in to join (tm 421 · audit F04)', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

  function preview(needsPassword: boolean): void {
    vi.spyOn(ApiClient.prototype, 'get').mockResolvedValue({
      organization_name: 'Acme',
      email: 'robin@example.com',
      role: 'agent',
      needs_password: needsPassword,
    });
  }

  function signInRefusal(reason: 'sign_in_required' | 'password_incorrect'): ApiClientError {
    return new ApiClientError({
      type: 'invitation_requires_sign_in',
      status: 401,
      message: 'refused',
      requestId: 'req-1',
      details: { reason },
    });
  }

  /** The join page, plus a stand-in sign-in page to land on. */
  function renderJoin(): void {
    render(
      <MemoryRouter initialEntries={[`/join?token=${TOKEN}`]}>
        <Routes>
          <Route path="/join" element={<JoinPage />} />
          <Route path="/signin" element={<p>the sign-in page</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('asks for the account’s own password, sends it as current_password, and signs in to the workspace joined', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    preview(false);
    const post = vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      account: { id: 'acc-1', email: 'robin@example.com', name: 'Robin' },
      memberships: [{ license_id: '42' }],
    });
    renderJoin();

    const join = await screen.findByRole('button', { name: 'Join workspace' });
    expect(screen.getByText(/Enter its password to add this workspace/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a password')).toBeNull();
    expect(join).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), 'its-own-password');
    await userEvent.click(join);

    await vi.waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('robin@example.com', 'its-own-password', '42'),
    );
    expect(post).toHaveBeenCalledWith('/auth/invitations/accept', {
      token: TOKEN,
      current_password: 'its-own-password',
    });
  });

  it('turns into the sign-in form on a 401 invitation_requires_sign_in, and joins with the password', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    preview(true);
    const post = vi
      .spyOn(ApiClient.prototype, 'post')
      .mockRejectedValueOnce(signInRefusal('sign_in_required'))
      .mockResolvedValueOnce({
        account: { id: 'acc-1', email: 'robin@example.com', name: 'Robin' },
        memberships: [{ license_id: '42' }],
      });
    renderJoin();

    await userEvent.type(await screen.findByLabelText('Your name'), 'Robin');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'longenoughpass');
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));

    // Settled: the button is back from "Joining…".
    await screen.findByRole('button', { name: 'Join workspace' });
    expect(
      screen.getByText('This address already has a SiyahTuş account. Enter its password to join.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a password')).toBeNull();
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(signIn).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Password'), 'its-own-password');
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));
    await vi.waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('robin@example.com', 'its-own-password', '42'),
    );
    expect(post).toHaveBeenLastCalledWith('/auth/invitations/accept', {
      token: TOKEN,
      current_password: 'its-own-password',
    });
  });

  it('says a wrong password is wrong, under the field, and keeps the form', async () => {
    const signIn = vi.fn(async () => undefined);
    useAuth.setState({ signIn });
    preview(false);
    vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(signInRefusal('password_incorrect'));
    renderJoin();

    await userEvent.type(await screen.findByLabelText('Password'), 'not-the-password');
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));

    await screen.findByRole('button', { name: 'Join workspace' });
    expect(screen.getByText('That password is not correct.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByRole('link', { name: 'Forgot your password, or never set one?' }),
    ).toHaveAttribute('href', '/forgot-password');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('says the hour’s attempts are spent on a 429', async () => {
    preview(false);
    vi.spyOn(ApiClient.prototype, 'post').mockRejectedValue(
      new ApiClientError({
        type: 'too_many_requests',
        status: 429,
        message: 'slow down',
        requestId: 'req-2',
        retryAfterSeconds: 3600,
      }),
    );
    renderJoin();

    await userEvent.type(await screen.findByLabelText('Password'), 'its-own-password');
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));
    await screen.findByRole('button', { name: 'Join workspace' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many password attempts for this account. Wait an hour, then try again.',
    );
  });

  it('hands over to the sign-in page when the join stands but signing in wants another step', async () => {
    const signIn = vi.fn(async () => {
      throw new ApiClientError({
        type: 'two_factor_required',
        status: 401,
        message: 'code',
        requestId: 'req-3',
      });
    });
    useAuth.setState({ signIn });
    preview(false);
    vi.spyOn(ApiClient.prototype, 'post').mockResolvedValue({
      account: { id: 'acc-1', email: 'robin@example.com', name: 'Robin' },
      memberships: [{ license_id: '42' }],
    });
    renderJoin();

    await userEvent.type(await screen.findByLabelText('Password'), 'its-own-password');
    await userEvent.click(screen.getByRole('button', { name: 'Join workspace' }));
    expect(await screen.findByText('the sign-in page')).toBeInTheDocument();
  });
});
