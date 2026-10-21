/**
 * "Bonus nasıl alınır / bonusum tanımlanmadı" — research §3 row 5 (tm 311.2 ·
 * AI-15).
 *
 * Which bonus, then its claim method from the tenant's bonus table: one that
 * only an agent credits (`live_support`) goes to the bonus team with the
 * player's details. Otherwise the deposit amount against the bonus' minimum
 * and whether it was claimed before depositing — either missing explains the
 * condition and is solved; both met and still not credited is the bonus
 * team's (a manual credit). The AI never credits, nor says it has (G8), and
 * offers no bonus to a player at risk (G4 — the engine's output check).
 */
import type { AiTemplate } from '../catalogue.js';
import { bonusOptions, usernameSlot, type ScenarioFacts } from './shared.js';

export const BONUS_CLAIM: AiTemplate = {
  key: 'bonus_claim',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Bonus alma ve tanımlanmayan bonus',
  summary:
    'Oyuncu bir bonusu nasıl alacağını ya da bonusunun tanımlanmadığını sorduğunda bonus tablosundaki koşulları açıklar; koşullar sağlanmış ama bonus tanımlanmamışsa ya da bonus yalnız temsilciyle tanımlanıyorsa bonus ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu bir bonusu nasıl alacağını soruyor ya da hak ettiği bonusun hesabına tanımlanmadığını söylüyor.',
    examples: [
      'bonusum tanımlanmadı',
      'bonus nasıl alınır',
      'hoş geldin bonusu yüklenmedi',
      'yatırım yaptım bonus gelmedi',
      'bonusumu alamadım',
      'bonus talep etmek istiyorum',
      'my bonus was not credited',
    ],
    priority: 60,
    slots: [
      {
        name: 'bonus',
        label: 'Bonus',
        type: 'enum',
        ask: 'Hangi bonusu almak istiyorsunuz?',
        validate: { enum_source: 'bonuses' },
      },
      {
        name: 'yatirim_tutari',
        label: 'Yatırım tutarı',
        type: 'money',
        ask: 'Bonus için ne kadarlık bir yatırım yaptınız?',
      },
      {
        name: 'talep_once',
        label: 'Yatırımdan önce talep edildi',
        type: 'boolean',
        ask: 'Bonusu yatırımı yapmadan önce talep etmiş miydiniz?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'bonus_sor', type: 'collect', slots: ['bonus'] },
      // A bonus only an agent credits: the bonus team, with who the player is.
      {
        id: 'yalniz_temsilci',
        type: 'check',
        when: { fact: { path: 'bonus.claim_method', op: 'eq', value: 'live_support' } },
        then: { goto: 'temsilci_bilgi' },
      },
      { id: 'kosul', type: 'say', template_key: 'kosullar' },
      { id: 'tutar_sor', type: 'collect', slots: ['yatirim_tutari'] },
      {
        id: 'alt_limit',
        type: 'check',
        when: {
          slot: { name: 'yatirim_tutari', op: 'lt', value: { fact: 'bonus.min_deposit' } },
        },
        then: { goto: 'alt_limit_bilgi' },
      },
      { id: 'talep_sor', type: 'collect', slots: ['talep_once'] },
      {
        id: 'talep_yok',
        type: 'check',
        when: { slot: { name: 'talep_once', op: 'eq', value: false } },
        then: { goto: 'talep_bilgi' },
      },
      // The conditions are met and the bonus is not there: a manual credit.
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'bonus_kalibi', type: 'say', template_key: 'devir' },
      { id: 'bonus_devir', type: 'handoff', reason_code: 'bonus_not_credited' },

      { id: 'temsilci_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'temsilci_kalibi', type: 'say', template_key: 'temsilci' },
      { id: 'temsilci_devir', type: 'handoff', reason_code: 'manual_bonus_claim' },

      { id: 'alt_limit_bilgi', type: 'say', template_key: 'alt_limit' },
      { id: 'alt_limit_bitti', type: 'resolve', outcome: 'resolved' },

      { id: 'talep_bilgi', type: 'say', template_key: 'talep_yok' },
      { id: 'talep_bitti', type: 'resolve', outcome: 'resolved' },
    ],
    templates: [
      {
        key: 'kosullar',
        text: '{bonus} için en düşük yatırım tutarı genellikle {bonus.min_deposit}. Bonus, yatırımdan önce bonus sayfasından talep edilmelidir.',
      },
      {
        key: 'alt_limit',
        text: 'Politikamıza göre {bonus} için yatırımın en az {bonus.min_deposit} olması gerekiyor; bu tutarın altındaki yatırımlar bu bonusa uygun sayılmıyor.',
      },
      {
        key: 'talep_yok',
        text: 'Politikamıza göre {bonus} yatırımdan önce talep edildiğinde tanımlanıyor. Bir sonraki uygun işleminizde bonusu yatırımdan önce bonus sayfasından talep edebilirsiniz.',
      },
      {
        key: 'temsilci',
        text: '{bonus} bonus ekibimiz tarafından tanımlanıyor. Bilgilerinizi onlara iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
      {
        key: 'devir',
        text: 'Verdiğiniz bilgilere göre koşullar sağlanmış görünüyor. Bilgilerinizi bonus ekibimize iletiyorum; tanımlama ve kontrol onlar tarafından yapılır.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'bonus' },
      card_fields: ['bonus', 'bonus.min_deposit', 'yatirim_tutari', 'talep_once'],
      next_step_hint: '{bonus} koşullarını oyuncunun yatırım geçmişiyle karşılaştırın.',
    },
    limits: { max_turns: 10 },
  },
  forbidden_phrases: [
    {
      phrase: 'bonusunuzu tanımladım',
      match: 'word',
      why: 'Yapay zekâ bonus tanımlamaz (G8).',
    },
    {
      phrase: 'bonusunuz tanımlanacak',
      match: 'word',
      why: 'Bonus tanımı için söz verilmez (G7).',
    },
    {
      phrase: 'tekrar yatırım yap',
      match: 'exact',
      why: 'Bonus için yeniden yatırım teşvik edilmez (G10).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'bonuses',
      columns: ['bonus.min_deposit', 'bonus.claim_method'],
      label:
        'Bonuslar tablosu: her bonusun en düşük yatırım tutarı ve talep yöntemi (otomatik, canlı destek ya da kod). Yalnız temsilcinin tanımladığı bonuslar için talep yöntemi "canlı destek" olmalı.',
    },
  ],
  scenarios: [
    {
      key: 'kosullar_saglanmis',
      name: 'Koşullar sağlanmış, bonus yok — bonus ekibine devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['bonusum tanımlanmadı', 'hoş geldin bonusu', '1.000 TL', 'evet', 'ahmet77'],
      facts: welcomeRow(),
      options: { bonus: bonusOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'bonus_not_credited',
        topic: 'bonus',
        required_slots: ['bonus', 'yatirim_tutari', 'talep_once', 'kullanici_adi'],
        values: { bonus: 'Hoş geldin bonusu', yatirim_tutari: '1.000 TRY' },
      },
    },
    {
      key: 'alt_limitin_altinda',
      name: 'Yatırım bonus alt limitinin altında — koşul açıklanır',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['yatırım yaptım bonus gelmedi', 'hoş geldin', '50 TL', 'evet'],
      facts: welcomeRow(),
      options: { bonus: bonusOptions() },
      expect: {
        outcome: 'resolved',
        required_slots: ['bonus', 'yatirim_tutari'],
        values: { yatirim_tutari: '50 TRY' },
      },
    },
    {
      key: 'talep_edilmemis',
      name: 'Bonus yatırımdan önce talep edilmemiş — doğru adım anlatılır',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['bonusumu alamadım', 'hoş geldin bonusu', '500 TL', 'hayır', 'evet'],
      facts: welcomeRow(),
      options: { bonus: bonusOptions() },
      expect: {
        outcome: 'resolved',
        required_slots: ['bonus', 'yatirim_tutari', 'talep_once'],
      },
    },
    {
      key: 'yalniz_temsilci',
      name: 'Kayıp bonusu yalnız temsilciyle tanımlanıyor — bonus ekibine devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['bonus talep etmek istiyorum', 'kayıp bonusu', 'mehmet_34'],
      facts: {
        ...welcomeRow(),
        'bonus.name': 'Kayıp bonusu',
        'bonus.claim_method': 'live_support',
      },
      options: { bonus: bonusOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'manual_bonus_claim',
        topic: 'bonus',
        required_slots: ['bonus', 'kullanici_adi'],
        values: { bonus: 'Kayıp bonusu', kullanici_adi: 'mehmet_34' },
      },
    },
  ],
};

function welcomeRow(): ScenarioFacts {
  return {
    'bonus.name': 'Hoş geldin bonusu',
    'bonus.min_deposit': 100,
    'bonus.claim_method': 'auto',
  };
}
