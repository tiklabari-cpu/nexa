/**
 * "Talk to an agent" (tm 308 · SiyahTuş analysis AI-29 §3, §4 · G16): the
 * widget's button while the AI answers a connection.
 *
 * The press is the request — no clarifying question, as there may be when the
 * player writes it (AI-09). So, in this order:
 *
 *   1. **One at a time.** Two presses at once — a double click, two tabs —
 *      hand over once: a short Redis claim on the connection; the press that
 *      does not get it answers with the owner as it stands (`requested:
 *      false`). After the hand-over the owner is a person or the queue, which
 *      is the same answer.
 *   2. **Still the AI's** (`customerChatOwner`): a person or the queue that
 *      has it already is left as it is.
 *   3. **The target** (AI-12, tm 307.2): `player_request`'s route, else the
 *      topic's team, else routing — the order every AI hand-over takes.
 *   4. **What the player is told**: the workspace's `player_request` message
 *      (or the default), and, when nobody at the target accepts chats now
 *      (S2), the workspace's after-hours text — or, when it wrote none, "our
 *      agents are offline, back from {time}; your request is saved" with the
 *      next open minute of the work schedules (`business-hours.ts`), or the
 *      default after-hours text when there is no schedule to read.
 *   5. **The hand-over** (`HandoffService.execute`): the card with
 *      `requested_via: 'button'`, the connection to `human` — the AI says
 *      nothing more (AI-11) — the team or its queue, the after-hours ticket
 *      for a player who left an e-mail. The conversation is never dropped.
 *
 * The press rate and the time from the AI's start to the press (AI-25) are
 * read from `ai_handoffs.requested_via` beside its `ai_conversations` row.
 */
import { Prisma } from '@prisma/client';
import {
  customerChatOwner,
  readPersona,
  RESOLUTION_PHRASES,
  RESOLUTION_PROMPT_PROPERTY,
  type AiOutcomeConfirmation,
  type CustomerChatOwner,
  type PersonaLanguage,
} from '@siyahtus/types';
import type { Redis } from 'ioredis';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { aiMayAnswer, readAiMode } from '../chat/ai-mode.js';
import type { ChatService } from '../chat/chat-service.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import type { TurnLogger, VisitorTurn } from '../chat/visitor-turn.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { recordOutcomeTurn } from '../reports/ai-outcomes.js';
import { nextOpenAt } from '../sla/business-hours.js';
import { readBusinessWeek } from '../sla/sla-service.js';
import {
  afterHoursWords,
  DEFAULT_HANDOFF_CONFIG,
  handoffWords,
  type HandoffConfig,
} from './conversation/handoff/triggers.js';
import { languageVerdict } from './conversation/policy.js';
import { loadConversation, type ConnectionRef } from './conversation/state-store.js';
import { publishedConfig } from './config-source.js';
import { HandoffCardService } from './handoff-card.js';
import {
  aimedHandoff,
  anyoneAccepting,
  botPrincipal,
  HandoffService,
  planHandoff,
  resolveTurnTarget,
  targetAccepting,
  type TurnHandoff,
} from './handoff-service.js';

/** How long one press holds the connection against a second. */
const CLAIM_MS = 30_000;

export interface HumanRequestOutcome {
  readonly owner: CustomerChatOwner;
  /** Whether anyone at the hand-over's team (or, with none, in the workspace) accepts chats now. */
  readonly humanAvailable: boolean;
  /** This press handed the connection over. */
  readonly requested: boolean;
}

/** Who pressed, on which connection. */
export interface HumanRequestInput {
  readonly tenant: TenantContext;
  readonly customerId: string;
  readonly ref: ConnectionRef;
  readonly log: TurnLogger;
}

/** What a press of "Yes" or "No" under "is it solved?" left (tm 320.1). */
export interface ResolutionAnswerOutcome {
  readonly answer: AiOutcomeConfirmation;
  /** False when the AI no longer had the connection, or nothing asked. */
  readonly recorded: boolean;
  readonly owner: CustomerChatOwner;
  readonly humanAvailable: boolean;
}

type TenantRunner = <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>;

/** S2's sentence, when the workspace wrote no after-hours text of its own. */
const BACK_AT: Readonly<Record<'tr' | 'en', (time: string) => string>> = {
  tr: (time) =>
    `Temsilcilerimiz şu an çevrimdışı, ${time} itibarıyla dönüş yapılacak; talebiniz kaydedildi.`,
  en: (time) =>
    `Our agents are offline right now and will get back to you from ${time}; your request has been saved.`,
};

/** `{time}`: the hour, with the weekday when it is not today in the workspace's zone. */
export function backAtTime(at: Date, now: Date, timeZone: string, lang: 'tr' | 'en'): string {
  const locale = lang === 'tr' ? 'tr-TR' : 'en-GB';
  const day = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(value);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  if (day(at) === day(now)) return time;
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long' }).format(at);
  return `${weekday} ${time}`;
}

/**
 * What the player hears after hours (AI-29-S2): the workspace's own text when
 * it wrote one; else when the team is back, from the work schedules; else the
 * default after-hours text.
 */
export function humanRequestAfterHoursWords(
  config: HandoffConfig,
  answerIn: PersonaLanguage | null,
  back: { at: Date; now: Date; timeZone: string } | null,
): string {
  if (config.afterHours.text || !back) return afterHoursWords(config, answerIn);
  const lang = answerIn === null || answerIn === 'tr' ? 'tr' : 'en';
  return BACK_AT[lang](backAtTime(back.at, back.now, back.timeZone, lang));
}

export class HumanRequestService {
  readonly #handoffs: HandoffService;

  constructor(
    private readonly db: Parameters<typeof withTenant>[0],
    private readonly redis: Redis,
    private readonly chats: ChatService,
    publisher: RealtimePublisher,
  ) {
    this.#handoffs = new HandoffService(chats, { card: new HandoffCardService(chats, publisher) });
  }

  /** The connection's owner for the widget, read in the caller's transaction. */
  static async ownerOf(
    tx: TenantClient,
    ref: ConnectionRef,
  ): Promise<{ owner: CustomerChatOwner; active: boolean } | null> {
    const thread = await tx.thread.findFirst({
      where: { id: ref.threadId, chatId: ref.chatId },
      select: { active: true, assigneeId: true, queuePosition: true, aiMode: true },
    });
    if (!thread) return null;
    const agent = await tx.aiAgent.findFirst({
      where: { active: true, kind: 'ai_agent' },
      select: { id: true },
    });
    return {
      active: thread.active,
      owner: customerChatOwner({
        assigneeId: thread.assigneeId,
        queuePosition: thread.queuePosition,
        aiMode: thread.aiMode,
        aiAgentActive: agent !== null,
      }),
    };
  }

  async request(input: HumanRequestInput): Promise<HumanRequestOutcome> {
    const outcome = await this.#claimed(input, async (_read, inTenant) => {
      const available = await this.#handOver(input, inTenant, 'player_request');
      return { recorded: true, available };
    });
    return {
      owner: outcome.owner,
      humanAvailable: outcome.humanAvailable,
      requested: outcome.recorded,
    };
  }

  /**
   * "Is it solved?" answered with the widget's buttons (tm 320.1 · AI-25-S2,
   * K9): only under the AI's newest message that asked it or said so
   * ({@link RESOLUTION_PROMPT_PROPERTY}), while the AI has the connection —
   * the same claim as a press of "Talk to an agent", so two presses answer
   * once. The answer goes on the connection's AI outcome
   * (`resolution_confirmation`); then `yes` is thanked in the persona's
   * language — the newest message, so the buttons go — and `no` hands the
   * connection to a person at once with reason `player_said_unresolved`,
   * the way a press of "Talk to an agent" does.
   */
  async answerResolution(
    input: HumanRequestInput & { answer: AiOutcomeConfirmation },
  ): Promise<ResolutionAnswerOutcome> {
    const { tenant, ref, answer } = input;
    const outcome = await this.#claimed(input, async (read, inTenant) => {
      if (read.prompt === null) return null;
      await inTenant((tx) =>
        recordOutcomeTurn(
          tx,
          { licenseId: tenant.licenseId, ...ref },
          {
            at: new Date(),
            memberKey: null,
            aiAgentId: null,
            configVersionId: null,
            language: null,
            intent: null,
            procedureId: null,
            aiTurns: 0,
            playerTurns: 0,
            clarificationTurns: 0,
            requiredSlots: null,
            claimedResolved: read.prompt === 'resolved',
            confirmation: answer,
            guardrailHits: [],
          },
        ),
      );
      if (answer === 'yes') {
        await this.#thank(input, inTenant);
        return { recorded: true, available: read.available, stays: true };
      }
      const available = await this.#handOver(input, inTenant, 'player_said_unresolved');
      return { recorded: true, available };
    });
    return { answer, ...outcome };
  }

  /**
   * A press's one way through: the claim, the owner as it stands, and — when
   * the AI has the open connection — `act`. An `act` that returns null did
   * nothing; `stays`: the AI keeps the connection after it.
   */
  async #claimed(
    input: HumanRequestInput,
    act: (
      read: { available: boolean; prompt: 'asked' | 'resolved' | null },
      inTenant: TenantRunner,
    ) => Promise<{ recorded: boolean; available: boolean; stays?: boolean } | null>,
  ): Promise<{ owner: CustomerChatOwner; humanAvailable: boolean; recorded: boolean }> {
    const { tenant, ref, log } = input;
    const inTenant: TenantRunner = (fn) => withTenant(this.db, tenant, fn);
    const claim = `siyahtus:human-request:${tenant.licenseId}:${ref.threadId}`;
    const claimed = await this.redis.set(claim, '1', 'PX', CLAIM_MS, 'NX');
    try {
      const read = await inTenant(async (tx) => {
        const owned = await HumanRequestService.ownerOf(tx, ref);
        const mode = await readAiMode(tx, ref);
        const available = await anyoneAccepting(tx, tenant.licenseId);
        const prompt = await pendingResolutionPrompt(tx, ref);
        return { owned, mode, available, prompt };
      });
      if (!read.owned?.active) {
        return { owner: 'queue', humanAvailable: read.available, recorded: false };
      }
      if (claimed !== 'OK' || read.owned.owner !== 'ai' || !aiMayAnswer(read.mode)) {
        return { owner: read.owned.owner, humanAvailable: read.available, recorded: false };
      }
      const done = await act(read, inTenant);
      if (!done) {
        return { owner: read.owned.owner, humanAvailable: read.available, recorded: false };
      }
      if (done.stays) {
        return { owner: 'ai', humanAvailable: done.available, recorded: done.recorded };
      }
      const after = await inTenant((tx) => HumanRequestService.ownerOf(tx, ref));
      return {
        owner: after?.owner === 'ai' ? 'queue' : (after?.owner ?? 'queue'),
        humanAvailable: done.available,
        recorded: done.recorded,
      };
    } catch (error) {
      log.error({ err: error }, 'the player asked for a person and the hand-over failed');
      throw error;
    } finally {
      if (claimed === 'OK') await this.redis.del(claim).catch(() => undefined);
    }
  }

  /** What the AI's words are chosen by: the published configuration and the player's newest message. */
  async #context(ref: ConnectionRef, tenant: TenantContext, now: Date, inTenant: TenantRunner) {
    const read = await inTenant(async (tx) => {
      const conversation = await loadConversation(tx, ref);
      const config = await publishedConfig.forTurn(tx, {
        aiAgentId: null,
        pinnedVersionId: conversation?.configVersionId ?? null,
      });
      const [last] = await tx.$queryRaw<Array<{ text: string | null }>>(Prisma.sql`
        SELECT text FROM events
         WHERE thread_id = ${ref.threadId} AND chat_id = ${ref.chatId}
           AND author_type = 'customer' AND recipients = 'all' AND type = 'message'
         ORDER BY event_sequence DESC
         LIMIT 1`);
      const { timezone } = await readDayBoundary(tx);
      const week = await readBusinessWeek(tx, tenant, now);
      return { config, text: last?.text ?? '', timezone, week };
    });
    const persona = read.config.pkg.skills[0]?.persona ?? readPersona(null);
    const language = languageVerdict(read.text, persona, null);
    const answerIn = language.unsupported ? 'en' : language.answerIn;
    return { ...read, answerIn };
  }

  /** The player said yes: the AI's thanks, as the `resolve` step says it (`RESOLUTION_PHRASES`). */
  async #thank(input: HumanRequestInput, inTenant: TenantRunner): Promise<void> {
    const { tenant, ref } = input;
    const read = await this.#context(ref, tenant, new Date(), inTenant);
    await this.chats.sendEvent(tenant, botPrincipal(tenant), ref.chatId, {
      type: 'message',
      text: RESOLUTION_PHRASES[read.answerIn ?? 'tr'].thanks,
      recipients: 'all',
      properties: { resolution_answer: 'yes' },
    });
    input.log.info({ resolution_answer: 'yes' }, 'the player confirmed the ai solved it');
  }

  async #handOver(
    input: HumanRequestInput,
    inTenant: TenantRunner,
    reason: 'player_request' | 'player_said_unresolved',
  ): Promise<boolean> {
    const { tenant, ref, log } = input;
    const now = new Date();
    const read = await this.#context(ref, tenant, now, inTenant);
    const handoff = read.config.pkg.handoff ?? DEFAULT_HANDOFF_CONFIG;
    const { answerIn } = read;
    const pressed = reason === 'player_request';

    const effect: TurnHandoff = {
      kind: 'handoff',
      team: null,
      reason,
      reasons: [reason],
      priority: 'normal',
    };
    const { target, available } = await inTenant(async (tx) => {
      const target = await resolveTurnTarget(
        tx,
        { ...ref, licenseId: tenant.licenseId, brandId: tenant.brandId ?? null },
        effect,
        handoff.routes ?? [],
      );
      return { target, available: await targetAccepting(tx, tenant.licenseId, target) };
    });

    const words = handoffWords(handoff, reason, answerIn) as string;
    const back = read.week ? nextOpenAt(read.week, now) : null;
    // Open by the schedule but nobody accepting: no "back at" to promise.
    const backAt =
      back && back.getTime() > now.getTime() + 60_000
        ? { at: back, now, timeZone: read.timezone }
        : null;
    const text = available
      ? words
      : `${words}\n${humanRequestAfterHoursWords(handoff, answerIn, backAt)}`;

    const turn: VisitorTurn = {
      tenant,
      chatId: ref.chatId,
      threadId: ref.threadId,
      customerId: input.customerId,
      triggerEventId: '',
      requestId: null,
      log,
      withTenant: inTenant,
      requireAiInference: async () => undefined,
      requireAiBudget: async () => undefined,
      replyProperties: {},
      replyOutbox: async () => undefined,
      identityTrust: 'claimed',
    };
    await this.chats.sendEvent(tenant, botPrincipal(tenant), ref.chatId, {
      type: 'message',
      text,
      recipients: 'all',
      properties: pressed ? { requested_via: 'button' } : { resolution_answer: 'no' },
    });
    const aimedAt = aimedHandoff(effect, target);
    await this.#handoffs.execute(turn, ref, aimedAt, {
      plan: planHandoff(aimedAt, false),
      failed: false,
      card: {
        result: null,
        trust: null,
        turnText: null,
        ...(pressed ? { requestedVia: 'button' as const } : {}),
      },
      target,
      afterHours: !available,
    });
    log.info(
      {
        handoff_reason: reason,
        ...(pressed ? { requested_via: 'button' } : { resolution_answer: 'no' }),
        after_hours: !available,
      },
      pressed ? 'the player asked for a person' : 'the player said the ai did not solve it',
    );
    return available;
  }
}

/**
 * The prompt the buttons answer: the connection's newest message, when it is
 * the AI's and carries {@link RESOLUTION_PROMPT_PROPERTY}. Anything written
 * after it — the player's words, the thanks, a hand-over — takes the buttons
 * away.
 */
export async function pendingResolutionPrompt(
  tx: TenantClient,
  ref: ConnectionRef,
): Promise<'asked' | 'resolved' | null> {
  const [newest] = await tx.$queryRaw<Array<{ author_type: string; prompt: string | null }>>(
    Prisma.sql`
      SELECT author_type, properties ->> ${RESOLUTION_PROMPT_PROPERTY} AS prompt FROM events
       WHERE thread_id = ${ref.threadId} AND chat_id = ${ref.chatId}
         AND recipients = 'all' AND type = 'message'
       ORDER BY event_sequence DESC
       LIMIT 1`,
  );
  if (!newest || newest.author_type !== 'bot') return null;
  return newest.prompt === 'asked' || newest.prompt === 'resolved' ? newest.prompt : null;
}
