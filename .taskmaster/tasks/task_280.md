# Task ID: 280

**Title:** WIDGET-LANGUAGE [SONNET-HIGH] Widget dili panelden seçilebilir ("Otomatik" = tarayıcı dili) + yedek dil; döküm e-postası oyuncunun dilinde

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** TR pilotunda widget İngilizce açılıyor: dil yalnız snippet parametresinden geliyor, boşta `en` (i18n.ts:29-32), navigator.language okunmuyor. Oyuncuya giden döküm e-postası da hep İngilizce. Kaynak: WG-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 1 — hızlı güvenlik/temel düzeltmeler.

KOD: loader.ts:26-27,:301; i18n.ts:29-32 resolveWidgetLocale; widget.ts mount createTranslator mint'ten önce; WidgetAppearance types/widget.ts:31-48; chat-service.ts #emailTranscript (dil bilinmiyor).
SIRA: types WidgetAppearance.language ('auto'|WidgetLocale), fallback_language → contract settings.yaml (/settings/widget) + customer-chat.yaml token yanıtı → migration WidgetSettings.language DEFAULT 'auto', fallback_language DEFAULT 'en' + CHECK; customers.locale nullable → API settings, mint, customer.ts ilk mesajda widget locale kaydı, #emailTranscript dili buradan → widget çözümleme zinciri + mint sonrası en fazla bir kez yeniden kurma (dir dahil) → web WidgetCustomization dil seçici (Enter ile submit etmez) → testler.
ÇÖZÜMLEME SIRASI (WG-02-S1): (1) snippet'te açık language → (2) panel ayarı auto değilse o → (3) auto ise navigator.languages içinde desteklenen ilk (birincil alt etiket) → (4) fallback_language.
YENİ ŞİRKETLERDE yedek dil 'tr' (04 varsayılanı); mevcut satırlar kolon varsayılanı 'en' ile değişmeden kalır.
K25: widget'a RU/AZ EKLENMEZ; 8 dil kalır.

KABUL KRİTERLERİ:
- tr-TR tarayıcı + snippet'te dil yok + panel auto → Türkçe.
- Panel en → İngilizce; snippet language:"de" panel ayarını geçersiz kılar (panelde not).
- Desteklenmeyen tarayıcı dili → yedek dil; ar → dir=rtl.
- Türkçe widget'tan başlayan sohbetin döküm e-postası Türkçe.

KULLANILAN VARSAYIMLAR:
- WG-02-S1 öncelik sırası.
- K25: widget dil sayısı 8 kalır.
- Yeni workspace yedek dili tr; mevcutlar en.

**Test Strategy:**

i18n.test.ts, loader.test.ts, widget.rtl.test.ts, API entegrasyon (mint + döküm dili), e2e i18n.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
