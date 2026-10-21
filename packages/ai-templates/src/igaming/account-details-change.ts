/**
 * "Bilgilerimi değiştirmek istiyorum" — research §3 row 17, guardrail G13
 * (tm 311.2 · AI-15).
 *
 * A change of name, phone, e-mail, bank account or address is never made in
 * the chat: it carries a takeover risk and needs identity verification. The
 * AI asks which detail and why, explains that only a verified request is
 * processed, and always hands over to the risk team. It does not collect the
 * new value, and it says nothing about risk checks beyond that (G13).
 */
import type { AiTemplate } from '../catalogue.js';
import { usernameSlot } from './shared.js';

export const ACCOUNT_DETAILS_CHANGE: AiTemplate = {
  key: 'account_details_change',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Hesap bilgisi değişikliği',
  summary:
    'Oyuncu adını, telefonunu, e-posta adresini, banka hesabını ya da adresini değiştirmek istediğinde değişikliğin yalnız kimlik doğrulamasıyla yapılabileceğini anlatır, hangi bilginin neden değişeceğini sorar ve her zaman ilgili ekibe devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu hesabındaki ad-soyad, telefon numarası, e-posta adresi, banka hesabı ya da adres bilgisini değiştirmek veya güncellemek istiyor.',
    examples: [
      'bilgilerimi değiştirmek istiyorum',
      'telefon numaramı değiştirmek istiyorum',
      'e-posta adresimi güncellemek istiyorum',
      'hesap bilgilerimi güncellemek istiyorum',
      'adresimi değiştirmem gerekiyor',
      'soyadım değişti',
      'I want to change my email',
    ],
    priority: 50,
    slots: [
      {
        name: 'alan',
        label: 'Değişecek bilgi',
        type: 'enum',
        ask: 'Hangi bilginizi değiştirmek istiyorsunuz: ad soyad, telefon, e-posta, banka hesabı ya da adres?',
        validate: { enum_values: ['Ad soyad', 'Telefon', 'E-posta', 'Banka hesabı', 'Adres'] },
      },
      {
        name: 'neden',
        label: 'Değişiklik nedeni',
        type: 'text',
        ask: 'Bu değişiklik neden gerekiyor? Kısaca yazar mısınız?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'alan_sor', type: 'collect', slots: ['alan'] },
      { id: 'neden_sor', type: 'collect', slots: ['neden'] },
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'dogrulama_kalibi', type: 'say', template_key: 'devir' },
      { id: 'dogrulama_devir', type: 'handoff', reason_code: 'account_details_change' },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Hesabınızın güvenliği için hesap bilgilerindeki değişiklikler yalnız kimlik doğrulamasından sonra ekibimiz tarafından yapılabiliyor. Talebinizi iletebilmem için birkaç bilgi alacağım; yeni bilgiyi şimdilik paylaşmanıza gerek yok.',
      },
      {
        key: 'devir',
        text: 'Talebinizi ilgili ekibimize iletiyorum; doğrulama adımlarını bir uzman bu sohbet üzerinden sizinle paylaşacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'kyc_risk' },
      card_fields: ['alan', 'neden'],
      next_step_hint:
        'Oyuncunun kimliğini doğrulayın; {alan} değişikliğini yalnız doğrulamadan sonra yapın.',
    },
    limits: { max_turns: 6 },
  },
  forbidden_phrases: [
    {
      phrase: 'bilginiz güncellendi',
      match: 'word',
      why: 'Yapay zekâ hesapta değişiklik yapmaz (G8, G13).',
    },
    {
      phrase: 'yeni numaranızı yazın',
      match: 'word',
      why: 'Yeni bilgi sohbette toplanmaz; değişiklik doğrulamayla yapılır (G13).',
    },
    {
      phrase: 'güvenlik kontrolü',
      match: 'word',
      why: 'Risk kontrolleri oyuncuya açıklanmaz (G13).',
    },
  ],
  tenant_must_fill: [],
  scenarios: [
    {
      key: 'telefon_degisikligi',
      name: 'Telefon numarası değişikliği — doğrulama için ekibe devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'telefon numaramı değiştirmek istiyorum',
        'telefon',
        'Eski hattımı kapattım',
        'ahmet77',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'account_details_change',
        topic: 'kyc_risk',
        required_slots: ['alan', 'neden', 'kullanici_adi'],
        values: { alan: 'Telefon', kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'eposta_degisikligi',
      name: 'E-posta değişikliği — doğrulama için ekibe devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'e-posta adresimi güncellemek istiyorum',
        'e-posta',
        'Eski e-postama erişimim yok',
        'mehmet_34',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'account_details_change',
        topic: 'kyc_risk',
        required_slots: ['alan', 'neden', 'kullanici_adi'],
        values: { alan: 'E-posta' },
      },
    },
    {
      key: 'soyad_degisikligi',
      name: 'Evlilik sonrası soyadı değişikliği — doğrulama için ekibe devredilir',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['soyadım değişti', 'ad soyad', 'Evlendim, soyadım değişti', 'ayse_y'],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'account_details_change',
        topic: 'kyc_risk',
        required_slots: ['alan', 'neden', 'kullanici_adi'],
        values: { alan: 'Ad soyad', kullanici_adi: 'ayse_y' },
      },
    },
  ],
};
