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
import {
  ADAPTER_CHANNEL_TYPES,
  ARCHIVE_DEFAULT_LIMIT,
  ARCHIVE_MAX_FILTER_IDS,
  ARCHIVE_MAX_LIMIT,
  ARCHIVE_MAX_TAGS,
  ARCHIVE_RATING_FILTERS,
  ARCHIVE_STATUSES,
  ARCHIVE_TAG_MODES,
  RISK_FLAG_TYPES,
  THREAD_HANDLED_BY,
  isDayKey,
} from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import type { ArchiveFilters } from '../services/archive/archive-filters.js';
import { ArchiveService } from '../services/archive/archive-service.js';

const CHAT_READ_SCOPES = ['chats--all:ro', 'chats--access:ro'];

/**
 * A repeated key, one value each (`?agent_id=a&agent_id=b`). Node's query
 * parser hands one occurrence back as a bare string and several as an array;
 * both are normalised before the item schema sees them, or the one-value
 * case — the common one — would be the case that 400s (`traffic.ts`).
 */
function repeated<T extends z.ZodTypeAny>(item: T, max: number) {
  return z.preprocess(
    (value) => (value === undefined || Array.isArray(value) ? value : [value]),
    z.array(item).min(1).max(max),
  );
}

/** A conversation day, `YYYY-MM-DD`, that exists on the calendar. */
const dayKey = z.string().refine(isDayKey, 'must be a calendar day, YYYY-MM-DD');

/** Not `z.coerce.boolean()`: `Boolean('false')` is true. */
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

// `.strict()`: a mistyped filter key (`agent=…`) must be a 400, not a filter
// the caller believes is narrowing the list while it is not.
const listQuery = z
  .object({
    status: z.enum(ARCHIVE_STATUSES).default('closed'),
    customer_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(ARCHIVE_MAX_LIMIT).default(ARCHIVE_DEFAULT_LIMIT),
    page_id: z.string().min(1).max(200).optional(),
    date_from: dayKey.optional(),
    date_to: dayKey.optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    agent_id: repeated(z.string().uuid(), ARCHIVE_MAX_FILTER_IDS).optional(),
    group_id: repeated(z.coerce.bigint().positive(), ARCHIVE_MAX_FILTER_IDS).optional(),
    rating: z.enum(ARCHIVE_RATING_FILTERS).optional(),
    tag: repeated(z.string().uuid(), ARCHIVE_MAX_TAGS).optional(),
    tag_mode: z.enum(ARCHIVE_TAG_MODES).optional(),
    untagged: booleanQuery.optional(),
    handled_by: repeated(z.enum(THREAD_HANDLED_BY), THREAD_HANDLED_BY.length).optional(),
    risk_flag: repeated(z.enum(RISK_FLAG_TYPES), RISK_FLAG_TYPES.length).optional(),
    channel: z.enum(ADAPTER_CHANNEL_TYPES).optional(),
  })
  .strict();

type ListQuery = z.infer<typeof listQuery>;

/** The parsed query as the service's filters — only what was asked. */
function toFilters(query: ListQuery): ArchiveFilters {
  return {
    ...(query.date_from ? { dateFrom: query.date_from } : {}),
    ...(query.date_to ? { dateTo: query.date_to } : {}),
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
    ...(query.agent_id ? { agentIds: query.agent_id } : {}),
    ...(query.group_id ? { groupIds: query.group_id } : {}),
    ...(query.rating ? { rating: query.rating } : {}),
    ...(query.tag ? { tags: query.tag } : {}),
    ...(query.tag_mode ? { tagMode: query.tag_mode } : {}),
    ...(query.untagged ? { untagged: true } : {}),
    ...(query.handled_by ? { handledBy: query.handled_by } : {}),
    ...(query.risk_flag ? { riskFlags: query.risk_flag } : {}),
    ...(query.channel ? { channel: query.channel } : {}),
  };
}

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
          filters: toFilters(query),
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
