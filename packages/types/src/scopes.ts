/**
 * OAuth scopes — v2-03 §8.5, transcribed verbatim from the source platform.
 * (The section heading says "~63"; its table actually enumerates 58.)
 *
 * Convention: `resource--access:permission`
 *   permission ∈ ro (read) | rw (read/write) | rc (read/create)
 *   access     ∈ my (own) | all (tenant-wide) | groups | access
 *
 * Reports/Billing scopes intentionally break the pattern — kept as-is so the
 * surface stays familiar to anyone who has integrated with the original.
 */

export const SCOPES = [
  // Account
  'accounts--my:ro',
  'accounts--my:rw',
  'accounts--all:ro',
  'accounts--all:rw',
  'accounts--all:rc',
  // Role
  'accounts.roles--all:ro',
  'accounts.roles.lc--all:rw',
  // Session
  'sessions--my:ro',
  'sessions--my:rw',
  // Organization
  'organization--my:rw',
  // Agent
  'agents--my:rw',
  'agents--my:ro',
  'agents--all:rw',
  'agents--all:ro',
  // Access rules
  'access_rules:ro',
  'access_rules:rw',
  // Bot
  'agents-bot--my:ro',
  'agents-bot--my:rw',
  'agents-bot--all:ro',
  'agents-bot--all:rw',
  // Canned responses
  'canned_responses--groups:ro',
  'canned_responses--groups:rw',
  'canned_responses--all:ro',
  'canned_responses--all:rw',
  // Group
  'groups--my:rw',
  'groups--my:ro',
  'groups--all:rw',
  'groups--all:ro',
  // Chat
  'chats--all:ro',
  'chats--access:ro',
  'chats--all:rw',
  'chats--access:rw',
  // Ticket. Not in the source platform's list (v2-03 §8.5) because there
  // ticketing is a separate product with its own API. Nexa merges the two
  // surfaces into one inbox, so tickets need scopes of their own — reusing
  // `chats--*` would mean a token scoped to conversations silently also reads
  // the follow-up work, and ADR-04 keeps resources distinct. See PLAN §D.
  'tickets--all:ro',
  'tickets--access:ro',
  'tickets--all:rw',
  'tickets--access:rw',
  // Customer
  'customers.ban:rw',
  'customers:own',
  'customers:ro',
  'customers:rw',
  // Multicast
  'multicast:rw',
  // Properties
  'properties.license.value--my:rw',
  'properties.license.value--all:rw',
  'properties.group.value--my:rw',
  'properties.group.value--all:rw',
  'properties.configuration:rw',
  // Tag
  'tags--all:rw',
  'tags--all:ro',
  'tags--groups:rw',
  'tags--groups:ro',
  // Webhook
  'webhooks--my:ro',
  'webhooks--my:rw',
  'webhooks--all:ro',
  'webhooks--all:rw',
  'webhooks.state:ro',
  'webhooks.state:rw',
  'webhooks.configuration:rw',
  // Reports / Billing — do not follow the `--` pattern
  'reports_read',
  'billing_manage',
  'billing_admin',
  'billing--all:rw',
  'ledger_read',
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

/**
 * A `:rw` scope implies its `:ro` counterpart, and an `--all` scope implies the
 * narrower `--access` / `--my` / `--groups` variants of the same resource.
 * Returns every scope string that `granted` satisfies.
 */
export function expandScope(granted: Scope): Scope[] {
  const out = new Set<Scope>([granted]);

  const match = /^(?<resource>[^-:]+(?:\.[^-:]+)*)(?:--(?<access>[^:]+))?:(?<perm>ro|rw|rc)$/.exec(
    granted,
  );
  if (!match?.groups) return [...out];

  const { resource, access, perm } = match.groups as {
    resource: string;
    access?: string;
    perm: string;
  };

  const accesses = access === 'all' ? ['all', 'access', 'groups', 'my'] : access ? [access] : [];
  const perms = perm === 'rw' ? ['rw', 'ro', 'rc'] : [perm];

  for (const a of accesses.length ? accesses : [undefined]) {
    for (const p of perms) {
      const candidate = a ? `${resource}--${a}:${p}` : `${resource}:${p}`;
      if (isScope(candidate)) out.add(candidate);
    }
  }
  return [...out];
}

/** Every scope the token effectively holds, after implication expansion. */
export function effectiveScopes(granted: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const g of granted) {
    out.add(g);
    if (isScope(g)) for (const s of expandScope(g)) out.add(s);
  }
  return out;
}

/** True when `granted` satisfies at least one of `required` (OR semantics). */
export function hasAnyScope(granted: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const effective = effectiveScopes(granted);
  return required.some((r) => effective.has(r));
}
