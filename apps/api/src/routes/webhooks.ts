/**
 * Outbound webhooks — FR-MOD-08.8.4 (v1, Must). The platform's highest-risk
 * egress surface (NFR-S7, R1/R2): the server POSTs to a customer-supplied URL.
 *
 * Two guards sit on registration here. The scope: only an admin holding
 * `webhooks--all:rw` may register or remove one. And the URL: `assertPublicHttpUrl`
 * refuses a private, loopback, link-local or non-http(s) target on the way in,
 * so an obviously-internal address never reaches storage. The stronger,
 * DNS-resolving re-check runs again at delivery time (the dispatcher), because a
 * name that is public today can point inward tomorrow.
 *
 * The signing secret is returned only from the register response; `GET /webhooks`
 * never carries it (see `WebhookService`).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { assertPublicHttpUrl } from '../lib/ssrf.js';
import {
  WebhookService,
  WEBHOOK_ACTIONS,
  WEBHOOK_TYPES,
  type WebhookAction,
  type WebhookType,
} from '../services/webhooks/webhook-service.js';

const registerBody = z.object({
  url: z.string().trim().min(1).max(2048),
  action: z.enum(WEBHOOK_ACTIONS as unknown as [string, ...string[]]),
  type: z.enum(WEBHOOK_TYPES as unknown as [string, ...string[]]).default('license'),
});

const uuid = z.string().uuid();

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

export default async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const webhooks = new WebhookService();

  app.get(
    '/webhooks',
    { config: { scopes: ['webhooks--all:ro', 'webhooks--all:rw'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) => webhooks.list(tx));
      return reply.send({ items });
    },
  );

  app.post('/webhooks', { config: { scopes: ['webhooks--all:rw'] } }, async (request, reply) => {
    const body = parse(registerBody, request.body);
    const tenant = request.tenant();

    // Literal SSRF guard on the way in: rejects private/loopback/link-local
    // IPs, embedded credentials and non-http(s) schemes with a 400. The
    // resolved DNS re-check is the dispatcher's job at delivery time.
    const url = assertPublicHttpUrl(body.url);

    const created = await request.withTenant((tx) =>
      webhooks.register(tx, tenant, {
        url: url.toString(),
        action: body.action as WebhookAction,
        type: body.type as WebhookType,
      }),
    );
    return reply.status(201).send(created);
  });

  app.delete<{ Params: { webhookId: string } }>(
    '/webhooks/:webhookId',
    { config: { scopes: ['webhooks--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.webhookId);

      const removed = await request.withTenant((tx) => webhooks.unregister(tx, id));
      // Also the answer for a webhook in another tenant: RLS removes nothing and
      // 404 keeps ids un-enumerable (NFR-S5).
      if (removed === 0) throw ApiError.notFound('Webhook not found.');

      return reply.status(204).send();
    },
  );
}
