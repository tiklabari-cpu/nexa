/**
 * The AI coaching and suggestion queue (tm 318.1 · SiyahTuş analysis AI-23 ·
 * `paths/ai-suggestions.yaml`): Inbox › "AI'ı düzelt" / "AI bilgisine öner"
 * and Playbook › Öneriler.
 *
 *   - `POST /ai/suggestions` — mark the AI's message or offer an answer; the
 *     reviewers get `ai_suggestion_created` after the commit.
 *   - `GET /ai/suggestions`, `GET …/{id}` — what the caller may see: what
 *     they review (a Team Lead their led teams', an administrator all) and
 *     their own.
 *   - `PATCH …/{id}` — edit, accept (into the AI-20 draft), reject (with a
 *     note) or merge; the author gets `ai_suggestion_reviewed`.
 *   - `POST …/{id}/to-scenario` — the conversation as an AI-19 test scenario.
 *
 * The checks are the person's (`services/ai/suggestions.ts`): the matrix rows
 * `ai.suggest` and `ai.suggestions.review` (RL-02), the conversation's
 * visibility and the review reach. The scope gate is the chat's for making
 * one and none beyond a member's session for reading and reviewing — a Team
 * Lead holds no `agents-bot` scope, yet AI-23-S1 has them turn a suggestion
 * into a draft. A scenario is written with the scope that writes scenarios.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AI_TEST_SCENARIO_NAME_MAX,
  SUGGESTION_BODY_MAX,
  SUGGESTION_KINDS,
  SUGGESTION_LIST_LIMIT_DEFAULT,
  SUGGESTION_LIST_LIMIT_MAX,
  SUGGESTION_LIST_STATUSES,
  SUGGESTION_NOTE_MAX,
  SUGGESTION_REVIEW_ACTIONS,
  SUGGESTION_REVIEW_NOTE_MAX,
  SUGGESTION_TARGETS,
  SUGGESTION_TITLE_MAX,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { configAuthorOf } from '../lib/config-author.js';
import { refuseUnembeddable, type KnowledgeService } from '../services/ai/knowledge-service.js';
import { ProcedureExamples, storeProcedureExamples } from '../services/ai/procedure-examples.js';
import {
  announceSuggestionCreated,
  announceSuggestionReviewed,
  createSuggestion,
  isDuplicateMark,
  listSuggestions,
  proposalToAccept,
  readSuggestion,
  reviewSuggestion,
  serialiseSuggestions,
  suggestionToScenario,
} from '../services/ai/suggestions.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { serialiseScenario } from './ai-testing.js';

const CHAT = ['chats--all:ro', 'chats--access:ro', 'chats--all:rw', 'chats--access:rw'];
const SCENARIO_WRITE = ['agents-bot--all:rw'];

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

const proposedChange = z
  .object({
    target: z.enum(SUGGESTION_TARGETS),
    title: z.string().trim().min(1).max(SUGGESTION_TITLE_MAX),
    body: z.string().trim().min(1).max(SUGGESTION_BODY_MAX),
    source_id: uuid.nullable().optional(),
  })
  .strict()
  .transform((value) => ({ ...value, source_id: value.source_id ?? null }));

const createBody = z
  .object({
    chat_id: z.string().min(1).max(12),
    thread_id: z.string().min(1).max(12),
    event_id: z.string().min(1).max(40).optional(),
    kind: z.enum(SUGGESTION_KINDS),
    note: z.string().trim().min(1).max(SUGGESTION_NOTE_MAX).optional(),
    ai_agent_id: uuid.optional(),
    proposed_change: proposedChange.optional(),
  })
  .strict();

const listQuery = z.object({
  status: z.enum(SUGGESTION_LIST_STATUSES).default('open'),
  kind: z.enum(SUGGESTION_KINDS).optional(),
  ai_agent_id: uuid.optional(),
  team_id: z.coerce.number().int().min(1).optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SUGGESTION_LIST_LIMIT_MAX)
    .default(SUGGESTION_LIST_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});

const reviewBody = z
  .object({
    action: z.enum(SUGGESTION_REVIEW_ACTIONS),
    proposed_change: proposedChange.optional(),
    review_note: z.string().trim().min(1).max(SUGGESTION_REVIEW_NOTE_MAX).optional(),
    duplicate_of: uuid.optional(),
    cluster_id: uuid.optional(),
  })
  .strict();

const scenarioBody = z
  .object({ name: z.string().trim().min(1).max(AI_TEST_SCENARIO_NAME_MAX).optional() })
  .strict();

export default async function aiSuggestionRoutes(
  app: FastifyInstance,
  { knowledge }: { knowledge: KnowledgeService },
): Promise<void> {
  const publisher = new RealtimePublisher(app.redis, app.log);
  const procedureExamples = new ProcedureExamples();

  app.post('/ai/suggestions', { config: { scopes: CHAT } }, async (request, reply) => {
    const body = parse(createBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const created = await request
      .withTenant(async (tx) => {
        const row = await createSuggestion(tx, principal, tenant, {
          chatId: body.chat_id,
          threadId: body.thread_id,
          kind: body.kind,
          ...(body.event_id !== undefined ? { eventId: body.event_id } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          ...(body.ai_agent_id !== undefined ? { aiAgentId: body.ai_agent_id } : {}),
          ...(body.proposed_change !== undefined ? { proposedChange: body.proposed_change } : {}),
        });
        const [serialised] = await serialiseSuggestions(tx, [row]);
        return { row, serialised: serialised! };
      })
      .catch((error: unknown) => {
        // Two identical requests raced past the read: the index refused one.
        if (isDuplicateMark(error)) {
          throw new ApiError(
            'ai_suggestion_state',
            'You already made this suggestion about this message.',
            {
              details: { reason: 'duplicate' },
            },
          );
        }
        throw error;
      });
    await announceSuggestionCreated(app.db, tenant, publisher, {
      id: created.row.id,
      aiAgentId: created.row.aiAgentId,
      kind: body.kind,
      teamId: created.row.teamId,
    });
    return reply.code(201).send(created.serialised);
  });

  app.get('/ai/suggestions', async (request, reply) => {
    const query = parse(listQuery, request.query);
    const principal = request.requirePrincipal();
    const result = await request.withTenant((tx) =>
      listSuggestions(tx, principal, {
        status: query.status,
        limit: query.limit,
        offset: query.offset,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.ai_agent_id ? { aiAgentId: query.ai_agent_id } : {}),
        ...(query.team_id !== undefined ? { teamId: BigInt(query.team_id) } : {}),
        ...(query.mine !== undefined ? { mine: query.mine } : {}),
      }),
    );
    return reply.send(result);
  });

  app.get<{ Params: { suggestionId: string } }>(
    '/ai/suggestions/:suggestionId',
    async (request, reply) => {
      const id = parse(uuid, request.params.suggestionId);
      const principal = request.requirePrincipal();
      const serialised = await request.withTenant(async (tx) => {
        const row = await readSuggestion(tx, principal, id);
        return (await serialiseSuggestions(tx, [row]))[0]!;
      });
      return reply.send(serialised);
    },
  );

  app.patch<{ Params: { suggestionId: string } }>(
    '/ai/suggestions/:suggestionId',
    async (request, reply) => {
      const id = parse(uuid, request.params.suggestionId);
      const body = parse(reviewBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const input = {
        action: body.action,
        ...(body.proposed_change !== undefined ? { proposedChange: body.proposed_change } : {}),
        ...(body.review_note !== undefined ? { reviewNote: body.review_note } : {}),
        ...(body.duplicate_of !== undefined ? { duplicateOf: body.duplicate_of } : {}),
        ...(body.cluster_id !== undefined ? { clusterId: body.cluster_id } : {}),
      };
      // A knowledge snippet is embedded before the transaction, like a save
      // in the knowledge editor: the provider is a network call.
      const proposal = await request.withTenant((tx) => proposalToAccept(tx, principal, id, input));
      const prepared =
        proposal?.target === 'knowledge_snippet'
          ? await knowledge.prepare(proposal.body, tenant).catch(refuseUnembeddable)
          : null;
      if (proposal && body.proposed_change === undefined) input.proposedChange = proposal;
      const outcome = await request.withTenant(async (tx) => {
        const result = await reviewSuggestion(tx, principal, id, input, {
          author: configAuthorOf(request),
          tenant,
          knowledge,
          procedureExamples,
          prepared,
        });
        return { ...result, serialised: (await serialiseSuggestions(tx, [result.row]))[0]! };
      });
      if (outcome.skill)
        await storeProcedureExamples(request, knowledge, procedureExamples, outcome.skill);
      await announceSuggestionReviewed(tenant, publisher, outcome.row);
      return reply.send(outcome.serialised);
    },
  );

  app.post<{ Params: { suggestionId: string } }>(
    '/ai/suggestions/:suggestionId/to-scenario',
    { config: { scopes: SCENARIO_WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.suggestionId);
      const body = parse(scenarioBody, request.body ?? {});
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const row = await request.withTenant((tx) =>
        suggestionToScenario(tx, principal, tenant, id, body.name),
      );
      return reply.code(201).send(serialiseScenario(row));
    },
  );
}
