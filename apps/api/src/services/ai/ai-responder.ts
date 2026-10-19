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
 * **A hand-over happens in one place (tm 303.2 · AI-09 §5).** What the turn
 * hands over for and to whom is the engine's; the card, the move to `human`,
 * the target and the pushes are `HandoffService.execute`'s, and the turn's
 * decision record names the hand-over's id. Today's AI cap refusing the turn
 * on a connection the AI answers is a hand-over too: the player is told so in
 * a fixed sentence (`ai_failure`) — never a silence.
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
 * **The AI answers only a connection that is its own (tm 293.1 · AI-11).** The
 * connection's mode (`threads.ai_mode`, `services/chat/ai-mode.ts`) is the
 * first thing read: once a person has it — an agent wrote to the player, a
 * takeover, a transfer, a rule bot that took it — or the AI is held back, a
 * visitor message costs no model call and leaves no record. It is read again
 * before the model is asked (the batch window may have passed meanwhile) and
 * once more in the commit, under the thread's row lock: a person who wrote
 * while the model was thinking got there first, and the draft rolls back
 * unsent, on record as `expired`. The AI's first commit is what turns a
 * connection nobody had yet into `ai`.
 *
 * **The turn reads the conversation (tm 292.3 · AI-01).** With the state and
 * the configuration (`AiConfigSource`, ADR-14b §2.6) the same read loads the
 * connection's transcript (`context-loader.ts`): what came before the job's
 * message is the turn's history, which the model reads. On the connection's
 * first turn it also loads the summaries of the day's earlier connections
 * (tm 294 · AI-02, `daily-memory.ts`), cut to what the identity the visitor's
 * job carries allows (K4).
 *
 * **One answer to what the visitor said, not one per message (tm 292.4 ·
 * AI-01 §4–§7).** A visitor who writes "hi", "my deposit", "has not arrived"
 * a second apart is asking one question. So the turn:
 *
 *   1. does nothing when its message is answered already — an earlier turn
 *      gathered it (`last_processed_event_seq`), checked before the gates and
 *      again once the turn is ready to read;
 *   2. waits for the visitor to stop typing (`batch-window.ts`;
 *      the agent's `batch_window_seconds`, else `AI_BATCH_WINDOW_MS`) — unless the AI has no skill it could run, when
 *      no turn could come of the wait — then answers its message and every one after it
 *      as one turn, and records the newest as processed — the jobs those
 *      messages set off find nothing left to do (point 1). The chat's jobs run
 *      one at a time (`ai_jobs_claim`), so the next one waits for this;
 *   3. looks once more just before the reply goes out, in the reply's own
 *      transaction: if the visitor wrote again while the model was thinking,
 *      the draft answers a conversation that has moved on, so it is dropped
 *      (its decision record says `expired`) and the turn is taken again with
 *      the new message — once; the second draft goes out whatever arrives.
 *
 * Two engines on one connection — two API copies, or a job whose lease ran out
 * while its model was thinking — both may think; the optimistic lock above
 * lets one of them send.
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
import { randomUUID } from 'node:crypto';
import type { RiskFlag } from '@prisma/client';
import {
  AI_BOT_ID,
  DEFAULT_DAILY_MEMORY,
  parseEventId,
  readNoAnswerSettings,
  readPersona,
  type AiConversationMode,
  type AiNoAnswerSettings,
  type IdentityTrust,
  type RiskFlagType,
  type RiskPolicy,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import type { ChatService } from '../chat/chat-service.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import { awaitBatchWindow } from './conversation/batch-window.js';
import {
  DEFAULT_HISTORY_BUDGET,
  loadConnectionContext,
  SENSITIVE_SHARED_RISK_FLAG,
  newestVisitorEvent,
  type ConnectionContext,
  type HistoryBudget,
} from './conversation/context-loader.js';
import type { ConversationEngine } from './conversation/conversation-engine.js';
import { loadEarlierToday, type EarlierToday } from './conversation/daily-memory.js';
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
  handoffOf,
  skillRunRecord,
  toTurnState,
  tookTurn,
  turnAgentId,
  turnStatePatch,
  turnsTaken,
  type TurnHistory,
  type TurnResult,
  type TurnState,
} from './conversation/turn.js';
import { readAndCompile, type AiConfigRead } from './conversation/turn-config.js';
import {
  afterHoursWords,
  DEFAULT_HANDOFF_CONFIG,
  handoffWords,
} from './conversation/handoff/triggers.js';
import { languageVerdict } from './conversation/policy.js';
import {
  anyoneAccepting,
  botPrincipal,
  HandoffService,
  planHandoff,
  type HandoffCardWriter,
  type PlannedHandoff,
} from './handoff-service.js';
import { type AiDecisionInput, recordAiDecision, skillDecision } from './decision-log.js';
import { recordGuardrailHits } from './guardrail-hits.js';
import { AiJobReplyRefusedError, type VisitorTurn } from '../chat/visitor-turn.js';
import { aiMayAnswer, AiModeChangedError, claimAiTurn, readAiMode } from '../chat/ai-mode.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import { maskDeep } from '../../lib/sensitive-mask.js';
import type { RiskFlagAnnouncer } from '../risk/risk-announce.js';
import { chatRiskPolicy, raiseRiskFlag } from '../risk/risk-flags.js';
import { turnRiskFlagRaises } from './turn-risk-flags.js';

/** How many drafts one turn may write: the first, and one after the visitor wrote again. */
const DRAFTS_PER_TURN = 2;

export interface AiResponderOptions {
  /**
   * How quiet the visitor must have been before the turn starts, in
   * milliseconds (`AI_BATCH_WINDOW_MS`). 0, the default here: no wait. The
   * AI agent's own `batch_window_seconds` takes this one's place when set.
   */
  readonly batchWindowMs?: number;
  /**
   * How much of the conversation a turn carries (`AI_HISTORY_MAX_MESSAGES`,
   * `AI_HISTORY_MAX_CHARS`). {@link DEFAULT_HISTORY_BUDGET} when absent.
   */
  readonly historyBudget?: HistoryBudget;
  /**
   * Announces the risk flags a turn raises once its hand-over committed (tm
   * 302.2 · AI-27: push, webhook, urgent mail). Absent: written, not announced.
   */
  readonly riskFlags?: RiskFlagAnnouncer;
  /** The hand-over card's writer (AI-10, #304) — none until then. */
  readonly handoffCard?: HandoffCardWriter;
}

/**
 * Thrown in the reply's transaction when the visitor wrote again after the
 * turn read the conversation (AI-01 §7): the reply rolls back and the turn is
 * taken again.
 */
class VisitorWroteAgainError extends Error {
  constructor(readonly newestSequence: number) {
    super('the visitor wrote again before the reply went out');
    this.name = 'VisitorWroteAgainError';
  }
}

export class AiResponder {
  readonly #engine: ConversationEngine;
  readonly #batchWindowMs: number;
  readonly #historyBudget: HistoryBudget;
  readonly #riskFlags: RiskFlagAnnouncer | null;
  readonly #handoffs: HandoffService;

  constructor(
    private readonly chats: ChatService,
    private readonly publisher: RealtimePublisher,
    engine: ConversationEngine,
    options: AiResponderOptions = {},
  ) {
    this.#engine = engine;
    this.#batchWindowMs = options.batchWindowMs ?? 0;
    this.#historyBudget = options.historyBudget ?? DEFAULT_HISTORY_BUDGET;
    this.#riskFlags = options.riskFlags ?? null;
    this.#handoffs = new HandoffService(
      chats,
      publisher,
      options.handoffCard ? { card: options.handoffCard } : {},
    );
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
   * record, nor a message an earlier turn answered. A draft dropped because the
   * visitor wrote again leaves an `expired` record of its own. A record that
   * cannot be written is one log line, never a lost reply.
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
    const ref: ConnectionRef = { chatId, threadId: turn.threadId };
    // The message's place on its connection. A job's message is always on the
    // job's connection; one that is not is answered alone, as it always was.
    const answering = parseEventId(turn.triggerEventId);
    const trigger = answering && answering.threadId === ref.threadId ? answering.sequence : null;

    // Whose the connection is, first of all (AI-11 · tm 293.1): one a person
    // has — or where the AI is held back — costs no model call and no record.
    // Then answered already (AI-01 §5): an earlier turn gathered this message
    // with the one its job was for. Both asked before the gates, which would
    // otherwise record a refusal for a message nobody is waiting on.
    let runnable = true;
    let batchWindowMs = this.#batchWindowMs;
    /** Set when today's cap refusing the turn hands it over (the AI's connection). */
    let capConfig: AiConfigRead | null = null;
    try {
      const lookout = await this.#lookout(turn, ref);
      if (!lookout) {
        log.info({}, 'a person has this conversation; the ai stays silent');
        return null;
      }
      if (trigger !== null) {
        if (lookout.answeredThrough >= trigger) {
          log.info({}, 'an earlier ai turn answered this message; nothing to do');
          return null;
        }
        runnable = lookout.runnable;
        if (runnable && lookout.aiMode === 'ai') capConfig = lookout.config;
        // The agent's own window, when it set one, in place of the workspace's.
        if (lookout.batchWindowSeconds !== null) batchWindowMs = lookout.batchWindowSeconds * 1000;
      }
    } catch (error) {
      // Whatever went wrong, the message is stored and a human will see it.
      log.error({ err: error }, 'ai turn failed');
      return null;
    }

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
        // a turn the AI did not take, and the one the cap's report counts. On a
        // connection that is the AI's the player is told and a person sent
        // (AI-09 `ai_failure`, tm 303.2); elsewhere routing's person has it.
        const handedOver = capConfig
          ? await this.#capHandOver(turn, ref, message, capConfig)
          : null;
        await record({
          decision: 'cap_reached',
          details: {
            cap_scope: error.scope,
            ...(handedOver
              ? { handoff_id: handedOver.handoffId, reason_codes: ['ai_failure'] }
              : {}),
          },
        });
      } else {
        log.error(
          { err: error },
          'daily AI cap could not be checked; leaving the message for a human',
        );
      }
      return null;
    }

    const startedAt = performance.now();
    let read: AiConversationState | null = null;
    let result: TurnResult | null = null;
    let replyEventId: string | null = null;
    let applyFailed = false;
    let unrecorded = false;
    /** The visitor's messages the turn answers, and the drafts it wrote. */
    let gathered = 1;
    let drafts = 0;
    /** The messages answered gave away a password or a code (AI-26 §5) — on the record. */
    let sensitiveShared = false;
    /**
     * The turn's decision record id, minted before it runs: its guardrail
     * hits are filed under it (`ai_guardrail_hits.turn_id`, tm 301.3). A
     * second draft is a turn of its own.
     */
    let turnId = randomUUID();
    /** The turn's hand-over, once it has one (tm 303.2): its id goes on the record. */
    let planned: PlannedHandoff | null = null;
    try {
      for (;;) {
        drafts += 1;
        if (drafts > 1) turnId = randomUUID();
        // The visitor may still be typing (AI-01 §5): the turn starts once
        // they have been quiet for the window, so it answers all of it. Not
        // where the AI has nothing to run — no turn could come of the wait.
        if (trigger !== null && runnable && batchWindowMs > 0) {
          await awaitBatchWindow({
            windowMs: batchWindowMs,
            read: () => turn.withTenant((tx) => newestVisitorEvent(tx, ref)),
          });
        }
        // Where the conversation stands, what the AI may run and what was
        // said, read together; then the turn, over a runner rather than one
        // transaction around it — the engine opens a short one per read so the
        // model call waits in none.
        const loaded = await turn.withTenant((tx) =>
          this.#read(tx, ref, trigger, turn.identityTrust, tenant.licenseId),
        );
        if (loaded === 'answered') {
          // Answered while this turn waited — by another engine on the same
          // connection, which owns the reply.
          log.info({}, 'an earlier ai turn answered this message; nothing to do');
          return null;
        }
        if (loaded === 'not_ai') {
          // A person took the conversation while this turn waited for the
          // visitor to stop typing — before any model was asked.
          log.info({}, 'a person has this conversation; the ai stays silent');
          return null;
        }
        read = loaded.conversation;
        gathered = loaded.context?.freshMessages || 1;
        sensitiveShared = loaded.context?.sensitiveShared ?? false;
        const history = historyOf(loaded.context);
        result = await this.#engine.runTurn(
          loaded.state,
          {
            // Everything the visitor wrote from the job's message on, merged —
            // or the job's message alone when it is not on the connection.
            text: loaded.context?.newCustomerText || message,
            ...(history ? { history } : {}),
            ...(loaded.through !== null ? { throughSeq: loaded.through } : {}),
            ...(loaded.earlierToday ? { earlierToday: loaded.earlierToday } : {}),
          },
          {
            tenant,
            db: turn.withTenant,
            now: new Date(),
            mode: 'live',
            chatId,
            configVersionId: read?.configVersionId ?? loaded.config.versionId,
            config: loaded.config.pkg,
            toolStubs: {},
            timeZone: loaded.timeZone,
            aiMode: loaded.aiMode,
            noAnswer: loaded.noAnswer,
            risk: loaded.risk,
            ...(loaded.riskFlags.length > 0 ? { riskFlags: loaded.riskFlags } : {}),
            handoffAvailable: loaded.handoffAvailable,
          },
        );
        const { decisions } = result;
        if (decisions.failure) {
          // The provider's own lines (component `llm` or `embedding`) carry the
          // status and the code but not the conversation; this one, on the
          // turn's logger, ties the failure to the chat a human now has to
          // answer (tm 255.6), and says which provider it was (tm 255.7). The
          // customer's outcome is the same for every failure, so this line is
          // where one is told from another (tm 255.9): transient or not, and
          // the provider's own status, code and request id — never its words.
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
        if (result.decisions.policy?.rule === 'unmatched') {
          // AI-05 §4.6: no procedure, no skill, no fallback took the message.
          log.info(
            { policy_step: 6, procedure_key: result.decisions.understood?.procedure_key ?? null },
            'ai turn unmatched: nothing took the message',
          );
        }
        if (!tookTurn(result)) return result;

        try {
          // The last draft goes out whatever the visitor wrote meanwhile.
          const recheck = drafts < DRAFTS_PER_TURN ? loaded.through : null;
          replyEventId = await this.#commit(turn, ref, read, result, recheck);
          break;
        } catch (error) {
          if (!(error instanceof VisitorWroteAgainError)) throw error;
          // Overtaken (AI-01 §7): the visitor wrote again while the model was
          // thinking, and the draft answers a conversation that has moved on.
          // Nothing of it was sent or saved; its spend is on record as an
          // expired turn, and the turn is taken again with the new message.
          log.info(
            { through_sequence: loaded.through, newest_sequence: error.newestSequence },
            'the visitor wrote again before the ai reply went out; taking the turn again',
          );
          const draft = skillDecision(result);
          if (draft) {
            await record({
              ...draft,
              id: turnId,
              decision: 'expired',
              handoffReason: null,
              latencyMs: performance.now() - startedAt,
              configVersionId: read?.configVersionId ?? null,
              details: { ...draft.details, reason: 'visitor_wrote_again' },
            });
          }
          result = null;
        }
      }

      const { unanswered } = result.decisions;
      if (unanswered) {
        // AI-06 §8 → AI-22: the knowledge base had no answer and the AI said
        // so. The question itself is on the decision record, not in the log.
        log.info(
          {
            event: 'ai.unanswered',
            category: unanswered.category,
            policy: unanswered.policy,
            reason: unanswered.reason,
            language: unanswered.language,
          },
          'ai could not answer from the knowledge base',
        );
      }

      // A turn that did nothing to the conversation leaves it as it was: what
      // its steps queued for a reply that never came is not applied.
      if (result.decisions.outcome === 'skipped') return result;

      const { summary, tags } = describeSideEffects(result.sideEffects);
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

      // The risk flags the turn's guardrails raised (AI-27), written in the
      // hand-over's own transaction — a flag is never there without the
      // hand-over, nor the hand-over without it — and announced once it
      // committed. A turn that hands nothing over writes them on their own.
      const raises = turnRiskFlagRaises(result.decisions.guardrails, {
        chatId,
        threadId: turn.threadId,
        evidenceEventIds: turn.triggerEventId ? [turn.triggerEventId] : [],
      });
      const raised: RiskFlag[] = [];
      const alongside =
        raises.length > 0
          ? async (tx: TenantClient): Promise<void> => {
              // From the start each time: a transfer refused rolled its own back.
              raised.length = 0;
              for (const raise of raises) {
                const outcome = await raiseRiskFlag(tx, tenant.licenseId, raise);
                if (outcome.created) raised.push(outcome.flag);
              }
            }
          : undefined;

      // The hand-over (AI-09 §5): the card, `human`, the target, the pushes.
      const handoff = handoffOf(result.sideEffects);
      if (handoff) {
        const failed = result.decisions.failure !== null;
        planned = planHandoff(handoff, failed);
        await this.#handoffs.execute(turn, ref, handoff, {
          plan: planned,
          failed,
          ...(alongside ? { alongside } : {}),
        });
      } else if (alongside) {
        await turn.withTenant(alongside);
      }
      this.#riskFlags?.announce(
        tenant,
        raised.map((flag) => ({ kind: 'raised' as const, flag })),
      );

      return result;
    } catch (error) {
      // Not a failure: this job may not answer the message — it has its
      // answer, or another claim holds the job and records its own turn. The
      // worker decides what that means.
      if (error instanceof AiJobReplyRefusedError) {
        unrecorded = true;
        throw error;
      }
      // Not a failure either: a person took the conversation while the model
      // was thinking (AI-11 §4) — an agent wrote to the player, a takeover, a
      // transfer. Nothing of this turn was sent, saved or applied; its spend
      // is on record as a turn overtaken before its reply went out.
      if (error instanceof AiModeChangedError) {
        unrecorded = true;
        log.info(
          { ai_mode: error.mode },
          'a person took the conversation; the ai reply was not sent',
        );
        const draft = result ? skillDecision(result) : null;
        if (draft) {
          await record({
            ...draft,
            id: turnId,
            decision: 'expired',
            handoffReason: null,
            latencyMs: performance.now() - startedAt,
            configVersionId: read?.configVersionId ?? null,
            details: { ...draft.details, reason: 'human_took_over' },
          });
        }
        return null;
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
          id: turnId,
          replyEventId,
          latencyMs: performance.now() - startedAt,
          // The configuration the turn ran on (ADR-14b §2.7) — null until tm 316.
          configVersionId: read?.configVersionId ?? null,
          ...(applyFailed ? { errorType: decided.errorType ?? 'apply_failed' } : {}),
          ...(sensitiveShared
            ? { riskFlags: [...(decided.riskFlags ?? []), SENSITIVE_SHARED_RISK_FLAG] }
            : {}),
          details: {
            ...decided.details,
            // A turn that answered several messages at once, or wrote a second
            // draft, says so (AI-01 §5, §7).
            ...(gathered > 1 ? { messages_answered: gathered } : {}),
            ...(drafts > 1 ? { drafts } : {}),
            // The hand-over's id, which its events and its card carry (AI-09 §6).
            ...(planned ? { handoff_id: planned.handoffId } : {}),
            ...(planned?.ruleId ? { handoff_rule_id: planned.ruleId } : {}),
          },
        });
        // What the guardrails found and did, under the same turn (tm 301.3 ·
        // AI-08 §8): only for a turn that was applied — a draft overtaken or
        // lost to another writer acted on nothing.
        const guardrails = result?.decisions.guardrails;
        if (guardrails) {
          await recordGuardrailHits(
            turn.withTenant,
            tenant,
            { chatId, threadId: turn.threadId, turnId, record: guardrails },
            log,
          );
        }
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
   *
   * With `recheck` — the visitor's newest message the turn read — the reply
   * looks once more, in its own transaction, for a message written after it,
   * and throws {@link VisitorWroteAgainError} if there is one: that rolls the
   * reply back too (AI-01 §7). A turn with nothing to send has nothing to
   * recheck; the newer message's own job answers it.
   */
  async #commit(
    turn: VisitorTurn,
    ref: ConnectionRef,
    read: AiConversationState | null,
    result: TurnResult,
    recheck: number | null,
  ): Promise<string | null> {
    const { tenant, chatId } = turn;
    const patch = turnStatePatch(read ? toTurnState(read) : emptyTurnState(), result.nextState);
    const run = skillRunRecord(result.decisions);

    // Set by the attempt that commits: whether this turn made the connection
    // the AI's (`claimAiTurn`), which the inbox hears once it has (tm 293.5).
    let joined = false;
    // Through `tx` and nowhere else: as the reply's outbox it runs again on
    // the send's race retry, whose first attempt rolled back with it.
    const write = async (tx: TenantClient): Promise<void> => {
      // Still the AI's to answer (AI-11 §4), under the thread's row lock — which
      // the reply's append already holds — so a person who wrote first wins.
      joined = await claimAiTurn(tx, ref);
      const current = read ?? {
        id: (await openConversation(tx, ref, { configVersionId: null })).id,
        version: 0,
      };
      if (Object.keys(patch).length > 0) await saveConversation(tx, current, patch);
      // The count an admin sees in the Playbook list, incremented in the same
      // transaction so it cannot drift from the run log beside it. Counted
      // first: a procedure goes on from its snapshot after its skill is
      // deleted (AI-03 §3 · tm 296.6), and a run row would then fail its
      // foreign key and take the reply down with it. The skill's runs went
      // with it, so this one is not written either; the decision record,
      // which has no relation, still says which procedure answered.
      const counted = run
        ? await tx.skill.updateMany({
            where: { id: run.skillId },
            data: { runsCount: { increment: 1 } },
          })
        : null;
      if (run && counted && counted.count > 0) {
        await tx.skillRun.create({
          data: {
            skillId: run.skillId,
            chatId,
            // The connection beside the day container (tm 288.2 · ID-08).
            threadId: ref.threadId,
            licenseId: tenant.licenseId,
            status: run.status,
            // What a step did, in words that may quote the player (AI-26 · tm 300.2).
            log: maskDeep(run.log, 'customer') as unknown as object,
            llmInputTokens: run.llmInputTokens,
            llmOutputTokens: run.llmOutputTokens,
            embeddingTokens: run.embeddingTokens,
          },
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
            if (recheck !== null) {
              const newest = await newestVisitorEvent(tx, ref);
              if (newest && newest.sequence > recheck) {
                throw new VisitorWroteAgainError(newest.sequence);
              }
            }
            await write(tx);
          },
        },
      );
      if (joined) await this.chats.announceAiJoined(tenant, ref, AI_BOT_ID);
      return sent.event.id;
    }

    await turn.withTenant(write);
    if (joined) await this.chats.announceAiJoined(tenant, ref, AI_BOT_ID);
    return null;
  }

  /**
   * What the turn knows before the gates — or null when the connection is not
   * the AI's to answer (`threads.ai_mode`, AI-11), which is read first and
   * ends the look there: how far the conversation's turns have answered the
   * visitor (0 before the first), and whether the AI has anything to run — no
   * active skill on an active agent means no turn, so the message is not held
   * for the window (nor is the chat's next job behind it).
   */
  async #lookout(
    turn: VisitorTurn,
    ref: ConnectionRef,
  ): Promise<{
    answeredThrough: number;
    runnable: boolean;
    batchWindowSeconds: number | null;
    aiMode: AiConversationMode | null;
    config: AiConfigRead;
  } | null> {
    return turn.withTenant(async (tx) => {
      const aiMode = await readAiMode(tx, ref);
      if (!aiMayAnswer(aiMode)) return null;
      const conversation = await loadConversation(tx, ref);
      const config = await readAndCompile.forTurn(tx, {
        aiAgentId: null,
        pinnedVersionId: conversation?.configVersionId ?? null,
      });
      return {
        answeredThrough: conversation?.lastProcessedEventSeq ?? 0,
        runnable: config.pkg.skills.length > 0,
        batchWindowSeconds: config.pkg.batchWindowSeconds ?? null,
        aiMode,
        config,
      };
    });
  }

  /**
   * Today's cap refused the turn on a connection the AI answers (tm 303.2 ·
   * AI-09 `ai_failure`): the player is told in a fixed sentence — the
   * workspace's or the default, with the after-hours text when nobody is
   * accepting chats — and a person is sent. The sentence answers the job's
   * message (its mark and fence). Null when it could not be done: the message
   * waits for a person, as it always did.
   */
  async #capHandOver(
    turn: VisitorTurn,
    ref: ConnectionRef,
    message: string,
    config: AiConfigRead,
  ): Promise<PlannedHandoff | null> {
    const { tenant, chatId, log } = turn;
    const handoff = config.pkg.handoff ?? DEFAULT_HANDOFF_CONFIG;
    const persona = config.pkg.skills[0]?.persona ?? readPersona(null);
    const { answerIn } = languageVerdict(message, persona, null);
    try {
      const available = await turn.withTenant((tx) => anyoneAccepting(tx, tenant.licenseId));
      const words = handoffWords(handoff, 'ai_failure', answerIn) as string;
      await this.chats.sendEvent(
        tenant,
        botPrincipal(tenant),
        chatId,
        {
          type: 'message',
          text: available ? words : `${words}\n${afterHoursWords(handoff, answerIn)}`,
          recipients: 'all',
          properties: { ...turn.replyProperties },
        },
        { outbox: (tx, written) => turn.replyOutbox(tx, written) },
      );
      const effect = {
        kind: 'handoff' as const,
        team: null,
        reason: 'ai_cap_reached',
        reasons: ['ai_failure' as const],
        priority: 'normal' as const,
      };
      const plan = planHandoff(effect, true);
      await this.#handoffs.execute(turn, ref, effect, { plan, failed: true });
      return plan;
    } catch (error) {
      if (error instanceof AiJobReplyRefusedError) throw error;
      log.error({ err: error }, 'the ai cap hand-over failed; leaving the message for a human');
      return null;
    }
  }

  /**
   * The turn's read, in one transaction: the conversation, the configuration
   * it runs on and what the visitor said — or `answered` when the job's
   * message (`trigger`) is answered already, `not_ai` when a person took the
   * connection meanwhile (AI-11).
   *
   * The job's message and every one the visitor wrote after it are the turn's
   * (`through` is the newest); what came before is history — answered, or left
   * by an earlier turn to a person, and the model reads it either way. A
   * message that is not on the connection (`trigger` null) is answered alone.
   *
   * On the connection's first turn the day's earlier connections come too
   * (tm 294 · AI-02), cut to what the visitor's identity allows (`trust`) —
   * unless the agent turned its same-day memory off.
   */
  async #read(
    tx: TenantClient,
    ref: ConnectionRef,
    trigger: number | null,
    trust: IdentityTrust,
    licenseId: bigint,
  ): Promise<TurnRead | 'answered' | 'not_ai'> {
    const aiMode = await readAiMode(tx, ref);
    if (!aiMayAnswer(aiMode)) return 'not_ai';
    const conversation = await loadConversation(tx, ref);
    const state = conversation ? toTurnState(conversation) : emptyTurnState();
    if (trigger !== null && trigger <= state.lastProcessedEventSeq) return 'answered';
    const config = await readAndCompile.forTurn(tx, {
      aiAgentId: null,
      pinnedVersionId: conversation?.configVersionId ?? null,
    });
    // Where the workspace's clock is (ID-04): how a procedure reads "13:40".
    const { timezone: timeZone } = await readDayBoundary(tx);
    // The turn's agent's no-answer setting (AI-06 §8), live like the other
    // hand-over settings — never from the pinned version (ADR-14b §2.2).
    const agentId = turnAgentId(config.pkg.skills);
    const handoff = agentId
      ? await tx.aiHandoffSettings.findUnique({
          where: { aiAgentId: agentId },
          select: { noAnswer: true },
        })
      : null;
    const noAnswer = readNoAnswerSettings(handoff?.noAnswer ?? null);
    // The conversation's risk flags and its player's (AI-27 §3, §6), live.
    const { flags, policy: risk } = await chatRiskPolicy(tx, ref.chatId);
    // The conversation's own flag types, for the `risk_flag` hand-over rules (K9).
    const riskFlags = [
      ...new Set(flags.filter((flag) => flag.chat_id === ref.chatId).map((flag) => flag.type)),
    ];
    // Whether anyone could take a hand-over now (AI-12 §4): if not, it says so.
    const handoffAvailable = await anyoneAccepting(tx, licenseId);
    if (trigger === null) {
      return {
        conversation,
        state,
        config,
        context: null,
        through: null,
        earlierToday: null,
        timeZone,
        aiMode,
        noAnswer,
        risk,
        riskFlags,
        handoffAvailable,
      };
    }
    const newest = await newestVisitorEvent(tx, ref);
    const through = Math.max(trigger, newest?.sequence ?? trigger);
    const context = await loadConnectionContext(tx, ref, state, {
      through,
      processedThrough: trigger - 1,
      budget: this.#historyBudget,
    });
    const memory = config.pkg.dailyMemory ?? DEFAULT_DAILY_MEMORY;
    const earlierToday =
      memory.enabled && turnsTaken(state) === 0
        ? await loadEarlierToday(tx, ref, { trust, recall: memory.recall })
        : null;
    return {
      conversation,
      state,
      config,
      context,
      through,
      earlierToday,
      timeZone,
      aiMode,
      noAnswer,
      risk,
      riskFlags,
      handoffAvailable,
    };
  }
}

/** What a turn reads before it runs (`AiResponder.#read`). */
interface TurnRead {
  conversation: AiConversationState | null;
  state: TurnState;
  config: AiConfigRead;
  context: ConnectionContext | null;
  /** The visitor's newest message the turn answers; null when it answers the job's alone. */
  through: number | null;
  /** The day's earlier connections, on the connection's first turn (tm 294). */
  earlierToday: EarlierToday | null;
  /** The workspace's day-boundary zone (`inbox_settings.day_boundary_tz`). */
  timeZone: string;
  /** Who answers the connection (`threads.ai_mode`) — null before anyone has (AI-11). */
  aiMode: AiConversationMode | null;
  /** The turn's agent's `no_answer` setting (tm 298 · AI-06 §8). */
  noAnswer: AiNoAnswerSettings;
  /** What the conversation's risk flags and its player's mean (tm 302.2 · AI-27). */
  risk: RiskPolicy;
  /** The types of the conversation's own active risk flags (tm 303.3 · K9 `risk_flag` rules). */
  riskFlags: RiskFlagType[];
  /** Whether anyone in the workspace is accepting chats now (tm 303.2 · AI-12 §4). */
  handoffAvailable: boolean;
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
