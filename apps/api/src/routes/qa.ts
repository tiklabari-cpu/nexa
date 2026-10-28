/**
 * The AI quality control (QA) queue (tm 319.2 · SiyahTuş analysis AI-24 ·
 * `paths/qa.yaml`): Raporlar › AI Kalite, Ayarlar › AI kalite and the inbox's
 * "QA'ya gönder".
 *
 *   - `GET /qa/reviews`, `GET …/{id}` — the queue within the caller's reach
 *     (`ai.qa.review`: a Team Lead their led teams', an administrator all);
 *     one review with its rubric, pre-score, masked excerpt and decision trail.
 *   - `POST /qa/reviews` — a conversation sent by hand (`manual`).
 *   - `POST …/{id}/claim`, `PUT …/{id}` — claim, then save, release or
 *     complete; a completed critical failure opens an AI-23 suggestion and an
 *     AI-19 scenario draft, and a missed mandatory hand-over mails the
 *     administrators after the commit.
 *   - `GET|PUT /qa/settings`, `GET|PUT /qa/rubric` — the sample rate, the
 *     pre-score and conflict switches, the rubric's versions: read with the
 *     AI's scopes, changed by an administrator.
 *   - `/qa/calibrations…` — the monthly calibration round and its report.
 *   - `GET /qa/summary` — the queue's figures for AI-25 and the panel.
 *
 * The checks are the person's (`services/qa/*`): the matrix row and the reach,
 * like the suggestion queue — a Team Lead holds no `agents-bot` scope. Sending
 * a conversation by hand needs the chat scopes the conversation itself does.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  QA_MANUAL_NOTE_MAX,
  QA_COMMENTS_MAX,
  QA_REASONS,
  QA_REVIEW_ACTIONS,
  QA_REVIEW_LIST_LIMIT_DEFAULT,
  QA_REVIEW_LIST_LIMIT_MAX,
  QA_REVIEW_LIST_STATUSES,
  QA_SAMPLE_PERCENT_MAX,
  QA_SAMPLE_PERCENT_MIN,
} from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import type { TenantContext } from '../lib/tenant.js';
import { withTenant } from '../lib/tenant.js';
import { announceSuggestionCreated } from '../services/ai/suggestions.js';
import { readDayBoundary } from '../services/chat/day-boundary.js';
import { isCapRefusal, mailFailureFields } from '../services/mail/delivery.js';
import { isMailLocale } from '../services/mail/templates/layout.js';
import { qaMandatoryHandoffViolationMail } from '../services/mail/templates/messages.js';
import {
  closeQaCalibration,
  createQaCalibration,
  listQaCalibrations,
  readQaCalibration,
  submitQaCalibrationScore,
} from '../services/qa/calibration.js';
import {
  addQaReviewByHand,
  claimQaReview,
  listQaReviews,
  qaSummary,
  readActiveQaRubric,
  readQaReview,
  requireQaReach,
  saveQaRubric,
  serialiseQaReviewDetail,
  serialiseQaSettings,
  updateQaReview,
  writeQaSettings,
  type QaFollowUps,
} from '../services/qa/qa-service.js';
import { readQaSettings } from '../services/qa/sampler.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';

const CHAT = ['chats--all:ro', 'chats--access:ro', 'chats--all:rw', 'chats--access:rw'];
const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];
const SUPERVISOR_ROLES = ['owner', 'viceowner', 'admin'];
const DAY_MS = 86_400_000;
const SUMMARY_DAYS_DEFAULT = 30;
const SUMMARY_DAYS_MAX = 366;

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

const scoreEntry = z
  .object({
    value: z.union([z.enum(['pass', 'fail']), z.number().int().min(1).max(5), z.null()]),
    confirmed: z.boolean().optional(),
  })
  .strict();
const scores = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), scoreEntry);

const listQuery = z.object({
  status: z.enum(QA_REVIEW_LIST_STATUSES).default('open'),
  reason: z.enum(QA_REASONS).optional(),
  team_id: z.coerce.number().int().min(1).optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(QA_REVIEW_LIST_LIMIT_MAX)
    .default(QA_REVIEW_LIST_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});

const manualBody = z
  .object({
    chat_id: z.string().min(1).max(12),
    thread_id: z.string().min(1).max(12),
    note: z.string().trim().min(1).max(QA_MANUAL_NOTE_MAX).optional(),
  })
  .strict();

const reviewBody = z
  .object({
    action: z.enum(QA_REVIEW_ACTIONS),
    scores: scores.optional(),
    final: z.enum(['pass', 'fail']).optional(),
    comments: z.string().max(QA_COMMENTS_MAX).nullable().optional(),
  })
  .strict();

const settingsBody = z
  .object({
    sample_percent: z
      .number()
      .int()
      .min(QA_SAMPLE_PERCENT_MIN)
      .max(QA_SAMPLE_PERCENT_MAX)
      .optional(),
    prescore_enabled: z.boolean().optional(),
    conflict_check: z.boolean().optional(),
  })
  .strict();

const rubricBody = z.object({ criteria: z.array(z.unknown()) }).strict();

const calibrationBody = z
  .object({
    period: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  })
  .strict();

const calibrationScoreBody = z
  .object({ review_id: uuid, scores, final: z.enum(['pass', 'fail']) })
  .strict();

const summaryQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export default async function qaRoutes(app: FastifyInstance, { env }: { env: Env }): Promise<void> {
  const publisher = new RealtimePublisher(app.redis, app.log);
  const appUrl = env.WEB_APP_URL.replace(/\/+$/, '');

  /** After the commit: the reviewers' badge for the suggestion, the administrators' mail. */
  async function announceFollowUps(
    tenant: TenantContext,
    review: { id: string; aiAgentId: string; teamId: bigint | null; threadId: string },
    followUps: QaFollowUps,
    reviewedAt: Date,
  ): Promise<void> {
    if (followUps.suggestionId) {
      await announceSuggestionCreated(app.db, tenant, publisher, {
        id: followUps.suggestionId,
        aiAgentId: review.aiAgentId,
        kind: followUps.suggestionKind,
        teamId: review.teamId,
      });
    }
    if (!followUps.mandatoryHandoffViolation) return;
    const notice = await withTenant(
      app.db,
      tenant,
      async (tx) => {
        const [members, organization, boundary] = await Promise.all([
          tx.agentMembership.findMany({
            where: {
              licenseId: tenant.licenseId,
              suspended: false,
              notifyEmail: true,
              role: { in: SUPERVISOR_ROLES },
            },
            orderBy: { createdAt: 'asc' },
            select: { locale: true, agent: { select: { email: true } } },
          }),
          tx.organization.findUnique({
            where: { id: tenant.organizationId },
            select: { name: true },
          }),
          readDayBoundary(tx),
        ]);
        return { members, workspaceName: organization?.name ?? 'SiyahTuş', boundary };
      },
      { readOnly: true },
    );
    const seen = new Set<string>();
    for (const member of notice.members) {
      const email = member.agent.email?.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const locale = isMailLocale(member.locale) ? member.locale : 'en';
      app.backgroundMail.send(
        {
          to: email,
          licenseId: tenant.licenseId,
          kind: 'notification',
          ...qaMandatoryHandoffViolationMail(
            { locale, appUrl },
            {
              workspaceName: notice.workspaceName,
              threadId: review.threadId,
              failed: followUps.failed,
              reviewedAt,
              timeZone: notice.boundary.timezone,
              reviewUrl: `${appUrl}/app/reports/qa?review=${encodeURIComponent(review.id)}`,
            },
          ),
        },
        (outcome) => {
          if (outcome.status === 'sent' || isCapRefusal(outcome)) return;
          app.log.warn(
            {
              event: 'qa.violation_mail',
              license_id: tenant.licenseId.toString(),
              review_id: review.id,
              outcome: outcome.status,
              mail: mailFailureFields(outcome.error),
            },
            'mandatory hand-over violation notice not confirmed as sent',
          );
        },
      );
    }
  }

  app.get('/qa/reviews', async (request, reply) => {
    const query = parse(listQuery, request.query);
    const principal = request.requirePrincipal();
    const result = await request.withTenant((tx) =>
      listQaReviews(tx, principal, {
        status: query.status,
        limit: query.limit,
        offset: query.offset,
        ...(query.reason ? { reason: query.reason } : {}),
        ...(query.team_id !== undefined ? { teamId: BigInt(query.team_id) } : {}),
        ...(query.mine !== undefined ? { mine: query.mine } : {}),
      }),
    );
    return reply.send(result);
  });

  app.post('/qa/reviews', { config: { scopes: CHAT } }, async (request, reply) => {
    const body = parse(manualBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const detail = await request.withTenant(async (tx) => {
      const row = await addQaReviewByHand(tx, principal, tenant, {
        chatId: body.chat_id,
        threadId: body.thread_id,
        ...(body.note !== undefined ? { note: body.note } : {}),
      });
      return serialiseQaReviewDetail(tx, principal, row);
    });
    return reply.code(201).send(detail);
  });

  app.get<{ Params: { reviewId: string } }>('/qa/reviews/:reviewId', async (request, reply) => {
    const id = parse(uuid, request.params.reviewId);
    const principal = request.requirePrincipal();
    return reply.send(await request.withTenant((tx) => readQaReview(tx, principal, id)));
  });

  app.post<{ Params: { reviewId: string } }>(
    '/qa/reviews/:reviewId/claim',
    async (request, reply) => {
      const id = parse(uuid, request.params.reviewId);
      const principal = request.requirePrincipal();
      const detail = await request.withTenant(async (tx) => {
        const row = await claimQaReview(tx, principal, id);
        return serialiseQaReviewDetail(tx, principal, row);
      });
      return reply.send(detail);
    },
  );

  app.put<{ Params: { reviewId: string } }>('/qa/reviews/:reviewId', async (request, reply) => {
    const id = parse(uuid, request.params.reviewId);
    const body = parse(reviewBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const outcome = await request.withTenant(async (tx) => {
      const result = await updateQaReview(tx, principal, tenant, id, {
        action: body.action,
        ...(body.scores !== undefined ? { scores: body.scores } : {}),
        ...(body.final !== undefined ? { final: body.final } : {}),
        ...(body.comments !== undefined ? { comments: body.comments } : {}),
      });
      return { ...result, detail: await serialiseQaReviewDetail(tx, principal, result.row) };
    });
    if (outcome.followUps) {
      await announceFollowUps(
        tenant,
        outcome.row,
        outcome.followUps,
        outcome.row.reviewedAt ?? new Date(),
      );
    }
    return reply.send({
      ...outcome.detail,
      follow_ups: {
        ...outcome.detail.follow_ups,
        mandatory_handoff_violation: outcome.followUps?.mandatoryHandoffViolation ?? false,
      },
    });
  });

  app.get('/qa/settings', { config: { scopes: READ } }, async (request, reply) => {
    const settings = await request.withTenant((tx) => readQaSettings(tx));
    return reply.send(serialiseQaSettings(settings));
  });

  app.put('/qa/settings', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(settingsBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const settings = await request.withTenant((tx) =>
      writeQaSettings(tx, principal, tenant, {
        ...(body.sample_percent !== undefined ? { samplePercent: body.sample_percent } : {}),
        ...(body.prescore_enabled !== undefined ? { prescoreEnabled: body.prescore_enabled } : {}),
        ...(body.conflict_check !== undefined ? { conflictCheck: body.conflict_check } : {}),
      }),
    );
    return reply.send(serialiseQaSettings(settings));
  });

  app.get('/qa/rubric', { config: { scopes: READ } }, async (request, reply) => {
    const tenant = request.tenant();
    return reply.send(await request.withTenant((tx) => readActiveQaRubric(tx, tenant)));
  });

  app.put('/qa/rubric', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(rubricBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    return reply.send(
      await request.withTenant((tx) => saveQaRubric(tx, principal, tenant, body.criteria)),
    );
  });

  app.get('/qa/calibrations', async (request, reply) => {
    const principal = request.requirePrincipal();
    return reply.send(await request.withTenant((tx) => listQaCalibrations(tx, principal)));
  });

  app.post('/qa/calibrations', async (request, reply) => {
    const body = parse(calibrationBody, request.body ?? {});
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const round = await request.withTenant((tx) =>
      createQaCalibration(tx, principal, tenant, {
        ...(body.period !== undefined ? { period: body.period } : {}),
      }),
    );
    return reply.code(201).send(round);
  });

  app.get<{ Params: { calibrationId: string } }>(
    '/qa/calibrations/:calibrationId',
    async (request, reply) => {
      const id = parse(uuid, request.params.calibrationId);
      const principal = request.requirePrincipal();
      return reply.send(await request.withTenant((tx) => readQaCalibration(tx, principal, id)));
    },
  );

  app.post<{ Params: { calibrationId: string } }>(
    '/qa/calibrations/:calibrationId/scores',
    async (request, reply) => {
      const id = parse(uuid, request.params.calibrationId);
      const body = parse(calibrationScoreBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      return reply.send(
        await request.withTenant((tx) =>
          submitQaCalibrationScore(tx, principal, tenant, id, {
            reviewId: body.review_id,
            scores: body.scores,
            final: body.final,
          }),
        ),
      );
    },
  );

  app.post<{ Params: { calibrationId: string } }>(
    '/qa/calibrations/:calibrationId/close',
    async (request, reply) => {
      const id = parse(uuid, request.params.calibrationId);
      const principal = request.requirePrincipal();
      return reply.send(await request.withTenant((tx) => closeQaCalibration(tx, principal, id)));
    },
  );

  app.get('/qa/summary', async (request, reply) => {
    const query = parse(summaryQuery, request.query);
    const principal = request.requirePrincipal();
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - SUMMARY_DAYS_DEFAULT * DAY_MS);
    if (
      from.getTime() >= to.getTime() ||
      to.getTime() - from.getTime() > SUMMARY_DAYS_MAX * DAY_MS
    ) {
      throw ApiError.validation(`from, to: a period of at most ${SUMMARY_DAYS_MAX} days.`);
    }
    return reply.send(
      await request.withTenant(async (tx) => {
        await requireQaReach(tx, principal);
        return qaSummary(tx, principal, { from, to });
      }),
    );
  });
}
