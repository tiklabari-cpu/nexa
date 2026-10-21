/**
 * "Limitimi değiştirmek istiyorum" — research §3 row 13, guardrail G6 (tm
 * 311.2 · AI-15).
 *
 * Which limit and which way. Lowering one is the player's own to do on the
 * site and usually takes effect at once: the AI says how and asks whether it
 * worked — yes is solved (the procedure's own criterion), no is a person.
 * Raising or removing one is never made easier by the AI (G6): the waiting
 * period is mentioned "politikamıza göre" and the responsible gambling team
 * takes it. G6's own input lexicon hands "limitimi yükseltmek istiyorum" over
 * before this procedure runs; this one covers the request made in two steps.
 */
import type { AiTemplate } from '../catalogue.js';
import { usernameSlot } from './shared.js';

export const LIMIT_CHANGE: AiTemplate = {
  key: 'limit_change',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Limit ayarlama',
  summary:
    'Oyuncu yatırım, kayıp, bahis ya da süre limitini değiştirmek istediğinde limiti düşürmenin site üzerinden nasıl yapılacağını anlatır; yükseltme ya da kaldırma talebini kolaylaştırmadan sorumlu oyun ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu yatırım, kayıp, bahis ya da oturum süresi limitini koymak, düşürmek, yükseltmek ya da kaldırmak istiyor.',
    examples: [
      'limit değiştirmek istiyorum',
      'limit koymak istiyorum',
      'yatırım limitimi düşürmek istiyorum',
      'kayıp limiti nasıl ayarlanır',
      'limitimi değiştirebilir miyim',
      'oturum süresi limiti koymak istiyorum',
      'I want to set a deposit limit',
    ],
    priority: 40,
    slots: [
      {
        name: 'limit_turu',
        label: 'Limit türü',
        type: 'enum',
        ask: 'Hangi limiti değiştirmek istiyorsunuz: yatırım, kayıp, bahis ya da süre?',
        validate: { enum_values: ['Yatırım', 'Kayıp', 'Bahis', 'Süre'] },
      },
      {
        name: 'yon',
        label: 'İstenen değişiklik',
        type: 'enum',
        ask: 'Limiti düşürmek mi, yükseltmek mi yoksa kaldırmak mı istiyorsunuz?',
        validate: { enum_values: ['Düşür', 'Yükselt', 'Kaldır'] },
      },
      {
        name: 'ayarlandi',
        label: 'Siteden ayarlandı',
        type: 'boolean',
        ask: 'Limiti bu adımlarla ayarlayabildiniz mi?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'limit_sor', type: 'collect', slots: ['limit_turu', 'yon'] },
      // Raising or removing a limit is never made easier (G6): a person, and the waiting period.
      {
        id: 'artis',
        type: 'check',
        when: { slot: { name: 'yon', op: 'in', value: ['Yükselt', 'Kaldır'] } },
        then: { goto: 'artis_bilgi' },
      },
      { id: 'dusurme', type: 'say', template_key: 'dusurme_adimlari' },
      { id: 'sonuc_sor', type: 'collect', slots: ['ayarlandi'] },
      {
        id: 'ayarlanamadi',
        type: 'check',
        when: { slot: { name: 'ayarlandi', op: 'eq', value: false } },
        then: { goto: 'yardim_bilgi' },
      },
      // Solved by the player's own yes (the procedure's criterion): the closing line goes with it.
      {
        id: 'ayarlandi_bitti',
        type: 'resolve',
        outcome: 'resolved',
        followup_template: 'kapanis',
      },

      { id: 'yardim_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'yardim_kalibi', type: 'say', template_key: 'devir' },
      { id: 'yardim_devir', type: 'handoff', reason_code: 'limit_setting_failed' },

      { id: 'artis_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'artis_kalibi', type: 'say', template_key: 'artis' },
      { id: 'artis_devir', type: 'handoff', reason_code: 'limit_increase_request' },
    ],
    templates: [
      {
        key: 'dusurme_adimlari',
        text: '{limit_turu} limitinizi hesabınızdaki Sorumlu Oyun › Limitler bölümünden kendiniz düşürebilirsiniz. Limit düşürme genellikle kaydettiğiniz anda geçerli olur.',
      },
      {
        key: 'kapanis',
        text: 'Limitinizi ayarladığınıza sevindim. Limitlerinizi aynı bölümden dilediğiniz zaman düşürebilirsiniz.',
      },
      {
        key: 'artis',
        text: 'Politikamıza göre limit yükseltme ve kaldırma talepleri bir bekleme süresine tabidir ve sorumlu oyun ekibimiz tarafından değerlendirilir. Talebinizi onlara iletiyorum.',
      },
      {
        key: 'devir',
        text: 'Limiti siteden ayarlayamadığınız için talebinizi sorumlu oyun ekibimize iletiyorum; bir uzman bu sohbet üzerinden size yardımcı olacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'responsible_gambling' },
      card_fields: ['limit_turu', 'yon'],
      next_step_hint:
        '{limit_turu} limiti talebini sorumlu oyun politikasına ve bekleme süresine göre değerlendirin.',
    },
    limits: { max_turns: 6 },
    resolution_criteria: { slot: { name: 'ayarlandi', op: 'eq', value: true } },
  },
  forbidden_phrases: [
    {
      phrase: 'limitinizi yükselttim',
      match: 'word',
      why: 'Yapay zekâ limit yükseltmez ve kolaylaştırmaz (G6).',
    },
    {
      phrase: 'hemen yükseltilir',
      match: 'word',
      why: 'Limit yükseltme için söz verilmez (G6, G7).',
    },
    {
      phrase: 'limitsiz',
      match: 'word',
      why: 'Limitin kaldırılması teşvik edilmez (G6).',
    },
  ],
  tenant_must_fill: [],
  scenarios: [
    {
      key: 'limit_dusurme',
      name: 'Yatırım limitini düşürmek — siteden nasıl yapılacağı anlatılır, ayarlandı',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['yatırım limitimi düşürmek istiyorum', 'yatırım limiti, düşürmek', 'evet'],
      facts: {},
      expect: {
        outcome: 'resolved',
        required_slots: ['limit_turu', 'yon', 'ayarlandi'],
        values: { limit_turu: 'Yatırım', yon: 'Düşür' },
      },
    },
    {
      key: 'limit_yukseltme',
      name: 'Kayıp limitini yükseltmek — kolaylaştırılmaz, sorumlu oyun ekibine',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['limit değiştirmek istiyorum', 'kayıp, yükseltmek istiyorum', 'ahmet77'],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'limit_increase_request',
        topic: 'responsible_gambling',
        required_slots: ['limit_turu', 'yon', 'kullanici_adi'],
        values: { limit_turu: 'Kayıp', yon: 'Yükselt' },
      },
    },
    {
      key: 'ayarlanamadi',
      name: 'Süre limiti siteden ayarlanamadı — sorumlu oyun ekibine',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['limit koymak istiyorum', 'süre limiti, düşürmek', 'hayır', 'mehmet_34'],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'limit_setting_failed',
        topic: 'responsible_gambling',
        required_slots: ['limit_turu', 'yon', 'ayarlandi', 'kullanici_adi'],
        values: { limit_turu: 'Süre' },
      },
    },
  ],
};
