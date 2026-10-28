/**
 * The AI configuration change history (tm 315 · SiyahTuş analysis AI-21):
 * Playbook › Geçmiş and the editors' "Geçmiş" drawer read it here.
 *
 *   GET /ai/changes          the timeline, newest first, filtered, by cursor
 *   GET /ai/changes/:id      one change with the entity before and after
 *   GET /ai/changes/export   CSV — who, when, entity, field, before, after, version
 *
 * There is no write: the rows are the config-draft helper's
 * (`services/ai/config-history.ts`), and the database refuses the
 * application an UPDATE or DELETE on them.
 *
 * Who reads (AI-21-S2): Founder and Administrator everything — holding the
 * AI configuration scope; a Team Lead their own changes and the publish
 * history; a Team Member nothing (the role gate). The export is the
 * Founder's and the Administrator's alone.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AI_CONFIG_CHANGE_ACTIONS,
  AI_CONFIG_CHANGES_PAGE_MAX,
  AI_CONFIG_ENTITY_TYPES,
  hasAnyScope,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { roleAtLeast, scopesOf } from '../services/auth/principal.js';
import {
  CONFIG_CHANGES_CSV_HEADERS,
  decodeChangeCursor,
  exportConfigChanges,
  getConfigChange,
  listConfigChanges,
  type ConfigHistoryFilter,
  type ConfigHistoryVisibility,
} from '../services/ai/config-history-read.js';
import { toCsv } from './reports-export.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];

const filterQuery = z.object({
  entity_type: z.enum(AI_CONFIG_ENTITY_TYPES).optional(),
  entity_id: z.string().uuid().optional(),
  action: z.enum(AI_CONFIG_CHANGE_ACTIONS).optional(),
  actor_id: z.string().min(1).max(200).optional(),
  version_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const listQuery = filterQuery.extend({
  limit: z.coerce.number().int().min(1).max(AI_CONFIG_CHANGES_PAGE_MAX).optional(),
  cursor: z.string().max(512).optional(),
});

const changeParams = z.object({ changeId: z.string().uuid() });

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

function filterOf(query: z.infer<typeof filterQuery>): ConfigHistoryFilter {
  if (query.from && query.to && query.from > query.to) {
    throw ApiError.validation('`from` must be before `to`.');
  }
  return {
    ...(query.entity_type ? { entityType: query.entity_type } : {}),
    ...(query.entity_id ? { entityId: query.entity_id } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.actor_id ? { actorId: query.actor_id } : {}),
    ...(query.version_id ? { versionId: query.version_id } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
  };
}

/**
 * The whole history for an Administrator or above who holds the AI
 * configuration scope; a Team Lead's own otherwise. The role gate has already
 * refused anyone below Team Lead.
 */
function visibilityOf(request: FastifyRequest): ConfigHistoryVisibility {
  const principal = request.requirePrincipal();
  if (principal.kind !== 'agent') throw ApiError.authorization('A member reads the AI history.');
  if (roleAtLeast(principal.role, 'admin') && hasAnyScope(scopesOf(principal), READ)) {
    return { kind: 'all' };
  }
  return { kind: 'own', accountId: principal.accountId };
}

export default async function aiChangesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai/changes', { config: { minimumRole: 'team_lead' } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    const cursor = query.cursor === undefined ? null : decodeChangeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === null) {
      throw ApiError.validation('cursor: not a cursor this list wrote.');
    }
    const visibility = visibilityOf(request);
    const page = await request.withTenant((tx) =>
      listConfigChanges(tx, visibility, filterOf(query), {
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        cursor,
      }),
    );
    return reply.send({ ...page, visibility: visibility.kind });
  });

  // Before `/:changeId`, so `export` is never read as an id.
  app.get(
    '/ai/changes/export',
    { config: { scopes: READ, minimumRole: 'admin' } },
    async (request, reply) => {
      const filter = filterOf(parse(filterQuery, request.query));
      const lines = await request.withTenant((tx) => exportConfigChanges(tx, filter));
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="siyahtus-ai-changes-${day}.csv"`)
        .send(toCsv(CONFIG_CHANGES_CSV_HEADERS, lines));
    },
  );

  app.get<{ Params: { changeId: string } }>(
    '/ai/changes/:changeId',
    { config: { minimumRole: 'team_lead' } },
    async (request, reply) => {
      const { changeId } = parse(changeParams, request.params);
      const visibility = visibilityOf(request);
      const change = await request.withTenant((tx) => getConfigChange(tx, visibility, changeId));
      if (!change) throw ApiError.notFound('Change not found.');
      return reply.send(change);
    },
  );
}
