/**
 * The bridge between an incoming customer message and the rule bot
 * (FR-MOD-06.6) — the deterministic half of the answer path.
 *
 * Ordering, and why it is this way round: the rule bot runs BEFORE the AI Agent
 * (`ai-responder.ts`). A rule is a sentence the workspace wrote down and can
 * predict exactly; the AI is a guess that happens to be a stub in this build.
 * When both could answer, the predictable one should, because that is the whole
 * reason a workspace writes a rule — "if they say 'opening hours', say this" is
 * an instruction, not a suggestion to be weighed against a model.
 *
 * Three properties it borrows unchanged from the AI responder, for the same
 * reasons stated there: the customer's message is already durable before any of
 * this runs, every failure path leaves the conversation exactly as it would have
 * been with no automation at all, and the reply is authored as a *bot*
 * principal, which is what makes the event `author_type: 'bot'`.
 *
 * One thing it deliberately does NOT borrow: `request.requireAiInference()`.
 * That gate exists because a route is about to send workspace content to a model
 * provider (NFR-C4 · C4-e). This path sends nothing anywhere — the match happens
 * in process against the workspace's own rules, and the reply is text the
 * workspace itself typed — so gating it would switch off a non-AI feature for
 * every HIPAA-covered workspace on a data-residency question it does not raise.
 */
import type { FastifyRequest } from 'fastify';
import type { BotPrincipal } from '../auth/principal.js';
import type { ChatService } from '../chat/chat-service.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { selectRuleBotMatch, type RuleBotMatch } from './rule-bot-engine.js';

export interface RuleBotOutcome extends RuleBotMatch {
  /**
   * Did the bot take the conversation over?
   *
   * True when it replied or transferred. A rule that only tags is an
   * annotation, not an answer: "tag anything containing 'refund' with billing"
   * must not silently switch the AI Agent off for every refund question, which
   * is exactly what treating any match as a take-over would do. So the caller
   * skips the AI on this flag, not on the presence of a match.
   */
  tookOver: boolean;
}

export class RuleBotResponder {
  constructor(
    private readonly chats: ChatService,
    private readonly publisher: RealtimePublisher,
  ) {}

  /**
   * Run the first matching rule and apply it. Returns what happened, or null
   * when no rule matched.
   */
  async handle(
    request: FastifyRequest,
    chatId: string,
    message: string,
    pageUrl: string | null,
  ): Promise<RuleBotOutcome | null> {
    const tenant = request.tenant();

    try {
      const match = await request.withTenant((tx) =>
        selectRuleBotMatch(tx, tenant, { chatId, message, pageUrl }, new Date()),
      );
      if (!match) return null;

      const principal = botPrincipal(tenant, match.botId);
      let tookOver = false;

      if (match.actions.send_message) {
        await this.chats.sendEvent(tenant, principal, chatId, {
          type: 'message',
          text: match.actions.send_message,
          recipients: 'all',
        });
        tookOver = true;
      }

      if (match.actions.add_tag) {
        // A tag that cannot be applied is not worth abandoning the reply for —
        // the AI responder's judgement, and it holds here for the same reason.
        await this.chats
          .tagThread(tenant, principal, chatId, match.actions.add_tag)
          .catch((error: unknown) =>
            request.log.warn(
              { err: error, tag: match.actions.add_tag, bot_id: match.botId },
              'rule bot could not apply tag',
            ),
          );
      }

      if (match.actions.transfer_to_group_id != null) {
        const transferred = await this.#transfer(
          request,
          principal,
          chatId,
          BigInt(match.actions.transfer_to_group_id),
        );
        // Only a transfer that landed counts as taking over. One that did not —
        // the team was deleted after the rule was saved, or nobody in it is
        // accepting — must leave the AI its turn, or a stale rule would turn
        // into a silent black hole for every message it matches.
        tookOver = tookOver || transferred;
      }

      return { ...match, tookOver };
    } catch (error) {
      // The customer's message is already stored. Whatever went wrong, the
      // conversation is intact and the AI — then a human — still gets it.
      request.log.error({ err: error, chat_id: chatId }, 'rule bot failed');
      return null;
    }
  }

  /** Hand the conversation to a team. False when it could not be done. */
  async #transfer(
    request: FastifyRequest,
    principal: BotPrincipal,
    chatId: string,
    groupId: bigint,
  ): Promise<boolean> {
    const tenant = request.tenant();
    try {
      await this.chats.transfer(tenant, principal, chatId, {
        groupId,
        // Not `ai_handoff`: the AI Agent report attributes every one of those to
        // the AI (FR-MOD-06.5's "Transferred %"), and no model was consulted
        // here.
        reason: 'bot_handoff',
      });
    } catch (error) {
      request.log.warn(
        { err: error, chat_id: chatId, group_id: String(groupId) },
        'rule bot could not transfer the chat',
      );
      return false;
    }

    await this.publisher.publish(
      tenant,
      'chat_transferred',
      { allAgents: true },
      { chat_id: chatId, reason: 'bot_handoff', transferred_to: { group_ids: [Number(groupId)] } },
    );
    return true;
  }
}

/**
 * The bot acts as a bot principal, carrying only the scopes its three actions
 * need — so a rule cannot reach further into the API than it declares.
 *
 * `botId` is the rule bot's own id rather than a shared constant, so
 * `events.author_id` names WHICH bot spoke. With more than one bot on a
 * workspace that is the difference between a transcript that can be explained
 * and one that cannot.
 */
function botPrincipal(
  tenant: { licenseId: bigint; organizationId: string },
  botId: string,
): BotPrincipal {
  return {
    kind: 'bot',
    botId,
    licenseId: tenant.licenseId,
    organizationId: tenant.organizationId,
    scopes: ['chats--all:rw', 'tags--all:rw'],
    tokenId: botId,
    tokenKind: 'bot',
  };
}
