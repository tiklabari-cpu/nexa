/**
 * The AI coaching and suggestion queue (tm 318.1 · SiyahTuş analysis AI-23 ·
 * `paths/ai-suggestions.yaml`): who may see which suggestion, making one,
 * reviewing it and keeping it as a test scenario.
 *
 * **Reach.** A suggestion is the agent's who made it and its reviewers': a
 * member holding `ai.suggestions.review` — a Team Lead for the teams they lead
 * (`group_agents.is_lead`), an administrator or the Founder for every team
 * (RL-03). `team_id` is the conversation's team when the suggestion was made,
 * so a chat transferred later stays with the team that saw it. A suggestion
 * outside the caller's reach is absent (404), never forbidden (NFR-S5).
 *
 * **Making one** (AI-23 §1): the conversation must be visible to the caller
 * (`resolveVisibility`, the inbox's own rule). The marked message must be the
 * AI's for `SUGGESTION_AI_MESSAGE_KINDS` and an agent's for an offered answer.
 * The last `SUGGESTION_EXCERPT_MESSAGES` messages up to it are copied, masked
 * under each author's policy (AI-26), so the review outlives the
 * conversation's retention. The same message, kind and author twice is 409;
 * `SUGGESTIONS_PER_AGENT_PER_DAY` in a rolling day, then 429. A "wrong" or
 * "lacked this" mark also puts the player's question on the unresolved list
 * (`agent_flagged`, AI-22) — the clustering job groups it with the rest.
 *
 * **Accepting** (AI-23 §4, AI-23-S1) writes the proposal into the AI-20 draft
 * through `config-draft.ts`, the door every save uses — the change history
 * (AI-21) and the draft revision move with it, and nothing reaches a player
 * before a publication. `resulting_change_id` is the history row it wrote.
 */
import { randomUUID } from 'node:crypto';
import type { AiSuggestion, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  AI_BOT_ID,
  AI_SUGGESTIONS_REVIEW_CAPABILITY,
  AI_SUGGEST_CAPABILITY,
  AI_TEST_MAX_TURNS_LIMIT,
  DEFAULT_GUIDANCE_PRIORITY,
  GUIDANCE_BODY_MAX,
  GUIDANCE_RULES_PER_AGENT_MAX,
  GUIDANCE_TITLE_MAX,
  PROCEDURE_EXAMPLES_MAX,
  PROCEDURE_EXAMPLE_MAX,
  PROCEDURE_WHEN_TO_USE_MAX,
  ROLE_RANK,
  SUGGESTIONS_PER_AGENT_PER_DAY,
  SUGGESTION_AGENT_MESSAGE_KINDS,
  SUGGESTION_AI_MESSAGE_KINDS,
  SUGGESTION_CLOSED_STATUSES,
  SUGGESTION_DRAFTED_KINDS,
  SUGGESTION_EXCERPT_MESSAGES,
  SUGGESTION_EXCERPT_TEXT_MAX,
  SUGGESTION_OPEN_STATUSES,
  capabilitiesForRole,
  capabilityAtLeast,
  detectLanguage,
  parseEventId,
  validateAiTestScenario,
  type AgentRole,
  type AiSuggestionCreatedPush,
  type AiSuggestionReviewedPush,
  type AiTestExpectations,
  type SuggestionExcerptMessage,
  type SuggestionKind,
  type SuggestionListStatus,
  type SuggestionProposedChange,
  type SuggestionReviewAction,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { maskDeep, maskForWrite, sensitiveAuthorOf } from '../../lib/sensitive-mask.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { requireCapability } from '../auth/capability.js';
import { readPermissionMatrix } from '../auth/permission-matrix.js';
import type { Principal } from '../auth/principal.js';
import { writeUnresolvedItem } from '../chat/ai-unresolved.js';
import { chatVisibilityFilter, resolveVisibility } from '../chat/access.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { isLockedCopy, templateLocked } from '../ai-templates/install.js';
import type { ConfigChangeAuthor } from './config-history.js';
import {
  createGuidanceRuleDraft,
  createKnowledgeSourceDraft,
  knowledgeScopeOfFiling,
  updateGuidanceRuleDraft,
  updateKnowledgeSourceDraft,
  updateSkillDraft,
} from './config-draft.js';
import { lockedRuleViolation } from './guidance-check.js';
import type { KnowledgeService, PreparedChunks } from './knowledge-service.js';
import type { ProcedureExamples } from './procedure-examples.js';

// ---------------------------------------------------------------------------
// Reach
// ---------------------------------------------------------------------------

/** Whom a reviewer reviews: every team, or the teams they lead. */
export interface ReviewReach {
  all: boolean;
  teamIds: bigint[];
}

/** The caller's review reach, or null when their role does not review (`ai.suggestions.review`). */
export async function reviewReachOf(
  tx: TenantClient,
  principal: Principal,
): Promise<ReviewReach | null> {
  if (principal.kind !== 'agent') return null;
  if (
    !capabilityAtLeast(
      AI_SUGGESTIONS_REVIEW_CAPABILITY,
      principal.capabilities[AI_SUGGESTIONS_REVIEW_CAPABILITY],
    )
  ) {
    return null;
  }
  if (ROLE_RANK[principal.role as AgentRole] >= ROLE_RANK.admin) return { all: true, teamIds: [] };
  const led = await tx.groupAgent.findMany({
    where: { agentId: principal.accountId, isLead: true },
    select: { groupId: true },
  });
  return { all: false, teamIds: led.map((row) => row.groupId) };
}

/** The suggestions `reach` reviews, as a `where`; null: none. */
function reviewableWhere(reach: ReviewReach | null): Prisma.AiSuggestionWhereInput | null {
  if (reach === null) return null;
  if (reach.all) return {};
  if (reach.teamIds.length === 0) return null;
  return { teamId: { in: reach.teamIds } };
}

/** What the caller sees: what they review, and their own. */
function visibleWhere(
  principal: Principal,
  reach: ReviewReach | null,
): Prisma.AiSuggestionWhereInput {
  const own: Prisma.AiSuggestionWhereInput =
    principal.kind === 'agent' ? { createdBy: principal.accountId } : { id: { in: [] } };
  const reviewable = reviewableWhere(reach);
  if (reviewable === null) return own;
  if (Object.keys(reviewable).length === 0) return {};
  return { OR: [reviewable, own] };
}

function notFound(): ApiError {
  return ApiError.notFound('Suggestion not found.');
}

// ---------------------------------------------------------------------------
// Serialising
// ---------------------------------------------------------------------------

/** A stored excerpt as the API names it; anything malformed is left out. */
export function readExcerpt(raw: unknown): SuggestionExcerptMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is SuggestionExcerptMessage =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)['event_id'] === 'string' &&
      typeof (entry as Record<string, unknown>)['text'] === 'string',
  );
}

function readProposal(raw: unknown): SuggestionProposedChange | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return {
    target: value['target'] as SuggestionProposedChange['target'],
    title: String(value['title'] ?? ''),
    body: String(value['body'] ?? ''),
    source_id: typeof value['source_id'] === 'string' ? value['source_id'] : null,
  };
}

interface SimilarSource {
  chunk_id: string;
  source_id: string;
  source_name: string;
}

/** The knowledge passages the suggestions name, with their sources — those still there. */
async function similarSourcesOf(
  tx: TenantClient,
  rows: readonly AiSuggestion[],
): Promise<Map<string, SimilarSource>> {
  const ids = [...new Set(rows.flatMap((row) => row.similarChunkIds))];
  if (ids.length === 0) return new Map();
  const found = await tx.$queryRaw<
    Array<{ chunk_id: string; source_id: string; source_name: string }>
  >`
    SELECT c.id::text AS chunk_id, s.id::text AS source_id, s.name AS source_name
      FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c.source_id
     WHERE c.id = ANY (${ids}::uuid[])`;
  return new Map(found.map((row) => [row.chunk_id, row]));
}

export function serialiseSuggestion(row: AiSuggestion, similar: Map<string, SimilarSource>) {
  return {
    id: row.id,
    ai_agent_id: row.aiAgentId,
    kind: row.kind,
    source: row.source,
    status: row.status,
    chat_id: row.chatId,
    thread_id: row.threadId,
    event_ids: row.eventIds,
    excerpt: readExcerpt(row.excerptMasked),
    note: row.note,
    team_id: row.teamId === null ? null : Number(row.teamId),
    proposed_change: readProposal(row.proposedChange),
    removed_specifics: row.removedSpecifics,
    drafted_by: row.draftedBy,
    duplicate_of: row.duplicateOf,
    cluster_id: row.clusterId,
    already_known: row.similarChunkIds.length > 0,
    similar_sources: row.similarChunkIds.flatMap((id) => {
      const hit = similar.get(id);
      return hit ? [hit] : [];
    }),
    reviewer_id: row.reviewerId,
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    review_note: row.reviewNote,
    resulting_change_id: row.resultingChangeId,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function serialiseSuggestions(tx: TenantClient, rows: readonly AiSuggestion[]) {
  const similar = await similarSourcesOf(tx, rows);
  return rows.map((row) => serialiseSuggestion(row, similar));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface SuggestionListQuery {
  status: SuggestionListStatus;
  kind?: SuggestionKind;
  aiAgentId?: string;
  teamId?: bigint;
  mine?: boolean;
  limit: number;
  offset: number;
}

function statusWhere(status: SuggestionListStatus): Prisma.AiSuggestionWhereInput {
  if (status === 'all') return {};
  if (status === 'open') return { status: { in: [...SUGGESTION_OPEN_STATUSES] } };
  return { status };
}

/** The open suggestions `reach` reviews — the badge. */
export async function openCount(tx: TenantClient, reach: ReviewReach | null): Promise<number> {
  const reviewable = reviewableWhere(reach);
  if (reviewable === null) return 0;
  return tx.aiSuggestion.count({
    where: { ...reviewable, status: { in: [...SUGGESTION_OPEN_STATUSES] } },
  });
}

export async function listSuggestions(
  tx: TenantClient,
  principal: Principal,
  query: SuggestionListQuery,
) {
  const reach = await reviewReachOf(tx, principal);
  const scope: Prisma.AiSuggestionWhereInput =
    query.mine && principal.kind === 'agent'
      ? { createdBy: principal.accountId }
      : visibleWhere(principal, reach);
  const where: Prisma.AiSuggestionWhereInput = {
    AND: [
      scope,
      statusWhere(query.status),
      query.kind ? { kind: query.kind } : {},
      query.aiAgentId ? { aiAgentId: query.aiAgentId } : {},
      query.teamId !== undefined ? { teamId: query.teamId } : {},
    ],
  };
  const [rows, total, open] = await Promise.all([
    tx.aiSuggestion.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      skip: query.offset,
    }),
    tx.aiSuggestion.count({ where }),
    openCount(tx, reach),
  ]);
  return { suggestions: await serialiseSuggestions(tx, rows), total, open_count: open };
}

/** One suggestion the caller sees, or 404. */
export async function readSuggestion(tx: TenantClient, principal: Principal, id: string) {
  const reach = await reviewReachOf(tx, principal);
  const row = await tx.aiSuggestion.findFirst({
    where: { AND: [{ id }, visibleWhere(principal, reach)] },
  });
  if (!row) throw notFound();
  return row;
}

/** One suggestion the caller reviews, or 404. */
async function reviewableSuggestion(
  tx: TenantClient,
  principal: Principal,
  id: string,
  lock: boolean,
): Promise<AiSuggestion> {
  const reviewable = reviewableWhere(await reviewReachOf(tx, principal));
  if (reviewable === null) throw notFound();
  const row = await tx.aiSuggestion.findFirst({ where: { AND: [{ id }, reviewable] } });
  if (!row) throw notFound();
  if (!lock) return row;
  // The decision is one: two reviewers at once wait on the row, and the
  // second sees it decided.
  await tx.$executeRaw`SELECT 1 FROM ai_suggestions WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  return tx.aiSuggestion.findFirstOrThrow({ where: { id } });
}

// ---------------------------------------------------------------------------
// Making one
// ---------------------------------------------------------------------------

export interface CreateSuggestionInput {
  chatId: string;
  threadId: string;
  eventId?: string;
  kind: SuggestionKind;
  note?: string;
  aiAgentId?: string;
  proposedChange?: SuggestionProposedChange;
}

interface ExcerptRow {
  id: string;
  author_type: string;
  author_id: string | null;
  text: string | null;
  created_at: Date;
}

/** The excerpt: the last messages to all, up to `sequence` when one is named, oldest first. */
async function readExcerptRows(
  tx: TenantClient,
  threadId: string,
  sequence: number | null,
): Promise<ExcerptRow[]> {
  const upTo = sequence === null ? Prisma.empty : Prisma.sql`AND event_sequence <= ${sequence}`;
  const rows = await tx.$queryRaw<ExcerptRow[]>`
    SELECT id, author_type, author_id, text, created_at FROM events
     WHERE thread_id = ${threadId} AND type = 'message' AND recipients = 'all'
       ${upTo}
     ORDER BY event_sequence DESC
     LIMIT ${SUGGESTION_EXCERPT_MESSAGES}`;
  return rows.reverse();
}

function excerptOf(
  rows: readonly ExcerptRow[],
  markedId: string | null,
): SuggestionExcerptMessage[] {
  return rows.flatMap((row) => {
    const author = sensitiveAuthorOf(row.author_type);
    if (author === null) return [];
    const text = maskForWrite(row.text ?? '', author).text.slice(0, SUGGESTION_EXCERPT_TEXT_MAX);
    return [
      {
        event_id: row.id,
        author_type: author,
        is_ai: author === 'bot' && row.author_id === AI_BOT_ID,
        text,
        created_at: row.created_at.toISOString(),
        marked: row.id === markedId,
      },
    ];
  });
}

function maskedChange(change: SuggestionProposedChange): SuggestionProposedChange {
  return {
    target: change.target,
    title: maskForWrite(change.title.trim(), 'agent').text,
    body: maskForWrite(change.body.trim(), 'agent').text,
    source_id: change.source_id ?? null,
  };
}

function duplicate(id: string): ApiError {
  return new ApiError(
    'ai_suggestion_state',
    'You already made this suggestion about this message.',
    {
      details: { reason: 'duplicate', suggestion_id: id },
    },
  );
}

/** The row the reviewers' badge is told of. */
export interface AnnouncedSuggestion {
  id: string;
  aiAgentId: string;
  kind: SuggestionKind;
  teamId: bigint | null;
}

export async function createSuggestion(
  tx: TenantClient,
  principal: Principal,
  tenant: TenantContext,
  input: CreateSuggestionInput,
): Promise<AiSuggestion> {
  requireCapability(principal, AI_SUGGEST_CAPABILITY);
  if (principal.kind !== 'agent') throw ApiError.authorization('Only a member makes suggestions.');
  const author = principal.accountId;

  // The conversation, as the inbox would show it — or 404.
  const visibility = await resolveVisibility(tx, principal, 'read');
  const chat = await tx.chat.findFirst({
    where: { id: input.chatId, ...chatVisibilityFilter(visibility) },
    select: {
      id: true,
      brandId: true,
      access: { select: { groupId: true }, orderBy: { groupId: 'asc' } },
      threads: { where: { id: input.threadId }, select: { id: true, groupId: true } },
    },
  });
  const thread = chat?.threads[0];
  if (!chat || !thread) throw ApiError.notFound('Chat not found.');

  const agent = await tx.aiAgent.findFirst({
    where: { kind: 'ai_agent', ...(input.aiAgentId ? { id: input.aiAgentId } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!agent) {
    throw input.aiAgentId
      ? ApiError.notFound('AI agent not found.')
      : ApiError.validation('ai_agent_id: this workspace has no AI agent to suggest to.');
  }

  // The marked message, on this connection, to all.
  const needsAi = (SUGGESTION_AI_MESSAGE_KINDS as readonly string[]).includes(input.kind);
  const needsAgent = (SUGGESTION_AGENT_MESSAGE_KINDS as readonly string[]).includes(input.kind);
  let sequence: number | null = null;
  if (input.eventId !== undefined) {
    const parsed = parseEventId(input.eventId);
    const [event] =
      parsed && parsed.threadId === thread.id
        ? await tx.$queryRaw<Array<{ author_type: string; author_id: string | null }>>`
            SELECT author_type, author_id FROM events
             WHERE id = ${input.eventId} AND thread_id = ${thread.id}
               AND type = 'message' AND recipients = 'all'
             LIMIT 1`
        : [];
    if (!event || !parsed) throw ApiError.notFound('Message not found.');
    if (needsAi && !(event.author_type === 'bot' && event.author_id === AI_BOT_ID)) {
      throw ApiError.validation(
        `event_id: a ${input.kind} suggestion names one of the AI's messages.`,
      );
    }
    if (needsAgent && event.author_type !== 'agent') {
      throw ApiError.validation(`event_id: a ${input.kind} suggestion names an agent's message.`);
    }
    sequence = parsed.sequence;
  } else if (needsAi || needsAgent) {
    throw ApiError.validation(
      `event_id: a ${input.kind} suggestion names the message it is about.`,
    );
  }

  // One person's allowance and one mark per message: the person's rows are
  // counted under their own lock, so two requests at once do not both pass.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai_suggestions:${author}`}))`;
  if (input.eventId !== undefined) {
    const existing = await tx.aiSuggestion.findFirst({
      where: {
        createdBy: author,
        kind: input.kind,
        source: 'agent_flag',
        eventIds: { equals: [input.eventId] },
      },
      select: { id: true },
    });
    if (existing) throw duplicate(existing.id);
  }
  const today = await tx.aiSuggestion.count({
    where: { createdBy: author, createdAt: { gt: new Date(Date.now() - 24 * 3_600_000) } },
  });
  if (today >= SUGGESTIONS_PER_AGENT_PER_DAY) {
    throw new ApiError(
      'too_many_requests',
      `At most ${SUGGESTIONS_PER_AGENT_PER_DAY} suggestions a day; try again tomorrow.`,
      { details: { reason: 'ai_suggestions_daily_limit', limit: SUGGESTIONS_PER_AGENT_PER_DAY } },
    );
  }

  const rows = await readExcerptRows(tx, thread.id, sequence);
  const excerpt = excerptOf(rows, input.eventId ?? null);
  const drafted = (SUGGESTION_DRAFTED_KINDS as readonly string[]).includes(input.kind);
  const proposal = input.proposedChange ? maskedChange(input.proposedChange) : null;
  const id = randomUUID();
  const row = await tx.aiSuggestion.create({
    data: {
      id,
      licenseId: tenant.licenseId,
      aiAgentId: agent.id,
      kind: input.kind,
      source: 'agent_flag',
      chatId: chat.id,
      threadId: thread.id,
      eventIds: input.eventId ? [input.eventId] : [],
      excerptMasked: excerpt as unknown as Prisma.InputJsonArray,
      note: input.note ? maskForWrite(input.note.trim(), 'agent').text : null,
      teamId: thread.groupId ?? chat.access[0]?.groupId ?? null,
      ...(proposal ? { proposedChange: proposal as unknown as Prisma.InputJsonObject } : {}),
      status: drafted && proposal === null ? 'drafting' : 'new',
      createdBy: author,
    },
  });

  // The player's question the AI got wrong, on the unresolved list (AI-22).
  if (input.kind === 'wrong_answer' || input.kind === 'missing_info') {
    const marked = excerpt.findIndex((message) => message.marked);
    const question = excerpt
      .slice(0, marked === -1 ? excerpt.length : marked)
      .reverse()
      .find((message) => message.author_type === 'customer');
    if (question) {
      await writeUnresolvedItem(tx, tenant.licenseId, {
        aiAgentId: agent.id,
        brandId: chat.brandId,
        chatId: chat.id,
        threadId: thread.id,
        eventId: question.event_id,
        text: question.text,
        reason: 'agent_flagged',
        language: detectLanguage(question.text) ?? null,
        intentGuess: null,
        configVersionId: null,
        embedding: null,
      });
    }
  }
  return row;
}

/** The P2002 the one-per-mark index raises when two identical requests raced past the read. */
export function isDuplicateMark(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// ---------------------------------------------------------------------------
// Telling people
// ---------------------------------------------------------------------------

/**
 * `ai_suggestion_created` to the people who may review `row` — the Team Leads
 * of its team and the administrators whose role holds the review row — each
 * with their own open count. Never throws: the suggestion is written.
 */
export async function announceSuggestionCreated(
  db: PrismaClient,
  tenant: TenantContext,
  publisher: RealtimePublisher | null,
  row: AnnouncedSuggestion,
): Promise<void> {
  if (publisher === null) return;
  try {
    const audiences = await withTenant(db, tenant, async (tx) => {
      const matrix = await readPermissionMatrix(tx, tenant.licenseId);
      const reviews = (role: string) =>
        (Object.keys(ROLE_RANK) as string[]).includes(role) &&
        capabilityAtLeast(
          AI_SUGGESTIONS_REVIEW_CAPABILITY,
          capabilitiesForRole(role as AgentRole, matrix.overrides)[
            AI_SUGGESTIONS_REVIEW_CAPABILITY
          ],
        );
      const admins = await tx.agentMembership.findMany({
        where: {
          licenseId: tenant.licenseId,
          suspended: false,
          role: { in: ['owner', 'viceowner', 'admin'] },
        },
        select: { agentId: true, role: true },
      });
      const out: Array<{ agentIds: string[]; count: number }> = [];
      const adminIds = admins.filter((m) => reviews(m.role)).map((m) => m.agentId);
      if (adminIds.length > 0) {
        out.push({ agentIds: adminIds, count: await openCount(tx, { all: true, teamIds: [] }) });
      }
      if (row.teamId !== null) {
        const leads = await tx.groupAgent.findMany({
          where: { groupId: row.teamId, isLead: true },
          select: { agentId: true },
        });
        const members = await tx.agentMembership.findMany({
          where: {
            licenseId: tenant.licenseId,
            suspended: false,
            role: 'team_lead',
            agentId: { in: leads.map((lead) => lead.agentId) },
          },
          select: { agentId: true, role: true },
        });
        for (const member of members.filter((m) => reviews(m.role))) {
          const led = await tx.groupAgent.findMany({
            where: { agentId: member.agentId, isLead: true },
            select: { groupId: true },
          });
          out.push({
            agentIds: [member.agentId],
            count: await openCount(tx, { all: false, teamIds: led.map((g) => g.groupId) }),
          });
        }
      }
      return out;
    });
    for (const audience of audiences) {
      const payload: AiSuggestionCreatedPush = {
        suggestion_id: row.id,
        ai_agent_id: row.aiAgentId,
        kind: row.kind,
        team_id: row.teamId === null ? null : Number(row.teamId),
        open_count: audience.count,
      };
      await publisher.publish(
        tenant,
        'ai_suggestion_created',
        { agentIds: audience.agentIds },
        payload,
      );
    }
  } catch {
    // The badge catches up on the next list read.
  }
}

/** `ai_suggestion_reviewed` to the suggestion's author. Never throws. */
export async function announceSuggestionReviewed(
  tenant: TenantContext,
  publisher: RealtimePublisher | null,
  row: AiSuggestion,
): Promise<void> {
  if (publisher === null || row.createdBy === null) return;
  if (!(SUGGESTION_CLOSED_STATUSES as readonly string[]).includes(row.status)) return;
  const payload: AiSuggestionReviewedPush = {
    suggestion_id: row.id,
    kind: row.kind as SuggestionKind,
    status: row.status as AiSuggestionReviewedPush['status'],
    review_note: row.reviewNote,
  };
  try {
    await publisher.publish(
      tenant,
      'ai_suggestion_reviewed',
      { agentIds: [row.createdBy] },
      payload,
    );
  } catch {
    // The author sees the outcome on their list.
  }
}

// ---------------------------------------------------------------------------
// Reviewing
// ---------------------------------------------------------------------------

export interface ReviewInput {
  action: SuggestionReviewAction;
  proposedChange?: SuggestionProposedChange;
  reviewNote?: string;
  duplicateOf?: string;
  clusterId?: string;
}

export interface ReviewOutcome {
  row: AiSuggestion;
  /** A procedure whose examples changed: embedded after the commit. */
  skill: { id: string; mode: string; examples: string[] } | null;
}

/** What accepting needs from outside the transaction: a snippet's chunks, embedded. */
export interface ReviewDeps {
  author: ConfigChangeAuthor;
  tenant: TenantContext;
  knowledge: KnowledgeService;
  procedureExamples: ProcedureExamples;
  prepared: PreparedChunks | null;
}

/** The proposal an `accept` would write — the body's, else the stored one. */
export async function proposalToAccept(
  tx: TenantClient,
  principal: Principal,
  id: string,
  input: ReviewInput,
): Promise<SuggestionProposedChange | null> {
  if (input.action !== 'accept') return null;
  if (input.proposedChange) return maskedChange(input.proposedChange);
  const row = await reviewableSuggestion(tx, principal, id, false);
  return readProposal(row.proposedChange);
}

function alreadyReviewed(row: AiSuggestion): ApiError {
  return new ApiError('ai_suggestion_state', 'This suggestion was already decided.', {
    details: { reason: 'already_reviewed', status: row.status },
  });
}

export async function reviewSuggestion(
  tx: TenantClient,
  principal: Principal,
  id: string,
  input: ReviewInput,
  deps: ReviewDeps,
): Promise<ReviewOutcome> {
  const row = await reviewableSuggestion(tx, principal, id, true);
  if ((SUGGESTION_CLOSED_STATUSES as readonly string[]).includes(row.status)) {
    throw alreadyReviewed(row);
  }
  const reviewer = principal.kind === 'agent' ? principal.accountId : null;
  const now = new Date();
  const note = input.reviewNote ? maskForWrite(input.reviewNote.trim(), 'agent').text : null;
  const decided = { reviewerId: reviewer, reviewedAt: now, reviewNote: note, updatedAt: now };

  switch (input.action) {
    case 'edit': {
      if (!input.proposedChange)
        throw ApiError.validation('proposed_change: an edit names the proposal.');
      const updated = await tx.aiSuggestion.update({
        where: { id },
        data: {
          proposedChange: maskedChange(input.proposedChange) as unknown as Prisma.InputJsonObject,
          status: 'in_review',
          updatedAt: now,
        },
      });
      return { row: updated, skill: null };
    }
    case 'reject': {
      if (note === null) throw ApiError.validation('review_note: a rejection says why.');
      const updated = await tx.aiSuggestion.update({
        where: { id },
        data: { status: 'rejected', ...decided },
      });
      return { row: updated, skill: null };
    }
    case 'merge': {
      if ((input.duplicateOf === undefined) === (input.clusterId === undefined)) {
        throw ApiError.validation('A merge names either duplicate_of or cluster_id.');
      }
      if (input.duplicateOf !== undefined) {
        if (input.duplicateOf === id)
          throw ApiError.validation('duplicate_of: not the suggestion itself.');
        const target = await tx.aiSuggestion.findFirst({
          where: {
            AND: [
              { id: input.duplicateOf },
              visibleWhere(principal, await reviewReachOf(tx, principal)),
            ],
          },
          select: { id: true },
        });
        if (!target) throw ApiError.notFound('Suggestion to merge into not found.');
      } else {
        const cluster = await tx.aiUnresolvedCluster.findFirst({
          where: { id: input.clusterId, aiAgentId: row.aiAgentId },
          select: { id: true },
        });
        if (!cluster) throw ApiError.notFound('Cluster not found.');
      }
      const updated = await tx.aiSuggestion.update({
        where: { id },
        data: {
          status: 'merged',
          ...(input.duplicateOf !== undefined ? { duplicateOf: input.duplicateOf } : {}),
          ...(input.clusterId !== undefined ? { clusterId: input.clusterId } : {}),
          ...decided,
        },
      });
      return { row: updated, skill: null };
    }
    case 'accept': {
      const change = input.proposedChange
        ? maskedChange(input.proposedChange)
        : readProposal(row.proposedChange);
      if (change === null) {
        throw ApiError.validation(
          'proposed_change: there is nothing to accept yet — write the proposal.',
        );
      }
      const written = await writeToDraft(tx, row, change, deps);
      const updated = await tx.aiSuggestion.update({
        where: { id },
        data: {
          status: 'accepted',
          proposedChange: change as unknown as Prisma.InputJsonObject,
          resultingChangeId: written.changeId,
          ...decided,
        },
      });
      return { row: updated, skill: written.skill };
    }
  }
}

/** The history row the save just wrote for `entityId`, if it changed anything. */
async function lastChangeOf(tx: TenantClient, entityId: string): Promise<string | null> {
  const change = await tx.aiConfigChange.findFirst({
    where: { entityId },
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return change?.id ?? null;
}

async function requireSkill(tx: TenantClient, aiAgentId: string, sourceId: string | null) {
  if (sourceId === null)
    throw ApiError.validation('proposed_change.source_id: name the procedure.');
  const skill = await tx.skill.findFirst({
    where: { id: sourceId, aiAgentId },
    select: {
      id: true,
      mode: true,
      examples: true,
      whenToUse: true,
      locked: true,
      templateKey: true,
    },
  });
  if (!skill) throw ApiError.notFound('Procedure not found.');
  return skill;
}

/** Accepting (AI-23 §4): the proposal into the draft, through `config-draft.ts`. */
async function writeToDraft(
  tx: TenantClient,
  row: AiSuggestion,
  change: SuggestionProposedChange,
  deps: ReviewDeps,
): Promise<{ changeId: string | null; skill: ReviewOutcome['skill'] }> {
  const { author, tenant, knowledge } = deps;
  const actor = author.audit.actorId ?? null;
  switch (change.target) {
    case 'knowledge_snippet': {
      if (deps.prepared === null)
        throw new Error('a knowledge snippet is embedded before its write');
      if (change.source_id !== null) {
        // A correction: the text of a `faq` source of this agent's.
        const source = await tx.knowledgeSource.findFirst({
          where: {
            id: change.source_id,
            type: 'faq',
            retiredAt: null,
            kbArticleId: null,
            sourceTable: null,
            OR: [{ aiAgentIds: { isEmpty: true } }, { aiAgentIds: { has: row.aiAgentId } }],
          },
          select: { id: true },
        });
        if (!source) throw ApiError.notFound('Knowledge snippet not found.');
        await updateKnowledgeSourceDraft(tx, author, source.id, {
          name: change.title,
          content: change.body,
        });
        await knowledge.index(tx, tenant, source.id, deps.prepared);
        return { changeId: await lastChangeOf(tx, source.id), skill: null };
      }
      const agent = { id: row.aiAgentId, kind: 'ai_agent' };
      const source = await createKnowledgeSourceDraft(tx, author, knowledgeScopeOfFiling(agent), {
        licenseId: tenant.licenseId,
        type: 'faq',
        name: change.title,
        content: change.body,
        status: 'indexing',
        addedBy: actor,
      });
      await knowledge.index(tx, tenant, source.id, deps.prepared);
      return { changeId: await lastChangeOf(tx, source.id), skill: null };
    }
    case 'guidance_rule': {
      if (change.title.length > GUIDANCE_TITLE_MAX || change.body.length > GUIDANCE_BODY_MAX) {
        throw ApiError.validation(
          `proposed_change: a behaviour rule's title is at most ${GUIDANCE_TITLE_MAX} characters and its body ${GUIDANCE_BODY_MAX}.`,
        );
      }
      const violation = lockedRuleViolation(change.body);
      if (violation) {
        throw ApiError.validation(violation.explanation, {
          reason: 'guidance_violates_locked_rule',
          locked_rule: violation.locked_rule,
        });
      }
      if (change.source_id !== null) {
        const rule = await tx.aiGuidanceRule.findFirst({
          where: { id: change.source_id, aiAgentId: row.aiAgentId },
          select: { id: true },
        });
        if (!rule) throw ApiError.notFound('Behaviour rule not found.');
        await updateGuidanceRuleDraft(tx, author, rule.id, {
          title: change.title,
          body: change.body,
          updatedBy: actor,
        });
        return { changeId: await lastChangeOf(tx, rule.id), skill: null };
      }
      const held = await tx.aiGuidanceRule.count({ where: { aiAgentId: row.aiAgentId } });
      if (held >= GUIDANCE_RULES_PER_AGENT_MAX) {
        throw ApiError.validation(
          `An AI agent holds at most ${GUIDANCE_RULES_PER_AGENT_MAX} behaviour rules.`,
          { reason: 'guidance_rules_limit', limit: GUIDANCE_RULES_PER_AGENT_MAX },
        );
      }
      const rule = await createGuidanceRuleDraft(tx, author, {
        licenseId: tenant.licenseId,
        aiAgentId: row.aiAgentId,
        title: change.title,
        body: change.body,
        category: 'other',
        scope: { all: true },
        priority: DEFAULT_GUIDANCE_PRIORITY,
        createdBy: actor,
        updatedBy: actor,
      });
      return { changeId: await lastChangeOf(tx, rule.id), skill: null };
    }
    case 'procedure_example': {
      const skill = await requireSkill(tx, row.aiAgentId, change.source_id);
      if (isLockedCopy(skill)) throw templateLocked('given examples');
      const sentence = change.body.replace(/\s+/gu, ' ').trim();
      if (sentence.length > PROCEDURE_EXAMPLE_MAX) {
        throw ApiError.validation(
          `proposed_change.body: an example sentence is at most ${PROCEDURE_EXAMPLE_MAX} characters.`,
        );
      }
      if (
        skill.examples.some((example) => example.trim().toLowerCase() === sentence.toLowerCase())
      ) {
        return { changeId: null, skill: null };
      }
      if (skill.examples.length >= PROCEDURE_EXAMPLES_MAX) {
        throw ApiError.validation(
          `A procedure keeps at most ${PROCEDURE_EXAMPLES_MAX} example sentences.`,
        );
      }
      await deps.procedureExamples.clear(tx, skill.id);
      const updated = await updateSkillDraft(tx, author, skill.id, {
        examples: [...skill.examples, sentence],
      });
      return { changeId: await lastChangeOf(tx, skill.id), skill: updated };
    }
    case 'procedure_note': {
      const skill = await requireSkill(tx, row.aiAgentId, change.source_id);
      const whenToUse = [skill.whenToUse?.trim(), change.body].filter(Boolean).join('\n');
      if (whenToUse.length > PROCEDURE_WHEN_TO_USE_MAX) {
        throw ApiError.validation(
          `proposed_change.body: when_to_use would pass ${PROCEDURE_WHEN_TO_USE_MAX} characters.`,
        );
      }
      await updateSkillDraft(tx, author, skill.id, { whenToUse });
      return { changeId: await lastChangeOf(tx, skill.id), skill: null };
    }
  }
}

// ---------------------------------------------------------------------------
// A test scenario (AI-19)
// ---------------------------------------------------------------------------

export async function suggestionToScenario(
  tx: TenantClient,
  principal: Principal,
  tenant: TenantContext,
  id: string,
  name: string | undefined,
) {
  const row = await reviewableSuggestion(tx, principal, id, false);
  const turns = readExcerpt(row.excerptMasked)
    .filter((message) => message.author_type === 'customer')
    .map((message) => message.text.trim())
    .filter(Boolean);
  if (turns.length === 0) {
    throw ApiError.validation('The suggestion has no player message to play.', {
      problems: [{ field: 'turns', code: 'required' }],
    });
  }
  const expectations: AiTestExpectations = {
    outcome: row.kind === 'should_have_handed_off' ? 'handoff' : 'resolved',
    max_turns: Math.min(AI_TEST_MAX_TURNS_LIMIT, Math.max(1, turns.length)),
  };
  const fields = {
    brand_id: null,
    name: (name ?? `Öneri: ${row.kind}`).trim(),
    mode: 'scripted',
    persona: 'normal',
    language: detectLanguage(turns.join('\n')) ?? 'tr',
    simulated_now: null,
    goal: null,
    turns: maskDeep(turns, 'customer'),
    facts: {},
    tool_outputs: {},
    expectations,
    active: true,
  };
  const problems = validateAiTestScenario(fields);
  if (problems.length > 0) {
    throw ApiError.validation(
      `The scenario was refused: ${problems.map((p) => `${p.field || 'body'} ${p.code}`).join(', ')}.`,
      { problems },
    );
  }
  const account = principal.kind === 'agent' ? principal.accountId : null;
  const now = new Date();
  return tx.aiTestScenario.create({
    data: {
      licenseId: tenant.licenseId,
      aiAgentId: row.aiAgentId,
      origin: 'from_chat',
      originRef: row.id,
      brandId: null,
      name: fields.name,
      mode: fields.mode,
      persona: fields.persona,
      language: fields.language,
      simulatedNow: null,
      goal: null,
      turns: fields.turns,
      facts: {},
      toolOutputs: {},
      expectations: expectations as unknown as Prisma.InputJsonObject,
      active: true,
      createdBy: account,
      updatedBy: account,
      createdAt: now,
      updatedAt: now,
    },
  });
}
