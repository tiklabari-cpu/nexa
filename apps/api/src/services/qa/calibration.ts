/**
 * The monthly QA calibration round (tm 319.2 · SiyahTuş analysis AI-24 §7):
 * the same conversations — up to {@link QA_CALIBRATION_SIZE} reviews completed
 * in the last {@link QA_CALIBRATION_LOOKBACK_DAYS} days — are scored by every
 * reviewer on their own, and the report shows per criterion how far they
 * agreed and which reviewers stray from the majority.
 *
 * An administrator opens the month's round (one per month, `qa_calibrations`)
 * and closes it. Every holder of the review row scores it, whatever team the
 * conversation was — calibration is the one place a Team Lead reads another
 * team's review, which is its point. The report is an administrator's while
 * the round is open (a lead's scores must be their own) and everyone's once
 * it closed. A responsible-gaming conversation's text stays the RG team's and
 * the administrators' here too.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  QA_CALIBRATION_LOOKBACK_DAYS,
  QA_CALIBRATION_SIZE,
  ROLE_RANK,
  localDayKey,
  qaCalibrationReport,
  qaCompletionProblems,
  type AgentRole,
  type QaCriterionScore,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import {
  excerptFor,
  readRubricCriteria,
  readScores,
  requireQaAdministrator,
  requireQaReach,
} from './qa-service.js';

function stateError(reason: string, message: string): ApiError {
  return new ApiError('qa_review_state', message, { details: { reason } });
}

function notFound(): ApiError {
  return ApiError.notFound('Calibration round not found.');
}

function isAdministrator(principal: Principal): boolean {
  return principal.kind === 'agent' && ROLE_RANK[principal.role as AgentRole] >= ROLE_RANK.admin;
}

/** `YYYY-MM` → the month's first day; a malformed month is a 400. */
function periodOf(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw ApiError.validation('period: a month, YYYY-MM.');
  }
  return `${month}-01`;
}

export async function createQaCalibration(
  tx: TenantClient,
  principal: Principal,
  tenant: TenantContext,
  input: { period?: string },
) {
  requireQaAdministrator(principal);
  const boundary = await readDayBoundary(tx);
  const period = periodOf(
    input.period ?? localDayKey(new Date(), boundary.timezone, boundary.hour).slice(0, 7),
  );
  const existing = await tx.qaCalibration.findFirst({
    where: { period: new Date(`${period}T00:00:00.000Z`) },
    select: { id: true },
  });
  if (existing) {
    throw stateError('calibration_exists', 'This month has its calibration round already.');
  }
  // The month's pick: a stable spread over the recent completed reviews, so
  // the same month asks for the same conversations however often it is read.
  const picked = await tx.$queryRaw<Array<{ id: string; rubric_id: string }>>`
    SELECT id::text AS id, rubric_id::text AS rubric_id FROM qa_reviews
     WHERE status = 'completed'
       AND reviewed_at > now() - make_interval(days => ${QA_CALIBRATION_LOOKBACK_DAYS}::int)
     ORDER BY md5(${period} || id::text)
     LIMIT ${QA_CALIBRATION_SIZE}`;
  if (picked.length === 0) {
    throw ApiError.validation(
      `No review was completed in the last ${QA_CALIBRATION_LOOKBACK_DAYS} days to calibrate on.`,
      { problems: [{ field: 'period', code: 'empty' }] },
    );
  }
  const active = await tx.qaRubric.findFirst({ where: { active: true }, select: { id: true } });
  const row = await tx.qaCalibration.create({
    data: {
      id: randomUUID(),
      licenseId: tenant.licenseId,
      period: new Date(`${period}T00:00:00.000Z`),
      rubricId: active?.id ?? picked[0]!.rubric_id,
      reviewIds: picked.map((p) => p.id),
      createdBy: principal.kind === 'agent' ? principal.accountId : null,
    },
  });
  return serialiseRound(row, 0);
}

function serialiseRound(
  row: {
    id: string;
    period: Date;
    rubricId: string;
    reviewIds: string[];
    status: string;
    createdBy: string | null;
    createdAt: Date;
    closedAt: Date | null;
  },
  mine: number,
) {
  return {
    id: row.id,
    period: row.period.toISOString().slice(0, 7),
    rubric_id: row.rubricId,
    status: row.status,
    reviews: row.reviewIds.length,
    my_scored: mine,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    closed_at: row.closedAt?.toISOString() ?? null,
  };
}

export async function listQaCalibrations(tx: TenantClient, principal: Principal) {
  await requireQaReach(tx, principal);
  const rows = await tx.qaCalibration.findMany({ orderBy: { period: 'desc' }, take: 24 });
  const mine =
    principal.kind === 'agent' && rows.length > 0
      ? await tx.qaCalibrationScore.groupBy({
          by: ['calibrationId'],
          where: {
            reviewerId: principal.accountId,
            calibrationId: { in: rows.map((r) => r.id) },
          },
          _count: { _all: true },
        })
      : [];
  const count = new Map(mine.map((m) => [m.calibrationId, m._count._all]));
  return { calibrations: rows.map((row) => serialiseRound(row, count.get(row.id) ?? 0)) };
}

async function roundOf(tx: TenantClient, id: string) {
  const row = await tx.qaCalibration.findFirst({ where: { id } });
  if (!row) throw notFound();
  return row;
}

export async function readQaCalibration(tx: TenantClient, principal: Principal, id: string) {
  await requireQaReach(tx, principal);
  const row = await roundOf(tx, id);
  const rubric = await tx.qaRubric.findFirst({
    where: { id: row.rubricId },
    select: { version: true, criteria: true },
  });
  const criteria = readRubricCriteria(rubric?.criteria);
  const reviews = await tx.qaReview.findMany({ where: { id: { in: row.reviewIds } } });
  const scores = await tx.qaCalibrationScore.findMany({ where: { calibrationId: id } });
  const me = principal.kind === 'agent' ? principal.accountId : null;
  const order = new Map(row.reviewIds.map((reviewId, index) => [reviewId, index]));
  reviews.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const items = [];
  for (const review of reviews) {
    const { excerpt, restricted } = await excerptFor(tx, principal, review);
    const own = scores.find((s) => s.reviewId === review.id && s.reviewerId === me);
    items.push({
      review_id: review.id,
      chat_id: review.chatId,
      thread_id: review.threadId,
      reasons: review.reasons,
      excerpt,
      excerpt_restricted: restricted,
      my_scores: own ? readScores(own.scores) : null,
      my_final: own?.final ?? null,
    });
  }
  const showReport = row.status === 'closed' || isAdministrator(principal);
  return {
    ...serialiseRound(row, scores.filter((s) => s.reviewerId === me).length),
    rubric: { id: row.rubricId, version: rubric?.version ?? null, criteria },
    items,
    report: showReport
      ? qaCalibrationReport(
          criteria,
          scores.map((s) => ({
            review_id: s.reviewId,
            reviewer_id: s.reviewerId,
            scores: readScores(s.scores),
          })),
        )
      : null,
  };
}

export async function submitQaCalibrationScore(
  tx: TenantClient,
  principal: Principal,
  tenant: TenantContext,
  id: string,
  input: {
    reviewId: string;
    scores: Record<string, { value: unknown; confirmed?: boolean | undefined }>;
    final: unknown;
  },
) {
  await requireQaReach(tx, principal);
  if (principal.kind !== 'agent') throw notFound();
  const row = await roundOf(tx, id);
  if (row.status !== 'open') {
    throw stateError('calibration_closed', 'This calibration round is closed.');
  }
  if (!row.reviewIds.includes(input.reviewId)) throw ApiError.notFound('Review not in this round.');
  const rubric = await tx.qaRubric.findFirst({
    where: { id: row.rubricId },
    select: { criteria: true },
  });
  const criteria = readRubricCriteria(rubric?.criteria);
  const scores: Record<string, Partial<QaCriterionScore>> = {};
  for (const [key, score] of Object.entries(input.scores)) {
    scores[key] = {
      value: score.value as QaCriterionScore['value'],
      confirmed: score.confirmed === true,
    };
  }
  const { problems, criticalFail } = qaCompletionProblems(criteria, scores, input.final);
  if (problems.length > 0) {
    throw ApiError.validation(
      `The scores cannot be saved: ${problems.map((p) => `${p.field} ${p.code}`).join(', ')}.`,
      { problems },
    );
  }
  const data = {
    scores: scores as unknown as Prisma.InputJsonObject,
    final: input.final as string,
    criticalFail,
    submittedAt: new Date(),
  };
  await tx.qaCalibrationScore.upsert({
    where: {
      calibrationId_reviewId_reviewerId: {
        calibrationId: id,
        reviewId: input.reviewId,
        reviewerId: principal.accountId,
      },
    },
    create: {
      id: randomUUID(),
      licenseId: tenant.licenseId,
      calibrationId: id,
      reviewId: input.reviewId,
      reviewerId: principal.accountId,
      ...data,
    },
    update: data,
  });
  return readQaCalibration(tx, principal, id);
}

export async function closeQaCalibration(tx: TenantClient, principal: Principal, id: string) {
  requireQaAdministrator(principal);
  const row = await roundOf(tx, id);
  if (row.status === 'open') {
    await tx.qaCalibration.update({
      where: { id },
      data: { status: 'closed', closedAt: new Date() },
    });
  }
  return readQaCalibration(tx, principal, id);
}
