/**
 * The hand-over card, written and announced (tm 304.1 · SiyahTuş analysis
 * AI-10) — `HandoffService`'s {@link HandoffCardWriter}.
 *
 * In the hand-over's own transaction (`write`), so a card is never there
 * without the hand-over:
 *
 *   1. what the card needs that the turn does not carry is read — the player
 *      (their own claim, ID-03), the AI's last messages on the connection,
 *      the player's files, the draft checks' earlier hits, the active risk
 *      flags, the workspace's time zone — and the card is built
 *      (`conversation/handoff/card-builder.ts`, no model);
 *   2. `ai_handoffs` gets the row, keyed by the hand-over's id;
 *   3. the connection's `summary` becomes the card's one line (AI-10 §4 —
 *      Copilot and the search read it as before);
 *   4. the card's text goes into the transcript as an agents-only line
 *      (`system_event: ai_handoff_card`, AI-10 §5): the archive, the search and
 *      an export carry it; the visitor, a webhook and a channel never do.
 *
 * Once committed (`announce`): the line, `thread_summary_set` and
 * `ai_handoff_created` to the agents who see the conversation now — the target
 * team among them — so the person taking it sees the card within a second.
 */
import {
  AI_BOT_ID,
  AI_HANDOFF_CARD_SYSTEM_EVENT,
  AI_HANDOFF_STATEMENT_MAX,
  AI_HANDOFF_STATEMENTS_MAX,
  GUARDRAIL_HIT_ACTIONS,
  type AiHandoffAttachment,
  type AiHandoffCreatedPush,
  type GuardrailHitAction,
  type SlotDef,
  type ThreadSummarySetPush,
} from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { ChatService } from '../chat/chat-service.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { procedureFactsOf, readFactTables, readsTables } from './conversation/facts.js';
import { buildHandoffCard } from './conversation/handoff/card-builder.js';
import { readSnapshot } from './conversation/procedure/executor.js';
import { describeSideEffects } from './conversation/turn.js';
import type { HandoffCardWriter, WrittenHandoffCard } from './handoff-service.js';

/** How many of the player's files the card lists, at most. */
const ATTACHMENTS_MAX = 20;

export class HandoffCardService implements HandoffCardWriter {
  constructor(
    private readonly chats: ChatService,
    private readonly publisher: RealtimePublisher,
  ) {}

  async write(
    tx: TenantClient,
    input: Parameters<HandoffCardWriter['write']>[1],
  ): Promise<WrittenHandoffCard> {
    const { tenant, chatId, threadId, handoff, effect, context } = input;
    const result = context.result;

    const chat = await tx.chat.findUnique({
      where: { id: chatId },
      select: {
        customerId: true,
        brandId: true,
        customer: { select: { name: true, email: true, username: true } },
      },
    });
    // The card's facts (`method.expected_minutes`) from the AI-13 rows of the
    // conversation's brand, as the turn read them (tm 310.3).
    const now = new Date();
    const snapshot = result ? readSnapshot(result.nextState.procedureSnapshot) : null;
    const defs = (snapshot?.procedure.slots ?? []) as SlotDef[];
    const facts = readsTables(defs)
      ? procedureFactsOf(await readFactTables(tx, { brandId: chat?.brandId ?? null, now }), defs)
      : undefined;
    const [boundary, statements, opening, files, hits, flags, conversation] = await Promise.all([
      readDayBoundary(tx),
      tx.event.findMany({
        where: {
          threadId,
          authorType: 'bot',
          authorId: AI_BOT_ID,
          type: 'message',
          recipients: 'all',
        },
        orderBy: { createdAt: 'desc' },
        take: AI_HANDOFF_STATEMENTS_MAX,
        select: { id: true, text: true, createdAt: true },
      }),
      tx.event.findFirst({
        where: { threadId, authorType: 'customer', type: 'message' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      }),
      tx.event.findMany({
        where: { threadId, authorType: 'customer', attachmentUrl: { not: null } },
        orderBy: { createdAt: 'asc' },
        take: ATTACHMENTS_MAX,
        select: { id: true, properties: true, createdAt: true },
      }),
      tx.aiGuardrailHit.findMany({
        where: { threadId, stage: 'output' },
        select: { actionTaken: true },
      }),
      chat
        ? tx.riskFlag.findMany({
            where: {
              status: 'active',
              OR: [{ chatId }, { customerId: chat.customerId, scope: 'member' }],
            },
            select: { type: true },
          })
        : Promise.resolve([]),
      tx.aiConversation.findFirst({
        where: { threadId },
        select: { id: true, configVersionId: true },
      }),
    ]);

    const card = buildHandoffCard({
      reasonCodes: handoff.reasonCodes,
      primaryReason: handoff.primaryReason,
      priority: handoff.priority,
      targetGroupId: effect.groupId ?? null,
      state: result?.nextState ?? null,
      decisions: result?.decisions ?? null,
      player: {
        username: chat?.customer.username ?? null,
        name: chat?.customer.name ?? null,
        email: chat?.customer.email ?? null,
      },
      trust: context.trust,
      firstMessage: opening?.text ?? null,
      turnText: context.turnText,
      turnSummary: result ? describeSideEffects(result.sideEffects).summary : null,
      statements: statements
        .filter((event) => event.text)
        .reverse()
        .map((event) => ({
          event_id: event.id,
          text: clip(event.text as string, AI_HANDOFF_STATEMENT_MAX),
          created_at: event.createdAt.toISOString(),
        })),
      earlierOutputActions: hits
        .map((hit) => hit.actionTaken)
        .filter((action): action is GuardrailHitAction =>
          (GUARDRAIL_HIT_ACTIONS as readonly string[]).includes(action),
        ),
      storedRiskFlags: flags.map((flag) => flag.type),
      attachments: files.map((file) => attachmentOf(file)),
      now,
      timeZone: boundary.timezone,
      ...(facts ? { facts } : {}),
    });

    await tx.aiHandoff.create({
      data: {
        id: handoff.handoffId,
        licenseId: tenant.licenseId,
        chatId,
        threadId,
        aiConversationId: conversation?.id ?? null,
        skillId: card.skillId,
        procedureKey: card.procedureKey,
        procedureSnapshotHash: card.procedureSnapshotHash,
        intentLabel: card.topic,
        summary: card.summary,
        question: card.question,
        player: { ...card.player },
        reasonCodes: card.reasonCodes,
        primaryReason: card.primaryReason,
        slotsSnapshot: card.slots.map((line) => ({ ...line })),
        decisionFacts: card.decisionFacts.map((fact) => ({ ...fact })),
        checks: card.checks,
        aiStatements: card.aiStatements.map((statement) => ({ ...statement })),
        outputCheckFlags: card.outputCheckFlags,
        riskFlags: card.riskFlags,
        sentiment: card.sentiment,
        suggestedNextStep: card.suggestedNextStep,
        attachments: card.attachments.map((attachment) => ({ ...attachment })),
        targetGroupId: card.targetGroupId === null ? null : BigInt(card.targetGroupId),
        priority: card.priority,
        requestedVia: context.requestedVia ?? null,
        cardText: card.cardText,
        configVersionId: conversation?.configVersionId ?? null,
      },
    });
    // The card's line replaces the summary a turn wrote (AI-10 §4).
    await tx.thread.updateMany({
      where: { id: threadId, chatId },
      data: { summary: card.summary, summaryUpdatedAt: new Date() },
    });
    const note = await this.chats.appendAgentsNote(
      tx,
      tenant,
      { chatId, threadId },
      {
        text: card.noteText,
        properties: {
          system_event: AI_HANDOFF_CARD_SYSTEM_EVENT,
          ai_handoff_id: handoff.handoffId,
        },
      },
    );
    return {
      handoffId: handoff.handoffId,
      chatId,
      threadId,
      summary: card.summary,
      primaryReason: card.primaryReason,
      priority: card.priority,
      targetGroupId: card.targetGroupId,
      note,
    };
  }

  async announce(tenant: TenantContext, written: WrittenHandoffCard): Promise<void> {
    const audience = await this.chats.announceAgentsNote(tenant, written.chatId, written.note);
    if (!audience) return;
    const to = {
      groupIds: [
        ...new Set([
          ...audience.groupIds,
          ...(written.targetGroupId !== null ? [written.targetGroupId] : []),
        ]),
      ],
      agentIds: audience.agentIds,
    };
    await this.publisher.publish(tenant, 'thread_summary_set', to, {
      chat_id: written.chatId,
      thread_id: written.threadId,
      summary: written.summary,
    } satisfies ThreadSummarySetPush);
    await this.publisher.publish(tenant, 'ai_handoff_created', to, {
      chat_id: written.chatId,
      thread_id: written.threadId,
      handoff_id: written.handoffId,
      primary_reason: written.primaryReason,
      priority: written.priority,
      target_group_id: written.targetGroupId,
    } satisfies AiHandoffCreatedPush);
  }
}

/** A file event as the card lists it: its id, its name when the upload kept one. */
function attachmentOf(file: {
  id: string;
  properties: unknown;
  createdAt: Date;
}): AiHandoffAttachment {
  const properties =
    typeof file.properties === 'object' && file.properties !== null
      ? (file.properties as Record<string, unknown>)
      : {};
  const name = [properties['name'], properties['file_name'], properties['filename']].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  return { event_id: file.id, name: name ?? null, created_at: file.createdAt.toISOString() };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
