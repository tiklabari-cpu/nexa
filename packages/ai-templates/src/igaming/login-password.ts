/**
 * "Giriş yapamıyorum / şifremi unuttum" — research §3 row 9 (tm 311.2 · AI-15).
 *
 * The error the player sees, then whether someone else may have got in — a
 * suspected takeover is the risk team's at once (G13). Otherwise the reset
 * link: not tried yet, its steps, and solved; tried, whether the registered
 * phone and e-mail are reachable — they are not: the technical team, who
 * verify the player another way. The password is never asked for in the chat
 * (G11); no slot text names it.
 */
import type { AiTemplate } from '../catalogue.js';
import { usernameSlot } from './shared.js';

export const LOGIN_PASSWORD: AiTemplate = {
  key: 'login_password',
  version: 1,
  industry: 'igaming',
  lang: 'tr',
  name: 'Giriş yapamıyorum / şifre',
  summary:
    'Oyuncu hesabına giriş yapamadığını ya da şifresini unuttuğunu söylediğinde hatayı sorar, sıfırlama adımlarını anlatır; hesabın ele geçirildiği şüphesinde risk ekibine, kayıtlı iletişim bilgilerine erişimi yoksa teknik ekibe devreder. Şifre sohbette asla istenmez.',
  locked: false,
  procedure: {
    when_to_use:
      'Oyuncu hesabına giriş yapamadığını, şifresini unuttuğunu, şifre sıfırlama mesajının gelmediğini ya da giriş sırasında hata aldığını söylüyor.',
    examples: [
      'giriş yapamıyorum',
      'şifremi unuttum',
      'hesabıma giremiyorum',
      'şifre hatalı diyor',
      'şifre sıfırlama maili gelmedi',
      'giriş yaparken hata alıyorum',
      'I cannot log in',
      'I forgot my password',
    ],
    priority: 60,
    slots: [
      {
        name: 'hata',
        label: 'Görülen hata',
        type: 'text',
        ask: 'Giriş yaparken ekranda hangi uyarı ya da hata mesajı çıkıyor?',
      },
      {
        name: 'baskasi_girmis',
        label: 'Başkası girmiş olabilir',
        type: 'boolean',
        ask: 'Hesabınıza sizden başka birinin girmiş olabileceğinden şüpheleniyor musunuz?',
      },
      {
        name: 'sifirlama_denendi',
        label: 'Sıfırlama bağlantısı denendi',
        type: 'boolean',
        ask: 'Giriş ekranındaki sıfırlama bağlantısını denediniz mi?',
      },
      {
        name: 'iletisim_erisimi',
        label: 'Kayıtlı telefon/e-postaya erişim',
        type: 'boolean',
        ask: 'Hesabınızda kayıtlı telefon numarasına ve e-posta adresine şu an erişiminiz var mı?',
      },
      usernameSlot(),
    ],
    steps: [
      { id: 'karsilama', type: 'say', template_key: 'giris' },
      { id: 'hata_sor', type: 'collect', slots: ['hata'] },
      { id: 'guvenlik_sor', type: 'collect', slots: ['baskasi_girmis'] },
      {
        id: 'ele_gecirme',
        type: 'check',
        when: { slot: { name: 'baskasi_girmis', op: 'eq', value: true } },
        then: { goto: 'guvenlik_bilgi' },
      },
      { id: 'sifirlama_sor', type: 'collect', slots: ['sifirlama_denendi'] },
      {
        id: 'denenmedi',
        type: 'check',
        when: { slot: { name: 'sifirlama_denendi', op: 'eq', value: false } },
        then: { goto: 'sifirlama' },
      },
      { id: 'iletisim_sor', type: 'collect', slots: ['iletisim_erisimi'] },
      {
        id: 'iletisim_yok',
        type: 'check',
        when: { slot: { name: 'iletisim_erisimi', op: 'eq', value: false } },
        then: { goto: 'iletisim_bilgi' },
      },
      // The link was tried and the contact details are reachable: a technical fault.
      { id: 'kullanici', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'teknik_kalibi', type: 'say', template_key: 'devir' },
      { id: 'teknik_devir', type: 'handoff', reason_code: 'login_issue_persists' },

      { id: 'sifirlama', type: 'say', template_key: 'sifirlama_adimlari' },
      { id: 'sifirlama_bitti', type: 'resolve', outcome: 'resolved' },

      { id: 'iletisim_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'iletisim_kalibi', type: 'say', template_key: 'iletisim_yok' },
      { id: 'iletisim_devir', type: 'handoff', reason_code: 'no_contact_access' },

      { id: 'guvenlik_bilgi', type: 'collect', slots: ['kullanici_adi'] },
      { id: 'guvenlik_kalibi', type: 'say', template_key: 'guvenlik' },
      {
        id: 'guvenlik_devir',
        type: 'handoff',
        reason_code: 'account_takeover_suspected',
        target: { topic: 'kyc_risk' },
      },
    ],
    templates: [
      {
        key: 'giris',
        text: 'Giriş sorununuzu birlikte çözmeye çalışalım. Güvenliğiniz için şifrenizi ya da size gelen kodları bu sohbette hiçbir zaman paylaşmayın.',
      },
      {
        key: 'sifirlama_adimlari',
        text: 'Giriş ekranındaki "Şifremi unuttum" bağlantısına tıklayıp kayıtlı e-posta adresinizi ya da telefon numaranızı girin; gelen bağlantıyla yeni bir şifre belirleyebilirsiniz. E-posta gelmezse gereksiz (spam) klasörünü de kontrol edin.',
      },
      {
        key: 'iletisim_yok',
        text: 'Kayıtlı iletişim bilgilerinize erişiminiz olmadığında hesabınızı ekibimizin başka bir yolla doğrulaması gerekiyor. Bilgilerinizi teknik ekibimize iletiyorum.',
      },
      {
        key: 'guvenlik',
        text: 'Hesabınızın güvenliği için durumu ilgili ekibimize hemen iletiyorum. Bu arada şifrenizi ya da size gelen kodları kimseyle paylaşmayın.',
      },
      {
        key: 'devir',
        text: 'Sıfırlama adımı sorunu çözmediği için bilgilerinizi teknik ekibimize iletiyorum; bir uzman bu sohbet üzerinden size dönüş yapacak.',
      },
    ],
    handoff: {
      conditions: [],
      target: { topic: 'technical' },
      card_fields: ['hata', 'baskasi_girmis', 'sifirlama_denendi', 'iletisim_erisimi'],
      next_step_hint: 'Oyuncunun kimliğini kayıtlı bilgilerle doğrulayıp giriş kaydını inceleyin.',
    },
    limits: { max_turns: 10 },
  },
  forbidden_phrases: [
    {
      phrase: 'şifrenizi yazın',
      match: 'word',
      why: 'Şifre sohbette asla istenmez (G11).',
    },
    {
      phrase: 'kodu buraya',
      match: 'word',
      why: 'Tek kullanımlık kod sohbette asla istenmez (G11).',
    },
    {
      phrase: 'şifrenizi sıfırladım',
      match: 'word',
      why: 'Yapay zekâ hesapta işlem yapmaz (G8).',
    },
  ],
  tenant_must_fill: [],
  scenarios: [
    {
      key: 'sifirlama_anlatilir',
      name: 'Sıfırlama denenmemiş — adımlar anlatılır, çözüldü',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['şifremi unuttum', 'Kullanıcı adı veya şifre hatalı diyor', 'hayır', 'hayır', 'evet'],
      facts: {},
      expect: {
        outcome: 'resolved',
        required_slots: ['hata', 'baskasi_girmis', 'sifirlama_denendi'],
      },
    },
    {
      key: 'iletisim_erisimi_yok',
      name: 'Kayıtlı telefona erişim yok — teknik ekibe devredilir',
      persona: 'eksik_bilgi',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'giriş yapamıyorum',
        'Sıfırlama mesajı gelmiyor',
        'hayır',
        'evet denedim',
        'hayır, eski numaram',
        'ahmet77',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'no_contact_access',
        topic: 'technical',
        required_slots: [
          'hata',
          'baskasi_girmis',
          'sifirlama_denendi',
          'iletisim_erisimi',
          'kullanici_adi',
        ],
        values: { kullanici_adi: 'ahmet77' },
      },
    },
    {
      key: 'ele_gecirme_suphesi',
      name: 'Başkası girmiş olabilir — risk ekibine devredilir',
      persona: 'normal',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: [
        'hesabıma giremiyorum',
        'Hesabınız başka bir cihazda açık diyor',
        'evet',
        'mehmet_34',
      ],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'account_takeover_suspected',
        topic: 'kyc_risk',
        required_slots: ['hata', 'baskasi_girmis', 'kullanici_adi'],
        values: { kullanici_adi: 'mehmet_34' },
      },
    },
    {
      key: 'teknik_sorun_suruyor',
      name: 'Sıfırlama denendi, iletişim erişimi var — teknik ekibe devredilir',
      persona: 'sabirsiz',
      simulated_now: '2026-10-18T13:50:00+03:00',
      turns: ['giriş yaparken hata alıyorum', 'Sunucu hatası', 'hayır', 'evet', 'evet', 'ali_k'],
      facts: {},
      expect: {
        outcome: 'handoff',
        reason_code: 'login_issue_persists',
        topic: 'technical',
        required_slots: [
          'hata',
          'baskasi_girmis',
          'sifirlama_denendi',
          'iletisim_erisimi',
          'kullanici_adi',
        ],
      },
    },
  ],
};
