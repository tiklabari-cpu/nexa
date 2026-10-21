/**
 * Sorumlu oyun sinyali — chasing losses, debt, "maaşımı yatırdım", despair —
 * research §3 row 12, guardrail G2 (tm 311.2 · AI-15). Locked (AI-15-S2).
 *
 * Not a diagnosis and not a conversation to keep: an empathetic
 * acknowledgement, the limit tools and the tenant's help resources, then the
 * responsible gambling team in the same turn. Nothing is collected, nothing
 * about bonuses, promotions or depositing is said (G4 — the template is held
 * to it), no time is promised. Self-harm is G3's — the crisis text goes out
 * before any procedure (the `crisis` setting on the checklist).
 *
 * The key is spelt with ADR-08a's queue role (`responsible_gambling`), not the
 * analysis' `responsible_gaming` (ADR `ai-template-catalog.md` §3.2).
 */
import type { AiTemplate } from '../catalogue.js';

export const RESPONSIBLE_GAMBLING_SIGNAL: AiTemplate = {
  key: 'responsible_gambling_signal',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Sorumlu oyun sinyali',
  summary:
    'Oyuncu kayıp kovaladığını, borçla oynadığını, maaşını yatırdığını ya da kontrolü kaybettiğini söylediğinde empatiyle karşılık verir, limit araçlarını ve yardım kaynaklarını paylaşır ve aynı turda sorumlu oyun ekibine devreder. Kilitlidir; kapatılamaz.',
  locked: true,
  procedure: {
    when_to_use:
      'Oyuncu kaybını geri kazanmaya çalıştığını, borçla ya da krediyle oynadığını, maaşını veya kirasını yatırdığını, her şeyini kaybettiğini, kendini durduramadığını ya da çaresiz hissettiğini söylüyor.',
    examples: [
      'kaybımı geri almam lazım',
      'maaşımı yatırdım hepsini kaybettim',
      'borç alarak oynadım',
      'her şeyimi kaybettim',
      'kendimi durduramıyorum',
      'kredi çekip yatırdım',
      'kiramı kaybettim',
      'I need to win my money back',
      'I lost my whole salary',
    ],
    priority: 2,
    slots: [],
    steps: [
      { id: 'destek', type: 'say', template_key: 'empati' },
      { id: 'isaretle', type: 'tag', tag: 'rg_signal' },
      { id: 'sorumlu_oyun_devir', type: 'handoff', reason_code: 'rg_signal' },
    ],
    templates: [
      {
        key: 'empati',
        text: 'Bunu paylaştığınız için teşekkür ederim; yaşadığınız durumun zor olduğunu anlıyorum. Hesabınızdaki yatırım, kayıp ve oturum limitleriyle ara verme araçları kendinizi korumanıza yardımcı olabilir. Destek almak isterseniz şu kaynaklara başvurabilirsiniz: {yardim_kaynaklari}. Sizi şimdi sorumlu oyun ekibimizden bir uzmana aktarıyorum.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'responsible_gambling' },
      card_fields: [],
      next_step_hint:
        'Oyuncuyla sorumlu oyun politikasına göre hassas bir görüşme yürütün; limit ve ara verme seçeneklerini anlatın, promosyon önermeyin.',
    },
    limits: { max_turns: 3 },
  },
  forbidden_phrases: [
    {
      phrase: 'şansınız dönebilir',
      match: 'word',
      why: 'Kayıp kovalamayı teşvik eden ifade yasak (G2, G9).',
    },
    {
      phrase: 'geri kazanabilirsiniz',
      match: 'word',
      why: 'Kayıp kovalamayı teşvik eden ifade yasak (G2, G9).',
    },
    {
      phrase: 'sorununuz yok',
      match: 'word',
      why: 'Yapay zekâ teşhis koymaz ve durumu küçümsemez (G2).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'placeholder',
      key: 'yardim_kaynaklari',
      label: 'Sorumlu oyun yardım kaynakları (danışma hattı, kurum, sayfa bağlantısı)',
      example: 'YEDAM danışma hattı 115 ve sorumlu oyun sayfamız (Hesabım › Sorumlu Oyun)',
    },
    {
      kind: 'setting',
      setting: 'crisis',
      label:
        'Kriz metni (AI-08 G3): kendine zarar ifadesinde her saatte, devirden önce olduğu gibi gönderilir.',
    },
  ],
  scenarios: [
    {
      key: 'kayip_kovalama',
      name: 'Kayıp kovalama — empati, limit araçları, aynı turda sorumlu oyun ekibine',
      persona: 'sorumlu_oyun_sinyali',
      simulated_now: '2026-10-18T23:40:00+03:00',
      turns: ['kaybımı geri almam lazım'],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'rg_signal',
        topic: 'responsible_gambling',
        required_slots: [],
        forbidden_phrases: ['bonus', 'kampanya', 'yatırın'],
      },
    },
    {
      key: 'maas_yatirdi',
      name: 'Maaşını yatırıp kaybetti — aynı turda sorumlu oyun ekibine',
      persona: 'sorumlu_oyun_sinyali',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['maaşımı yatırdım hepsini kaybettim'],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'rg_signal',
        topic: 'responsible_gambling',
        required_slots: [],
      },
    },
    {
      key: 'borcla_oyun',
      name: 'Borç alarak oynadı — aynı turda sorumlu oyun ekibine',
      persona: 'sorumlu_oyun_sinyali',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['borç alarak oynadım'],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'rg_signal',
        topic: 'responsible_gambling',
        required_slots: [],
      },
    },
  ],
};
