/**
 * "Hesap doğrulama / KYC belgeleri" — research §3 row 4 (tm 311.2 · AI-15).
 *
 * Which document, then the acceptance criteria and the tenant's own upload
 * path (G12: the document goes through the secure channel, never the chat,
 * and the AI never says it is approved). Not uploaded yet: the way to do it,
 * and solved. Uploaded and refused: the KYC team, for the appeal. Uploaded
 * and waiting: the document's usual review time; past it, the KYC team. A
 * suspected minor is G5's, before any step.
 */
import type { AiTemplate, ScenarioOption } from '../catalogue.js';
import { usernameSlot, type ScenarioFacts } from './shared.js';

export const KYC_DOCUMENTS: AiTemplate = {
  key: 'kyc_documents',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Hesap doğrulama belgeleri',
  summary:
    'Oyuncu kendisinden istenen doğrulama belgelerini sorduğunda belgenin kabul koşullarını ve yükleme yolunu anlatır, inceleme süresini "genellikle" ile söyler; ret itirazında ya da süre aşıldığında doğrulama ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu hesap doğrulaması için istenen belgeleri, yükleme yolunu, inceleme süresini ya da belgesinin kabul edilmemesini soruyor.',
    examples: [
      'hesap doğrulama belgesi istendi',
      'hangi belgeleri yüklemem gerekiyor',
      'belgemi yükledim hâlâ onaylanmadı',
      'doğrulama belgem kabul edilmedi',
      'kyc belgesi nasıl yüklenir',
      'adres belgesi istiyorlar',
      'which documents do I need to verify my account',
    ],
    priority: 60,
    slots: [
      {
        name: 'belge',
        label: 'İstenen belge',
        type: 'enum',
        ask: 'Sizden hangi belge istendi?',
        validate: { enum_source: 'kyc_documents' },
      },
      {
        name: 'yuklendi',
        label: 'Belge yüklendi',
        type: 'boolean',
        ask: 'Bu belgeyi siteye yüklediniz mi?',
      },
      {
        name: 'ret_bildirimi',
        label: 'Ret bildirimi geldi',
        type: 'boolean',
        ask: 'Yüklediğiniz belge için size kabul edilmediğine dair bir bildirim geldi mi?',
      },
      {
        name: 'sure_asildi',
        label: 'İnceleme süresi aşıldı',
        type: 'boolean',
        ask: 'Belgeyi yükleyeli bu süreden daha uzun zaman oldu mu?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'belge_sor', type: 'collect', slots: ['belge'] },
      { id: 'kosullar', type: 'say', template_key: 'kabul_kosullari' },
      { id: 'yukleme_sor', type: 'collect', slots: ['yuklendi'] },
      {
        id: 'yuklenmedi',
        type: 'check',
        when: { slot: { name: 'yuklendi', op: 'eq', value: false } },
        then: { goto: 'yukleme_yolu' },
      },
      { id: 'ret_sor', type: 'collect', slots: ['ret_bildirimi'] },
      {
        id: 'ret_geldi',
        type: 'check',
        when: { slot: { name: 'ret_bildirimi', op: 'eq', value: true } },
        then: { goto: 'ret_bilgi' },
      },
      { id: 'inceleme', type: 'say', template_key: 'inceleme_suresi' },
      { id: 'sure_sor', type: 'collect', slots: ['sure_asildi'] },
      {
        id: 'gecikme',
        type: 'check',
        when: { slot: { name: 'sure_asildi', op: 'eq', value: true } },
        then: { goto: 'gecikme_bilgi' },
      },
      {
        id: 'bekleme_bitti',
        type: 'resolve',
        outcome: 'resolved_waiting',
        followup_template: 'takip',
      },

      { id: 'yukleme_yolu', type: 'say', template_key: 'yukleme' },
      { id: 'yukleme_bitti', type: 'resolve', outcome: 'resolved' },

      { id: 'ret_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'ret_kalibi', type: 'say', template_key: 'ret_devir' },
      { id: 'ret_devir', type: 'handoff', reason_code: 'document_rejected' },

      { id: 'gecikme_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'gecikme_kalibi', type: 'say', template_key: 'devir' },
      { id: 'gecikme_devir', type: 'handoff', reason_code: 'review_time_exceeded' },
    ],
    templates: [
      {
        key: 'kabul_kosullari',
        text: '{belge} için belgenin renkli, dört köşesi görünür, okunaklı ve güncel olması gerekiyor. Belgeyi lütfen sohbete eklemeyin; yalnız şu yoldan yükleyin: {kyc_document.upload_path_text}.',
      },
      {
        key: 'yukleme',
        text: 'Belgeyi hazırladığınızda {kyc_document.upload_path_text} üzerinden yükleyebilirsiniz. Yüklemeden sonra inceleme genellikle {kyc_document.review_hours} sürer.',
      },
      {
        key: 'inceleme_suresi',
        text: '{belge} incelemesi genellikle {kyc_document.review_hours} sürer.',
      },
      {
        key: 'takip',
        text: 'Bu süre dolduğunda hâlâ bir sonuç görmezseniz bu sohbete yazın; doğrulama ekibimize iletelim.',
      },
      {
        key: 'ret_devir',
        text: 'Belgenizin neden kabul edilmediğini ve itiraz yolunu doğrulama ekibimiz açıklayacak. Bilgilerinizi onlara iletiyorum.',
      },
      {
        key: 'devir',
        text: 'Verdiğiniz bilgilere göre inceleme olağan süreyi aşmış. Bilgilerinizi doğrulama ekibimize iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'kyc_risk' },
      card_fields: ['belge', 'kyc_document.review_hours'],
      next_step_hint: '{belge} belgesinin inceleme durumunu doğrulama panelinde görün.',
    },
    limits: { max_turns: 10 },
  },
  forbidden_phrases: [
    {
      phrase: 'belgeniz onaylandı',
      match: 'word',
      why: 'Yapay zekâ belge içeriğini yorumlamaz ve onay vermez (G12).',
    },
    {
      phrase: 'buraya yükleyin',
      match: 'word',
      why: 'Belge yalnız kiracının güvenli kanalından alınır (G12).',
    },
    {
      phrase: 'sohbete ekleyin',
      match: 'word',
      why: 'Belge yalnız kiracının güvenli kanalından alınır (G12).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'kyc_documents',
      columns: ['kyc_document.upload_path_text', 'kyc_document.review_hours'],
      label:
        'KYC belgeleri tablosu: her belgenin yükleme yolu (ör. "Hesabım › Doğrulama") ve olağan inceleme süresi. Kabul kriterleri satırda tutulur.',
    },
  ],
  scenarios: [
    {
      key: 'yuklenmemis_yol',
      name: 'Belge henüz yüklenmemiş — kabul koşulları ve yükleme yolu anlatılır',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['hesap doğrulama belgesi istendi', 'kimlik kartı', 'hayır yüklemedim', 'evet'],
      facts: idCardRow(),
      options: { belge: documentOptions() },
      expect: {
        outcome: 'resolved',
        required_slots: ['belge', 'yuklendi'],
        values: { belge: 'Kimlik kartı' },
      },
    },
    {
      key: 'inceleme_bekleniyor',
      name: 'Yüklendi, ret yok, süre içinde — inceleme süresi söylenir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'belgemi yükledim hâlâ onaylanmadı',
        'adres belgesi',
        'evet',
        'hayır',
        'hayır',
        'evet',
      ],
      facts: addressRow(),
      options: { belge: documentOptions() },
      expect: {
        outcome: 'resolved_waiting',
        required_slots: ['belge', 'yuklendi', 'ret_bildirimi', 'sure_asildi'],
        values: { belge: 'Adres belgesi' },
      },
    },
    {
      key: 'ret_itirazi',
      name: 'Belge kabul edilmedi — doğrulama ekibine devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['doğrulama belgem kabul edilmedi', 'kimlik', 'evet', 'evet', 'ahmet77'],
      facts: idCardRow(),
      options: { belge: documentOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'document_rejected',
        topic: 'kyc_risk',
        required_slots: ['belge', 'yuklendi', 'ret_bildirimi', 'kullanici_adi'],
        values: { kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'inceleme_gecikti',
      name: 'İnceleme süresi aşıldı — doğrulama ekibine devredilir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['kyc belgesi nasıl yüklenir', 'adres belgesi', 'evet', 'hayır', 'evet', 'mehmet_34'],
      facts: addressRow(),
      options: { belge: documentOptions() },
      expect: {
        outcome: 'handoff',
        reason_code: 'review_time_exceeded',
        topic: 'kyc_risk',
        required_slots: ['belge', 'yuklendi', 'ret_bildirimi', 'sure_asildi', 'kullanici_adi'],
      },
    },
  ],
};

function documentOptions(): ScenarioOption[] {
  return [
    { value: 'Kimlik kartı', aliases: ['kimlik', 'nüfus cüzdanı'] },
    { value: 'Adres belgesi', aliases: ['ikametgah', 'fatura'] },
    { value: 'Banka hesap dökümü', aliases: ['hesap dökümü', 'ekstre'] },
  ];
}

function idCardRow(): ScenarioFacts {
  return {
    'kyc_document.doc_type': 'Kimlik kartı',
    'kyc_document.upload_path_text': 'Hesabım › Doğrulama sayfası',
    'kyc_document.review_hours': 24,
  };
}

function addressRow(): ScenarioFacts {
  return {
    'kyc_document.doc_type': 'Adres belgesi',
    'kyc_document.upload_path_text': 'Hesabım › Doğrulama sayfası',
    'kyc_document.review_hours': 48,
  };
}
