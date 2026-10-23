/**
 * The archive (AR-01 · tm 335.1): `GET /archive/conversations` and
 * `GET /archive/conversations/{threadId}` — past conversations, one row per
 * connection, read-only. The rows, the visibility and the cursor are
 * `services/archive/archive-service.ts`'s.
 *
 * Open to whoever may read conversations (`chats--all:ro` / `chats--access:ro`
 * — a `:rw` scope satisfies its `:ro`); agents and bots only, so a customer
 * token gets a 404, never a 403. Reads run in a read-only transaction: the
 * archive writes nothing, and a write that grew here would fail at once.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ARCHIVE_DEFAULT_LIMIT, ARCHIVE_MAX_LIMIT, ARCHIVE_STATUSES } from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { ArchiveService } from '../services/archive/archive-service.js';

const CHAT_READ_SCOPES = ['chats--all:ro', 'chats--access:ro'];

const listQuery = z.object({
  status: z.enum(ARCHIVE_STATUSES).default('closed'),
  customer_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(ARCHIVE_MAX_LIMIT).default(ARCHIVE_DEFAULT_LIMIT),
  page_id: z.string().min(1).max(200).optional(),
});

const threadParams = z.object({ threadId: z.string().min(10).max(12) });

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'query'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

export default async function archiveRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const archive = new ArchiveService(options.env);

  app.get(
    '/archive/conversations',
    { config: { scopes: CHAT_READ_SCOPES } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const page = await request.withTenantRead((tx) =>
        archive.list(tx, tenant, principal, {
          status: query.status,
          limit: query.limit,
          ...(query.customer_id ? { customerId: query.customer_id } : {}),
          ...(query.page_id ? { pageId: query.page_id } : {}),
        }),
      );
      return reply.send(page);
    },
  );

  app.get(
    '/archive/conversations/:threadId',
    { config: { scopes: CHAT_READ_SCOPES } },
    async (request, reply) => {
      const { threadId } = parse(threadParams, request.params);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const conversation = await request.withTenantRead((tx) =>
        archive.get(tx, tenant, principal, threadId),
      );
      return reply.send(conversation);
    },
  );
}
