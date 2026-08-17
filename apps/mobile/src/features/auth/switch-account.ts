/**
 * The sign-in screen's session, when Settings → Account's "Switch account"
 * sent it there (13.7-r) — reached while the outgoing session is still
 * signed in, unlike every other route to `SignInScreen`.
 *
 * The credentials this collects belong to a different account than the one
 * signed in right now, so they must never reach plain `signIn`: that would
 * add a second session next to the first rather than replacing it, and leave
 * the outgoing account's push token registered on a handset that no longer
 * shows its chats. `MobileSession.switchAccount` is `13.7-b`'s answer — revoke
 * first, register second, one call (§C-A31) — and this adapter is what lets
 * `AuthStack` hand it to `SignInScreen`/`WorkspacePickerScreen` without either
 * screen knowing a switch is underway: both call `session.signIn`, same as
 * always, and it is this object's `signIn` that is actually `switchAccount`.
 */
import type { MobileSession } from '../../auth/session';
import type { AuthSession } from './types';

export function switchAccountSession(session: MobileSession): AuthSession {
  return {
    listWorkspaces: (email, password) => session.listWorkspaces(email, password),
    signIn: (input) => session.switchAccount(input),
    // `MobileSession` has no atomic switch for the federated leg — the same
    // order (§C-A31) applied by hand, since there is no third account
    // involved to make the two-request window a correctness problem rather
    // than a cosmetic one.
    signInWithSso: async (input) => {
      await session.signOut();
      await session.signInWithSso(input);
    },
  };
}
