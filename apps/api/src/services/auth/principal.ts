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

/**
 * A password holder halfway through setting up their first second factor
 * (NFR-S11 · FR-MOD-00.1 · S11-2FA-k).
 *
 * A fifth kind rather than a narrow session, because "narrow session" is the
 * shape that reopens the hole `enforceSecondFactor` closed. A workspace with
 * `require_two_factor` refuses a session to an account holding no factor; if
 * the way out of that refusal were a session with a short scope list, then
 * every route reachable by *any* of those scopes would be reachable by
 * somebody who has proved a password and nothing else — and the list would
 * only have to be widened once, by somebody who did not know why it was short.
 *
 * A distinct kind inverts the default. `DEFAULT_PRINCIPALS` in
 * `plugins/auth.ts` is `['agent', 'bot']`, so every route in the product
 * already refuses this one — a new route is closed to it the day it is
 * written — and the two endpoints it may reach say so out loud in their
 * `principals` list. Adding it to a third would be a visible line in a diff
 * rather than a scope somebody quietly appended.
 *
 * It still names a person, unlike `ScimPrincipal`: `accountId` is whose factor
 * is being enrolled, the audit trail records them as the actor, and the ticket
 * is minted against a membership that was resolved from a verified password.
 * What it does not carry is a role — nothing it can reach asks about one, and
 * a role on this principal would be an invitation to write something that does.
 */
export interface EnrollmentPrincipal {
  kind: 'enrollment';
  accountId: string;
  licenseId: bigint;
  organizationId: string;
  tokenId: string;
  tokenKind: 'enrollment';
  /**
   * Fixed at resolution to `ENROLLMENT_TICKET_SCOPES`, never read from the
   * token row — the same "by construction" guarantee `ScimPrincipal.scopes`
   * makes with `never[]`. The two enrollment endpoints are scope-gated like
   * every other own-account route, so this has to satisfy that gate; making it
   * a constant is what stops a widened row from ever meaning a widened reach.
   */
  scopes: string[];
}

/**
 * Everything an enrollment ticket may ask for: write access to its own account,
 * which is what `/auth/2fa/enroll` and `/auth/2fa/activate` are gated on.
 *
 * `accounts--my:rw` is also what six other endpoints ask for, and this
 * deliberately does not protect against that — the `principals` gate does,
 * before scopes are even considered. Two independent refusals, so neither one
 * is the single thing somebody has to remember.
 */
export const ENROLLMENT_TICKET_SCOPES: readonly string[] = ['accounts--my:rw'];

export type Principal =
  AgentPrincipal | BotPrincipal | CustomerPrincipal | ScimPrincipal | EnrollmentPrincipal;

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

export function isEnrollment(principal: Principal): principal is EnrollmentPrincipal {
  return principal.kind === 'enrollment';
}

/**
 * The account a principal is acting *on its own behalf* for, or null when it
 * does not act for one.
 *
 * The two enrollment endpoints accept an agent session and an enrollment ticket
 * alike, and both name a person; without this they would each cast to
 * `AgentPrincipal` and read `accountId` off a shape that is no longer the only
 * one they receive. A cast that used to be true and quietly stopped being so is
 * exactly the failure this replaces.
 */
export function selfAccountId(principal: Principal): string | null {
  if (principal.kind === 'agent' || principal.kind === 'enrollment') return principal.accountId;
  return null;
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
