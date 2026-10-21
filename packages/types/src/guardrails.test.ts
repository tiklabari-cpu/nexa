import { describe, expect, it } from 'vitest';
import { AI_RETURN_BLOCKING_RISK_FLAGS } from './ai-conversation.js';
import {
  foldGuardrailText,
  GUARDRAIL_HANDOFF_REASONS,
  GUARDRAIL_IDS,
  GUARDRAIL_QUOTE_MAX,
  GUARDRAIL_RISK_FLAGS,
  GUARDRAIL_SAFE_TEXT,
  GUARDRAIL_UNDERSTAND_RISKS,
  guardrailsHit,
  isGuardrailId,
  normalizeGuardrailText,
  PLATFORM_GUARDRAILS,
  PLATFORM_GUARDRAILS_VERSION,
  platformGuardrail,
  scanGuardrails,
  UNDERSTAND_RISK_FLAGS,
  type GuardrailId,
  type GuardrailStage,
} from './guardrails.js';

// CPU time of this test process, in ms. Wall clock counts the time the gate's
// other jobs hold the CPU (a 1.8 s run measured 8.8 s under load); CPU time
// does not, so the budget still catches a quadratic pattern without flaking.
// No Node types in this package, hence the narrow cast.
const cpuMs = (): number => {
  const usage = (
    globalThis as unknown as { process: { cpuUsage(): { user: number; system: number } } }
  ).process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/** The rules the text trips at a stage. */
const hits = (text: string, stage: GuardrailStage) => guardrailsHit(scanGuardrails(text, stage));

interface LexiconCase {
  rule: GuardrailId;
  stage: GuardrailStage;
  /** Each must trip the rule. Between them they exercise every pattern of the rule's lexicon. */
  hits: string[];
  /** Each must not trip the rule — the near misses a support inbox is full of. */
  misses: string[];
}

const CASES: LexiconCase[] = [
  {
    rule: 'G1',
    stage: 'input',
    hits: [
      'artık oynamak istemiyorum, hesabımı kapatın',
      'HESABIMI KAPATIIIN',
      'hesabimi kapatir misiniz',
      'hesabımı kalıcı olarak kapattırmak istiyorum',
      'hesabımı kapatmayı düşünüyorum',
      'Hesabımı silin',
      'Hesabım kapatılsın',
      'üyeliğimi iptal etmek istiyorum',
      'hesabımı dondurun lütfen',
      'hesap kapatma talebinde bulunmak istiyorum',
      'üyelik iptali nasıl yapılır',
      'kendimi siteden engellemek istiyorum',
      'kendimi oyundan men ettirmek istiyorum',
      'beni siteden engelleyin',
      'biraz ara vermek istiyorum',
      'oyuna mola vermem lazım',
      'oynamayı bırakmak istiyorum',
      'bir daha oynamayacağım',
      'kumarı bırakmak istiyorum',
      'self-exclusion yapmak istiyorum',
      'kendini dışlama nasıl yapılır',
      'Please close my account',
      'can you delete my account',
      'I want to self-exclude',
      'I need a break from gambling',
      'I want to take a break',
      'Is there a cooling-off period?',
      'I would like a time-out from gambling',
      'I need to stop gambling',
      'please block me',
      "I don't want to play anymore",
    ],
    misses: [
      'hesabımı neden kapattınız?',
      'hesabımı kapatmayın lütfen',
      'Hesabım kapatıldı mı?',
      'hesabımı kapatmışsınız, neden?',
      'hesabımı kapatmak istemiyorum, bonusumu istiyorum',
      'hesabım açılmıyor, tarayıcıyı kapatıp açtım',
      'Hesabım açılmıyor. Tarayıcıyı kapatın dediniz, kapattım',
      'kendimi engellemek istemiyorum',
      'beni neden engellediniz?',
      'çekim talebimi iptal edin',
      'bonusumu iptal edin',
      'hesabıma giriş yapamıyorum',
      'oynamaya devam etmek istiyorum',
      'why did you close my account?',
      'you closed my account without warning',
      'the game stopped playing halfway',
    ],
  },
  {
    rule: 'G2',
    stage: 'input',
    hits: [
      'kaybımı geri almam lazım',
      'zararımı çıkarmam lazım',
      'borç aldım yatırdım',
      'borçla oynuyorum',
      'borca battım',
      'kredi çektim yatırdım',
      'ihtiyaç kredisi çekip yatırdım',
      'kredi kartı borcumu ödeyemiyorum',
      'maaşımı yatırdım',
      'kiramı yatırdım hepsi gitti',
      'her şeyimi kaybettim',
      'tüm paramı kaybettim',
      'son paramdı bu',
      'arabamı sattım yatırdım',
      'kumar bağımlısıyım',
      'oynamayı bırakamıyorum',
      'kendimi durduramıyorum',
      'kontrolümü kaybettim',
      'eşim öğrenirse beni bırakacak',
      'I need to chase my losses',
      'I have to win it back',
      'I borrowed money to play',
      'I took out a loan',
      'it was a payday loan',
      "I'm in debt",
      'my debts are huge',
      'I put my salary on bets',
      'I lost my savings',
      "I can't stop gambling",
      'I think I am addicted',
      'I have a gambling problem',
      'I lost control',
    ],
    misses: [
      'kredi kartı ile yatırdım',
      'kredi kartımdan çektim',
      'maaşım yatırıldı, yarın yatırım yapacağım',
      'kayıp bonusumu alamadım',
      'bakiyem borç gösteriyor',
      'maçı kaybettim ama sorun yok',
      'Papara limitim doldu',
      'son para çekme talebim nerede',
      'I want my money back',
      'where is my refund?',
    ],
  },
  {
    rule: 'G3',
    stage: 'input',
    hits: [
      'intihar edeceğim',
      'kendimi öldüreceğim',
      'kendimi köprüden atacağım',
      'kendime zarar vereceğim',
      'canıma kıyacağım',
      'hayatıma son vermek istiyorum',
      'bileklerimi keseceğim',
      'yaşamak istemiyorum artık',
      'yaşamak için bir sebebim kalmadı',
      'hayatın anlamı kalmadı',
      'ölmek istiyorum',
      'ölsem daha iyi',
      'ölmeyi düşünüyorum',
      'bu dünyadan gitmek istiyorum',
      'thinking about suicide',
      'I want to kill myself',
      'I just want to end it all',
      'I want to die',
      'self-harm',
      'I keep hurting myself',
      "I don't want to live anymore",
      'there is no reason to live',
      "I'd be better off dead",
      'I want to take my own life',
    ],
    misses: [
      'bu bekleme beni öldürüyor',
      'sinirden ölmek üzereyim',
      'kendime yeni bir hesap açtım',
      'yaşadığım sorun çözülmedi',
      'this lag is killing me',
      'the game died on me',
    ],
  },
  {
    rule: 'G5',
    stage: 'input',
    hits: [
      '16 yaşındayım',
      '17yaşındayım',
      '１６ yaşındayım',
      '16 yaşında bir öğrenciyim',
      'yaşım 15',
      'on altı yaşındayım',
      'dokuz yaşındayım',
      '18 yaşından küçüğüm',
      'henüz 18 değilim',
      'reşit değilim',
      'yaşım tutmuyor',
      'lisedeyim',
      "Lise 2'deyim",
      'lise sondayım',
      '10. sınıftayım',
      "I'm 16 years old",
      'I am 9 years old',
      "I'm underage",
      'I go to high school',
      "I'm in 10th grade",
    ],
    misses: [
      '16 yaşındayken başladım',
      '16 yaşında oğlum var',
      '18 yaşından küçükler oynayabilir mi?',
      'yaşım 25',
      '5. sınıf öğretmeniyim',
      "saat 16'da yatırdım",
      '1500 TL yatırdım',
      'I am 15 euros short',
      "I'm 16 minutes late",
      "I'm 25",
    ],
  },
  {
    rule: 'G6',
    stage: 'input',
    hits: [
      'yatırım limitimi artırın',
      'limitimi kaldırın',
      'please raise my deposit limit',
      'deposit limit increase',
      'remove my limits',
    ],
    misses: [
      'çekim limitimi artırın',
      'Papara limitim düşük, artırabilir misiniz',
      'yatırım limitimi düşürmek istiyorum',
      'yatırım limiti ne kadar?',
      'increase my withdrawal limit',
      'what is the minimum deposit',
    ],
  },
  {
    rule: 'G13',
    stage: 'input',
    hits: [
      'hesabım çalındı',
      'hesabımı hacklemişler',
      'hesabıma başkası girmiş',
      'benden habersiz çekim yapılmış',
      'şifremi biri değiştirmiş',
      'kardeşim benim hesabımdan oynamış',
      'arkadaşımın kartıyla yatırdım',
      'ikinci bir hesap açabilir miyim',
      'kara para aklama',
      'telefon numaramı değiştirmek istiyorum',
      'e-posta adresimi güncellemek istiyorum',
      'my account was hacked',
      'someone logged into my account',
      'someone is using my account',
      'there was an unauthorized withdrawal',
      'can I open a second account',
      'I want to change my email',
      'is this money laundering',
      "I used someone else's card",
    ],
    misses: [
      'şifremi değiştirmek istiyorum',
      'hesabıma giriş yapamıyorum',
      'site adresini değiştirdiniz mi?',
      'yatırımım hesabıma geçmedi',
      'I want to change my password',
      'I deposited to another account by mistake',
    ],
  },
  {
    rule: 'G15',
    stage: 'input',
    hits: [
      'resmi şikâyette bulunacağım',
      'avukatıma vereceğim',
      'lisans kurumuna bildireceğim',
      "Curaçao'ya şikayet edeceğim",
      'dava açacağım',
      'şikayet etmek istiyorum',
      "şikayetvar'a yazacağım",
      'şikayetimi iletin',
      'şikayetim var',
      'ADR başvurusu yapacağım',
      'tüketici hakem heyetine gideceğim',
      'I want to make a formal complaint',
      'I will file a complaint',
      'escalate this now',
      'my lawyer will contact you',
      'I will sue you',
      "I'll take you to court",
      'I will report you to the gambling commission',
      'is there an ADR body',
    ],
    misses: [
      'Curaçao lisansınız var mı?',
      'şikayet etmiyorum ama bekliyorum',
      'bahis sonucuna itiraz ediyorum',
      'the match on court 3 was suspended',
      'did my complaint get resolved?',
    ],
  },
  {
    rule: 'G16',
    stage: 'input',
    hits: [
      'temsilciyle görüşmek istiyorum',
      'canlı destekle görüşmek istiyorum',
      'insanla konuşmak istiyorum',
      'insan ile görüşebilir miyim',
      'botla konuşmak istemiyorum',
      'I want to talk to a human',
      'live agent please',
      "I don't want to talk to a bot",
      'connect me to someone',
    ],
    misses: [
      'insan gibi konuşun',
      'temsilciniz bana yanlış bilgi verdi',
      'temsilciyle konuşmak istemiyorum',
      'are you a bot?',
      'I spoke to an agent yesterday',
    ],
  },
  {
    rule: 'G19',
    stage: 'input',
    hits: [
      'amk ne zaman yatacak',
      'şerefsizler',
      'amına koyayım',
      'piç kurusu',
      'salaksınız',
      'gerizekalılar',
      'cahiller',
      'mal mısın',
      'sizi bulacağım',
      'evinizi biliyorum',
      'kafanı kırarım',
      'fuck this site',
      'you are useless',
      'I will find you',
      'I know where you live',
      'you will regret this',
    ],
    misses: [
      'sık sık yaşıyorum bu sorunu',
      'şikayetim var',
      'mallarınız ne zaman gelir',
      'aptal gibi hissediyorum',
      'Amina Hanım ile görüştüm',
      'sizi bulamadım',
      'kafanız karışmasın',
      'I got my money',
      'send pic of the receipt?',
      'you are right',
    ],
  },
  {
    rule: 'G4',
    stage: 'output',
    hits: [
      'Size özel bonus kampanyamız var.',
      'Papara ile en az 100 TL yatırabilirsiniz.',
      'You can claim free spins today.',
      'Deposit now to get more.',
    ],
    misses: [
      'Talebinizi ilgili ekibe iletiyorum.',
      'Sizi sorumlu oyun ekibimize aktarıyorum.',
      'Yatırımınızın durumunu ekibimiz inceleyecek.',
      'Your request has been passed on.',
    ],
  },
  {
    rule: 'G7',
    stage: 'output',
    hits: [
      'Bu işlem garantilidir.',
      'Bunu garanti ediyoruz.',
      'Kesin yatacak.',
      'Size söz veriyorum.',
      '%100 garanti',
      'Yatırımınız 5 dakika içinde hesabınıza geçecek.',
      'Genellikle 5 dakika içinde yatar. Bu sefer 10 dakika içinde yatacak.',
      'En geç 15 dakika sürer.',
      'Birazdan hesabınıza geçecek.',
      'We guarantee it.',
      'It will definitely arrive.',
      'I promise.',
      'It will be credited within 5 minutes.',
      'Within 24 hours it will be credited.',
    ],
    misses: [
      'Size garanti veremiyoruz.',
      'Garanti Bankası ile havale yapabilirsiniz.',
      'Bir garantimiz yok.',
      'Bunun garantisi yoktur.',
      'Yatırımlar genellikle 5 dakika içinde hesabınıza geçer.',
      'Politikamıza göre çekimler 24 saat içinde tamamlanır.',
      'Size söz veremem.',
      'Ekibimiz 24 saat içinde size dönüş yapacak.',
      'We cannot guarantee the time.',
      'There is no guarantee.',
      'It is usually credited within 5 minutes.',
    ],
  },
  {
    rule: 'G8',
    stage: 'output',
    hits: [
      'Kontrol ettim, hesabınıza geçti.',
      'Hesabınızı inceledim.',
      'Sistemimizde yatırımınız görünmüyor.',
      'Çekiminiz onaylandı.',
      'Görüyorum ki yatırımınız beklemede.',
      'I have checked your account.',
      'Your deposit has been credited.',
      'I can see in the system that it is pending.',
      'The system shows a pending withdrawal.',
    ],
    misses: [
      'Bunu kontrol edemiyorum, ekibimize iletiyorum.',
      'Talebiniz ilgili ekibe iletildi.',
      'Yatırımınız onaylandıktan sonra hesabınıza geçer.',
      'Kontrol ettiğimizde size bilgi vereceğiz.',
      'Once your deposit has been approved, you can play.',
      'I cannot check your account.',
    ],
  },
  {
    rule: 'G9',
    stage: 'output',
    hits: [
      'Bu maça oynayın, kazanırsınız.',
      'Şimdi yatırırsanız avantajlı olur.',
      'Üst oynayın.',
      "RTP'si yüksek slotları seçin.",
      'Bu kesin kazanç.',
      'Önerim şu maçı oynamanız.',
      'You will win.',
      'Bet on this match.',
      'Try our hot slots.',
      'If you deposit now you get more.',
      'I recommend betting on the home team.',
      'High RTP slots pay more.',
      "It's a sure bet.",
    ],
    misses: [
      'Kazandığınız tutar çekilebilir.',
      'Kazanırsanız çekim yapabilirsiniz.',
      'Sayfanın alt menüsüne basın.',
      'Bahis tavsiyesi veremem.',
      'RTP bilgisi bilgi bankasında yer alır.',
      'If you win, you can withdraw.',
    ],
  },
  {
    rule: 'G10',
    stage: 'output',
    hits: [
      'Tekrar yatırın.',
      'Yatırımı tekrar deneyin.',
      'Please deposit again.',
      'Make another deposit.',
      'Try depositing again.',
    ],
    misses: [
      'Sayfayı yenileyip tekrar deneyin.',
      'Lütfen tekrar yatırım yapmayın, ekibimiz inceliyor.',
      'Please do not deposit again.',
    ],
  },
  {
    rule: 'G11',
    stage: 'output',
    hits: [
      'Şifrenizi bizimle paylaşır mısınız?',
      'SMS kodunu yazar mısınız?',
      'Kartınızın tamamını yazın.',
      'Şifreniz nedir?',
      'Please send me your password.',
      'What is your OTP?',
    ],
    misses: [
      'Lütfen şifrenizi ve SMS kodunu kimseyle paylaşmayın.',
      'Kart numaranızın son dört hanesini yazın.',
      'Giriş sayfasında şifrenizi girin.',
      'Şifrenizi sıfırlamak için bağlantıya tıklayın.',
      'Never share your password with anyone.',
      'Do not send us your card number.',
    ],
  },
  {
    rule: 'G12',
    stage: 'output',
    hits: ['Belgeniz onaylandı.', 'Your documents have been approved.'],
    misses: [
      'Dekontunuz alındı, ekibimiz inceleyecek.',
      'Belgenizin geçerli olması gerekir.',
      'Once your documents are approved you can withdraw.',
    ],
  },
  {
    rule: 'G13',
    stage: 'output',
    hits: [
      'Hesabınız AML incelemesinde.',
      'Hesabınızda şüpheli işlem tespit edildi.',
      'Risk ekibimiz hesabınızı incelemeye aldı.',
      'Your account is under a fraud review.',
    ],
    misses: [
      'Hesabınız güvenlik incelemesinde.',
      'Dolandırıcılara karşı dikkatli olun.',
      'Your account is under a security review.',
    ],
  },
  {
    rule: 'G14',
    stage: 'output',
    hits: [
      'VPN kullanarak girebilirsiniz.',
      'DNS ayarlarınızı değiştirin.',
      'Ayna site üzerinden girin.',
      'Mirror link paylaşıyorum.',
      'Güncel giriş adresimiz siyahbet.com',
      'Erişim engelini aşmak için şunu yapın.',
      'Use a VPN.',
      'Get a VPN to access the site.',
      'Here is our mirror site.',
      'Our new domain is ready.',
      'Change your DNS.',
      'You can bypass the block.',
    ],
    misses: [
      'VPN kullanıyorsanız kapatıp tekrar deneyin.',
      'Lütfen ev adresinizi güncelleyin.',
      'Yeni adres bilginizi profilinize girin.',
      'Please turn off your VPN and try again.',
    ],
  },
  {
    rule: 'G16',
    stage: 'output',
    hits: [
      'Ben gerçek bir insanım.',
      'Yapay zekâ değilim.',
      'Bot değilim.',
      'Ben bir müşteri temsilcisiyim.',
      'I am a real human.',
      "I'm not a bot.",
    ],
    misses: [
      "Ben SiyahTuş'un yapay zekâ asistanıyım.",
      'Sizi bir temsilciye aktarıyorum.',
      "I'm an AI assistant.",
    ],
  },
];

describe('platform guardrail catalogue (AI-08)', () => {
  it('holds G1–G19 in order, each once', () => {
    expect(PLATFORM_GUARDRAILS.map((rule) => rule.id)).toEqual([...GUARDRAIL_IDS]);
    expect(GUARDRAIL_IDS).toHaveLength(19);
    for (const id of GUARDRAIL_IDS) expect(platformGuardrail(id).id).toBe(id);
    expect(isGuardrailId('G7')).toBe(true);
    expect(isGuardrailId('G20')).toBe(false);
    expect(isGuardrailId('g7')).toBe(false);
  });

  it('gives every rule a title and a prompt line in Turkish and English', () => {
    for (const rule of PLATFORM_GUARDRAILS) {
      for (const lang of ['tr', 'en'] as const) {
        expect(rule.title[lang].length, `${rule.id} title ${lang}`).toBeGreaterThan(3);
        expect(rule.prompt[lang].length, `${rule.id} prompt ${lang}`).toBeGreaterThan(20);
        expect(rule.prompt[lang].length, `${rule.id} prompt ${lang}`).toBeLessThanOrEqual(320);
      }
    }
    expect(GUARDRAIL_SAFE_TEXT.tr).toBe('Bilgilerinizi ilgili ekibimize iletiyorum.');
  });

  it('hands G1/G2/G3/G5/G13/G15 over to their team, G3/G5/G1 urgent (AI-08 §3, AI-12 §1/§3)', () => {
    const handoff = PLATFORM_GUARDRAILS.filter((rule) => rule.action === 'force_handoff');
    expect(handoff.map((rule) => rule.id)).toEqual([
      'G1',
      'G2',
      'G3',
      'G5',
      'G6',
      'G13',
      'G15',
      'G16',
      'G17',
      'G19',
    ]);
    const target = Object.fromEntries(PLATFORM_GUARDRAILS.map((rule) => [rule.id, rule.target]));
    expect(target).toMatchObject({
      G1: 'responsible_gaming',
      G2: 'responsible_gaming',
      G3: 'responsible_gaming',
      G5: 'responsible_gaming',
      G6: 'responsible_gaming',
      G13: 'kyc_risk',
      G15: 'complaints',
    });
    expect(
      PLATFORM_GUARDRAILS.filter((rule) => rule.priority === 'urgent').map((rule) => rule.id),
    ).toEqual(['G1', 'G3', 'G5']);
    for (const rule of handoff) expect(GUARDRAIL_HANDOFF_REASONS).toContain(rule.handoffReason);
    for (const rule of PLATFORM_GUARDRAILS.filter((r) => r.action !== 'force_handoff')) {
      expect(rule.handoffReason, rule.id).toBeNull();
      expect(rule.target, rule.id).toBeNull();
    }
  });

  it('lets the lexicon alone trigger only where a false positive costs a hand-over (AI-08 §2)', () => {
    expect(PLATFORM_GUARDRAILS.filter((rule) => rule.lexiconAlone).map((rule) => rule.id)).toEqual([
      'G1',
      'G3',
      'G5',
      'G6',
      'G16',
      'G19',
    ]);
    const signals = Object.fromEntries(
      PLATFORM_GUARDRAILS.map((rule) => [rule.id, rule.understandRisks]),
    );
    expect(signals).toMatchObject({
      G1: ['self_exclusion'],
      G2: ['rg_signal'],
      G3: ['self_harm'],
      G5: ['minor'],
      G13: ['account_takeover', 'fraud_aml'],
      G15: ['complaint_formal'],
    });
    const covered = new Set(PLATFORM_GUARDRAILS.flatMap((rule) => rule.understandRisks));
    expect([...covered].sort()).toEqual([...GUARDRAIL_UNDERSTAND_RISKS].sort());
  });

  it('names its risk flags as AI-27 does, the return-blocking ones included', () => {
    for (const risk of GUARDRAIL_UNDERSTAND_RISKS) {
      expect(GUARDRAIL_RISK_FLAGS).toContain(UNDERSTAND_RISK_FLAGS[risk]);
    }
    for (const flag of AI_RETURN_BLOCKING_RISK_FLAGS) expect(GUARDRAIL_RISK_FLAGS).toContain(flag);
    for (const rule of PLATFORM_GUARDRAILS) {
      if (rule.riskFlag !== null) expect(GUARDRAIL_RISK_FLAGS).toContain(rule.riskFlag);
    }
  });

  it('marks the tenant texts, G4 on risk-flagged conversations only and G19 after two warnings', () => {
    const text = Object.fromEntries(PLATFORM_GUARDRAILS.map((rule) => [rule.id, rule.tenantText]));
    expect(Object.entries(text).filter(([, value]) => value !== null)).toEqual([
      ['G3', 'crisis'],
      ['G14', 'access_info'],
      ['G15', 'complaint'],
    ]);
    expect(
      PLATFORM_GUARDRAILS.filter((rule) => rule.appliesWhen === 'risk_flagged').map(
        (rule) => rule.id,
      ),
    ).toEqual(['G4']);
    expect(platformGuardrail('G19').warningsBeforeHandoff).toBe(2);
    expect(platformGuardrail('G4').action).toBe('block_promo');
    expect(platformGuardrail('G18').action).toBe('warn');
  });

  it('scans the input for G1/G2/G3/G5/G13/G15/G19 (AI-08 §1) plus G6 and G16, and checks drafts for the rest', () => {
    const withInput = PLATFORM_GUARDRAILS.filter((rule) => rule.input !== null).map(
      (rule) => rule.id,
    );
    const withOutput = PLATFORM_GUARDRAILS.filter((rule) => rule.output !== null).map(
      (rule) => rule.id,
    );
    expect(withInput).toEqual(['G1', 'G2', 'G3', 'G5', 'G6', 'G13', 'G15', 'G16', 'G19']);
    expect(withOutput).toEqual(['G4', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14', 'G16']);
    for (const rule of PLATFORM_GUARDRAILS) {
      for (const lexicon of [rule.input, rule.output]) {
        if (!lexicon) continue;
        expect(lexicon.tr.length, `${rule.id} tr`).toBeGreaterThan(0);
        expect(lexicon.en.length, `${rule.id} en`).toBeGreaterThan(0);
      }
    }
  });

  it('writes every pattern in normalised form: lower-case ASCII, no flags, never empty', () => {
    for (const rule of PLATFORM_GUARDRAILS) {
      for (const lexicon of [rule.input, rule.output]) {
        if (!lexicon) continue;
        for (const pattern of [...lexicon.tr, ...lexicon.en]) {
          for (const re of [pattern.re, ...(pattern.unless ? [pattern.unless] : [])]) {
            expect(re.source, `${rule.id} ${re.source}`).toMatch(/^[\x20-\x7e]+$/);
            expect(re.source, `${rule.id} ${re.source}`).not.toMatch(/[A-Z]/);
            expect(re.flags, `${rule.id} ${re.source}`).toBe('');
            expect(re.test(''), `${rule.id} ${re.source}`).toBe(false);
            expect(re.test(' '), `${rule.id} ${re.source}`).toBe(false);
          }
        }
      }
    }
  });

  it('is frozen — a caller cannot loosen a locked rule', () => {
    expect(Object.isFrozen(PLATFORM_GUARDRAILS)).toBe(true);
    for (const rule of PLATFORM_GUARDRAILS) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.prompt)).toBe(true);
      for (const lexicon of [rule.input, rule.output]) {
        if (lexicon)
          expect(Object.isFrozen(lexicon.tr) && Object.isFrozen(lexicon.en[0])).toBe(true);
      }
    }
    expect(() => {
      (PLATFORM_GUARDRAILS as PlatformGuardrailLike[]).pop();
    }).toThrow();
  });

  it('changes its fingerprint only with the version — bump PLATFORM_GUARDRAILS_VERSION with any edit', () => {
    // If this fails after an edit to guardrails.ts: bump PLATFORM_GUARDRAILS_VERSION, then
    // update both values here. Every turn records the version, so a silent change to a
    // locked rule would leave the record lying about what ran.
    expect({ version: PLATFORM_GUARDRAILS_VERSION, fingerprint: fingerprint() }).toEqual({
      version: '2026-10-19.1',
      fingerprint: '6829fed5',
    });
  });
});

type PlatformGuardrailLike = (typeof PLATFORM_GUARDRAILS)[number];

/** FNV-1a over the whole catalogue, patterns as their source. */
function fingerprint(): string {
  const canonical = JSON.stringify(
    [PLATFORM_GUARDRAILS, GUARDRAIL_SAFE_TEXT],
    (_key, value: unknown) => (value instanceof RegExp ? `/${value.source}/${value.flags}` : value),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

describe('normalizeGuardrailText', () => {
  it('folds Turkish letters and case, so every spelling of a phrase is one string', () => {
    expect(foldGuardrailText('Hesabımı KAPATIN')).toBe('hesabimi kapatin');
    expect(foldGuardrailText('hesabimi kapatin')).toBe('hesabimi kapatin');
    expect(foldGuardrailText('İNTİHAR')).toBe('intihar');
    expect(foldGuardrailText('INTIHAR')).toBe('intihar');
    expect(foldGuardrailText('Şikâyet, çekim, göğüs, ödül')).toBe('sikayet,cekim,gogus,odul');
    expect(foldGuardrailText('Ｉ’m １６')).toBe('im 16');
  });

  it('squashes a letter repeated three times or more, and keeps a double letter', () => {
    expect(foldGuardrailText('KAPATIIIN lütfeeeen')).toBe('kapatin lutfen');
    expect(foldGuardrailText('kapattınız saat')).toBe('kapattiniz saat');
    expect(foldGuardrailText('1000 TL')).toBe('1000 tl');
  });

  it('drops zero-width characters, soft hyphens and apostrophes without splitting the word', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const softHyphen = String.fromCharCode(0xad);
    expect(foldGuardrailText(`in${zeroWidth}ti${softHyphen}har`)).toBe('intihar');
    expect(foldGuardrailText("Curaçao'ya")).toBe('curacaoya');
    expect(foldGuardrailText('Lise 2’deyim')).toBe('lise 2deyim');
  });

  it('ends a sentence at . ! ? ; and a line break, a clause at a comma, and joins nothing across them', () => {
    expect(foldGuardrailText('a, b. c! d? e; f\ng')).toBe('a,b\nc\nd\ne\nf\ng');
    expect(foldGuardrailText('2.500,00 TL ve 1,5 saat')).toBe('2 500 00 tl ve 1 5 saat');
    expect(foldGuardrailText('siyahbet.com... (yeni)')).toBe('siyahbet com\nyeni');
    expect(foldGuardrailText('10. sınıftayım. Saat 10. Sonra')).toBe(
      '10 siniftayim\nsaat 10\nsonra',
    );
    expect(foldGuardrailText('  - self-exclusion -  ')).toBe('self exclusion');
    expect(foldGuardrailText('%100 garanti')).toBe('%100 garanti');
    expect(foldGuardrailText('')).toBe('');
    expect(foldGuardrailText('!!! ...')).toBe('');
  });

  it("maps every character back to the original, so a quote is the writer's own words", () => {
    const raw = '  Lütfen,  HESABIMI   kapatıııın!! ';
    const normalized = normalizeGuardrailText(raw);
    expect(normalized.text).toBe('lutfen,hesabimi kapatin');
    expect(normalized.starts).toHaveLength(normalized.text.length);
    expect(normalized.ends).toHaveLength(normalized.text.length);
    const at = normalized.text.indexOf('hesabimi');
    const last = normalized.text.length - 1;
    expect(raw.slice(normalized.starts[at], normalized.ends[last])).toBe('HESABIMI   kapatıııın');
    // A combining mark typed on its own stays with its letter.
    const decomposed = `s${String.fromCharCode(0x327)}ifre`;
    const folded = normalizeGuardrailText(decomposed);
    expect(folded.text).toBe('sifre');
    expect(decomposed.slice(folded.starts[0], folded.ends[0])).toBe(decomposed.slice(0, 2));
  });
});

describe('lexicons — hits and near misses', () => {
  for (const { rule, stage, hits: positives, misses } of CASES) {
    it(`${rule} ${stage}: trips on the phrasings that mean it`, () => {
      for (const text of positives) expect(hits(text, stage), text).toContain(rule);
    });
    it(`${rule} ${stage}: leaves the near misses alone`, () => {
      for (const text of misses) expect(hits(text, stage), text).not.toContain(rule);
    });
  }

  it('exercises every pattern of every lexicon — no dead pattern', () => {
    const seen = new Set<string>();
    for (const { stage, hits: positives } of CASES) {
      for (const text of positives) {
        for (const match of scanGuardrails(text, stage)) {
          seen.add(`${match.rule} ${match.stage} ${match.lang} ${match.pattern}`);
        }
      }
    }
    const missing: string[] = [];
    for (const rule of PLATFORM_GUARDRAILS) {
      for (const stage of ['input', 'output'] as const) {
        const lexicon = stage === 'input' ? rule.input : rule.output;
        if (!lexicon) continue;
        for (const lang of ['tr', 'en'] as const) {
          lexicon[lang].forEach((pattern, index) => {
            const key = `${rule.id} ${stage} ${lang} ${index}`;
            if (!seen.has(key)) missing.push(`${key}: ${pattern.re.source}`);
          });
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('lets an ordinary day in a Turkish iGaming inbox through untouched', () => {
    const inbox = [
      'Merhaba, yatırımım hesabıma geçmedi',
      'Papara ile 500 TL yatırdım 20 dakika oldu',
      'çekim talebim neden reddedildi',
      'Bonus çevrim şartı nedir?',
      'hesabıma giremiyorum şifremi unuttum',
      'SMS kodu gelmiyor',
      'maç sonucu yanlış yazılmış itiraz ediyorum',
      'site açılmıyor güncel adres nedir',
      'USDT TRC20 ile yatırdım hash bu',
      'kimlik fotoğrafı gönderdim onaylandı mı',
      'slot oyununda takıldı bakiyem düştü',
      'kayıp bonusu ne zaman yüklenir',
      'hesabımı doğrulamak istiyorum',
      'çok bekledim artık yeter, neden bu kadar yavaşsınız',
      '16:40 da yatırdım',
      '18 yaşından büyüğüm',
      '20 yaşındayım',
      'yatırım limiti kaç TL',
      'temsilci ne zaman dönecek',
      'ara ara bağlantı kopuyor',
      'başka hesaba yatırdım yanlışlıkla',
      'maaş günü yatıracağım',
      'teşekkürler iyi çalışmalar',
    ];
    for (const text of inbox) expect(hits(text, 'input'), text).toEqual([]);
  });

  it('lets ordinary AI drafts through every always-on output rule', () => {
    const drafts = [
      "Merhaba, ben SiyahTuş'un yapay zekâ asistanıyım. Size nasıl yardımcı olabilirim?",
      'Yatırım talebinizi ilgili ekibe iletiyorum.',
      'Papara yatırımları genellikle 5-10 dakika içinde hesaba yansır.',
      'Çekim talepleri politikamıza göre 24 saat içinde değerlendirilir.',
      'Lütfen kullanıcı adınızı, tutarı ve işlem saatini yazar mısınız?',
      'Dekontunuzu buraya ekleyebilirsiniz.',
      'Bu konuda size kesin bilgi veremiyorum, sizi bir temsilciye aktarıyorum.',
      "Şifrenizi unuttuysanız giriş sayfasındaki 'Şifremi unuttum' bağlantısını kullanın.",
      'Hesabınız güvenlik incelemesinde, ekibimiz sizinle iletişime geçecek.',
      'Talebinizi aldım, kontrol edilmesi için ekibe iletiyorum.',
      'Site erişimiyle ilgili güncel bilgiyi resmi duyuru kanallarımızdan takip edebilirsiniz.',
      'Lütfen şifre ve kart bilgilerinizi paylaşmayın.',
      'USDT yatırımlarında TRC20 ağını seçmeniz gerekir.',
      'Bahis sonucu itirazınızı ekibimize iletiyorum.',
      'Ekibimiz en kısa sürede dönüş yapacak.',
    ];
    for (const text of drafts) {
      const always = scanGuardrails(text, 'output').filter(
        (match) => platformGuardrail(match.rule).appliesWhen === 'always',
      );
      expect(guardrailsHit(always), text).toEqual([]);
    }
    // G4 is the exception by design: on a risk-flagged conversation even an explanation
    // of wagering is a promotion.
    expect(
      hits('Çevrim şartı, bonus tutarının belirli katı kadar bahis yapılmasıdır.', 'output'),
    ).toEqual(['G4']);
  });

  it('keeps an accepted false positive: a hand-over is the price on G1 (AI-08 risks)', () => {
    // "I don't want to play, I want my money" reads as stopping play; the rule hands over
    // rather than risk missing a self-exclusion.
    expect(hits('oyun oynamak istemiyorum, paramı çekmek istiyorum', 'input')).toContain('G1');
  });

  it('meets the task: a closing request, a declared age, a self-harm line, the mock\'s "kontrol ettim" draft', () => {
    expect(hits('artık oynamak istemiyorum, hesabımı kapatın', 'input')).toEqual(['G1']);
    expect(hits('16 yaşındayım', 'input')).toEqual(['G5']);
    expect(hits('Kendimi öldüreceğim', 'input')).toEqual(['G3']);
    expect(platformGuardrail('G3').tenantText).toBe('crisis');
    expect(hits('Kontrol ettim, hesabınıza geçti.', 'output')).toEqual(['G8']);
  });

  it('runs input lexicons on the player only and output lexicons on the draft only', () => {
    expect(hits('Kontrol ettim, hesabınıza geçti.', 'input')).toEqual([]);
    expect(hits('hesabımı kapatın', 'output')).toEqual([]);
  });
});

describe('scanGuardrails', () => {
  it("quotes the writer's own words, whole words, in text order", () => {
    const matches = scanGuardrails(
      'Merhaba. Artık oynamak istemiyorum, HESABIMI KAPATIN!',
      'input',
    );
    expect(matches.map(({ rule, lang, quote }) => ({ rule, lang, quote }))).toEqual([
      { rule: 'G1', lang: 'tr', quote: 'oynamak istemiyorum' },
      { rule: 'G1', lang: 'tr', quote: 'HESABIMI KAPATIN' },
    ]);
    const [first] = matches;
    expect(
      'Merhaba. Artık oynamak istemiyorum, HESABIMI KAPATIN!'.slice(first?.start, first?.end),
    ).toBe('oynamak istemiyorum');
  });

  it('cuts a quote at GUARDRAIL_QUOTE_MAX characters', () => {
    const long = `hesabımı kapatın${'ı'.repeat(400)}`;
    const [match] = scanGuardrails(long, 'input');
    expect(match?.quote.length).toBe(GUARDRAIL_QUOTE_MAX);
  });

  it('lets a hedge in the same sentence excuse a time, not one in the sentence before', () => {
    expect(hits('Çekimler genellikle 24 saat içinde tamamlanır.', 'output')).toEqual([]);
    const matches = scanGuardrails(
      'Genellikle 5 dakika içinde yatar. Bu sefer 10 dakika içinde yatacak.',
      'output',
    );
    expect(matches.map((match) => match.quote)).toEqual(['10 dakika içinde yatacak']);
  });

  it('filters by rule and by language', () => {
    const text = 'hesabımı kapatın, I want to kill myself';
    expect(guardrailsHit(scanGuardrails(text, 'input'))).toEqual(['G1', 'G3']);
    expect(guardrailsHit(scanGuardrails(text, 'input', { rules: ['G3'] }))).toEqual(['G3']);
    expect(guardrailsHit(scanGuardrails(text, 'input', { langs: ['tr'] }))).toEqual(['G1']);
    expect(guardrailsHit(scanGuardrails(text, 'input', { langs: ['en'] }))).toEqual(['G3']);
  });

  it('reads a mixed message in both languages by default', () => {
    expect(hits('selam, I want to close my account, 16 yaşındayım', 'input')).toEqual(['G1', 'G5']);
  });

  it('finds nothing in empty or punctuation-only text', () => {
    expect(scanGuardrails('', 'input')).toEqual([]);
    expect(scanGuardrails(' ...!? ', 'output')).toEqual([]);
  });

  it('lists the rules once each, in catalogue order', () => {
    const matches = scanGuardrails(
      'amk, intihar edeceğim, kendimi öldüreceğim, hesabımı kapatın',
      'input',
    );
    expect(guardrailsHit(matches)).toEqual(['G1', 'G3', 'G19']);
  });

  it('stays linear on a million hostile characters', { timeout: 120_000 }, () => {
    const n = 1_000_000;
    const inputs = [
      'a'.repeat(n),
      'a '.repeat(n / 2),
      'hesabimi '.repeat(n / 9),
      'kapat sil dondur iptal '.repeat(n / 23),
      'you are '.repeat(n / 8),
      '16 '.repeat(n / 3),
    ];
    for (const text of inputs) {
      for (const stage of ['input', 'output'] as const) {
        const started = cpuMs();
        scanGuardrails(text, stage);
        expect(cpuMs() - started, `${stage} ${text.slice(0, 12)}`).toBeLessThan(5_000);
      }
    }
  });
});
