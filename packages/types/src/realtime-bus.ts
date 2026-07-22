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
  return `nexa:rtm:license:${licenseId}`;
}

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
