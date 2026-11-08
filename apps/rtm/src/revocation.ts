/**
 * Closing the sockets of a credential that stopped being honoured (tm 426 ·
 * the 2026-11-06 audit's F08).
 *
 * The gateway checks a socket's credential at `login` and never again: a member
 * removed from the workspace, a session signed out, a workspace suspended — the
 * API refuses each of them from the commit on, and the tab that was already
 * open went on receiving the workspace's conversations. Now the API says so on
 * the licence's bus channel (`principal_revoked`, `@siyahtus/types`
 * `realtime-bus.ts`) and every gateway holding a socket the envelope names
 * closes it with {@link CREDENTIAL_REVOKED_CLOSE_CODE}. The client reconnects,
 * as it does on any close it did not ask for, and its `login` is refused with
 * the precise reason — `authentication`, or `not_allowed` +
 * `workspace_suspended` — because the API published only after its commit.
 *
 * Three ways a socket could slip past a revocation, and what holds each:
 *
 *   - **already logged in**: found through the registry's indexes and closed
 *     ({@link PrincipalRevocations.apply});
 *   - **logging in while it arrives**: its login read the credential before the
 *     commit and cannot have seen it. The envelope is recorded on every socket
 *     of the organization with a login in flight, and the login is refused if
 *     one names it (`Dispatcher`, {@link revocationNames});
 *   - **logging in before this gateway listens to the licence's channel**: the
 *     first socket of a licence on a gateway subscribes during its login, and
 *     an envelope published before that subscription took effect never arrives
 *     here. The dispatcher reads the credential again once the subscription is
 *     confirmed, if it was confirmed after the first read began
 *     (`Fanout.ensureSubscribed`): an envelope published before the
 *     subscription was committed before that second read.
 *
 * Not held: an envelope published while this gateway's subscription is down
 * (Redis restarting). Pushes lost that way come back with the reconnect
 * `sync` (tm 408); a lost revocation has no such second path, and the socket
 * stays open until it closes for another reason. The exp timer (tm 426.3)
 * bounds that for an expiring credential.
 *
 * A socket the gateway has decided to close takes no more requests either
 * (`server.ts`): a peer that never answers the close frame keeps its TCP
 * connection until `ws`'s close timeout, and must not spend that time acting
 * with the credential it just lost.
 */
import type { Logger } from 'pino';
import type { PrincipalRevokedEnvelope } from '@siyahtus/types';
import type { Connection, ConnectionRegistry } from './connection.js';

/**
 * 4000 + the status the REST edge answers a refused credential with (401) —
 * the code an operator's session as a member already closes with when its
 * window ends (tm 389.15), as `maintenance.ts` closes with 4000 + 503. Not 1008:
 * nothing was wrong with what the client sent, and its reconnect is what
 * tells it the reason.
 */
export const CREDENTIAL_REVOKED_CLOSE_CODE = 4401;

/** What a revocation is matched against: a logged-in socket, or a login about to finish. */
export interface RevocationSubject {
  licenseId: string;
  organizationId: string;
  side: 'agent' | 'customer';
  actorId: string;
  /** The `api_tokens` row the credential is; null for a visitor's signed token. */
  tokenId: string | null;
}

/**
 * Whether `envelope` names `subject`. Always within the envelope's licence and
 * organization, and only at the agent door: a visitor's token is signed, not
 * stored, so nothing revokes it — closing a widget's socket for it would only
 * make the widget log straight back in.
 */
export function revocationNames(
  envelope: PrincipalRevokedEnvelope,
  subject: RevocationSubject,
): boolean {
  if (subject.side !== 'agent') return false;
  if (subject.licenseId !== envelope.licenseId) return false;
  if (subject.organizationId !== envelope.organizationId) return false;
  const { target } = envelope;
  switch (target.kind) {
    case 'license':
      return true;
    case 'agent':
      return subject.actorId === target.agentId;
    case 'token':
      return subject.tokenId !== null && subject.tokenId === target.tokenId;
  }
}

/** A logged-in socket as a revocation sees it; null when it is not logged in yet. */
function subjectOf(connection: Connection): RevocationSubject | null {
  if (!connection.authenticated || connection.licenseId === null || connection.actorId === null) {
    return null;
  }
  return {
    licenseId: connection.licenseId,
    organizationId: connection.organizationId,
    side: connection.side,
    actorId: connection.actorId,
    tokenId: connection.tokenId,
  };
}

export class PrincipalRevocations {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly log: Logger,
  ) {}

  /**
   * Close every logged-in socket `envelope` names, and record it on every
   * socket of the organization whose login is in flight. Returns how many
   * sockets were closed.
   */
  apply(envelope: PrincipalRevokedEnvelope): number {
    let closed = 0;
    // Through the organization's index, every socket of the tenant on this node
    // — rarely more than a workspace's open tabs, and a revocation is rare.
    for (const connection of this.registry.inOrganization(envelope.organizationId)) {
      const subject = subjectOf(connection);
      if (subject === null) {
        // Not logged in yet. A login in flight checks what it was told before
        // it marks the socket logged in (`Dispatcher`); from that moment on the
        // socket has a subject and is closed here instead.
        if (connection.loggingIn) connection.revokedDuringLogin.push(envelope);
        continue;
      }
      if (!revocationNames(envelope, subject)) continue;
      // The gateway is closing it already — a second revocation, or a slow
      // consumer: a second close frame changes nothing, and the first reason stands.
      if (connection.closedBy !== null) continue;
      connection.closedBy = 'credential_revoked';
      try {
        connection.ws.close(CREDENTIAL_REVOKED_CLOSE_CODE, 'credential revoked');
      } catch {
        // Already torn down.
      }
      closed += 1;
    }
    // Ids only — which credential, never anything it carried.
    this.log.info(
      {
        license_id: envelope.licenseId,
        organization_id: envelope.organizationId,
        target: envelope.target.kind,
        ...(envelope.target.kind === 'agent' ? { actor_id: envelope.target.agentId } : {}),
        ...(envelope.target.kind === 'token' ? { token_id: envelope.target.tokenId } : {}),
        sockets_closed: closed,
      },
      'rtm closed the sockets of a revoked credential',
    );
    return closed;
  }
}
