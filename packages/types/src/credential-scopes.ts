/**
 * What a member's credential may do once the permission matrix has had its say
 * (RL-02 · tm 325.3).
 *
 * Until the matrix, a credential's reach was its stored scope list, capped on a
 * session by the role its holder has now (`scopesWithinRole`, SEC-2 · tm 146):
 * the cap could only take authority away, because nothing could hand a role
 * more than its fixed set. The matrix can. A Founder who switches on "Ekip
 * Üyesi raporları görsün" has to reach the sessions already open — within the
 * minute, without anybody signing in again — and switching it off has to take
 * it back the same way. So the rule now depends on what kind of credential it
 * is:
 *
 *   - **session** — a sign-in through the workspace's own client (the panel,
 *     the phone; password or SAML). Its list was the role's set when it was
 *     minted, so it follows the role as the matrix describes it *now*: what the
 *     matrix takes from the role is gone at the next request, and what the
 *     matrix lends the role on top of its default set arrives at the next
 *     request. What it never does is re-derive the role's *default* set from
 *     scratch — a session minted before a promotion stays the old role's
 *     (`role-demotion.test.ts`): new rank arrives with a new sign-in, where
 *     somebody proves the password again. Only the matrix's lending crosses
 *     that line, because lending is what the Founder asked for.
 *   - **delegated** — a partner app's grant. Its list is what the person
 *     consented to hand the app, capped as before, now by the matrix: it loses
 *     what the matrix takes from the role and never gains past its own list.
 *   - **personal** — a personal access token. A named credential with a list
 *     somebody chose; it keeps that list except what the matrix takes from the
 *     role's default set. A scope outside the role's default set stays where
 *     tm 146 left it — the role gate on the route refuses it — so "an agent
 *     holding a broad token" is still the state the role gates are tested
 *     against. It never gains: a scope the matrix lends the role cannot be
 *     minted into one at all ({@link delegableScopes}), because a token that
 *     outlived the loan would keep it.
 *   - **impersonation** — an operator signed in as a member from the root
 *     panel (tm 389.15 · FR-ADMIN-21). The token stores no list at all: it
 *     holds exactly what the member's role holds in the matrix now, so the
 *     operator sees what the member would and never more (requirements §3.10 —
 *     the role is carried, not raised).
 *
 * Here rather than in `apps/api` for the reason `role-scopes.ts` is: the REST
 * edge (`token-service.ts`) and the RTM gateway (`apps/rtm/src/auth.ts`) resolve
 * the same token, and the two have to reach the same answer (tm 145).
 */
import { scopesForRole, type CapabilityOverride, type CapabilityValue } from './capabilities.js';
import { defaultScopesForRole } from './role-scopes.js';
import { effectiveScopes } from './scopes.js';

/** Which rule a member's credential follows — see the module comment. */
export type CredentialGrant = 'session' | 'delegated' | 'personal' | 'impersonation';

/**
 * The rule for a member's token. `kind` is `api_tokens.kind`; `signInClient` is
 * whether the token was issued to a client registered with no scope list of its
 * own — the workspace's sign-in client, the one `/auth/authorize` lets ask for
 * whatever the role holds. Partner registration refuses an empty list
 * (`partner-app-service.narrowScopes`), so no partner app is one. A kind this
 * does not know gets the strictest rule.
 */
export function credentialGrantFor(kind: string, signInClient: boolean): CredentialGrant {
  if (kind === 'oauth') return signInClient ? 'session' : 'delegated';
  if (kind === 'pat') return 'personal';
  if (kind === 'impersonation') return 'impersonation';
  return 'delegated';
}

export interface CredentialScopeInput {
  grant: CredentialGrant;
  /** The membership's role now — read on every request, never off the token. */
  role: string;
  /** The list on the token row. */
  stored: readonly string[];
  /** The workspace's stored matrix choices (`role_capability_overrides`). */
  overrides: readonly CapabilityOverride[];
}

/**
 * The scopes a member's credential holds on this request. With no overrides it
 * is exactly what the credential held before the matrix: `scopesWithinRole` for
 * a session or a partner grant, the stored list for a personal token — same
 * scopes, same order (the regression bar, `credential-scopes.test.ts`).
 *
 * Comparisons run on implied sets (`effectiveScopes`), the expansion the route
 * gate reads a token through: a stored `chats--all:ro` survives a role that
 * holds `chats--all:rw`, and dies with it.
 */
export function scopesForCredential(input: CredentialScopeInput): string[] {
  const roleNow = scopesForRole(input.role, input.overrides);
  if (input.grant === 'impersonation') return [...roleNow];
  const held = effectiveScopes(roleNow);
  if (input.grant === 'delegated') return input.stored.filter((scope) => held.has(scope));

  const roleDefault = effectiveScopes(defaultScopesForRole(input.role));
  if (input.grant === 'personal') {
    // Lose only what the matrix took from the role's default set.
    return input.stored.filter((scope) => held.has(scope) || !roleDefault.has(scope));
  }

  // A session: what it holds that the role still holds, plus what the matrix
  // lends the role beyond its default set.
  const out = input.stored.filter((scope) => held.has(scope));
  const seen = new Set(out);
  for (const scope of roleNow) {
    if (!roleDefault.has(scope) && !seen.has(scope)) {
      out.push(scope);
      seen.add(scope);
    }
  }
  return out;
}

/**
 * What a personal access token may be minted with: the role's default set,
 * after implication. A scope the matrix lends the role on top of it stays on
 * the session — a token minted with it would keep it after the Founder takes
 * the loan back, since a personal token only loses what the matrix takes from
 * the role's default set.
 */
export function delegableScopes(role: string): Set<string> {
  return effectiveScopes(defaultScopesForRole(role));
}

/**
 * Whether a member's own `chats.view` level keeps them to the chats they are
 * assigned to or have joined, whatever their credential's scopes say. `own`
 * holds the `team` level's scopes (`capabilities.ts`) — the narrowing is this
 * check's, in the inbox's visibility rule and the gateway's audience; `none`
 * holds no chat scope, and narrows a credential that still carries one (a
 * token minted for a higher role) the same way.
 */
export function narrowsChatReach(level: CapabilityValue | undefined): boolean {
  return level === 'own' || level === 'none';
}
