/**
 * Slots through `ai_conversations` (tm 295.3 · SiyahTuş analysis AI-04 §4–§9,
 * AI-02 §5) — against mock understanding output; the real call is #297.
 *
 * A connection's turns read the slots from the row, apply the turn's
 * extraction, plan the questions and save — the way the procedure executor
 * (#296.3) will. Asserted on what the database holds, and on what the day's
 * next connection makes of it:
 *
 *   1. one message fills several slots; words that are not the player's are
 *      never stored; a correction overwrites and keeps the old value; a moment
 *      asked twice stays partial;
 *   2. a `pii: 'high'` value is on the connection's row and nowhere in its
 *      summary;
 *   3. the next connection the same day starts with the settled slots carried
 *      and asks only what is still open — the partial moment, the pii slot.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId, validateSlotDef, type SlotDef } from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import {
  buildDigest,
  loadEarlierToday,
  withEarlierToday,
} from '../../src/services/ai/conversation/daily-memory.js';
import {
  applyExtraction,
  planQuestions,
  slotCardLines,
  type SlotUnderstanding,
} from '../../src/services/ai/conversation/slots/extract.js';
import {
  loadConversation,
  openConversation,
  saveConversation,
  type ConnectionRef,
} from '../../src/services/ai/conversation/state-store.js';
import { emptyTurnState, toTurnState } from '../../src/services/ai/conversation/turn.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const PROCEDURE = 'deposit_not_credited';

function slot(def: Record<string, unknown>): SlotDef {
  const result = validateSlotDef(def);
  if (result.slot === null) throw new Error(JSON.stringify(result.problems));
  return result.slot;
}

const DEFS: SlotDef[] = [
  slot({
    name: 'yontem',
    label: 'Yöntem',
    type: 'enum',
    ask: 'Hangi yöntemle yatırdınız?',
    validate: { enum_values: ['Papara', 'Havale'] },
  }),
  slot({ name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar yatırdınız?' }),
  slot({
    name: 'islem_zamani',
    label: 'İşlem zamanı',
    type: 'datetime',
    ask: 'Ne zaman yatırdınız?',
    ask_variants: ['Yatırımı yaptığınız saati yazar mısınız?'],
  }),
  slot({
    name: 'iban_son4',
    label: 'IBAN son 4 hane',
    type: 'iban_last4',
    ask: 'Gönderdiğiniz IBAN’ın son 4 hanesi nedir?',
    pii: 'high',
  }),
];

/** Saturday 2026-10-17 16:00 Istanbul. */
const NOW = new Date('2026-10-17T13:00:00Z');

describe('slots through ai_conversations (AI-04 · AI-02 §5)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    await app.$connect();
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  /** A chat filed under today, and a connection (thread) on it. */
  async function seedChat(t: TenantFixture): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: customer.id,
        localDay: new Date('2026-10-17T00:00:00Z'),
        dayTz: 'Europe/Istanbul',
      },
    });
    return chatId;
  }

  async function seedThread(t: TenantFixture, chatId: string): Promise<ConnectionRef> {
    const threadId = generateShortId();
    await owner.thread.create({ data: { id: threadId, chatId, licenseId: t.licenseId } });
    return { chatId, threadId };
  }

  /**
   * One AI turn: read the row, apply the mock understanding, plan the
   * questions, save the slots, the turn count and the summary in one write.
   */
  async function takeTurn(
    t: TenantFixture,
    ref: ConnectionRef,
    message: string,
    understanding: SlotUnderstanding,
  ) {
    return withTenant(app, ctx(t), async (tx) => {
      const row =
        (await loadConversation(tx, ref)) ??
        (await openConversation(tx, ref, { configVersionId: null }));
      const state = toTurnState(row);
      const turn = Number(state.counters['turns'] ?? 0) + 1;
      const applied = applyExtraction({
        defs: DEFS,
        slots: state.slots,
        understanding,
        messages: [message],
        turn,
        now: NOW,
        timeZone: 'Europe/Istanbul',
        currency: 'TRY',
      });
      const plan = planQuestions({ defs: DEFS, slots: applied.slots, turn });
      const reply = plan.questions.map((q) => q.text).join(' ') || null;
      const next = { ...state, slots: plan.slots, counters: { ...state.counters, turns: turn } };
      const digest = buildDigest(state.digest, next, {
        skill: { id: PROCEDURE, name: 'Yatırım geçmedi' },
        intent: 'deposit',
        outcome: 'answered',
        reply,
        replyKind: reply ? 'question' : null,
        sideEffects: [],
      });
      await saveConversation(tx, row, {
        slots: next.slots,
        counters: next.counters,
        digest: digest as never,
      });
      return { applied, plan };
    });
  }

  it('fills several slots from one message, never stores words the player did not write, and corrects', async () => {
    const chatId = await seedChat(fx.a);
    const ref = await seedThread(fx.a, chatId);

    const first = await takeTurn(
      fx.a,
      ref,
      'dün akşam papara ile 2,5 bin attım, ibanımın sonu 8841',
      {
        extracted: [
          { slot: 'yontem', raw_text: 'papara', value: 'Papara', confidence: 0.95 },
          { slot: 'tutar', raw_text: '2,5 bin', value: 2500, confidence: 0.9 },
          { slot: 'islem_zamani', raw_text: 'dün akşam', confidence: 0.8 },
          // The model "heard" a time nobody wrote — the shield drops it.
          { slot: 'islem_zamani', raw_text: 'saat 21:40', value: '21:40', confidence: 0.7 },
          { slot: 'iban_son4', raw_text: '8841', confidence: 0.9 },
        ],
      },
    );
    expect(first.plan.questions).toEqual([
      {
        slot: 'islem_zamani',
        attempt: 1,
        because: 'partial',
        text: '16.10.2026 akşam — saat kaç civarıydı?',
      },
    ]);

    await takeTurn(fx.a, ref, 'pardon 3 bin olacak', {
      extracted: [{ slot: 'tutar', raw_text: '3 bin', confidence: 0.9 }],
      correction: ['tutar'],
    });
    const third = await takeTurn(fx.a, ref, 'bilmem ki', { extracted: [] });
    // Asked twice (the variant the second time); the day stands, nothing refused.
    expect(third.plan.questions).toEqual([]);
    expect(third.plan.refused).toEqual([]);

    const row = await owner.aiConversation.findFirstOrThrow({
      where: { threadId: ref.threadId },
      select: { slots: true, digest: true },
    });
    const slots = row.slots as Record<string, Record<string, unknown>>;
    expect(slots['yontem']).toMatchObject({ value: 'Papara', status: 'filled', turn: 1 });
    expect(slots['tutar']).toMatchObject({
      value: { amount: 3000, currency: 'TRY' },
      display: '3.000 TRY',
      status: 'filled',
      turn: 2,
      previous_values: [{ amount: 2500, currency: 'TRY' }],
    });
    expect(slots['islem_zamani']).toMatchObject({
      value: { date: '2026-10-16', time: null, part_of_day: 'evening' },
      status: 'partial',
      attempts: 2,
    });
    expect(JSON.stringify(slots)).not.toContain('21:40');
    expect(slotCardLines(DEFS, slots).map((line) => `${line.label}: ${line.text}`)).toEqual([
      'Yöntem: Papara',
      'Tutar: 3.000 TRY',
      'İşlem zamanı: 16.10.2026 akşam',
      'IBAN son 4 hane: 8841',
    ]);

    // The pii high value: on the row, not in the summary.
    expect(slots['iban_son4']).toMatchObject({ value: '8841', status: 'filled', pii: 'high' });
    expect((row.digest as { slots: unknown }).slots).toEqual({
      yontem: { display: 'Papara', status: 'filled' },
      tutar: { display: '3.000 TRY', status: 'filled' },
      islem_zamani: { display: '16.10.2026 akşam', status: 'partial' },
    });
    expect(JSON.stringify(row.digest)).not.toContain('8841');
  });

  it('starts the day’s next connection with the settled slots carried and asks only what is open', async () => {
    const chatId = await seedChat(fx.a);
    const earlierRef = await seedThread(fx.a, chatId);
    await takeTurn(fx.a, earlierRef, 'dün akşam papara ile 2,5 bin attım, sonu 8841', {
      extracted: [
        { slot: 'yontem', raw_text: 'papara' },
        { slot: 'tutar', raw_text: '2,5 bin' },
        { slot: 'islem_zamani', raw_text: 'dün akşam' },
        { slot: 'iban_son4', raw_text: '8841' },
      ],
    });

    // One open connection per chat: the earlier one has ended.
    await owner.thread.update({
      where: { id: earlierRef.threadId },
      data: { active: false, closedAt: new Date(NOW.getTime() - 60_000) },
    });
    const ref = await seedThread(fx.a, chatId);
    const plan = await withTenant(app, ctx(fx.a), async (tx) => {
      const earlier = await loadEarlierToday(tx, ref, {
        trust: 'verified',
        recall: 'auto_if_unresolved',
      });
      expect(earlier?.digests).toHaveLength(1);
      const state = withEarlierToday(emptyTurnState(), earlier!, PROCEDURE);
      expect(state.slots).toEqual({
        yontem: { display: 'Papara', status: 'carried' },
        tutar: { display: '2.500 TRY', status: 'carried' },
      });
      return planQuestions({ defs: DEFS, slots: state.slots, turn: 1 });
    });
    expect(plan.questions.map((q) => [q.slot, q.because])).toEqual([
      ['islem_zamani', 'missing'],
      ['iban_son4', 'missing'],
    ]);

    // Another workspace sees nothing of it.
    const other = await withTenant(app, ctx(fx.b), (tx) =>
      loadEarlierToday(tx, ref, { trust: 'verified', recall: 'auto_if_unresolved' }),
    );
    expect(other).toBeNull();
  });
});
