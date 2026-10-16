/**
 * The bridge between an incoming customer message and the skill engine.
 *
 * Kept out of the route because the ordering here is load-bearing and easy to
 * get wrong: the customer's message must be durable *before* the AI reacts to
 * it, and an AI failure must never lose that message. Everything below runs
 * after the message is committed, and every failure path leaves the
 * conversation exactly as it would have been with no AI at all — which is a
 * working conversation waiting for a human.
 *
 * It is not the first thing an incoming message meets. The deterministic rule
 * bot (FR-MOD-06.6, `services/bots/rule-bot-responder.ts`) is tried first and
 * this runs only when no rule took the conversation over; the ordering, and why
 * it is that way round, is written at the one place that decides it —
 * `respondToCustomerMessage` in `routes/customer.ts`.
 *
 * Nor does it run inside the customer's request any more (tm 256.10): the
 * route hands it to `app.followUps`, so it starts after the response has been
 * written, one message at a time per chat. `request` is still what it is
 * given — its tenant, its logger, `withTenant` over the server's pool — none
 * of which depends on the connection the response went out on.
 */
import type { FastifyRequest } from 'fastify';
import { AI_BOT_ID } from '@siyahtus/types';
import { bindChatLogContext, logContextOf } from '../../plugins/log-context.js';
import type { BotPrincipal } from '../auth/principal.js';
import type { ChatService } from '../chat/chat-service.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { AiDailyCapError } from './ai-daily-budget.js';
import { type AiDecisionInput, recordAiDecision, skillDecision } from './decision-log.js';
import type { SkillEngine, SkillRunResult } from './skill-engine.js';

/** What the caller knows about the turn beyond the chat and the message. */
export interface AiTurn {
  /** The customer event the turn answers. */
  triggerEventId?: string;
}

export class AiResponder {
  readonly #engine: SkillEngine;

  constructor(
    private readonly chats: ChatService,
    private readonly publisher: RealtimePublisher,
    engine: SkillEngine,
  ) {
    this.#engine = engine;
  }

  /**
   * Run any matching skill and apply its outcome.
   *
   * Returns the result for tests and callers that care; the route does not,
   * because there is nothing useful it could do differently.
   *
   * Every turn the AI takes leaves one decision record (tm 288.2 · ID-08) —
   * after the outcome is applied, so the record names the reply it wrote. A
   * message no skill matched is not a turn and leaves none; a record that
   * cannot be written is one log line, never a lost reply.
   */
  async handle(
    request: FastifyRequest,
    chatId: string,
    message: string,
    turn: AiTurn = {},
  ): Promise<SkillRunResult | null> {
    const tenant = request.tenant();
    // Every line below is about this chat (ID-08); the customer route has
    // normally bound it already, with the connection, and this is a no-op.
    bindChatLogContext(request, { chatId });
    const ids = turnIds(request, chatId, turn);
    const record = (input: Omit<AiDecisionInput, keyof typeof ids>): Promise<string | null> =>
      recordAiDecision((fn) => request.withTenant(fn), tenant, { ...ids, ...input }, request.log);

    // Residency, before the message reaches the engine (NFR-C4 · C4-e). This is
    // the one AI surface a *customer* triggers, and the content is the message
    // they just typed, so it is the surface the constraint exists for. The check
    // cannot be declared on the route — the route is "send a message", which
    // must keep working — so it is asked for here, and a refusal leaves the
    // conversation exactly as an unconfigured AI would: stored, untouched, and
    // waiting for a human.
    try {
      await request.requireAiInference();
    } catch (error) {
      request.log.warn(
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
      await request.requireAiBudget();
    } catch (error) {
      if (error instanceof AiDailyCapError) {
        // The allowance refused the turn before any skill was looked at — still
        // a turn the AI did not take, and the one the cap's report counts.
        await record({ decision: 'cap_reached', details: { cap_scope: error.scope } });
      } else {
        request.log.error(
          { err: error },
          'daily AI cap could not be checked; leaving the message for a human',
        );
      }
      return null;
    }

    const startedAt = performance.now();
    let result: SkillRunResult | null = null;
    let replyEventId: string | null = null;
    let applyFailed = false;
    try {
      // A runner, not one transaction around the whole run: the engine opens a
      // short one per database step so the model call waits in none of them.
      result = await this.#engine.run((fn) => request.withTenant(fn), tenant, {
        message,
        chatId,
        threadId: ids.threadId,
      });
      if (result.failure) {
        // The provider's own lines (component `llm` or `embedding`) carry the
        // status and the code but not the conversation; this one, on the
        // request's logger, ties the failure to the chat a human now has to
        // answer (tm 255.6), and says which provider it was (tm 255.7). The
        // customer's outcome is the same for every failure, so this line is
        // where one is told from another (tm 255.9): transient or not, and the
        // provider's own status, code and request id — never its words.
        const { provider, kind, transient, status, code, requestId, reason } = result.failure;
        request.log.warn(
          {
            skill_id: result.skillId,
            provider,
            kind,
            transient,
            ...(status !== null ? { status } : {}),
            ...(code !== null ? { code } : {}),
            ...(requestId !== null ? { provider_request_id: requestId } : {}),
            ...(reason !== null ? { reason } : {}),
          },
          result.failure.provider === 'llm'
            ? 'ai model could not answer; the conversation stays with a human'
            : 'ai knowledge search could not run; the conversation stays with a human',
        );
      }
      if (result.outcome === 'skipped') return result;

      // Sent as a *bot* principal, which is what makes the event
      // `author_type: 'bot'` rather than `'agent'`. Two things hang off that
      // distinction: ADR-09 counts a thread closing with no agent-authored
      // event as an AI resolution, and Reports' "first response" only starts
      // the clock on a human. Sending this as an agent would quietly stop the
      // workspace being billed for the automation it used, and would report
      // response times no human achieved.
      if (result.reply) {
        const sent = await this.chats.sendEvent(tenant, botPrincipal(tenant), chatId, {
          type: 'message',
          text: result.reply,
          recipients: 'all',
        });
        replyEventId = sent.event.id;
      }

      const summary = result.summary;
      if (summary) {
        await request.withTenant((tx) =>
          tx.thread.updateMany({
            where: { chatId, active: true },
            data: { summary, summaryUpdatedAt: new Date() },
          }),
        );
      }

      for (const tag of result.tags) {
        await this.chats
          .tagThread(tenant, botPrincipal(tenant), chatId, tag)
          // A tag that cannot be applied is not worth abandoning the reply for.
          .catch((error: unknown) =>
            request.log.warn({ err: error, tag }, 'skill could not apply tag'),
          );
      }

      if (result.transferTo) {
        await this.#transfer(request, chatId, result.transferTo);
      }

      return result;
    } catch (error) {
      // The customer's message is already stored. Whatever went wrong here, the
      // conversation is intact and a human will pick it up — which is exactly
      // what would have happened without any AI.
      request.log.error({ err: error }, 'skill engine failed');
      applyFailed = result !== null;
      return null;
    } finally {
      // Recorded once the outcome is applied (or failed to apply), so the row
      // can name the reply it wrote. An engine that threw before deciding
      // anything leaves no result and no row — its log line above is the record.
      const decided = result ? skillDecision(result) : null;
      if (decided) {
        await record({
          ...decided,
          replyEventId,
          latencyMs: performance.now() - startedAt,
          ...(applyFailed ? { errorType: decided.errorType ?? 'apply_failed' } : {}),
        });
      }
    }
  }

  async #transfer(request: FastifyRequest, chatId: string, groupName: string): Promise<void> {
    const tenant = request.tenant();

    const group = await request.withTenant((tx) =>
      tx.group.findFirst({ where: { name: groupName }, select: { id: true } }),
    );

    if (!group) {
      // The skill names a team that no longer exists. Leaving the conversation
      // where it is means a human still sees it; silently dropping it would not.
      request.log.warn({ group: groupName }, 'skill targets an unknown team');
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
 * The ids a decision record files the turn under: the chat it was given, the
 * connection and the member the route bound for this chat (ID-08), the
 * request, and the event it answers. The bound connection is used only when
 * it was bound for this same chat.
 */
function turnIds(
  request: FastifyRequest,
  chatId: string,
  turn: AiTurn,
): Pick<AiDecisionInput, 'chatId' | 'threadId' | 'customerId' | 'requestId' | 'triggerEventId'> & {
  threadId: string | null;
} {
  const bound = logContextOf(request);
  const sameChat = bound.chat_id === chatId;
  return {
    chatId,
    threadId: sameChat ? (bound.thread_id ?? null) : null,
    customerId: bound.customer_id ?? null,
    requestId: bound.request_id ?? request.id,
    triggerEventId: turn.triggerEventId ?? null,
  };
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
