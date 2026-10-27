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
import { readAndCompile } from './conversation/turn-config.js';
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

  async request(input: {
    tenant: TenantContext;
    customerId: string;
    ref: ConnectionRef;
    log: TurnLogger;
  }): Promise<HumanRequestOutcome> {
    const { tenant, ref, log } = input;
    const inTenant = <T>(fn: (tx: TenantClient) => Promise<T>): Promise<T> =>
      withTenant(this.db, tenant, fn);
    const claim = `siyahtus:human-request:${tenant.licenseId}:${ref.threadId}`;
    const claimed = await this.redis.set(claim, '1', 'PX', CLAIM_MS, 'NX');
    try {
      const read = await inTenant(async (tx) => {
        const owned = await HumanRequestService.ownerOf(tx, ref);
        const mode = await readAiMode(tx, ref);
        const available = await anyoneAccepting(tx, tenant.licenseId);
        return { owned, mode, available };
      });
      if (!read.owned?.active)
        return { owner: 'queue', humanAvailable: read.available, requested: false };
      if (claimed !== 'OK' || read.owned.owner !== 'ai' || !aiMayAnswer(read.mode)) {
        return { owner: read.owned.owner, humanAvailable: read.available, requested: false };
      }
      const available = await this.#handOver(input, inTenant);
      const after = await inTenant((tx) => HumanRequestService.ownerOf(tx, ref));
      return {
        owner: after?.owner === 'ai' ? 'queue' : (after?.owner ?? 'queue'),
        humanAvailable: available,
        requested: true,
      };
    } catch (error) {
      log.error({ err: error }, 'the player asked for a person and the hand-over failed');
      throw error;
    } finally {
      if (claimed === 'OK') await this.redis.del(claim).catch(() => undefined);
    }
  }

  async #handOver(
    input: { tenant: TenantContext; customerId: string; ref: ConnectionRef; log: TurnLogger },
    inTenant: <T>(fn: (tx: TenantClient) => Promise<T>) => Promise<T>,
  ): Promise<boolean> {
    const { tenant, ref, log } = input;
    const now = new Date();
    const read = await inTenant(async (tx) => {
      const conversation = await loadConversation(tx, ref);
      const config = await readAndCompile.forTurn(tx, {
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
    const handoff = read.config.pkg.handoff ?? DEFAULT_HANDOFF_CONFIG;
    const persona = read.config.pkg.skills[0]?.persona ?? readPersona(null);
    const language = languageVerdict(read.text, persona, null);
    const answerIn = language.unsupported ? 'en' : language.answerIn;

    const effect: TurnHandoff = {
      kind: 'handoff',
      team: null,
      reason: 'player_request',
      reasons: ['player_request'],
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

    const words = handoffWords(handoff, 'player_request', answerIn) as string;
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
      properties: { requested_via: 'button' },
    });
    const aimedAt = aimedHandoff(effect, target);
    await this.#handoffs.execute(turn, ref, aimedAt, {
      plan: planHandoff(aimedAt, false),
      failed: false,
      card: { result: null, trust: null, turnText: null, requestedVia: 'button' },
      target,
      afterHours: !available,
    });
    log.info(
      { handoff_reason: 'player_request', requested_via: 'button', after_hours: !available },
      'the player asked for a person',
    );
    return available;
  }
}
