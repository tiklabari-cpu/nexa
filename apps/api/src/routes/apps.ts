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
 *
 * Live cards (tm 263): `connect` asks the provider before it writes, outside
 * the tenant transaction, and is metered per caller (`rl:apps-connect:*`,
 * `RATE_LIMIT_APPS_CONNECT_PER_HOUR`) because each attempt is a call to a third
 * party with whatever was pasted. Under `PILOT_MODE=true` the live cards are the
 * marketplace: the list and the chat panel show them and nothing else, and the
 * pilot gate lets their connect and disconnect through (`pilotLiveParam`).
 */
import type { FastifyInstance } from 'fastify';
import {
  APP_API_KEY_MAX_LENGTH,
  APP_API_KEY_MIN_LENGTH,
  APP_CATEGORIES,
  APP_COLLECTIONS,
  APP_PLACEMENTS,
  APP_PRICING_VALUES,
} from '@siyahtus/types';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import type { SafeHttp } from '../lib/safe-fetch.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { AppService } from '../services/apps/app-service.js';
import { liveAppIds } from '../services/apps/verifiers/registry.js';
import {
  DEFAULT_PROVIDER_ENDPOINTS,
  type ProviderEndpoints,
} from '../services/apps/verifiers/types.js';
import { createSafeHttp } from '../lib/safe-fetch.js';

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
 * The API-key connect body (09.2). The bounds come from @siyahtus/types rather than
 * being written out here, because the console's form validates against the same
 * two constants — a client that refuses a key this endpoint would take is the
 * failure mode this shares them to avoid.
 */
const connectBody = z.object({
  api_key: z.string().trim().min(APP_API_KEY_MIN_LENGTH).max(APP_API_KEY_MAX_LENGTH),
  /**
   * The provider account's subdomain, for the cards that name one
   * (`credentialFields`, tm 263 — Freshdesk). Bounded here; its shape (one DNS
   * label) is checked by the service, which owns the rule.
   */
  subdomain: z.string().trim().max(255).optional(),
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
  options: {
    env: Env;
    /** The provider client (tm 263). Omitted, the real one; tests pin it to a local fake. */
    appsHttp?: SafeHttp;
    /** Provider hosts (tm 263). Omitted, the real ones. */
    appsEndpoints?: ProviderEndpoints;
  },
): Promise<void> {
  const { env } = options;
  // The OAuth `state` is signed with a key derived from the JWT signing key, so
  // apps get their own domain-separated secret without a new env var.
  const apps = new AppService(env.JWT_SIGNING_KEY, {
    providers: env.APPS_LIVE_PROVIDERS,
    credentialKey: env.APPS_CREDENTIAL_KEY,
    context: {
      http: options.appsHttp ?? createSafeHttp(),
      endpoints: options.appsEndpoints ?? DEFAULT_PROVIDER_ENDPOINTS,
    },
  });
  // The data cards this deployment runs live (telegram is a channel, not listed here).
  const pilotCards = liveAppIds(env.APPS_LIVE_PROVIDERS).filter((id) => id !== 'telegram');

  app.get(
    '/settings/apps',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      // The public pilot (tm 257.18) offers no mock marketplace: its catalogue
      // is mock OAuth and unused API keys. The read is not refused — Developers
      // → Webhook subscriptions lists `?category=productivity` for its app
      // picker — it shows only the cards this deployment runs live (tm 263),
      // which is nothing at all until `APPS_LIVE_PROVIDERS` names one.
      if (env.PILOT_MODE && pilotCards.length === 0) return reply.send({ items: [], total: 0 });
      const query = parse(listQuery, request.query);
      const tenant = request.tenant();

      const result = await request.withTenant((tx) =>
        apps.list(tx, tenant, {
          ...(env.PILOT_MODE ? { onlyIds: pilotCards } : {}),
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
    { config: { scopes: ['access_rules:rw'], pilotRefused: true } },
    async (request, reply) => {
      const tenant = request.tenant();
      // Pure — no tenant transaction needed to mint a signed state.
      return reply.send(apps.oauthStart(tenant, request.params.appId));
    },
  );

  app.post<{ Params: { appId: string } }>(
    '/settings/apps/:appId/oauth/callback',
    { config: { scopes: ['access_rules:rw'], pilotRefused: true } },
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
    { config: { scopes: ['access_rules:rw'], pilotRefused: true, pilotLiveParam: 'appId' } },
    async (request, reply) => {
      const body = parse(connectBody, request.body);
      const tenant = request.tenant();
      const appId = request.params.appId;

      // Charged before anything else, valid body or not: a live card turns
      // every attempt into a call to the provider with the pasted key, so this
      // is what bounds a key-guessing loop through this deployment. Per caller
      // (the person, or the bot) for an hour; fails open on a Redis outage like
      // every in-handler budget, and says so in the log.
      const principal = request.requirePrincipal();
      const caller =
        principal.kind === 'agent'
          ? principal.accountId
          : principal.kind === 'bot'
            ? `bot:${principal.botId}`
            : `license:${tenant.licenseId}`;
      let allowed = true;
      try {
        const decision = await app.rateLimiter.consume(
          `rl:apps-connect:${caller}`,
          env.RATE_LIMIT_APPS_CONNECT_PER_HOUR,
          3_600_000,
        );
        allowed = decision.allowed;
        if (!allowed) {
          throw ApiError.tooManyRequests(
            Math.max(1, Math.ceil(decision.resetMs / 1000)),
            'Too many connection attempts — try again later.',
          );
        }
      } catch (error) {
        if (!allowed) throw error;
        request.log.error({ err: error }, 'apps connect budget unavailable — allowing attempt');
      }

      // Outside the transaction: a provider call must not hold a pool slot.
      const verified = await apps.verifyCredentials(appId, {
        apiKey: body.api_key,
        ...(body.subdomain !== undefined ? { subdomain: body.subdomain } : {}),
      });
      const item = await request.withTenant(async (tx) => {
        const result = await apps.connectWithApiKey(
          tx,
          tenant,
          appId,
          { apiKey: body.api_key },
          verified,
        );
        // Same entry as the OAuth path — what changed is which app is connected,
        // not which credential was used, and the credential itself must not be
        // in the trail at all (nor the provider's account label: it names a
        // person). `api_key` is on the server's redact list (`server.ts`), so
        // the request body does not reach the log either.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'app.connected',
          target: `app_installation:${appId}`,
          metadata: { app_id: appId, kind: 'app_installation', live: verified !== null },
        });
        return result;
      });
      return reply.send(item);
    },
  );

  app.delete<{ Params: { appId: string } }>(
    '/settings/apps/:appId',
    { config: { scopes: ['access_rules:rw'], pilotRefused: true, pilotLiveParam: 'appId' } },
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
      // The pilot shows no stub data about a real customer (tm 257.18) — only
      // what a live card read from its provider (tm 263); with none switched
      // on, an empty list, which the Details panel tolerates.
      if (env.PILOT_MODE && pilotCards.length === 0) return reply.send({ items: [] });
      const tenant = request.tenant();
      const plan = await request.withTenant((tx) =>
        apps.chatDataPlan(tx, tenant, request.params.chatId),
      );
      const items = await apps.chatDataResolve(tenant, plan);
      return reply.send({ items: env.PILOT_MODE ? items.filter((item) => item.live) : items });
    },
  );
}
