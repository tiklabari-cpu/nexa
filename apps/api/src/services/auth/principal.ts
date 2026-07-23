/**
 * Who is making a request.
 *
 * The three principal kinds are deliberately separate types rather than one
 * shape with optional fields: a customer principal has no license and no
 * scopes, and making that a compile-time fact stops a route from accidentally
 * treating widget traffic as an agent (I4 — a customer token must never reach
 * beyond the Customer Chat API).
 */
import type { AgentRole, Scope } from '@nexa/types';
import type { TenantContext } from '../../lib/tenant.js';

export interface AgentPrincipal {
  kind: 'agent';
  accountId: string;
  licenseId: bigint;
  organizationId: string;
  role: AgentRole;
  scopes: string[];
  tokenId: string;
  tokenKind: 'pat' | 'oauth';
}

export interface BotPrincipal {
  kind: 'bot';
  botId: string;
  licenseId: bigint;
  organizationId: string;
  scopes: string[];
  tokenId: string;
  tokenKind: 'bot';
}

export interface CustomerPrincipal {
  kind: 'customer';
  customerId: string;
  organizationId: string;
  /** Which license's widget minted this token. */
  licenseId: bigint;
}

export type Principal = AgentPrincipal | BotPrincipal | CustomerPrincipal;

export function isAgent(principal: Principal): principal is AgentPrincipal {
  return principal.kind === 'agent';
}

export function isBot(principal: Principal): principal is BotPrincipal {
  return principal.kind === 'bot';
}

export function isCustomer(principal: Principal): principal is CustomerPrincipal {
  return principal.kind === 'customer';
}

/** Every principal belongs to exactly one tenant — that is the invariant. */
export function tenantOf(principal: Principal): TenantContext {
  return { licenseId: principal.licenseId, organizationId: principal.organizationId };
}

export function scopesOf(principal: Principal): string[] {
  return principal.kind === 'customer' ? [] : principal.scopes;
}

/**
 * Roles are coarse ("can this person administer the workspace"); scopes are
 * fine ("may this token write chats"). Both are enforced — a route that only
 * checked scopes would let an Agent-role user with a broad PAT act as an admin.
 */
export const ROLE_RANK: Record<AgentRole, number> = {
  owner: 3,
  viceowner: 2,
  admin: 1,
  agent: 0,
};

export function roleAtLeast(role: AgentRole, minimum: AgentRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Scopes granted to a newly created PAT when the caller does not narrow them. */
export const DEFAULT_AGENT_SCOPES: Scope[] = [
  'accounts--my:ro',
  'agents--my:rw',
  'chats--access:rw',
  'tickets--access:rw',
  'customers:ro',
  'groups--my:ro',
  'tags--groups:ro',
];

/** An owner or admin gets the tenant-wide set. */
export const ADMIN_SCOPES: Scope[] = [
  'accounts--all:rw',
  'agents--all:rw',
  // Managing AI agents, skills and knowledge. Owners and admins configure the
  // automation; ordinary agents work alongside it and do not reconfigure it
  // mid-shift.
  'agents-bot--all:rw',
  'chats--all:rw',
  'tickets--all:rw',
  'customers:rw',
  'customers.ban:rw',
  'groups--all:rw',
  'tags--all:rw',
  'canned_responses--all:rw',
  'webhooks--all:rw',
  'access_rules:rw',
  'properties.configuration:rw',
  'reports_read',
  'billing_manage',
];
