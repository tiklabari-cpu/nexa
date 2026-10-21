/**
 * "Resmi şikâyet / itiraz" — research §3 row 18, guardrail G15 (tm 311.2 ·
 * AI-15).
 *
 * A formal complaint always goes to a person (CGA Player Complaints Policy
 * Guidelines v1.1: complex complaints and responsible gambling complaints are
 * not handled by AI). The AI takes a short summary, the date, whether support
 * was contacted before and the outcome the player expects, then gives the
 * tenant's complaint procedure — its response time and its ADR body — word
 * for word (`verbatim`) and hands over to the complaints team. The response
 * time and the ADR body are the tenant's to fill in; publishing with either
 * still a placeholder is `400 template_unfilled` (#311.3).
 */
import type { AiTemplate } from '../catalogue.js';
import { usernameSlot } from './shared.js';

export const COMPLAINT_FORMAL: AiTemplate = {
  key: 'complaint_formal',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Resmi şikâyet ve itiraz',
  summary:
    'Oyuncu resmi bir şikâyette bulunmak ya da bir karara itiraz etmek istediğinde şikâyetin özetini ve gerekli bilgileri alır, işletmenin şikâyet prosedürünü, yanıt süresini ve ADR kuruluşunu olduğu gibi paylaşır ve şikâyet ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu resmi bir şikâyette bulunmak, bir karara itiraz etmek, şikâyetini üst birime ya da lisans kurumuna taşımak istiyor.',
    examples: [
      'şikâyet etmek istiyorum',
      'resmi şikâyette bulunmak istiyorum',
      'şikayetimi iletmek istiyorum',
      'bu karara itiraz ediyorum',
      'şikayet nasıl yapılır',
      'I want to make a formal complaint',
    ],
    priority: 20,
    slots: [
      {
        name: 'ozet',
        label: 'Şikâyetin özeti',
        type: 'text',
        ask: 'Şikâyetinizi kısaca özetler misiniz?',
      },
      {
        name: 'olay_tarihi',
        label: 'Olayın tarihi',
        type: 'date',
        ask: 'Şikâyet ettiğiniz durum hangi tarihte yaşandı?',
      },
      {
        name: 'daha_once',
        label: 'Daha önce destekle görüşüldü',
        type: 'boolean',
        ask: 'Bu konuda daha önce destek ekibimizle görüştünüz mü?',
      },
      {
        name: 'beklenen_cozum',
        label: 'Beklenen çözüm',
        type: 'text',
        ask: 'Bu şikâyetle nasıl bir çözüm bekliyorsunuz?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'ozet_sor', type: 'collect', slots: ['ozet'] },
      { id: 'tarih_sor', type: 'collect', slots: ['olay_tarihi'] },
      { id: 'gecmis_sor', type: 'collect', slots: ['daha_once'] },
      { id: 'cozum_sor', type: 'collect', slots: ['beklenen_cozum'] },
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'prosedur', type: 'say', template_key: 'sikayet_proseduru' },
      { id: 'sikayet_devir', type: 'handoff', reason_code: 'formal_complaint' },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Şikâyetinizi kayda alıp şikâyet ekibimize iletmek için birkaç bilgiye ihtiyacım var.',
      },
      {
        key: 'sikayet_proseduru',
        text: 'Şikâyetiniz resmi şikâyet prosedürümüze göre kayda alınır ve politikamıza göre genellikle {sikayet_suresi} içinde yanıtlanır. Bu süre içinde sonuçtan memnun kalmazsanız şikâyetinizi {adr_kurumu} kuruluşuna taşıyabilirsiniz. Şikâyetinizi şimdi şikâyet ekibimize iletiyorum.',
        verbatim: true,
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'complaint' },
      card_fields: ['ozet', 'olay_tarihi', 'daha_once', 'beklenen_cozum'],
      next_step_hint:
        'Şikâyeti kayda alın ve şikâyet prosedürünün süresi içinde yanıtlayın; sorumlu oyunla ilgiliyse sorumlu oyun ekibine bildirin.',
    },
    limits: { max_turns: 8 },
  },
  forbidden_phrases: [
    {
      phrase: 'haklısınız',
      match: 'word',
      why: 'Yapay zekâ şikâyeti karara bağlamaz (G15).',
    },
    {
      phrase: 'şikâyetinize gerek yok',
      match: 'word',
      why: 'Oyuncu resmi şikâyetten caydırılmaz (G15).',
    },
    {
      phrase: 'tazminat',
      match: 'exact',
      why: 'Yapay zekâ tazminat ya da çözüm sözü vermez (G7, G15).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'placeholder',
      key: 'sikayet_suresi',
      label: 'Şikâyet yanıt süresi (lisans koşulunuza göre)',
      example: '4 hafta',
    },
    {
      kind: 'placeholder',
      key: 'adr_kurumu',
      label: 'Alternatif uyuşmazlık çözüm (ADR) kuruluşunuzun adı ve iletişim bilgisi',
      example: 'lisans kurumunuzun onayladığı alternatif uyuşmazlık çözüm',
    },
    {
      kind: 'setting',
      setting: 'complaint',
      label:
        'Şikâyet prosedürü metni (AI-08 G15): şikâyet ve itirazlarda yapay zekânın verdiği resmi prosedür bilgisi.',
    },
  ],
  scenarios: [
    {
      key: 'resmi_sikayet',
      name: 'Resmi şikâyet — bilgiler alınır, prosedür verbatim söylenir, şikâyet ekibine',
      persona: 'kizgin',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'resmi şikâyette bulunmak istiyorum',
        'Çekimim üç haftadır ödenmedi',
        '01.10.2026',
        'evet',
        'Çekimimin ödenmesini istiyorum',
        'ahmet77',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'formal_complaint',
        topic: 'complaint',
        required_slots: ['ozet', 'olay_tarihi', 'daha_once', 'beklenen_cozum', 'kullanici_adi'],
        values: { kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'karar_itirazi',
      name: 'Hesap kapatma kararına itiraz — şikâyet ekibine',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'bu karara itiraz ediyorum',
        'Bonus kazancım haksız yere iptal edildi',
        'dün',
        'hayır',
        'Kazancımın iade edilmesini',
        'mehmet_34',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'formal_complaint',
        topic: 'complaint',
        required_slots: ['ozet', 'olay_tarihi', 'daha_once', 'beklenen_cozum', 'kullanici_adi'],
      },
    },
    {
      key: 'sikayet_yolu',
      name: 'Şikâyet yolunu soruyor — bilgiler alınır, şikâyet ekibine',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'şikayet nasıl yapılır',
        'Canlı destek sorumu yanıtlamadı',
        '15.10.2026',
        'evet',
        'Bir yetkilinin dönüş yapmasını',
        'ali_k',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'formal_complaint',
        topic: 'complaint',
        required_slots: ['ozet', 'olay_tarihi', 'daha_once', 'beklenen_cozum', 'kullanici_adi'],
      },
    },
  ],
};
