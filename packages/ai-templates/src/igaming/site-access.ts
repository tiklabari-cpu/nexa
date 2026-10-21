/**
 * "Site açılmıyor / güncel adres" — research §3 row 19, K13, guardrail G14
 * (tm 311.2 · AI-15).
 *
 * The AI says only what the tenant's access information setting says (K13 ·
 * AI-13 "Erişim bilgisi", tm 310.4): the `answer_from_knowledge` step asks
 * the engine's access path, which answers an access question from the
 * setting's link, knowledge row or fetched value — and hands over when the
 * setting has nothing. It never invents an address and never suggests a VPN,
 * a proxy, a DNS change or a mirror (G14; the output check lets through only
 * the setting's own words). Then whether the player got in: yes is solved, no
 * is the technical team with the device and the error.
 */
import type { AiTemplate } from '../catalogue.js';

/** The tenant's access information as the scenarios' setting serves it — "örnek — doğrulayın". */
const ACCESS_INFO = 'Erişim bilgisi: https://destek.ornek.example/erisim';

export const SITE_ACCESS: AiTemplate = {
  key: 'site_access',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Siteye erişim sorunu',
  summary:
    'Oyuncu sitenin açılmadığını ya da erişim adresini sorduğunda yalnız işletmenin Erişim bilgisi ayarındaki bilgiyi paylaşır; engel aşma yöntemi önermez, bilgi yoksa ya da sorun sürüyorsa teknik ekibe devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu sitenin açılmadığını, siteye giremediğini, erişim adresini ya da erişim için VPN, DNS gibi bir yöntem gerekip gerekmediğini soruyor.',
    examples: [
      'site açılmıyor',
      'siteye giremiyorum',
      'güncel adres nedir',
      'giriş adresi ne',
      'vpn kullanmam gerekiyor mu',
      'erişim sorunu yaşıyorum',
      'the site will not open',
    ],
    priority: 50,
    slots: [
      {
        name: 'erisildi',
        label: 'Erişim sağlandı',
        type: 'boolean',
        ask: 'Bu bilgiyle siteye erişebildiniz mi?',
      },
      {
        name: 'cihaz_hata',
        label: 'Cihaz ve görülen hata',
        type: 'text',
        ask: 'Hangi cihazı kullanıyorsunuz ve ekranda hangi hata mesajını görüyorsunuz?',
      },
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'erisim_bilgisi', type: 'answer_from_knowledge', query_hint: 'erişim sorunu' },
      { id: 'sonuc_sor', type: 'collect', slots: ['erisildi'] },
      {
        id: 'erisilemedi',
        type: 'check',
        when: { slot: { name: 'erisildi', op: 'eq', value: false } },
        then: { goto: 'cihaz_sor' },
      },
      // Solved by the player's own yes (the procedure's criterion): the closing line goes with it.
      { id: 'erisim_bitti', type: 'resolve', outcome: 'resolved', followup_template: 'kapanis' },

      { id: 'cihaz_sor', type: 'collect', slots: ['cihaz_hata'] },
      { id: 'teknik_kalibi', type: 'say', template_key: 'devir' },
      { id: 'teknik_devir', type: 'handoff', reason_code: 'access_issue' },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Erişim için işletmemizin paylaştığı resmi bilgiyi aktarıyorum.',
      },
      {
        key: 'kapanis',
        text: 'Siteye erişebildiğinize sevindim. Başka bir konuda yardımcı olabileceğim bir şey olursa yazmanız yeterli.',
      },
      {
        key: 'devir',
        text: 'Erişim sorununuz sürdüğü için bilgilerinizi teknik ekibimize iletiyorum; bir uzman bu sohbet üzerinden size yardımcı olacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'technical' },
      card_fields: ['erisildi', 'cihaz_hata'],
      next_step_hint:
        'Erişim bilgisi ayarının güncel olduğunu kontrol edin; oyuncuya yalnız onaylı kanal bilgisini verin.',
    },
    limits: { max_turns: 6 },
    resolution_criteria: { slot: { name: 'erisildi', op: 'eq', value: true } },
  },
  forbidden_phrases: [
    {
      phrase: 'vpn ile',
      match: 'word',
      why: 'Erişim engeli aşma yöntemi önerilmez (G14).',
    },
    {
      phrase: 'dns ayarlarınızı',
      match: 'word',
      why: 'Erişim engeli aşma yöntemi önerilmez (G14).',
    },
    {
      phrase: 'ayna site',
      match: 'word',
      why: 'Erişim engeli aşma yöntemi önerilmez (G14).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'setting',
      setting: 'access_info',
      label:
        'Erişim bilgisi ayarı (K13): yapay zekânın erişim sorularında söyleyebileceği tek bilgi — sabit bağlantı, bilgi satırı ya da dinamik adres. Boşsa yapay zekâ bilgi vermez, teknik ekibe devreder.',
    },
  ],
  scenarios: [
    {
      key: 'erisim_saglandi',
      name: 'Site açılmıyor — erişim bilgisi verilir, oyuncu girebildi',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['site açılmıyor', 'evet girebildim'],
      facts: {},
      access_info: ACCESS_INFO,
      expect: {
        outcome: 'resolved',
        required_slots: ['erisildi'],
        forbidden_phrases: ['vpn', 'proxy'],
      },
    },
    {
      key: 'sorun_suruyor',
      name: 'Erişim bilgisine rağmen giremiyor — teknik ekibe devredilir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'siteye giremiyorum',
        'hayır hâlâ açılmıyor',
        'Android telefon, bağlantı zaman aşımı',
      ],
      facts: {},
      access_info: ACCESS_INFO,
      expect: {
        outcome: 'handoff',
        reason_code: 'access_issue',
        topic: 'technical',
        required_slots: ['erisildi', 'cihaz_hata'],
      },
    },
    {
      key: 'vpn_sorusu',
      name: 'VPN sorusu — VPN önerilmez, yalnız erişim bilgisi verilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['vpn kullanmam gerekiyor mu', 'evet'],
      facts: {},
      access_info: ACCESS_INFO,
      expect: {
        outcome: 'resolved',
        required_slots: ['erisildi'],
        forbidden_phrases: ['vpn kullanın', 'proxy'],
      },
    },
  ],
};
