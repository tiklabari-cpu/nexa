/**
 * "Hangi yöntemlerle yatırım / çekim yapabilirim?" — research §3 row 14 (tm
 * 311.2 · AI-15).
 *
 * Deposit or withdrawal, then the method, then what the tenant's payment
 * table says about it: the amount range, the usual time and the working hours,
 * "genellikle". A crypto method also gets the network warning — a transfer on
 * the wrong network may not be recoverable. A method the table does not have,
 * or a player-specific limit, is finance's.
 */
import type { Cond } from '@siyahtus/types';
import type { AiTemplate } from '../catalogue.js';
import {
  cryptoMethod,
  depositMethodOptions,
  usernameSlot,
  withdrawalMethodOptions,
  type ScenarioFacts,
} from './shared.js';

const deposit: Cond = { slot: { name: 'yon', op: 'eq', value: 'Yatırım' } };
const withdrawal: Cond = { slot: { name: 'yon', op: 'eq', value: 'Çekim' } };

export const PAYMENT_METHODS_INFO: AiTemplate = {
  key: 'payment_methods_info',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Ödeme yöntemleri bilgisi',
  summary:
    'Oyuncu yatırım ya da çekim yöntemlerini sorduğunda ödeme tablosundan yöntemin alt ve üst tutarını, olağan süresini ve işlem saatlerini anlatır, kripto için ağ uyarısı verir; tabloda olmayan yöntem ya da kişiye özel limit talebini finans ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu hangi ödeme yöntemleriyle yatırım ya da çekim yapabileceğini, bir yöntemin alt-üst limitini, süresini ya da işlem saatlerini soruyor.',
    examples: [
      'hangi yöntemlerle yatırım yapabilirim',
      'papara ile en az ne kadar yatırılır',
      'çekim yöntemleri neler',
      'havale limiti ne kadar',
      'usdt ile yatırım nasıl yapılır',
      'ödeme yöntemleri neler',
      'which payment methods do you accept',
    ],
    priority: 80,
    slots: [
      {
        name: 'yon',
        label: 'Yatırım mı çekim mi',
        type: 'enum',
        ask: 'Yatırım yöntemlerini mi, çekim yöntemlerini mi soruyorsunuz?',
        validate: { enum_values: ['Yatırım', 'Çekim'] },
      },
      {
        name: 'yatirim_yontemi',
        label: 'Yatırım yöntemi',
        type: 'enum',
        ask: 'Hangi yatırım yöntemiyle ilgili bilgi almak istiyorsunuz?',
        validate: { enum_source: 'payment_methods.deposit' },
        required: { when: deposit },
      },
      {
        name: 'cekim_yontemi',
        label: 'Çekim yöntemi',
        type: 'enum',
        ask: 'Hangi çekim yöntemiyle ilgili bilgi almak istiyorsunuz?',
        validate: { enum_source: 'payment_methods.withdrawal' },
        required: { when: withdrawal },
      },
      {
        name: 'baska_soru',
        label: 'Tabloda olmayan yöntem / özel limit',
        type: 'boolean',
        ask: 'Bu yöntemle ilgili özel bir limit talebiniz ya da burada olmayan bir yöntem sorunuz var mı?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'yon_sor', type: 'collect', slots: ['yon'] },
      { id: 'yatirim_sor', type: 'collect', slots: ['yatirim_yontemi'], when: deposit },
      { id: 'cekim_sor', type: 'collect', slots: ['cekim_yontemi'], when: withdrawal },
      { id: 'yatirim_bilgisi', type: 'say', template_key: 'yatirim_bilgi', when: deposit },
      { id: 'cekim_bilgisi', type: 'say', template_key: 'cekim_bilgi', when: withdrawal },
      {
        id: 'kripto_uyari',
        type: 'say',
        template_key: 'kripto',
        when: { any: [cryptoMethod('yatirim_yontemi'), cryptoMethod('cekim_yontemi')] },
      },
      { id: 'ek_soru', type: 'collect', slots: ['baska_soru'] },
      {
        id: 'ozel_talep',
        type: 'check',
        when: { slot: { name: 'baska_soru', op: 'eq', value: true } },
        then: { goto: 'ozel_bilgi' },
      },
      { id: 'bilgi_bitti', type: 'resolve', outcome: 'resolved' },

      { id: 'ozel_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'ozel_kalibi', type: 'say', template_key: 'devir' },
      { id: 'ozel_devir', type: 'handoff', reason_code: 'payment_method_request' },
    ],
    templates: [
      {
        key: 'yatirim_bilgi',
        text: '{yatirim_yontemi} ile yatırım tutarı genellikle {method.min_amount} ile {method.max_amount} arasındadır; yatırımlar genellikle {method.expected_minutes} içinde hesaba yansır ve {method.working_hours} arasında işlenir.',
      },
      {
        key: 'cekim_bilgi',
        text: '{cekim_yontemi} ile çekim tutarı genellikle {method.min_amount} ile {method.max_amount} arasındadır; çekimler genellikle {method.expected_minutes} içinde işlenir ve {method.working_hours} arasında değerlendirilir.',
      },
      {
        key: 'kripto',
        text: 'Kripto gönderimlerinde sitede gösterilen ağı (ör. TRC20) seçtiğinizden ve adresi doğru kopyaladığınızdan emin olun; yanlış ağa yapılan gönderimler geri alınamayabilir.',
      },
      {
        key: 'devir',
        text: 'Bu talebi finans ekibimiz değerlendiriyor. Bilgilerinizi onlara iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'finance' },
      card_fields: ['yon', 'yatirim_yontemi', 'cekim_yontemi'],
    },
    limits: { max_turns: 8 },
  },
  forbidden_phrases: [
    {
      phrase: 'limitinizi artırdım',
      match: 'word',
      why: 'Yapay zekâ kişiye özel limit tanımlamaz (G8).',
    },
    {
      phrase: 'hangi ağ olursa olsun',
      match: 'word',
      why: 'Kripto ağ uyarısı yumuşatılmaz (research §3.2).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'payment_methods.deposit',
      columns: [
        'method.min_amount',
        'method.max_amount',
        'method.expected_minutes',
        'method.working_hours',
      ],
      label:
        'Yatırım yöntemleri tablosu: her yöntemin alt ve üst tutarı, olağan yansıma süresi ve işlem saatleri. Kripto yöntemlerinin adında USDT, kripto ya da ağ adı geçmeli.',
    },
    {
      kind: 'table',
      table: 'payment_methods.withdrawal',
      columns: [
        'method.min_amount',
        'method.max_amount',
        'method.expected_minutes',
        'method.working_hours',
      ],
      label:
        'Çekim yöntemleri tablosu: her yöntemin alt ve üst tutarı, olağan işlem süresi ve işlem saatleri.',
    },
  ],
  scenarios: [
    {
      key: 'papara_yatirim',
      name: 'Papara ile yatırım limitleri ve süresi anlatılır',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['papara ile en az ne kadar yatırılır', 'yatırım', 'papara', 'hayır', 'evet'],
      facts: paparaRow(),
      options: {
        yatirim_yontemi: depositMethodOptions(),
        cekim_yontemi: withdrawalMethodOptions(),
      },
      expect: {
        outcome: 'resolved',
        required_slots: ['yon', 'yatirim_yontemi', 'baska_soru'],
        values: { yon: 'Yatırım', yatirim_yontemi: 'Papara' },
      },
    },
    {
      key: 'usdt_cekim_ag_uyarisi',
      name: 'USDT çekim bilgisi — kripto ağ uyarısıyla',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['çekim yöntemleri neler', 'çekim', 'usdt', 'hayır', 'evet'],
      facts: usdtRow(),
      options: {
        yatirim_yontemi: depositMethodOptions(),
        cekim_yontemi: withdrawalMethodOptions(),
      },
      expect: {
        outcome: 'resolved',
        required_slots: ['yon', 'cekim_yontemi', 'baska_soru'],
        values: { yon: 'Çekim', cekim_yontemi: 'USDT (TRC20)' },
      },
    },
    {
      key: 'ozel_limit_talebi',
      name: 'Kişiye özel limit talebi — finans ekibine devredilir',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['havale limiti ne kadar', 'yatırım', 'havale', 'evet', 'ahmet77'],
      facts: { ...paparaRow(), 'method.name': 'Havale', 'method.max_amount': 100000 },
      options: {
        yatirim_yontemi: depositMethodOptions(),
        cekim_yontemi: withdrawalMethodOptions(),
      },
      expect: {
        outcome: 'handoff',
        reason_code: 'payment_method_request',
        topic: 'finance',
        required_slots: ['yon', 'yatirim_yontemi', 'baska_soru', 'kullanici_adi'],
        values: { yatirim_yontemi: 'Havale' },
      },
    },
  ],
};

function paparaRow(): ScenarioFacts {
  return {
    'method.name': 'Papara',
    'method.min_amount': 100,
    'method.max_amount': 50000,
    'method.expected_minutes': 30,
    'method.working_hours': '7/24',
  };
}

function usdtRow(): ScenarioFacts {
  return {
    'method.name': 'USDT (TRC20)',
    'method.min_amount': 500,
    'method.max_amount': 250000,
    'method.expected_minutes': 60,
    'method.working_hours': '7/24',
  };
}
