/**
 * What a role is allowed to hold — the bridge between the coarse axis (role)
 * and the fine one (scopes).
 *
 * Here rather than in `apps/api` because two processes have to reach the same
 * answer: the REST edge resolves a bearer token into a principal, and the RTM
 * gateway resolves the *same* token into a socket principal. `servesRegion` is
 * shared for exactly this reason, and tm 145 is what happens when a rule of
 * this kind lives in one process and is restated in another: the two disagree,
 * and the disagreement is a hole rather than an inconsistency.
 */
import type { AgentRole } from './domain.js';
import { effectiveScopes, type Scope } from './scopes.js';

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

/**
 * The scopes a session gets when the caller asks for none.
 *
 * Three doors into the product answer this question — the password sign-in
 * (`routes/auth.ts`), the SAML ACS (`routes/saml.ts`, S11-d) and a PAT minted
 * without an explicit list — so it is stated once. Restating it would let them
 * drift apart on what an `admin` is allowed to do.
 */
export function defaultScopesForRole(role: string): Scope[] {
  return roleAtLeast(role as AgentRole, 'admin')
    ? [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES]
    : [...DEFAULT_AGENT_SCOPES];
}

/**
 * The scopes on a *session* credential, capped by the role its holder has
 * **now** (SEC-2, tm 146).
 *
 * A session's scope list is role-derived by construction: every door that mints
 * one asks `defaultScopesForRole` for the membership's role at the time. That
 * makes the stored list a *snapshot* of a value that keeps changing, and until
 * this existed nothing re-read it: `token-service` refreshed the role from the
 * membership on every request — its comment promising that "revoking someone's
 * admin rights must take effect on their existing tokens immediately" — while
 * handing back the scopes frozen at sign-in. An admin demoted to agent kept
 * every admin scope, and `oauth-service.refresh` copied them into each rotation,
 * so a client that kept refreshing kept them indefinitely. The routes protected
 * by scope alone — `PATCH /settings/security` among them, which switches off IP
 * allow-listing and the 2FA requirement — stayed open to them.
 *
 * Intersection, never union: this can only take authority away. Promotion does
 * not widen a credential minted before it, because the stored list is still the
 * old one and this returns a subset of it — a new session is what carries new
 * authority.
 *
 * The ceiling is the role's default set *after implication* (`effectiveScopes`),
 * which is the same expansion the route gate reads a token through. Comparing
 * against the literal list instead would refuse scopes the role demonstrably
 * holds: an owner's `chats--all:rw` already satisfies `chats--all:ro`
 * everywhere else in the product, so a partner app granted the narrower one
 * would have been handed an empty session — a *narrower* request denied where
 * the broader one is allowed, which is not a ceiling but a spelling test.
 *
 * Deliberately *not* applied to personal access tokens. A PAT is a named
 * credential someone deliberately created with an explicit list, and this
 * product supports "an agent-role user holding a broad PAT" as a real state —
 * that is precisely what the role gate on a route exists to refuse
 * (`plugins/auth.ts`, `minimumRole`), and several suites assert it. Narrowing
 * PATs here would delete that state rather than defend against it. What binds a
 * stale PAT is the other half of tm 146: the admin surfaces it can reach now
 * carry `minimumRole: 'admin'`, and the role behind them is read fresh on every
 * request.
 */
export function scopesWithinRole(role: AgentRole, granted: readonly string[]): string[] {
  const ceiling = effectiveScopes(defaultScopesForRole(role));
  return granted.filter((scope) => ceiling.has(scope));
}
