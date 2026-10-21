/**
 * "Kampanya / turnuva / promosyon bilgisi" — research §3 row 16 (tm 311.2 ·
 * AI-15).
 *
 * Which campaign, then its terms from the tenant's bonus table — the minimum
 * deposit and how long it runs — "genellikle". A reward that was not credited
 * or a disputed entry is the bonus team's. A player at risk is offered no
 * promotion: the engine's output check holds every reply of this template to
 * G4 once the conversation carries a risk flag, and hands over instead.
 */
import type { AiTemplate } from '../catalogue.js';
import { bonusOptions, usernameSlot, type ScenarioFacts } from './shared.js';

export const PROMOTION_INFO: AiTemplate = {
  key: 'promotion_info',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Promosyon ve kampanya bilgisi',
  summary:
    'Oyuncu bir kampanya, turnuva ya da promosyonu sorduğunda bonus tablosundaki katılım koşullarını ve süresini anlatır; tanımlanmayan ödül ya da katılım itirazını bonus ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu süren bir kampanya, turnuva, çekiliş ya da promosyonun koşullarını, süresini soruyor ya da ödülünün tanımlanmadığını söylüyor.',
    examples: [
      'kampanyalar neler',
      'bu haftaki promosyon nedir',
      'turnuva ödülüm gelmedi',
      'kampanyaya nasıl katılırım',
      'promosyon koşulları ne',
      'what promotions do you have',
    ],
    priority: 80,
    slots: [
      {
        name: 'kampanya',
        label: 'Kampanya',
        type: 'enum',
        ask: 'Hangi kampanya ya da promosyonla ilgili bilgi almak istiyorsunuz?',
        validate: { enum_source: 'bonuses' },
      },
      {
        name: 'itiraz',
        label: 'Ödül / katılım itirazı',
        type: 'boolean',
        ask: 'Bu kampanyada tanımlanmayan bir ödülünüz ya da katılımınızla ilgili bir itirazınız var mı?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'kampanya_sor', type: 'collect', slots: ['kampanya'] },
      {
        id: 'kosul',
        type: 'say',
        template_key: 'kosullar',
        instruction:
          'Kampanyanın koşullarının promosyon sayfasında yazdığını ve kesin koşulların orada olduğunu kısaca söyleyin.',
      },
      { id: 'itiraz_sor', type: 'collect', slots: ['itiraz'] },
      {
        id: 'itiraz_var',
        type: 'check',
        when: { slot: { name: 'itiraz', op: 'eq', value: true } },
        then: { goto: 'itiraz_bilgi' },
      },
      { id: 'bilgi_bitti', type: 'resolve', outcome: 'resolved' },

      { id: 'itiraz_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'itiraz_kalibi', type: 'say', template_key: 'devir' },
      { id: 'itiraz_devir', type: 'handoff', reason_code: 'promotion_dispute' },
    ],
    templates: [
      {
        key: 'kosullar',
        text: '{kampanya} için katılım koşulu genellikle en az {bonus.min_deposit} tutarında bir yatırımdır ve kampanya {bonus.validity_days} gün geçerlidir. Kesin koşullar promosyon sayfasındaki kurallarda yazar.',
      },
      {
        key: 'devir',
        text: 'Bilgilerinizi bonus ekibimize iletiyorum; ödül ve katılım kayıtlarınızı onlar inceleyip bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'bonus' },
      card_fields: ['kampanya', 'bonus.min_deposit', 'bonus.validity_days'],
      next_step_hint: '{kampanya} katılım kaydını ve ödül tanımını kontrol edin.',
    },
    limits: { max_turns: 6 },
  },
  forbidden_phrases: [
    {
      phrase: 'ödülünüz tanımlandı',
      match: 'word',
      why: 'Yapay zekâ ödül tanımlamaz, doğrulanmış bilgi varmış gibi konuşmaz (G8).',
    },
    {
      phrase: 'kaçırmayın',
      match: 'word',
      why: 'Oyuncuyu yatırıma ya da katılıma zorlayan pazarlama dili kullanılmaz (G4, G10).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'bonuses',
      columns: ['bonus.min_deposit', 'bonus.validity_days'],
      label:
        'Bonuslar tablosu: kampanya ve promosyonların en düşük yatırım tutarı ve geçerlilik süresi; kesin kurallar bonus satırının şartlar metninde.',
    },
  ],
  scenarios: [
    {
      key: 'kosullar_anlatilir',
      name: 'Kampanya koşulları anlatılır — itiraz yok',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['kampanyaya nasıl katılırım', 'kayıp bonusu', 'hayır', 'evet'],
      facts: cashbackRow(),
      options: { kampanya: bonusOptions() },
      expect: {
        outcome: 'resolved',
        required_slots: ['kampanya', 'itiraz'],
        values: { kampanya: 'Kayıp bonusu' },
      },
    },
    {
      key: 'odul_gelmedi',
      name: 'Turnuva ödülü gelmedi — bonus ekibine devredilir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['turnuva ödülüm gelmedi', 'haftalık free spin', 'evet', 'ahmet77'],
      facts: { ...cashbackRow(), 'bonus.name': 'Haftalık free spin', 'bonus.validity_days': 7 },
      options: { kampanya: bonusOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'promotion_dispute',
        topic: 'bonus',
        required_slots: ['kampanya', 'itiraz', 'kullanici_adi'],
        values: { kampanya: 'Haftalık free spin', kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'hos_geldin_bilgisi',
      name: 'Hoş geldin kampanyası sorusu — koşullar anlatılır',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['promosyon koşulları ne', 'hoş geldin', 'hayır', 'evet'],
      facts: { ...cashbackRow(), 'bonus.name': 'Hoş geldin bonusu', 'bonus.min_deposit': 100 },
      options: { kampanya: bonusOptions() },
      expect: {
        outcome: 'resolved',
        required_slots: ['kampanya', 'itiraz'],
        values: { kampanya: 'Hoş geldin bonusu' },
      },
    },
  ],
};

function cashbackRow(): ScenarioFacts {
  return {
    'bonus.name': 'Kayıp bonusu',
    'bonus.min_deposit': 250,
    'bonus.validity_days': 30,
  };
}
