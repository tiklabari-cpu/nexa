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
 * The `client_secret` is returned from the register response — and from the
 * rotate response, the only other place one ever exists. Storage keeps only
 * `sha256(secret)`, so a lost secret is re-keyed, never recovered.
 *
 * Every write here leaves an entry in the append-only audit log (NFR-S12).
 * Registering, re-scoping, deleting and re-keying a client are all changes to
 * *who may act on this workspace and with what authority* — the same class of
 * change the requirement names by hand for webhooks — and rotation in
 * particular is indistinguishable, after the fact, from an attacker locking the
 * owner out of their own app. The entries carry client type, granted scopes and
 * redirect-URI counts; never a secret, never a URI.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
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

/** `partner_app:<client_id>` — the object an entry is about. */
function auditTarget(clientId: string): string {
  return `partner_app:${clientId}`;
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

  app.post(
    '/partner/apps',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const body = parse(registerBody, request.body);
      const principal = request.requirePrincipal();
      const tenant = request.tenant();

      // Both validations run before anything is written, and each throws the error
      // that fits: a bad redirect URI is a 400, an over-broad scope set is a 403.
      const uris = validateRedirectUris(body.redirect_uris);
      const granted = narrowScopes(body.scopes, scopesOf(principal));

      const registration = await request.withTenant(async (tx) => {
        const created = await partnerApps.register(tx, tenant, {
          displayName: body.display_name,
          clientType: body.client_type,
          redirectUris: uris,
          scopes: granted,
        });
        // Same transaction as the insert, so the trail can never disagree with
        // the registry: either both land or neither. What is recorded is what
        // bounds the client — its type and the scopes it may ever carry — plus
        // how many callbacks it declared. Not the callbacks themselves (a URI can
        // embed a token) and, obviously, not the secret in the response below.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'partner_app.created',
          target: auditTarget(created.client_id),
          metadata: {
            client_type: created.client_type,
            scopes: created.scopes,
            redirect_uri_count: created.redirect_uris.length,
          },
        });
        return created;
      });

      // The secret is in this body and will never be in another one.
      reply.header('Cache-Control', 'no-store');
      return reply.status(201).send(registration);
    },
  );

  app.patch<{ Params: { clientId: string } }>(
    '/partner/apps/:clientId',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
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
        // Nothing changed means nothing to record: a cross-tenant miss updates
        // no row and must leave the trail untouched, exactly as the 404 below
        // leaves the caller none the wiser.
        if (count === 0) return null;

        const updated = await partnerApps.get(tx, clientId);
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'partner_app.updated',
          target: auditTarget(clientId),
          metadata: {
            // Which fields were rewritten, and the new authority where it
            // changed — a scope widening is the part of an edit worth reading
            // back later.
            fields: Object.keys(body).sort(),
            ...(granted !== undefined ? { scopes: granted } : {}),
            ...(uris !== undefined ? { redirect_uri_count: uris.length } : {}),
          },
        });
        return updated;
      });
      if (!item) throw ApiError.notFound('App not found.');

      return reply.send(item);
    },
  );

  app.delete<{ Params: { clientId: string } }>(
    '/partner/apps/:clientId',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const clientId = parse(clientIdSchema, request.params.clientId);

      const removed = await request.withTenant(async (tx) => {
        await assertNotFirstParty(partnerApps, tx, clientId, 'removed');
        // Read before deleting so the entry can say what the client was
        // allowed to do; `remove` returns only a count. The read is RLS-scoped,
        // so another tenant's id reads as null, deletes nothing and logs
        // nothing.
        const doomed = await partnerApps.get(tx, clientId);
        const count = await partnerApps.remove(tx, clientId);
        if (count > 0 && doomed) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'partner_app.deleted',
            target: auditTarget(clientId),
            metadata: { client_type: doomed.client_type, scopes: doomed.scopes },
          });
        }
        return count;
      });
      if (removed === 0) throw ApiError.notFound('App not found.');

      return reply.status(204).send();
    },
  );

  /**
   * Re-key a confidential client. POST rather than a PATCH field because it is
   * not an edit of the app but an action on it: it takes no body, it is not
   * idempotent, and it invalidates the live credential the moment it commits.
   *
   * The workspace's own sign-in client is refused here for the same reason it
   * cannot be edited or deleted — it is first-party infrastructure, and
   * re-keying it would break the agent app rather than a partner integration.
   */
  app.post<{ Params: { clientId: string } }>(
    '/partner/apps/:clientId/rotate-secret',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const clientId = parse(clientIdSchema, request.params.clientId);

      const rotated = await request.withTenant(async (tx) => {
        await assertNotFirstParty(partnerApps, tx, clientId, 're-keyed');
        const result = await partnerApps.rotateSecret(tx, clientId);
        if (!result) return null;

        // In the rotation's own transaction: an entry without the rotation
        // would be a false alarm, and a rotation without the entry would erase
        // the only evidence that a live credential was replaced.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'partner_app.secret_rotated',
          target: auditTarget(clientId),
          metadata: { client_type: result.client_type },
        });
        return result;
      });
      if (!rotated) throw ApiError.notFound('App not found.');

      // As at registration: this body carries the only copy of the new secret.
      reply.header('Cache-Control', 'no-store');
      return reply.send(rotated);
    },
  );
}
