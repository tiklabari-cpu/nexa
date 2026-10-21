import { describe, expect, it } from 'vitest';
import {
  QUEUE_TOPIC_ROLES,
  compileForbiddenPhrase,
  matchForbiddenPhrases,
  validateProcedure,
  validateSkillProcedure,
  type ProcStep,
  type Procedure,
} from '@siyahtus/types';
import { templateSkillFields, templateTopics } from '../catalogue.js';
import { templateFacts } from '../validate.js';
import { DEPOSIT_NOT_CREDITED } from './deposit-not-credited.js';

function validated(): Procedure {
  const result = validateProcedure(DEPOSIT_NOT_CREDITED.procedure, {
    topics: new Set(QUEUE_TOPIC_ROLES),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
  expect(result.warnings).toEqual([]);
  return result.procedure;
}

function step(procedure: Procedure, id: string): ProcStep {
  const found = procedure.steps.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no step ${id}`);
  return found;
}

/** Where a `check` jumps when its condition holds. */
function jump(procedure: Procedure, id: string): string {
  const check = step(procedure, id);
  if (check.type !== 'check' || !('goto' in check.then)) throw new Error(`${id} is no goto check`);
  return check.then.goto;
}

/**
 * The run from a step to the step that ends it, straight down — what a path
 * collects and says before it ends. The template's paths after a jump have
 * no checks of their own.
 */
function path(procedure: Procedure, from: string): ProcStep[] {
  const start = procedure.steps.findIndex((s) => s.id === from);
  const out: ProcStep[] = [];
  for (const s of procedure.steps.slice(start)) {
    out.push(s);
    if (s.type === 'handoff' || s.type === 'resolve') break;
  }
  return out;
}

function collected(steps: ProcStep[]): string[] {
  return steps.flatMap((s) => (s.type === 'collect' ? s.slots : []));
}

function said(steps: ProcStep[]): string[] {
  return steps.flatMap((s) => (s.type === 'say' && s.template_key ? [s.template_key] : []));
}

function last(steps: ProcStep[]): ProcStep {
  return steps[steps.length - 1] as ProcStep;
}

describe('deposit_not_credited — research §3.1 in full', () => {
  it('is a valid procedure that hands over only to the finance topic', () => {
    validated();
    expect(DEPOSIT_NOT_CREDITED).toMatchObject({
      key: 'deposit_not_credited',
      version: 1,
      industry: 'igaming',
      lang: 'tr',
      locked: false,
    });
    expect(templateTopics(DEPOSIT_NOT_CREDITED)).toEqual(['finance']);
  });

  it('collects the §3.1 slot table: who, method, amount, time, request, account, sender, evidence', () => {
    const slots = Object.fromEntries(
      validated().slots.map((slot) => [slot.name, [slot.type, slot.required]]),
    );
    expect(Object.keys(slots)).toEqual([
      'kullanici_adi',
      'yontem',
      'islem_zamani',
      'talep_olusturuldu',
      'gosterilen_hesap',
      'gonderen_kendisi',
      'tutar',
      'referans',
      'dekont',
      'kripto_agi',
      'txid',
      'iban_son4',
    ]);
    expect(slots).toMatchObject({
      kullanici_adi: ['username', 'always'],
      yontem: ['enum', 'always'],
      tutar: ['money', 'always'],
      islem_zamani: ['datetime', 'always'],
      talep_olusturuldu: ['boolean', 'always'],
      gonderen_kendisi: ['boolean', 'always'],
      // Conditional (§3.1 "koşullu"): crypto asks the network and TXID, the rest a reference or a receipt.
      referans: ['reference_code', { when: expect.any(Object) }],
      dekont: ['file', { when: expect.any(Object) }],
      kripto_agi: ['crypto_network', { when: expect.any(Object) }],
      txid: ['txid', { when: expect.any(Object) }],
      // Never the whole IBAN: its last four.
      iban_son4: ['iban_last4', { when: expect.any(Object) }],
    });
    const method = validated().slots.find((slot) => slot.name === 'yontem');
    expect(method?.validate).toEqual({ enum_source: 'payment_methods.deposit' });
  });

  it('asks method and time first, at most two questions at once', () => {
    const procedure = validated();
    expect(procedure.steps.slice(0, 2)).toEqual([
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'yontem_zaman', type: 'collect', slots: ['yontem', 'islem_zamani'] },
    ]);
    for (const s of procedure.steps) {
      if (s.type === 'collect') expect(s.slots.length, s.id).toBeLessThanOrEqual(2);
    }
  });

  it('within the expected time: pattern A, then resolved waiting with the follow-up (step 3)', () => {
    const procedure = validated();
    expect(step(procedure, 'sure_icinde')).toMatchObject({
      when: {
        fn: {
          name: 'elapsed_minutes',
          args: ['islem_zamani'],
          op: 'lt',
          value: { fact: 'method.expected_minutes' },
        },
      },
    });
    const wait = path(procedure, jump(procedure, 'sure_icinde'));
    expect(said(wait)).toEqual(['normal_sure']);
    expect(last(wait)).toEqual({
      id: 'bekleme_bitti',
      type: 'resolve',
      outcome: 'resolved_waiting',
      followup_template: 'takip',
    });
  });

  it('outside the method’s working hours: pattern B and the next window (step 3)', () => {
    const procedure = validated();
    expect(step(procedure, 'mesai_disi')).toMatchObject({
      when: { not: { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } } },
    });
    const window = path(procedure, jump(procedure, 'mesai_disi'));
    expect(said(window)).toEqual(['mesai_disi']);
    expect(last(window)).toMatchObject({ type: 'resolve', outcome: 'resolved_waiting' });
  });

  it('every hand-over path collects the player and the amount first, and says why before it hands over', () => {
    const procedure = validated();
    const ends: Array<[string, string, string]> = [
      [jump(procedure, 'talep_yok'), 'no_site_request', 'talep_yok'],
      [jump(procedure, 'farkli_hesap'), 'wrong_account_or_network', 'yanlis_hesap'],
      [jump(procedure, 'ucuncu_kisi'), 'third_party_payment', 'ucuncu_kisi'],
      [jump(procedure, 'tutar_disi'), 'amount_out_of_range', 'tutar_araligi'],
      ['kimlik', 'expected_time_exceeded', 'devir'],
    ];
    for (const [from, reason, template] of ends) {
      const run = path(procedure, from);
      const before = [...collected(path(procedure, 'yontem_zaman')), ...collected(run)];
      // The amount path asked the amount before it jumped.
      if (reason === 'amount_out_of_range') before.push('tutar');
      expect(before, reason).toEqual(expect.arrayContaining(['kullanici_adi', 'tutar']));
      expect(said(run).at(-1), reason).toBe(template);
      expect(last(run), reason).toMatchObject({ type: 'handoff', reason_code: reason });
    }
  });

  it('C — no site request: the reference or receipt is collected before finance (step 4)', () => {
    const procedure = validated();
    const run = path(procedure, jump(procedure, 'talep_yok'));
    expect(collected(run)).toEqual(['tutar', 'kullanici_adi', 'referans', 'dekont']);
    expect(said(run)).toEqual(['kanit', 'talep_yok']);
  });

  it('D — a different account or network: the IBAN’s last four or the network, and the TXID (step 4)', () => {
    const procedure = validated();
    const run = path(procedure, jump(procedure, 'farkli_hesap'));
    expect(collected(run)).toEqual(
      expect.arrayContaining(['iban_son4', 'kripto_agi', 'txid', 'tutar', 'kullanici_adi']),
    );
  });

  it('the main path: sender, amount range, evidence with the card-and-password warning, the passive lookup, finance (steps 5–8)', () => {
    const procedure = validated();
    const run = path(procedure, 'kimlik');
    expect(run.map((s) => s.id)).toEqual([
      'kimlik',
      'ucuncu_kisi',
      'tutar_sor',
      'tutar_disi',
      'kullanici',
      'kanit_uyari',
      'kanit',
      'kripto_kanit',
      'yatirim_sorgula',
      'finans_kalibi',
      'finansa_devir',
    ]);
    expect(step(procedure, 'tutar_disi')).toMatchObject({
      when: {
        any: [
          { slot: { name: 'tutar', op: 'lt', value: { fact: 'method.min_amount' } } },
          { slot: { name: 'tutar', op: 'gt', value: { fact: 'method.max_amount' } } },
        ],
      },
    });
    expect(step(procedure, 'yatirim_sorgula')).toEqual({
      id: 'yatirim_sorgula',
      type: 'tool',
      tool_key: 'deposit_lookup',
      inputs: { user_id: 'kullanici_adi', amount: 'tutar', time: 'islem_zamani' },
      active: false,
    });
  });

  it('reply patterns A–D are hedged and promise nothing (G7)', () => {
    const text = Object.fromEntries(
      DEPOSIT_NOT_CREDITED.procedure.templates.map((t) => [t.key, t.text]),
    );
    expect(text['normal_sure']).toMatch(/genellikle \{method\.expected_minutes\} içinde/);
    expect(text['mesai_disi']).toMatch(/genellikle \{method\.working_hours\}/);
    expect(text['mesai_disi']).toContain('{next_window(method)}');
    expect(text['talep_yok']).toContain('site üzerinden yatırım talebi');
    expect(text['yanlis_hesap']).toContain('her zaman mümkün olmayabilir');
    expect(text['ucuncu_kisi']).toMatch(/^Politikamıza göre/);
    expect(text['kanit']).toMatch(/Kart numaranızı, şifrenizi/);
  });

  it('its forbidden phrases catch every §3.1 "yasak yanıt", and none of its own texts', () => {
    const phrases = DEPOSIT_NOT_CREDITED.forbidden_phrases.map((p) => {
      const compiled = compileForbiddenPhrase(p.phrase, p.match);
      if (compiled === null) throw new Error(p.phrase);
      return compiled;
    });
    for (const banned of [
      'Hesabınıza geçti.',
      'Kontrol ettim, sorun yok.',
      'Sistemde görünüyor.',
      '5 dakikaya yatar.',
      'Merak etmeyin, 2 saate geçer.',
      'Kesin geri alırız.',
      'Tekrar yatırın, bu sefer geçer.',
      'Bir daha yatırabilirsiniz.',
    ]) {
      expect(matchForbiddenPhrases(banned, phrases), banned).not.toEqual([]);
    }
    for (const t of DEPOSIT_NOT_CREDITED.procedure.templates) {
      expect(matchForbiddenPhrases(t.text, phrases), t.key).toEqual([]);
    }
  });

  it('tells the tenant which payment-method columns it reads — exactly the facts it uses', () => {
    expect(DEPOSIT_NOT_CREDITED.tenant_must_fill).toHaveLength(1);
    const table = DEPOSIT_NOT_CREDITED.tenant_must_fill[0];
    expect(table).toMatchObject({ kind: 'table', table: 'payment_methods.deposit' });
    expect(templateFacts(DEPOSIT_NOT_CREDITED).sort()).toEqual(
      table?.kind === 'table' ? [...table.columns].sort() : [],
    );
  });

  it('carries at least three scenarios: the wait, the window, and hand-overs with their reasons', () => {
    const scenarios = DEPOSIT_NOT_CREDITED.scenarios;
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    expect(scenarios.map((s) => s.expect.outcome)).toEqual(
      expect.arrayContaining(['resolved_waiting', 'handoff']),
    );
    expect(scenarios.map((s) => s.expect.reason_code).filter(Boolean)).toEqual([
      'expected_time_exceeded',
      'no_site_request',
      'third_party_payment',
    ]);
  });

  it('installs as a procedure skill: the four own fields and the body, a deep copy that passes', () => {
    const fields = templateSkillFields(DEPOSIT_NOT_CREDITED);
    expect(Object.keys(fields.procedure).sort()).toEqual([
      'handoff',
      'limits',
      'steps',
      'templates',
    ]);
    expect(validateSkillProcedure(fields, { topics: new Set(QUEUE_TOPIC_ROLES) })).toMatchObject({
      ok: true,
    });
    fields.slots[0]!.label = 'changed';
    fields.procedure.steps.pop();
    expect(DEPOSIT_NOT_CREDITED.procedure.slots[0]!.label).toBe('Kullanıcı adı / üye no');
    expect(validated().steps.at(-1)).toMatchObject({ id: 'mesai_bitti' });
  });
});
