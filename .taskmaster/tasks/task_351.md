# Task ID: 351

**Title:** CAMPAIGN-CURRENT-URL-FIX [SONNET-HIGH] (Sonnet 5.5) Hata düzeltmesi: "geçerli sayfa URL'si" koşulu oturumdaki tüm sayfalara değil yalnız son sayfaya bakar; mint/poll anında host_url sayfa görüntülemesi

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** campaign-matching.ts:80 oturumdaki tüm sayfalarda arıyor; tip yorumu "bulunduğu sayfa" diyor — kod belgelenen niyetle çelişiyor (kodu düzelten görev). Kaynak: EN-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: EN-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: campaign-matching.ts:80 pageUrls.some(...), :23 visitorPageUrls; types/domain.ts:445-449; customer.ts:765-768; customer-service.ts:248-295 recordPageView.
api: matchesConditions imzası {currentUrl, sessionUrls}; url_contains yalnız currentUrl (= ziyaretin pages dizisindeki son kayıt); "oturumdaki herhangi bir sayfa" EN-03'te ayrı kural (#352); sohbet açmamış ziyaretçi için mint/poll anında host_url bir sayfa görüntülemesi olarak kaydedilir (ziyaret başına tek satır, sayfalar JSON deseni korunur).
Davranış değişikliği = hata düzeltmesi; sürüm notu; yanlış ateşlenmiş eski gönderimler geri alınmaz ((campaign, customer) tekil).

KABUL KRİTERLERİ:
- /withdraw → /casino sonrası /casino'da "withdraw içerir" kampanyası tetiklenmez; /withdraw'da tetiklenir.
- Sohbet açmamış ziyaretçinin mint anındaki sayfası eşleşmeye katılır.

KULLANILAN VARSAYIMLAR:
- EN-04'te açık soru yok.

**Test Strategy:**

campaign-matching.test.ts, campaign-trigger.test.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
