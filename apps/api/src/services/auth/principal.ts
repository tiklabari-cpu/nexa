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
  // Reading the brand catalogue (Multibrand, PRD §5.3): an agent picks the brand
  // they are working under, so they read brands but do not create or rename them.
  'brands--all:ro',
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
  // Connecting Messenger/SMS/WhatsApp and sending through them is workspace
  // configuration — owners and admins do it, ordinary agents work the inbox.
  'channels--all:rw',
  'access_rules:rw',
  // Managing the brand catalogue (Multibrand, PRD §5.3) — creating, renaming and
  // removing brands is workspace configuration, an owner/admin power.
  'brands--all:rw',
  'properties.configuration:rw',
  // Reading the security trail (NFR-S12) is an owner/admin power — the route
  // pairs this scope with `minimumRole: admin`, and an ordinary agent gets
  // neither.
  'audit_log--all:ro',
  // Streaming that trail to a SIEM (NFR-C6 · C6-b). Here for the same reason
  // the reading scope is, and it is worth saying why the separation between the
  // two survives it: this list is the *default* a session or an un-narrowed PAT
  // gets, and a holder of it can already walk the whole log page by page, so
  // withholding the export scope here would cost effort, not access. What the
  // separation actually binds is the narrowed token — an integration granted
  // `audit_log--all:ro` for a dashboard does not thereby get the firehose.
  'audit_log--export:ro',
  'reports_read',
  // Defining a scheduled export (PRD §5.3-Reports) mails workspace data out on a
  // timer, so it is an owner/admin power and stops here — `DEFAULT_AGENT_SCOPES`
  // deliberately does not carry it, exactly as it carries no reports scope at all.
  'reports_manage',
  'billing_manage',
];
