/**
 * "Oyun dondu / bakiyem düştü" — research §3 row 8 (tm 311.2 · AI-15).
 *
 * Which game and provider, when, and whether balance went missing. A balance
 * loss is never settled by the AI: whether the round shows in the game history
 * goes on the card and the technical team takes it (a provider ticket). No
 * loss: the basic steps — clear the cache, another browser, the game history,
 * the provider usually completing an interrupted round — and whether the game
 * opens now; still failing, the device, and the technical team.
 */
import type { AiTemplate } from '../catalogue.js';
import { usernameSlot } from './shared.js';

export const GAME_TECHNICAL_ISSUE: AiTemplate = {
  key: 'game_technical_issue',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Oyun ya da slot teknik sorunu',
  summary:
    'Oyuncu bir oyunun donduğunu, açılmadığını ya da oyun sırasında bakiyesinin düştüğünü söylediğinde oyunu, zamanı ve bakiye kaybını sorar; temel adımları anlatır, bakiye kaybında ya da süren sorunda teknik ekibe devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu bir casino oyununun, slotun ya da canlı oyunun donduğunu, açılmadığını, hata verdiğini ya da oyun sırasında bakiyesinin düştüğünü söylüyor.',
    examples: [
      'oyun dondu',
      'slot oyunu açılmıyor',
      'oyun dondu bakiyem düştü',
      'canlı casino takıldı',
      'oyun hata veriyor',
      'spin attım oyun kapandı',
      'the game froze',
    ],
    priority: 60,
    slots: [
      {
        name: 'oyun',
        label: 'Oyun / sağlayıcı',
        type: 'text',
        ask: 'Sorun hangi oyunda oldu? Biliyorsanız oyun sağlayıcısını da yazar mısınız?',
      },
      {
        name: 'olay_zamani',
        label: 'Sorunun zamanı',
        type: 'datetime',
        ask: 'Sorun saat kaçta yaşandı?',
      },
      {
        name: 'bakiye_kaybi',
        label: 'Bakiye kaybı',
        type: 'boolean',
        ask: 'Bu sırada bakiyenizden düşen ve geri gelmeyen bir tutar oldu mu?',
      },
      {
        name: 'gecmiste_gorunuyor',
        label: 'Oyun geçmişinde görünüyor',
        type: 'boolean',
        ask: 'Oyun geçmişinizde bu el ya da tur görünüyor mu?',
      },
      {
        name: 'acildi',
        label: 'Adımlardan sonra açıldı',
        type: 'boolean',
        ask: 'Bu adımlardan sonra oyun açılıp sorunsuz çalışıyor mu?',
      },
      {
        name: 'cihaz',
        label: 'Cihaz / tarayıcı',
        type: 'text',
        ask: 'Hangi cihazı ve tarayıcıyı ya da uygulamayı kullanıyorsunuz?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'oyun_sor', type: 'collect', slots: ['oyun'] },
      { id: 'zaman_sor', type: 'collect', slots: ['olay_zamani'] },
      { id: 'kayip_sor', type: 'collect', slots: ['bakiye_kaybi'] },
      {
        id: 'bakiye_dustu',
        type: 'check',
        when: { slot: { name: 'bakiye_kaybi', op: 'eq', value: true } },
        then: { goto: 'kayip_gecmis' },
      },
      { id: 'adimlar', type: 'say', template_key: 'temel_adimlar' },
      { id: 'sonuc_sor', type: 'collect', slots: ['acildi'] },
      {
        id: 'hala_sorun',
        type: 'check',
        when: { slot: { name: 'acildi', op: 'eq', value: false } },
        then: { goto: 'cihaz_sor' },
      },
      // Solved by the player's own yes (the procedure's criterion): the closing line goes with it.
      { id: 'cozuldu', type: 'resolve', outcome: 'resolved', followup_template: 'kapanis' },

      { id: 'cihaz_sor', type: 'collect', slots: ['cihaz'] },
      { id: 'teknik_kalibi', type: 'say', template_key: 'devir' },
      { id: 'teknik_devir', type: 'handoff', reason_code: 'technical_issue_persists' },

      { id: 'kayip_gecmis', type: 'collect', slots: ['gecmiste_gorunuyor'] },
      { id: 'kayip_kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'kayip_kalibi', type: 'say', template_key: 'bakiye_kaybi' },
      { id: 'kayip_devir', type: 'handoff', reason_code: 'balance_dispute' },
    ],
    templates: [
      {
        key: 'temel_adimlar',
        text: 'Şunları deneyebilirsiniz: tarayıcınızın önbelleğini temizleyip sayfayı yenileyin, başka bir tarayıcıdan ya da cihazdan açmayı deneyin ve oyun geçmişinize bakın. Bağlantı koptuğunda yarım kalan turlar genellikle sağlayıcı tarafından tamamlanır ve sonucu oyun geçmişinde görünür.',
      },
      {
        key: 'kapanis',
        text: 'Sorunun çözülmesine sevindim. Oyun sırasında yeniden bir sorun yaşarsanız bu sohbete yazabilirsiniz.',
      },
      {
        key: 'bakiye_kaybi',
        text: 'Oyun sırasında düşen bakiyeyi teknik ekibimiz oyun sağlayıcısıyla birlikte inceliyor. Bilgilerinizi onlara iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
      {
        key: 'devir',
        text: 'Sorun sürdüğü için bilgilerinizi teknik ekibimize iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'technical' },
      card_fields: ['oyun', 'olay_zamani', 'bakiye_kaybi', 'gecmiste_gorunuyor', 'cihaz'],
      next_step_hint:
        '{oyun} için sağlayıcıda tur kaydını sorgulayın; gerekirse sağlayıcıya kayıt açın.',
    },
    limits: { max_turns: 10 },
    resolution_criteria: { slot: { name: 'acildi', op: 'eq', value: true } },
  },
  forbidden_phrases: [
    {
      phrase: 'bakiyeniz iade edildi',
      match: 'word',
      why: 'Yapay zekâ bakiye işlemi yapmaz, doğrulanmış bilgi varmış gibi konuşmaz (G8).',
    },
    {
      phrase: 'paranızı geri yüklerim',
      match: 'word',
      why: 'İade sözü verilmez (G7).',
    },
    {
      phrase: 'sağlayıcı hatası değil',
      match: 'word',
      why: 'Yapay zekâ nedeni bilemez; inceleme teknik ekibindir.',
    },
  ],
  tenant_must_fill: [],
  scenarios: [
    {
      key: 'bakiye_kaybi',
      name: 'Oyun dondu ve bakiye düştü — teknik ekibe devredilir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'oyun dondu bakiyem düştü',
        'Sweet Bonanza, Pragmatic Play',
        '13:20',
        'evet',
        'hayır görünmüyor',
        'ahmet77',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'balance_dispute',
        topic: 'technical',
        required_slots: [
          'oyun',
          'olay_zamani',
          'bakiye_kaybi',
          'gecmiste_gorunuyor',
          'kullanici_adi',
        ],
        values: { kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'adimlar_ise_yaradi',
      name: 'Oyun açılmıyordu, temel adımlarla düzeldi — çözüldü',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['slot oyunu açılmıyor', 'Gates of Olympus', '13:40', 'hayır', 'evet açıldı'],
      facts: {},
      expect: {
        outcome: 'resolved',
        required_slots: ['oyun', 'olay_zamani', 'bakiye_kaybi', 'acildi'],
      },
    },
    {
      key: 'sorun_suruyor',
      name: 'Adımlar işe yaramadı — cihaz bilgisi alınır, teknik ekibe devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'canlı casino takıldı',
        'Canlı rulet, Evolution',
        '13:00',
        'hayır',
        'hayır hâlâ açılmıyor',
        'iPhone, Safari',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'technical_issue_persists',
        topic: 'technical',
        required_slots: ['oyun', 'olay_zamani', 'bakiye_kaybi', 'acildi', 'cihaz'],
        values: { cihaz: 'iPhone, Safari' },
      },
    },
  ],
};
