/**
 * The AI configuration's review line (tm 316.2 · SiyahTuş analysis AI-20 ·
 * ADR-14b `docs/adr/ai-config-versioning.md` §2.10, §2.11 ·
 * `paths/ai-config.yaml`):
 *
 *   GET  /ai/config/draft/diff                   the draft as a submission would take it
 *   GET  /ai/config/versions                     an agent's versions, newest first
 *   POST /ai/config/versions                     submit the draft ("Onaya gönder")
 *   GET  /ai/config/versions/:id                 one version
 *   POST /ai/config/versions/:id/approve         approve — publish now or at `publish_at`
 *   POST /ai/config/versions/:id/reject          reject an open version
 *   POST /ai/config/versions/:id/rollback        a new version copying this one, published
 *   GET  /ai/config/versions/:id/diff/:to        one version told against another
 *   POST /ai/pause, /ai/resume                   the agent's live switch
 *
 * Who (ADR-14b §2.11 on the permission matrix): reading is the AI
 * configuration scope's. Submitting is anyone who may edit the draft, a Team
 * Lead up (an Ekip Lideri prepares, never publishes). Approving and rejecting
 * need `ai.config.publish` (Founder and Administrator by default) and never
 * one's own submission — the four-eyes rule is the server's, whatever the
 * screen shows; a version touching compliance is the Founder's alone.
 * Rollback and pause are a single administrator's (AI-20-S3).
 *
 * The draft's revision is its `ETag`; a submission (and every save of the
 * editing tables) may name it in `If-Match`, and one made against a revision
 * someone else moved is `409 ai_config_revision_conflict`.
 *
 * Everything here runs in the request's transaction; the run time's cache and
 * the RTM push after a publication are tm 316.3's.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AI_CONFIG_NOTE_MAX,
  AI_CONFIG_PUBLISH_CAPABILITY,
  AI_CONFIG_SCHEDULE_MAX_DAYS,
  AI_CONFIG_VERSIONS_PAGE_MAX,
  capabilityAtLeast,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { configAuthorOf } from '../lib/config-author.js';
import { diffAiConfig } from '../services/ai/config-compiler.js';
import {
  approveVersion,
  readDraftState,
  rejectVersion,
  rollbackToVersion,
  serialiseVersion,
  setAgentPaused,
  storedOf,
  submitVersion,
  versionState,
  type PublishOutcome,
  type Reviewer,
} from '../services/ai/config-versions.js';
import { serialiseGate } from '../services/ai/simulation/compliance-pack.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];
const DAY_MS = 86_400_000;

const uuid = z.string().uuid();
const note = z.string().trim().max(AI_CONFIG_NOTE_MAX).optional();

const agentQuery = z.object({ ai_agent_id: uuid });
const listQuery = z.object({
  ai_agent_id: uuid,
  limit: z.coerce.number().int().min(1).max(AI_CONFIG_VERSIONS_PAGE_MAX).optional(),
  cursor: z.string().max(64).optional(),
});
const submitBody = z.object({ ai_agent_id: uuid, note }).strict();
const approveBody = z
  .object({ publish_at: z.string().datetime({ offset: true }).optional(), note })
  .strict();
const noteBody = z.object({ note }).strict();
const pauseBody = z.object({ ai_agent_id: uuid, note }).strict();

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

/** An empty note is no note. */
function noteOf(value: string | undefined): string | null {
  return value ? value : null;
}

/** The member reviewing — a person with the publish row of the matrix. */
function reviewerOf(request: FastifyRequest): Reviewer {
  const principal = request.requirePrincipal();
  if (principal.kind !== 'agent') throw ApiError.authorization('A member reviews a version.');
  if (
    !capabilityAtLeast(
      AI_CONFIG_PUBLISH_CAPABILITY,
      principal.capabilities[AI_CONFIG_PUBLISH_CAPABILITY],
    )
  ) {
    throw ApiError.authorization('Approving AI settings is not allowed for your role.', {
      reason: 'capability_off',
      capability: AI_CONFIG_PUBLISH_CAPABILITY,
    });
  }
  return { accountId: principal.accountId, role: principal.role };
}

function personOf(request: FastifyRequest): string {
  const principal = request.requirePrincipal();
  if (principal.kind !== 'agent') throw ApiError.authorization('A member takes this step.');
  return principal.accountId;
}

/** `publish_at`: in the future, at most {@link AI_CONFIG_SCHEDULE_MAX_DAYS} ahead. */
function publishAtOf(value: string | undefined, now: Date): Date | null {
  if (value === undefined) return null;
  const at = new Date(value);
  if (at.getTime() <= now.getTime()) {
    throw ApiError.validation('publish_at: must be in the future.', {
      problems: [{ field: 'publish_at', code: 'past' }],
    });
  }
  if (at.getTime() > now.getTime() + AI_CONFIG_SCHEDULE_MAX_DAYS * DAY_MS) {
    throw ApiError.validation(`publish_at: at most ${AI_CONFIG_SCHEDULE_MAX_DAYS} days ahead.`, {
      problems: [{ field: 'publish_at', code: 'too_far' }],
    });
  }
  return at;
}

/** A page cursor: the last version's `number.minor`. */
function encodeCursor(row: { number: number; minor: number }): string {
  return `${row.number}.${row.minor}`;
}

function decodeCursor(value: string | undefined): { number: number; minor: number } | null {
  if (value === undefined) return null;
  const match = /^(\d{1,9})\.(\d{1,9})$/.exec(value);
  if (!match) throw ApiError.validation('cursor: not a cursor this list wrote.');
  return { number: Number(match[1]), minor: Number(match[2]) };
}

export default async function aiConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai/config/draft/diff', { config: { scopes: READ } }, async (request, reply) => {
    const { ai_agent_id } = parse(agentQuery, request.query);
    const state = await request.withTenant((tx) => readDraftState(tx, ai_agent_id));
    const { compilation, gate, diff } = state;
    const revision = Number(state.agent.draftRevision);
    return reply.header('etag', `"${revision}"`).send({
      ai_agent_id: state.agent.id,
      draft_revision: revision,
      active: state.agent.active,
      published: state.published ? serialiseVersion(state.published) : null,
      open: state.open ? serialiseVersion(state.open) : null,
      ok: compilation.ok,
      problems: compilation.ok ? [] : compilation.problems,
      warnings: compilation.warnings,
      diff,
      compliance_gate: serialiseGate(gate),
      submittable: compilation.ok && gate.open && diff !== null && diff.changes > 0,
    });
  });

  app.get('/ai/config/versions', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    const cursor = decodeCursor(query.cursor);
    const limit = query.limit ?? 50;
    const rows = await request.withTenant(async (tx) => {
      const agent = await tx.aiAgent.findFirst({
        where: { id: query.ai_agent_id, kind: 'ai_agent' },
        select: { id: true },
      });
      if (!agent) throw ApiError.notFound('AI agent not found.');
      return tx.aiConfigVersion.findMany({
        where: {
          aiAgentId: agent.id,
          ...(cursor
            ? {
                OR: [
                  { number: { lt: cursor.number } },
                  { number: cursor.number, minor: { lt: cursor.minor } },
                ],
              }
            : {}),
        },
        orderBy: [{ number: 'desc' }, { minor: 'desc' }],
        take: limit + 1,
      });
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return reply.send({
      versions: page.map(serialiseVersion),
      next_cursor: rows.length > limit && last ? encodeCursor(last) : null,
    });
  });

  app.post(
    '/ai/config/versions',
    { config: { scopes: WRITE, minimumRole: 'team_lead' } },
    async (request, reply) => {
      const body = parse(submitBody, request.body);
      const author = configAuthorOf(request);
      const submittedBy = personOf(request);
      const submission = await request.withTenant((tx) =>
        submitVersion(tx, author, {
          aiAgentId: body.ai_agent_id,
          submittedBy,
          note: noteOf(body.note),
          now: new Date(),
        }),
      );
      return reply.code(201).send({
        version: serialiseVersion(submission.version),
        warnings: submission.warnings,
        replaced_version_ids: submission.replaced,
      });
    },
  );

  app.get<{ Params: { versionId: string } }>(
    '/ai/config/versions/:versionId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const versionId = parse(uuid, request.params.versionId);
      const row = await request.withTenant((tx) =>
        tx.aiConfigVersion.findFirst({ where: { id: versionId } }),
      );
      if (!row) throw ApiError.notFound('Version not found.');
      return reply.send(serialiseVersion(row));
    },
  );

  // `:versionId` like its siblings: the router keeps one name per position.
  app.get<{ Params: { versionId: string; toVersionId: string } }>(
    '/ai/config/versions/:versionId/diff/:toVersionId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const baseVersionId = parse(uuid, request.params.versionId);
      const versionId = parse(uuid, request.params.toVersionId);
      const [base, version] = await request.withTenant(async (tx) => [
        await tx.aiConfigVersion.findFirst({ where: { id: baseVersionId } }),
        await tx.aiConfigVersion.findFirst({ where: { id: versionId } }),
      ]);
      if (!base || !version) throw ApiError.notFound('Version not found.');
      if (base.aiAgentId !== version.aiAgentId) {
        throw ApiError.validation('The two versions are different agents’.', {
          problems: [{ field: 'toVersionId', code: 'other_agent' }],
        });
      }
      return reply.send(diffAiConfig(storedOf(base), storedOf(version)));
    },
  );

  /** The approval's answer: the version, or 409 when it went stale meanwhile (committed). */
  function sendOutcome(reply: FastifyReply, outcome: PublishOutcome) {
    if (outcome.kind === 'rejected') {
      throw versionState(
        'stale_base',
        'Another version was published after this one was submitted and both change the same thing; it was rejected — submit the draft again.',
        { version_id: outcome.version.id },
      );
    }
    return reply.send(serialiseVersion(outcome.version));
  }

  app.post<{ Params: { versionId: string } }>(
    '/ai/config/versions/:versionId/approve',
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const versionId = parse(uuid, request.params.versionId);
      const body = parse(approveBody, request.body ?? {});
      const reviewer = reviewerOf(request);
      const author = configAuthorOf(request);
      const now = new Date();
      const publishAt = publishAtOf(body.publish_at, now);
      const outcome = await request.withTenant((tx) =>
        approveVersion(tx, author, reviewer, {
          versionId,
          publishAt,
          note: noteOf(body.note),
          now,
        }),
      );
      return sendOutcome(reply, outcome);
    },
  );

  app.post<{ Params: { versionId: string } }>(
    '/ai/config/versions/:versionId/reject',
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const versionId = parse(uuid, request.params.versionId);
      const body = parse(noteBody, request.body ?? {});
      const reviewer = reviewerOf(request);
      const author = configAuthorOf(request);
      const row = await request.withTenant((tx) =>
        rejectVersion(tx, author, reviewer, {
          versionId,
          note: noteOf(body.note),
          now: new Date(),
        }),
      );
      return reply.send(serialiseVersion(row));
    },
  );

  app.post<{ Params: { versionId: string } }>(
    '/ai/config/versions/:versionId/rollback',
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const versionId = parse(uuid, request.params.versionId);
      const body = parse(noteBody, request.body ?? {});
      const actor = personOf(request);
      const author = configAuthorOf(request);
      const row = await request.withTenant((tx) =>
        rollbackToVersion(tx, author, {
          versionId,
          actor,
          note: noteOf(body.note),
          now: new Date(),
        }),
      );
      return reply.code(201).send(serialiseVersion(row));
    },
  );

  for (const [path, paused] of [
    ['/ai/pause', true],
    ['/ai/resume', false],
  ] as const) {
    app.post(path, { config: { scopes: WRITE, minimumRole: 'admin' } }, async (request, reply) => {
      const body = parse(pauseBody, request.body);
      const author = configAuthorOf(request);
      const state = await request.withTenant((tx) =>
        setAgentPaused(tx, author, {
          aiAgentId: body.ai_agent_id,
          paused,
          note: noteOf(body.note),
        }),
      );
      return reply.send({ ai_agent_id: state.id, active: state.active });
    });
  }
}
