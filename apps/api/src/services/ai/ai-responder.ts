/**
 * The bridge between an incoming customer message and the skill engine.
 *
 * Kept out of the route because the ordering here is load-bearing and easy to
 * get wrong: the customer's message must be durable *before* the AI reacts to
 * it, and an AI failure must never lose that message. Everything below runs
 * after the message is committed, and every failure path leaves the
 * conversation exactly as it would have been with no AI at all — which is a
 * working conversation waiting for a human.
 */
import type { FastifyRequest } from 'fastify';
import type { BotPrincipal } from '../auth/principal.js';
import type { ChatService } from '../chat/chat-service.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { SkillEngine, type SkillRunResult } from './skill-engine.js';

/** Author id the AI's own events and actions carry. */
export const AI_BOT_ID = 'ai-agent';

export class AiResponder {
  readonly #engine: SkillEngine;

  constructor(
    private readonly chats: ChatService,
    private readonly publisher: RealtimePublisher,
    engine = new SkillEngine(),
  ) {
    this.#engine = engine;
  }

  /**
   * Run any matching skill and apply its outcome.
   *
   * Returns the result for tests and callers that care; the route does not,
   * because there is nothing useful it could do differently.
   */
  async handle(
    request: FastifyRequest,
    chatId: string,
    message: string,
  ): Promise<SkillRunResult | null> {
    const tenant = request.tenant();

    try {
      const result = await request.withTenant((tx) =>
        this.#engine.run(tx, tenant, { message, chatId }),
      );
      if (result.outcome === 'skipped') return result;

      // Sent as a *bot* principal, which is what makes the event
      // `author_type: 'bot'` rather than `'agent'`. Two things hang off that
      // distinction: ADR-09 counts a thread closing with no agent-authored
      // event as an AI resolution, and Reports' "first response" only starts
      // the clock on a human. Sending this as an agent would quietly stop the
      // workspace being billed for the automation it used, and would report
      // response times no human achieved.
      if (result.reply) {
        await this.chats.sendEvent(tenant, botPrincipal(tenant), chatId, {
          type: 'message',
          text: result.reply,
          recipients: 'all',
        });
      }

      if (result.summary) {
        await request.withTenant((tx) =>
          tx.thread.updateMany({
            where: { chatId, active: true },
            data: { summary: result.summary, summaryUpdatedAt: new Date() },
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
      request.log.error({ err: error, chat_id: chatId }, 'skill engine failed');
      return null;
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
      request.log.warn({ chat_id: chatId, group: groupName }, 'skill targets an unknown team');
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
