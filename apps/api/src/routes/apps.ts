/**
 * Apps marketplace (FR-MOD-09.1 / 09.2).
 *
 * The catalogue and the connect/disconnect flow are managed under `/settings`,
 * on the workspace-admin scopes (`access_rules:ro`/`:rw`) — connecting a
 * third-party app is an admin act, the same call the source platform gates on
 * account settings (see custom fields for the same reasoning).
 *
 * The one read that is *not* an admin act is `GET /chats/{chatId}/apps`: an
 * agent working a conversation reads the connected apps' data in the Details
 * pane, so it sits on the chat scope they already hold, not the admin one.
 *
 * Two connect paths, one per `provider` (09.2): the OAuth pair for `oauth`
 * cards and `POST /settings/apps/:appId/connect` for `api_key` ones. They are
 * separate routes rather than one body with two shapes because each has to
 * refuse the other's card — a single endpoint that accepted either would put
 * `provider` back where 09.2 found it, describing nothing.
 */
import type { FastifyInstance } from 'fastify';
import {
  APP_API_KEY_MAX_LENGTH,
  APP_API_KEY_MIN_LENGTH,
  APP_CATEGORIES,
  APP_COLLECTIONS,
  APP_PLACEMENTS,
  APP_PRICING_VALUES,
} from '@nexa/types';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { AppService } from '../services/apps/app-service.js';

/**
 * The marketplace list's narrowing controls (09.2) — the customer directory's
 * schema adapted, so the two list surfaces validate the same way. The bounds
 * are the point: `query` is capped at 320 characters and `limit` at 100, so no
 * caller can turn a read into an unbounded scan of the catalogue or the page.
 */
const listQuery = z.object({
  query: z.string().trim().max(320).optional(),
  category: z.enum(APP_CATEGORIES).optional(),
  collection: z.enum(APP_COLLECTIONS).optional(),
  pricing: z.enum(APP_PRICING_VALUES).optional(),
  placement: z.enum(APP_PLACEMENTS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page_id: z.string().max(512).optional(),
});

const callbackBody = z.object({
  state: z.string().trim().min(1).max(4096),
  code: z.string().trim().min(1).max(512),
});

/**
 * The API-key connect body (09.2). The bounds come from @nexa/types rather than
 * being written out here, because the console's form validates against the same
 * two constants — a client that refuses a key this endpoint would take is the
 * failure mode this shares them to avoid.
 */
const connectBody = z.object({
  api_key: z.string().trim().min(APP_API_KEY_MIN_LENGTH).max(APP_API_KEY_MAX_LENGTH),
});

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

export default async function appRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  // The OAuth `state` is signed with a key derived from the JWT signing key, so
  // apps get their own domain-separated secret without a new env var.
  const apps = new AppService(options.env.JWT_SIGNING_KEY);

  app.get(
    '/settings/apps',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);
      const tenant = request.tenant();

      const result = await request.withTenant((tx) =>
        apps.list(tx, tenant, {
          limit: query.limit,
          ...(query.query ? { query: query.query } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.collection ? { collection: query.collection } : {}),
          ...(query.pricing ? { pricing: query.pricing } : {}),
          ...(query.placement ? { placement: query.placement } : {}),
          ...(query.page_id ? { pageId: query.page_id } : {}),
        }),
      );

      return reply.send({
        items: result.items,
        total: result.total,
        ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
      });
    },
  );

  app.post<{ Params: { appId: string } }>(
    '/settings/apps/:appId/oauth/start',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      // Pure — no tenant transaction needed to mint a signed state.
      return reply.send(apps.oauthStart(tenant, request.params.appId));
    },
  );

  app.post<{ Params: { appId: string } }>(
    '/settings/apps/:appId/oauth/callback',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(callbackBody, request.body);
      const tenant = request.tenant();
      const appId = request.params.appId;
      const item = await request.withTenant(async (tx) => {
        const result = await apps.oauthCallback(tx, tenant, appId, body);
        // The OAuth code and the access/refresh token it was exchanged for
        // never reach here — `apps.oauthCallback` mints only a deterministic
        // stub account label, never a real credential. Disconnecting is
        // already recorded as `data.deleted` (`DELETE /settings/apps/:appId`).
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'app.connected',
          target: `app_installation:${appId}`,
          metadata: { app_id: appId, kind: 'app_installation' },
        });
        return result;
      });
      return reply.send(item);
    },
  );

  app.post<{ Params: { appId: string } }>(
    '/settings/apps/:appId/connect',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(connectBody, request.body);
      const tenant = request.tenant();
      const appId = request.params.appId;
      const item = await request.withTenant(async (tx) => {
        const result = await apps.connectWithApiKey(tx, tenant, appId, { apiKey: body.api_key });
        // Same entry as the OAuth path — what changed is which app is connected,
        // not which credential was used, and the credential itself must not be
        // in the trail at all. `api_key` is on the server's redact list
        // (`server.ts`), so the request body does not reach the log either.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'app.connected',
          target: `app_installation:${appId}`,
          metadata: { app_id: appId, kind: 'app_installation' },
        });
        return result;
      });
      return reply.send(item);
    },
  );

  app.delete<{ Params: { appId: string } }>(
    '/settings/apps/:appId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const appId = request.params.appId;
      const removed = await request.withTenant(async (tx) => {
        const count = await apps.disconnect(tx, tenant, appId);
        // Only record a delete that actually happened — a 404 (nothing matched)
        // is not an event worth an entry.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'data.deleted',
            target: `app_installation:${appId}`,
            metadata: { kind: 'app_installation' },
          });
        }
        return count;
      });
      // Nothing removed means no such connection in this tenant — 404 keeps that
      // indistinguishable from another tenant's (NFR-S5).
      if (removed === 0) throw ApiError.notFound('App not found.');
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { chatId: string } }>(
    '/chats/:chatId/apps',
    { config: { scopes: ['chats--all:ro', 'chats--access:ro'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const items = await request.withTenant((tx) =>
        apps.chatData(tx, tenant, request.params.chatId),
      );
      return reply.send({ items });
    },
  );
}
