/**
 * The QA queue's review side (tm 319.2 · SiyahTuş analysis AI-24 §4, §8 ·
 * `paths/qa.yaml`): who sees which reviews, claiming one, scoring it, adding
 * one by hand from the inbox, the workspace's settings and rubric, and the
 * summary AI-25 reads.
 *
 * **Reach.** The matrix row {@link QA_REVIEW_CAPABILITY} (Team Lead and up by
 * default): an administrator and the Founder see every review, a Team Lead
 * the reviews of the teams they lead — the connection's team when it was
 * queued. Anything else is not there (404), as in the suggestion queue.
 *
 * **Claiming.** A `ready` review is claimed by one reviewer (`in_review`,
 * `assigned_to`); nobody else may score it until they release it. With the
 * workspace's conflict check on (the default), a reviewer who took the
 * conversation over — wrote in it, or accepted its hand-over card — may not
 * review it (`details.reason: conflict_of_interest`).
 *
 * **Scoring.** The pre-score comes filled in on the screen, but nothing the
 * model said counts until a person writes it: a review completes only when
 * every criterion has a value and every critical criterion is confirmed one
 * by one (`qaCompletionProblems`). A failed critical criterion makes the
 * review a `fail` and sets off its follow-ups in the same transaction — an
 * AI-23 suggestion (`source: qa_finding`), an AI-19 scenario draft from the
 * masked excerpt, and on a failed hand-over timing the administrators' mail
 * (sent after the commit by the route).
 *
 * **Responsible gaming.** A conversation with a responsible-gaming flag or
 * hand-over keeps its text from anyone but an administrator and the
 * workspace's Responsible Gaming team: the excerpt comes back with its
 * messages' text emptied (`excerpt_restricted`), the ids and authors kept so
 * the pre-score's evidence still points somewhere.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, QaReview } from '@prisma/client';
import {
  AI_TEST_MAX_TURNS_LIMIT,
  AI_TEST_SCENARIO_NAME_MAX,
  QA_COMMENTS_MAX,
  QA_MANDATORY_HANDOFF_CRITERION,
  QA_OPEN_REVIEW_STATUSES,
  QA_PRIORITIES,
  QA_PRIORITY_RANK,
  QA_REASONS,
  QA_REVIEW_CAPABILITY,
  QA_SAMPLE_PERCENT_MAX,
  QA_SAMPLE_PERCENT_MIN,
  RISK_FLAG_DEFAULTS,
  RISK_FLAG_TYPES,
  ROLE_RANK,
  SUGGESTION_EXCERPT_MESSAGES,
  SUGGESTION_NOTE_MAX,
  capabilityAtLeast,
  detectLanguage,
  isQaScoreValueFor,
  qaCompletionProblems,
  qaPriorityOf,
  qaRubricProblem,
  qaSuggestionKindOf,
  validateAiTestScenario,
  type AgentRole,
  type AiTestExpectations,
  type HandoffReason,
  type QaCriterionScore,
  type QaExcerptMessage,
  type QaPrescore,
  type QaReason,
  type QaReviewAction,
  type QaReviewListStatus,
  type QaRubricCriterion,
  type QaScores,
  type SuggestionExcerptMessage,
  type SuggestionKind,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { maskDeep, maskForWrite } from '../../lib/sensitive-mask.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { chatVisibilityFilter, resolveVisibility } from '../chat/access.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import {
  aiTookPart,
  ensureActiveQaRubric,
  qaDueAt,
  readQaExcerpt,
  readQaSettings,
  type QaSettingsView,
} from './sampler.js';

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------

/** Whose reviews a reviewer sees: every team's, or the teams they lead. */
export interface QaReach {
  all: boolean;
  teamIds: bigint[];
}

function isAdministrator(principal: Principal): boolean {
  return principal.kind === 'agent' && ROLE_RANK[principal.role as AgentRole] >= ROLE_RANK.admin;
}

/** The caller's reach, or null when their role does not review the queue. */
export async function qaReachOf(tx: TenantClient, principal: Principal): Promise<QaReach | null> {
  if (principal.kind !== 'agent') return null;
  if (!capabilityAtLeast(QA_REVIEW_CAPABILITY, principal.capabilities[QA_REVIEW_CAPABILITY])) {
    return null;
  }
  if (isAdministrator(principal)) return { all: true, teamIds: [] };
  const led = await tx.groupAgent.findMany({
    where: { agentId: principal.accountId, isLead: true },
    select: { groupId: true },
  });
  return { all: false, teamIds: led.map((row) => row.groupId) };
}

export async function requireQaReach(tx: TenantClient, principal: Principal): Promise<QaReach> {
  const reach = await qaReachOf(tx, principal);
  if (reach === null) {
    throw ApiError.authorization(
      `Your role does not have the ${QA_REVIEW_CAPABILITY} permission in this workspace.`,
      { reason: 'capability_required', capability: QA_REVIEW_CAPABILITY },
    );
  }
  return reach;
}

/** The reviews `reach` covers, as a `where`. A lead of no team covers none. */
export function qaReachWhere(reach: QaReach): Prisma.QaReviewWhereInput {
  if (reach.all) return {};
  return { teamId: { in: reach.teamIds } };
}

/** The administrator-only settings: the Founder and administrators. */
export function requireQaAdministrator(principal: Principal): void {
  if (!isAdministrator(principal)) {
    throw ApiError.authorization('Only an administrator changes the AI quality settings.', {
      reason: 'role_required',
    });
  }
}

function notFound(): ApiError {
  return ApiError.notFound('Review not found.');
}

function stateError(reason: string, message: string): ApiError {
  return new ApiError('qa_review_state', message, { details: { reason } });
}

// ---------------------------------------------------------------------------
// Reading what is stored
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored rubric's criteria; anything malformed is left out. */
export function readRubricCriteria(raw: unknown): QaRubricCriterion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is QaRubricCriterion =>
      isRecord(entry) &&
      typeof entry['key'] === 'string' &&
      typeof entry['label'] === 'string' &&
      (entry['type'] === 'pass_fail' || entry['type'] === 'score_1_5') &&
      typeof entry['critical'] === 'boolean',
  );
}

/** Stored scores; a value its criterion cannot hold is left out. */
export function readScores(raw: unknown): QaScores {
  if (!isRecord(raw)) return {};
  const scores: QaScores = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || !('value' in entry)) continue;
    const value = entry['value'];
    if (
      value !== null &&
      value !== 'pass' &&
      value !== 'fail' &&
      !(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5)
    ) {
      continue;
    }
    scores[key] = {
      value: value as QaCriterionScore['value'],
      confirmed: entry['confirmed'] === true,
    };
  }
  return scores;
}

export function readPrescore(raw: unknown): QaPrescore | null {
  if (!isRecord(raw) || !Array.isArray(raw['criteria'])) return null;
  return raw as unknown as QaPrescore;
}

export function readExcerpt(raw: unknown): QaExcerptMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is QaExcerptMessage =>
      isRecord(entry) && typeof entry['event_id'] === 'string' && typeof entry['text'] === 'string',
  );
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

export function serialiseQaReview(row: QaReview, now: Date = new Date()) {
  return {
    id: row.id,
    chat_id: row.chatId,
    thread_id: row.threadId,
    ai_agent_id: row.aiAgentId,
    config_version_id: row.configVersionId,
    team_id: row.teamId === null ? null : Number(row.teamId),
    brand_id: row.brandId,
    reasons: row.reasons,
    priority: QA_PRIORITIES[row.priority] ?? 'normal',
    status: row.status,
    sample_day: row.sampleDay ? row.sampleDay.toISOString().slice(0, 10) : null,
    assigned_to: row.assignedTo,
    claimed_at: row.claimedAt?.toISOString() ?? null,
    due_at: row.dueAt.toISOString(),
    overdue: row.status !== 'completed' && row.dueAt.getTime() < now.getTime(),
    rubric_id: row.rubricId,
    prescored: row.prescore !== null,
    final: row.final,
    critical_fail: row.criticalFail,
    reviewer_id: row.reviewerId,
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    comments: row.comments,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export interface QaReviewListQuery {
  status: QaReviewListStatus;
  reason?: QaReason;
  teamId?: bigint;
  mine?: boolean;
  limit: number;
  offset: number;
}

function statusWhere(status: QaReviewListStatus): Prisma.QaReviewWhereInput {
  if (status === 'all') return {};
  if (status === 'open') return { status: { in: [...QA_OPEN_REVIEW_STATUSES] } };
  return { status };
}

export async function listQaReviews(
  tx: TenantClient,
  principal: Principal,
  query: QaReviewListQuery,
) {
  const reach = await requireQaReach(tx, principal);
  const scope = qaReachWhere(reach);
  const where: Prisma.QaReviewWhereInput = {
    AND: [
      scope,
      statusWhere(query.status),
      query.reason ? { reasons: { has: query.reason } } : {},
      query.teamId !== undefined ? { teamId: query.teamId } : {},
      query.mine && principal.kind === 'agent' ? { assignedTo: principal.accountId } : {},
    ],
  };
  const [rows, total, openCount] = await Promise.all([
    tx.qaReview.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }, { id: 'asc' }],
      take: query.limit,
      skip: query.offset,
    }),
    tx.qaReview.count({ where }),
    tx.qaReview.count({
      where: { AND: [scope, { status: { in: [...QA_OPEN_REVIEW_STATUSES] } }] },
    }),
  ]);
  const now = new Date();
  return {
    reviews: rows.map((row) => serialiseQaReview(row, now)),
    total,
    open_count: openCount,
  };
}

// ---------------------------------------------------------------------------
// One review
// ---------------------------------------------------------------------------

/** The review, if the caller's reach covers it — else 404. */
export async function reviewInReach(
  tx: TenantClient,
  principal: Principal,
  id: string,
): Promise<QaReview> {
  const reach = await requireQaReach(tx, principal);
  const row = await tx.qaReview.findFirst({ where: { AND: [{ id }, qaReachWhere(reach)] } });
  if (!row) throw notFound();
  return row;
}

/** The risk flag types that are responsible gaming's (their hand-over goes to the RG team). */
function responsibleGamingTypes(): string[] {
  return RISK_FLAG_TYPES.filter((type) => RISK_FLAG_DEFAULTS[type].topic === 'responsible_gaming');
}

const RESPONSIBLE_GAMING_HANDOFFS: readonly HandoffReason[] = [
  'guardrail_rg',
  'guardrail_self_harm',
  'guardrail_minor',
];

/**
 * Whether the conversation is a responsible-gaming one: a responsible-gaming
 * flag raised in it (or on its chat once the connection is gone) or a
 * responsible-gaming hand-over.
 */
export async function isResponsibleGaming(
  tx: TenantClient,
  row: Pick<QaReview, 'chatId' | 'threadId'>,
): Promise<boolean> {
  const flag = await tx.riskFlag.findFirst({
    where: {
      type: { in: responsibleGamingTypes() },
      OR: [{ threadId: row.threadId }, { chatId: row.chatId, threadId: null }],
    },
    select: { id: true },
  });
  if (flag) return true;
  const handoff = await tx.aiHandoff.findFirst({
    where: { threadId: row.threadId, reasonCodes: { hasSome: [...RESPONSIBLE_GAMING_HANDOFFS] } },
    select: { id: true },
  });
  return handoff !== null;
}

/** An administrator, or a member of the workspace's Responsible Gaming team. */
export async function readsResponsibleGamingText(
  tx: TenantClient,
  principal: Principal,
): Promise<boolean> {
  if (isAdministrator(principal)) return true;
  if (principal.kind !== 'agent') return false;
  const settings = await tx.riskFlagSettings.findFirst({ select: { rgGroupId: true } });
  if (!settings?.rgGroupId) return false;
  const member = await tx.groupAgent.findFirst({
    where: { groupId: settings.rgGroupId, agentId: principal.accountId },
    select: { groupId: true },
  });
  return member !== null;
}

/** The excerpt as `principal` may read it. */
export async function excerptFor(
  tx: TenantClient,
  principal: Principal,
  row: Pick<QaReview, 'chatId' | 'threadId' | 'excerptMasked'>,
): Promise<{ excerpt: QaExcerptMessage[]; restricted: boolean }> {
  const excerpt = readExcerpt(row.excerptMasked);
  if (!(await isResponsibleGaming(tx, row)) || (await readsResponsibleGamingText(tx, principal))) {
    return { excerpt, restricted: false };
  }
  return { excerpt: excerpt.map((message) => ({ ...message, text: '' })), restricted: true };
}

/**
 * The connection's decision trail while it exists (ID-08/ID-09): each AI
 * turn's decision, the guardrails that checked it, its hand-overs and its
 * risk flags. Ids, codes and counts — no text.
 */
export async function readQaTrace(tx: TenantClient, threadId: string) {
  const [decisions, guardrails, handoffs, flags] = await Promise.all([
    tx.aiDecisionLog.findMany({
      where: { threadId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        decision: true,
        triggerEventId: true,
        replyEventId: true,
        procedureId: true,
        procedureVersion: true,
        step: true,
        knowledgeSourceIds: true,
        chunkIds: true,
        guardrailHits: true,
        handoffReason: true,
        riskFlags: true,
        configVersionId: true,
        createdAt: true,
      },
    }),
    tx.aiGuardrailHit.findMany({
      where: { threadId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { ruleKey: true, stage: true, actionTaken: true, createdAt: true },
    }),
    tx.aiHandoff.findMany({
      where: { threadId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        reasonCodes: true,
        primaryReason: true,
        intentLabel: true,
        feedback: true,
        acceptedAt: true,
        createdAt: true,
      },
    }),
    tx.riskFlag.findMany({
      where: { threadId },
      orderBy: [{ raisedAt: 'asc' }, { id: 'asc' }],
      select: {
        type: true,
        severity: true,
        source: true,
        ruleRef: true,
        status: true,
        raisedAt: true,
      },
    }),
  ]);
  return {
    decisions: decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      trigger_event_id: d.triggerEventId,
      reply_event_id: d.replyEventId,
      procedure_id: d.procedureId,
      procedure_version: d.procedureVersion,
      step: d.step,
      knowledge_source_ids: d.knowledgeSourceIds,
      chunk_ids: d.chunkIds,
      guardrail_hits: d.guardrailHits,
      handoff_reason: d.handoffReason,
      risk_flags: d.riskFlags,
      config_version_id: d.configVersionId,
      created_at: d.createdAt.toISOString(),
    })),
    guardrail_hits: guardrails.map((h) => ({
      rule_key: h.ruleKey,
      stage: h.stage,
      action_taken: h.actionTaken,
      created_at: h.createdAt.toISOString(),
    })),
    handoffs: handoffs.map((h) => ({
      id: h.id,
      reason_codes: h.reasonCodes,
      primary_reason: h.primaryReason,
      intent_label: h.intentLabel,
      feedback: h.feedback,
      accepted_at: h.acceptedAt?.toISOString() ?? null,
      created_at: h.createdAt.toISOString(),
    })),
    risk_flags: flags.map((f) => ({
      type: f.type,
      severity: f.severity,
      source: f.source,
      rule_ref: f.ruleRef,
      status: f.status,
      raised_at: f.raisedAt.toISOString(),
    })),
  };
}

/** The suggestion and scenario a completed critical failure opened. */
async function followUpsOf(tx: TenantClient, row: QaReview) {
  if (!row.criticalFail) return { suggestion_id: null, scenario_id: null };
  const [suggestion, scenario] = await Promise.all([
    tx.aiSuggestion.findFirst({
      where: { source: 'qa_finding', threadId: row.threadId, createdBy: row.reviewerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
    tx.aiTestScenario.findFirst({
      where: { origin: 'from_qa', originRef: row.id },
      select: { id: true },
    }),
  ]);
  return { suggestion_id: suggestion?.id ?? null, scenario_id: scenario?.id ?? null };
}

/** `GET /qa/reviews/{id}`: the review, its rubric, pre-score, excerpt and decision trail. */
export async function readQaReview(tx: TenantClient, principal: Principal, id: string) {
  const row = await reviewInReach(tx, principal, id);
  return serialiseQaReviewDetail(tx, principal, row);
}

export async function serialiseQaReviewDetail(
  tx: TenantClient,
  principal: Principal,
  row: QaReview,
) {
  const rubric = await tx.qaRubric.findFirst({
    where: { id: row.rubricId },
    select: { id: true, version: true, criteria: true },
  });
  const { excerpt, restricted } = await excerptFor(tx, principal, row);
  return {
    ...serialiseQaReview(row),
    rubric: {
      id: row.rubricId,
      version: rubric?.version ?? null,
      criteria: readRubricCriteria(rubric?.criteria),
    },
    prescore: readPrescore(row.prescore),
    scores: readScores(row.scores),
    excerpt,
    excerpt_restricted: restricted,
    trace: await readQaTrace(tx, row.threadId),
    follow_ups: await followUpsOf(tx, row),
  };
}

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

/**
 * Whether `accountId` took the connection over: an agent message of theirs
 * in it, or its hand-over card accepted by them.
 */
export async function tookConversationOver(
  tx: TenantClient,
  threadId: string,
  accountId: string,
): Promise<boolean> {
  const wrote = await tx.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM events
     WHERE thread_id = ${threadId} AND author_type = 'agent' AND author_id = ${accountId}
     LIMIT 1`;
  if (wrote.length > 0) return true;
  const accepted = await tx.aiHandoff.findFirst({
    where: { threadId, acceptedBy: accountId },
    select: { id: true },
  });
  return accepted !== null;
}

export async function claimQaReview(
  tx: TenantClient,
  principal: Principal,
  id: string,
): Promise<QaReview> {
  const row = await reviewInReach(tx, principal, id);
  if (principal.kind !== 'agent') throw notFound();
  const me = principal.accountId;
  if (row.status === 'completed') throw stateError('completed', 'This review is completed.');
  if (row.status === 'in_review') {
    if (row.assignedTo === me) return row;
    throw stateError('claimed', 'Someone else is reviewing this conversation.');
  }
  if (row.status === 'pending_prescore') {
    throw stateError('pending_prescore', 'This review is waiting for its pre-score.');
  }
  const settings = await readQaSettings(tx);
  if (settings.conflictCheck && (await tookConversationOver(tx, row.threadId, me))) {
    throw ApiError.authorization('You took this conversation over; someone else reviews it.', {
      reason: 'conflict_of_interest',
    });
  }
  const now = new Date();
  const claimed = await tx.qaReview.updateMany({
    where: { id, status: 'ready' },
    data: { status: 'in_review', assignedTo: me, claimedAt: now, updatedAt: now },
  });
  if (claimed.count === 0) {
    throw stateError('claimed', 'Someone else is reviewing this conversation.');
  }
  return tx.qaReview.findFirstOrThrow({ where: { id } });
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface QaReviewInput {
  action: QaReviewAction;
  scores?: Record<string, { value: unknown; confirmed?: boolean | undefined }>;
  final?: 'pass' | 'fail';
  /** null clears it. */
  comments?: string | null;
}

/** What a completed critical failure set off. */
export interface QaFollowUps {
  suggestionId: string | null;
  suggestionKind: SuggestionKind;
  scenarioId: string | null;
  /** The AI did not hand over when it had to: the administrators are told. */
  mandatoryHandoffViolation: boolean;
  failed: string[];
}

export interface QaReviewOutcome {
  row: QaReview;
  followUps: QaFollowUps | null;
}

function problemsError(problems: Array<{ field: string; code: string }>): ApiError {
  return ApiError.validation(
    `The review cannot be saved: ${problems.map((p) => `${p.field} ${p.code}`).join(', ')}.`,
    { problems },
  );
}

/** The request's scores over the stored ones, each value checked against its criterion. */
function mergeScores(
  rubric: readonly QaRubricCriterion[],
  stored: QaScores,
  input: QaReviewInput['scores'],
): QaScores {
  const merged: QaScores = { ...stored };
  const problems: Array<{ field: string; code: string }> = [];
  for (const [key, score] of Object.entries(input ?? {})) {
    const criterion = rubric.find((c) => c.key === key);
    if (!criterion) {
      problems.push({ field: `scores.${key}`, code: 'invalid' });
      continue;
    }
    if (!isQaScoreValueFor(criterion, score.value)) {
      problems.push({ field: `scores.${key}.value`, code: 'invalid' });
      continue;
    }
    merged[key] = { value: score.value, confirmed: score.confirmed === true };
  }
  if (problems.length > 0) throw problemsError(problems);
  return merged;
}

function maskedComments(comments: string | null | undefined): string | null | undefined {
  if (comments === undefined || comments === null) return comments;
  const trimmed = comments.trim();
  if (trimmed.length === 0) return null;
  return maskForWrite(trimmed, 'agent').text.slice(0, QA_COMMENTS_MAX);
}

export async function updateQaReview(
  tx: TenantClient,
  principal: Principal,
  tenant: TenantContext,
  id: string,
  input: QaReviewInput,
): Promise<QaReviewOutcome> {
  const row = await reviewInReach(tx, principal, id);
  if (principal.kind !== 'agent') throw notFound();
  // The row, held for the rest of the transaction: two requests of the same
  // reviewer do not both complete it.
  await tx.$executeRaw`SELECT 1 FROM qa_reviews WHERE id = ${id}::uuid FOR UPDATE`;
  const current = await tx.qaReview.findFirstOrThrow({ where: { id } });
  if (current.status === 'completed') throw stateError('completed', 'This review is completed.');
  if (current.status !== 'in_review' || current.assignedTo !== principal.accountId) {
    throw stateError('not_claimed', 'Claim the review before scoring it.');
  }
  const rubricRow = await tx.qaRubric.findFirst({
    where: { id: row.rubricId },
    select: { criteria: true },
  });
  const rubric = readRubricCriteria(rubricRow?.criteria);
  const scores = mergeScores(rubric, readScores(current.scores), input.scores);
  const comments = maskedComments(input.comments);
  const now = new Date();
  const common = {
    scores: scores as unknown as Prisma.InputJsonObject,
    ...(comments !== undefined ? { comments } : {}),
    updatedAt: now,
  };

  if (input.action === 'save') {
    return { row: await tx.qaReview.update({ where: { id }, data: common }), followUps: null };
  }
  if (input.action === 'release') {
    return {
      row: await tx.qaReview.update({
        where: { id },
        data: { ...common, status: 'ready', assignedTo: null, claimedAt: null },
      }),
      followUps: null,
    };
  }

  const { problems, criticalFail, failed } = qaCompletionProblems(rubric, scores, input.final);
  if (problems.length > 0) throw problemsError(problems);
  const completed = await tx.qaReview.update({
    where: { id },
    data: {
      ...common,
      status: 'completed',
      final: input.final!,
      criticalFail,
      reviewerId: principal.accountId,
      reviewedAt: now,
    },
  });
  if (!criticalFail) return { row: completed, followUps: null };
  const criticalFailed = failed.filter((key) => rubric.some((c) => c.key === key && c.critical));
  return {
    row: completed,
    followUps: await openFollowUps(tx, principal.accountId, tenant, completed, criticalFailed),
  };
}

/**
 * A critical failure's follow-ups (AI-24 §4), in the review's transaction:
 * an AI-23 suggestion of the kind the first failed criterion names, and an
 * AI-19 scenario draft (inactive) that plays the player's masked lines.
 */
async function openFollowUps(
  tx: TenantClient,
  reviewerId: string,
  tenant: TenantContext,
  row: QaReview,
  failed: string[],
): Promise<QaFollowUps> {
  const excerpt = readExcerpt(row.excerptMasked);
  const thread = await tx.thread.findFirst({
    where: { id: row.threadId, chatId: row.chatId },
    select: { id: true },
  });
  const lastAi = excerpt.reduce((at, message, index) => (message.is_ai ? index : at), -1);
  const suggestionExcerpt: SuggestionExcerptMessage[] = excerpt
    .slice(0, lastAi === -1 ? excerpt.length : lastAi + 1)
    .slice(-SUGGESTION_EXCERPT_MESSAGES)
    .map((message, index, all) => ({
      ...message,
      marked: lastAi !== -1 && index === all.length - 1,
    }));
  const note = `QA: ${failed.join(', ')}${row.comments ? ` — ${row.comments}` : ''}`.slice(
    0,
    SUGGESTION_NOTE_MAX,
  );
  const kind = qaSuggestionKindOf(failed[0] ?? '');
  const suggestion = await tx.aiSuggestion.create({
    data: {
      id: randomUUID(),
      licenseId: tenant.licenseId,
      aiAgentId: row.aiAgentId,
      kind,
      source: 'qa_finding',
      // The connection while it exists: retention may have taken it.
      chatId: thread ? row.chatId : null,
      threadId: thread ? row.threadId : null,
      excerptMasked: suggestionExcerpt as unknown as Prisma.InputJsonArray,
      note,
      teamId: row.teamId,
      status: 'new',
      createdBy: reviewerId,
    },
    select: { id: true },
  });

  const turns = maskDeep(
    excerpt
      .filter((message) => message.author_type === 'customer')
      .map((message) => message.text.trim())
      .filter(Boolean),
    'customer',
  );
  let scenarioId: string | null = null;
  if (turns.length > 0) {
    const handover =
      failed.includes(QA_MANDATORY_HANDOFF_CRITERION) ||
      row.reasons.some((reason) => reason === 'mandatory_handoff' || reason === 'risk_flag');
    const expectations: AiTestExpectations = {
      outcome: handover ? 'handoff' : 'resolved',
      max_turns: Math.min(AI_TEST_MAX_TURNS_LIMIT, Math.max(1, turns.length)),
    };
    const fields = {
      brand_id: null,
      name: `QA: ${failed.join(', ')}`.slice(0, AI_TEST_SCENARIO_NAME_MAX),
      mode: 'scripted',
      persona: 'normal',
      language: detectLanguage(turns.join('\n')) ?? 'tr',
      simulated_now: null,
      goal: null,
      turns,
      facts: {},
      tool_outputs: {},
      expectations,
      active: false,
    };
    if (validateAiTestScenario(fields).length === 0) {
      const now = new Date();
      const scenario = await tx.aiTestScenario.create({
        data: {
          licenseId: tenant.licenseId,
          aiAgentId: row.aiAgentId,
          origin: 'from_qa',
          originRef: row.id,
          brandId: null,
          name: fields.name,
          mode: fields.mode,
          persona: fields.persona,
          language: fields.language,
          simulatedNow: null,
          goal: null,
          turns,
          facts: {},
          toolOutputs: {},
          expectations: expectations as unknown as Prisma.InputJsonObject,
          // A draft: someone reads it and switches it on (AI-24 §4 "taslak").
          active: false,
          createdBy: reviewerId,
          updatedBy: reviewerId,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      scenarioId = scenario.id;
    }
  }
  return {
    suggestionId: suggestion.id,
    suggestionKind: kind,
    scenarioId,
    mandatoryHandoffViolation: failed.includes(QA_MANDATORY_HANDOFF_CRITERION),
    failed,
  };
}

// ---------------------------------------------------------------------------
// Adding one by hand ("QA'ya gönder")
// ---------------------------------------------------------------------------

export interface QaManualInput {
  chatId: string;
  threadId: string;
  note?: string;
}

export async function addQaReviewByHand(
  tx: TenantClient,
  principal: Principal,
  tenant: TenantContext,
  input: QaManualInput,
): Promise<QaReview> {
  const reach = await requireQaReach(tx, principal);
  const visibility = await resolveVisibility(tx, principal, 'read');
  const chat = await tx.chat.findFirst({
    where: { id: input.chatId, ...chatVisibilityFilter(visibility) },
    select: {
      id: true,
      brandId: true,
      access: { select: { groupId: true }, orderBy: { groupId: 'asc' } },
      threads: { where: { id: input.threadId }, select: { id: true, groupId: true, active: true } },
    },
  });
  const thread = chat?.threads[0];
  if (!chat || !thread) throw ApiError.notFound('Chat not found.');
  if (thread.active) {
    throw ApiError.validation('thread_id: the connection is still open; send it once it closed.', {
      problems: [{ field: 'thread_id', code: 'open' }],
    });
  }
  const tookPart = await tx.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM threads t WHERE t.id = ${thread.id} AND ${aiTookPart('t')}`;
  if (tookPart.length === 0) {
    throw ApiError.validation('thread_id: the AI took no part in this connection.', {
      problems: [{ field: 'thread_id', code: 'no_ai' }],
    });
  }
  const teamId = thread.groupId ?? chat.access[0]?.groupId ?? null;
  if (!reach.all && (teamId === null || !reach.teamIds.includes(teamId))) {
    throw ApiError.authorization('You review the conversations of the teams you lead.', {
      reason: 'outside_reach',
    });
  }
  const agent = await tx.aiAgent.findFirst({
    where: { kind: 'ai_agent' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!agent) throw ApiError.validation('This workspace has no AI agent.');
  const existing = await tx.qaReview.findFirst({
    where: { threadId: thread.id },
    select: { status: true },
  });
  if (existing?.status === 'completed') {
    throw stateError('completed', 'This conversation was reviewed already.');
  }

  const settings = await readQaSettings(tx);
  const boundary = await readDayBoundary(tx);
  const rubric = await ensureActiveQaRubric(tx, tenant.licenseId);
  const conversation = await tx.aiConversation.findFirst({
    where: { threadId: thread.id },
    select: { configVersionId: true },
  });
  const reasons: QaReason[] = ['manual'];
  const priority = qaPriorityOf(reasons);
  const excerpt = await readQaExcerpt(tx, thread.id);
  const note = maskedComments(input.note) ?? null;
  await tx.$executeRaw`
    INSERT INTO qa_reviews (
      id, license_id, chat_id, thread_id, ai_agent_id, config_version_id, team_id, brand_id,
      reasons, priority, status, due_at, rubric_id, excerpt_masked, comments
    ) VALUES (
      ${randomUUID()}::uuid, ${tenant.licenseId}, ${chat.id}, ${thread.id}, ${agent.id}::uuid,
      ${conversation?.configVersionId ?? null}::uuid, ${teamId}, ${chat.brandId}::uuid,
      ${reasons}::text[], ${QA_PRIORITY_RANK[priority]},
      ${settings.prescoreEnabled ? 'pending_prescore' : 'ready'},
      ${qaDueAt(new Date(), priority, boundary.timezone)}, ${rubric.id}::uuid,
      ${JSON.stringify(excerpt)}::jsonb, ${note}
    )
    ON CONFLICT (license_id, thread_id) DO UPDATE SET
      reasons = ARRAY(
        SELECT merged.reason FROM (
          SELECT DISTINCT unnest(qa_reviews.reasons || EXCLUDED.reasons) AS reason
        ) merged
        ORDER BY array_position(${[...QA_REASONS]}::text[], merged.reason)
      ),
      comments = COALESCE(qa_reviews.comments, EXCLUDED.comments),
      updated_at = now()
    WHERE qa_reviews.status <> 'completed'`;
  return tx.qaReview.findFirstOrThrow({ where: { threadId: thread.id } });
}

// ---------------------------------------------------------------------------
// Settings and rubric (Ayarlar › AI kalite)
// ---------------------------------------------------------------------------

export function serialiseQaSettings(settings: QaSettingsView) {
  return {
    sample_percent: settings.samplePercent,
    sample_percent_min: QA_SAMPLE_PERCENT_MIN,
    sample_percent_max: QA_SAMPLE_PERCENT_MAX,
    prescore_enabled: settings.prescoreEnabled,
    conflict_check: settings.conflictCheck,
  };
}

export async function writeQaSettings(
  tx: TenantClient,
  principal: Principal,
  tenant: TenantContext,
  input: { samplePercent?: number; prescoreEnabled?: boolean; conflictCheck?: boolean },
): Promise<QaSettingsView> {
  requireQaAdministrator(principal);
  const current = await readQaSettings(tx);
  const next: QaSettingsView = {
    samplePercent: input.samplePercent ?? current.samplePercent,
    prescoreEnabled: input.prescoreEnabled ?? current.prescoreEnabled,
    conflictCheck: input.conflictCheck ?? current.conflictCheck,
  };
  const updatedBy = principal.kind === 'agent' ? principal.accountId : null;
  const data = {
    samplePercent: next.samplePercent,
    prescoreEnabled: next.prescoreEnabled,
    conflictCheck: next.conflictCheck,
    updatedBy,
    updatedAt: new Date(),
  };
  await tx.qaSettings.upsert({
    where: { licenseId: tenant.licenseId },
    create: { licenseId: tenant.licenseId, ...data },
    update: data,
  });
  return next;
}

export async function readActiveQaRubric(tx: TenantClient, tenant: TenantContext) {
  const active = await ensureActiveQaRubric(tx, tenant.licenseId);
  const row = await tx.qaRubric.findFirstOrThrow({ where: { id: active.id } });
  return serialiseRubric(row);
}

function serialiseRubric(row: {
  id: string;
  version: number;
  criteria: unknown;
  createdBy: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    version: row.version,
    criteria: readRubricCriteria(row.criteria),
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * A new rubric version (`qaRubricProblem` decides what may be saved): the
 * active one stops being active, the new one is. Reviews already queued keep
 * the version they were queued with.
 */
export async function saveQaRubric(
  tx: TenantClient,
  principal: Principal,
  tenant: TenantContext,
  criteria: unknown,
) {
  requireQaAdministrator(principal);
  const problem = qaRubricProblem(criteria);
  if (problem) throw ApiError.validation(problem);
  await ensureActiveQaRubric(tx, tenant.licenseId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa_rubrics:${tenant.licenseId}`}))`;
  const latest = await tx.qaRubric.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  await tx.qaRubric.updateMany({ where: { active: true }, data: { active: false } });
  const cleaned = (criteria as QaRubricCriterion[]).map((c) => ({
    key: c.key,
    label: c.label.trim(),
    type: c.type,
    weight: c.weight,
    critical: c.critical,
    locked: c.locked,
  }));
  const row = await tx.qaRubric.create({
    data: {
      id: randomUUID(),
      licenseId: tenant.licenseId,
      version: (latest?.version ?? 0) + 1,
      criteria: cleaned as unknown as Prisma.InputJsonArray,
      active: true,
      createdBy: principal.kind === 'agent' ? principal.accountId : null,
    },
  });
  return serialiseRubric(row);
}

// ---------------------------------------------------------------------------
// The summary (AI-25's QA figures)
// ---------------------------------------------------------------------------

/**
 * The queue's figures for a period, within the caller's reach: what is open
 * and overdue now, and of the reviews completed in the period how many
 * passed, failed, failed critically, per reason and per criterion — with the
 * three AI-25 reads: mandatory hand-overs checked and violated, guardrail
 * breaches a person confirmed, and false resolutions (a connection the AI
 * settled that the review failed).
 */
export async function qaSummary(
  tx: TenantClient,
  principal: Principal,
  period: { from: Date; to: Date },
) {
  const reach = await requireQaReach(tx, principal);
  const scope = qaReachWhere(reach);
  const now = new Date();
  const [open, overdue, completed] = await Promise.all([
    tx.qaReview.count({
      where: { AND: [scope, { status: { in: [...QA_OPEN_REVIEW_STATUSES] } }] },
    }),
    tx.qaReview.count({
      where: {
        AND: [scope, { status: { in: [...QA_OPEN_REVIEW_STATUSES] } }, { dueAt: { lt: now } }],
      },
    }),
    tx.qaReview.findMany({
      where: {
        AND: [scope, { status: 'completed' }, { reviewedAt: { gte: period.from, lt: period.to } }],
      },
      select: { threadId: true, reasons: true, final: true, criticalFail: true, scores: true },
    }),
  ]);
  const byReason = Object.fromEntries(QA_REASONS.map((reason) => [reason, 0])) as Record<
    QaReason,
    number
  >;
  const criteria: Record<string, number> = {};
  let mandatoryReviewed = 0;
  let mandatoryViolations = 0;
  let guardrailViolations = 0;
  const failedThreads: string[] = [];
  for (const review of completed) {
    for (const reason of review.reasons) {
      if (reason in byReason) byReason[reason as QaReason] += 1;
    }
    const scores = readScores(review.scores);
    for (const [key, score] of Object.entries(scores)) {
      const failed =
        score.value === 'fail' || (typeof score.value === 'number' && score.value <= 2);
      if (failed) criteria[key] = (criteria[key] ?? 0) + 1;
    }
    if (review.reasons.includes('mandatory_handoff')) mandatoryReviewed += 1;
    if (scores[QA_MANDATORY_HANDOFF_CRITERION]?.value === 'fail') mandatoryViolations += 1;
    if (scores['guardrails']?.value === 'fail') guardrailViolations += 1;
    if (review.final === 'fail') failedThreads.push(review.threadId);
  }
  const falseResolutions =
    failedThreads.length === 0
      ? 0
      : await tx.aiConversation.count({
          where: {
            threadId: { in: failedThreads },
            outcome: { in: ['resolved', 'resolved_waiting'] },
          },
        });
  return {
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    open,
    overdue,
    completed: completed.length,
    passed: completed.filter((r) => r.final === 'pass').length,
    failed: completed.filter((r) => r.final === 'fail').length,
    critical_failed: completed.filter((r) => r.criticalFail).length,
    by_reason: byReason,
    criteria_failed: criteria,
    mandatory_handoff: { reviewed: mandatoryReviewed, violations: mandatoryViolations },
    guardrail_violations_confirmed: guardrailViolations,
    false_resolutions: falseResolutions,
  };
}
