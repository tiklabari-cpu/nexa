/**
 * Sign-in under the shared primitive (FR-EK-A.1): Submit stays disabled until
 * both credentials are present and the email is well formed, and a touched
 * field shows its own error line.
 *
 * Plus the one place enforcement reaches this screen (S11-h): a workspace the
 * server says will not accept a password must not be told "invalid email or
 * password", because the password was right.
 */
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignInPage } from './SignInPage.js';
import { useAuth, type Membership } from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

function renderSignIn(initialEntry = '/'): void {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SignInPage />
    </MemoryRouter>,
  );
}

const WORKSPACE: Membership = {
  license_id: '1',
  organization_id: '00000000-0000-4000-8000-000000000001',
  organization_name: 'Acme',
  role: 'agent',
  license_status: 'active',
  client_id: 'nexa-agent-app-acme',
  sso_enforced_connection_id: null,
  password_login_available: true,
};

/** Answer `/auth/login` with these workspaces and record what the screen did. */
function stubStore(memberships: Membership[]) {
  const signIn = vi.fn(async () => undefined);
  const startSsoLogin = vi.fn(async () => undefined);
  useAuth.setState({
    busy: false,
    listWorkspaces: async () => memberships,
    signIn,
    startSsoLogin,
  });
  return { signIn, startSsoLogin };
}

async function submitCredentials(): Promise<void> {
  await userEvent.type(screen.getByLabelText('Email'), 'agent@acme.localhost');
  await userEvent.type(screen.getByLabelText('Password'), 'correct-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

const original = useAuth.getState();

beforeEach(() => {
  // The disabled state must come from the form, not a lingering store `busy`.
  useAuth.setState({ busy: false });
});

afterEach(() => {
  useAuth.setState({
    listWorkspaces: original.listWorkspaces,
    signIn: original.signIn,
    startSsoLogin: original.startSsoLogin,
  });
});

describe('SignInPage validation', () => {
  it('keeps Sign in disabled until email and password are valid', async () => {
    renderSignIn();
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    expect(submit).toBeDisabled(); // email is not an address

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'owner@acme.localhost');
    expect(submit).toBeEnabled();
  });

  it('keeps Sign in disabled with a valid email but no password', async () => {
    renderSignIn();
    await userEvent.type(screen.getByLabelText('Email'), 'owner@acme.localhost');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });
});

const CONNECTION = '00000000-0000-4000-8000-0000000000aa';

describe('SignInPage under SSO enforcement', () => {
  it('hands the sign-in to the identity provider instead of spending the password on a refusal', async () => {
    const { signIn, startSsoLogin } = stubStore([
      {
        ...WORKSPACE,
        sso_enforced_connection_id: CONNECTION,
        password_login_available: false,
      },
    ]);
    renderSignIn();

    await submitCredentials();

    // Pressing Sign in is what authorises the redirect, so there is no second
    // button to find — the leg starts, with the connection and client the
    // membership named rather than anything guessed here.
    await waitFor(() =>
      expect(startSsoLogin).toHaveBeenCalledWith(CONNECTION, 'nexa-agent-app-acme'),
    );
    // And the password is never spent on a call the server would refuse.
    expect(signIn).not.toHaveBeenCalled();
  });

  it('says so, rather than doing nothing, when the workspace names no connection', async () => {
    // An older server reports the closed door without saying which provider
    // opens it. A silent no-op would read as a broken button.
    const { startSsoLogin } = stubStore([
      { ...WORKSPACE, sso_enforced_connection_id: null, password_login_available: false },
    ]);
    renderSignIn();

    await submitCredentials();

    expect(await screen.findByRole('alert')).toHaveTextContent(/requires single sign-on/);
    expect(startSsoLogin).not.toHaveBeenCalled();
  });

  it('still signs the owner in — the break-glass door is the server’s answer, not a guess here', async () => {
    // `password_login_available` is server-derived, so the screen never has to
    // know that owners are exempt: it reads one field.
    const { signIn } = stubStore([
      {
        ...WORKSPACE,
        role: 'owner',
        sso_enforced_connection_id: CONNECTION,
        password_login_available: true,
      },
    ]);
    renderSignIn();

    await submitCredentials();

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('agent@acme.localhost', 'correct-password', '1'),
    );
  });

  it('marks the SSO-only workspace in the chooser and opens it through its provider', async () => {
    const { signIn, startSsoLogin } = stubStore([
      { ...WORKSPACE, license_id: '1', organization_name: 'Acme' },
      {
        ...WORKSPACE,
        license_id: '2',
        organization_name: 'Globex',
        sso_enforced_connection_id: CONNECTION,
        password_login_available: false,
      },
    ]);
    renderSignIn();

    await submitCredentials();

    const globex = await screen.findByRole('button', { name: /Globex/ });
    expect(globex).toHaveTextContent('SSO required');
    await userEvent.click(globex);
    await waitFor(() => expect(startSsoLogin).toHaveBeenCalledWith(CONNECTION, expect.anything()));
    expect(signIn).not.toHaveBeenCalled();

    // And the other workspace is unaffected — enforcement is per license.
    await userEvent.click(screen.getByRole('button', { name: /Acme/ }));
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('agent@acme.localhost', 'correct-password', '1'),
    );
  });

  it('treats a server that says nothing as one that still takes passwords', async () => {
    // The field is absent before enforcement existed; reading absence as "off"
    // would turn every sign-in into a refusal on an older API.
    const legacy = { ...WORKSPACE };
    delete legacy.password_login_available;
    const { signIn } = stubStore([legacy]);
    renderSignIn();

    await submitCredentials();

    await waitFor(() => expect(signIn).toHaveBeenCalled());
  });
});

describe('SignInPage arriving from an identity provider', () => {
  it('starts the leg straight away and offers no password field to lose', async () => {
    const { startSsoLogin } = stubStore([WORKSPACE]);
    renderSignIn(`/login?sso=${CONNECTION}`);

    // No client id: the person arrived with a connection id and nothing else,
    // so the store reads one from the server.
    await waitFor(() => expect(startSsoLogin).toHaveBeenCalledWith(CONNECTION));
    expect(screen.getByRole('status')).toHaveTextContent(/identity provider/);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('falls back to the form when that link cannot start a login', async () => {
    useAuth.setState({
      busy: false,
      startSsoLogin: vi.fn(async () => {
        throw new Error('Single sign-on is not available for this connection.');
      }),
    });
    renderSignIn(`/login?sso=${CONNECTION}`);

    expect(await screen.findByRole('alert')).toHaveTextContent(/not available/);
    // Somewhere to go next, rather than a dead status line.
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});

function twoFactorRequiredError(details?: Record<string, unknown>): ApiClientError {
  return new ApiClientError({
    type: 'two_factor_required',
    status: 401,
    message: 'Enter the code from your authenticator app, or one of your recovery codes.',
    requestId: 'req-2fa',
    details,
  });
}

function wrongCodeError(): ApiClientError {
  return new ApiClientError({
    type: 'authentication',
    status: 401,
    message: 'Invalid email or password.',
    requestId: 'req-badcode',
  });
}

function stubTwoFactorFlow(signIn: ReturnType<typeof vi.fn>): void {
  useAuth.setState({
    busy: false,
    listWorkspaces: async () => [WORKSPACE],
    signIn,
    startSsoLogin: vi.fn(async () => undefined),
  });
}

describe('SignInPage under two-factor enforcement (S11-2FA-g)', () => {
  it('swaps the password box for a code box when the account already holds an active factor', async () => {
    const signIn = vi.fn(async (_email, _password, _licenseId, code) => {
      if (code === undefined) throw twoFactorRequiredError();
    });
    stubTwoFactorFlow(signIn);
    renderSignIn();

    await submitCredentials();

    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    // Six digits is a complete code — Submit is never pressed by hand here.
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith(
        'agent@acme.localhost',
        'correct-password',
        '1',
        '123456',
      ),
    );
  });

  it('shows a field-level error under the code box on a wrong code, and never returns to the password step', async () => {
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(twoFactorRequiredError())
      .mockRejectedValueOnce(wrongCodeError())
      .mockResolvedValueOnce(undefined);
    stubTwoFactorFlow(signIn);
    renderSignIn();

    await submitCredentials();
    await userEvent.type(await screen.findByLabelText('Authentication code'), '111111');

    expect(await screen.findByText('That code is not right. Try again.')).toBeInTheDocument();
    // Still the code step, with the same credentials in hand — not a restart.
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Authentication code'));
    await userEvent.type(screen.getByLabelText('Authentication code'), '222222');

    await waitFor(() =>
      expect(signIn).toHaveBeenLastCalledWith(
        'agent@acme.localhost',
        'correct-password',
        '1',
        '222222',
      ),
    );
  });

  it('offers a recovery code as an alternative on the same screen', async () => {
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(twoFactorRequiredError())
      .mockResolvedValueOnce(undefined);
    stubTwoFactorFlow(signIn);
    renderSignIn();

    await submitCredentials();
    await screen.findByLabelText('Authentication code');

    await userEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await userEvent.type(screen.getByLabelText('Recovery code'), 'ABCDE-FGHJK');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(signIn).toHaveBeenLastCalledWith(
        'agent@acme.localhost',
        'correct-password',
        '1',
        'ABCDE-FGHJK',
      ),
    );
  });

  it('routes to account settings, with the reason stated, when the server sends no enrollment ticket', async () => {
    // The pre-S11-2FA-k shape, and still the answer for an older server or a
    // mint that failed: no ticket means no enrollment is possible from here,
    // and the panel says so rather than offering a button that cannot work.
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(twoFactorRequiredError({ enrollment_required: true }));
    stubTwoFactorFlow(signIn);
    renderSignIn();

    await submitCredentials();

    expect(await screen.findByText(/requires two-factor authentication/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set it up now' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Account Settings' })).toHaveAttribute(
      'href',
      '/app/settings',
    );
  });
});

// ===========================================================================
// Enrolling from the sign-in screen (S11-2FA-k)
// ===========================================================================

/**
 * The screen half of the dead end S11-2FA-k opens.
 *
 * The panel S11-2FA-g left here was correct and useless: it pointed at Account
 * Settings, which is behind the sign-in that just refused. What matters now is
 * not that a form renders — it is that the refusal's own credential is what
 * carries every call, that the recovery sheet cannot be skipped past, and that
 * the screen ends up at the code box rather than pretending to be signed in.
 */
describe('SignInPage enrollment from the refusal (S11-2FA-k)', () => {
  const TICKET = 'enrollment-ticket-value';

  const ENROLLMENT = {
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    otpauth_uri: 'otpauth://totp/Nexa:agent@acme.localhost?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    issuer: 'Nexa',
    account_name: 'agent@acme.localhost',
  };

  const RECOVERY = ['ABCDE-FGHJK', 'BCDEF-GHJKM'];

  function stubEnrollment(overrides: Partial<Parameters<typeof useAuth.setState>[0]> = {}) {
    const signIn = vi
      .fn()
      .mockRejectedValueOnce(
        twoFactorRequiredError({ enrollment_required: true, enrollment_ticket: TICKET }),
      )
      .mockResolvedValue(undefined);
    const enrollWithTicket = vi.fn(async () => ENROLLMENT);
    const activateWithTicket = vi.fn(async () => RECOVERY);
    useAuth.setState({
      busy: false,
      listWorkspaces: async () => [WORKSPACE],
      signIn,
      startSsoLogin: vi.fn(async () => undefined),
      enrollWithTicket,
      activateWithTicket,
      ...overrides,
    });
    return { signIn, enrollWithTicket, activateWithTicket };
  }

  afterEach(() => {
    useAuth.setState({
      enrollWithTicket: original.enrollWithTicket,
      activateWithTicket: original.activateWithTicket,
    });
  });

  /** Get as far as the setup key being on screen. */
  async function startEnrollment(): Promise<void> {
    await submitCredentials();
    await userEvent.click(await screen.findByRole('button', { name: 'Set it up now' }));
    await screen.findByText(ENROLLMENT.secret);
  }

  it('carries the refusal’s own ticket into both enrollment calls', async () => {
    // The property everything else rests on. There is no session here — if
    // these calls went through the ordinary API client they would carry no
    // credential at all and 401, which is exactly the state this replaces.
    const { enrollWithTicket, activateWithTicket } = stubEnrollment();
    renderSignIn();

    await startEnrollment();
    expect(enrollWithTicket).toHaveBeenCalledWith(TICKET);

    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));

    await waitFor(() => expect(activateWithTicket).toHaveBeenCalledWith(TICKET, '123456'));
  });

  it('shows the recovery sheet and will not move on until it is acknowledged', async () => {
    // These codes exist in component state and nowhere else in the world —
    // `/auth/2fa/activate` is the only response that carries them and it does
    // so once. A Continue button that worked before the box was checked would
    // be a one-click way to lose them permanently.
    stubEnrollment();
    renderSignIn();

    await startEnrollment();
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));

    for (const code of RECOVERY) {
      expect(await screen.findByText(code)).toBeInTheDocument();
    }
    const advance = screen.getByRole('button', { name: 'Continue to sign in' });
    expect(advance).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox'));
    expect(advance).toBeEnabled();
  });

  it('hands over to the code step rather than claiming to be signed in', async () => {
    // The code that confirmed the enrollment is spent — activation makes its
    // RFC 6238 step the replay floor — so the next one has to be typed. A
    // screen that tried to complete the sign-in here would fail on a code the
    // server has already refused to reuse, and the person would be told their
    // brand-new factor is wrong.
    const { signIn } = stubEnrollment();
    renderSignIn();

    await startEnrollment();
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));

    // The code box, with the same credentials still in hand — never back to
    // the password field.
    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Authentication code'), '654321');
    await waitFor(() =>
      expect(signIn).toHaveBeenLastCalledWith(
        'agent@acme.localhost',
        'correct-password',
        '1',
        '654321',
      ),
    );
  });

  it('keeps a wrong activation code under the field, with the setup key still on screen', async () => {
    // Re-entering the whole flow for a typo would mean a second ticket, and
    // minting one replaces the first — so the person would be restarting an
    // enrollment they had almost finished.
    const activateWithTicket = vi.fn().mockRejectedValue(wrongCodeError());
    stubEnrollment({ activateWithTicket });
    renderSignIn();

    await startEnrollment();
    await userEvent.type(screen.getByLabelText('Authentication code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));

    expect(await screen.findByText('That code is not right. Try again.')).toBeInTheDocument();
    expect(screen.getByText(ENROLLMENT.secret)).toBeInTheDocument();
  });

  it('says the attempt expired, rather than blaming the code, when the ticket is gone', async () => {
    // A ticket that timed out or was replaced by a later sign-in answers 404
    // (the principal kind is no longer one this endpoint names). Under the code
    // field that would read as "you typed it wrong", and the person would keep
    // retyping a correct code forever.
    const activateWithTicket = vi.fn().mockRejectedValue(
      new ApiClientError({
        type: 'not_found',
        status: 404,
        message: 'Resource not found.',
        requestId: 'req-gone',
      }),
    );
    stubEnrollment({ activateWithTicket });
    renderSignIn();

    await startEnrollment();
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & activate' }));

    expect(
      await screen.findByText('This setup attempt has expired. Go back and sign in again.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
  });

  it('says so when the ticket is already dead at the first call', async () => {
    const enrollWithTicket = vi.fn().mockRejectedValue(
      new ApiClientError({
        type: 'authentication',
        status: 401,
        message: 'Invalid or expired credentials.',
        requestId: 'req-expired',
      }),
    );
    stubEnrollment({ enrollWithTicket });
    renderSignIn();

    await submitCredentials();
    await userEvent.click(await screen.findByRole('button', { name: 'Set it up now' }));

    expect(
      await screen.findByText('This setup attempt has expired. Go back and sign in again.'),
    ).toBeInTheDocument();
  });
});

describe('SignInPage localisation (NFR-I18N2)', () => {
  afterEach(() => resetLocale());

  it('paints the sign-in form in Turkish when that is the active locale', () => {
    renderWithLocale(
      <MemoryRouter initialEntries={['/']}>
        <SignInPage />
      </MemoryRouter>,
      'tr',
    );

    expect(screen.getByText('Çalışma alanınızda oturum açın')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Oturum aç' })).toBeInTheDocument();
  });
});
