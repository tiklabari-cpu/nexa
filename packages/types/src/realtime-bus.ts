/**
 * The contract between the API (which decides things happened) and the RTM
 * gateway (which tells people about them).
 *
 * The API never talks to a socket. It publishes an envelope to Redis carrying
 * both the push payload *and* the audience that is allowed to receive it; the
 * gateway is a dumb fan-out that trusts the audience and nothing else.
 *
 * Putting the audience in the envelope rather than recomputing it in the
 * gateway matters: the gateway has no tenant context and no view of team
 * membership, so any authorization decision it made would be a guess. Here the
 * decision is made once, where the data is.
 */
import type { RtmPushAction } from './rtm.js';

/** One Redis channel per license — the coarsest split that never crosses tenants. */
export function licenseChannel(licenseId: string | bigint): string {
  return `siyahtus:rtm:license:${licenseId}`;
}

/**
 * Ephemeral "an agent is typing" flag for one chat (FR-MOD-02.9).
 *
 * The visitor's widget polls rather than holding a socket, so an agent's typing
 * cannot be pushed to it. The RTM gateway writes this short-lived key when a
 * `send_typing_indicator` arrives and the customer-state poll reads it. Scoped
 * by licence id so it can never be read or written across a tenant boundary,
 * regardless of what chat id a caller supplies.
 */
export function typingStateKey(licenseId: string | bigint, chatId: string): string {
  return `siyahtus:typing:${licenseId}:${chatId}`;
}

/** Seconds an agent-typing flag survives without a refreshing keystroke. */
export const AGENT_TYPING_TTL_SECONDS = 8;

/**
 * Registry of agents currently composing a reply in one chat, keyed for
 * multi-agent conflict detection (FR-MOD-08.6.3).
 *
 * Same shape and reasoning as `typingStateKey`: scoped by licence id so the
 * same chat id in two tenants can never collide on one key.
 */
export function composerStateKey(licenseId: string | bigint, chatId: string): string {
  return `siyahtus:composer:${licenseId}:${chatId}`;
}

/** Seconds an agent stays registered as composing without a refresh. */
export const AGENT_COMPOSING_TTL_SECONDS = 8;

/** A visitor's sneak-peek text never travels longer than this. */
export const SNEAK_PEEK_MAX_LENGTH = 500;

/**
 * Who may receive a push.
 *
 * An empty audience is meaningless and is treated as "nobody" rather than
 * "everybody" — fail closed, since the failure mode of the opposite default is
 * broadcasting a conversation to every agent in the workspace.
 */
export interface PushAudience {
  /** Agents who are members of any of these teams. */
  groupIds?: number[];
  /** Named agents, regardless of team. */
  agentIds?: string[];
  /** The customer side of one conversation. */
  customerId?: string;
  /** Every authenticated agent in the license — presence, routing status. */
  allAgents?: boolean;
}

export interface BusEnvelope<P = unknown> {
  /** Guards against a stale gateway misreading a newer envelope shape. */
  v: 1;
  licenseId: string;
  organizationId: string;
  action: RtmPushAction;
  audience: PushAudience;
  payload: P;
  /** Set so a socket does not receive an echo of its own action. */
  originConnectionId?: string;
  /** Unix milliseconds — used only for observability, never for ordering. */
  at: number;
}

export function isBusEnvelope(value: unknown): value is BusEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<BusEnvelope>;
  return (
    candidate.v === 1 &&
    typeof candidate.licenseId === 'string' &&
    typeof candidate.organizationId === 'string' &&
    typeof candidate.action === 'string' &&
    typeof candidate.audience === 'object' &&
    candidate.audience !== null
  );
}

// --- A credential that stopped being honoured (tm 426 · F08) ----------------

/**
 * The bus message that says a credential no longer stands: the gateway closes
 * every logged-in socket it names.
 *
 * A socket outlives its login. Before this the gateway looked at a socket's
 * credential once, at `login`, and again only when the workspace's permission
 * matrix moved — so a member removed from the workspace, or signed out, kept
 * hearing the conversations on the tab they still had open. The API refuses
 * the credential on its own edge from the commit on; this carries the same
 * decision to the sockets.
 *
 * Not a push: no client ever receives it, it has no audience and no
 * `action`, so `isBusEnvelope` reads it as nothing and a gateway that predates
 * it discards it (and keeps the socket, as before) rather than delivering it.
 * It travels on the licence's own channel ({@link licenseChannel}) rather than
 * a channel of its own, for two reasons:
 *
 *   - order: Redis delivers one connection's messages in the order they were
 *     published, so a push published after the revocation reaches the gateway
 *     after the socket was closed — on a second channel, read on a second
 *     connection, it could overtake it;
 *   - reach: only a gateway that holds a socket of the licence subscribes to
 *     its channel, which is exactly the set that has anything to close.
 *
 * Published after the commit, like every push ({@link BusEnvelope}): a
 * gateway that hears it and lets the client straight back in must find the
 * credential already refused.
 */
export const PRINCIPAL_REVOKED = 'principal_revoked';

/**
 * Whose sockets close — always within the envelope's licence, and only
 * sockets opened at the agent door. A visitor's token is signed, not stored:
 * nothing revokes it, and a widget closed for it would log straight back in.
 *
 *   - `token`: the sockets that logged in with this credential (the
 *     `api_tokens` row id) — a session signed out, a personal or bot token
 *     revoked, an operator's session as a member ended;
 *   - `agent`: every socket of this member — or bot — in the licence, whatever
 *     credential each logged in with, an operator signed in as the member
 *     included: the membership they all stand on was suspended or removed;
 *   - `license`: every agent-door socket of the licence — the workspace was
 *     suspended or closed.
 */
export type PrincipalRevokedTarget =
  { kind: 'token'; tokenId: string } | { kind: 'agent'; agentId: string } | { kind: 'license' };

export interface PrincipalRevokedEnvelope {
  v: 1;
  type: typeof PRINCIPAL_REVOKED;
  licenseId: string;
  organizationId: string;
  target: PrincipalRevokedTarget;
  /** Unix milliseconds — for the log, never for ordering. */
  at: number;
}

/** The revocation to publish on `licenseChannel(tenant.licenseId)`, after the commit. */
export function principalRevokedEnvelope(
  tenant: { licenseId: string | bigint; organizationId: string },
  target: PrincipalRevokedTarget,
  at: number = Date.now(),
): PrincipalRevokedEnvelope {
  return {
    v: 1,
    type: PRINCIPAL_REVOKED,
    licenseId: tenant.licenseId.toString(),
    organizationId: tenant.organizationId,
    target,
    at,
  };
}

/**
 * A bus message read as a revocation: the envelope; `null` when it is not one
 * (a push, or anything else); `'malformed'` when it says it is one but cannot
 * be read — which a gateway reports loudly, since a revocation it drops leaves
 * a socket open that should have closed.
 *
 * Ids are matched as given, never checked for shape: a revocation that a
 * stricter reader would refuse is a socket left open.
 */
export function readPrincipalRevoked(
  value: unknown,
): PrincipalRevokedEnvelope | 'malformed' | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate['type'] !== PRINCIPAL_REVOKED) return null;
  const { licenseId, organizationId, at } = candidate;
  if (
    candidate['v'] !== 1 ||
    !isNonEmptyString(licenseId) ||
    !isNonEmptyString(organizationId) ||
    typeof at !== 'number'
  ) {
    return 'malformed';
  }
  const target = readRevokedTarget(candidate['target']);
  if (target === null) return 'malformed';
  return { v: 1, type: PRINCIPAL_REVOKED, licenseId, organizationId, target, at };
}

function readRevokedTarget(value: unknown): PrincipalRevokedTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  const target = value as Record<string, unknown>;
  switch (target['kind']) {
    case 'token':
      return isNonEmptyString(target['tokenId'])
        ? { kind: 'token', tokenId: target['tokenId'] }
        : null;
    case 'agent':
      return isNonEmptyString(target['agentId'])
        ? { kind: 'agent', agentId: target['agentId'] }
        : null;
    case 'license':
      return { kind: 'license' };
    default:
      return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}
