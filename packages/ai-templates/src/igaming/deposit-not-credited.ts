/**
 * "Para yatırdım hesabıma geçmedi" — research §3.1, the catalogue's worked
 * example, in full (tm 311.1 · AI-15).
 *
 * The flow (§3.1 "Akış" 1–8): empathy, then method and time; the elapsed time
 * against the method's expected time (pattern A: explain the wait); the
 * method's working hours (B: the next window); the site request and the
 * account it was sent to (C: no request, D: a different account or network);
 * the sender (third-party rule); the amount against the method's range; the
 * username and the evidence — reference or receipt, the network and TXID for a
 * crypto transfer; the passive `deposit_lookup` slot; and finance. Every path
 * that is not a wait ends with finance, after the facts finance needs are
 * collected; the wait ends `resolved_waiting` once the player confirms.
 *
 * The AI never says it checked anything (G8) or promises a time (G7): the
 * expected time comes from the tenant's payment-method table and is said with
 * "genellikle". The hand-over message itself, and the team's after-hours text,
 * are the engine's (AI-09 / AI-12 §4) — §3.1's "Devir" pattern is the
 * `devir` text the main path says before it.
 */
import type { AiTemplate } from '../catalogue.js';
import type { Cond } from '@siyahtus/types';

/**
 * A crypto method, by the name the tenant's table gives it. The table has no
 * "is crypto" column (AI-13), so the name decides; the checklist tells the
 * tenant to name crypto methods so.
 */
const CRYPTO_METHOD = 'USDT|[Uu]sdt|[Kk]ripto|[Cc]rypto|TRC20|ERC20|BEP20|BTC|[Bb]itcoin|[Tt]ether';

const crypto: Cond = { slot: { name: 'yontem', op: 'matches', value: CRYPTO_METHOD } };
const receiptRequired = (value: boolean): Cond => ({
  fact: { path: 'method.receipt_required', op: 'eq', value },
});

export const DEPOSIT_NOT_CREDITED: AiTemplate = {
  key: 'deposit_not_credited',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Yatırım hesaba geçmedi',
  summary:
    'Oyuncu yatırımının bakiyesine yansımadığını söylediğinde yöntemi ve saati sorar; normal süre içindeyse beklemeyi açıklar, değilse talep, gönderen, tutar ve dekont bilgilerini toplayıp finans ekibine devreder.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu yaptığı bir yatırımın (havale/EFT/FAST, Papara, kripto vb.) hesabına ya da bakiyesine geçmediğini söylüyor.',
    examples: [
      'param yatmadı',
      'yatırım yaptım bakiyem gelmedi',
      'havale attım gözükmüyor',
      'papara ile yatırdım düşmedi',
      'usdt gönderdim gelmedi',
      'eft yaptım hesabıma geçmedi',
      'fast ile gönderdim bakiyeye yansımadı',
      'yatırımım hesabıma geçmedi',
      'para yatırdım ama bakiyede görünmüyor',
      'my deposit has not arrived',
      'I deposited but my balance did not update',
    ],
    priority: 50,
    slots: [
      {
        name: 'kullanici_adi',
        label: 'Kullanıcı adı / üye no',
        type: 'username',
        ask: 'Sitedeki kullanıcı adınızı ya da üye numaranızı yazar mısınız?',
        pii: 'low',
      },
      {
        name: 'yontem',
        label: 'Ödeme yöntemi',
        type: 'enum',
        ask: 'Hangi yöntemle yatırım yaptınız?',
        validate: { enum_source: 'payment_methods.deposit' },
      },
      {
        name: 'islem_zamani',
        label: 'İşlem zamanı',
        type: 'datetime',
        ask: 'İşlemi saat kaçta yaptınız?',
        ask_variants: ['Yatırımı hangi gün ve yaklaşık saat kaçta yaptınız?'],
      },
      {
        name: 'talep_olusturuldu',
        label: 'Sitede talep oluşturuldu',
        type: 'boolean',
        ask: 'Göndermeden önce site üzerinden yatırım talebi oluşturdunuz mu?',
      },
      {
        name: 'gosterilen_hesap',
        label: 'Gösterilen hesaba gönderildi',
        type: 'boolean',
        ask: 'Gönderimi size o talepte gösterilen hesap bilgisine mi yaptınız?',
      },
      {
        name: 'gonderen_kendisi',
        label: 'Gönderen kendisi',
        type: 'boolean',
        ask: 'Gönderim kendi adınıza kayıtlı bir hesaptan mı yapıldı?',
      },
      {
        name: 'tutar',
        label: 'Tutar',
        type: 'money',
        ask: 'Ne kadar yatırdınız?',
      },
      {
        name: 'referans',
        label: 'İşlem / referans no',
        type: 'reference_code',
        ask: 'İşlemin referans ya da işlem numarasını paylaşır mısınız?',
        required: { when: { all: [{ not: crypto }, receiptRequired(false)] } },
      },
      {
        name: 'dekont',
        label: 'Dekont',
        type: 'file',
        ask: 'Dekontu ya da işlemin ekran görüntüsünü buraya ekleyebilir misiniz?',
        required: { when: { all: [{ not: crypto }, receiptRequired(true)] } },
      },
      {
        name: 'kripto_agi',
        label: 'Kripto ağı',
        type: 'crypto_network',
        ask: 'Gönderimi hangi ağ üzerinden yaptınız (ör. TRC20, ERC20, BEP20)?',
        required: { when: crypto },
      },
      {
        name: 'txid',
        label: 'TXID',
        type: 'txid',
        ask: 'İşlemin TXID (işlem kimliği) bilgisini paylaşır mısınız?',
        validate: { network_aware: true },
        required: { when: crypto },
      },
      {
        name: 'iban_son4',
        label: 'Gönderilen hesap (son 4 hane)',
        type: 'iban_last4',
        ask: "Gönderim yaptığınız IBAN'ın yalnızca son 4 hanesini yazar mısınız?",
        required: { when: { not: crypto } },
      },
    ],
    steps: [
      // 1. Empathy and scope; 2. method and time.
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'yontem_zaman', type: 'collect', slots: ['yontem', 'islem_zamani'] },
      // 3. Still within the method's expected time (A), or made outside its hours (B).
      {
        id: 'sure_icinde',
        type: 'check',
        when: {
          fn: {
            name: 'elapsed_minutes',
            args: ['islem_zamani'],
            op: 'lt',
            value: { fact: 'method.expected_minutes' },
          },
        },
        then: { goto: 'bekleme' },
      },
      {
        id: 'mesai_disi',
        type: 'check',
        when: { not: { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } } },
        then: { goto: 'mesai' },
      },
      // 4. The site request (C) and the account shown in it (D).
      { id: 'surec', type: 'collect', slots: ['talep_olusturuldu', 'gosterilen_hesap'] },
      {
        id: 'talep_yok',
        type: 'check',
        when: { slot: { name: 'talep_olusturuldu', op: 'eq', value: false } },
        then: { goto: 'talep_bilgi' },
      },
      {
        id: 'farkli_hesap',
        type: 'check',
        when: { slot: { name: 'gosterilen_hesap', op: 'eq', value: false } },
        then: { goto: 'yanlis_hesap_bilgi' },
      },
      // 5. The sender: a third party's account is finance's to look at.
      { id: 'kimlik', type: 'collect', slots: ['gonderen_kendisi'] },
      {
        id: 'ucuncu_kisi',
        type: 'check',
        when: { slot: { name: 'gonderen_kendisi', op: 'eq', value: false } },
        then: { goto: 'ucuncu_kisi_bilgi' },
      },
      // 6. The amount against the method's range.
      { id: 'tutar_sor', type: 'collect', slots: ['tutar'] },
      {
        id: 'tutar_disi',
        type: 'check',
        when: {
          any: [
            { slot: { name: 'tutar', op: 'lt', value: { fact: 'method.min_amount' } } },
            { slot: { name: 'tutar', op: 'gt', value: { fact: 'method.max_amount' } } },
          ],
        },
        then: { goto: 'tutar_kullanici' },
      },
      // 7. Who, and the evidence — never a card number or a password.
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'kanit_uyari', type: 'say', template_key: 'kanit' },
      { id: 'kanit', type: 'collect', slots: ['referans', 'dekont'] },
      { id: 'kripto_kanit', type: 'collect', slots: ['kripto_agi', 'txid'] },
      // The future lookup (AI-28): passive in F1, skipped and logged.
      {
        id: 'yatirim_sorgula',
        type: 'tool',
        tool_key: 'deposit_lookup',
        inputs: { user_id: 'kullanici_adi', amount: 'tutar', time: 'islem_zamani' },
        active: false,
      },
      // 8. Not a wait: finance.
      { id: 'finans_kalibi', type: 'say', template_key: 'devir' },
      { id: 'finansa_devir', type: 'handoff', reason_code: 'expected_time_exceeded' },

      // C — no site request: the facts, then finance matches the transfer.
      { id: 'talep_bilgi', type: 'collect', slots: ['tutar', 'kullanici_adi'] },
      { id: 'talep_kanit_uyari', type: 'say', template_key: 'kanit' },
      { id: 'talep_kanit', type: 'collect', slots: ['referans', 'dekont'] },
      { id: 'talep_kalibi', type: 'say', template_key: 'talep_yok' },
      { id: 'talep_devir', type: 'handoff', reason_code: 'no_site_request' },

      // D — a different or old account, or the wrong network.
      { id: 'yanlis_hesap_bilgi', type: 'collect', slots: ['iban_son4', 'kripto_agi'] },
      { id: 'yanlis_hesap_tutar', type: 'collect', slots: ['tutar', 'kullanici_adi'] },
      { id: 'yanlis_hesap_kanit', type: 'collect', slots: ['txid', 'referans'] },
      { id: 'yanlis_hesap_kalibi', type: 'say', template_key: 'yanlis_hesap' },
      { id: 'yanlis_hesap_devir', type: 'handoff', reason_code: 'wrong_account_or_network' },

      // Sent from someone else's account.
      { id: 'ucuncu_kisi_bilgi', type: 'collect', slots: ['tutar', 'kullanici_adi'] },
      { id: 'ucuncu_kisi_kalibi', type: 'say', template_key: 'ucuncu_kisi' },
      { id: 'ucuncu_kisi_devir', type: 'handoff', reason_code: 'third_party_payment' },

      // Below the method's minimum or above its maximum: a refund or a manual credit.
      { id: 'tutar_kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'tutar_kalibi', type: 'say', template_key: 'tutar_araligi' },
      { id: 'tutar_devir', type: 'handoff', reason_code: 'amount_out_of_range' },

      // A — within the expected time: the wait, and what to do if it runs out.
      { id: 'bekleme', type: 'say', template_key: 'normal_sure' },
      {
        id: 'bekleme_bitti',
        type: 'resolve',
        outcome: 'resolved_waiting',
        followup_template: 'takip',
      },

      // B — outside the method's hours: the next window.
      { id: 'mesai', type: 'say', template_key: 'mesai_disi' },
      {
        id: 'mesai_bitti',
        type: 'resolve',
        outcome: 'resolved_waiting',
        followup_template: 'takip_mesai',
      },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Yaşadığınız durumu anlıyorum, hemen birlikte bakalım. Birkaç bilgiye ihtiyacım var.',
      },
      {
        key: 'normal_sure',
        text: '{yontem} ile yapılan yatırımlar genellikle {method.expected_minutes} içinde hesaba yansır. İşleminiz {elapsed_minutes(islem_zamani)} önce yapılmış, yani hâlâ normal süre içinde.',
      },
      {
        key: 'takip',
        text: '{method.expected_minutes} dolduğunda bakiye hâlâ görünmezse bu sohbete yazın; dekontunuzla birlikte finans ekibimize iletelim.',
      },
      {
        key: 'mesai_disi',
        text: '{yontem} işlemleri genellikle {method.working_hours} arasında işlenir. Bu saatlerin dışında yapılan işlemler bir sonraki işlem penceresinde ({next_window(method)}) değerlendirilir.',
      },
      {
        key: 'takip_mesai',
        text: 'İşlem penceresi açıldıktan sonra bakiye hâlâ görünmezse bu sohbete yazın; dekontunuzla birlikte finans ekibimize iletelim.',
      },
      {
        key: 'kanit',
        text: 'Kart numaranızı, şifrenizi ya da size gelen kodları kimseyle paylaşmayın. Dekont paylaşacaksanız üzerindeki hesap numarasının ilk hanelerini kapatabilirsiniz.',
      },
      {
        key: 'talep_yok',
        text: 'Bu yöntemle gönderimden önce site üzerinden yatırım talebi oluşturulması gerekiyor. Gönderiminizin eşleştirilebilmesi için bilgilerinizi finans ekibimize iletiyorum.',
      },
      {
        key: 'yanlis_hesap',
        text: 'Gönderimin farklı bir hesaba ya da ağa yapılmış olma ihtimali var. Bu tür işlemlerin geri alınması her zaman mümkün olmayabilir; bilgilerinizi inceleme için finans ekibimize iletiyorum.',
      },
      {
        key: 'ucuncu_kisi',
        text: 'Politikamıza göre yatırımların sitedeki adınıza kayıtlı bir hesaptan yapılması gerekiyor. Başka bir kişinin hesabından yapılan gönderimleri finans ekibimiz inceliyor; bilgilerinizi onlara iletiyorum.',
      },
      {
        key: 'tutar_araligi',
        text: '{yontem} ile yatırım tutarı genellikle {method.min_amount} ile {method.max_amount} arasında olmalıdır. Bu aralığın dışındaki işlemler için iade ya da elle işlem gerekebileceğinden bilgilerinizi finans ekibimize iletiyorum.',
      },
      {
        key: 'devir',
        text: 'Bilgilerinizi finans ekibimize iletiyorum. Bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [
        {
          ai: {
            question:
              'Oyuncu aynı yatırım için daha önce de yazdığını ya da bunun tekrar eden bir şikâyet olduğunu söylüyor mu?',
          },
        },
      ],
      target: { topic: 'finance' },
      card_fields: ['method.expected_minutes', 'elapsed_minutes(islem_zamani)'],
      next_step_hint: '{yontem} referansıyla ödeme sağlayıcısının panelinde eşleştirme yapın.',
    },
    limits: { max_turns: 12 },
  },
  forbidden_phrases: [
    {
      phrase: 'hesabınıza geçti',
      match: 'word',
      why: 'Yapay zekâ hesabı göremez; geçti ya da geçmedi diyemez (G8).',
    },
    {
      phrase: 'kontrol ettim',
      match: 'word',
      why: 'Yapay zekâ hiçbir sistemi kontrol etmez (G8).',
    },
    {
      phrase: 'sistemde görünüyor',
      match: 'word',
      why: 'Doğrulanmış bilgi varmış gibi konuşmak yasak (G8).',
    },
    {
      phrase: '\\d{1,3} (dakika|saat)\\w{0,3} (yatar|gecer|yansir)',
      match: 'regex',
      why: '"5 dakikaya yatar" gibi süre sözü verilmez; süre "genellikle" ile söylenir (G7).',
    },
    {
      phrase: 'kesin geri al',
      match: 'exact',
      why: 'Yanlış hesaba gönderimde kurtarma sözü verilmez (G7).',
    },
    {
      phrase: 'tekrar yatır',
      match: 'exact',
      why: 'Mükerrer yatırım teşvik edilmez (G10).',
    },
    {
      phrase: 'bir daha yatır',
      match: 'exact',
      why: 'Mükerrer yatırım teşvik edilmez (G10).',
    },
  ],
  tenant_must_fill: [
    {
      kind: 'table',
      table: 'payment_methods.deposit',
      columns: [
        'method.expected_minutes',
        'method.working_hours',
        'method.min_amount',
        'method.max_amount',
        'method.receipt_required',
      ],
      label:
        'Yatırım yöntemleri tablosu: her yöntemin beklenen yansıma süresi, işlem saatleri, alt ve üst tutarı, dekont gerekip gerekmediği. Kripto yöntemlerinin adında USDT, kripto ya da ağ adı (TRC20, ERC20, BEP20) geçmeli; ağ ve TXID yalnız onlarda sorulur.',
    },
  ],
  scenarios: [
    {
      key: 'normal_sure_bekleme',
      name: 'Papara, 10 dakika önce — normal süre içinde, bekleme açıklanır',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['param yatmadı', 'Papara 13:40', 'evet'],
      facts: paparaRow(),
      options: { yontem: depositMethods() },
      expect: {
        outcome: 'resolved_waiting',
        required_slots: ['yontem', 'islem_zamani'],
        values: { yontem: 'Papara' },
      },
    },
    {
      key: 'mesai_disi_havale',
      name: 'Havale/EFT mesai dışında — bir sonraki işlem penceresi söylenir',
      persona: 'normal',
      simulated_now: '2026-10-18T22:30:00+03:00',
      turns: ['eft yaptım hesaba geçmedi', 'havale ile, 21:00', 'evet'],
      facts: havaleRow(),
      options: { yontem: depositMethods() },
      within_working_hours: false,
      next_window: '2026-10-19T09:00:00+03:00',
      expect: {
        outcome: 'resolved_waiting',
        required_slots: ['yontem', 'islem_zamani'],
        values: { yontem: 'Havale' },
      },
    },
    {
      key: 'sure_asildi_finans',
      name: 'Beklenen süre aşıldı — tüm bilgiler toplanır, finansa devredilir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'yatırım yaptım bakiyem gelmedi',
        'Papara, 12:00',
        'evet',
        'evet kendi hesabımdan',
        '2.500 TL',
        'ahmet77',
        'PPR12345',
      ],
      facts: paparaRow(),
      options: { yontem: depositMethods() },
      expect: {
        outcome: 'handoff',
        reason_code: 'expected_time_exceeded',
        topic: 'finance',
        required_slots: [
          'yontem',
          'islem_zamani',
          'talep_olusturuldu',
          'gosterilen_hesap',
          'gonderen_kendisi',
          'tutar',
          'kullanici_adi',
          'referans',
        ],
        values: {
          yontem: 'Papara',
          islem_zamani: '18.10.2026 12:00',
          tutar: '2.500 TRY',
          kullanici_adi: 'ahmet77',
          referans: 'PPR12345',
        },
      },
    },
    {
      key: 'talep_olusturulmamis',
      name: 'Sitede talep oluşturulmadan gönderim — bilgiler toplanır, finans eşleştirir',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'havale attım gözükmüyor',
        'havale, 12:00',
        'hayır oluşturmadım',
        '2.500 TL',
        'ahmet77',
        'REF12345',
      ],
      facts: havaleRow(),
      options: { yontem: depositMethods() },
      expect: {
        outcome: 'handoff',
        reason_code: 'no_site_request',
        topic: 'finance',
        required_slots: [
          'yontem',
          'islem_zamani',
          'talep_olusturuldu',
          'tutar',
          'kullanici_adi',
          'referans',
        ],
        values: {
          yontem: 'Havale',
          tutar: '2.500 TRY',
          kullanici_adi: 'ahmet77',
          referans: 'REF12345',
        },
      },
    },
    {
      key: 'ucuncu_kisi_odemesi',
      name: 'Başka birinin hesabından gönderim — kural anlatılır, finansa devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['param yatmadı', 'Papara, 12:00', 'evet', 'hayır', '2.500 TL', 'ahmet77'],
      facts: paparaRow(),
      options: { yontem: depositMethods() },
      expect: {
        outcome: 'handoff',
        reason_code: 'third_party_payment',
        topic: 'finance',
        required_slots: ['yontem', 'islem_zamani', 'gonderen_kendisi', 'tutar', 'kullanici_adi'],
        values: { yontem: 'Papara', tutar: '2.500 TRY', kullanici_adi: 'ahmet77' },
      },
    },
  ],
  card_example: [
    'Niyet: Yatırım hesaba geçmedi',
    'Oyuncu: kullanıcı adı "ali123" (oyuncu beyanı, doğrulanmadı)',
    'Yöntem: Papara | Tutar: 2.500 TRY | Zaman: 14.10.2026 13:42 (geçen süre 95 dk; beklenen ≤30 dk)',
    'Talep oluşturuldu: Evet | Gönderen kendisi: Evet | Gönderilen hesap: sitede gösterilen (oyuncu beyanı)',
    'Referans/TXID: PPR-...-8841 | Dekont: Ekli (1 görsel)',
    'Yapay zekânın verdiği bilgi: normal süre ve takip; söz verilmedi',
    'Devir nedeni: Beklenen süre aşıldı + dekont mevcut',
    'Risk/duygu: Hafif sabırsız; sorumlu oyun sinyali yok',
    'Önerilen adım: Papara referansı ile ödeme sağlayıcı panelinde eşleştirme',
  ].join('\n'),
};

/** "Örnek — doğrulayın" rows the scenarios run on; the tenant's own table replaces them. */
function paparaRow(): AiTemplate['scenarios'][number]['facts'] {
  return {
    'method.name': 'Papara',
    'method.expected_minutes': 30,
    'method.working_hours': '7/24',
    'method.min_amount': 100,
    'method.max_amount': 50000,
    'method.receipt_required': false,
  };
}

function havaleRow(): AiTemplate['scenarios'][number]['facts'] {
  return {
    'method.name': 'Havale',
    'method.expected_minutes': 20,
    'method.working_hours': '09:00–17:30',
    'method.min_amount': 100,
    'method.max_amount': 100000,
    'method.receipt_required': false,
  };
}

function depositMethods(): Array<{ value: string; aliases?: string[] }> {
  return [
    { value: 'Papara' },
    { value: 'Havale', aliases: ['eft', 'fast'] },
    { value: 'USDT (TRC20)', aliases: ['usdt', 'tether'] },
  ];
}
