/**
 * "Çevrim şartı / bonus kuralları" — research §3 row 6 (tm 311.2 · AI-15).
 *
 * Which bonus, then its wagering multiplier, maximum stake and minimum odds
 * from the tenant's bonus table with a general worked example. The AI cannot
 * see the player's remaining wagering and says so; a dispute — a removed
 * bonus, winnings voided for the maximum stake rule, the remaining amount —
 * is the bonus team's.
 */
import type { AiTemplate } from '../catalogue.js';
import { bonusOptions, usernameSlot, type ScenarioFacts } from './shared.js';

export const WAGERING_RULES: AiTemplate = {
  key: 'wagering_rules',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Çevrim şartı ve bonus kuralları',
  summary:
    'Oyuncu bir bonusun çevrim şartını ya da kurallarını sorduğunda bonus tablosundaki çevrim katını, en yüksek bahis ve en düşük oran kuralını genel bir örnekle açıklar; silinen bonus ya da iptal edilen kazanç itirazını bonus ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu bir bonusun çevrim şartını, kaç kat çevrileceğini, en yüksek bahis kuralını soruyor ya da bonusunun silinmesine veya kazancının iptaline itiraz ediyor.',
    examples: [
      'çevrim şartı nedir',
      'bonusun çevrimi kaç kat',
      'çevrim nasıl hesaplanıyor',
      'bonusum silindi',
      'kazancım iptal edildi çevrim yüzünden',
      'en yüksek bahis kuralı ne',
      'what are the wagering requirements',
    ],
    priority: 60,
    slots: [
      {
        name: 'bonus',
        label: 'Bonus',
        type: 'enum',
        ask: 'Hangi bonusun kurallarını öğrenmek istiyorsunuz?',
        validate: { enum_source: 'bonuses' },
      },
      {
        name: 'itiraz',
        label: 'İtiraz var',
        type: 'boolean',
        ask: 'Bonusun silinmesi ya da bir kazancın iptali gibi itiraz etmek istediğiniz bir durum var mı?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'bonus_sor', type: 'collect', slots: ['bonus'] },
      {
        id: 'kurallar',
        type: 'say',
        template_key: 'kurallar',
        instruction:
          'Bonusun çevrim şartının bonus tablosunda yazdığını, kalan çevrim tutarını göremediğinizi kısaca söyleyin.',
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
      { id: 'itiraz_devir', type: 'handoff', reason_code: 'wagering_dispute' },
    ],
    templates: [
      {
        key: 'kurallar',
        text: '{bonus} için çevrim şartı genellikle bonus tutarının {bonus.wagering_multiplier} katıdır; çevrim sırasında tek bahiste en fazla {bonus.max_bet} yatırılabilir ve en düşük oran {bonus.min_odds} olmalıdır. Örneğin 10 kat çevrim şartı olan 100 TL bonusta toplam 1.000 TL tutarında bahis gerekir. Kalan çevrim tutarınızı buradan göremiyorum; hesabınızdaki bonus sayfasından izleyebilirsiniz.',
      },
      {
        key: 'devir',
        text: 'İtirazınızı bonus ekibimize iletiyorum; bonus hareketlerinizi onlar inceleyip bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'bonus' },
      card_fields: ['bonus', 'bonus.wagering_multiplier', 'bonus.max_bet'],
      next_step_hint: '{bonus} çevrim hareketlerini ve en yüksek bahis kuralını inceleyin.',
    },
    limits: { max_turns: 8 },
  },
  forbidden_phrases: [
    {
      phrase: 'kalan çevriminiz',
      match: 'word',
      why: 'Yapay zekâ oyuncunun kalan çevrimini göremez (research §3 · 6).',
    },
    {
      phrase: 'çevriminiz tamamlandı',
      match: 'word',
      why: 'Doğrulanmış bilgi varmış gibi konuşulmaz (G8).',
    },
    {
      phrase: 'bonusunuzu geri yüklerim',
      match: 'word',
      why: 'Yapay zekâ bonus işlemi yapmaz ve söz vermez (G7).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'bonuses',
      columns: ['bonus.wagering_multiplier', 'bonus.max_bet', 'bonus.min_odds'],
      label:
        'Bonuslar tablosu: her bonusun çevrim katı, çevrimdeki en yüksek bahis ve en düşük oran. Bir değer boşsa yapay zekâ o kuralı söylemez, yalnız genel açıklama yapar.',
    },
  ],
  scenarios: [
    {
      key: 'kurallar_aciklanir',
      name: 'Hoş geldin bonusunun çevrim kuralları — genel örnekle açıklanır',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['çevrim şartı nedir', 'hoş geldin bonusu', 'hayır', 'evet'],
      facts: welcomeRow(),
      options: { bonus: bonusOptions() },
      expect: {
        outcome: 'resolved',
        required_slots: ['bonus', 'itiraz'],
        values: { bonus: 'Hoş geldin bonusu' },
      },
    },
    {
      key: 'bonus_silindi_itiraz',
      name: 'Bonus silindi — itiraz bonus ekibine devredilir',
      persona: 'kizgin',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['bonusum silindi', 'kayıp bonusu', 'evet', 'ahmet77'],
      facts: { ...welcomeRow(), 'bonus.name': 'Kayıp bonusu', 'bonus.wagering_multiplier': 5 },
      options: { bonus: bonusOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'wagering_dispute',
        topic: 'bonus',
        required_slots: ['bonus', 'itiraz', 'kullanici_adi'],
        values: { bonus: 'Kayıp bonusu', kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'en_yuksek_bahis',
      name: 'En yüksek bahis kuralı sorusu — açıklanır, itiraz yok',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['en yüksek bahis kuralı ne', 'free spin', 'hayır', 'evet'],
      facts: {
        ...welcomeRow(),
        'bonus.name': 'Haftalık free spin',
        'bonus.wagering_multiplier': 20,
        'bonus.max_bet': 25,
      },
      options: { bonus: bonusOptions() },
      expect: {
        outcome: 'resolved',
        required_slots: ['bonus', 'itiraz'],
        values: { bonus: 'Haftalık free spin' },
      },
    },
  ],
};

function welcomeRow(): ScenarioFacts {
  return {
    'bonus.name': 'Hoş geldin bonusu',
    'bonus.wagering_multiplier': 10,
    'bonus.max_bet': 50,
    'bonus.min_odds': 1.5,
  };
}
