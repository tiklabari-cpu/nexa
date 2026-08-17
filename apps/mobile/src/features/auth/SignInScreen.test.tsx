import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { RETURNED_FROM_BROWSER } from './messages';
import { SignInScreen } from './SignInScreen';
import type { AuthSession, PendingSignIn } from './types';
import { SsoRequiredError, type Workspace } from '../../auth/session';
import { ApiClientError } from '../../lib/api-client';
import { ThemeProvider } from '../../theme/theme';

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    license_id: 'lic-1',
    organization_id: 'org-1',
    organization_name: 'Acme',
    role: 'agent',
    client_id: 'client-acme',
    ...overrides,
  };
}

interface Harness {
  session: AuthSession;
  listWorkspaces: jest.Mock;
  signIn: jest.Mock;
  signInWithSso: jest.Mock;
  chosen: PendingSignIn[];
}

function harness(overrides: Partial<Record<keyof AuthSession, jest.Mock>> = {}): Harness {
  const listWorkspaces = overrides.listWorkspaces ?? jest.fn(async () => [workspace()]);
  const signIn = overrides.signIn ?? jest.fn(async () => undefined);
  const signInWithSso = overrides.signInWithSso ?? jest.fn(async () => undefined);
  const chosen: PendingSignIn[] = [];
  return {
    session: {
      listWorkspaces,
      signIn,
      signInWithSso,
    } as unknown as AuthSession,
    listWorkspaces,
    signIn,
    signInWithSso,
    chosen,
  };
}

/**
 * RNTL v14 renders through a concurrent root, so `render` returns a promise —
 * an un-awaited one leaves `screen` empty rather than failing loudly (the same
 * note `NotificationsScreen.test.tsx` carries).
 */
async function mount(h: Harness): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <SignInScreen session={h.session} onChooseWorkspace={(next) => h.chosen.push(next)} />
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

/**
 * `fireEvent` is already wrapped in `act` by RNTL v14 and returns a promise —
 * wrapping it in another `act` is what produces "overlapping act() calls" and
 * hides the update it was meant to flush.
 */
async function fillIn(email: string, password: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId('sign-in-email'), email);
  await fireEvent.changeText(screen.getByTestId('sign-in-password'), password);
}

async function submit(): Promise<void> {
  await fireEvent.press(screen.getByTestId('sign-in-submit'));
}

describe('SignInScreen', () => {
  it('will not submit an empty form', async () => {
    const h = harness();
    await mount(h);

    expect(screen.getByTestId('sign-in-submit')).toHaveProp('accessibilityState', {
      disabled: true,
    });

    await submit();
    expect(h.listWorkspaces).not.toHaveBeenCalled();

    // An email alone is still not enough.
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'agent@acme.test');
    await submit();
    expect(h.listWorkspaces).not.toHaveBeenCalled();
  });

  it('catches an obvious typo before it costs a round trip', async () => {
    const h = harness();
    await mount(h);

    await fillIn('agent@acme', 'hunter2');
    await submit();

    expect(screen.getByTestId('sign-in-email-error')).toHaveTextContent(
      'Enter a valid email address.',
    );
    expect(h.listWorkspaces).not.toHaveBeenCalled();
  });

  it('says one thing for a wrong password and an unknown address', async () => {
    const h = harness({
      listWorkspaces: jest.fn(async () => {
        throw new ApiClientError({
          type: 'authentication',
          status: 401,
          // The server's own prose, which must not reach the screen verbatim
          // by accident — the sentence below is chosen from the ADR-06 `type`.
          message: 'Invalid email or password.',
          requestId: 'req-1',
        });
      }),
    });
    await mount(h);

    await fillIn('agent@acme.test', 'wrong');
    await submit();

    expect(screen.getByTestId('sign-in-error')).toHaveTextContent('Invalid email or password.');
  });

  it('does not blame the person for a tunnel', async () => {
    const h = harness({
      listWorkspaces: jest.fn(async () => {
        throw new ApiClientError({
          type: 'network',
          status: 0,
          message: 'Could not reach the server.',
          requestId: '-',
        });
      }),
    });
    await mount(h);

    await fillIn('agent@acme.test', 'hunter2');
    await submit();

    expect(screen.getByTestId('sign-in-error')).toHaveTextContent(
      'Could not reach the server. Check your connection and try again.',
    );
  });

  it('signs straight in when the account has exactly one workspace', async () => {
    const h = harness();
    await mount(h);

    await fillIn('  agent@acme.test  ', 'hunter2');
    await submit();

    expect(h.signIn).toHaveBeenCalledWith({
      // Trimmed, and the same value `/auth/login` was given.
      email: 'agent@acme.test',
      password: 'hunter2',
      licenseId: 'lic-1',
      // From the membership row, never a constant in `app.config.ts` (13.7-b).
      clientId: 'client-acme',
    });
    expect(h.chosen).toEqual([]);
  });

  it('hands more than one workspace to the picker, credentials included', async () => {
    const h = harness({
      listWorkspaces: jest.fn(async () => [
        workspace(),
        workspace({ license_id: 'lic-2', organization_name: 'Globex' }),
      ]),
    });
    await mount(h);

    await fillIn('agent@acme.test', 'hunter2');
    await submit();

    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.chosen).toHaveLength(1);
    expect(h.chosen[0]).toMatchObject({ email: 'agent@acme.test', password: 'hunter2' });
    expect(h.chosen[0]!.memberships.map((w) => w.license_id)).toEqual(['lic-1', 'lic-2']);
  });

  it('says so rather than opening nothing when the account has no workspace', async () => {
    const h = harness({ listWorkspaces: jest.fn(async () => []) });
    await mount(h);

    await fillIn('agent@acme.test', 'hunter2');
    await submit();

    expect(screen.getByTestId('sign-in-error')).toHaveTextContent(
      'This account is not a member of any workspace.',
    );
  });

  it('offers the other door instead of spending a password the workspace refuses', async () => {
    const h = harness({
      listWorkspaces: jest.fn(async () => [
        workspace({ password_login_available: false, sso_enforced_connection_id: 'conn-1' }),
      ]),
    });
    await mount(h);

    await fillIn('agent@acme.test', 'hunter2');
    await submit();

    // The password was right; `/auth/authorize` is never asked to refuse it.
    expect(h.signIn).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-in-error')).toHaveTextContent(
      'Acme signs in through your company account.',
    );
    expect(screen.getByTestId('sign-in-sso')).toBeOnTheScreen();
  });

  it('offers the other door when the server is the one that closes it', async () => {
    const h = harness({
      signIn: jest.fn(async () => {
        throw new SsoRequiredError('conn-9', 'This workspace requires single sign-on.');
      }),
    });
    await mount(h);

    await fillIn('agent@acme.test', 'hunter2');
    await submit();

    expect(screen.getByTestId('sign-in-sso')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('sign-in-sso'));
    expect(h.signInWithSso).toHaveBeenCalledWith({
      connectionId: 'conn-9',
      clientId: 'client-acme',
    });
  });

  it('relays the session’s own sentence when the browser leg cannot run', async () => {
    const h = harness({
      listWorkspaces: jest.fn(async () => [
        workspace({ password_login_available: false, sso_enforced_connection_id: 'conn-1' }),
      ]),
      signInWithSso: jest.fn(async () => {
        // What `MobileSession` throws when it is constructed without an
        // `AuthBrowser`. The app supplies one (`app/services.tsx` · 13.7-q) and
        // `App.test.tsx` walks that path end to end; what is checked here is
        // that this screen does not swallow the sentence into a generic
        // "could not sign in", which is the one thing it can get wrong.
        throw new Error('No browser is available for single sign-on.');
      }),
    });
    await mount(h);

    await fillIn('agent@acme.test', 'hunter2');
    await submit();
    await fireEvent.press(screen.getByTestId('sign-in-sso'));

    expect(screen.getByTestId('sign-in-error')).toHaveTextContent(
      'No browser is available for single sign-on.',
    );
  });

  it('says the round trip is over when a late callback opened this screen', async () => {
    const h = harness();
    const tree = (
      <ThemeProvider>
        <SignInScreen session={h.session} onChooseWorkspace={() => {}} returned />
      </ThemeProvider>
    );
    await render(tree);
    await act(async () => {});

    // `app/linking.ts` routes `nexa://auth/callback` here when nothing is
    // waiting for it. The form is usable — starting over is the only way
    // forward — but it does not pretend nothing happened.
    expect(screen.getByTestId('sign-in-error')).toHaveTextContent(RETURNED_FROM_BROWSER);
    expect(screen.getByTestId('sign-in-submit')).toBeOnTheScreen();
  });

  it('says so when a workspace has no app registration to sign in against', async () => {
    const h = harness({ listWorkspaces: jest.fn(async () => [workspace({ client_id: null })]) });
    await mount(h);

    await fillIn('agent@acme.test', 'hunter2');
    await submit();

    expect(h.signIn).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-in-error')).toHaveTextContent(
      'This workspace has no app registration yet. Sign in from the web console instead.',
    );
  });

  it('sends one request however many times the button is pressed', async () => {
    let release: (workspaces: Workspace[]) => void = () => {};
    const pending = new Promise<Workspace[]>((resolve) => {
      release = resolve;
    });
    const h = harness({ listWorkspaces: jest.fn(async () => pending) });
    await mount(h);

    await fillIn('agent@acme.test', 'hunter2');
    await submit();

    expect(screen.getByTestId('sign-in-submit')).toHaveTextContent('Signing in…');
    await submit();
    await submit();
    expect(h.listWorkspaces).toHaveBeenCalledTimes(1);

    await act(async () => {
      release([workspace()]);
    });
    expect(h.signIn).toHaveBeenCalledTimes(1);
  });

  it('hides the password and asks the keyboard for the right thing', async () => {
    const h = harness();
    await mount(h);

    const password = screen.getByTestId('sign-in-password');
    expect(password).toHaveProp('secureTextEntry', true);
    expect(password).toHaveProp('autoComplete', 'current-password');
    expect(password).toHaveProp('textContentType', 'password');

    const email = screen.getByTestId('sign-in-email');
    expect(email).toHaveProp('keyboardType', 'email-address');
    expect(email).toHaveProp('autoCapitalize', 'none');
    expect(email).toHaveProp('autoComplete', 'email');
  });
});
