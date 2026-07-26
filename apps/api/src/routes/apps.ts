/**
 * Apps marketplace (FR-MOD-09.1).
 *
 * The catalogue and the connect/disconnect flow are managed under `/settings`,
 * on the workspace-admin scopes (`access_rules:ro`/`:rw`) — connecting a
 * third-party app is an admin act, the same call the source platform gates on
 * account settings (see custom fields for the same reasoning).
 *
 * The one read that is *not* an admin act is `GET /chats/{chatId}/apps`: an
 * agent working a conversation reads the connected apps' data in the Details
 * pane, so it sits on the chat scope they already hold, not the admin one.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { AppService } from '../services/apps/app-service.js';

const callbackBody = z.object({
  state: z.string().trim().min(1).max(4096),
  code: z.string().trim().min(1).max(512),
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
      const tenant = request.tenant();
      const items = await request.withTenant((tx) => apps.list(tx, tenant));
      return reply.send({ items });
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
      const item = await request.withTenant((tx) =>
        apps.oauthCallback(tx, tenant, request.params.appId, body),
      );
      return reply.send(item);
    },
  );

  app.delete<{ Params: { appId: string } }>(
    '/settings/apps/:appId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const removed = await request.withTenant((tx) => apps.disconnect(tx, tenant, request.params.appId));
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
      const items = await request.withTenant((tx) => apps.chatData(tx, tenant, request.params.chatId));
      return reply.send({ items });
    },
  );
}
