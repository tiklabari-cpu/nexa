/**
 * The workspace's own sign-in client — "first-party" — defined once (tm 438).
 *
 * `oauth_clients` holds two kinds of row and nothing in a row says which it
 * is: the client signup creates for every organization (the agent app the
 * console and the phone sign in through) and the partner apps a workspace admin
 * registers later (FR-MOD-09.4). The first-party client is the organization's
 * **oldest** — the definition `auth_list_memberships` has carried since signup
 * started creating that client (migration 20260724101000), and the client it
 * hands `/auth/login` to sign in with.
 *
 * Every TypeScript reader asks through here, so the doors that depend on the
 * answer cannot drift apart:
 *
 *   - the partner-app routes, which refuse to edit, delete or re-key it;
 *   - SAML discovery (`GET /auth/sso/{id}`), which names it to a browser that
 *     arrived from an identity-provider tile holding only a connection id;
 *   - SAML `/login` and `/acs`, which mint a code for no other client. A code
 *     minted there carries the member's role scopes and the person never sees
 *     which app asked for it — the consent `/auth/authorize` gets from a typed
 *     password — so a partner app must not be able to start that flow.
 *
 * The order is `created_at`, then `id`. Two clients inserted in one
 * transaction share `now()`, and "oldest" alone would then be whichever row the
 * plan returned first; migration 20261229090000 gives `auth_list_memberships`
 * the same tie-break, so the client `/auth/login` hands out is always the one
 * SAML accepts.
 */
import type { Prisma } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';

/** `ORDER BY created_at, id` — how every reader of "first-party" sorts clients. */
export const FIRST_PARTY_CLIENT_ORDER = [
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.OauthClientOrderByWithRelationInput[];

/**
 * The id of the organization's own sign-in client, or null for an organization
 * that registers no client at all.
 *
 * Scoped by RLS (`oauth_clients_tenant`, organization-wide): call it inside
 * `withTenant` for the organization in question, as every caller does.
 */
export async function firstPartyClientId(tx: TenantClient): Promise<string | null> {
  const row = await tx.oauthClient.findFirst({
    orderBy: FIRST_PARTY_CLIENT_ORDER,
    select: { id: true },
  });
  return row?.id ?? null;
}
