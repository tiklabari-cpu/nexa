# Task ID: 327

**Title:** PROFILE-NAME-PASSWORD [OPUS-XHIGH] (Opus 5.5) Profilim: görünen ad + isteğe bağlı oyuncuya görünen takma ad, uygulama içinden şifre değiştirme (mevcut şifreyle, diğer oturumlar kapanır)

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** Profil adı düzenlenemiyor; şifre yalnız e-postayla sıfırlanıyor ve günlük 5 hesap e-postası hakkını harcıyor. ChatBot.com dersi: şifre değişiminde eski şifre istenmeli. Kaynak: RL-06.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RL-06. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 4 — roller ve yetki matrisi.

XHIGH GEREKÇESİ: (1) güvenlik yüzeyi — kimlik doğrulama (şifre değişimi, oturum iptali).
contract: PATCH /agents/me (name, public_name), POST /auth/password (current_password, new_password).
prisma: accounts.public_name TEXT NULL.
api: ad 1–120 karakter kırpma; şifre: mevcut şifre scrypt ile doğrulanır, yeni ≥12 karakter (davet kabulüyle aynı), eskisiyle aynı olamaz; SSO zorunlu üyede açıklayıcı ret; başarıda BU OTURUM HARİÇ tüm yenileme token aileleri (oauth_refresh_tokens.familyId) iptal (RL-06-S1); audit account.profile_updated, account.password_changed; güvenlik bilgilendirme e-postası (güvenlik rezervi; tavana takılırsa değişiklik engellenmez — backgroundMail); hız sınırı hesap başına saatte 10. Widget'ta public_name ?? name (customer.ts:565-569).
web: Profilim formu (GV-06 kalıbı), şifre bölümü. Mobil: ad salt okunur kalabilir (sonraki iş).

KABUL KRİTERLERİ:
- Kullanıcı adını değiştirir; panelde ve ekip listesinde görünür; audit.
- Doğru mevcut şifreyle değişir; diğer cihaz oturumları sonraki yenilemede düşer, mevcut açık kalır.
- Yanlış mevcut şifre reddedilir ve hız sınırına sayılır.
- Takma ad girilmişse widget'ta oyuncu takma adı görür.

KULLANILAN VARSAYIMLAR:
- RL-06-S1 diğer oturumlar kapanır; S2 oyuncuya görünen ad ayrı (isteğe bağlı).

**Test Strategy:**

Entegrasyon (yanlış şifre, oturum iptali, SSO reddi, widget takma adı), e2e profil; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
