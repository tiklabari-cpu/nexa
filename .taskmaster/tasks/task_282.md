# Task ID: 282

**Title:** INVITE-EMAIL-VERIFY [OPUS-XHIGH] Davet akışının kötüye kullanımını engelle: bağlantıyla açılan yeni hesap e-posta doğrulanmadan giriş yapamasın + günlük davet sınırı

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Davet eden kabul bağlantısını yanıtta alıp davet edilen adres için şifre belirleyebiliyor; hesap doğrulanmış sayılıyor (auth_accept_invitation → auth_mark_email_verified; Account.emailVerifiedAt @default(now()) schema:231). Kimlik taklidi ve hesap önceden sahiplenme riski (docs/production-checklist.md Known risks). Kaynak: GV-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: GV-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 1 — hızlı güvenlik/temel düzeltmeler.

XHIGH GEREKÇESİ: (1) güvenlik yüzeyi — kimlik doğrulama akışı.
KOD: account-lifecycle.ts:650-729 (preview/accept), :788-860 (POST /invitations, accept_url döner); lifecycle-service.ts:538-608 acceptInvitation; kayıt doğrulaması SIGNUP_EMAIL_VERIFICATION (:641).
YAPILACAK: migration ile `auth_accept_invitation` yeni hesapta email_verified_at = NULL (mevcut hesap yolu şifre ister, değişmez); kabul yanıtı yeni hesapta `{verification_required: true}` + davet edilen adrese doğrulama e-postası (kayıttaki mekanizma, güvenlik rezervi); doğrulanmamış hesap girişte reddedilir; doğrulama sonrası audit account.email_verified; workspace başına günlük davet sınırı 50 (429 limit_reached); "bağlantıyı kopyala" kalır (GV-03-S1). Koltuk etkisi (seatEffect) doğrulamada (doğrulanmamış hesap koltuk tüketmez). Doğrulanmamış davet hesabının temizlenmesi kararı ADR notu olarak yazılır (varsayılan: kayıt temizleme işine benzer süreli temizlik).
contract account-lifecycle.yaml; web /join "E-postanı doğrula" durumu ve günlük sınır mesajı.

KABUL KRİTERLERİ:
- Yönetici kopyaladığı bağlantıyla başkası için şifre belirlese de giriş yapılamaz; davetli adresine doğrulama e-postası gider.
- Davetli e-postadaki bağlantıyla doğrular ve workspace'e katılır.
- Mevcut hesabın davet kabulü bugünkü gibi.
- Günlük 51. davet reddedilir.

KULLANILAN VARSAYIMLAR:
- GV-03-S1 bağlantı kopyalama kalır.
- GV-03-S2 günde 50.
- Koltuk doğrulamada sayılır.

**Test Strategy:**

Entegrasyon (davet akışı, sınır, mevcut hesap yolu), invite-seats.test.ts güncellenir; e2e auth-mail.spec.ts kalıbı + apps/e2e/tests/mailbox.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
