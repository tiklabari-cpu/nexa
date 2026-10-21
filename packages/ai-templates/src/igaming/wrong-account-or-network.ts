/**
 * "Yanlış hesaba / yanlış ağa gönderdim" — research §3 row 15 (tm 311.2 ·
 * AI-15).
 *
 * The AI says honestly that such a transfer may not be recoverable, promises
 * no recovery (G7), collects what finance needs to look into it — method and
 * time, the last four digits of the IBAN it went to (never the whole IBAN) or,
 * for crypto, the network and the TXID, the amount and the player — and always
 * hands over to finance.
 */
import type { AiTemplate } from '../catalogue.js';
import {
  cryptoMethod,
  depositMethodOptions,
  unverifiedStatusPhrases,
  usernameSlot,
} from './shared.js';

const crypto = cryptoMethod('yontem');

export const WRONG_ACCOUNT_OR_NETWORK: AiTemplate = {
  key: 'wrong_account_or_network',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Yanlış hesaba ya da ağa gönderim',
  summary:
    'Oyuncu yatırımı yanlış IBAN’a, eski hesap bilgisine ya da yanlış kripto ağına gönderdiğini söylediğinde geri alınamayabileceğini dürüstçe söyler, inceleme için gerekli bilgileri toplar ve her zaman finans ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu yatırımını yanlış hesaba, eski ya da farklı bir IBAN’a veya yanlış kripto ağına gönderdiğini söylüyor.',
    examples: [
      'yanlış hesaba gönderdim',
      'yanlış ağa gönderdim',
      'eski hesap bilgisine para attım',
      'usdt yi yanlış ağdan gönderdim',
      'yanlış ibana havale yaptım',
      'I sent it to the wrong network',
    ],
    priority: 45,
    slots: [
      {
        name: 'yontem',
        label: 'Ödeme yöntemi',
        type: 'enum',
        ask: 'Gönderimi hangi yöntemle yaptınız?',
        validate: { enum_source: 'payment_methods.deposit' },
      },
      {
        name: 'islem_zamani',
        label: 'İşlem zamanı',
        type: 'datetime',
        ask: 'Gönderimi hangi gün ve saat kaçta yaptınız?',
      },
      {
        name: 'iban_son4',
        label: 'Gönderilen hesap (son 4 hane)',
        type: 'iban_last4',
        ask: "Gönderim yaptığınız IBAN'ın yalnızca son 4 hanesini yazar mısınız?",
        required: { when: { not: crypto } },
      },
      {
        name: 'kripto_agi',
        label: 'Kullanılan kripto ağı',
        type: 'crypto_network',
        ask: 'Gönderimi hangi ağ üzerinden yaptınız (ör. TRC20, ERC20, BEP20)?',
        required: { when: crypto },
      },
      {
        name: 'txid',
        label: 'TXID',
        type: 'txid',
        ask: 'İşlemin TXID (işlem kimliği) bilgisini paylaşır mısınız?',
        validate: { network_aware: true },
        required: { when: crypto },
      },
      {
        name: 'tutar',
        label: 'Tutar',
        type: 'money',
        ask: 'Ne kadar gönderdiniz?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'yontem_zaman', type: 'collect', slots: ['yontem', 'islem_zamani'] },
      { id: 'hesap_ag', type: 'collect', slots: ['iban_son4', 'kripto_agi'] },
      { id: 'kanit', type: 'collect', slots: ['txid'] },
      { id: 'tutar_sor', type: 'collect', slots: ['tutar'] },
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'finans_kalibi', type: 'say', template_key: 'devir' },
      { id: 'finansa_devir', type: 'handoff', reason_code: 'wrong_account_or_network' },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Durumu anlıyorum. Açık olmak gerekirse farklı bir hesaba ya da ağa yapılan gönderimlerin geri alınması her zaman mümkün olmayabilir; yine de inceleme için finans ekibimize iletebilmem için birkaç bilgiye ihtiyacım var.',
      },
      {
        key: 'devir',
        text: 'Bilgilerinizi inceleme için finans ekibimize iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'finance' },
      card_fields: ['yontem', 'iban_son4', 'kripto_agi', 'txid', 'tutar'],
      next_step_hint:
        'Gönderimin ulaştığı hesap ya da ağ için ödeme sağlayıcısıyla eşleştirme ve geri alma olasılığını inceleyin.',
    },
    limits: { max_turns: 10 },
  },
  forbidden_phrases: [
    ...unverifiedStatusPhrases(),
    {
      phrase: 'kesin geri al',
      match: 'exact',
      why: 'Yanlış hesaba ya da ağa gönderimde kurtarma sözü verilmez (G7).',
    },
    {
      phrase: 'paranız kaybolmaz',
      match: 'word',
      why: 'Kurtarma sözü verilmez (G7).',
    },
    {
      phrase: 'tekrar gönder',
      match: 'exact',
      why: 'Yeniden gönderim teşvik edilmez (G10).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'payment_methods.deposit',
      columns: [],
      label:
        'Yatırım yöntemleri tablosu: oyuncunun yöntemini tanımak için yöntem adları. Kripto yöntemlerinin adında USDT, kripto ya da ağ adı geçmeli; ağ ve TXID yalnız onlarda sorulur.',
    },
  ],
  scenarios: [
    {
      key: 'yanlis_iban',
      name: 'Eski IBAN’a havale — son 4 hane alınır, finansa devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['yanlış ibana havale yaptım', 'havale, bugün 11:00', '4821', '2.500 TL', 'ahmet77'],
      facts: {},
      options: { yontem: depositMethodOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'wrong_account_or_network',
        topic: 'finance',
        required_slots: ['yontem', 'islem_zamani', 'iban_son4', 'tutar', 'kullanici_adi'],
        values: { yontem: 'Havale', tutar: '2.500 TRY', kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'yanlis_ag',
      name: 'USDT yanlış ağdan gönderildi — ağ ve TXID alınır, finansa devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'yanlış ağa gönderdim',
        'usdt, bugün 12:15',
        'ERC20',
        '0x5f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
        '15.000 TL',
        'mehmet_34',
      ],
      facts: {},
      options: { yontem: depositMethodOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'wrong_account_or_network',
        topic: 'finance',
        required_slots: ['yontem', 'kripto_agi', 'txid', 'tutar', 'kullanici_adi'],
        values: { yontem: 'USDT (TRC20)', kripto_agi: 'ERC20' },
      },
    },
    {
      key: 'eski_hesap_papara',
      name: 'Papara ile eski hesap bilgisine gönderim — bilgiler toplanır, finansa',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['eski hesap bilgisine para attım', 'papara, dün 21:30', '0042', '750 TL', 'ali_k'],
      facts: {},
      options: { yontem: depositMethodOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'wrong_account_or_network',
        topic: 'finance',
        required_slots: ['yontem', 'islem_zamani', 'iban_son4', 'tutar', 'kullanici_adi'],
        values: { yontem: 'Papara', kullanici_adi: 'ali_k' },
      },
    },
  ],
};
