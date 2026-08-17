/**
 * What the sign-in screens need from the session, and nothing else.
 *
 * `MobileSession` satisfies this structurally, so the screens still talk to the
 * real object at runtime — but naming the three methods here is what lets a
 * test be the session without standing up secure storage, PKCE and a network,
 * and it is a standing reminder of the boundary `13.7-b` drew: these screens
 * *use* the token flow, they do not own a second one.
 */
import type { Workspace } from '../../auth/session';

export interface AuthSession {
  /** Which workspaces this password opens. Issues no token (`/auth/login`). */
  listWorkspaces(email: string, password: string): Promise<Workspace[]>;
  /** Password sign-in against one workspace (`/auth/authorize` → `/auth/token`). */
  signIn(input: {
    email: string;
    password: string;
    licenseId: string;
    clientId: string;
  }): Promise<void>;
  /** Federated sign-in through the device's own browser (§C-A29). */
  signInWithSso(input: { connectionId: string; clientId: string }): Promise<void>;
}

/**
 * An email and password that have already been accepted by `/auth/login`,
 * carried from the sign-in form to the workspace picker.
 *
 * Held in component state rather than a route param on purpose: navigation
 * state is a serialisable object React Navigation persists, restores and — once
 * `13.7-q` adds `linking` — maps to and from URLs. A password does not belong
 * in any of those. `AuthStack` owns this value and hands it down as a prop, so
 * `app/navigation.ts` never has to name it.
 */
export interface PendingSignIn {
  email: string;
  password: string;
  memberships: Workspace[];
}

/**
 * Whether a password still opens this workspace.
 *
 * Absent means "before enforcement existed", which was always yes — the same
 * reading `apps/web/src/features/auth/SignInPage.tsx` takes, and for the same
 * reason: an older server must not turn every sign-in into a refusal.
 */
export function passwordWorks(workspace: Workspace): boolean {
  return workspace.password_login_available !== false;
}
