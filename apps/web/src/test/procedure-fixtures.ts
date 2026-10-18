/**
 * Araştırma §3.1 "Para yatırdım hesabıma geçmedi" as a procedure skill stores
 * it — the AI-03 acceptance definition `packages/types/src/procedure.test.ts`
 * validates, split into the skill's own fields and its `procedure` body. The
 * editor's tests read it through the form and back out again: a definition
 * this rich (conditions the simple form cannot hold, a passive tool step, a
 * conditional `required`) is where a form loses things.
 */
import type { SkillProcedureFields } from '@siyahtus/types';

export function depositProcedureFields(): Required<SkillProcedureFields> {
  return {
    when_to_use: 'Oyuncu yaptığı yatırımın hesabına geçmediğini söylüyor.',
    examples: ['param yatmadı', 'havale attım gözükmüyor', 'usdt gönderdim gelmedi'],
    priority: 50,
    slots: [
      {
        name: 'kullanici_adi',
        label: 'Kullanıcı adı',
        type: 'username',
        ask: 'Kullanıcı adınızı yazar mısınız?',
      },
      {
        name: 'yontem',
        label: 'Ödeme yöntemi',
        type: 'enum',
        ask: 'Hangi yöntemle yatırım yaptınız?',
        validate: { enum_source: 'payment_methods.deposit' },
      },
      { name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar yatırdınız?' },
      {
        name: 'islem_zamani',
        label: 'İşlem zamanı',
        type: 'datetime',
        ask: 'Saat kaçta yatırdınız?',
      },
      {
        name: 'talep_olusturuldu',
        label: 'Site talebi',
        type: 'boolean',
        ask: 'Göndermeden önce site üzerinden yatırım talebi oluşturdunuz mu?',
      },
      {
        name: 'gonderen_kendisi',
        label: 'Gönderen kendisi',
        type: 'boolean',
        ask: 'Gönderim kendi adınıza kayıtlı hesaptan mı yapıldı?',
      },
      {
        name: 'referans',
        label: 'Referans no',
        type: 'reference_code',
        ask: 'İşlemin referans numarasını paylaşır mısınız?',
        required: { when: { fact: { path: 'method.receipt_required', op: 'eq', value: false } } },
      },
      {
        name: 'dekont',
        label: 'Dekont',
        type: 'file',
        ask: 'Dekontu ya da ekran görüntüsünü paylaşabilir misiniz?',
        required: { when: { fact: { path: 'method.receipt_required', op: 'eq', value: true } } },
      },
    ],
    procedure: {
      steps: [
        { id: 'karsilama', type: 'say', template_key: 'giris' },
        { id: 'yontem_zaman', type: 'collect', slots: ['yontem', 'islem_zamani'] },
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
        { id: 'surec', type: 'collect', slots: ['talep_olusturuldu', 'gonderen_kendisi'] },
        {
          id: 'talep_yok',
          type: 'check',
          when: { slot: { name: 'talep_olusturuldu', op: 'eq', value: false } },
          then: { goto: 'talep_kalibi' },
        },
        {
          id: 'ucuncu_kisi',
          type: 'check',
          when: { slot: { name: 'gonderen_kendisi', op: 'eq', value: false } },
          then: {
            type: 'handoff',
            reason_code: 'third_party_payment',
            instruction: 'Üçüncü kişi ödemesi kuralını kısaca anlat.',
          },
        },
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
          then: { type: 'handoff', reason_code: 'amount_out_of_range' },
        },
        { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
        { id: 'kanit', type: 'collect', slots: ['referans', 'dekont'] },
        {
          id: 'yatirim_sorgula',
          type: 'tool',
          tool_key: 'deposit_lookup',
          inputs: { user_id: 'kullanici_adi', amount: 'tutar', time: 'islem_zamani' },
          active: false,
        },
        { id: 'finansa_devir', type: 'handoff', reason_code: 'expected_time_exceeded' },
        { id: 'talep_kalibi', type: 'say', template_key: 'talep_yok' },
        { id: 'talep_devir', type: 'handoff', reason_code: 'no_site_request' },
        { id: 'bekleme', type: 'say', template_key: 'normal_sure' },
        {
          id: 'bekleme_bitti',
          type: 'resolve',
          outcome: 'resolved_waiting',
          followup_template: 'takip',
        },
        { id: 'mesai', type: 'say', template_key: 'mesai_disi' },
        { id: 'mesai_bitti', type: 'resolve', outcome: 'resolved_waiting' },
      ],
      templates: [
        { key: 'giris', text: 'Yaşadığınız durumu anlıyorum, hemen birlikte bakalım.' },
        {
          key: 'normal_sure',
          text: '{yontem} ile yapılan yatırımlar genellikle {method.expected_minutes} dakika içinde hesaba yansır. İşleminiz {elapsed_minutes(islem_zamani)} dakika önce yapılmış.',
        },
        {
          key: 'mesai_disi',
          text: '{yontem} işlemleri {method.working_hours} arasında işlenir ({next_window(method)}).',
        },
        {
          key: 'talep_yok',
          text: 'Gönderimden önce site üzerinden talep oluşturulması gerekiyor.',
        },
        {
          key: 'takip',
          text: '{method.expected_minutes} dakika dolduğunda bakiye görünmezse bu sohbete yazın.',
        },
      ],
      handoff: {
        conditions: [{ slot: { name: 'tutar', op: 'gt', value: 100000 } }],
        target: { topic: 'finance' },
        card_fields: ['method.expected_minutes', 'elapsed_minutes(islem_zamani)'],
        next_step_hint: '{yontem} referansı ile ödeme sağlayıcı panelinde eşleştirme.',
      },
      limits: { max_turns: 12 },
    },
  };
}
