/**
 * "Hesabım kilitlendi / kapatıldı" — research §3 row 10 (tm 311.2 · AI-15).
 *
 * The AI does not interpret a lock: it asks what the player sees and when,
 * whether a warning arrived, and whether the player once asked to close or
 * pause the account themselves. That last one is a reopening request — only
 * the responsible gambling team decides it, and policy may refuse it; the
 * rest always goes to the risk team for review. Nothing about the reason
 * (AML, fraud) is said (G13); "inceleme" is the neutral word.
 */
import type { AiTemplate } from '../catalogue.js';
import { unverifiedStatusPhrases, usernameSlot } from './shared.js';

export const ACCOUNT_LOCKED: AiTemplate = {
  key: 'account_locked',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Hesap kilitli ya da kapatılmış',
  summary:
    'Oyuncu hesabının kilitlendiğini ya da kapatıldığını söylediğinde nedeni yorumlamadan gördüğü mesajı ve gerekli bilgileri toplar; daha önce kendi isteğiyle kapattıysa sorumlu oyun ekibine, diğer durumlarda inceleme için risk ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu hesabının kilitlendiğini, askıya alındığını, kapatıldığını ya da devre dışı bırakıldığını söylüyor ve nedenini ya da yeniden açılmasını soruyor.',
    examples: [
      'hesabım kilitlendi',
      'hesabım kapatılmış',
      'hesabım askıya alındı',
      'hesabım neden kilitli',
      'hesabımı tekrar açmak istiyorum',
      'hesabım devre dışı',
      'my account is locked',
    ],
    priority: 50,
    slots: [
      {
        name: 'gorulen_mesaj',
        label: 'Görülen mesaj',
        type: 'text',
        ask: 'Giriş yaptığınızda ya da hesabınızda hangi mesajı görüyorsunuz?',
      },
      {
        name: 'fark_zamani',
        label: 'Fark edildiği zaman',
        type: 'datetime',
        ask: 'Bunu ne zaman fark ettiniz?',
      },
      {
        name: 'uyari_geldi',
        label: 'Uyarı e-postası / SMS',
        type: 'boolean',
        ask: 'Bu konuda size bir e-posta ya da SMS geldi mi?',
      },
      {
        name: 'kendi_talebi',
        label: 'Daha önce kendi talebiyle kapatma',
        type: 'boolean',
        ask: 'Daha önce kendi isteğinizle hesabınızın kapatılmasını ya da ara verilmesini talep ettiniz mi?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'mesaj_sor', type: 'collect', slots: ['gorulen_mesaj'] },
      { id: 'talep_sor', type: 'collect', slots: ['kendi_talebi'] },
      {
        id: 'kendi_kapatti',
        type: 'check',
        when: { slot: { name: 'kendi_talebi', op: 'eq', value: true } },
        then: { goto: 'rg_bilgi' },
      },
      { id: 'zaman_sor', type: 'collect', slots: ['fark_zamani'] },
      { id: 'uyari_sor', type: 'collect', slots: ['uyari_geldi'] },
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'inceleme_kalibi', type: 'say', template_key: 'devir' },
      { id: 'inceleme_devir', type: 'handoff', reason_code: 'account_locked_review' },

      { id: 'rg_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'rg_kalibi', type: 'say', template_key: 'yeniden_acma' },
      {
        id: 'rg_devir',
        type: 'handoff',
        reason_code: 'reopen_after_self_exclusion',
        target: { topic: 'responsible_gambling' },
      },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Durumu anlıyorum. Hesap kısıtlamalarının nedenini buradan değerlendiremiyorum; bir uzmanın inceleyebilmesi için birkaç bilgi alacağım.',
      },
      {
        key: 'yeniden_acma',
        text: 'Kendi isteğinizle kapatılan ya da ara verilen hesapların yeniden açılması talebini yalnız sorumlu oyun ekibimiz değerlendirir; politikamıza göre bu talep kabul edilmeyebilir. Talebinizi onlara iletiyorum.',
      },
      {
        key: 'devir',
        text: 'Bilgilerinizi inceleme için ilgili ekibimize iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'kyc_risk' },
      card_fields: ['gorulen_mesaj', 'kendi_talebi', 'uyari_geldi'],
      next_step_hint:
        'Hesaptaki kısıtlamanın kaydını ve gerekçesini inceleyin; gerekçeyi oyuncuya iç politika çerçevesinde açıklayın.',
    },
    limits: { max_turns: 10 },
  },
  forbidden_phrases: [
    ...unverifiedStatusPhrases(),
    {
      phrase: 'hesabınızı açıyorum',
      match: 'word',
      why: 'Yapay zekâ hesabı açamaz; yeniden açma yalnız insanındır (research §3 · 10).',
    },
    {
      phrase: 'şüpheli işlem',
      match: 'word',
      why: 'Risk ve AML kontrolleri oyuncuya açıklanmaz (G13).',
    },
    {
      phrase: 'yeniden açılacak',
      match: 'word',
      why: 'Yeniden açma sözü verilmez (G7).',
    },
  ],
  tenant_must_fill: [],
  scenarios: [
    {
      key: 'inceleme_icin_devir',
      name: 'Hesap kilitli, kendi talebi yok — bilgiler toplanır, incelemeye devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'hesabım kilitlendi',
        'Hesabınız geçici olarak kısıtlanmıştır yazıyor',
        'hayır',
        'bugün 10:00',
        'evet geldi',
        'ahmet77',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'account_locked_review',
        topic: 'kyc_risk',
        required_slots: [
          'gorulen_mesaj',
          'kendi_talebi',
          'fark_zamani',
          'uyari_geldi',
          'kullanici_adi',
        ],
        values: { kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'kendi_talebiyle_kapatilmis',
      name: 'Daha önce kendi isteğiyle kapattırmış — yeniden açma sorumlu oyun ekibine',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['hesabımı tekrar açmak istiyorum', 'Hesabınız kapalı yazıyor', 'evet', 'mehmet_34'],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'reopen_after_self_exclusion',
        topic: 'responsible_gambling',
        required_slots: ['gorulen_mesaj', 'kendi_talebi', 'kullanici_adi'],
        values: { kullanici_adi: 'mehmet_34' },
      },
    },
    {
      key: 'uyari_gelmemis',
      name: 'Askıya alınmış, uyarı gelmemiş — incelemeye devredilir',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'hesabım askıya alındı',
        'Giriş yapınca hesap askıda diyor',
        'hayır',
        'dün 22:00',
        'hayır',
        'ali_k',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'account_locked_review',
        topic: 'kyc_risk',
        required_slots: ['gorulen_mesaj', 'kendi_talebi', 'uyari_geldi', 'kullanici_adi'],
      },
    },
  ],
};
