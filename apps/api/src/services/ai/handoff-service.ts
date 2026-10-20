/**
 * The AI's hand-over, executed (tm 303.2 · SiyahTuş analysis AI-09 §5, §6).
 *
 * The engine decides that a person answers and why (`conversation/handoff/
 * triggers.ts`) and writes nothing; this is where it happens to the real
 * conversation, in one order and one place — `execute`:
 *
 *   1. **the card** (AI-10, tm 304.1): a {@link HandoffCardWriter}, in the
 *      hand-over's own transaction, so a card is never there without the
 *      hand-over — `ai_handoffs`, the connection's summary and the
 *      agents-only line; announced once the hand-over committed;
 *   2. **the connection to `human`** (AI-11): the AI stays silent from here on;
 *   3. **the target** (AI-12): the team a single-message skill names, the team
 *      a procedure names by id, the team holding the queue role a `{ topic }`
 *      target names (AU-01 · `resolveQueue`, by role, so a renamed team still
 *      receives it), or — another topic (#307 maps those), no target, a team
 *      that cannot take it now — whoever routing gives it; except that a
 *      hand-over named for the Responsible Gambling team waits in that team's
 *      queue rather than reach another (ADR-08a §2.6);
 *   4. **the pushes**: the transfer and the AI mode, to the teams that watch.
 *
 * Every system event the hand-over writes — the transfer line, the AI-mode
 * line — carries `handoff_id`, `reason_codes` (catalogue codes, most severe
 * first), `primary_reason` and `priority` (AI-09 §6), for the reports and the
 * search. The id is minted before the hand-over ({@link planHandoff}) so the
 * turn's decision record names it too; #304's card takes it as its own.
 *
 * **Idempotent.** A connection a person has already — they took it between
 * the turn's commit and this — is left as it is: no second transfer, no team
 * moved under them. What must not be lost with the hand-over (the turn's risk
 * flags) is written all the same.
 */
import { randomUUID } from 'node:crypto';
import {
  AI_BOT_ID,
  RESPONSIBLE_GAMBLING_ROLE,
  isQueueTopicRole,
  primaryHandoffReason,
  type GuardrailPriority,
  type HandoffReason,
} from '@siyahtus/types';
import type { IdentityTrust } from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { ApiError } from '../../lib/api-error.js';
import type { BotPrincipal } from '../auth/principal.js';
import { aiMayAnswer, readAiMode } from '../chat/ai-mode.js';
import type { ChatService, SerialisedEvent } from '../chat/chat-service.js';
import type { VisitorTurn } from '../chat/visitor-turn.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { resolveQueue } from '../routing/queues.js';
import { catalogueReason, orderHandoffReasons } from './conversation/handoff/triggers.js';
import type { ConnectionRef } from './conversation/state-store.js';
import type { handoffOf, TurnResult } from './conversation/turn.js';

export type TurnHandoff = NonNullable<ReturnType<typeof handoffOf>>;

/** One hand-over, as its events and its card name it. */
export interface PlannedHandoff {
  readonly handoffId: string;
  /** Catalogue codes, most severe first. */
  readonly reasonCodes: readonly HandoffReason[];
  readonly primaryReason: HandoffReason;
  readonly priority: GuardrailPriority;
  /** The workspace's hand-over rule that set it off or routed it (tm 303.3 · K9). */
  readonly ruleId?: string;
}

/** What the card is built from besides the hand-over itself (AI-10). */
export interface HandoffCardContext {
  /** The turn that handed over; null when none ran (today's cap refused it). */
  readonly result: TurnResult | null;
  /** How the visitor proved who they are (K4). */
  readonly trust: IdentityTrust | null;
  /** What the player wrote that the hand-over answered. */
  readonly turnText: string | null;
}

/** A card written in the hand-over's transaction, for its announcement after commit. */
export interface WrittenHandoffCard {
  readonly handoffId: string;
  readonly chatId: string;
  readonly threadId: string;
  readonly summary: string;
  readonly primaryReason: HandoffReason;
  readonly priority: GuardrailPriority;
  readonly targetGroupId: number | null;
  /** The agents-only line with the card's text; null when the connection was closed. */
  readonly note: SerialisedEvent | null;
}

/**
 * The hand-over card (AI-10, tm 304.1): written in the hand-over's
 * transaction — again from the start when a refused transfer rolled the first
 * attempt back — and announced once it committed.
 */
export interface HandoffCardWriter {
  write(
    tx: TenantClient,
    input: {
      tenant: TenantContext;
      chatId: string;
      threadId: string;
      handoff: PlannedHandoff;
      effect: TurnHandoff;
      context: HandoffCardContext;
    },
  ): Promise<WrittenHandoffCard>;
  announce(tenant: TenantContext, written: WrittenHandoffCard): Promise<void>;
}

/** The hand-over's id, reasons and priority, before anything is written. */
export function planHandoff(effect: TurnHandoff, failed: boolean): PlannedHandoff {
  const reasonCodes = orderHandoffReasons([
    ...(effect.reasons ?? [catalogueReason(effect.reason)]),
    ...(failed ? (['ai_failure'] as const) : []),
  ]);
  return {
    handoffId: randomUUID(),
    reasonCodes,
    primaryReason: (primaryHandoffReason(reasonCodes) as HandoffReason | null) ?? 'procedure_rule',
    priority: effect.priority ?? 'normal',
    ...(effect.ruleId ? { ruleId: effect.ruleId } : {}),
  };
}

/**
 * Whether anyone in the workspace is accepting chats now — what decides the
 * after-hours text (AI-12 §4). The workspace, not the target team: the team is
 * routing's to find until #307 resolves it.
 */
export async function anyoneAccepting(tx: TenantClient, licenseId: bigint): Promise<boolean> {
  const accepting = await tx.agentMembership.count({
    where: { licenseId, routingStatus: 'accepting_chats', suspended: false },
  });
  return accepting > 0;
}

/** The system events' share of the hand-over (AI-09 §6). */
export function handoffEventProperties(plan: PlannedHandoff): Record<string, unknown> {
  return {
    handoff_id: plan.handoffId,
    reason_codes: [...plan.reasonCodes],
    primary_reason: plan.primaryReason,
    priority: plan.priority,
    ...(plan.ruleId ? { handoff_rule_id: plan.ruleId } : {}),
  };
}

export interface HandoffServiceOptions {
  /** The card (AI-10). Absent: no card is written (a test's choice). */
  readonly card?: HandoffCardWriter;
}

export class HandoffService {
  readonly #card: HandoffCardWriter | null;

  constructor(
    private readonly chats: ChatService,
    private readonly publisher: RealtimePublisher,
    options: HandoffServiceOptions = {},
  ) {
    this.#card = options.card ?? null;
  }

  /**
   * Hand the connection over: the card, `human`, the target, the pushes — see
   * the file header. False when a person had it already and nothing was
   * handed over. `alongside` is written in the hand-over's transaction (the
   * turn's risk flags), or on its own when there is none to be in.
   */
  async execute(
    turn: VisitorTurn,
    ref: ConnectionRef,
    effect: TurnHandoff,
    input: {
      plan: PlannedHandoff;
      failed: boolean;
      alongside?: (tx: TenantClient) => Promise<void>;
      /** What the card is built from (AI-10); absent: the hand-over alone. */
      card?: HandoffCardContext;
    },
  ): Promise<boolean> {
    const { plan } = input;
    const card = this.#card;
    let written: WrittenHandoffCard | null = null;
    const alongside = async (tx: TenantClient): Promise<void> => {
      await input.alongside?.(tx);
      if (!card) return;
      written = await card.write(tx, {
        tenant: turn.tenant,
        chatId: ref.chatId,
        threadId: ref.threadId,
        handoff: plan,
        effect,
        context: input.card ?? { result: null, trust: null, turnText: null },
      });
    };
    // The hand-over's priority is the connection's from here on (ADR-08a
    // §2.3): urgent waits at the front of its team's queue.
    const options = {
      alongside,
      properties: handoffEventProperties(plan),
      priority: plan.priority,
    };
    const handedOver = await this.#execute(turn, ref, effect, input, options);
    // Once committed: the card reaches the agents who see the conversation.
    const done = written as WrittenHandoffCard | null;
    if (card && done) await card.announce(turn.tenant, done);
    return handedOver;
  }

  async #execute(
    turn: VisitorTurn,
    ref: ConnectionRef,
    effect: TurnHandoff,
    input: {
      plan: PlannedHandoff;
      failed: boolean;
      alongside?: (tx: TenantClient) => Promise<void>;
    },
    options: {
      alongside: (tx: TenantClient) => Promise<void>;
      properties: Record<string, unknown>;
      priority: GuardrailPriority;
    },
  ): Promise<boolean> {
    const { plan } = input;

    // Idempotent: a person who took it meanwhile keeps it as it is.
    const mode = await turn.withTenant((tx) => readAiMode(tx, ref));
    if (!aiMayAnswer(mode)) {
      if (input.alongside) await turn.withTenant(input.alongside);
      turn.log.info(
        { ai_mode: mode, handoff_id: plan.handoffId },
        'a person has this conversation already; the ai hand-over is not needed',
      );
      return false;
    }

    if (effect.team) return this.#toTeamNamed(turn, effect.team, options);
    const { tenant, chatId } = turn;
    const groupId =
      effect.groupId !== undefined
        ? BigInt(effect.groupId)
        : await this.#topicTeam(turn, effect.topic);
    if (groupId !== null && !input.failed) {
      try {
        await this.chats.transfer(
          tenant,
          botPrincipal(tenant),
          chatId,
          { groupId, reason: 'ai_handoff' },
          options,
        );
        return true;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        turn.log.warn(
          { group_id: Number(groupId), err_type: error.type },
          'procedure hand-over team cannot take the conversation; routing it instead',
        );
      }
    }
    // The Responsible Gambling team has no other team to give its
    // conversations to (ADR-08a §2.6): one it cannot take now waits in its
    // queue — not in the team the rules opened it in.
    const waitIn =
      groupId !== null && (await this.#isResponsibleGambling(turn, groupId)) ? groupId : null;
    return this.chats.handOverFromAi(
      tenant,
      ref,
      input.failed ? 'ai_failure' : 'ai_handoff',
      waitIn !== null ? { ...options, groupId: waitIn } : options,
    );
  }

  /**
   * The team holding the queue role a `{ topic }` target names (AU-01 ·
   * `resolveQueue`), or null — no topic, a topic that is no queue role (#307
   * maps the guardrails' spellings), or no team holding it.
   */
  async #topicTeam(turn: VisitorTurn, topic: string | undefined): Promise<bigint | null> {
    if (!isQueueTopicRole(topic)) return null;
    const queue = await turn.withTenant((tx) => resolveQueue(tx, turn.tenant.licenseId, topic));
    return queue?.groupId ?? null;
  }

  async #isResponsibleGambling(turn: VisitorTurn, groupId: bigint): Promise<boolean> {
    const team = await turn.withTenant((tx) =>
      tx.group.findFirst({ where: { id: groupId }, select: { topicRole: true } }),
    );
    return team?.topicRole === RESPONSIBLE_GAMBLING_ROLE;
  }

  /** A single-message skill's `transfer_to_team`: the team by its name. */
  async #toTeamNamed(
    turn: VisitorTurn,
    groupName: string,
    options: {
      alongside: (tx: TenantClient) => Promise<void>;
      properties: Record<string, unknown>;
      priority: GuardrailPriority;
    },
  ): Promise<boolean> {
    const { tenant, chatId } = turn;
    const group = await turn.withTenant((tx) =>
      tx.group.findFirst({ where: { name: groupName }, select: { id: true } }),
    );
    if (!group) {
      // The skill names a team that no longer exists. Leaving the conversation
      // where it is means a human still sees it; silently dropping it would not.
      turn.log.warn({ group: groupName }, 'skill targets an unknown team');
      await turn.withTenant(options.alongside);
      return false;
    }

    await this.chats.transfer(
      tenant,
      botPrincipal(tenant),
      chatId,
      { groupId: group.id, reason: 'ai_handoff' },
      options,
    );
    await this.publisher.publish(
      tenant,
      'chat_transferred',
      { allAgents: true },
      { chat_id: chatId, reason: 'ai_handoff', transferred_to: { group_ids: [Number(group.id)] } },
    );
    return true;
  }
}

/**
 * The AI acts as a bot principal, not as an agent.
 *
 * It carries the scopes the engine's own actions need and nothing else, so a
 * skill cannot reach further into the API than the steps it declares.
 */
export function botPrincipal(tenant: { licenseId: bigint; organizationId: string }): BotPrincipal {
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
