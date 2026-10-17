/**
 * The live adapter between an incoming customer message and the conversation
 * engine (tm 292.2).
 *
 * The engine decides a turn and writes nothing (`conversation/turn.ts`); this
 * is where the turn happens to the real conversation: the reply is sent as
 * the bot, the conversation state is saved, the run is recorded, and the
 * summary, tags and hand-over the turn asked for are applied. A preview shows
 * the same turn and a simulation (AI-19) records it; neither comes through here.
 *
 * Kept out of the route because the ordering here is load-bearing and easy to
 * get wrong: the customer's message must be durable *before* the AI reacts to
 * it, and an AI failure must never lose that message. Everything below runs
 * after the message is committed, and every failure path leaves the
 * conversation exactly as it would have been with no AI at all — which is a
 * working conversation waiting for a human.
 *
 * **One turn commits once (AI-01 §6).** The state is read before the engine
 * runs and the model works outside any transaction; the reply, the saved state
 * and the run row then go in together — in the reply's own transaction when
 * there is a reply. The save is the optimistic lock (`state-store.ts`): if the
 * conversation moved on while the model was thinking — another worker's turn,
 * a person taking it over (AI-11) — the save throws, the reply rolls back with
 * it, and nothing of this turn is applied. Whoever saved first owns the reply.
 *
 * **The turn reads the conversation (tm 292.3 · AI-01).** With the state and
 * the configuration (`AiConfigSource`, ADR-14b §2.6) the same read loads the
 * connection's transcript up to the message being answered
 * (`context-loader.ts`): what came before it is the turn's history, which the
 * model reads; the message itself is still the one the job names. Gathering
 * several unanswered messages into one turn is tm 292.4's.
 *
 * It is not the first thing an incoming message meets. The deterministic rule
 * bot (FR-MOD-06.6, `services/bots/rule-bot-responder.ts`) is tried first and
 * this runs only when no rule took the conversation over; the ordering, and why
 * it is that way round, is written at the one place that decides it —
 * `respondToCustomerMessage` in `routes/customer.ts`.
 *
 * Nor does it run inside the customer's request any more: since tm 256.10
 * it starts after the response has been written, and since tm 289.5 it runs
 * in the durable AI job worker — one message at a time per chat, in whichever
 * process claims the job. It is given a {@link VisitorTurn} built from the
 * job, not the request: its tenant, its logger, a runner over the server's
 * pool, the two gates, and the job's mark and fence for the reply.
 */
import { AI_BOT_ID, parseEventId } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import type { BotPrincipal } from '../auth/principal.js';
import type { ChatService } from '../chat/chat-service.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import { loadConnectionContext, type ConnectionContext } from './conversation/context-loader.js';
import type { ConversationEngine } from './conversation/conversation-engine.js';
import {
  AiConversationConflictError,
  loadConversation,
  openConversation,
  saveConversation,
  type AiConversationState,
  type ConnectionRef,
} from './conversation/state-store.js';
import {
  describeSideEffects,
  emptyTurnState,
  skillRunRecord,
  toTurnState,
  tookTurn,
  turnStatePatch,
  type TurnHistory,
  type TurnResult,
} from './conversation/turn.js';
import { readAndCompile } from './conversation/turn-config.js';
import { type AiDecisionInput, recordAiDecision, skillDecision } from './decision-log.js';
import { AiJobReplyRefusedError, type VisitorTurn } from '../chat/visitor-turn.js';

export class AiResponder {
  readonly #engine: ConversationEngine;

  constructor(
    private readonly chats: ChatService,
    private readonly publisher: RealtimePublisher,
    engine: ConversationEngine,
  ) {
    this.#engine = engine;
  }

  /**
   * Take the AI's turn on a visitor message and apply it.
   *
   * Returns the turn for tests and callers that care; the route does not,
   * because there is nothing useful it could do differently.
   *
   * Every turn the AI takes leaves one decision record (tm 288.2 · ID-08) —
   * after the turn is applied, so the record names the reply it wrote. A
   * message no skill matched is not a turn and leaves none; nor does a turn
   * that lost the conversation to another writer, whose own turn is the one on
   * record. A record that cannot be written is one log line, never a lost reply.
   */
  async handle(turn: VisitorTurn, message: string): Promise<TurnResult | null> {
    const { tenant, chatId, log } = turn;
    const ids = {
      chatId,
      threadId: turn.threadId,
      customerId: turn.customerId,
      requestId: turn.requestId,
      triggerEventId: turn.triggerEventId,
    };
    const record = (input: Omit<AiDecisionInput, keyof typeof ids>): Promise<string | null> =>
      recordAiDecision(turn.withTenant, tenant, { ...ids, ...input }, log);

    // Residency, before the message reaches the engine (NFR-C4 · C4-e). This is
    // the one AI surface a *customer* triggers, and the content is the message
    // they just typed, so it is the surface the constraint exists for. The check
    // cannot be declared on the route — the route is "send a message", which
    // must keep working — so it is asked for here, and a refusal leaves the
    // conversation exactly as an unconfigured AI would: stored, untouched, and
    // waiting for a human.
    try {
      await turn.requireAiInference();
    } catch (error) {
      log.warn(
        { err: error },
        'ai inference refused for this workspace; leaving the message for a human',
      );
      return null;
    }

    // The daily AI caps (tm 257.8), before the question is embedded: this is
    // the surface strangers drive — a visitor on any page that carries the
    // widget — so a workspace that has used today's allowance spends nothing
    // more on it. The refusal leaves the message for a human, like the check
    // above; its one log line was written where the cap decided it
    // (`ai-daily-budget.ts`), so nothing more is logged for it here. A cap that
    // could not be read (Postgres away) is not a cap that let the call through:
    // the message waits for a human too.
    try {
      await turn.requireAiBudget();
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        // The allowance refused the turn before any skill was looked at — still
        // a turn the AI did not take, and the one the cap's report counts.
        await record({ decision: 'cap_reached', details: { cap_scope: error.scope } });
      } else {
        log.error(
          { err: error },
          'daily AI cap could not be checked; leaving the message for a human',
        );
      }
      return null;
    }

    const ref: ConnectionRef = { chatId, threadId: turn.threadId };
    const startedAt = performance.now();
    let read: AiConversationState | null = null;
    let result: TurnResult | null = null;
    let replyEventId: string | null = null;
    let applyFailed = false;
    let unrecorded = false;
    try {
      // Where the conversation stands, what the AI may run and what was said
      // before this message, read together; then the turn, over a runner
      // rather than one transaction around it — the engine opens a short one
      // per read so the model call waits in none.
      const answering = parseEventId(turn.triggerEventId);
      const loaded = await turn.withTenant(async (tx) => {
        const conversation = await loadConversation(tx, ref);
        const state = conversation ? toTurnState(conversation) : emptyTurnState();
        const config = await readAndCompile.forTurn(tx, {
          aiAgentId: null,
          pinnedVersionId: conversation?.configVersionId ?? null,
        });
        // Everything before the message is history; the message is the turn's.
        const context =
          answering && answering.threadId === ref.threadId
            ? await loadConnectionContext(tx, ref, state, {
                through: answering.sequence,
                processedThrough: answering.sequence - 1,
              })
            : null;
        return { conversation, state, config, context };
      });
      read = loaded.conversation;
      const history = historyOf(loaded.context);
      result = await this.#engine.runTurn(
        loaded.state,
        { text: message, ...(history ? { history } : {}) },
        {
          tenant,
          db: turn.withTenant,
          now: new Date(),
          mode: 'live',
          chatId,
          configVersionId: read?.configVersionId ?? loaded.config.versionId,
          config: loaded.config.pkg,
          toolStubs: {},
        },
      );
      const { decisions } = result;
      if (decisions.failure) {
        // The provider's own lines (component `llm` or `embedding`) carry the
        // status and the code but not the conversation; this one, on the
        // turn's logger, ties the failure to the chat a human now has to
        // answer (tm 255.6), and says which provider it was (tm 255.7). The
        // customer's outcome is the same for every failure, so this line is
        // where one is told from another (tm 255.9): transient or not, and the
        // provider's own status, code and request id — never its words.
        const { provider, kind, transient, status, code, requestId, reason } = decisions.failure;
        log.warn(
          {
            skill_id: decisions.skillId,
            provider,
            kind,
            transient,
            ...(status !== null ? { status } : {}),
            ...(code !== null ? { code } : {}),
            ...(requestId !== null ? { provider_request_id: requestId } : {}),
            ...(reason !== null ? { reason } : {}),
          },
          decisions.failure.provider === 'llm'
            ? 'ai model could not answer; the conversation stays with a human'
            : 'ai knowledge search could not run; the conversation stays with a human',
        );
      }
      if (!tookTurn(result)) return result;

      replyEventId = await this.#commit(turn, ref, read, result);

      // A turn that did nothing to the conversation leaves it as it was: what
      // its steps queued for a reply that never came is not applied.
      if (decisions.outcome === 'skipped') return result;

      const { summary, tags, transferTo } = describeSideEffects(result.sideEffects);
      if (summary) {
        await turn.withTenant((tx) =>
          tx.thread.updateMany({
            where: { chatId, active: true },
            data: { summary, summaryUpdatedAt: new Date() },
          }),
        );
      }

      for (const tag of tags) {
        await this.chats
          .tagThread(tenant, botPrincipal(tenant), chatId, tag)
          // A tag that cannot be applied is not worth abandoning the reply for.
          .catch((error: unknown) => log.warn({ err: error, tag }, 'skill could not apply tag'));
      }

      if (transferTo) {
        await this.#transfer(turn, transferTo);
      }

      return result;
    } catch (error) {
      // Not a failure: this job may not answer the message — it has its
      // answer, or another claim holds the job and records its own turn. The
      // worker decides what that means.
      if (error instanceof AiJobReplyRefusedError) {
        unrecorded = true;
        throw error;
      }
      // Not a failure either: the conversation moved on while the model was
      // thinking, and the writer that moved it owns what happens next. Nothing
      // of this turn was sent or saved; another attempt would answer a
      // conversation that is no longer the one it read.
      if (error instanceof AiConversationConflictError) {
        unrecorded = true;
        log.info(
          { conversation_id: error.conversationId, expected_version: error.expectedVersion },
          'ai turn lost the conversation to another writer; nothing was sent',
        );
        return null;
      }
      // The customer's message is already stored. Whatever went wrong here, the
      // conversation is intact and a human will pick it up — which is exactly
      // what would have happened without any AI.
      log.error({ err: error }, 'ai turn failed');
      applyFailed = result !== null;
      return null;
    } finally {
      // Recorded once the turn is applied (or failed to apply), so the row can
      // name the reply it wrote. An engine that threw before deciding anything
      // leaves no result and no row — its log line above is the record.
      const decided = result && !unrecorded ? skillDecision(result) : null;
      if (decided) {
        await record({
          ...decided,
          replyEventId,
          latencyMs: performance.now() - startedAt,
          // The configuration the turn ran on (ADR-14b §2.7) — null until tm 316.
          configVersionId: read?.configVersionId ?? null,
          ...(applyFailed ? { errorType: decided.errorType ?? 'apply_failed' } : {}),
        });
      }
    }
  }

  /**
   * The turn's one commit: the reply (if any), the conversation state and the
   * run row, in one transaction. Returns the reply's event id.
   *
   * The state is saved against the version the turn read — or, when the
   * connection had no conversation yet, against the row as it was opened
   * (version 0): a row another writer opened *and* wrote in the meantime is a
   * lost race too. Throws {@link AiConversationConflictError} when the race
   * was lost, which rolls the reply back with it.
   */
  async #commit(
    turn: VisitorTurn,
    ref: ConnectionRef,
    read: AiConversationState | null,
    result: TurnResult,
  ): Promise<string | null> {
    const { tenant, chatId } = turn;
    const patch = turnStatePatch(read ? toTurnState(read) : emptyTurnState(), result.nextState);
    const run = skillRunRecord(result.decisions);

    // Through `tx` and nowhere else: as the reply's outbox it runs again on
    // the send's race retry, whose first attempt rolled back with it.
    const write = async (tx: TenantClient): Promise<void> => {
      const current = read ?? {
        id: (await openConversation(tx, ref, { configVersionId: null })).id,
        version: 0,
      };
      if (Object.keys(patch).length > 0) await saveConversation(tx, current, patch);
      if (run) {
        await tx.skillRun.create({
          data: {
            skillId: run.skillId,
            chatId,
            // The connection beside the day container (tm 288.2 · ID-08).
            threadId: ref.threadId,
            licenseId: tenant.licenseId,
            status: run.status,
            log: run.log as unknown as object,
            llmInputTokens: run.llmInputTokens,
            llmOutputTokens: run.llmOutputTokens,
            embeddingTokens: run.embeddingTokens,
          },
        });
        // The count an admin sees in the Playbook list. Incremented in the same
        // transaction so it cannot drift from the run log beside it.
        await tx.skill.update({
          where: { id: run.skillId },
          data: { runsCount: { increment: 1 } },
        });
      }
    };

    // Sent as a *bot* principal, which is what makes the event
    // `author_type: 'bot'` rather than `'agent'`. Two things hang off that
    // distinction: ADR-09 counts a thread closing with no agent-authored
    // event as an AI resolution, and Reports' "first response" only starts
    // the clock on a human. Sending this as an agent would quietly stop the
    // workspace being billed for the automation it used, and would report
    // response times no human achieved.
    if (result.reply) {
      const sent = await this.chats.sendEvent(
        tenant,
        botPrincipal(tenant),
        chatId,
        {
          type: 'message',
          text: result.reply,
          recipients: 'all',
          properties: { ...turn.replyProperties },
        },
        {
          // With the job's mark and fence (tm 289.5): a message is answered
          // once. Then the turn's own commit, in the same transaction.
          outbox: async (tx, written) => {
            await turn.replyOutbox(tx, written);
            await write(tx);
          },
        },
      );
      return sent.event.id;
    }

    await turn.withTenant(write);
    return null;
  }

  async #transfer(turn: VisitorTurn, groupName: string): Promise<void> {
    const { tenant, chatId } = turn;

    const group = await turn.withTenant((tx) =>
      tx.group.findFirst({ where: { name: groupName }, select: { id: true } }),
    );

    if (!group) {
      // The skill names a team that no longer exists. Leaving the conversation
      // where it is means a human still sees it; silently dropping it would not.
      turn.log.warn({ group: groupName }, 'skill targets an unknown team');
      return;
    }

    await this.chats.transfer(tenant, botPrincipal(tenant), chatId, {
      groupId: group.id,
      reason: 'ai_handoff',
    });

    await this.publisher.publish(
      tenant,
      'chat_transferred',
      { allAgents: true },
      { chat_id: chatId, reason: 'ai_handoff', transferred_to: { group_ids: [Number(group.id)] } },
    );
  }
}

/**
 * The turn's history, or none when the connection held nothing before the
 * message — a first message reads exactly as it did before there was history.
 */
function historyOf(context: ConnectionContext | null): TurnHistory | null {
  if (!context) return null;
  const { messages, systemNotes, stateDigest, omitted, visitorMessages } = context;
  if (messages.length === 0 && systemNotes.length === 0 && !stateDigest) return null;
  return { messages, systemNotes, stateDigest, omitted, visitorMessages };
}

/**
 * The AI acts as a bot principal, not as an agent.
 *
 * It carries the scopes the engine's own actions need and nothing else, so a
 * skill cannot reach further into the API than the steps it declares.
 */
function botPrincipal(tenant: { licenseId: bigint; organizationId: string }): BotPrincipal {
  return {
    kind: 'bot',
    botId: AI_BOT_ID,
    licenseId: tenant.licenseId,
    organizationId: tenant.organizationId,
    scopes: ['chats--all:rw', 'tags--all:rw'],
    tokenId: AI_BOT_ID,
    tokenKind: 'bot',
  };
}
