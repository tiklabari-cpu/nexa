/**
 * What the `igaming_core` pack installs beside its twenty templates (tm 311.2
 * · AI-15 · AI-07 §7 · AI-13): the default behaviour rules, the persona style
 * and the "örnek — doğrulayın" table rows. Types only from outside the package.
 */
import type {
  AiTemplateGuidanceRule,
  AiTemplatePersonaStyle,
  AiTemplateSampleRows,
} from '../catalogue.js';

/**
 * AI-07 §7, the iGaming defaults: at most two questions in one message; no
 * solution to a payment problem before the method, the amount and the time
 * are known; never a repeat deposit; never contradict the agent; "siz". The
 * first and the last are also persona settings ({@link IGAMING_PERSONA_STYLE});
 * the rule keeps them in the prompt where the setting is not applied.
 */
export const IGAMING_DEFAULT_RULES: AiTemplateGuidanceRule[] = [
  {
    key: 'iki_soru_siniri',
    title: 'Tek mesajda en fazla iki soru',
    body: 'Tek mesajda oyuncuya en fazla iki soru sor; gerisini sonraki mesaja bırak.',
    category: 'communication',
    priority: 10,
  },
  {
    key: 'odeme_once_bilgi',
    title: 'Ödeme sorununda önce yöntem, tutar ve saat',
    body: 'Ödeme sorunlarında yöntemi, tutarı ve saati öğrenmeden çözüm önerme.',
    category: 'clarification',
    priority: 10,
    template_keys: [
      'deposit_not_credited',
      'withdrawal_pending',
      'withdrawal_rejected',
      'wrong_account_or_network',
    ],
  },
  {
    key: 'mukerrer_yatirim_yok',
    title: 'Mükerrer yatırım önerilmez',
    body: 'Oyuncuya yeniden ya da mükerrer yatırım yapmasını hiçbir durumda önerme.',
    category: 'prohibition',
    priority: 10,
  },
  {
    key: 'temsilciyle_celisme',
    title: 'Temsilciyle çelişme',
    body: 'Bir temsilcinin bu sohbette söylediğiyle çelişen bilgi verme; emin olmadığın konuyu temsilciye bırak.',
    category: 'communication',
    priority: 20,
  },
  {
    key: 'siz_hitabi',
    title: '"Siz" diye hitap',
    body: 'Oyuncuya her zaman "siz" diye hitap et.',
    category: 'communication',
    priority: 20,
  },
];

/** "siz", no emoji, two questions at most (AI-07). */
export const IGAMING_PERSONA_STYLE: AiTemplatePersonaStyle = {
  address_form: 'siz',
  emoji: 'none',
  max_questions_per_message: 2,
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

/** Bank transfer hours: weekdays 09:00–17:30, closed on bank holidays (research §3.2). */
function bankHours(): NonNullable<
  AiTemplateSampleRows['payment_methods'][number]['working_hours']
> {
  return {
    timezone: 'Europe/Istanbul',
    windows: WEEKDAYS.map((day) => ({ day, start: '09:00', end: '17:30' })),
    closed_on_bank_holidays: true,
  };
}

/**
 * The rows the templates read (research §3.2's payment context): Papara,
 * bank transfer and USDT on TRC20 each way, three bonuses, three KYC
 * documents and two limit rules. Every number is an example the tenant must
 * replace with its own.
 */
export const IGAMING_SAMPLE_ROWS: AiTemplateSampleRows = {
  payment_methods: [
    {
      name: 'Papara',
      aliases: ['PPR'],
      direction: 'deposit',
      currency: 'TRY',
      min_amount: 100,
      max_amount: 50000,
      expected_minutes: 30,
      delay_threshold_minutes: 60,
      working_hours: null,
      requires_site_request: true,
      reference_instructions:
        'Yatırım talebinde gösterilen açıklama kodunu gönderimin açıklamasına yazın.',
      reference_format: 'alphanumeric',
      receipt_required: false,
      third_party_allowed: false,
      networks: [],
      common_errors: [],
      customer_notes: null,
      active: true,
    },
    {
      name: 'Havale/EFT',
      aliases: ['Havale', 'EFT', 'FAST', 'Banka havalesi'],
      direction: 'deposit',
      currency: 'TRY',
      min_amount: 100,
      max_amount: 100000,
      expected_minutes: 20,
      delay_threshold_minutes: 60,
      working_hours: bankHours(),
      requires_site_request: true,
      reference_instructions: 'Gönderimin açıklamasına sitedeki kullanıcı adınızı yazın.',
      reference_format: 'username',
      receipt_required: true,
      third_party_allowed: false,
      networks: [],
      common_errors: [],
      customer_notes: null,
      active: true,
    },
    {
      name: 'USDT (TRC20)',
      aliases: ['USDT', 'Tether'],
      direction: 'deposit',
      currency: 'USD',
      min_amount: 10,
      max_amount: 10000,
      expected_minutes: 15,
      delay_threshold_minutes: 45,
      working_hours: null,
      requires_site_request: true,
      reference_instructions: null,
      reference_format: 'txid_trc20',
      receipt_required: false,
      third_party_allowed: false,
      networks: ['TRC20'],
      common_errors: [],
      customer_notes: null,
      active: true,
    },
    {
      name: 'Papara',
      aliases: ['PPR'],
      direction: 'withdrawal',
      currency: 'TRY',
      min_amount: 200,
      max_amount: 50000,
      expected_minutes: 60,
      delay_threshold_minutes: 120,
      working_hours: null,
      requires_site_request: true,
      reference_instructions: null,
      reference_format: 'none',
      receipt_required: false,
      third_party_allowed: false,
      networks: [],
      common_errors: [],
      customer_notes: null,
      active: true,
    },
    {
      name: 'Havale/EFT',
      aliases: ['Havale', 'EFT', 'FAST', 'Banka'],
      direction: 'withdrawal',
      currency: 'TRY',
      min_amount: 500,
      max_amount: 250000,
      expected_minutes: 120,
      delay_threshold_minutes: 240,
      working_hours: bankHours(),
      requires_site_request: true,
      reference_instructions: null,
      reference_format: 'none',
      receipt_required: false,
      third_party_allowed: false,
      networks: [],
      common_errors: [],
      customer_notes: null,
      active: true,
    },
    {
      name: 'USDT (TRC20)',
      aliases: ['USDT', 'Tether'],
      direction: 'withdrawal',
      currency: 'USD',
      min_amount: 20,
      max_amount: 10000,
      expected_minutes: 60,
      delay_threshold_minutes: 180,
      working_hours: null,
      requires_site_request: true,
      reference_instructions: null,
      reference_format: 'none',
      receipt_required: false,
      third_party_allowed: false,
      networks: ['TRC20'],
      common_errors: [],
      customer_notes: null,
      active: true,
    },
  ],
  bonuses: [
    {
      name: 'Hoş geldin bonusu',
      aliases: ['Hoş geldin', 'İlk yatırım bonusu'],
      type: 'welcome',
      min_deposit: 100,
      wagering_multiplier: 10,
      wagering_base: 'bonus',
      contributing: [
        { category: 'slot', percent: 100 },
        { category: 'canlı casino', percent: 10 },
      ],
      min_odds: 1.5,
      max_bet: 50,
      max_cashout: 5000,
      validity_days: 30,
      claim_method: 'auto',
      promo_code: null,
      excluded_method_ids: [],
      active_from: null,
      active_to: null,
      terms_text: null,
    },
    {
      name: 'Kayıp bonusu',
      aliases: ['Kayıp', 'Cashback'],
      type: 'loss_bonus',
      min_deposit: 250,
      wagering_multiplier: 5,
      wagering_base: 'bonus',
      contributing: [],
      min_odds: null,
      max_bet: 50,
      max_cashout: null,
      validity_days: 7,
      claim_method: 'live_support',
      promo_code: null,
      excluded_method_ids: [],
      active_from: null,
      active_to: null,
      terms_text: null,
    },
    {
      name: 'Haftalık free spin',
      aliases: ['Free spin', 'Freespin'],
      type: 'free_spins',
      min_deposit: 200,
      wagering_multiplier: 20,
      wagering_base: 'bonus',
      contributing: [{ category: 'slot', percent: 100 }],
      min_odds: null,
      max_bet: 25,
      max_cashout: 1000,
      validity_days: 7,
      claim_method: 'code',
      promo_code: 'HAFTALIK',
      excluded_method_ids: [],
      active_from: null,
      active_to: null,
      terms_text: null,
    },
  ],
  kyc_documents: [
    {
      doc_type: 'Kimlik kartı',
      acceptance_criteria: ['Renkli', 'Dört köşesi görünür', 'Okunaklı', 'Süresi geçmemiş'],
      when_required: 'İlk çekimden önce',
      review_hours: 24,
      upload_path_text: 'Hesabım › Doğrulama sayfası',
      chat_upload_allowed: false,
    },
    {
      doc_type: 'Adres belgesi',
      acceptance_criteria: ['Son üç ay içinde düzenlenmiş', 'Ad soyad ve adres okunaklı'],
      when_required: 'İstendiğinde',
      review_hours: 48,
      upload_path_text: 'Hesabım › Doğrulama sayfası',
      chat_upload_allowed: false,
    },
    {
      doc_type: 'Banka hesap dökümü',
      acceptance_criteria: ['Hesap sahibinin adı görünür', 'Son üç ay içinde'],
      when_required: 'Ödeme yöntemi doğrulamasında',
      review_hours: 48,
      upload_path_text: 'Hesabım › Doğrulama sayfası',
      chat_upload_allowed: false,
    },
  ],
  rules: [
    {
      key: 'limit_increase_wait',
      category: 'limits',
      title: 'Limit yükseltme bekleme süresi',
      value_text: null,
      numeric_value: 24,
      unit: 'saat',
      description:
        'Yatırım, kayıp ve bahis limitlerinin yükseltilmesi ya da kaldırılması bu süre dolduktan sonra değerlendirilir; düşürme genellikle hemen geçerli olur.',
    },
    {
      key: 'complaint_response_time',
      category: 'other',
      title: 'Şikâyet yanıt süresi',
      value_text: '4 hafta',
      numeric_value: null,
      unit: null,
      description:
        'Resmi şikâyetlerin yanıtlanma süresi; sorumlu oyun şikâyetleri daha kısa sürede ele alınır.',
    },
  ],
};
