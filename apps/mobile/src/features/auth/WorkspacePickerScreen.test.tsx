import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { WorkspacePickerScreen } from './WorkspacePickerScreen';
import type { AuthSession, PendingSignIn } from './types';
import { type Workspace } from '../../auth/session';
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

function pending(memberships: Workspace[]): PendingSignIn {
  return { email: 'agent@acme.test', password: 'hunter2', memberships };
}

interface Harness {
  session: AuthSession;
  signIn: jest.Mock;
  signInWithSso: jest.Mock;
  startedOver: number;
}

function harness(overrides: { signIn?: jest.Mock; signInWithSso?: jest.Mock } = {}): Harness {
  const signIn = overrides.signIn ?? jest.fn(async () => undefined);
  const signInWithSso = overrides.signInWithSso ?? jest.fn(async () => undefined);
  return {
    session: {
      listWorkspaces: jest.fn(async () => []),
      signIn,
      signInWithSso,
    } as unknown as AuthSession,
    signIn,
    signInWithSso,
    startedOver: 0,
  };
}

async function mount(h: Harness, state: PendingSignIn | null): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <WorkspacePickerScreen
        session={h.session}
        pending={state}
        onStartOver={() => {
          h.startedOver += 1;
        }}
      />
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

describe('WorkspacePickerScreen', () => {
  it('lists every workspace with the role this account holds there', async () => {
    const h = harness();
    await mount(
      h,
      pending([
        workspace(),
        workspace({ license_id: 'lic-2', organization_name: 'Globex', role: 'owner' }),
      ]),
    );

    expect(screen.getByText('Acme')).toBeOnTheScreen();
    expect(screen.getByText('agent')).toBeOnTheScreen();
    expect(screen.getByText('Globex')).toBeOnTheScreen();
    expect(screen.getByText('owner')).toBeOnTheScreen();
  });

  it('opens the workspace that was pressed, with the credentials already accepted', async () => {
    const h = harness();
    await mount(
      h,
      pending([workspace(), workspace({ license_id: 'lic-2', organization_name: 'Globex' })]),
    );

    await fireEvent.press(screen.getByTestId('workspace-lic-2'));

    expect(h.signIn).toHaveBeenCalledWith({
      email: 'agent@acme.test',
      password: 'hunter2',
      licenseId: 'lic-2',
      clientId: 'client-acme',
    });
  });

  it('marks a federated workspace before it is pressed, and never spends the password on it', async () => {
    const h = harness();
    await mount(
      h,
      pending([
        workspace({
          license_id: 'lic-3',
          organization_name: 'Initech',
          password_login_available: false,
          sso_enforced_connection_id: 'conn-3',
        }),
      ]),
    );

    expect(screen.getByText('SSO required')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('workspace-lic-3'));

    expect(h.signIn).not.toHaveBeenCalled();
    expect(screen.getByTestId('workspace-picker-error')).toHaveTextContent(
      'Initech signs in through your company account.',
    );

    await fireEvent.press(screen.getByTestId('workspace-picker-sso'));
    expect(h.signInWithSso).toHaveBeenCalledWith({
      connectionId: 'conn-3',
      clientId: 'client-acme',
    });
  });

  it('says why a workspace would not open', async () => {
    const h = harness({
      signIn: jest.fn(async () => {
        throw new ApiClientError({
          type: 'license_expired',
          status: 402,
          message: 'License 4 expired on 2026-08-01.',
          requestId: 'req-2',
        });
      }),
    });
    await mount(h, pending([workspace()]));

    await fireEvent.press(screen.getByTestId('workspace-lic-1'));

    // The `type`, not the envelope's prose: the licence id and its date are for
    // an operator reading a log, not for a screen nobody has signed in to yet.
    expect(screen.getByTestId('workspace-picker-error')).toHaveTextContent(
      'This workspace’s licence has expired. An owner can renew it from the web console.',
    );
  });

  it('sends people back to the form when the credentials behind this step are gone', async () => {
    const h = harness();
    await mount(h, null);

    expect(screen.getByTestId('workspace-picker-expired')).toHaveTextContent(
      'This sign-in has expired. Enter your email and password again.',
    );

    await fireEvent.press(screen.getByTestId('workspace-picker-restart'));
    expect(h.startedOver).toBe(1);
  });
});
