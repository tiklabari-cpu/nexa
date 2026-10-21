/**
 * "Çekim talebim beklemede" — research §3 row 2 (tm 311.2 · AI-15).
 *
 * The method and when the request was made, then what the withdrawal screen
 * says. "Onaylandı ama gelmedi" is finance's at once; otherwise the elapsed
 * time against the method's usual processing time (the wait, explained with
 * "genellikle" and the first-withdrawal verification note) and its working
 * hours (the next window). Past both, the amount and the player, and finance.
 * No time is promised (G7) and nothing is said to be checked (G8).
 */
import type { AiTemplate } from '../catalogue.js';
import {
  unverifiedStatusPhrases,
  usernameSlot,
  withdrawalMethodOptions,
  type ScenarioFacts,
} from './shared.js';

export const WITHDRAWAL_PENDING: AiTemplate = {
  key: 'withdrawal_pending',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Çekim beklemede',
  summary:
    'Oyuncu çekim talebinin beklediğini söylediğinde yöntemi, talep zamanını ve ekranda görünen durumu sorar; normal süre içindeyse beklemeyi açıklar, onaylanıp gelmemişse ya da süre aşılmışsa bilgileri toplayıp finans ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu verdiği bir çekim talebinin beklemede olduğunu, işlenmediğini ya da onaylandığı hâlde hesabına gelmediğini söylüyor.',
    examples: [
      'çekim talebim beklemede',
      'çekimim hâlâ gelmedi',
      'para çektim gelmedi',
      'çekim ne zaman gelir',
      'çekimim onaylandı ama gelmedi',
      'çekim talebim işlemde bekliyor',
      'withdrawal is still pending',
      'my withdrawal has not arrived',
    ],
    priority: 50,
    slots: [
      {
        name: 'yontem',
        label: 'Çekim yöntemi',
        type: 'enum',
        ask: 'Çekimi hangi yöntemle talep ettiniz?',
        validate: { enum_source: 'payment_methods.withdrawal' },
      },
      {
        name: 'talep_zamani',
        label: 'Talep zamanı',
        type: 'datetime',
        ask: 'Çekim talebini saat kaçta verdiniz?',
        ask_variants: ['Çekim talebini hangi gün ve yaklaşık saat kaçta verdiniz?'],
      },
      {
        name: 'durum',
        label: 'Ekranda görünen durum',
        type: 'enum',
        ask: 'Çekim ekranında talebiniz için "Beklemede", "İşlemde" ya da "Onaylandı" ifadelerinden hangisi yazıyor?',
        validate: { enum_values: ['Beklemede', 'İşlemde', 'Onaylandı'] },
      },
      {
        name: 'tutar',
        label: 'Tutar',
        type: 'money',
        ask: 'Ne kadarlık bir çekim talep ettiniz?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'yontem_zaman', type: 'collect', slots: ['yontem', 'talep_zamani'] },
      { id: 'durum_sor', type: 'collect', slots: ['durum'] },
      // Approved and still not received: finance, whatever the time.
      {
        id: 'onaylandi',
        type: 'check',
        when: { slot: { name: 'durum', op: 'eq', value: 'Onaylandı' } },
        then: { goto: 'onay_bilgi' },
      },
      {
        id: 'sure_icinde',
        type: 'check',
        when: {
          fn: {
            name: 'elapsed_minutes',
            args: ['talep_zamani'],
            op: 'lt',
            value: { fact: 'method.expected_minutes' },
          },
        },
        then: { goto: 'bekleme' },
      },
      {
        id: 'mesai_disi',
        type: 'check',
        when: { not: { fn: { name: 'within_working_hours', args: ['method', 'talep_zamani'] } } },
        then: { goto: 'mesai' },
      },
      // Past the usual time, within the hours: finance.
      { id: 'bilgi', type: 'collect', slots: ['tutar', 'kullanici_adi'] },
      { id: 'finans_kalibi', type: 'say', template_key: 'devir' },
      { id: 'finansa_devir', type: 'handoff', reason_code: 'expected_time_exceeded' },

      { id: 'onay_bilgi', type: 'collect', slots: ['tutar', 'kullanici_adi'] },
      { id: 'onay_kalibi', type: 'say', template_key: 'onaylandi_gelmedi' },
      { id: 'onay_devir', type: 'handoff', reason_code: 'approved_not_received' },

      { id: 'bekleme', type: 'say', template_key: 'normal_sure' },
      {
        id: 'bekleme_bitti',
        type: 'resolve',
        outcome: 'resolved_waiting',
        followup_template: 'takip',
      },

      { id: 'mesai', type: 'say', template_key: 'mesai_disi' },
      {
        id: 'mesai_bitti',
        type: 'resolve',
        outcome: 'resolved_waiting',
        followup_template: 'takip_mesai',
      },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Çekim talebinizle ilgili birlikte bakalım. Birkaç bilgiye ihtiyacım var.',
      },
      {
        key: 'normal_sure',
        text: '{yontem} ile yapılan çekimler genellikle {method.expected_minutes} içinde işlenir. Talebiniz {elapsed_minutes(talep_zamani)} önce verilmiş, yani hâlâ normal süre içinde. İlk çekiminizse politikamıza göre hesap doğrulaması da istenebilir.',
      },
      {
        key: 'takip',
        text: '{method.expected_minutes} dolduğunda talebiniz hâlâ bekliyorsa bu sohbete yazın; bilgilerinizi finans ekibimize iletelim.',
      },
      {
        key: 'mesai_disi',
        text: '{yontem} çekimleri genellikle {method.working_hours} arasında işlenir. Bu saatlerin dışında verilen talepler bir sonraki işlem penceresinde ({next_window(method)}) değerlendirilir.',
      },
      {
        key: 'takip_mesai',
        text: 'İşlem penceresi açıldıktan sonra talebiniz hâlâ bekliyorsa bu sohbete yazın; bilgilerinizi finans ekibimize iletelim.',
      },
      {
        key: 'onaylandi_gelmedi',
        text: 'Onaylanan bir çekimin hesabınıza ulaşmaması finans ekibimizin incelemesi gereken bir durum. Bilgilerinizi onlara iletiyorum.',
      },
      {
        key: 'devir',
        text: 'Verdiğiniz bilgilere göre talebiniz yöntemin olağan işlem süresini aşmış. Bilgilerinizi finans ekibimize iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'finance' },
      card_fields: ['method.expected_minutes', 'elapsed_minutes(talep_zamani)'],
      next_step_hint: '{yontem} çekim talebinin durumunu ödeme panelinde kontrol edin.',
    },
    limits: { max_turns: 12 },
  },
  forbidden_phrases: [
    ...unverifiedStatusPhrases(),
    {
      phrase: 'çekiminiz gönderildi',
      match: 'word',
      why: 'Yapay zekâ çekimin durumunu göremez (G8).',
    },
    {
      phrase: 'bugün içinde gelir',
      match: 'word',
      why: 'Ödeme zamanı için söz verilmez (G7).',
    },
    {
      phrase: 'hemen onaylatırım',
      match: 'word',
      why: 'Yapay zekâ onay sözü veremez (G7).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'payment_methods.withdrawal',
      columns: ['method.expected_minutes', 'method.working_hours'],
      label:
        'Çekim yöntemleri tablosu: her yöntemin olağan işlem süresi ve işlem saatleri. Süre "genellikle" ile söylenir; tablo boşsa yapay zekâ süre söylemez.',
    },
  ],
  scenarios: [
    {
      key: 'normal_sure_bekleme',
      name: 'Papara çekimi 20 dakika önce — normal süre içinde, bekleme açıklanır',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['çekim talebim beklemede', 'Papara, 13:30', 'beklemede yazıyor', 'evet'],
      facts: paparaRow(),
      options: { yontem: withdrawalMethodOptions() },
      expect: {
        outcome: 'resolved_waiting',
        required_slots: ['yontem', 'talep_zamani', 'durum'],
        values: { yontem: 'Papara', durum: 'Beklemede' },
      },
    },
    {
      key: 'sure_asildi_finans',
      name: 'Olağan süre aşıldı — tutar ve kullanıcı adı alınır, finansa devredilir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T16:00:00+03:00',
      turns: ['çekimim hâlâ gelmedi', 'Papara, 10:00', 'işlemde', '5.000 TL', 'ahmet77'],
      facts: paparaRow(),
      options: { yontem: withdrawalMethodOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'expected_time_exceeded',
        topic: 'finance',
        required_slots: ['yontem', 'talep_zamani', 'durum', 'tutar', 'kullanici_adi'],
        values: { tutar: '5.000 TRY', kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'onaylandi_gelmedi',
      name: 'Onaylandı ama hesaba ulaşmadı — süreye bakılmadan finansa devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'çekimim onaylandı ama gelmedi',
        'havale, 13:00',
        'onaylandı',
        '2.500 TL',
        'mehmet_34',
      ],
      facts: havaleRow(),
      options: { yontem: withdrawalMethodOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'approved_not_received',
        topic: 'finance',
        required_slots: ['yontem', 'durum', 'tutar', 'kullanici_adi'],
        values: { yontem: 'Havale', durum: 'Onaylandı', kullanici_adi: 'mehmet_34' },
      },
    },
    {
      key: 'mesai_disi_havale',
      name: 'Havale çekimi mesai dışında verildi — bir sonraki işlem penceresi söylenir',
      persona: 'normal',
      simulated_now: '2026-10-18T22:30:00+03:00',
      turns: ['para çektim gelmedi', 'havale ile, 21:00', 'beklemede', 'evet'],
      facts: havaleRow(),
      options: { yontem: withdrawalMethodOptions() },
      within_working_hours: false,
      next_window: '2026-10-19T09:00:00+03:00',
      expect: {
        outcome: 'resolved_waiting',
        required_slots: ['yontem', 'talep_zamani', 'durum'],
        values: { yontem: 'Havale' },
      },
    },
  ],
};

function paparaRow(): ScenarioFacts {
  return {
    'method.name': 'Papara',
    'method.expected_minutes': 60,
    'method.working_hours': '7/24',
  };
}

function havaleRow(): ScenarioFacts {
  return {
    'method.name': 'Havale',
    'method.expected_minutes': 60,
    'method.working_hours': '09:00–17:30',
  };
}
