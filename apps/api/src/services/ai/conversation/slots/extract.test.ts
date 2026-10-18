/**
 * The understanding call's slots → the conversation's slots (tm 295.3 · AI-04
 * §4–§9): the shape check, the traceability shield, statuses, the attempt
 * counter, corrections, refusals, attachments and the card — against mock
 * understanding output (#297 brings the real call).
 */
import { validateSlotDef, type SlotDef, type SlotValue } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { digestSlots } from '../../../chat/ai-digest.js';
import {
  applyExtraction,
  parseExtracted,
  planQuestions,
  receivedLine,
  slotCardLines,
  slotRecord,
  tracesTo,
  type SlotTurnInput,
} from './extract.js';

/** A definition as the save-time validator would have stored it. */
function slot(def: Record<string, unknown>): SlotDef {
  const result = validateSlotDef({ label: 'Label', ask: 'Question?', ...def });
  if (result.slot === null) throw new Error(JSON.stringify(result.problems));
  return result.slot;
}

const yontem = slot({
  name: 'yontem',
  label: 'Yöntem',
  type: 'enum',
  ask: 'Hangi yöntemle yatırdınız?',
  validate: { enum_values: ['Papara', 'Havale', 'USDT'] },
});
const tutar = slot({
  name: 'tutar',
  label: 'Tutar',
  type: 'money',
  ask: 'Ne kadar yatırdınız?',
  ask_variants: ['Yatırdığınız tutarı yazar mısınız?'],
  validate: { min: 100, max: 50000 },
});
const islemZamani = slot({
  name: 'islem_zamani',
  label: 'İşlem zamanı',
  card_label: 'Zaman',
  type: 'datetime',
  ask: 'Ne zaman yatırdınız?',
});
const ag = slot({
  name: 'ag',
  label: 'Ağ',
  type: 'crypto_network',
  ask: 'Hangi ağ?',
  required: 'never',
});
const txid = slot({
  name: 'txid',
  label: 'TXID',
  type: 'txid',
  ask: 'İşlem numarasını (TXID) yazar mısınız?',
  ask_variants: ['TXID’yi kopyalayıp yapıştırabilir misiniz?'],
  validate: { network_aware: true },
});
const dekont = slot({
  name: 'dekont',
  label: 'Dekont',
  type: 'file',
  ask: 'Dekontu gönderir misiniz?',
});
const ibanSon4 = slot({
  name: 'iban_son4',
  label: 'IBAN son 4 hane',
  type: 'iban_last4',
  ask: 'Gönderdiğiniz IBAN’ın son 4 hanesi nedir?',
  pii: 'high',
});

const DEPOSIT = [yontem, tutar, islemZamani];
const TRON_TXID = 'b3c5a8f1d2e4c6a8b0d1f3e5a7c9b1d3f5e7a9c1b3d5f7e9a1c3b5d7f9e1a3c5';
const EVM_TXID = `0x${TRON_TXID}`;

/** Saturday 2026-10-17 16:00 Istanbul. */
const NOW = new Date('2026-10-17T13:00:00Z');

function turn(
  message: string,
  extracted: unknown,
  overrides: Partial<SlotTurnInput> = {},
): SlotTurnInput {
  return {
    defs: DEPOSIT,
    slots: {},
    understanding: { extracted },
    messages: [message],
    turn: 1,
    now: NOW,
    timeZone: 'Europe/Istanbul',
    currency: 'TRY',
    ...overrides,
  };
}

function record(slots: Record<string, unknown>, name: string): SlotValue {
  return slots[name] as SlotValue;
}

describe('one message, several slots (AI-04 kabul: "dün akşam papara ile 2,5 bin attım")', () => {
  it('fills the method and the amount, keeps the moment partial, and asks only the time', () => {
    const message = 'dün akşam papara ile 2,5 bin attım';
    const first = applyExtraction(
      turn(message, [
        { slot: 'yontem', raw_text: 'papara', value: 'Papara', confidence: 0.95 },
        { slot: 'tutar', raw_text: '2,5 bin', value: 2500, confidence: 0.9 },
        { slot: 'islem_zamani', raw_text: 'dün akşam', value: '2026-10-16', confidence: 0.8 },
      ]),
    );
    expect(record(first.slots, 'yontem')).toMatchObject({
      value: 'Papara',
      display: 'Papara',
      status: 'filled',
      source: 'player',
      confidence: 0.95,
      turn: 1,
      attempts: 0,
    });
    expect(record(first.slots, 'tutar')).toMatchObject({
      value: { amount: 2500, currency: 'TRY' },
      display: '2.500 TRY',
      status: 'filled',
    });
    expect(record(first.slots, 'islem_zamani')).toMatchObject({
      value: { date: '2026-10-16', time: null, part_of_day: 'evening' },
      display: '16.10.2026 akşam',
      status: 'partial',
    });
    expect(first.changes.map((c) => `${c.slot}:${c.from}→${c.to}`)).toEqual([
      'yontem:missing→filled',
      'tutar:missing→filled',
      'islem_zamani:missing→partial',
    ]);

    const plan = planQuestions({ defs: DEPOSIT, slots: first.slots, turn: 1 });
    expect(plan.questions).toEqual([
      {
        slot: 'islem_zamani',
        attempt: 1,
        because: 'partial',
        text: '16.10.2026 akşam — saat kaç civarıydı?',
      },
    ]);
    expect(record(plan.slots, 'islem_zamani').attempts).toBe(1);

    // The time lands on the partial moment's day.
    const second = applyExtraction(
      turn('21:40 gibi', [{ slot: 'islem_zamani', raw_text: '21:40', confidence: 0.9 }], {
        slots: plan.slots,
        turn: 2,
      }),
    );
    expect(record(second.slots, 'islem_zamani')).toMatchObject({
      value: { date: '2026-10-16', time: '21:40' },
      display: '16.10.2026 21:40',
      status: 'filled',
      attempts: 1,
      previous_values: [],
    });
    expect(planQuestions({ defs: DEPOSIT, slots: second.slots, turn: 2 }).questions).toEqual([]);
  });

  it('reads the value from the words, not from what the model proposed beside them', () => {
    const result = applyExtraction(
      turn('papara ile attım', [{ slot: 'yontem', raw_text: 'papara', value: 'Havale' }]),
    );
    expect(record(result.slots, 'yontem')).toMatchObject({ value: 'Papara', source: 'player' });
  });

  it('checks a TXID against the network given in the same message, whatever the item order', () => {
    const result = applyExtraction(
      turn(
        `TRC20 ile gönderdim, txid ${EVM_TXID}`,
        [
          { slot: 'txid', raw_text: EVM_TXID },
          { slot: 'ag', raw_text: 'TRC20' },
        ],
        { defs: [ag, txid] },
      ),
    );
    expect(record(result.slots, 'ag')).toMatchObject({ value: 'TRC20', status: 'filled' });
    expect(record(result.slots, 'txid')).toMatchObject({
      value: null,
      status: 'invalid',
      invalid_reason: 'network_mismatch',
    });
  });

  it('keeps every key the state already had', () => {
    const result = applyExtraction(
      turn('papara', [{ slot: 'yontem', raw_text: 'papara' }], {
        slots: { legacy_order: 'A-1234' },
      }),
    );
    expect(result.slots['legacy_order']).toBe('A-1234');
  });
});

describe('the traceability shield (AI-04 §4)', () => {
  it('drops a value whose words are not in the processed messages, and logs it without the value', () => {
    const result = applyExtraction(
      turn('papara ile attım', [
        { slot: 'yontem', raw_text: 'papara', value: 'Papara' },
        { slot: 'tutar', raw_text: '3000 TL', value: 3000, confidence: 0.99 },
      ]),
    );
    expect(result.slots['tutar']).toBeUndefined();
    expect(result.changes.map((c) => c.slot)).toEqual(['yontem']);
    expect(result.log).toContainEqual({
      step: 'extract',
      detail: "tutar: dropped — its words are not in the player's messages",
      ok: false,
    });
    expect(JSON.stringify(result.log)).not.toContain('3000');
  });

  it('matches folded — case, Turkish letters, quotes and spacing — and across the merged messages', () => {
    expect(tracesTo('"PAPARA"', 'Paparayla attım')).toBe(true);
    expect(tracesTo('dün  akşam', 'DÜN AKŞAM yatırdım')).toBe(true);
    expect(tracesTo('dun aksam', 'dün akşam')).toBe(true);
    expect(tracesTo('2,5 bin', 'merhaba\n2,5 bin attım')).toBe(true);
    expect(tracesTo('25 bin', '2,5 bin attım')).toBe(false);
    expect(tracesTo(' "" ', 'anything')).toBe(false);

    const merged = applyExtraction(
      turn('', [{ slot: 'tutar', raw_text: '2.500 TL' }], {
        messages: ['merhaba', 'dün 2.500 TL attım'],
      }),
    );
    expect(record(merged.slots, 'tutar').status).toBe('filled');
  });
});

describe('the understanding output, checked (AI-04 §4)', () => {
  const defs = new Map(DEPOSIT.map((def) => [def.name, def]));

  it('drops malformed items, unknown slots and overlong words; reads a bad confidence as none', () => {
    const { items, dropped } = parseExtracted(
      {
        extracted: [
          'papara',
          { slot: 'yontem' },
          { slot: 'yontem', raw_text: '   ' },
          { slot: 'sifre', raw_text: '1234' },
          { slot: 'tutar', raw_text: 'x'.repeat(501) },
          { slot: 'tutar', raw_text: '2500', confidence: 7 },
          { slot: 'yontem', raw_text: 'papara', confidence: 0.4, correction: true },
        ],
      },
      defs,
    );
    expect(dropped).toEqual([
      { index: 0, reason: 'malformed' },
      { index: 1, reason: 'malformed' },
      { index: 2, reason: 'malformed' },
      { index: 3, reason: 'unknown_slot', slot: 'sifre' },
      { index: 4, reason: 'too_long', slot: 'tutar' },
    ]);
    expect(items).toEqual([
      { slot: 'tutar', raw_text: '2500', value: undefined, confidence: null, correction: false },
      { slot: 'yontem', raw_text: 'papara', value: undefined, confidence: 0.4, correction: true },
    ]);
  });

  it('extracts nothing from an answer without an extracted list', () => {
    expect(parseExtracted({}, defs).items).toEqual([]);
    expect(parseExtracted({ extracted: { slot: 'tutar' } }, defs).items).toEqual([]);
  });

  it('reads the top-level correction as every slot, or the ones it names', () => {
    const items = (correction: unknown) =>
      parseExtracted(
        {
          extracted: [
            { slot: 'tutar', raw_text: '3 bin' },
            { slot: 'yontem', raw_text: 'havale' },
          ],
          correction,
        },
        defs,
      ).items.map((item) => item.correction);
    expect(items(true)).toEqual([true, true]);
    expect(items(['tutar'])).toEqual([true, false]);
    expect(items('yes')).toEqual([false, false]);
  });

  it('logs every dropped item', () => {
    const result = applyExtraction(turn('papara', [{ slot: 'nope', raw_text: 'papara' }, 42]));
    expect(result.log.map((entry) => entry.detail)).toEqual([
      'dropped item 1 (nope) — the procedure defines no such slot',
      'dropped item 2 — not an object with a slot and its words',
    ]);
  });

  it("reads the model's value by the same reader only when the words are unreadable, as inferred", () => {
    const inferred = applyExtraction(
      turn('o kadar attım işte', [
        { slot: 'tutar', raw_text: 'o kadar', value: 2500, confidence: 0.6 },
      ]),
    );
    expect(record(inferred.slots, 'tutar')).toMatchObject({
      value: { amount: 2500, currency: 'TRY' },
      status: 'filled',
      source: 'inferred',
      confidence: 0.6,
    });
    const asMoney = applyExtraction(
      turn('o kadar', [
        { slot: 'tutar', raw_text: 'o kadar', value: { amount: 750, currency: 'TRY' } },
      ]),
    );
    expect(record(asMoney.slots, 'tutar').value).toEqual({ amount: 750, currency: 'TRY' });
    // Unreadable both ways: an invalid slot, never a guess.
    const neither = applyExtraction(
      turn('o kadar', [{ slot: 'tutar', raw_text: 'o kadar', value: 'çok' }]),
    );
    expect(record(neither.slots, 'tutar')).toMatchObject({
      status: 'invalid',
      invalid_reason: 'unreadable',
      source: 'player',
    });
  });

  it('changes nothing when one message gives two different values for a slot', () => {
    const result = applyExtraction(
      turn('2 bin mi 3 bin mi', [
        { slot: 'tutar', raw_text: '2 bin' },
        { slot: 'tutar', raw_text: '3 bin' },
      ]),
    );
    expect(result.slots['tutar']).toBeUndefined();
    expect(result.log).toContainEqual({
      step: 'extract',
      detail: 'tutar: left as it was — the message gives two different values',
      ok: false,
    });
    // The same value twice is one value; a value beats a malformed one.
    const same = applyExtraction(
      turn('2500 TL yani 2,5 bin, abc', [
        { slot: 'tutar', raw_text: '2500 TL' },
        { slot: 'tutar', raw_text: '2,5 bin' },
        { slot: 'tutar', raw_text: 'abc' },
      ]),
    );
    expect(record(same.slots, 'tutar')).toMatchObject({ status: 'filled', display: '2.500 TRY' });
  });
});

describe('statuses (AI-04 §5)', () => {
  const filled = applyExtraction(turn('2500 TL', [{ slot: 'tutar', raw_text: '2500 TL' }])).slots;

  it('never lets an invalid or unknown answer wipe a value', () => {
    const invalid = applyExtraction(
      turn('0 TL', [{ slot: 'tutar', raw_text: '0 TL' }], { slots: filled, turn: 2 }),
    );
    expect(invalid.slots['tutar']).toEqual(filled['tutar']);
    expect(invalid.log).toContainEqual({
      step: 'extract',
      detail: 'tutar: kept filled — the new words were not a value (not_positive)',
      ok: true,
    });
    const unknown = applyExtraction(
      turn('bilmiyorum', [{ slot: 'tutar', raw_text: 'bilmiyorum' }], { slots: filled }),
    );
    expect(unknown.slots['tutar']).toEqual(filled['tutar']);
  });

  it('marks "bilmiyorum" unknown, and a partial moment keeps its day through it', () => {
    const unknown = applyExtraction(
      turn('bilmiyorum', [{ slot: 'tutar', raw_text: 'bilmiyorum' }]),
    );
    expect(record(unknown.slots, 'tutar')).toMatchObject({ status: 'unknown', value: null });

    const partial = applyExtraction(
      turn('dün akşam', [{ slot: 'islem_zamani', raw_text: 'dün akşam' }]),
    ).slots;
    const after = applyExtraction(
      turn('hatırlamıyorum', [{ slot: 'islem_zamani', raw_text: 'hatırlamıyorum' }], {
        slots: partial,
      }),
    );
    expect(record(after.slots, 'islem_zamani').status).toBe('partial');
  });

  it('keeps the day of a partial moment when the time given is wrong, and the re-ask explains it', () => {
    const partial = applyExtraction(
      turn('bugün öğleden sonra', [{ slot: 'islem_zamani', raw_text: 'bugün öğleden sonra' }]),
    ).slots;
    const asked = planQuestions({ defs: [islemZamani], slots: partial, turn: 1 }).slots;
    const future = applyExtraction(
      turn('saat 23:30', [{ slot: 'islem_zamani', raw_text: '23:30' }], {
        defs: [islemZamani],
        slots: asked,
        turn: 2,
      }),
    );
    expect(record(future.slots, 'islem_zamani')).toMatchObject({
      status: 'partial',
      display: '17.10.2026 öğleden sonra',
      invalid_reason: 'future',
    });
    const plan = planQuestions({ defs: [islemZamani], slots: future.slots, turn: 2 });
    expect(plan.questions[0]).toEqual({
      slot: 'islem_zamani',
      attempt: 2,
      because: 'partial',
      reason: 'future',
      text: 'Bu zaman henüz gelmemiş görünüyor. 17.10.2026 öğleden sonra — saat kaç civarıydı?',
    });
  });

  it('flags an amount outside min/max and keeps it (out_of_range, not a refusal)', () => {
    const result = applyExtraction(turn('50 TL', [{ slot: 'tutar', raw_text: '50 TL' }]));
    expect(record(result.slots, 'tutar')).toMatchObject({
      status: 'filled',
      out_of_range: 'below_min',
    });
    expect(result.log[0]?.detail).toBe('tutar: missing → filled (player, below min)');
  });

  it('lets the player replace a carried value without a correction, keeping the carried one', () => {
    const carried = { tutar: { display: '2.500 TRY', status: 'carried' } };
    expect(planQuestions({ defs: [tutar], slots: carried, turn: 1 }).questions).toEqual([]);
    const result = applyExtraction(
      turn('3000 TL', [{ slot: 'tutar', raw_text: '3000 TL' }], { slots: carried }),
    );
    expect(record(result.slots, 'tutar')).toMatchObject({
      value: { amount: 3000, currency: 'TRY' },
      status: 'filled',
      previous_values: ['2.500 TRY'],
    });
    expect(result.changes[0]).toEqual({
      slot: 'tutar',
      from: 'carried',
      to: 'filled',
      via: 'player',
    });
  });

  it('reads a stored slot in any shape the state holds', () => {
    expect(slotRecord(undefined)).toMatchObject({ status: 'missing', attempts: 0 });
    expect(slotRecord('A-1234')).toMatchObject({ value: 'A-1234', status: 'filled' });
    expect(
      slotRecord({ status: 'bogus', attempts: -1, previous_values: [1, null, {}] }),
    ).toMatchObject({ status: 'missing', attempts: 0, previous_values: [1] });
  });
});

describe('corrections (AI-04 §5: correction overwrites, previous_values)', () => {
  const filled = applyExtraction(turn('2500 TL', [{ slot: 'tutar', raw_text: '2500 TL' }])).slots;

  it('keeps a filled value against a different one without a correction', () => {
    const result = applyExtraction(
      turn('3 bin', [{ slot: 'tutar', raw_text: '3 bin' }], { slots: filled, turn: 2 }),
    );
    expect(result.slots['tutar']).toEqual(filled['tutar']);
    expect(result.changes).toEqual([]);
  });

  it('overwrites on a correction and keeps the old value', () => {
    const result = applyExtraction(
      turn('pardon 3 bin', [{ slot: 'tutar', raw_text: '3 bin', correction: true }], {
        slots: filled,
        turn: 2,
      }),
    );
    expect(record(result.slots, 'tutar')).toMatchObject({
      value: { amount: 3000, currency: 'TRY' },
      display: '3.000 TRY',
      status: 'filled',
      turn: 2,
      previous_values: [{ amount: 2500, currency: 'TRY' }],
    });
    expect(result.changes).toEqual([
      { slot: 'tutar', from: 'filled', to: 'filled', via: 'player', corrected: true },
    ]);
    // A second correction stacks; the same value again changes nothing.
    const again = applyExtraction(
      turn('yok 3500', [{ slot: 'tutar', raw_text: '3500' }], {
        slots: result.slots,
        understanding: { extracted: [{ slot: 'tutar', raw_text: '3500' }], correction: ['tutar'] },
        turn: 3,
      }),
    );
    expect(record(again.slots, 'tutar').previous_values).toEqual([
      { amount: 2500, currency: 'TRY' },
      { amount: 3000, currency: 'TRY' },
    ]);
    const same = applyExtraction(
      turn('3500', [{ slot: 'tutar', raw_text: '3500', correction: true }], {
        slots: again.slots,
      }),
    );
    expect(same.changes).toEqual([]);
  });
});

describe('questions, attempts and refusals (AI-04 §6–§7 · AI-04-S2 · AI-07)', () => {
  it('asks at most max_questions_per_message, in the procedure order, required ones only', () => {
    const defs = [yontem, tutar, islemZamani, ag, txid];
    const plan = planQuestions({ defs, slots: {}, turn: 1 });
    expect(plan.questions.map((q) => q.slot)).toEqual(['yontem', 'tutar']);
    expect(plan.questions[0]).toEqual({
      slot: 'yontem',
      attempt: 1,
      because: 'missing',
      text: 'Hangi yöntemle yatırdınız?',
    });
    expect(planQuestions({ defs, slots: {}, turn: 1, maxQuestions: 1 }).questions).toHaveLength(1);
    expect(
      planQuestions({ defs, slots: {}, turn: 1, only: ['txid', 'ag'] }).questions.map(
        (q) => q.slot,
      ),
    ).toEqual(['txid']);
    // A condition is not required until the executor says so (#296.7).
    const conditional = slot({ name: 'bonus', type: 'text', required: { when: { slot: 'x' } } });
    expect(planQuestions({ defs: [conditional], slots: {}, turn: 1 }).questions).toEqual([]);
    expect(
      planQuestions({ defs: [conditional], slots: {}, turn: 1, required: () => true }).questions,
    ).toHaveLength(1);
  });

  it('words the second attempt with the variant and refuses after max_attempts — the card says "verilmedi"', () => {
    const first = planQuestions({ defs: [tutar], slots: {}, turn: 1 });
    expect(first.questions[0]?.text).toBe('Ne kadar yatırdınız?');
    // The player answers something else: nothing for the slot.
    const second = planQuestions({ defs: [tutar], slots: first.slots, turn: 2 });
    expect(second.questions[0]).toMatchObject({
      attempt: 2,
      text: 'Yatırdığınız tutarı yazar mısınız?',
    });
    const third = planQuestions({ defs: [tutar], slots: second.slots, turn: 3 });
    expect(third.questions).toEqual([]);
    expect(third.refused).toEqual(['tutar']);
    expect(record(third.slots, 'tutar')).toMatchObject({
      status: 'refused',
      attempts: 2,
      display: null,
      turn: 3,
    });
    expect(third.log).toContainEqual({
      step: 'collect',
      detail: 'tutar: refused — asked 2 time(s) without an answer',
      ok: true,
    });
    expect(slotCardLines([tutar], third.slots)).toEqual([
      { slot: 'tutar', label: 'Tutar', status: 'refused', text: 'verilmedi' },
    ]);
    expect(slotCardLines([tutar], third.slots, 'en')[0]?.text).toBe('not given');
    // Refused is not asked again — and a value given later still fills it.
    expect(planQuestions({ defs: [tutar], slots: third.slots, turn: 4 }).questions).toEqual([]);
    const late = applyExtraction(
      turn('2500 TL', [{ slot: 'tutar', raw_text: '2500 TL' }], { slots: third.slots, turn: 4 }),
    );
    expect(record(late.slots, 'tutar')).toMatchObject({ status: 'filled', attempts: 2 });
  });

  it('re-asks an invalid TXID once, explaining the network format, then refuses it', () => {
    const defs = [ag, txid];
    const network = applyExtraction(
      turn('TRC20', [{ slot: 'ag', raw_text: 'TRC20' }], { defs }),
    ).slots;
    const asked = planQuestions({ defs, slots: network, turn: 1 });
    expect(asked.questions[0]?.text).toBe('İşlem numarasını (TXID) yazar mısınız?');

    const wrong = applyExtraction(
      turn(EVM_TXID, [{ slot: 'txid', raw_text: EVM_TXID }], { defs, slots: asked.slots, turn: 2 }),
    );
    expect(record(wrong.slots, 'txid')).toMatchObject({
      status: 'invalid',
      invalid_reason: 'network_mismatch',
    });
    const reask = planQuestions({ defs, slots: wrong.slots, turn: 2 });
    expect(reask.questions).toEqual([
      {
        slot: 'txid',
        attempt: 2,
        because: 'invalid',
        reason: 'network_mismatch',
        text: 'TRC20 işlem numarası 0x olmadan 64 karakterdir. TXID’yi kopyalayıp yapıştırabilir misiniz?',
      },
    ]);
    expect(
      planQuestions({ defs, slots: wrong.slots, turn: 2, language: 'en' }).questions[0]?.text,
    ).toBe(
      'A TRC20 transaction ID is 64 characters, without 0x. TXID’yi kopyalayıp yapıştırabilir misiniz?',
    );

    const stillWrong = applyExtraction(
      turn(`${EVM_TXID} bu`, [{ slot: 'txid', raw_text: EVM_TXID }], {
        defs,
        slots: reask.slots,
        turn: 3,
      }),
    );
    const end = planQuestions({ defs, slots: stillWrong.slots, turn: 3 });
    expect(end.questions).toEqual([]);
    expect(end.refused).toEqual(['txid']);
    expect(record(end.slots, 'txid').invalid_reason).toBeUndefined();

    // Given right the second time, it fills.
    const right = applyExtraction(
      turn(TRON_TXID, [{ slot: 'txid', raw_text: TRON_TXID }], {
        defs,
        slots: reask.slots,
        turn: 3,
      }),
    );
    expect(record(right.slots, 'txid')).toMatchObject({ status: 'filled', value: TRON_TXID });
    expect(record(right.slots, 'txid').invalid_reason).toBeUndefined();
  });

  it('lets an unknown or partial answer stand once the attempts are spent', () => {
    const slots = {
      tutar: { status: 'unknown', attempts: 2 },
      islem_zamani: {
        status: 'partial',
        attempts: 2,
        value: { date: '2026-10-16', time: null, time_zone: 'Europe/Istanbul' },
        display: '16.10.2026',
      },
    };
    const plan = planQuestions({ defs: DEPOSIT, slots, turn: 3 });
    expect(plan.questions.map((q) => q.slot)).toEqual(['yontem']);
    expect(plan.refused).toEqual([]);
    expect(record(plan.slots, 'tutar').status).toBe('unknown');
  });

  it('carries the author question alone in a language without phrases', () => {
    const partial = applyExtraction(
      turn('dün akşam', [{ slot: 'islem_zamani', raw_text: 'dün akşam' }]),
    ).slots;
    expect(
      planQuestions({ defs: [islemZamani], slots: partial, turn: 1, language: 'de' }).questions[0]
        ?.text,
    ).toBe('Ne zaman yatırdınız?');
    expect(
      planQuestions({ defs: [islemZamani], slots: partial, turn: 1, language: 'en' }).questions[0]
        ?.text,
    ).toBe('16.10.2026 akşam — around what time was it?');
  });
});

describe('attachments (AI-04 §8 · G12)', () => {
  it('fills a file slot with the attachment and never with words; says it was received', () => {
    const result = applyExtraction(
      turn('dekontu attım', [{ slot: 'dekont', raw_text: 'dekontu attım' }], {
        defs: [dekont],
        attachments: [{ id: 'att_1', name: 'dekont.pdf' }],
      }),
    );
    expect(record(result.slots, 'dekont')).toMatchObject({
      value: 'att_1',
      display: 'dekont.pdf',
      status: 'filled',
    });
    expect(result.changes).toEqual([
      { slot: 'dekont', from: 'missing', to: 'filled', via: 'attachment' },
    ]);
    expect(receivedLine(dekont)).toBe('Dekont alındı, teşekkürler.');
    expect(receivedLine(dekont, 'en')).toBe('Thanks — Dekont received.');
    expect(receivedLine(dekont, 'fr')).toBeNull();

    const words = applyExtraction(
      turn('dekontu attım', [{ slot: 'dekont', raw_text: 'dekontu attım' }], { defs: [dekont] }),
    );
    expect(words.slots['dekont']).toBeUndefined();
    // A filled file slot keeps its file.
    const later = applyExtraction(
      turn('', [], {
        defs: [dekont],
        slots: result.slots,
        attachments: [{ id: 'att_2', name: 'baska.png' }],
      }),
    );
    expect(record(later.slots, 'dekont').value).toBe('att_1');
  });
});

describe('a pii high slot (AI-04 §9)', () => {
  it('keeps its value on the record for the card, and out of the log and the daily digest', () => {
    const result = applyExtraction(
      turn('son 4 hane 8841', [{ slot: 'iban_son4', raw_text: '8841', confidence: 0.9 }], {
        defs: [ibanSon4],
      }),
    );
    expect(record(result.slots, 'iban_son4')).toMatchObject({
      value: '8841',
      status: 'filled',
      pii: 'high',
    });
    expect(JSON.stringify(result.log)).not.toContain('8841');
    expect(digestSlots(result.slots as never)).toEqual({});
    expect(slotCardLines([ibanSon4], result.slots)[0]?.text).toBe('8841');
  });
});

describe('the card (AI-10 · AI-04 §9)', () => {
  it('shows card slots under their card label once there is something to say', () => {
    const hidden = slot({ name: 'not', type: 'text', show_in_card: false });
    const slots = {
      yontem: { value: 'Papara', display: 'Papara', status: 'filled' },
      tutar: {
        value: { amount: 50, currency: 'TRY' },
        display: '50 TRY',
        status: 'filled',
        out_of_range: 'below_min',
      },
      islem_zamani: { status: 'unknown' },
      not: { value: 'x', display: 'x', status: 'filled' },
    };
    expect(slotCardLines([...DEPOSIT, hidden, txid], slots)).toEqual([
      { slot: 'yontem', label: 'Yöntem', status: 'filled', text: 'Papara' },
      {
        slot: 'tutar',
        label: 'Tutar',
        status: 'filled',
        text: '50 TRY',
        out_of_range: 'below_min',
      },
      { slot: 'islem_zamani', label: 'Zaman', status: 'unknown', text: 'bilmiyor' },
    ]);
  });
});
