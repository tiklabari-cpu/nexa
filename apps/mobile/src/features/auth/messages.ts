/**
 * What a failed sign-in says out loud.
 *
 * Two rules, and they pull in opposite directions, which is why this is a
 * module rather than a `catch` block.
 *
 * A refusal from the server is rendered from its ADR-06 `type`, never from its
 * `message`. The envelope's prose is written for an operator reading a log —
 * it can name a licence, a connection, an account state — and the sign-in
 * screen is the one screen in the app whose reader has not yet proved who they
 * are. So the type picks the sentence and the server's own words are dropped.
 *
 * An error this app raised itself is shown as written. `'Sign-in was
 * cancelled.'`, `'This sign-in did not start in this app.'` and `'No browser is
 * available for single sign-on.'` are `session.ts`'s own strings: they carry
 * nothing from the network and each says something a generic "could not sign
 * in" would throw away.
 */
import { ApiClientError } from '../../lib/api-client';

/** One sentence for a wrong password and an unknown address alike (`/auth/login`). */
export const INVALID_CREDENTIALS = 'Invalid email or password.';

/** A workspace that federates sign-in but names no connection to knock on. */
export const SSO_REQUIRED =
  'This workspace requires single sign-on. Continue from your identity provider’s Nexa tile.';

/**
 * A membership with no `client_id`. The phone will not guess one — `13.7-b`
 * settled that the workspace's own OAuth client comes from `/auth/login` — so
 * the honest answer is to send the person somewhere that works.
 */
export const NO_CLIENT =
  'This workspace has no app registration yet. Sign in from the web console instead.';

export function signInErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.type) {
      case 'network':
        return 'Could not reach the server. Check your connection and try again.';
      case 'timeout':
      case 'request_timeout':
        return 'The server did not answer in time. Try again.';
      case 'authentication':
        return INVALID_CREDENTIALS;
      case 'too_many_requests':
      case 'limit_reached':
        return 'Too many attempts. Wait a moment and try again.';
      case 'license_expired':
        return 'This workspace’s licence has expired. An owner can renew it from the web console.';
      case 'validation':
        return 'Check the email and password, then try again.';
      case 'service_unavailable':
      case 'internal':
        return 'Nexa is having trouble right now. Try again in a moment.';
      default:
        return 'Could not sign in. Try again.';
    }
  }

  // This app's own sentences — see the note at the top of the file.
  if (error instanceof Error && error.message !== '') return error.message;
  return 'Could not sign in. Try again.';
}
