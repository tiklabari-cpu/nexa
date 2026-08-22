/**
 * Who is making a request.
 *
 * The three principal kinds are deliberately separate types rather than one
 * shape with optional fields: a customer principal has no license and no
 * scopes, and making that a compile-time fact stops a route from accidentally
 * treating widget traffic as an agent (I4 — a customer token must never reach
 * beyond the Customer Chat API).
 */
import type { AgentRole } from '@nexa/types';
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

/**
 * An identity provider's provisioning connector (NFR-S11 · S11-e).
 *
 * A fourth kind rather than an agent token with a special scope, because the
 * question "may this credential reach the agent API?" then gets answered by the
 * same mechanism that keeps a customer token out of it: the route's `principals`
 * list. A SCIM token that ever arrives at `/chats` is refused for what it *is*,
 * not for which scopes somebody remembered to leave off it — and one that
 * arrives with a scope list bolted on later still cannot pass, because
 * `scopes` is empty by construction here.
 *
 * It names no person. The token belongs to the workspace's directory
 * integration, so `accountId` would be a fiction, and every route it can reach
 * derives its subject from the request instead.
 */
export interface ScimPrincipal {
  kind: 'scim';
  licenseId: bigint;
  organizationId: string;
  tokenId: string;
  tokenKind: 'scim';
  /** Always empty. A SCIM token authorises a surface, not a set of operations. */
  scopes: never[];
}

export type Principal = AgentPrincipal | BotPrincipal | CustomerPrincipal | ScimPrincipal;

export function isAgent(principal: Principal): principal is AgentPrincipal {
  return principal.kind === 'agent';
}

export function isBot(principal: Principal): principal is BotPrincipal {
  return principal.kind === 'bot';
}

export function isCustomer(principal: Principal): principal is CustomerPrincipal {
  return principal.kind === 'customer';
}

export function isScim(principal: Principal): principal is ScimPrincipal {
  return principal.kind === 'scim';
}

/** Every principal belongs to exactly one tenant — that is the invariant. */
export function tenantOf(principal: Principal): TenantContext {
  return { licenseId: principal.licenseId, organizationId: principal.organizationId };
}

export function scopesOf(principal: Principal): string[] {
  return principal.kind === 'customer' ? [] : principal.scopes;
}

/**
 * Role rank and the scope ceiling each role carries.
 *
 * Defined in `@nexa/types` (`role-scopes.ts`) and re-exported here so the
 * existing call sites keep one import, and so the RTM gateway — a separate
 * process resolving the same credentials — reads the same list rather than a
 * copy of it (tm 145: a rule spelled twice is a rule that eventually disagrees
 * with itself).
 */
export {
  ROLE_RANK,
  roleAtLeast,
  DEFAULT_AGENT_SCOPES,
  ADMIN_SCOPES,
  defaultScopesForRole,
  scopesWithinRole,
} from '@nexa/types';
