/**
 * "İkinci hesap / hesap paylaşımı / başkasının hesabından ödeme" — research §3
 * row 20, guardrail G13 (tm 311.2 · AI-15).
 *
 * The rules, "politikamıza göre": one account per player, no shared account,
 * deposits and withdrawals only through accounts in the player's own name.
 * If the player says something like that has already happened, a short
 * description and the player, and the risk team — always. Nothing about
 * fraud or AML checks is said (G13); the neutral word is "inceleme".
 */
import type { AiTemplate } from '../catalogue.js';
import { usernameSlot } from './shared.js';

export const MULTI_ACCOUNT_THIRD_PARTY: AiTemplate = {
  key: 'multi_account_third_party',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Çoklu hesap, hesap paylaşımı ve üçüncü kişi ödemesi',
  summary:
    'Oyuncu ikinci hesap açmayı, hesabını başkasıyla paylaşmayı ya da başkasının hesabından ödeme yapmayı sorduğunda kuralları açıklar; böyle bir durum yaşandıysa bilgileri alıp inceleme için risk ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu ikinci bir hesap açmayı, hesabını aile üyesi ya da arkadaşıyla paylaşmayı, başka birinin banka hesabından ya da kartından yatırım yapmayı soruyor veya böyle bir durumu bildiriyor.',
    examples: [
      'ikinci bir hesap açabilir miyim',
      'kardeşimle aynı hesabı kullanabilir miyiz',
      'başkasının hesabından yatırım yapabilir miyim',
      'eşimin kartıyla yatırım yaptım',
      'arkadaşım benim hesabımdan oynuyor',
      'can I have two accounts',
    ],
    priority: 50,
    slots: [
      {
        name: 'durum_var',
        label: 'Kurala uymayan durum yaşandı',
        type: 'boolean',
        ask: 'Hesabınızla ilgili bu kurallara uymayan bir durum yaşandı mı?',
      },
      {
        name: 'aciklama',
        label: 'Durumun açıklaması',
        type: 'text',
        ask: 'Ne olduğunu kısaca anlatır mısınız?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'kurallar', type: 'say', template_key: 'kurallar' },
      { id: 'durum_sor', type: 'collect', slots: ['durum_var'] },
      {
        id: 'durum_yasandi',
        type: 'check',
        when: { slot: { name: 'durum_var', op: 'eq', value: true } },
        then: { goto: 'aciklama_sor' },
      },
      { id: 'bilgi_bitti', type: 'resolve', outcome: 'resolved' },

      { id: 'aciklama_sor', type: 'collect', slots: ['aciklama'] },
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'inceleme_kalibi', type: 'say', template_key: 'devir' },
      { id: 'inceleme_devir', type: 'handoff', reason_code: 'account_review' },
    ],
    templates: [
      {
        key: 'kurallar',
        text: 'Politikamıza göre her oyuncu yalnız bir hesap kullanabilir, hesap başka biriyle paylaşılamaz ve yatırımlar ile çekimler yalnız sitedeki adınıza kayıtlı hesaplardan yapılabilir.',
      },
      {
        key: 'devir',
        text: 'Bilgilerinizi inceleme için ilgili ekibimize iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'kyc_risk' },
      card_fields: ['durum_var', 'aciklama'],
      next_step_hint:
        'Bildirilen durumu hesap politikasına göre inceleyin; inceleme gerekçesini oyuncuya açıklamayın.',
    },
    limits: { max_turns: 6 },
  },
  forbidden_phrases: [
    {
      phrase: 'dolandırıcılık',
      match: 'exact',
      why: 'Risk ve fraud kontrolleri oyuncuya açıklanmaz (G13).',
    },
    {
      phrase: 'ikinci hesap açabilirsiniz',
      match: 'word',
      why: 'Kurala aykırı bir yol önerilmez.',
    },
    {
      phrase: 'hesabınız kapatılacak',
      match: 'word',
      why: 'Yapay zekâ yaptırım söylemez; karar incelemenindir (G13).',
    },
  ],
  tenant_must_fill: [],
  scenarios: [
    {
      key: 'kural_bilgisi',
      name: 'İkinci hesap sorusu — kural açıklanır, bir durum yok',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['ikinci bir hesap açabilir miyim', 'hayır', 'evet'],
      facts: {},
      expect: { outcome: 'resolved', required_slots: ['durum_var'] },
    },
    {
      key: 'ucuncu_kisi_kart',
      name: 'Eşinin kartıyla yatırım — açıklama alınır, incelemeye devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'eşimin kartıyla yatırım yaptım',
        'evet',
        'Dün eşimin kartıyla 1.000 TL yatırdım',
        'ahmet77',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'account_review',
        topic: 'kyc_risk',
        required_slots: ['durum_var', 'aciklama', 'kullanici_adi'],
        values: { kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'hesap_paylasimi',
      name: 'Arkadaşı hesabından oynuyor — incelemeye devredilir',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'arkadaşım benim hesabımdan oynuyor',
        'evet',
        'Arkadaşım geçen hafta hesabımdan oynadı',
        'mehmet_34',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'account_review',
        topic: 'kyc_risk',
        required_slots: ['durum_var', 'aciklama', 'kullanici_adi'],
      },
    },
  ],
};
