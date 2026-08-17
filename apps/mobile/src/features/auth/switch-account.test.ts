import { switchAccountSession } from './switch-account';
import type { MobileSession } from '../../auth/session';

function fakeSession(overrides: Partial<Record<keyof MobileSession, jest.Mock>> = {}) {
  return {
    listWorkspaces: overrides.listWorkspaces ?? jest.fn(async () => []),
    switchAccount: overrides.switchAccount ?? jest.fn(async () => undefined),
    signOut: overrides.signOut ?? jest.fn(async () => undefined),
    signInWithSso: overrides.signInWithSso ?? jest.fn(async () => undefined),
  } as unknown as MobileSession;
}

describe('switchAccountSession', () => {
  it('sends listWorkspaces straight through — no membership is spent switching yet', async () => {
    const listWorkspaces = jest.fn(async () => []);
    const session = fakeSession({ listWorkspaces });
    const adapter = switchAccountSession(session);

    await adapter.listWorkspaces('ada@acme.test', 'hunter2');

    expect(listWorkspaces).toHaveBeenCalledWith('ada@acme.test', 'hunter2');
  });

  it('routes what SignInScreen calls "signIn" to session.switchAccount, never session.signIn', async () => {
    const switchAccount = jest.fn(async () => undefined);
    const session = fakeSession({ switchAccount });
    const adapter = switchAccountSession(session);

    await adapter.signIn({
      email: 'ada@acme.test',
      password: 'hunter2',
      licenseId: 'lic-2',
      clientId: 'client-2',
    });

    expect(switchAccount).toHaveBeenCalledWith({
      email: 'ada@acme.test',
      password: 'hunter2',
      licenseId: 'lic-2',
      clientId: 'client-2',
    });
  });

  it('revokes the outgoing account before starting the federated leg (§C-A31), by hand — MobileSession has no atomic switch for SSO', async () => {
    const calls: string[] = [];
    const signOut = jest.fn(async () => {
      calls.push('signOut');
    });
    const signInWithSso = jest.fn(async () => {
      calls.push('signInWithSso');
    });
    const session = fakeSession({ signOut, signInWithSso });
    const adapter = switchAccountSession(session);

    await adapter.signInWithSso({ connectionId: 'conn-1', clientId: 'client-2' });

    expect(calls).toEqual(['signOut', 'signInWithSso']);
    expect(signInWithSso).toHaveBeenCalledWith({ connectionId: 'conn-1', clientId: 'client-2' });
  });
});
