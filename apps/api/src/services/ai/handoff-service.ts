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
 *   3. **the target** (AI-12, tm 307.2): the team `resolveHandoffTarget`
 *      settles on (`conversation/handoff/target-resolver.ts` — the step's,
 *      the rule's, a reason or topic route, the topic's team, the same-day
 *      return, the fallback team for one that is gone), by id, so a renamed
 *      team still receives it. Someone there takes it — trained, when its
 *      route requires an expertise — or it waits in that team's queue: never
 *      refused for an empty desk, and urgent when only the trained may take
 *      it (AI-12-S3). No team: whoever routing gives it; a team that cannot
 *      take it at all (nobody belongs to it): routing too, except that the
 *      Responsible Gambling team's waits in its own queue (ADR-08a §2.6);
 *   4. **after hours** (AI-12 §4): nobody there accepting chats, and the
 *      player left an e-mail — a ticket from the conversation, once;
 *   5. **the pushes**: the transfer and the AI mode, to the teams that watch.
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
import { resolveQueue } from '../routing/queues.js';
import { TicketService } from '../tickets/ticket-service.js';
import {
  HANDOFF_ROUTE_SELECT,
  readHandoffRoute,
  resolveHandoffTarget,
  type HandoffRouteConfig,
  type HandoffTarget,
  type HandoffTargetInput,
  type HandoffTargetLookup,
} from './conversation/handoff/target-resolver.js';
import { morePressing } from './conversation/handoff/rules.js';
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
 * Whether anyone in the workspace is accepting chats now — the after-hours
 * text's question (AI-12 §4) before the target is known, and for a hand-over
 * routing places.
 */
export async function anyoneAccepting(tx: TenantClient, licenseId: bigint): Promise<boolean> {
  const accepting = await tx.agentMembership.count({
    where: { licenseId, routingStatus: 'accepting_chats', suspended: false },
  });
  return accepting > 0;
}

/**
 * Whether anyone could take the hand-over at its target now (AI-12 §4): a
 * member of the team accepting chats who holds what the team and the route
 * require — or, with no team, anyone in the workspace. Load is not asked: a
 * full desk answers soon, an empty one after hours.
 */
export async function targetAccepting(
  tx: TenantClient,
  licenseId: bigint,
  target: HandoffTarget,
): Promise<boolean> {
  if (target.groupId === null) return anyoneAccepting(tx, licenseId);
  // A team nobody belongs to cannot take it (IN-04): routing places it, as
  // with no team — save the Responsible Gambling team's, which waits in its queue.
  const team = await tx.group.findUnique({
    where: { licenseId_id: { licenseId, id: target.groupId } },
    select: { topicRole: true, _count: { select: { agents: true } } },
  });
  if (!team || (team._count.agents === 0 && team.topicRole !== RESPONSIBLE_GAMBLING_ROLE)) {
    return anyoneAccepting(tx, licenseId);
  }
  const route = target.requiredExpertiseId === null ? [] : [String(target.requiredExpertiseId)];
  const [row] = await tx.$queryRaw<Array<{ accepting: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM group_agents ga
      JOIN agent_memberships m ON m.license_id = ga.license_id AND m.agent_id = ga.agent_id
      WHERE ga.license_id = ${licenseId}
        AND ga.group_id = ${target.groupId}
        AND m.routing_status = 'accepting_chats'
        AND NOT m.suspended
        AND NOT m.awaiting_approval
        AND NOT EXISTS (
          SELECT 1
          FROM (
            SELECT ge.expertise_id AS id
            FROM group_expertise ge
            WHERE ge.license_id = ga.license_id AND ge.group_id = ga.group_id
            UNION
            SELECT unnest(${route}::text[])::bigint
          ) need
          WHERE NOT EXISTS (
            SELECT 1 FROM agent_expertise ae
            WHERE ae.license_id = ga.license_id
              AND ae.agent_id = ga.agent_id
              AND ae.expertise_id = need.id
          )
        )
    ) AS accepting
  `;
  return row?.accepting === true;
}

/**
 * The live reads the target order makes (`target-resolver.ts`), in the
 * caller's transaction — row level security keeps them to the workspace.
 */
export function handoffTargetLookup(
  tx: TenantClient,
  at: { licenseId: bigint; chatId: string; threadId: string },
): HandoffTargetLookup {
  const { licenseId, chatId, threadId } = at;
  return {
    async groupExists(groupId) {
      const team = await tx.group.findUnique({
        where: { licenseId_id: { licenseId, id: groupId } },
        select: { id: true },
      });
      return team !== null;
    },
    async teamNamed(name) {
      const team = await tx.group.findFirst({
        where: { name },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      return team?.id ?? null;
    },
    async liveRoute(matchType, matchKey, brandId) {
      const row = await tx.handoffRoute.findFirst({
        where: { matchType, matchKey, brandId, active: true },
        select: HANDOFF_ROUTE_SELECT,
      });
      return row ? readHandoffRoute(row) : null;
    },
    async roleTeam(role) {
      return (await resolveQueue(tx, licenseId, role))?.groupId ?? null;
    },
    async sameDay() {
      // The day's previous hand-over (the chat is the day, ID-02): the team
      // its connection ended up with, and the agent who had it.
      const earlier = await tx.aiHandoff.findFirst({
        where: { chatId, threadId: { not: threadId } },
        orderBy: { createdAt: 'desc' },
        select: { targetGroupId: true, thread: { select: { groupId: true, assigneeId: true } } },
      });
      const groupId = earlier?.thread.groupId ?? earlier?.targetGroupId ?? null;
      return groupId !== null ? { groupId, agentId: earlier?.thread.assigneeId ?? null } : null;
    },
    async fallbackGroup() {
      const rule = await tx.routingRule.findFirst({
        where: { kind: 'chat', isFallback: true, enabled: true },
        select: { targetGroupId: true },
      });
      return rule?.targetGroupId ?? null;
    },
  };
}

/**
 * The hand-over with its target's route priority as a floor (AI-12 §3): what
 * its plan, its events and its card say, and what the connection waits with.
 */
export function aimedHandoff(effect: TurnHandoff, target: HandoffTarget): TurnHandoff {
  if (!target.priority) return effect;
  return { ...effect, priority: morePressing(effect.priority ?? 'normal', target.priority) };
}

/** The target of a turn's hand-over, by the order in `target-resolver.ts`. */
export function resolveTurnTarget(
  tx: TenantClient,
  at: { licenseId: bigint; chatId: string; threadId: string; brandId: string | null },
  effect: TurnHandoff,
  routes: readonly HandoffRouteConfig[],
): Promise<HandoffTarget> {
  return resolveHandoffTarget(
    turnTargetInput(effect, routes, at.brandId),
    handoffTargetLookup(tx, at),
  );
}

/**
 * Where a simulated conversation's hand-over would land (tm 314.2 · AI-19 §3,
 * the `team` check): the order a live one follows, read in the simulation's
 * read-only transaction. A simulated conversation has no day before it, so
 * no earlier hand-over's team.
 */
export function resolveSimulatedTarget(
  tx: TenantClient,
  licenseId: bigint,
  effect: TurnHandoff,
  routes: readonly HandoffRouteConfig[],
  brandId: string | null,
): Promise<HandoffTarget> {
  const lookup = handoffTargetLookup(tx, { licenseId, chatId: '', threadId: '' });
  return resolveHandoffTarget(turnTargetInput(effect, routes, brandId), {
    ...lookup,
    sameDay: async () => null,
  });
}

/** A turn's hand-over as the target order reads it. */
function turnTargetInput(
  effect: TurnHandoff,
  routes: readonly HandoffRouteConfig[],
  brandId: string | null,
): HandoffTargetInput {
  return {
    ...(effect.groupId !== undefined ? { groupId: effect.groupId } : {}),
    team: effect.team,
    ...(effect.topic !== undefined ? { topic: effect.topic } : {}),
    ...(effect.ruleId !== undefined ? { ruleId: effect.ruleId } : {}),
    reasons: orderHandoffReasons(effect.reasons ?? [catalogueReason(effect.reason)]),
    routes,
    brandId,
  };
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
  readonly #tickets = new TicketService();

  constructor(
    private readonly chats: ChatService,
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
      /**
       * Where it goes (tm 307.2), resolved by the caller with the routes the
       * turn ran on; absent: resolved here, with none.
       */
      target?: HandoffTarget;
      /** Nobody at the target accepting chats (AI-12 §4): a ticket when the player left an e-mail. */
      afterHours?: boolean;
    },
  ): Promise<boolean> {
    const { plan } = input;
    const target =
      input.target ??
      (await turn.withTenant((tx) =>
        resolveTurnTarget(
          tx,
          { ...ref, licenseId: turn.tenant.licenseId, brandId: turn.tenant.brandId ?? null },
          effect,
          [],
        ),
      ));
    const card = this.#card;
    let written: WrittenHandoffCard | null = null;
    // The card names the team the hand-over goes to, whichever step named it.
    const carded: TurnHandoff =
      target.groupId !== null ? { ...effect, groupId: Number(target.groupId) } : effect;
    const alongside = async (tx: TenantClient): Promise<void> => {
      await input.alongside?.(tx);
      if (card) {
        written = await card.write(tx, {
          tenant: turn.tenant,
          chatId: ref.chatId,
          threadId: ref.threadId,
          handoff: plan,
          effect: carded,
          context: input.card ?? { result: null, trust: null, turnText: null },
        });
      }
      if (input.afterHours) {
        const summary = (written as WrittenHandoffCard | null)?.summary ?? null;
        await this.#afterHoursTicket(tx, turn.tenant, ref.chatId, summary ?? plan.primaryReason);
      }
    };
    // The hand-over's priority is the connection's from here on (ADR-08a
    // §2.3): urgent waits at the front of its team's queue.
    const options = {
      alongside,
      properties: handoffEventProperties(plan),
      priority: plan.priority,
      priorityReason: plan.primaryReason,
    };
    const handedOver = await this.#execute(turn, ref, target, input, options);
    // Once committed: the card reaches the agents who see the conversation.
    const done = written as WrittenHandoffCard | null;
    if (card && done) await card.announce(turn.tenant, done);
    return handedOver;
  }

  async #execute(
    turn: VisitorTurn,
    ref: ConnectionRef,
    target: HandoffTarget,
    input: {
      plan: PlannedHandoff;
      failed: boolean;
      alongside?: (tx: TenantClient) => Promise<void>;
    },
    options: {
      alongside: (tx: TenantClient) => Promise<void>;
      properties: Record<string, unknown>;
      priority: GuardrailPriority;
      priorityReason: string;
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

    const { tenant, chatId } = turn;
    const { groupId } = target;
    // The route's priority is a floor beside the hand-over's own (AI-12 §3).
    const pressed = {
      ...options,
      priority: target.priority
        ? morePressing(options.priority, target.priority)
        : options.priority,
    };
    if (groupId !== null && !input.failed) {
      try {
        await this.chats.transfer(
          tenant,
          botPrincipal(tenant),
          chatId,
          {
            groupId,
            reason: 'ai_handoff',
            requiredExpertiseId: target.requiredExpertiseId,
            preferAgentId: target.preferAgentId,
          },
          // Only the trained may take it: it waits at the front (AI-12-S3).
          target.requiredExpertiseId !== null ? { ...pressed, queuedPriority: 'urgent' } : pressed,
        );
        return true;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        turn.log.warn(
          { group_id: Number(groupId), err_type: error.type },
          'hand-over team cannot take the conversation; routing it instead',
        );
      }
    }
    // Routing places it: in the target team's pool when there is one (ADR-08a
    // §2.4) — a failed turn's, or one whose team nobody belongs to. The
    // Responsible Gambling team has no other team to give its conversations
    // to (§2.6): one it cannot take waits in its queue.
    return this.chats.handOverFromAi(
      tenant,
      ref,
      input.failed ? 'ai_failure' : 'ai_handoff',
      groupId !== null && (input.failed || (await this.#isResponsibleGambling(turn, groupId)))
        ? { ...pressed, groupId }
        : pressed,
    );
  }

  async #isResponsibleGambling(turn: VisitorTurn, groupId: bigint): Promise<boolean> {
    const team = await turn.withTenant((tx) =>
      tx.group.findFirst({ where: { id: groupId }, select: { topicRole: true } }),
    );
    return team?.topicRole === RESPONSIBLE_GAMBLING_ROLE;
  }

  /**
   * After hours (AI-12 §4 · HD-01): the player who left an e-mail is answered
   * by ticket — one from the conversation, unless one is open for it already.
   * In the hand-over's transaction, so a refused attempt leaves none behind.
   */
  async #afterHoursTicket(
    tx: TenantClient,
    tenant: TenantContext,
    chatId: string,
    subject: string,
  ): Promise<void> {
    const chat = await tx.chat.findUnique({
      where: { id: chatId },
      select: { customerId: true, customer: { select: { email: true } } },
    });
    if (!chat?.customer.email) return;
    const open = await tx.ticket.findFirst({
      where: { sourceChatId: chatId, status: { in: ['open', 'pending'] } },
      select: { id: true },
    });
    if (open) return;
    await this.#tickets.createFromWidget(tx, tenant, {
      subject: subject.slice(0, AFTER_HOURS_TICKET_SUBJECT_MAX),
      customerId: chat.customerId,
      sourceChatId: chatId,
    });
  }
}

/** How much of the card's summary an after-hours ticket's subject keeps. */
const AFTER_HOURS_TICKET_SUBJECT_MAX = 140;

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
