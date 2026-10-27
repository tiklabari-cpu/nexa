/**
 * The AI's hand-over card as the API serves it (tm 304.1 · AI-10) — the
 * `ai_handoffs` row read back. Here, on the chat side, because the chat's own
 * read (`GET /chats/{chatId}`, `latest_ai_handoff`) serves it and `ChatService`
 * imports nothing of `services/ai` (the rule bot's closure).
 *
 * What the row was written with is trusted as written — the builder and the
 * CHECKs hold it — but a JSON column read back is still read defensively: an
 * entry that is not what it should be is left out rather than served.
 */
import type { AiHandoff } from '@prisma/client';
import {
  AI_HANDOFF_OUTPUT_FLAGS,
  GUARDRAIL_PRIORITIES,
  isAiHandoffFeedback,
  isHandoffReason,
  type AiHandoffAttachment,
  type AiHandoffCardView,
  type AiHandoffFact,
  type AiHandoffOutputFlag,
  type AiHandoffPlayer,
  type AiHandoffSentiment,
  type AiHandoffSlotLine,
  type AiHandoffStatement,
  type GuardrailPriority,
  type HandoffReason,
} from '@siyahtus/types';
import { maskPlayerContact, redactPlayerContact } from '../customers/player-contact.js';

/**
 * `contactVisible` false (`customers.contact.view` off for the caller, tm
 * 325.6) nulls the player's username and email, and blanks both out of every
 * free-text field of the card: `card_text` was written with them, and the
 * summary, the question, a collected slot, a decision fact, what the AI said
 * and the next step can quote them. No default — every caller decides.
 * `alsoRedact`: further values to blank with them — the player's record as it
 * stands now, for a reader that has it (the player card, tm 331.1): a card
 * written before the player gave either holds none on its own.
 */
export function serialiseAiHandoff(
  row: AiHandoff,
  contactVisible: boolean,
  alsoRedact: ReadonlyArray<string | null> = [],
): AiHandoffCardView {
  const player = playerOf(row.player);
  const needles = [player.username, player.email, ...alsoRedact];
  const text = (value: string) => redactPlayerContact(value, needles, contactVisible);
  const textOrNull = (value: string | null) => (value === null ? null : text(value));
  return {
    id: row.id,
    chat_id: row.chatId,
    thread_id: row.threadId,
    skill_id: row.skillId,
    procedure_key: row.procedureKey,
    procedure_snapshot_hash: row.procedureSnapshotHash,
    topic: row.intentLabel,
    summary: text(row.summary),
    question: textOrNull(row.question),
    player: maskPlayerContact(player, contactVisible),
    slots: arrayOf(row.slotsSnapshot)
      .filter(isSlotLine)
      .map((line) => ({ ...line, text: textOrNull(line.text) })),
    decision_facts: arrayOf(row.decisionFacts)
      .filter(isFact)
      .map((fact) => ({ ...fact, text: textOrNull(fact.text) })),
    checks: arrayOf(row.checks).filter((entry): entry is string => typeof entry === 'string'),
    ai_statements: arrayOf(row.aiStatements)
      .filter(isStatement)
      .map((statement) => ({ ...statement, text: text(statement.text) })),
    output_check_flags: row.outputCheckFlags.filter((flag): flag is AiHandoffOutputFlag =>
      (AI_HANDOFF_OUTPUT_FLAGS as readonly string[]).includes(flag),
    ),
    reason_codes: row.reasonCodes.filter((code): code is HandoffReason => isHandoffReason(code)),
    primary_reason: row.primaryReason as HandoffReason,
    requested_via: row.requestedVia === 'button' ? 'button' : null,
    risk_flags: [...row.riskFlags],
    sentiment: (row.sentiment as AiHandoffSentiment | null) ?? null,
    suggested_next_step: textOrNull(row.suggestedNextStep),
    attachments: arrayOf(row.attachments).filter(isAttachment),
    target_group_id: row.targetGroupId === null ? null : Number(row.targetGroupId),
    priority: (GUARDRAIL_PRIORITIES as readonly string[]).includes(row.priority)
      ? (row.priority as GuardrailPriority)
      : 'normal',
    card_text: text(row.cardText),
    created_at: row.createdAt.toISOString(),
    accepted_by: row.acceptedBy,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    feedback: isAiHandoffFeedback(row.feedback) ? row.feedback : null,
    feedback_reason: row.feedbackReason,
    feedback_by: row.feedbackBy,
    feedback_at: row.feedbackAt?.toISOString() ?? null,
  };
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function playerOf(value: unknown): AiHandoffPlayer {
  const raw = isObject(value) ? value : {};
  return {
    username: stringOrNull(raw['username']),
    name: stringOrNull(raw['name']),
    email: stringOrNull(raw['email']),
    basis: 'declared',
    recognized_device: raw['recognized_device'] === true,
  };
}

function isSlotLine(value: unknown): value is AiHandoffSlotLine {
  return (
    isObject(value) &&
    typeof value['slot'] === 'string' &&
    typeof value['label'] === 'string' &&
    typeof value['status'] === 'string' &&
    (value['text'] === null || typeof value['text'] === 'string')
  );
}

function isFact(value: unknown): value is AiHandoffFact {
  return (
    isObject(value) &&
    typeof value['field'] === 'string' &&
    (value['text'] === null || typeof value['text'] === 'string')
  );
}

function isStatement(value: unknown): value is AiHandoffStatement {
  return (
    isObject(value) &&
    typeof value['event_id'] === 'string' &&
    typeof value['text'] === 'string' &&
    typeof value['created_at'] === 'string'
  );
}

function isAttachment(value: unknown): value is AiHandoffAttachment {
  return (
    isObject(value) &&
    typeof value['event_id'] === 'string' &&
    (value['name'] === null || typeof value['name'] === 'string') &&
    typeof value['created_at'] === 'string'
  );
}
