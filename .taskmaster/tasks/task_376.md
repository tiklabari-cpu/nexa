# Task ID: 376

**Title:** HOSTED-API-DOCS [SONNET-HIGH] Barındırılan API dokümanı: x-public işaretli operasyonlardan üretilen tek dosya, CSP uyumlu statik görüntüleyici, PAT/webhook imza örnekleri, iç uç sızıntısı CI testi

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** OpenAPI tek doğruluk kaynağı ama dışa açık doküman yok; operatör geliştiricisi API'yi nasıl kullanacağını bilmiyor. Kaynak: KN-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: KN-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: packages/contract/openapi/openapi.yaml + paths/*.yaml (contract:generate); DeveloperPortal.tsx; Redoc/Swagger yok.
build: OpenAPI'yi tek dosyada birleştiren, yalnız x-public: true operasyonları içeren yayın adımı (varsayılan GİZLİ — yeni iç uç yanlışlıkla yayımlanmaz); ≈313 operasyonun envanteri bir kez çıkarılır (karar listesi HANDOFF/PLAN kanıtında).
sunum: statik doküman sayfası (/developers/docs), girişsiz, aranabilir, CSP uyumlu kendi barındırdığımız görüntüleyici (yeni bağımlılık gerekiyorsa PLAN §0 bağımlılık kuralına göre gerekçe), sürüm + değişiklik günlüğü.
içerik: PAT kimlik doğrulama örneği, webhook imza doğrulama örneği (HMAC + zaman damgası + nonce — gerçek imza fonksiyonuyla aynı sonucu veren test), oran sınırları, hata tipleri.
CI: birleştirme adımı + iç operasyon sızmadı testi (platform yönetimi, sandbox reset yok).
web: DeveloperPortal'dan bağlantı.

KABUL KRİTERLERİ:
- Doküman sayfası girişsiz açılır ve aranabilir.
- İç uçlar dokümanda yok (CI testi).
- Webhook imza örneği gerçek fonksiyonla aynı sonuç (test).

KULLANILAN VARSAYIMLAR:
- Envanter işi bu görevin parçası.

**Test Strategy:**

Yayın adımı testi, sızıntı testi, imza örneği testi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
