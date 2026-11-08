/**
 * A socket lives no longer than the credential it logged in with (tm 426.3).
 *
 * The gateway reads a credential once, at `login`. Before this a socket opened
 * with an access token that expires in an hour stayed open, and kept receiving
 * a workspace's pushes, for as long as the tab did — a revocation the API never
 * announces (an access token simply running out, a session the idle limit
 * ended) had no bound at all. Now each logged-in socket carries one timer, set
 * at login to the credential's `expires_at` and cleared when the socket closes;
 * when it fires the socket is closed with 4401, the code a revoked credential
 * closes with (`revocation.ts`), so a client has one thing to recognise: renew,
 * then dial again.
 *
 * An operator's session as a member (tm 389.15) has `expires_at` = the end of
 * its window, so the same timer ends it — on time, rather than at the next
 * ping-interval tick that used to check it.
 *
 * Agent door only. A visitor's signed token is never stored, never revoked and
 * the widget reconnects by minting a new one; its socket is left as it was.
 */
import type { Connection } from './connection.js';

/** The code an expired credential's socket closes with — the revoked credential's code. */
export const CREDENTIAL_EXPIRED_CLOSE_CODE = 4401;

/**
 * `setTimeout`'s ceiling (2^31 − 1 ms, ~24.8 days). A longer delay fires at
 * once — Node clamps it to 1 ms — so a credential further out than this is
 * waited for in steps.
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** A clock, for tests. */
export interface CredentialExpiryOptions {
  now?: () => number;
}

/**
 * Arm `connection`'s timer for `expiresAt`. A null expiry — a personal token
 * issued without one — arms nothing. Any timer already set is replaced.
 */
export function armCredentialExpiry(
  connection: Connection,
  expiresAt: Date | null,
  options: CredentialExpiryOptions = {},
): void {
  disarmCredentialExpiry(connection);
  if (expiresAt === null) return;
  const now = options.now ?? Date.now;
  const at = expiresAt.getTime();

  const step = (): void => {
    connection.credentialExpiry = null;
    const remaining = at - now();
    if (remaining > 0) {
      const timer = setTimeout(step, Math.min(remaining, MAX_TIMER_DELAY_MS));
      // The socket keeps the process alive, not its timer.
      timer.unref?.();
      connection.credentialExpiry = timer;
      return;
    }
    closeExpired(connection);
  };
  step();
}

/** Clear `connection`'s timer — when the socket closes, whichever way. */
export function disarmCredentialExpiry(connection: Connection): void {
  if (connection.credentialExpiry === null) return;
  clearTimeout(connection.credentialExpiry);
  connection.credentialExpiry = null;
}

function closeExpired(connection: Connection): void {
  // The gateway is closing it already (a revocation, a slow consumer): a second
  // close frame changes nothing, and the first reason stands.
  if (connection.closedBy !== null) return;
  connection.closedBy = 'credential_expired';
  try {
    connection.ws.close(
      CREDENTIAL_EXPIRED_CLOSE_CODE,
      connection.impersonation ? 'session ended' : 'credential expired',
    );
  } catch {
    // Already torn down.
  }
}
