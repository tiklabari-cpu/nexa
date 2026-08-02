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
import { writeAuditEntry } from '../services/audit/audit-log.js';
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

/**
 * The host of a webhook URL for an audit note — never the path, query or the URL
 * as a whole (which can embed a token), and never the signing secret. The `try`
 * is for the delete path, where the value comes from storage; a value that will
 * not parse simply contributes no host, and `sanitizeAuditMetadata` drops the
 * `undefined`.
 */
function urlHost(raw: string): string | undefined {
  try {
    return new URL(raw).host;
  } catch {
    return undefined;
  }
}

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

    const created = await request.withTenant(async (tx) => {
      const registration = await webhooks.register(tx, tenant, {
        url: url.toString(),
        action: body.action as WebhookAction,
        type: body.type as WebhookType,
      });
      // Same transaction as the insert: the trail can never disagree with the
      // registry, because either both land or neither. The metadata carries the
      // host and the subscription only — the full URL and the plaintext secret
      // this response returns are deliberately kept out of the append-only log.
      await writeAuditEntry(tx, request.auditContext(), {
        action: 'webhook.created',
        target: `webhook:${registration.id}`,
        metadata: {
          action: registration.action,
          type: registration.type,
          url_host: url.host,
        },
      });
      return registration;
    });
    return reply.status(201).send(created);
  });

  app.delete<{ Params: { webhookId: string } }>(
    '/webhooks/:webhookId',
    { config: { scopes: ['webhooks--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.webhookId);

      const removed = await request.withTenant(async (tx) => {
        // Read the row before deleting so the entry can name what was removed —
        // `unregister` returns only a count. The read is RLS-scoped, so another
        // tenant's id reads as null: nothing is deleted and nothing is logged.
        const doomed = await tx.webhook.findUnique({
          where: { id },
          select: { action: true, type: true, url: true },
        });

        const count = await webhooks.unregister(tx, id);
        // Record only a delete that actually happened; a 404 no-op and a
        // cross-tenant miss both leave the trail untouched (NFR-S12). `doomed`
        // is non-null whenever count>0 — both run in one RLS-scoped transaction.
        if (count > 0 && doomed) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'webhook.deleted',
            target: `webhook:${id}`,
            metadata: {
              action: doomed.action,
              type: doomed.type,
              url_host: urlHost(doomed.url),
            },
          });
        }
        return count;
      });
      // Also the answer for a webhook in another tenant: RLS removes nothing and
      // 404 keeps ids un-enumerable (NFR-S5).
      if (removed === 0) throw ApiError.notFound('Webhook not found.');

      return reply.status(204).send();
    },
  );
}
