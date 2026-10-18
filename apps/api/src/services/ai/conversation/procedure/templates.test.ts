/**
 * Template filling (tm 296.7 · AI-03 §4 `say`): slots, facts and functions as
 * the player reads them; a template with a variable the conversation cannot
 * fill is not sent — the run log records it and a `say` step falls back to its
 * instruction; `verbatim` passes through; a sensitive slot never enters a
 * message — against templates the save-time validator accepts.
 */
import { validateProcedure, type ProcTemplate } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import type { SkillRunLogEntry } from '../turn.js';
import { NO_FACTS, fixtureFacts } from './conditions.js';
import {
  fillTemplate,
  renderSay,
  renderTemplate,
  variableText,
  type TemplateContext,
} from './templates.js';

const SLOTS = [
  {
    name: 'yontem',
    label: 'Yöntem',
    type: 'enum',
    ask: 'Hangi yöntemle yatırdınız?',
    validate: { enum_source: 'payment_methods.deposit' },
  },
  {
    name: 'belge',
    label: 'Belge',
    type: 'enum',
    ask: 'Hangi belge?',
    validate: { enum_source: 'kyc_documents' },
  },
  { name: 'islem_zamani', label: 'İşlem zamanı', type: 'datetime', ask: 'Saat kaçta?' },
  { name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar?' },
  { name: 'adet', label: 'Adet', type: 'number', ask: 'Kaç işlem?' },
  { name: 'telefon', label: 'Telefon', type: 'phone', ask: 'Telefonunuz?', pii: 'high' },
];

const TEMPLATES: ProcTemplate[] = [
  {
    key: 'bekleme',
    text: '{yontem} ile yatırımların hesaba geçmesi ortalama {method.expected_minutes} sürer; işleminizin üzerinden {elapsed_minutes(islem_zamani)} geçti.',
  },
  {
    key: 'mesai_disi',
    text: '{yontem} işlemleri mesai saatlerinde işlenir. Mesai içinde mi: {within_working_hours(method, islem_zamani)}. Sonraki işlem penceresi: {next_window(method)}.',
  },
  {
    key: 'tutar_alt',
    text: '{yontem} için en düşük tutar {method.min_amount}; siz {tutar} gönderdiniz.',
  },
  {
    key: 'kyc',
    text: '{belge} incelemesi {kyc_document.review_hours} sürer. Sohbetten yükleme: {kyc_document.chat_upload_allowed}.',
  },
  { key: 'site', text: '{site_adi} hesabınızdan talep oluşturun.' },
  {
    key: 'yasal',
    text: '18 yaşından küçüklerin {site_adi} hizmetlerini kullanması yasaktır.',
    verbatim: true,
  },
  { key: 'telefon_teyit', text: '{telefon} numaranıza ulaşacağız.' },
];

it('every template here is one the save-time validator accepts', () => {
  const result = validateProcedure(
    {
      when_to_use: 'Yatırım hesaba geçmedi',
      slots: SLOTS,
      templates: TEMPLATES,
      steps: TEMPLATES.map((t) => ({ id: `s_${t.key}`, type: 'say', template_key: t.key })),
    },
    { placeholders: new Set(['site_adi']) },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
  expect(result.ok).toBe(true);
});

/** 2026-10-16 22:15 Istanbul: 35 minutes after the 21:40 deposit. */
const NOW = new Date('2026-10-16T19:15:00Z');

const SLOT_STATE = {
  yontem: { value: 'Papara', display: 'Papara', status: 'filled' },
  belge: { display: 'Kimlik', status: 'carried' },
  islem_zamani: {
    value: { date: '2026-10-16', time: '21:40', time_zone: 'Europe/Istanbul' },
    display: '16.10.2026 21:40',
    status: 'filled',
  },
  tutar: { value: { amount: 2500, currency: 'TRY' }, display: '2.500 TRY', status: 'filled' },
  telefon: { value: '+905551112233', display: '+90 555 111 22 33', status: 'filled', pii: 'high' },
};

const FACTS = fixtureFacts({
  facts: {
    'method.expected_minutes': 30,
    'method.min_amount': 10_000,
    'kyc_document.review_hours': 26,
    'kyc_document.chat_upload_allowed': false,
  },
  withinWorkingHours: () => false,
  nextWindow: () => new Date('2026-10-17T06:00:00Z'),
});

function ctx(over: Partial<TemplateContext> = {}): TemplateContext {
  return {
    slots: SLOT_STATE,
    facts: FACTS,
    now: NOW,
    timeZone: 'Europe/Istanbul',
    placeholders: { site_adi: 'SiyahBet' },
    ...over,
  };
}

function text(key: string): string {
  return (TEMPLATES.find((t) => t.key === key) as ProcTemplate).text;
}

describe('filling', () => {
  it('slots by their display, facts and functions as the player reads them', () => {
    expect(fillTemplate(text('bekleme'), ctx())).toEqual({
      ok: true,
      text: 'Papara ile yatırımların hesaba geçmesi ortalama 30 dk sürer; işleminizin üzerinden 35 dk geçti.',
    });
    expect(fillTemplate(text('tutar_alt'), ctx())).toEqual({
      ok: true,
      text: 'Papara için en düşük tutar 10.000; siz 2.500 TRY gönderdiniz.',
    });
    // Hours as a duration, a yes/no in words; a carried slot by its display.
    expect(fillTemplate(text('kyc'), ctx())).toEqual({
      ok: true,
      text: 'Kimlik incelemesi 1 gün 2 saat sürer. Sohbetten yükleme: hayır.',
    });
  });

  it('next_window on the tenant clock (Kalıp B)', () => {
    expect(fillTemplate(text('mesai_disi'), ctx())).toEqual({
      ok: true,
      text: 'Papara işlemleri mesai saatlerinde işlenir. Mesai içinde mi: hayır. Sonraki işlem penceresi: 17.10.2026 09:00.',
    });
    expect(variableText('next_window(method)', ctx({ timeZone: 'UTC' }))).toEqual({
      ok: true,
      text: '17.10.2026 06:00',
    });
  });

  it('a tenant placeholder is filled from its value', () => {
    expect(fillTemplate(text('site'), ctx())).toEqual({
      ok: true,
      text: 'SiyahBet hesabınızdan talep oluşturun.',
    });
  });

  it('no time has passed reads "0 dk", not an empty string', () => {
    expect(
      variableText('elapsed_minutes(islem_zamani)', ctx({ now: new Date('2026-10-16T18:40:00Z') })),
    ).toEqual({
      ok: true,
      text: '0 dk',
    });
  });

  it('text without variables, and a lone brace, are left as written', () => {
    expect(fillTemplate('Teşekkürler {', ctx())).toEqual({ ok: true, text: 'Teşekkürler {' });
  });
});

describe('a variable the conversation cannot fill: the template is not sent', () => {
  it('every miss is listed with its reason, and no text comes back', () => {
    const fill = fillTemplate(
      '{yontem} {adet} {method.delay_threshold_minutes} {telefon} {bilinmeyen_yer} { yöntem } {}',
      ctx(),
    );
    expect(fill).toEqual({
      ok: false,
      missing: [
        { variable: 'adet', reason: 'unknown' },
        { variable: 'method.delay_threshold_minutes', reason: 'unknown' },
        { variable: 'telefon', reason: 'sensitive' },
        { variable: 'bilinmeyen_yer', reason: 'unknown' },
        { variable: ' yöntem ', reason: 'not_a_variable' },
        { variable: '', reason: 'not_a_variable' },
      ],
    });
  });

  it('with the facts stub (until #310) a fact template is not sent', () => {
    const fill = fillTemplate(text('bekleme'), ctx({ facts: NO_FACTS }));
    expect(fill).toEqual({
      ok: false,
      missing: [{ variable: 'method.expected_minutes', reason: 'unknown' }],
    });
  });

  it('a moment given as a day alone has no elapsed minutes to show', () => {
    const partial = ctx({
      slots: {
        ...SLOT_STATE,
        islem_zamani: {
          value: { date: '2026-10-16', time: null, time_zone: 'Europe/Istanbul' },
          display: '16.10.2026 akşam',
          status: 'partial',
        },
      },
    });
    expect(fillTemplate(text('bekleme'), partial)).toEqual({
      ok: false,
      missing: [{ variable: 'elapsed_minutes(islem_zamani)', reason: 'unknown' }],
    });
  });

  it('an unset or blank placeholder', () => {
    expect(fillTemplate(text('site'), ctx({ placeholders: {} })).ok).toBe(false);
    expect(fillTemplate(text('site'), ctx({ placeholders: { site_adi: '  ' } })).ok).toBe(false);
  });

  it('a pii: high slot never enters a message (AI-04 §9)', () => {
    const log: SkillRunLogEntry[] = [];
    expect(renderTemplate('telefon_teyit', TEMPLATES, ctx(), 's_telefon_teyit', log)).toBeNull();
    expect(log).toEqual([
      {
        step: 's_telefon_teyit',
        detail: 'template telefon_teyit not sent: {telefon} sensitive',
        ok: false,
      },
    ]);
    expect(JSON.stringify(log)).not.toMatch(/555/);
  });
});

describe('renderTemplate and renderSay', () => {
  it('a filled template carries its key and verbatim flag', () => {
    const log: SkillRunLogEntry[] = [];
    expect(renderTemplate('yasal', TEMPLATES, ctx(), 's_yasal', log)).toEqual({
      key: 'yasal',
      text: '18 yaşından küçüklerin SiyahBet hizmetlerini kullanması yasaktır.',
      verbatim: true,
    });
    expect(renderTemplate('bekleme', TEMPLATES, ctx(), 's_bekleme', log)?.verbatim).toBe(false);
    expect(log).toEqual([]);
  });

  it('the miss goes to the run log under the step, by variable name, never a value', () => {
    const log: SkillRunLogEntry[] = [];
    expect(
      renderTemplate('bekleme', TEMPLATES, ctx({ facts: NO_FACTS }), 'bekleme_say', log),
    ).toBeNull();
    expect(log).toEqual([
      {
        step: 'bekleme_say',
        detail: 'template bekleme not sent: {method.expected_minutes} unknown',
        ok: false,
      },
    ]);
    expect(JSON.stringify(log)).not.toMatch(/Papara|2\.500/);
  });

  it('a key the snapshot does not have is logged', () => {
    const log: SkillRunLogEntry[] = [];
    expect(renderTemplate('yok', TEMPLATES, ctx(), 'x', log)).toBeNull();
    expect(log).toEqual([
      { step: 'x', detail: 'template yok not sent: no such template', ok: false },
    ]);
  });

  it('say: the template when it fills', () => {
    const log: SkillRunLogEntry[] = [];
    expect(
      renderSay(
        { id: 'a', type: 'say', template_key: 'bekleme', instruction: 'Bekleme süresini açıkla.' },
        TEMPLATES,
        ctx(),
        'a',
        log,
      ),
    ).toEqual({
      kind: 'template',
      key: 'bekleme',
      text: 'Papara ile yatırımların hesaba geçmesi ortalama 30 dk sürer; işleminizin üzerinden 35 dk geçti.',
      verbatim: false,
    });
    expect(log).toEqual([]);
  });

  it('say: the instruction when the template cannot fill, with the miss logged', () => {
    const log: SkillRunLogEntry[] = [];
    expect(
      renderSay(
        {
          id: 'a',
          type: 'say',
          template_key: 'bekleme',
          instruction: '  Bekleme süresini açıkla.  ',
        },
        TEMPLATES,
        ctx({ facts: NO_FACTS }),
        'a',
        log,
      ),
    ).toEqual({ kind: 'instruction', text: 'Bekleme süresini açıkla.' });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ step: 'a', ok: false });
  });

  it('say inside a check branch (no id) logs under the check', () => {
    const log: SkillRunLogEntry[] = [];
    expect(
      renderSay(
        { type: 'say', template_key: 'bekleme' },
        TEMPLATES,
        ctx({ facts: NO_FACTS }),
        'sure_kontrol',
        log,
      ),
    ).toEqual({
      kind: 'nothing',
    });
    expect(log).toEqual([
      {
        step: 'sure_kontrol',
        detail: 'template bekleme not sent: {method.expected_minutes} unknown',
        ok: false,
      },
      { step: 'sure_kontrol', detail: 'say step has nothing to say', ok: false },
    ]);
  });

  it('say with only an instruction', () => {
    const log: SkillRunLogEntry[] = [];
    expect(
      renderSay({ id: 'b', type: 'say', instruction: 'Selamla.' }, TEMPLATES, ctx(), 'b', log),
    ).toEqual({
      kind: 'instruction',
      text: 'Selamla.',
    });
    expect(log).toEqual([]);
  });
});
