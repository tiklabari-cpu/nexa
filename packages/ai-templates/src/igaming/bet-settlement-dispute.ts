/**
 * "Bahsim yanlış sonuçlandı" — research §3 row 7 (tm 311.2 · AI-15).
 *
 * Every settlement dispute is recorded and reviewed by people: the AI
 * collects the coupon, the event, the selection and what the player expected,
 * explains the general rules (void, postponed events, extra time) "politikamıza
 * göre", and hands over. It never promises to change a result (G7) and never
 * suggests a bet (G9). Trading is not a queue role; the dispute goes to the
 * risk team's queue (`kyc_risk`), which the tenant may map to its trading desk.
 */
import type { AiTemplate } from '../catalogue.js';
import { unverifiedStatusPhrases } from './shared.js';

export const BET_SETTLEMENT_DISPUTE: AiTemplate = {
  key: 'bet_settlement_dispute',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Bahis sonuçlandırma itirazı',
  summary:
    'Oyuncu bir kuponun yanlış sonuçlandığını söylediğinde kupon numarasını, etkinliği, seçimi ve beklediği sonucu toplar, genel sonuçlandırma kurallarını anlatır ve itirazı inceleme için ekibe devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu bir bahsin ya da kuponun yanlış sonuçlandırıldığını, kaybetmiş sayıldığını, iptal edildiğini ya da ödenmediğini söyleyip itiraz ediyor.',
    examples: [
      'kuponum yanlış sonuçlandı',
      'bahsim yanlış sonuçlandırıldı',
      'kazandığım kupon kaybetti görünüyor',
      'maç ertelendi kuponum ne olacak',
      'bahsim iptal edildi itiraz ediyorum',
      'my bet was settled wrong',
    ],
    priority: 60,
    slots: [
      {
        name: 'kupon_no',
        label: 'Kupon numarası',
        type: 'reference_code',
        ask: 'İtiraz ettiğiniz kuponun numarasını yazar mısınız?',
      },
      {
        name: 'etkinlik',
        label: 'Maç / etkinlik',
        type: 'text',
        ask: 'Hangi maç ya da etkinlik için itiraz ediyorsunuz?',
      },
      {
        name: 'secim',
        label: 'Seçim',
        type: 'text',
        ask: 'Kuponda bu etkinlik için hangi seçimi yapmıştınız?',
      },
      {
        name: 'beklenen',
        label: 'Oyuncunun beklediği sonuç',
        type: 'text',
        ask: 'Sizce kupon nasıl sonuçlanmalıydı, neden yanlış olduğunu düşünüyorsunuz?',
      },
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'kupon', type: 'collect', slots: ['kupon_no'] },
      { id: 'etkinlik_sor', type: 'collect', slots: ['etkinlik'] },
      { id: 'secim_sor', type: 'collect', slots: ['secim'] },
      { id: 'beklenen_sor', type: 'collect', slots: ['beklenen'] },
      { id: 'kurallar', type: 'say', template_key: 'genel_kurallar' },
      { id: 'inceleme_kalibi', type: 'say', template_key: 'devir' },
      { id: 'inceleme_devir', type: 'handoff', reason_code: 'settlement_review' },
    ],
    templates: [
      {
        key: 'giris',
        text: 'İtirazınızı kayda alıp inceleme ekibimize iletmek için birkaç bilgiye ihtiyacım var.',
      },
      {
        key: 'genel_kurallar',
        text: 'Politikamıza göre ertelenen ya da iptal edilen etkinliklerdeki seçimler genellikle iptal (void) sayılır ve oran 1,00 olarak hesaplanır; aksi yazmıyorsa sonuçlar normal süreye göre belirlenir, uzatma ve penaltılar dahil edilmez. Kesin değerlendirmeyi bahis kurallarına göre ekibimiz yapar.',
      },
      {
        key: 'devir',
        text: 'Bilgilerinizi inceleme ekibimize iletiyorum; itirazınızın sonucunu bir uzman bu sohbet üzerinden size bildirecek.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'kyc_risk' },
      card_fields: ['kupon_no', 'etkinlik', 'secim', 'beklenen'],
      next_step_hint:
        '{kupon_no} numaralı kuponun sonuçlandırmasını bahis kurallarıyla karşılaştırın.',
    },
    limits: { max_turns: 8 },
  },
  forbidden_phrases: [
    ...unverifiedStatusPhrases(),
    {
      phrase: 'sonucu düzelteceğiz',
      match: 'word',
      why: 'Sonucu değiştirme sözü verilmez (G7).',
    },
    {
      phrase: 'kuponunuz kazanmış',
      match: 'word',
      why: 'Yapay zekâ kuponun sonucunu yorumlamaz.',
    },
    {
      phrase: 'paranız iade edilecek',
      match: 'word',
      why: 'İade sözü verilmez (G7).',
    },
  ],
  tenant_must_fill: [],
  scenarios: [
    {
      key: 'yanlis_sonuc',
      name: 'Kazanan seçim kaybetti sayılmış — bilgiler toplanır, incelemeye devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'kuponum yanlış sonuçlandı',
        'KPN-458812',
        'Galatasaray - Fenerbahçe',
        'maç sonucu 1',
        'Maç 2-1 bitti, kazanmam gerekiyordu',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'settlement_review',
        topic: 'kyc_risk',
        required_slots: ['kupon_no', 'etkinlik', 'secim', 'beklenen'],
        values: { kupon_no: 'KPN-458812', etkinlik: 'Galatasaray - Fenerbahçe' },
      },
    },
    {
      key: 'ertelenen_mac',
      name: 'Ertelenen maç — iptal kuralı anlatılır, incelemeye devredilir',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'maç ertelendi kuponum ne olacak',
        '99112233',
        'Beşiktaş - Trabzonspor',
        'karşılıklı gol var',
        'Maç ertelendi ama kuponum kaybetti görünüyor',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'settlement_review',
        topic: 'kyc_risk',
        required_slots: ['kupon_no', 'etkinlik', 'secim', 'beklenen'],
        values: { kupon_no: '99112233' },
      },
    },
    {
      key: 'uzatma_itirazi',
      name: 'Uzatmadaki gol sayılmamış — incelemeye devredilir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'bahsim yanlış sonuçlandırıldı',
        'C-7731',
        'Türkiye - İtalya',
        'Türkiye kazanır',
        'Uzatmada gol attık, kupon kazanmalıydı',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'settlement_review',
        topic: 'kyc_risk',
        required_slots: ['kupon_no', 'etkinlik', 'secim', 'beklenen'],
      },
    },
  ],
};
