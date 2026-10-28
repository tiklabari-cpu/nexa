/**
 * The unresolved questions report (tm 317.3 · SiyahTuş analysis AI-22 ·
 * `paths/ai-unresolved.yaml`): Playbook › Analiz › Çözülemeyen sorular.
 *
 *   - `GET /ai/unresolved/clusters` — one AI agent's clusters, by the last
 *     seven days' count unless told otherwise; the default view is the open
 *     ones (an ignored cluster is counted, never in front). `from`/`to`/
 *     `brand_id`/`reason`/`language` keep the clusters that have such an item.
 *     `GET …/{id}` — the cluster with its newest masked examples (always:
 *     the title is a summary), a 14-day trend and its languages.
 *   - `POST …/{id}/ignore | reopen | resolve | merge` — the moves on a
 *     cluster (`services/ai/unresolved/report.ts`).
 *   - `POST …/{id}/suggest-knowledge` — a knowledge snippet to write, as a
 *     proposal: AI-23's queue (tm 318) does not exist yet, so nothing is kept.
 *     `POST …/{id}/add-examples` — sentences into a procedure's example
 *     sentences (AI-03) in the draft, through the same door a save uses
 *     (`updateSkillDraft`, then the embedding after the commit).
 *   - `GET|PUT /ai/unresolved/settings` — the surge alarm's threshold
 *     (AI-22-S2; `ai_unresolved_settings`, 5–1000, default 20).
 *
 * Who: whoever configures the AI (`agents-bot--all:ro` reads, `:rw` acts) —
 * owners and admins in the default matrix; a team member has neither
 * ("Ekip Üyesi: yok"). The report is workspace-wide (RLS is per licence);
 * a brand narrows it, it does not scope it.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PROCEDURE_EXAMPLES_MAX,
  PROCEDURE_EXAMPLE_MAX,
  UNRESOLVED_ADD_EXAMPLES_MAX,
  UNRESOLVED_IGNORE_REASON_MAX,
  UNRESOLVED_LIST_LIMIT_DEFAULT,
  UNRESOLVED_LIST_LIMIT_MAX,
  UNRESOLVED_LIST_SORTS,
  UNRESOLVED_LIST_STATUSES,
  UNRESOLVED_MERGE_SOURCES_MAX,
  UNRESOLVED_REASONS,
  UNRESOLVED_SPIKE_THRESHOLD_DEFAULT,
  UNRESOLVED_SPIKE_THRESHOLD_MAX,
  UNRESOLVED_SPIKE_THRESHOLD_MIN,
  UNRESOLVED_SPIKE_WINDOW_MINUTES,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { maskSensitive } from '../lib/sensitive-mask.js';
import { updateSkillDraft } from '../services/ai/config-draft.js';
import { configAuthorOf } from '../lib/config-author.js';
import { ProcedureExamples, storeProcedureExamples } from '../services/ai/procedure-examples.js';
import type { KnowledgeService } from '../services/ai/knowledge-service.js';
import { readUnresolvedSpikeThreshold } from '../services/ai/unresolved/cluster-job.js';
import {
  ignoreUnresolvedCluster,
  listUnresolvedClusters,
  mergeUnresolvedClustersByHand,
  readUnresolvedClusterDetail,
  reopenUnresolvedCluster,
  resolveUnresolvedCluster,
  suggestUnresolvedKnowledge,
  unresolvedClusterAgent,
} from '../services/ai/unresolved/report.js';
import { isLockedCopy, templateLocked } from '../services/ai-templates/install.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

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

const listQuery = z.object({
  ai_agent_id: uuid,
  status: z.enum(UNRESOLVED_LIST_STATUSES).default('open'),
  sort: z.enum(UNRESOLVED_LIST_SORTS).default('count_7d'),
  from: instant.optional(),
  to: instant.optional(),
  brand_id: uuid.optional(),
  reason: z.enum(UNRESOLVED_REASONS).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(UNRESOLVED_LIST_LIMIT_MAX)
    .default(UNRESOLVED_LIST_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});

const ignoreBody = z
  .object({ reason: z.string().trim().min(1).max(UNRESOLVED_IGNORE_REASON_MAX).optional() })
  .strict();

const resolveBody = z.object({ linked_change_id: uuid.optional() }).strict();

const mergeBody = z
  .object({ source_ids: z.array(uuid).min(1).max(UNRESOLVED_MERGE_SOURCES_MAX) })
  .strict();

const addExamplesBody = z
  .object({
    skill_id: uuid,
    sentences: z
      .array(z.string().trim().min(1).max(PROCEDURE_EXAMPLE_MAX))
      .min(1)
      .max(UNRESOLVED_ADD_EXAMPLES_MAX),
  })
  .strict();

const settingsBody = z
  .object({
    spike_threshold: z
      .number()
      .int()
      .min(UNRESOLVED_SPIKE_THRESHOLD_MIN)
      .max(UNRESOLVED_SPIKE_THRESHOLD_MAX),
  })
  .strict();

function serialiseSettings(spikeThreshold: number) {
  return {
    spike_threshold: spikeThreshold,
    default_threshold: UNRESOLVED_SPIKE_THRESHOLD_DEFAULT,
    window_minutes: UNRESOLVED_SPIKE_WINDOW_MINUTES,
    min_threshold: UNRESOLVED_SPIKE_THRESHOLD_MIN,
    max_threshold: UNRESOLVED_SPIKE_THRESHOLD_MAX,
  };
}

/** The customer-facing AI agent named, or 404 — a Copilot record has no unresolved questions. */
async function requireAgent(
  tx: Parameters<typeof readUnresolvedSpikeThreshold>[0],
  aiAgentId: string,
): Promise<void> {
  const agent = await tx.aiAgent.findFirst({
    where: { id: aiAgentId, kind: 'ai_agent' },
    select: { id: true },
  });
  if (!agent) throw ApiError.notFound('AI agent not found.');
}

export default async function aiUnresolvedRoutes(
  app: FastifyInstance,
  { knowledge }: { knowledge: KnowledgeService },
): Promise<void> {
  const procedureExamples = new ProcedureExamples();

  app.get('/ai/unresolved/clusters', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    if (query.from && query.to && query.from > query.to) {
      throw ApiError.validation('from: must not be after to.');
    }
    const result = await request.withTenant(async (tx) => {
      await requireAgent(tx, query.ai_agent_id);
      if (query.brand_id) {
        const brand = await tx.brand.findFirst({
          where: { id: query.brand_id },
          select: { id: true },
        });
        if (!brand) throw new ApiError('brand_not_found', 'Brand not found.');
      }
      const page = await listUnresolvedClusters(tx, {
        aiAgentId: query.ai_agent_id,
        status: query.status,
        sort: query.sort,
        limit: query.limit,
        offset: query.offset,
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.brand_id ? { brandId: query.brand_id } : {}),
        ...(query.reason ? { reason: query.reason } : {}),
        ...(query.language ? { language: query.language } : {}),
      });
      return { ...page, spikeThreshold: await readUnresolvedSpikeThreshold(tx) };
    });
    return reply.send({
      clusters: result.clusters,
      total: result.total,
      unclustered_count: result.unclusteredCount,
      spike_threshold: result.spikeThreshold,
    });
  });

  app.get<{ Params: { clusterId: string } }>(
    '/ai/unresolved/clusters/:clusterId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.clusterId);
      const detail = await request.withTenant((tx) => readUnresolvedClusterDetail(tx, id));
      return reply.send(detail);
    },
  );

  app.post<{ Params: { clusterId: string } }>(
    '/ai/unresolved/clusters/:clusterId/ignore',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.clusterId);
      const body = parse(ignoreBody, request.body ?? {});
      const cluster = await request.withTenant((tx) =>
        ignoreUnresolvedCluster(tx, id, body.reason ?? null),
      );
      return reply.send(cluster);
    },
  );

  app.post<{ Params: { clusterId: string } }>(
    '/ai/unresolved/clusters/:clusterId/reopen',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.clusterId);
      const cluster = await request.withTenant((tx) => reopenUnresolvedCluster(tx, id));
      return reply.send(cluster);
    },
  );

  app.post<{ Params: { clusterId: string } }>(
    '/ai/unresolved/clusters/:clusterId/resolve',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.clusterId);
      const body = parse(resolveBody, request.body ?? {});
      const cluster = await request.withTenant((tx) =>
        resolveUnresolvedCluster(tx, id, body.linked_change_id ?? null),
      );
      return reply.send(cluster);
    },
  );

  app.post<{ Params: { clusterId: string } }>(
    '/ai/unresolved/clusters/:clusterId/merge',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.clusterId);
      const body = parse(mergeBody, request.body);
      const merged = await request.withTenant((tx) =>
        mergeUnresolvedClustersByHand(tx, id, body.source_ids),
      );
      return reply.send(merged);
    },
  );

  app.post<{ Params: { clusterId: string } }>(
    '/ai/unresolved/clusters/:clusterId/suggest-knowledge',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.clusterId);
      const proposal = await request.withTenant((tx) => suggestUnresolvedKnowledge(tx, id));
      return reply.send(proposal);
    },
  );

  app.post<{ Params: { clusterId: string } }>(
    '/ai/unresolved/clusters/:clusterId/add-examples',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.clusterId);
      const body = parse(addExamplesBody, request.body);
      const result = await request.withTenant(async (tx) => {
        const aiAgentId = await unresolvedClusterAgent(tx, id);
        const skill = await tx.skill.findFirst({
          where: { id: body.skill_id, aiAgentId },
          select: { id: true, mode: true, examples: true, locked: true, templateKey: true },
        });
        if (!skill) throw ApiError.notFound('Procedure not found.');
        if (isLockedCopy(skill)) throw templateLocked('given examples');

        // The second line of masking (AI-26): the cluster's examples are masked
        // already, but a sentence is whatever the client sends.
        const have = new Set(skill.examples.map((example) => example.trim().toLowerCase()));
        const added: string[] = [];
        let skipped = 0;
        for (const sentence of body.sentences) {
          const text = maskSensitive(sentence, { author: 'customer' })
            .text.replace(/\s+/gu, ' ')
            .trim()
            .slice(0, PROCEDURE_EXAMPLE_MAX);
          const key = text.toLowerCase();
          if (text === '' || have.has(key)) {
            skipped += 1;
            continue;
          }
          have.add(key);
          added.push(text);
        }
        if (skill.examples.length + added.length > PROCEDURE_EXAMPLES_MAX) {
          throw ApiError.validation(
            `sentences: a procedure keeps at most ${PROCEDURE_EXAMPLES_MAX} example sentences; it has ${skill.examples.length}.`,
          );
        }
        if (added.length === 0) {
          return { skill: null, id: skill.id, added, skipped, count: skill.examples.length };
        }
        // The rows describe the examples as they were; the new set is embedded
        // after this commits, and until then the skill is never narrowed away.
        await procedureExamples.clear(tx, skill.id);
        const updated = await updateSkillDraft(tx, configAuthorOf(request), skill.id, {
          examples: [...skill.examples, ...added],
        });
        return { skill: updated, id: skill.id, added, skipped, count: updated.examples.length };
      });
      if (result.skill)
        await storeProcedureExamples(request, knowledge, procedureExamples, result.skill);
      return reply.send({
        skill_id: result.id,
        added: result.added,
        skipped: result.skipped,
        examples_count: result.count,
      });
    },
  );

  app.get('/ai/unresolved/settings', { config: { scopes: READ } }, async (request, reply) => {
    const threshold = await request.withTenant((tx) => readUnresolvedSpikeThreshold(tx));
    return reply.send(serialiseSettings(threshold));
  });

  app.put('/ai/unresolved/settings', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(settingsBody, request.body);
    const { licenseId } = request.tenant();
    await request.withTenant((tx) =>
      tx.aiUnresolvedSettings.upsert({
        where: { licenseId },
        create: { licenseId, spikeThreshold: body.spike_threshold },
        update: { spikeThreshold: body.spike_threshold },
      }),
    );
    return reply.send(serialiseSettings(body.spike_threshold));
  });
}
