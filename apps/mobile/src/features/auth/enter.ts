/**
 * Entering one workspace, from the two places that can ask for it — the sign-in
 * form when the account has exactly one, and the picker when it has several.
 *
 * Shared rather than written twice because the branch it encodes is a rule, not
 * a convenience: a workspace that federates sign-in must never be handed a
 * password. `/auth/authorize` would refuse it, and the refusal reads as
 * "invalid email or password" — a lie, since the password was right. So the
 * membership is read first and the password is spent only where it can work.
 */
import type { Workspace } from '../../auth/session';
import { SsoRequiredError } from '../../auth/session';
import { NO_CLIENT, SSO_REQUIRED, signInErrorMessage } from './messages';
import { passwordWorks, type AuthSession } from './types';

/** A workspace's federated door, with everything needed to knock on it. */
export interface SsoOffer {
  connectionId: string;
  clientId: string;
  workspaceName: string;
}

export type EnterResult =
  /** The session moved; the gate above will swap the tree. */
  | { status: 'signed-in' }
  /** The password is not the way in here. The screen offers the other door. */
  | { status: 'sso-required'; offer: SsoOffer; message: string }
  | { status: 'failed'; message: string };

export function ssoRequiredMessage(workspaceName: string): string {
  return `${workspaceName} signs in through your company account.`;
}

export async function enterWorkspace(
  session: AuthSession,
  credentials: { email: string; password: string },
  workspace: Workspace,
): Promise<EnterResult> {
  // `13.7-b`: the workspace's OAuth client comes from the membership row, never
  // from a constant in `app.json` — a workspace created through signup has no
  // client any guess would match.
  const clientId = workspace.client_id ?? null;

  if (!passwordWorks(workspace)) {
    const connectionId = workspace.sso_enforced_connection_id ?? null;
    // An older server reports the closed door without naming the connection.
    // Silently doing nothing here would read as a broken button.
    if (connectionId === null) return { status: 'failed', message: SSO_REQUIRED };
    if (clientId === null) return { status: 'failed', message: NO_CLIENT };
    return {
      status: 'sso-required',
      offer: { connectionId, clientId, workspaceName: workspace.organization_name },
      message: ssoRequiredMessage(workspace.organization_name),
    };
  }

  if (clientId === null) return { status: 'failed', message: NO_CLIENT };

  try {
    await session.signIn({
      email: credentials.email,
      password: credentials.password,
      licenseId: workspace.license_id,
      clientId,
    });
    return { status: 'signed-in' };
  } catch (error) {
    // The server is the authority on enforcement (§C-A17.7), so this arrives
    // even when the membership said a password would work — a break-glass rule
    // changed, or this build is older than the workspace's settings.
    if (error instanceof SsoRequiredError) {
      return {
        status: 'sso-required',
        offer: {
          connectionId: error.connectionId,
          clientId,
          workspaceName: workspace.organization_name,
        },
        message: ssoRequiredMessage(workspace.organization_name),
      };
    }
    return { status: 'failed', message: signInErrorMessage(error) };
  }
}

/**
 * Take the federated door: `MobileSession` hands the identity provider to the
 * device's own browser and waits for the callback (§C-A29 · `13.7-q`).
 *
 * Every way this ends other than a session is a `failed` with the session's own
 * sentence, and they are deliberately different sentences — a dismissed sheet,
 * a callback carrying somebody else's `state`, and an app built without a
 * browser are three different situations, and only the first is worth pressing
 * the button again for. `messages.ts` explains why these are shown verbatim
 * while a server refusal is not.
 */
export async function continueWithSso(session: AuthSession, offer: SsoOffer): Promise<EnterResult> {
  try {
    await session.signInWithSso({ connectionId: offer.connectionId, clientId: offer.clientId });
    return { status: 'signed-in' };
  } catch (error) {
    return { status: 'failed', message: signInErrorMessage(error) };
  }
}
