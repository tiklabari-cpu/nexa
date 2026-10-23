/**
 * `GET /search` — direct lookup by number, e-mail or username (ID-06 · tm 332).
 *
 * Open to any caller who can read one of the three things it finds —
 * conversations, members or tickets — and each kind is then gated on its own
 * scope and visibility inside the lookup (`services/search/lookup.ts`). A
 * customer token is outside the default agent+bot `principals` list and gets a
 * 404, never a 403.
 *
 * The parameter is `query`, not `q`: the request log masks `query=` whatever it
 * holds (`lib/log-redact.ts`), and what an agent pastes here is often a
 * player's address.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  SEARCH_DEFAULT_KINDS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_KINDS,
  SEARCH_MAX_LIMIT,
  SEARCH_QUERY_MAX_LENGTH,
  type SearchKind,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { hasChatScope } from '../services/chat/access.js';
import { messageSearchWordsOrThrow, spendMessageSearch } from '../services/chat/event-search.js';
import {
  CUSTOMER_READ_SCOPES,
  SearchService,
  TICKET_READ_SCOPES,
} from '../services/search/lookup.js';

const CHAT_READ_SCOPES = ['chats--all:ro', 'chats--access:ro'];

const searchQuery = z.object({
  query: z.string().trim().min(1).max(SEARCH_QUERY_MAX_LENGTH),
  types: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') {
        return new Set<SearchKind>(SEARCH_DEFAULT_KINDS);
      }
      const kinds = new Set<SearchKind>();
      for (const part of value.split(',')) {
        const kind = part.trim();
        if (!(SEARCH_KINDS as readonly string[]).includes(kind)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown kind "${kind.slice(0, 40)}"; one of ${SEARCH_KINDS.join(', ')}`,
          });
          return z.NEVER;
        }
        kinds.add(kind as SearchKind);
      }
      return kinds;
    }),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).default(SEARCH_DEFAULT_LIMIT),
});

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

export default async function searchRoutes(app: FastifyInstance): Promise<void> {
  const search = new SearchService();

  app.get(
    '/search',
    { config: { scopes: [...CHAT_READ_SCOPES, ...CUSTOMER_READ_SCOPES, ...TICKET_READ_SCOPES] } },
    async (request, reply) => {
      const query = parse(searchQuery, request.query);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      // The text search's own rules and budget, before the transaction opens
      // (ID-07 · tm 333.3): a query it refuses is a 400 for the whole request.
      if (query.types.has('message') && hasChatScope(principal, 'read')) {
        messageSearchWordsOrThrow(query.query);
        await spendMessageSearch(app.rateLimiter, principal, (error) =>
          request.log.error({ err: error, bucket: 'msgsearch' }, 'budget unavailable — allowing'),
        );
      }

      const items = await request.withTenant((tx) =>
        search.search(tx, tenant, principal, {
          query: query.query,
          kinds: query.types,
          limit: query.limit,
        }),
      );
      return reply.send({ items });
    },
  );
}
