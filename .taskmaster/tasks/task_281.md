# Task ID: 281

**Title:** INVITE-DEFAULT-ROLE [SONNET-HIGH] Davette varsayılan rol en düşük rol (agent) — arayüz ve sunucu

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Davet penceresi varsayılanı admin (InviteTeammates.tsx:110), sunucu da rol yazılmamış daveti admin sayıyor (account-lifecycle.ts:89-92). Hızlı davette herkes faturaya, güvenliğe ve oyuncu verisi silmeye yetkili oluyor. Sihirbaz ise agent gönderiyor (OnboardingWizard.tsx:484) — tutarsız. Kaynak: RL-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RL-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 1 — hızlı güvenlik/temel düzeltmeler.

KAPSAM (bu görev): web varsayılanı 'agent'; seçicide her rolün altında kısa açıklama; Yönetici seçilince uyarı ("Bu rol faturalama ve güvenlik ayarlarına erişir"); contract account-lifecycle.yaml + API inviteBody.role.default('agent'). Davet edenin rütbesini aşamama kuralı korunur.
KAPSAM DIŞI: team_lead seçeneği ve "Ekip Lideri için ekip seçimi zorunlu" (RL-04-S1) → RL-01 görevi (#324) içinde, rol eklendiğinde.
Öncelik notu: P1 olduğu halde sahip bu maddeyi kritik ilk dalgaya koydu → high.

KABUL KRİTERLERİ:
- Davet penceresi açıldığında "Ekip Üyesi" seçili.
- POST /invitations gövdesinde rol yoksa agent olarak kaydedilir.
- Yönetici seçilince uyarı görünür.

KULLANILAN VARSAYIMLAR:
- RL-04-S1 (lider için ekip zorunlu) #324'te.

**Test Strategy:**

invite-seats.test.ts ve ilgili entegrasyon testleri güncellenir; e2e invite-seat-billing.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
