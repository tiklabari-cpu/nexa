/**
 * The operator sign-in and the shell, end to end against a fake platform API (tm 389.6 ·
 * FR-ADMIN-01/02). What is under test is the SPA's reaction to the server's answers: the
 * two-step sign-in with its token swap, the enrolment screen and its one-time recovery sheet,
 * a reloaded tab resuming at the right step, a session that ends underneath the operator, and
 * the menu and the route guard for each role. The server's own gates have their own suite
 * (`apps/api/test/integration/platform-auth.test.ts`).
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_STORAGE_KEY, api, useAuth } from './lib/auth-store.js';
import { installFakePlatform, renderApp, resetSession } from './test/render-app.js';
import { setLocale } from './test/i18n.js';

const EMAIL = 'ops@example.com';
const PASSWORD = 'correct horse battery staple';

afterEach(resetSession);

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

async function signInWithPassword(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText('Email'), EMAIL);
  await user.type(screen.getByLabelText('Password'), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('signed out', () => {
  it('shows the PLATFORM strip with the region, before anyone has signed in', async () => {
    installFakePlatform({ region: 'eu' });
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Sign in to the platform panel' }),
    ).toBeVisible();
    expect(await screen.findByText('PLATFORM · EU')).toBeVisible();
    // The tab says which panel it is, too.
    expect(document.title).toMatch(/^\[OPS\] /);
  });

  it('says only that the credentials are wrong — never which half', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByLabelText('Email'), EMAIL);
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is wrong, or this account is disabled.',
    );
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    // A 401 on the login route is a handler's answer, not an ended session.
    expect(screen.queryByText('Your session ended. Sign in again.')).toBeNull();
    expect(fake.calls('/auth/me')).toHaveLength(0);
  });

  it('validates the form before it sends anything', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(fake.calls('/auth/login')).toHaveLength(0);
  });

  it('renders in Turkish when the operator picks it', async () => {
    installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'tr');

    expect(
      await screen.findByRole('heading', { name: 'Platform paneline giriş yapın' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Parola')).toBeVisible();
  });
});

describe('the code step for an enrolled operator', () => {
  it('trades the password-stage token for an active one and opens the shell', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await signInWithPassword(user);
    expect(
      await screen.findByRole('heading', { name: 'Enter your authenticator code' }),
    ).toBeVisible();
    const passwordToken = fake.tokens.password;
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(passwordToken);

    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('navigation', { name: 'Main menu' })).toBeVisible();
    // The password-stage token is gone from the tab; the active one replaced it.
    expect(fake.tokens.active).not.toBeNull();
    expect(fake.tokens.active).not.toBe(passwordToken);
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(fake.tokens.active);
    // …and the operator's own address and role are on the strip.
    expect(screen.getByText('Signed in as ops@example.com')).toBeVisible();
    expect(screen.getByText('Superadmin')).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });

  it('stays on the code step after a wrong code, and says so without leaving', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await signInWithPassword(user);
    await user.type(await screen.findByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work.');
    expect(screen.getByRole('heading', { name: 'Enter your authenticator code' })).toBeVisible();
    expect(fake.tokens.active).toBeNull();
  });

  it('accepts a recovery code in place of the app code', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await signInWithPassword(user);
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code instead' }));
    await user.type(screen.getByLabelText('Recovery code'), 'ABCDE-FGHJK');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('navigation', { name: 'Main menu' })).toBeVisible();
    expect(fake.calls('/auth/totp/verify')[0]!.body).toEqual({ recovery_code: 'ABCDE-FGHJK' });
  });

  it('goes back to the password page when the operator cancels', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await signInWithPassword(user);
    await user.click(await screen.findByRole('button', { name: 'Use a different account' }));

    expect(
      await screen.findByRole('heading', { name: 'Sign in to the platform panel' }),
    ).toBeVisible();
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(fake.calls('/auth/logout')).toHaveLength(1);
  });

  it('resumes at the code step when a tab with a password-stage token is reloaded', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    const first = renderApp();

    await signInWithPassword(user);
    await screen.findByRole('heading', { name: 'Enter your authenticator code' });
    first.unmount();
    act(() => useAuth.setState({ status: 'unknown', step: null, me: null }));

    renderApp();

    // `GET /auth/me` answered 403 `platform_totp_required` with `details.next`.
    expect(
      await screen.findByRole('heading', { name: 'Enter your authenticator code' }),
    ).toBeVisible();
    expect(fake.calls('/auth/me')).toHaveLength(1);
  });

  it('resumes a signed-in tab without asking for the password again', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    const first = renderApp();

    await signInWithPassword(user);
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('navigation', { name: 'Main menu' });
    first.unmount();
    act(() => useAuth.setState({ status: 'unknown', me: null }));

    renderApp();

    expect(await screen.findByRole('navigation', { name: 'Main menu' })).toBeVisible();
    expect(fake.calls('/auth/login')).toHaveLength(1);
  });
});

describe('enrolling the authenticator', () => {
  it('asks for the secret once — even when the dev server runs every effect twice — and shows it', async () => {
    const fake = installFakePlatform({ enrolled: false });
    const user = userEvent.setup();
    renderApp('/', { strict: true });

    await user.type(await screen.findByLabelText('Email'), EMAIL);
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
    expect(await screen.findByTestId('enroll-secret')).toHaveTextContent(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    );
    // The server replaces an unconfirmed secret on every call: two calls would leave the
    // operator typing a secret that is already dead.
    expect(fake.calls('/auth/totp/enroll')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open in the authenticator app' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^otpauth:\/\/totp\//),
    );
  });

  it('holds the shell back behind the one-time recovery sheet', async () => {
    const fake = installFakePlatform({ enrolled: false });
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByLabelText('Email'), EMAIL);
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByTestId('enroll-secret');
    await user.type(screen.getByLabelText('Code from the app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not match.');

    await user.clear(screen.getByLabelText('Code from the app'));
    await user.type(screen.getByLabelText('Code from the app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    const sheet = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(10);
    // Signed in underneath, but the shell is not reachable until the sheet is acknowledged.
    expect(screen.queryByRole('navigation', { name: 'Main menu' })).toBeNull();
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(fake.tokens.active);

    const proceed = screen.getByRole('button', { name: 'Continue to the panel' });
    expect(proceed).toBeDisabled();
    await user.click(screen.getByLabelText('I have saved these codes'));
    await user.click(proceed);

    expect(await screen.findByRole('navigation', { name: 'Main menu' })).toBeVisible();
    expect(useAuth.getState().recoveryCodes).toBeNull();
  });

  it('turns a dead session into the sign-in page instead of retrying a code for ever', async () => {
    const fake = installFakePlatform({ enrolled: false });
    const user = userEvent.setup();
    renderApp();

    await user.type(await screen.findByLabelText('Email'), EMAIL);
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('enroll-secret');

    fake.endSession();
    await user.type(screen.getByLabelText('Code from the app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    // The 401 on `activate` alone is ambiguous (a wrong code answers it too), so the store
    // asks `/auth/me`; its 401 is what ends the session.
    expect(
      await screen.findByRole('heading', { name: 'Sign in to the platform panel' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in again.');
  });
});

describe('a session that ends underneath the operator', () => {
  it('falls back to the sign-in page, with the reason, on the next 401', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await signInWithPassword(user);
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('navigation', { name: 'Main menu' });

    fake.endSession();
    await act(async () => {
      await api.get('/auth/me').catch(() => undefined);
    });

    expect(
      await screen.findByRole('heading', { name: 'Sign in to the platform panel' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in again.');
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('signs out on request: tells the server, forgets the token', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();

    await signInWithPassword(user);
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('navigation', { name: 'Main menu' });
    const activeToken = fake.tokens.active;

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByRole('heading', { name: 'Sign in to the platform panel' }),
    ).toBeVisible();
    expect(fake.calls('/auth/logout')).toHaveLength(1);
    expect(fake.calls('/auth/logout')[0]!.headers.get('Authorization')).toBe(
      `Bearer ${activeToken}`,
    );
    expect(globalThis.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    // An own sign-out is not "your session ended".
    expect(screen.queryByText('Your session ended. Sign in again.')).toBeNull();
  });
});

describe('the platform client', () => {
  it('sends the bearer token, the language, no brand header and no cookie', async () => {
    const fake = installFakePlatform();
    const user = userEvent.setup();
    renderApp();
    setLocale('tr');

    await user.type(await screen.findByLabelText('E-posta'), EMAIL);
    await user.type(screen.getByLabelText('Parola'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Devam' }));
    await user.type(await screen.findByLabelText('Doğrulayıcı kodu'), '123456');
    await user.click(screen.getByRole('button', { name: 'Doğrula' }));
    await screen.findByRole('navigation', { name: 'Ana menü' });

    const me = fake.calls('/auth/me').at(-1)!;
    expect(me.headers.get('Authorization')).toBe(`Bearer ${fake.tokens.active}`);
    expect(me.headers.get('X-SiyahTus-Locale')).toBe('tr');
    expect([...me.headers.keys()].some((name) => name.toLowerCase().includes('brand'))).toBe(false);
    for (const request of fake.requests) expect(request.path.startsWith('/platform')).toBe(false);
  });
});

describe('invitations', () => {
  it('reads the token from the fragment, drops it from the address bar, and goes on to enrolment', async () => {
    const fake = installFakePlatform({ enrolled: false });
    const user = userEvent.setup();
    globalThis.history.replaceState(null, '', '/invite#token=good-invite');
    renderApp('/invite');

    expect(await screen.findByRole('heading', { name: 'Accept your invitation' })).toBeVisible();
    expect(globalThis.location.hash).toBe('');

    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter at least 12 characters.');
    expect(fake.calls('/auth/invite/accept')).toHaveLength(0);

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));

    expect(await screen.findByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
    expect(fake.calls('/auth/invite/accept')[0]!.body).toEqual({
      token: 'good-invite',
      password: 'a long enough password',
    });
  });

  it('says so when the link carries no token', async () => {
    installFakePlatform();
    renderApp('/invite');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation link is incomplete.',
    );
  });

  it('says so when the invitation is spent, and stays on the page', async () => {
    installFakePlatform();
    const user = userEvent.setup();
    globalThis.history.replaceState(null, '', '/invite#token=spent');
    renderApp('/invite');

    await user.type(await screen.findByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This invitation is not valid any more.'),
    );
  });
});
