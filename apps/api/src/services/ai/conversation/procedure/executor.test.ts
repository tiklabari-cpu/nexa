/**
 * The procedure executor (tm 296.3 · AI-03 §3–§6): one turn at a time over the
 * research §3.1 deposit procedure — its four endings — and the rules every
 * procedure runs by: the turn limit, the hand-over conditions, a refused slot,
 * the eight-step shield, `when`, `check` branches, the passive tool step, and
 * the pinned snapshot's hash.
 *
 * Pure: the understanding is a fixture (the call is #297), and so are the
 * payment-method facts (the tables are #310).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateProcedure, type Procedure } from '@siyahtus/types';
import {
  DEPOSIT_OPTIONS,
  DEPOSIT_TEMPLATES,
  depositFacts,
  depositProcedure,
  heard,
} from '../../../../../test/helpers/procedure-fixtures.js';
import { emptyTurnState } from '../turn.js';
import { NO_FACTS, type ProcedureFacts } from './conditions.js';
import {
  MAX_INNER_STEPS,
  activeProcedure,
  procedureHash,
  readSnapshot,
  readSuspended,
  resumed,
  runProcedureTurn,
  suspend,
  type ProcedureSnapshot,
  type ProcedureTurnResult,
} from './executor.js';
import type { ProcedureUnderstanding } from './understanding.js';

/** 13:50 in Istanbul. */
const NOW = new Date('2026-10-18T10:50:00Z');
const TZ = 'Europe/Istanbul';

/** A conversation with one procedure, turn after turn, its state carried between them. */
function conversation(
  procedure: Procedure,
  options: { facts?: ProcedureFacts; now?: Date; procedureTurns?: number } = {},
) {
  let at: { stepId: string | null } | null = null;
  let slots: Record<string, unknown> = {};
  let procedureTurns = options.procedureTurns ?? 0;
  let turn = 0;
  // "Is it solved?" asked at `at` on the turn before (K9 · tm 303.4).
  let asked = false;
  return {
    say(text: string, understanding: ProcedureUnderstanding | null = heard()): ProcedureTurnResult {
      turn += 1;
      const result = runProcedureTurn({
        procedure,
        at,
        slots,
        procedureTurns,
        turn,
        understanding,
        messages: [text],
        now: options.now ?? NOW,
        timeZone: TZ,
        currency: 'TRY',
        facts: options.facts ?? depositFacts(),
        options: DEPOSIT_OPTIONS,
        language: 'tr',
        resolutionAsked: asked,
      });
      slots = result.slots;
      procedureTurns += 1;
      asked = result.end.kind === 'confirming';
      if (
        result.end.kind === 'awaiting' ||
        result.end.kind === 'paused' ||
        result.end.kind === 'confirming'
      ) {
        at = { stepId: result.end.stepId };
      }
      return result;
    },
    get slots() {
      return slots;
    },
  };
}

/** What the parts say, one per line — questions as asked. */
function said(result: ProcedureTurnResult): string[] {
  return result.parts.map((part) =>
    part.kind === 'knowledge'
      ? `<knowledge${part.queryHint ? `: ${part.queryHint}` : ''}>`
      : part.text,
  );
}

function statusOf(slots: Record<string, unknown>, name: string): unknown {
  return (slots[name] as { status?: unknown } | undefined)?.status;
}

/** A small procedure, built from its steps. */
function procedureOf(steps: unknown[], extra: Record<string, unknown> = {}): Procedure {
  const result = validateProcedure({
    when_to_use: 'Test.',
    slots: [
      { name: 'a', label: 'A', type: 'text', ask: 'A?' },
      { name: 'b', label: 'B', type: 'text', ask: 'B?' },
    ],
    steps,
    ...extra,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

describe('the §3.1 deposit procedure, turn by turn (AI-03 acceptance)', () => {
  it('opens with its greeting and asks the method and the time, then waits', () => {
    const chat = conversation(depositProcedure());
    const first = chat.say('param yatmadı', null);
    expect(said(first)).toEqual([
      DEPOSIT_TEMPLATES.giris,
      'Hangi yöntemle yatırım yaptınız?',
      'Saat kaçta yatırdınız?',
    ]);
    expect(first.end).toEqual({ kind: 'awaiting', stepId: 'yontem_zaman' });
    expect(first.trace.map((step) => [step.step_id, step.type])).toEqual([
      ['karsilama', 'say'],
      ['yontem_zaman', 'collect'],
    ]);
    expect(statusOf(chat.slots, 'yontem')).toBe('missing');
  });

  it('A — inside the expected time: the wait is explained with the method’s time and the elapsed time, resolved waiting', () => {
    const chat = conversation(depositProcedure());
    chat.say('param yatmadı', null);
    const second = chat.say(
      'papara ile 13:40 gibi',
      heard(['yontem', 'papara'], ['islem_zamani', '13:40']),
    );
    // K9 (tm 303.4): the explanation, then "is it solved?" — not resolved yet.
    expect(said(second)).toEqual([
      'Papara ile yapılan yatırımlar genellikle 30 dk içinde hesaba yansır. İşleminiz 10 dk önce yapılmış; hâlâ normal süre içinde.',
      '30 dk dolduğunda bakiye görünmezse bu sohbete yazın.',
      'Bu bilgiler işinize yaradı mı?',
    ]);
    expect(second.end).toEqual({
      kind: 'confirming',
      stepId: 'bekleme_bitti',
      outcome: 'resolved_waiting',
    });
    expect(second.trace).toContainEqual({
      step_id: 'sure_icinde',
      type: 'check',
      cond_result: true,
      detail: 'then: go to bekleme',
    });

    const third = chat.say('evet, teşekkürler', { ...heard(), yes_no: 'yes' });
    expect(said(third)).toEqual([
      'Sevindim! Başka bir konuda yardımcı olabileceğim bir şey olursa yazmanız yeterli.',
    ]);
    expect(third.end).toEqual({
      kind: 'resolved',
      stepId: 'bekleme_bitti',
      outcome: 'resolved_waiting',
    });
    expect(third.resolution).toMatchObject({
      decision: 'resolved',
      reason: 'criteria_met',
      basis: 'platform',
      confirmation: 'yes',
    });
  });

  it('B — past the expected time, outside the method’s hours: the next window, resolved waiting', () => {
    const chat = conversation(depositProcedure(), {
      facts: depositFacts({ withinWorkingHours: () => false }),
    });
    chat.say('param yatmadı', null);
    const second = chat.say(
      'papara, 12:00',
      heard(['yontem', 'papara'], ['islem_zamani', '12:00']),
    );
    expect(said(second)).toEqual([
      'Papara işlemleri 09:00–18:00 arasında işlenir. Talebiniz bir sonraki işlem penceresinde (19.10.2026 09:00) değerlendirilecek.',
      'Bu bilgiler işinize yaradı mı?',
    ]);
    expect(second.end).toEqual({
      kind: 'confirming',
      stepId: 'mesai_bitti',
      outcome: 'resolved_waiting',
    });
    expect(second.trace.find((step) => step.step_id === 'sure_icinde')?.cond_result).toBe(false);
  });

  it('C — no site request: the rule is explained and finance takes it', () => {
    const chat = conversation(depositProcedure());
    chat.say('param yatmadı', null);
    const second = chat.say(
      'papara, 12:00',
      heard(['yontem', 'papara'], ['islem_zamani', '12:00']),
    );
    expect(said(second)).toEqual([
      'Göndermeden önce site üzerinden yatırım talebi oluşturdunuz mu?',
      'Gönderim kendi adınıza kayıtlı hesaptan mı yapıldı?',
    ]);
    const third = chat.say(
      'talep oluşturmadım, kendi hesabımdan gönderdim',
      heard(
        ['talep_olusturuldu', 'talep oluşturmadım'],
        ['gonderen_kendisi', 'kendi hesabımdan gönderdim'],
      ),
    );
    expect(said(third)).toEqual([DEPOSIT_TEMPLATES.talep_yok]);
    expect(third.end).toEqual({
      kind: 'handoff',
      stepId: 'talep_devir',
      reason: 'no_site_request',
      target: { topic: 'finance' },
    });
  });

  it('D — every check passes: six turns collect every slot, skip the passive lookup and hand finance all of it', () => {
    const chat = conversation(depositProcedure());
    const turns = [
      chat.say('param yatmadı', null),
      chat.say('papara, 12:00', heard(['yontem', 'papara'], ['islem_zamani', '12:00'])),
      chat.say(
        'evet oluşturdum, kendi hesabımdan gönderdim',
        heard(
          ['talep_olusturuldu', 'evet oluşturdum'],
          ['gonderen_kendisi', 'kendi hesabımdan gönderdim'],
        ),
      ),
      chat.say('2.500 TL', heard(['tutar', '2.500 TL'])),
      chat.say('ahmet77', heard(['kullanici_adi', 'ahmet77'])),
      chat.say('REF12345', heard(['referans', 'REF12345'])),
    ];
    expect(turns.map((turn) => turn.end.kind)).toEqual([
      'awaiting',
      'awaiting',
      'awaiting',
      'awaiting',
      'awaiting',
      'handoff',
    ]);
    expect(said(turns[2]!)).toEqual(['Ne kadar yatırdınız?']);
    expect(said(turns[3]!)).toEqual(['Kullanıcı adınızı yazar mısınız?']);
    // A reference, not a receipt: the method does not ask for one.
    expect(said(turns[4]!)).toEqual(['İşlemin referans numarasını paylaşır mısınız?']);
    const last = turns[5]!;
    expect(last.end).toEqual({
      kind: 'handoff',
      stepId: 'finansa_devir',
      reason: 'expected_time_exceeded',
      target: { topic: 'finance' },
    });
    expect(last.trace).toContainEqual({
      step_id: 'yatirim_sorgula',
      type: 'tool',
      cond_result: null,
      detail: 'tool deposit_lookup is passive in F1 — skipped',
    });
    for (const slot of [
      'yontem',
      'islem_zamani',
      'talep_olusturuldu',
      'gonderen_kendisi',
      'tutar',
      'kullanici_adi',
      'referans',
    ]) {
      expect(statusOf(chat.slots, slot), slot).toBe('filled');
    }
    expect(statusOf(chat.slots, 'dekont')).toBeUndefined();
  });

  it('a third-party payment hands over from the check’s own branch', () => {
    const chat = conversation(depositProcedure());
    chat.say('param yatmadı', null);
    chat.say('papara, 12:00', heard(['yontem', 'papara'], ['islem_zamani', '12:00']));
    const third = chat.say(
      'evet oluşturdum, eşimin hesabından gönderdim ama kendi hesabımdan değil',
      heard(
        ['talep_olusturuldu', 'evet oluşturdum'],
        ['gonderen_kendisi', 'kendi hesabımdan değil'],
      ),
    );
    expect(third.end).toMatchObject({
      kind: 'handoff',
      stepId: 'ucuncu_kisi',
      reason: 'third_party_payment',
    });
  });

  it('with no facts the time checks cannot be decided: they count as false and the wait template is never sent', () => {
    const chat = conversation(depositProcedure(), { facts: NO_FACTS });
    chat.say('param yatmadı', null);
    const second = chat.say('papara 13:40', heard(['yontem', 'papara'], ['islem_zamani', '13:40']));
    expect(second.trace.find((step) => step.step_id === 'sure_icinde')?.cond_result).toBe(
      'unknown',
    );
    expect(second.end).toEqual({ kind: 'awaiting', stepId: 'surec' });
    expect(second.parts.every((part) => part.kind === 'question')).toBe(true);
  });
});

describe('a say step whose template cannot be filled (AI-03 §4)', () => {
  it('sends its instruction to the compose call instead, and logs the template it did not send', () => {
    const procedure = procedureOf(
      [
        { id: 'sor', type: 'collect', slots: ['a'] },
        { id: 'soyle', type: 'say', template_key: 'k', instruction: 'Kısaca açıkla.' },
        { id: 'bitti', type: 'resolve', outcome: 'resolved' },
      ],
      { templates: [{ key: 'k', text: 'Değer: {b}' }] },
    );
    const chat = conversation(procedure);
    chat.say('x', null);
    const second = chat.say('merhaba', heard(['a', 'merhaba']));
    expect(second.parts).toEqual([
      { kind: 'instruction', at: 'soyle', text: 'Kısaca açıkla.' },
      { kind: 'resolution', at: 'bitti', text: 'Sorununuz çözüldü mü?' },
    ]);
    expect(second.log).toContainEqual({
      step: 'soyle',
      detail: 'template k not sent: {b} unknown',
      ok: false,
    });
  });

  it('a verbatim template is marked so, and goes out as filled', () => {
    const procedure = procedureOf(
      [
        { id: 'yasal', type: 'say', template_key: 'k' },
        { id: 'bitti', type: 'resolve', outcome: 'resolved' },
      ],
      { templates: [{ key: 'k', text: 'Yasal uyarı.', verbatim: true }] },
    );
    const result = conversation(procedure).say('x', null);
    expect(result.parts).toEqual([
      { kind: 'template', at: 'yasal', key: 'k', text: 'Yasal uyarı.', verbatim: true },
      { kind: 'resolution', at: 'bitti', text: 'Sorununuz çözüldü mü?' },
    ]);
  });
});

describe('the limits a procedure runs within (AI-03 §6)', () => {
  it('past limits.max_turns the procedure hands over with reason max_turns, running no step', () => {
    const procedure = depositProcedure((raw) => {
      raw['limits'] = { max_turns: 3 };
    });
    const chat = conversation(procedure, { procedureTurns: 3 });
    const result = chat.say('param yatmadı', null);
    expect(result.end).toEqual({
      kind: 'handoff',
      stepId: null,
      reason: 'max_turns',
      target: { topic: 'finance' },
    });
    expect(result.parts).toEqual([]);
    expect(result.trace).toEqual([]);
  });

  it('turn max_turns itself still runs', () => {
    const procedure = depositProcedure((raw) => {
      raw['limits'] = { max_turns: 3 };
    });
    expect(conversation(procedure, { procedureTurns: 2 }).say('x', null).end.kind).toBe('awaiting');
  });

  it('a hand-over condition that holds hands over before any step of the turn', () => {
    const chat = conversation(depositProcedure());
    chat.say('param yatmadı', null);
    const second = chat.say(
      'papara, 12:00, 150.000 TL',
      heard(['yontem', 'papara'], ['islem_zamani', '12:00'], ['tutar', '150.000 TL']),
    );
    expect(second.end).toEqual({
      kind: 'handoff',
      stepId: 'yontem_zaman',
      reason: 'procedure_condition',
      target: { topic: 'finance' },
    });
    expect(second.parts).toEqual([]);
  });

  it('a required slot asked max_attempts times without an answer hands over: slot_refused', () => {
    const chat = conversation(depositProcedure());
    chat.say('param yatmadı', null);
    const again = chat.say('bilmem ki', heard());
    expect(again.end).toEqual({ kind: 'awaiting', stepId: 'yontem_zaman' });
    const refused = chat.say('boşver', heard());
    expect(refused.end).toEqual({
      kind: 'handoff',
      stepId: 'yontem_zaman',
      reason: 'slot_refused',
      target: { topic: 'finance' },
    });
    expect(refused.parts).toEqual([]);
    expect(statusOf(chat.slots, 'yontem')).toBe('refused');
    expect(statusOf(chat.slots, 'islem_zamani')).toBe('refused');
  });
});

describe('the "resolved" criteria at a resolve step (K9 · tm 303.4)', () => {
  const yes = (): ProcedureUnderstanding => ({ ...heard(), yes_no: 'yes' });
  const no = (): ProcedureUnderstanding => ({ ...heard(), yes_no: 'no' });
  const finance = { handoff: { conditions: [], card_fields: [], target: { topic: 'finance' } } };

  it('by default it is not solved until the player says so: asked, then "hayır" hands over as player_said_unresolved', () => {
    const procedure = procedureOf(
      [
        { id: 'bilgi', type: 'say', instruction: 'Açıkla.' },
        { id: 'bitti', type: 'resolve', outcome: 'resolved' },
      ],
      finance,
    );
    const chat = conversation(procedure);
    const first = chat.say('x', null);
    expect(first.end).toEqual({ kind: 'confirming', stepId: 'bitti', outcome: 'resolved' });
    expect(first.resolution).toEqual({
      decision: 'asked',
      reason: 'awaiting_confirmation',
      basis: 'platform',
      result: 'unknown',
      unknown: ['fn player_confirmed'],
      confirmation: null,
      outcome: 'resolved',
      step_id: 'bitti',
    });
    expect(first.trace.at(-1)).toEqual({
      step_id: 'bitti',
      type: 'resolve',
      cond_result: null,
      detail: 'asked whether it is solved (platform criteria)',
    });

    const second = chat.say('hayır, hâlâ yok', no());
    expect(second.parts).toEqual([]);
    expect(second.end).toEqual({
      kind: 'handoff',
      stepId: 'bitti',
      reason: 'player_said_unresolved',
      target: { topic: 'finance' },
    });
    expect(second.resolution).toMatchObject({
      decision: 'unresolved',
      reason: 'player_said_no',
      result: false,
      confirmation: 'no',
    });
  });

  it('asked, and answered neither yes nor no: not solved — a person takes over (resolution_criteria_unmet)', () => {
    const chat = conversation(procedureOf([{ id: 'bitti', type: 'resolve', outcome: 'resolved' }]));
    chat.say('x', null);
    const second = chat.say('peki ne zaman?', heard());
    expect(second.end).toMatchObject({ kind: 'handoff', reason: 'resolution_criteria_unmet' });
    expect(second.resolution).toMatchObject({
      decision: 'unresolved',
      reason: 'not_confirmed',
      confirmation: null,
    });
  });

  it('a yes that was not the answer to "is it solved?" confirms nothing', () => {
    const result = conversation(
      procedureOf([{ id: 'bitti', type: 'resolve', outcome: 'resolved' }]),
    ).say('evet', yes());
    expect(result.end.kind).toBe('confirming');
    expect(result.resolution).toMatchObject({ decision: 'asked', confirmation: null });
  });

  it('the procedure’s own criteria: a slot it needs missing hands over at once, never asking; filled, the yes resolves', () => {
    const procedure = procedureOf(
      [
        { id: 'sor', type: 'collect', slots: ['a'] },
        { id: 'bitti', type: 'resolve', outcome: 'resolved' },
      ],
      {
        slots: [
          { name: 'a', label: 'A', type: 'text', ask: 'A?' },
          { name: 'b', label: 'B', type: 'text', ask: 'B?', required: 'never' },
        ],
        resolution_criteria: {
          all: [
            { slot: { name: 'b', op: 'exists' } },
            { fn: { name: 'player_confirmed', args: [] } },
          ],
        },
      },
    );
    const missing = conversation(procedure);
    missing.say('x', null);
    const handed = missing.say('a değeri', heard(['a', 'değer']));
    expect(handed.parts).toEqual([]);
    expect(handed.end).toMatchObject({ kind: 'handoff', reason: 'resolution_criteria_unmet' });
    expect(handed.resolution).toMatchObject({
      decision: 'unresolved',
      reason: 'criteria_unmet',
      basis: 'procedure',
      result: false,
    });

    const filled = conversation(procedure);
    filled.say('x', null);
    const asking = filled.say('değer ve öteki', heard(['a', 'değer'], ['b', 'öteki']));
    expect(asking.end.kind).toBe('confirming');
    const solved = filled.say('evet', yes());
    expect(solved.end).toEqual({ kind: 'resolved', stepId: 'bitti', outcome: 'resolved' });
    expect(solved.resolution).toMatchObject({
      decision: 'resolved',
      basis: 'procedure',
      result: true,
      confirmation: 'yes',
    });
  });

  it('criteria the conversation already meets resolve with no question — an ai answer under its key', () => {
    const procedure = procedureOf([{ id: 'bitti', type: 'resolve', outcome: 'resolved' }], {
      resolution_criteria: { ai: { question: 'Oyuncu sorununun çözüldüğünü söyledi mi?' } },
    });
    const told = conversation(procedure).say('tamam oldu, sağ olun', {
      ...heard(),
      ai_conditions: { 'resolution.criteria': true },
    });
    expect(told.end).toEqual({ kind: 'resolved', stepId: 'bitti', outcome: 'resolved' });
    expect(told.parts).toEqual([]);
    expect(told.resolution).toMatchObject({ decision: 'resolved', reason: 'criteria_met' });

    // Not the player's yes that is missing: asking would not help.
    const notTold = conversation(procedure).say('x', heard());
    expect(notTold.end).toMatchObject({ kind: 'handoff', reason: 'resolution_criteria_unmet' });
  });

  it('the workspace’s default, handed in, is what a procedure without its own is held to', () => {
    const result = runProcedureTurn({
      procedure: procedureOf([{ id: 'bitti', type: 'resolve', outcome: 'resolved' }]),
      at: null,
      slots: {},
      procedureTurns: 0,
      turn: 1,
      understanding: { ...heard(), ai_conditions: { 'resolution.criteria': true } },
      messages: ['x'],
      now: NOW,
      timeZone: TZ,
      currency: 'TRY',
      facts: NO_FACTS,
      language: 'en',
      resolution: { criteria: { ai: { question: 'Solved?' } }, basis: 'workspace' },
    });
    expect(result.end.kind).toBe('resolved');
    expect(result.resolution).toMatchObject({ decision: 'resolved', basis: 'workspace' });
  });

  it('asks in the persona’s language, by the outcome', () => {
    const run = (outcome: 'resolved' | 'resolved_waiting') =>
      runProcedureTurn({
        procedure: procedureOf([{ id: 'bitti', type: 'resolve', outcome }]),
        at: null,
        slots: {},
        procedureTurns: 0,
        turn: 1,
        understanding: null,
        messages: ['x'],
        now: NOW,
        timeZone: TZ,
        currency: 'TRY',
        facts: NO_FACTS,
        language: 'en',
      });
    expect(said(run('resolved'))).toEqual(['Has this solved your problem?']);
    expect(said(run('resolved_waiting'))).toEqual(['Was this information helpful?']);
  });
});

describe('the step loop', () => {
  const tags = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, type: 'tag', tag: `tag${i + 1}` }));

  it(`runs at most ${MAX_INNER_STEPS} steps a turn and goes on from there on the next`, () => {
    const procedure = procedureOf([
      ...tags(10),
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ]);
    const chat = conversation(procedure);
    const first = chat.say('x', null);
    expect(first.tags).toHaveLength(MAX_INNER_STEPS);
    expect(first.end).toEqual({ kind: 'paused', stepId: 't9' });
    expect(first.log.at(-1)).toMatchObject({ step: 't9', ok: false });
    const second = chat.say('y', null);
    expect(second.tags).toEqual(['tag9', 'tag10']);
    expect(second.end).toMatchObject({ kind: 'confirming', stepId: 'bitti' });
  });

  it('a loop through a collect whose slots are all given waits for nothing — the limit stops it', () => {
    const procedure = procedureOf([
      { id: 'sor', type: 'collect', slots: ['a'] },
      {
        id: 'geri',
        type: 'check',
        when: { slot: { name: 'a', op: 'exists' } },
        then: { goto: 'sor' },
      },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ]);
    const chat = conversation(procedure);
    chat.say('x', null);
    const spun = chat.say('değer', heard(['a', 'değer']));
    expect(spun.end).toEqual({ kind: 'paused', stepId: 'sor' });
    expect(spun.trace).toHaveLength(MAX_INNER_STEPS);
  });

  it('a step whose when does not hold is passed, with the condition’s result, and is not counted', () => {
    const procedure = procedureOf([
      {
        id: 'kosullu',
        type: 'tag',
        tag: 'x',
        when: { slot: { name: 'a', op: 'eq', value: 'evet' } },
      },
      ...tags(MAX_INNER_STEPS),
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ]);
    const result = conversation(procedure).say('x', null);
    expect(result.trace[0]).toEqual({
      step_id: 'kosullu',
      type: 'tag',
      cond_result: 'unknown',
      detail: 'passed — its condition does not hold',
    });
    expect(result.tags).toHaveLength(MAX_INNER_STEPS);
    expect(result.end).toEqual({ kind: 'paused', stepId: 'bitti' });
  });

  it('a step written in a check branch goes on after the check; one that ends, ends', () => {
    const procedure = procedureOf([
      {
        id: 'kontrol',
        type: 'check',
        when: { slot: { name: 'a', op: 'missing' } },
        then: { type: 'tag', tag: 'eksik' },
        else: { type: 'resolve', outcome: 'resolved' },
      },
      { id: 'sonra', type: 'tag', tag: 'sonra' },
      { id: 'bitti', type: 'handoff', reason_code: 'needs_person' },
    ]);
    const missing = conversation(procedure).say('x', null);
    expect(missing.tags).toEqual(['eksik', 'sonra']);
    expect(missing.trace[0]).toEqual({
      step_id: 'kontrol',
      type: 'tag',
      cond_result: true,
      detail: 'then: tagged "eksik"',
    });
    expect(missing.end).toMatchObject({ kind: 'handoff', reason: 'needs_person', target: null });

    const result = runProcedureTurn({
      procedure,
      at: null,
      slots: { a: { value: 'v', display: 'v', status: 'filled' } },
      procedureTurns: 0,
      turn: 1,
      understanding: null,
      messages: ['x'],
      now: NOW,
      timeZone: TZ,
      currency: 'TRY',
      facts: NO_FACTS,
      language: 'tr',
      // Criteria the turn already meets: the branch's `resolve` resolves.
      resolution: { criteria: { slot: { name: 'a', op: 'exists' } }, basis: 'procedure' },
    });
    expect(result.tags).toEqual([]);
    expect(result.end).toEqual({ kind: 'resolved', stepId: 'kontrol', outcome: 'resolved' });
  });

  it('answer_from_knowledge asks for a knowledge answer, with its hint; the procedure goes on', () => {
    const procedure = procedureOf([
      { id: 'bilgi', type: 'answer_from_knowledge', query_hint: 'yatırım süreleri' },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ]);
    const result = conversation(procedure).say('x', null);
    expect(result.parts).toEqual([
      { kind: 'knowledge', at: 'bilgi', queryHint: 'yatırım süreleri' },
      { kind: 'resolution', at: 'bitti', text: 'Sorununuz çözüldü mü?' },
    ]);
    expect(result.end.kind).toBe('confirming');
  });

  it('running past the last step finishes the procedure', () => {
    const result = conversation(procedureOf([{ id: 'tek', type: 'tag', tag: 'x' }])).say('x', null);
    expect(result.end).toEqual({ kind: 'finished' });
  });

  it('a stored step it cannot find starts the procedure over, and says so', () => {
    const procedure = procedureOf([
      { id: 'tek', type: 'tag', tag: 'x' },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ]);
    const result = runProcedureTurn({
      procedure,
      at: { stepId: 'silinmis' },
      slots: {},
      procedureTurns: 1,
      turn: 2,
      understanding: null,
      messages: ['x'],
      now: NOW,
      timeZone: TZ,
      currency: 'TRY',
      facts: NO_FACTS,
      language: 'tr',
    });
    expect(result.log[0]).toMatchObject({ step: 'silinmis', ok: false });
    expect(result.tags).toEqual(['x']);
  });
});

describe('the pinned definition (AI-03 §3 · ADR-14b §2.9)', () => {
  it('the hash is the sha256 of the canonical JSON — the order the keys come in does not change it', () => {
    const procedure = depositProcedure();
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(procedure).reverse())),
    ) as Procedure;
    expect(procedureHash(reordered)).toBe(procedureHash(procedure));
    expect(procedureHash(procedure)).toMatch(/^[0-9a-f]{64}$/);
    const edited = depositProcedure((raw) => {
      raw['priority'] = 51;
    });
    expect(procedureHash(edited)).not.toBe(procedureHash(procedure));
    expect(procedureHash(procedure)).toBe(
      createHash('sha256')
        .update(JSON.stringify(sortKeys(procedure)))
        .digest('hex'),
    );
  });

  it('a snapshot read back is judged again: a hand-edited, broken definition is not run', () => {
    const snapshot: ProcedureSnapshot = {
      skill_name: 'Yatırım',
      ai_agent_id: null,
      locked: false,
      procedure: depositProcedure(),
    };
    expect(readSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    const broken = JSON.parse(JSON.stringify(snapshot)) as { procedure: { steps: unknown[] } };
    broken.procedure.steps = [];
    expect(readSnapshot(broken)).toBeNull();
    expect(readSnapshot(null)).toBeNull();
  });

  it('the active procedure is read from the state only while a step is awaiting or ready', () => {
    const snapshot: ProcedureSnapshot = {
      skill_name: 'Yatırım',
      ai_agent_id: 'agent-1',
      locked: false,
      procedure: depositProcedure(),
    };
    const state = {
      ...emptyTurnState(),
      activeSkillId: 'skill-1',
      procedureSnapshot: snapshot as unknown as Record<string, unknown>,
      procedureSnapshotHash: procedureHash(snapshot.procedure),
      stepId: 'yontem_zaman',
      stepStatus: 'awaiting_answer' as const,
      counters: { turns: 1, procedure_turns: 1 },
    };
    const active = activeProcedure(state);
    expect(active).toMatchObject({ skillId: 'skill-1', stepId: 'yontem_zaman', procedureTurns: 1 });
    expect(activeProcedure({ ...state, stepStatus: 'done' })).toBeNull();
    expect(activeProcedure({ ...state, procedureSnapshot: { skill_name: 'x' } })).toBeNull();

    const aside = suspend(active!, { yontem: { status: 'filled', display: 'Papara' } }, NOW);
    const stored = readSuspended(JSON.parse(JSON.stringify(aside)));
    expect(stored).toEqual(aside);
    expect(resumed(stored!)).toEqual(active);
  });
});

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}
