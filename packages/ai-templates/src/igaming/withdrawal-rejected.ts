/**
 * "Çekimim reddedildi / iptal edildi" — research §3 row 3 (tm 311.2 · AI-15).
 *
 * The AI never interprets or argues a rejection: it names the usual reasons
 * in general terms ("genellikle"), collects what finance needs — the message
 * the player received, the method, amount, time, whether the receiving
 * account is in the player's own name, whether a bonus was used — and always
 * hands over for the actual reason. A name mismatch is its own reason on the
 * card.
 */
import type { AiTemplate } from '../catalogue.js';
import { unverifiedStatusPhrases, usernameSlot, withdrawalMethodOptions } from './shared.js';

export const WITHDRAWAL_REJECTED: AiTemplate = {
  key: 'withdrawal_rejected',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Çekim reddedildi ya da iptal edildi',
  summary:
    'Oyuncu çekiminin reddedildiğini ya da iptal edildiğini söylediğinde genel ret nedenlerini anlatır, gelen mesajı ve çekim bilgilerini toplar; kesin gerekçe için her zaman finans ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu çekim talebinin reddedildiğini, iptal edildiğini ya da geri döndüğünü söylüyor ve nedenini soruyor.',
    examples: [
      'çekimim reddedildi',
      'çekim talebim iptal edildi',
      'çekimim neden reddedildi',
      'çekim talebim geri döndü',
      'para çekme talebim iptal oldu',
      'my withdrawal was rejected',
      'why was my withdrawal cancelled',
    ],
    priority: 50,
    slots: [
      {
        name: 'ret_mesaji',
        label: 'Gelen ret / iptal mesajı',
        type: 'text',
        ask: 'Size iletilen mesajda ya da çekim ekranında gerekçe olarak ne yazıyor?',
      },
      {
        name: 'yontem',
        label: 'Çekim yöntemi',
        type: 'enum',
        ask: 'Çekimi hangi yöntemle talep etmiştiniz?',
        validate: { enum_source: 'payment_methods.withdrawal' },
      },
      {
        name: 'tutar',
        label: 'Tutar',
        type: 'money',
        ask: 'Ne kadarlık bir çekim talep etmiştiniz?',
      },
      {
        name: 'talep_zamani',
        label: 'Talep zamanı',
        type: 'datetime',
        ask: 'Çekim talebini hangi gün ve saat kaçta verdiniz?',
      },
      {
        name: 'isim_ayni',
        label: 'Alıcı hesap kendi adına',
        type: 'boolean',
        ask: 'Çekim yapılacak hesap sitedeki adınıza mı kayıtlı?',
      },
      {
        name: 'bonus_kullanildi',
        label: 'Bonus kullanıldı',
        type: 'boolean',
        ask: 'Bu çekimden önce bir bonus kullanmış mıydınız?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'mesaj', type: 'collect', slots: ['ret_mesaji'] },
      { id: 'yontem_tutar', type: 'collect', slots: ['yontem', 'tutar'] },
      { id: 'zaman_kullanici', type: 'collect', slots: ['talep_zamani', 'kullanici_adi'] },
      { id: 'isim', type: 'collect', slots: ['isim_ayni'] },
      {
        id: 'isim_farkli',
        type: 'check',
        when: { slot: { name: 'isim_ayni', op: 'eq', value: false } },
        then: { goto: 'isim_kalibi' },
      },
      { id: 'bonus', type: 'collect', slots: ['bonus_kullanildi'] },
      { id: 'finans_kalibi', type: 'say', template_key: 'devir' },
      { id: 'finansa_devir', type: 'handoff', reason_code: 'withdrawal_rejected_review' },

      { id: 'isim_kalibi', type: 'say', template_key: 'isim_uyusmazligi' },
      { id: 'isim_devir', type: 'handoff', reason_code: 'name_mismatch' },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Durumu anlıyorum. Çekim talepleri genellikle hesap sahibinin adı ile alıcı hesabın uyuşmaması, tamamlanmamış çevrim şartı, eksik hesap doğrulaması ya da yöntem limitleri gibi nedenlerle onaylanmayabilir. Kesin gerekçeyi finans ekibimiz paylaşır; önce birkaç bilgi alayım.',
      },
      {
        key: 'isim_uyusmazligi',
        text: 'Politikamıza göre çekimler yalnız sitedeki adınıza kayıtlı bir hesaba yapılabiliyor. Bilgilerinizi inceleme için finans ekibimize iletiyorum.',
      },
      {
        key: 'devir',
        text: 'Bilgilerinizi finans ekibimize iletiyorum; talebinizin gerekçesini bir uzman bu sohbet üzerinden size açıklayacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'finance' },
      card_fields: ['ret_mesaji', 'isim_ayni', 'bonus_kullanildi'],
      next_step_hint: 'Ret gerekçesini ödeme panelinde görün ve oyuncuya açıklayın.',
    },
    limits: { max_turns: 12 },
  },
  forbidden_phrases: [
    ...unverifiedStatusPhrases(),
    {
      phrase: 'yanlışlıkla reddedilmiş',
      match: 'word',
      why: 'Yapay zekâ ret kararını yorumlamaz (research §3 · 3).',
    },
    {
      phrase: 'tekrar talep oluşturun',
      match: 'word',
      why: 'Gerekçe bilinmeden yeni talep önerilmez; karar finansındır.',
    },
    {
      phrase: 'onaylanacak',
      match: 'word',
      why: 'Onay sözü verilmez (G7).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'payment_methods.withdrawal',
      columns: [],
      label:
        'Çekim yöntemleri tablosu: oyuncunun yöntemini tanımak için yöntem adları ve takma adları.',
    },
  ],
  scenarios: [
    {
      key: 'gerekce_icin_finans',
      name: 'Ret mesajı alındı, bilgiler toplanır — gerekçe için finansa devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'çekimim reddedildi',
        'Talebiniz onaylanmadı yazıyor',
        'Papara',
        '3.000 TL',
        'bugün 11:00',
        'ahmet77',
        'evet',
        'hayır',
      ],
      facts: {},
      options: { yontem: withdrawalMethodOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'withdrawal_rejected_review',
        topic: 'finance',
        required_slots: [
          'ret_mesaji',
          'yontem',
          'tutar',
          'talep_zamani',
          'kullanici_adi',
          'isim_ayni',
          'bonus_kullanildi',
        ],
        values: { yontem: 'Papara', tutar: '3.000 TRY', kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'isim_uyusmazligi',
      name: 'Alıcı hesap başka birinin adına — kural söylenir, finansa devredilir',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'çekim talebim iptal edildi',
        'İsim uyuşmazlığı yazıyor',
        'havale',
        '10.000 TL',
        'dün 20:00',
        'mehmet_34',
        'hayır, eşimin hesabı',
      ],
      facts: {},
      options: { yontem: withdrawalMethodOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'name_mismatch',
        topic: 'finance',
        required_slots: ['ret_mesaji', 'yontem', 'tutar', 'kullanici_adi', 'isim_ayni'],
        values: { yontem: 'Havale', kullanici_adi: 'mehmet_34' },
      },
    },
    {
      key: 'bonuslu_kripto',
      name: 'USDT çekimi bonus sonrası iptal — bilgiler toplanır, finansa devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'çekimim neden reddedildi',
        'Çevrim şartı tamamlanmadı yazıyor',
        'usdt',
        '1.500 TL',
        'bugün 09:30',
        'ali_k',
        'evet',
        'evet',
      ],
      facts: {},
      options: { yontem: withdrawalMethodOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'withdrawal_rejected_review',
        topic: 'finance',
        required_slots: ['ret_mesaji', 'yontem', 'bonus_kullanildi', 'kullanici_adi'],
        values: { yontem: 'USDT (TRC20)', kullanici_adi: 'ali_k' },
      },
    },
  ],
};
