# Task ID: 381

**Title:** MESSENGER-INSTAGRAM-LIVE [OPUS-HIGH] Gerçek Messenger / Instagram kanalları (K22: pending): ortak meta-graph istemcisi ve webhook doğrulayıcı, sayfa belirteci, PSID/IGSID, mid tekilliği, 24 saat penceresi

**Status:** pending

**Dependencies:** 380 ⏱

**Priority:** low

**Description:** Messenger ve Instagram adaptörleri mock. K22 gereği pending; Meta App Review izinleri iGaming'de zorlaşabilir. Kaynak: KN-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: KN-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: channels/messenger.ts, instagram.ts (mock); Channels.tsx MOCK_FACEBOOK_AUTH_CODE :1092-1097; e2e instagram.spec.ts; telegram-live.ts deseni.
api: KN-01 (#380) ile ortak meta-graph istemcisi + webhook doğrulayıcı; uzun ömürlü sayfa erişim belirteci + messages/messaging_postbacks aboneliği; Instagram Messaging (sayfaya bağlı profesyonel hesap); gönderim messaging_type RESPONSE; kimlikler sayfaya özel (birleştirme ID-03); 24 saat penceresi (HUMAN_AGENT 7 gün ayrı izin, kapsam dışı); hikâye yanıtı/bahsetme ilk sürümde düz mesaj; postback ↔ EN-02 send_message (#353).
prisma: KN-01'deki tekillik ve pencere alanı ortak.
web: gerçek bağlama akışı, sayfa/hesap seçimi. Gerçek anahtar yok, testte taklit.

KABUL KRİTERLERİ:
- Bağlanan sayfaya/hesaba gelen DM (taklit) Inbox'ta görünür, yanıt gönderim taklidine ulaşır.
- İmzasız istek reddedilir.
- Aynı mid iki kez yazılmaz.

KULLANILAN VARSAYIMLAR:
- K22: pending.
- P2 → low.

**Test Strategy:**

Payload fikstürleri (object page / instagram), imza, tekillik; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
