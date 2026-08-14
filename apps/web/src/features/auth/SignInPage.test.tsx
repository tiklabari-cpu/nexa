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
