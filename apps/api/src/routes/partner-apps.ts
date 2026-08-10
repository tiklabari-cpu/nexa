/**
 * Partner app registration — FR-MOD-09.4 (v2, Could). "Build your own app": a
 * workspace admin registers an OAuth 2.1 client and gets the `client_id` (and,
 * for a confidential client, the `client_secret`) that `POST /auth/authorize`
 * and `POST /auth/token` already accept.
 *
 * Three guards sit on this surface, and they are the reason it exists as one
 * file rather than several. The scope: reads take `access_rules:ro`, writes
 * `access_rules:rw` — the same workspace-admin pair the apps marketplace uses
 * (`routes/apps.ts`), deliberately reused rather than inventing a scope, since
 * a new one would immediately become a *delegatable* permission and blur the
 * line between first-party admin authority and third-party developer authority.
 * The ceiling: a session can never register a client holding scopes it does not
 * hold itself. And isolation: every query runs under organization-scoped RLS,
 * so another organization's `client_id` answers 404 rather than 403 — a 403
 * would confirm the id is real (NFR-S5).
 *
 * The `client_secret` is returned from the register response and from nowhere
 * else; storage keeps only `sha256(secret)`. Rotation and the audit trail are
 * 09.4-d's job, so a lost secret is currently a re-registration.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import { scopesOf } from '../services/auth/principal.js';
import {
  MAX_REDIRECT_URIS,
  PARTNER_APP_CLIENT_TYPES,
  PartnerAppService,
  narrowScopes,
  validateRedirectUris,
} from '../services/partner/partner-app-service.js';

// `.strict()` throughout: a typo in a field name must be a 400, not a silently
// ignored instruction. On this surface a dropped `scopes` key would leave the
// client unbounded and a dropped `redirect_uris` would leave the old allowlist
// in place — both look like success from the caller's side.
const redirectUris = z.array(z.string().trim().min(1).max(2048)).min(1).max(MAX_REDIRECT_URIS);
const scopes = z.array(z.string().trim().min(1).max(120)).min(1).max(64);

const registerBody = z
  .object({
    display_name: z.string().trim().min(1).max(120),
    client_type: z.enum(PARTNER_APP_CLIENT_TYPES).default('public'),
    redirect_uris: redirectUris,
    scopes,
  })
  .strict();

// `client_type` is absent on purpose: switching confidential → public would
// leave the stored secret in place while the token endpoint stopped requiring
// it, silently downgrading the client's authentication; public → confidential
// would need a secret this route has no way to hand back on a PATCH. Register a
// new app instead.
const patchBody = z
  .object({
    display_name: z.string().trim().min(1).max(120).optional(),
    redirect_uris: redirectUris.optional(),
    scopes: scopes.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const clientIdSchema = z.string().trim().min(1).max(128);

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

/**
 * The workspace's own sign-in client shares this table (signup inserts one per
 * organization) and `auth_list_memberships` identifies it as the organization's
 * oldest client. Editing its redirect URIs would break the agent app's callback;
 * deleting it would lock every member out of the workspace. Neither is a
 * partner-app operation, so both are refused — as a 400, because the row is
 * plainly visible in the list and pretending it does not exist would be the
 * confusing answer.
 */
async function assertNotFirstParty(
  partnerApps: PartnerAppService,
  tx: TenantClient,
  clientId: string,
  verb: string,
): Promise<void> {
  if ((await partnerApps.firstPartyClientId(tx)) === clientId) {
    throw ApiError.validation(
      `This is the workspace's own sign-in client and cannot be ${verb} here.`,
    );
  }
}

export default async function partnerAppRoutes(app: FastifyInstance): Promise<void> {
  const partnerApps = new PartnerAppService();

  app.get(
    '/partner/apps',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) => partnerApps.list(tx));
      return reply.send({ items });
    },
  );

  app.get<{ Params: { clientId: string } }>(
    '/partner/apps/:clientId',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const clientId = parse(clientIdSchema, request.params.clientId);
      const item = await request.withTenant((tx) => partnerApps.get(tx, clientId));
      // Also the answer for another organization's client: RLS hides the row and
      // 404 keeps client ids un-enumerable (NFR-S5).
      if (!item) throw ApiError.notFound('App not found.');
      return reply.send(item);
    },
  );

  app.post('/partner/apps', { config: { scopes: ['access_rules:rw'] } }, async (request, reply) => {
    const body = parse(registerBody, request.body);
    const principal = request.requirePrincipal();
    const tenant = request.tenant();

    // Both validations run before anything is written, and each throws the error
    // that fits: a bad redirect URI is a 400, an over-broad scope set is a 403.
    const uris = validateRedirectUris(body.redirect_uris);
    const granted = narrowScopes(body.scopes, scopesOf(principal));

    const registration = await request.withTenant((tx) =>
      partnerApps.register(tx, tenant, {
        displayName: body.display_name,
        clientType: body.client_type,
        redirectUris: uris,
        scopes: granted,
      }),
    );

    // The secret is in this body and will never be in another one.
    reply.header('Cache-Control', 'no-store');
    return reply.status(201).send(registration);
  });

  app.patch<{ Params: { clientId: string } }>(
    '/partner/apps/:clientId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const clientId = parse(clientIdSchema, request.params.clientId);
      const body = parse(patchBody, request.body);
      const principal = request.requirePrincipal();

      const uris = body.redirect_uris ? validateRedirectUris(body.redirect_uris) : undefined;
      // The ceiling applies to every write, not just the first: otherwise a
      // narrow registration followed by a PATCH would be the escalation path.
      const granted = body.scopes ? narrowScopes(body.scopes, scopesOf(principal)) : undefined;

      // Write and read-back in one transaction, so the response is the row that
      // was just written rather than whatever a second transaction happens to see.
      const item = await request.withTenant(async (tx) => {
        await assertNotFirstParty(partnerApps, tx, clientId, 'edited');
        const count = await partnerApps.update(tx, clientId, {
          ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
          ...(uris !== undefined ? { redirectUris: uris } : {}),
          ...(granted !== undefined ? { scopes: granted } : {}),
        });
        return count === 0 ? null : partnerApps.get(tx, clientId);
      });
      if (!item) throw ApiError.notFound('App not found.');

      return reply.send(item);
    },
  );

  app.delete<{ Params: { clientId: string } }>(
    '/partner/apps/:clientId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const clientId = parse(clientIdSchema, request.params.clientId);

      const removed = await request.withTenant(async (tx) => {
        await assertNotFirstParty(partnerApps, tx, clientId, 'removed');
        return partnerApps.remove(tx, clientId);
      });
      if (removed === 0) throw ApiError.notFound('App not found.');

      return reply.status(204).send();
    },
  );
}
