/**
 * The write points of the AI's outcome rows (tm 320.1 · SiyahTuş analysis
 * AI-25 · `@siyahtus/types` `ai-outcomes.ts`): one `ai_conversation_outcomes`
 * row per connection the AI took part in, written as the conversation goes.
 *
 *   - **A turn** ({@link recordOutcomeTurn}, the live adapter): opens the row
 *     on the AI's first turn, then counts the turns and keeps the topic, the
 *     required slots, what the AI claimed and what the player answered. The
 *     widget's "is it solved?" buttons write through it too.
 *   - **A hand-over** ({@link recordOutcomeHandoff}, `HandoffService`): in
 *     the hand-over's transaction — the moment, the primary reason, the
 *     compliance rule that forced it.
 *   - **A person's first message** ({@link recordFirstHumanReply}, `ChatService`).
 *   - **A rating** ({@link ratingSubjectOf}, {@link recordOutcomeRating}).
 *   - **The card's verdict** ({@link recordHandoffCardFeedback}).
 *   - **The close** ({@link settleOutcomeAtClose}, `ChatService`'s close cascade).
 *   - **A risk flag** ({@link recordOutcomeFlag}) and **a QA review**
 *     ({@link recordOutcomeQa}).
 *
 * Every write is one statement keyed by the connection, so the order the
 * write points arrive in does not matter: the turn and the hand-over upsert
 * (a guardrail can hand over on the first message, before any turn row), the
 * others update a row that is there or do nothing. The identity a row was
 * opened with is filled once — a later write never overwrites a value.
 *
 * It lives outside `services/ai` on purpose: the close and the first-reply
 * paths are `ChatService`'s, which the rule bot shares, and the rule bot
 * reaches no module of the AI service (`bots/rule-bot-isolation.test.ts`).
 */
import { Prisma } from '@prisma/client';
import {
  AI_HANDOFF_CARD_MISSING_ITEM_MAX,
  AI_HANDOFF_CARD_MISSING_MAX,
  AI_OUTCOME_GUARDRAIL_HITS_MAX,
  QA_MANDATORY_HANDOFF_CRITERION,
  mandatoryHandoffRule,
  outcomeAtClose,
  qaResultOf,
  type AiHandoffFeedback,
  type AiOutcome,
  type AiOutcomeConfirmation,
  type AiOutcomeGuardrailHit,
  type IdentityTrust,
  type RatingSubject,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** The connection a row is for. */
export interface OutcomeConnection {
  readonly licenseId: bigint;
  /** The day container (panel "Thread ID"). */
  readonly chatId: string;
  /** The connection (panel "Chat ID"). */
  readonly threadId: string;
}

/**
 * The member the repeat-contact search follows (ID-03, K4): the customer,
 * when the visitor carried a member token or a session this workspace signed;
 * null for a bare claim, which the 72-hour search cannot trust.
 */
export function outcomeMemberKey(customerId: string, trust: IdentityTrust | null): string | null {
  return trust === 'verified' || trust === 'session' ? customerId : null;
}

/** One AI turn's contribution to its connection's row. */
export interface OutcomeTurn {
  readonly at: Date;
  readonly memberKey: string | null;
  readonly aiAgentId: string | null;
  readonly configVersionId: string | null;
  readonly language: string | null;
  /** The topic: the procedure the turn ran or the understanding named (its key). */
  readonly intent: string | null;
  readonly procedureId: string | null;
  /** 1 when the AI wrote to the player; 0 for a write with no turn (the widget's buttons). */
  readonly aiTurns: number;
  /** The player's messages the turn answered. */
  readonly playerTurns: number;
  /** 1 when the reply asked for a required detail still missing (a `collect`). */
  readonly clarificationTurns: number;
  /** The active procedure's required slots and how many are known; null without one. */
  readonly requiredSlots: { readonly total: number; readonly filled: number } | null;
  /** The AI said the matter is solved (K9). */
  readonly claimedResolved: boolean;
  /** The player's answer to "is it solved?" on this turn, if they gave one. */
  readonly confirmation: AiOutcomeConfirmation | null;
  readonly guardrailHits: readonly AiOutcomeGuardrailHit[];
}

/** The risk flags raised on a connection, as the row keeps them. */
const threadFlags = (threadId: string): Prisma.Sql => Prisma.sql`
  ARRAY(SELECT DISTINCT rf.type FROM risk_flags rf WHERE rf.thread_id = ${threadId} ORDER BY 1)`;

/**
 * A turn: open the row, or add to it. The counts add up, the topic and the
 * slots take the turn's when it has them, a claim of "solved" stays claimed,
 * the player's newest answer stands, and a "yes" makes an unsettled row
 * `confirmed_resolved` — a hand-over that came first keeps `handed_off`.
 */
export async function recordOutcomeTurn(
  tx: TenantClient,
  connection: OutcomeConnection,
  turn: OutcomeTurn,
): Promise<void> {
  const hits = JSON.stringify(turn.guardrailHits.slice(0, AI_OUTCOME_GUARDRAIL_HITS_MAX));
  const confirmedAt = turn.confirmation === null ? null : turn.at;
  await tx.$executeRaw`
    INSERT INTO ai_conversation_outcomes AS o (
      license_id, chat_id, thread_id, member_key, brand_id, team_id, ai_agent_id,
      config_version_id, language, intent, procedure_id, started_at, ai_turns, player_turns,
      clarification_turns, required_slots_total, required_slots_filled, ai_claimed_resolved,
      resolution_confirmation, confirmed_at, outcome, guardrail_hits, flags)
    SELECT ${connection.licenseId}, ${connection.chatId}, ${connection.threadId}, ${turn.memberKey},
           c.brand_id, t.group_id, ${turn.aiAgentId}::uuid, ${turn.configVersionId}::uuid,
           ${turn.language}, ${turn.intent}, ${turn.procedureId}::uuid, ${turn.at},
           ${turn.aiTurns}::int, ${turn.playerTurns}::int, ${turn.clarificationTurns}::int,
           ${turn.requiredSlots?.total ?? null}::int, ${turn.requiredSlots?.filled ?? null}::int,
           ${turn.claimedResolved}, ${turn.confirmation}, ${confirmedAt}::timestamptz,
           CASE WHEN ${turn.confirmation}::text = 'yes' THEN 'confirmed_resolved' END,
           ${hits}::jsonb, ${threadFlags(connection.threadId)}
      FROM threads t JOIN chats c ON c.id = t.chat_id
     WHERE t.id = ${connection.threadId} AND t.chat_id = ${connection.chatId}
    ON CONFLICT (license_id, thread_id) DO UPDATE SET
      member_key = coalesce(o.member_key, EXCLUDED.member_key),
      brand_id = coalesce(o.brand_id, EXCLUDED.brand_id),
      team_id = coalesce(EXCLUDED.team_id, o.team_id),
      ai_agent_id = coalesce(o.ai_agent_id, EXCLUDED.ai_agent_id),
      config_version_id = coalesce(o.config_version_id, EXCLUDED.config_version_id),
      language = coalesce(EXCLUDED.language, o.language),
      intent = coalesce(EXCLUDED.intent, o.intent),
      procedure_id = coalesce(EXCLUDED.procedure_id, o.procedure_id),
      ai_turns = o.ai_turns + EXCLUDED.ai_turns,
      player_turns = o.player_turns + EXCLUDED.player_turns,
      clarification_turns = o.clarification_turns + EXCLUDED.clarification_turns,
      required_slots_total = coalesce(EXCLUDED.required_slots_total, o.required_slots_total),
      required_slots_filled = CASE WHEN EXCLUDED.required_slots_total IS NULL
                                   THEN o.required_slots_filled
                                   ELSE EXCLUDED.required_slots_filled END,
      ai_claimed_resolved = o.ai_claimed_resolved OR EXCLUDED.ai_claimed_resolved,
      resolution_confirmation = coalesce(EXCLUDED.resolution_confirmation, o.resolution_confirmation),
      confirmed_at = CASE WHEN EXCLUDED.resolution_confirmation IS NULL
                          THEN o.confirmed_at ELSE EXCLUDED.confirmed_at END,
      outcome = CASE WHEN EXCLUDED.resolution_confirmation = 'yes' AND o.outcome IS NULL
                     THEN 'confirmed_resolved' ELSE o.outcome END,
      guardrail_hits = (
        SELECT coalesce(jsonb_agg(h.e ORDER BY h.n), '[]'::jsonb)
          FROM (SELECT e, n FROM jsonb_array_elements(o.guardrail_hits || EXCLUDED.guardrail_hits)
                  WITH ORDINALITY AS x(e, n)
                 ORDER BY n LIMIT ${AI_OUTCOME_GUARDRAIL_HITS_MAX}::int) h),
      flags = ARRAY(SELECT DISTINCT f FROM unnest(o.flags || EXCLUDED.flags) AS f ORDER BY 1),
      updated_at = now()`;
}

/** A hand-over, as its transaction writes it. */
export interface OutcomeHandoff {
  readonly at: Date;
  /** Catalogue codes, most severe first; the first is the primary reason. */
  readonly reasons: readonly string[];
  readonly primaryReason: string;
  readonly memberKey: string | null;
}

/**
 * A hand-over (AI-09): the row is `handed_off` from here on, with the first
 * hand-over's moment and reason — the wait for a person is measured from it —
 * and the compliance rule of any hand-over that had one.
 */
export async function recordOutcomeHandoff(
  tx: TenantClient,
  connection: OutcomeConnection,
  handoff: OutcomeHandoff,
): Promise<void> {
  const rule = mandatoryHandoffRule(handoff.reasons);
  await tx.$executeRaw`
    INSERT INTO ai_conversation_outcomes AS o (
      license_id, chat_id, thread_id, member_key, brand_id, team_id, started_at, outcome,
      handoff_at, handoff_reason, handoff_mandatory_rule, flags)
    SELECT ${connection.licenseId}, ${connection.chatId}, ${connection.threadId}, ${handoff.memberKey},
           c.brand_id, t.group_id, ${handoff.at}, 'handed_off', ${handoff.at},
           ${handoff.primaryReason}, ${rule}, ${threadFlags(connection.threadId)}
      FROM threads t JOIN chats c ON c.id = t.chat_id
     WHERE t.id = ${connection.threadId} AND t.chat_id = ${connection.chatId}
    ON CONFLICT (license_id, thread_id) DO UPDATE SET
      member_key = coalesce(o.member_key, EXCLUDED.member_key),
      outcome = 'handed_off',
      handoff_at = coalesce(o.handoff_at, EXCLUDED.handoff_at),
      handoff_reason = CASE WHEN o.handoff_at IS NULL THEN EXCLUDED.handoff_reason
                            ELSE o.handoff_reason END,
      handoff_mandatory_rule = coalesce(o.handoff_mandatory_rule, EXCLUDED.handoff_mandatory_rule),
      flags = ARRAY(SELECT DISTINCT f FROM unnest(o.flags || EXCLUDED.flags) AS f ORDER BY 1),
      updated_at = now()`;
}

/** A person's first message to the player on the connection (once). */
export async function recordFirstHumanReply(
  tx: TenantClient,
  threadId: string,
  at: Date,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE ai_conversation_outcomes
       SET first_human_reply_at = ${at}, updated_at = now()
     WHERE thread_id = ${threadId} AND first_human_reply_at IS NULL`;
}

/**
 * Whom a rating on the connection judges: `human` once a person has written
 * to the player on it, `ai` before (AI-25 "Ek kaynaklar").
 */
export async function ratingSubjectOf(tx: TenantClient, threadId: string): Promise<RatingSubject> {
  const [row] = await tx.$queryRaw<Array<{ human: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM events
       WHERE thread_id = ${threadId} AND author_type = 'agent'
         AND type = 'message' AND recipients = 'all'
    ) AS human`;
  return row?.human ? 'human' : 'ai';
}

/**
 * A rating: BSAT when the AI carried the connection alone — no hand-over and
 * no person — and the person's CSAT otherwise (AI-25-S2). The newest stands.
 */
export async function recordOutcomeRating(
  tx: TenantClient,
  threadId: string,
  subject: RatingSubject,
  value: 'good' | 'bad',
): Promise<void> {
  await tx.$executeRaw`
    UPDATE ai_conversation_outcomes
       SET bsat = CASE WHEN ${subject}::text = 'ai' AND handoff_at IS NULL THEN ${value} ELSE bsat END,
           csat_after_handoff = CASE WHEN ${subject}::text = 'ai' AND handoff_at IS NULL
                                     THEN csat_after_handoff ELSE ${value} END,
           updated_at = now()
     WHERE thread_id = ${threadId}`;
}

/** An agent's verdict on the hand-over card (AI-10 §7): the last click's stands. */
export async function recordHandoffCardFeedback(
  tx: TenantClient,
  threadId: string,
  feedback: {
    readonly value: AiHandoffFeedback;
    readonly missing: readonly string[];
    readonly reasked: boolean | null;
  },
): Promise<void> {
  const missing = [
    ...new Set(feedback.missing.map((m) => m.trim().slice(0, AI_HANDOFF_CARD_MISSING_ITEM_MAX))),
  ]
    .filter(Boolean)
    .slice(0, AI_HANDOFF_CARD_MISSING_MAX);
  await tx.$executeRaw`
    UPDATE ai_conversation_outcomes
       SET handoff_card_rating = ${feedback.value},
           handoff_card_missing = ${missing}::text[],
           agent_reasked = ${feedback.reasked},
           updated_at = now()
     WHERE thread_id = ${threadId}`;
}

/**
 * The close, in its transaction and after `settleDailyDigest` has settled the
 * AI's own view (`ai_conversations.outcome`): the row ends, takes the team
 * the connection ended with, and is settled by {@link outcomeAtClose} — an
 * unsettled one with no hand-over and no answer waits as `assumed_pending`.
 * A connection the AI never took part in has no row and nothing to settle.
 */
export async function settleOutcomeAtClose(
  tx: TenantClient,
  threadId: string,
  closedAt: Date,
): Promise<AiOutcome | null> {
  const [row] = await tx.$queryRaw<
    Array<{
      id: string;
      outcome: AiOutcome | null;
      confirmation: AiOutcomeConfirmation | null;
      ai_mode: string | null;
      conversation_outcome: string | null;
    }>
  >`
    SELECT o.id, o.outcome, o.resolution_confirmation AS confirmation, t.ai_mode,
           (SELECT ac.outcome FROM ai_conversations ac WHERE ac.thread_id = o.thread_id LIMIT 1)
             AS conversation_outcome
      FROM ai_conversation_outcomes o
      JOIN threads t ON t.id = o.thread_id
     WHERE o.thread_id = ${threadId}
       FOR UPDATE OF o`;
  if (!row) return null;
  const outcome = outcomeAtClose({
    outcome: row.outcome,
    aiMode: row.ai_mode,
    conversationOutcome: row.conversation_outcome,
    confirmation: row.confirmation,
  });
  await tx.$executeRaw`
    UPDATE ai_conversation_outcomes o
       SET outcome = ${outcome},
           ended_at = coalesce(o.ended_at, ${closedAt}),
           team_id = coalesce((SELECT t.group_id FROM threads t WHERE t.id = o.thread_id), o.team_id),
           flags = ARRAY(SELECT DISTINCT f FROM unnest(o.flags || ${threadFlags(threadId)}) AS f ORDER BY 1),
           updated_at = now()
     WHERE o.id = ${row.id}::uuid`;
  return outcome;
}

/** A risk flag raised on the connection (AI-27) — by a turn, an agent or a rule. */
export async function recordOutcomeFlag(
  tx: TenantClient,
  threadId: string,
  type: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE ai_conversation_outcomes
       SET flags = array_append(flags, ${type}), updated_at = now()
     WHERE thread_id = ${threadId} AND NOT (${type} = ANY (flags))`;
}

/**
 * A completed QA review (AI-24): its result, a confirmed guardrail violation
 * (the `guardrails` criterion failed) and a mandatory hand-over violation
 * (`handoff_timing` failed — `QA_MANDATORY_HANDOFF_CRITERION`, §D385).
 */
export async function recordOutcomeQa(
  tx: TenantClient,
  threadId: string,
  review: { readonly final: 'pass' | 'fail'; readonly failed: readonly string[] },
): Promise<void> {
  const result = qaResultOf(review.final, review.failed);
  const violations = review.failed.includes('guardrails') ? 1 : 0;
  const mandatory = review.failed.includes(QA_MANDATORY_HANDOFF_CRITERION);
  await tx.$executeRaw`
    UPDATE ai_conversation_outcomes
       SET qa_result = ${result},
           guardrail_violations_confirmed = ${violations}::int,
           mandatory_handoff_violation = ${mandatory},
           updated_at = now()
     WHERE thread_id = ${threadId}`;
}
