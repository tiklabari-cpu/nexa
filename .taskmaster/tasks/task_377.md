# Task ID: 377

**Title:** IGAMING-CONNECT-PLACEHOLDERS [SONNET-HIGH] iGaming platform kartları F1 (K15): Ayarlar › Entegrasyonlar'da 1–2 platform (ör. BetConstruct, EveryMatrix) pasif "Bağla" düğmesi + "Yakında" etiketi; yalnız katalog kaydı

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** K15: gerçek entegrasyon F2; şimdilik platformlar kart olarak görünür, "Bağla" tıklanamaz. Arka uçta bağlantı akışı yok. Kaynak: KN-06.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: KN-06. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

K15 (sahip kararı): yalnız katalog kaydı ve arayüz kartı.
web: Ayarlar › Entegrasyonlar'da "iGaming platformu" bölümü; kartlar (ad, kısa açıklama, "Yakında" rozeti), "Bağla" disabled + aria-disabled + açıklayıcı tooltip; tıklama hiçbir istek atmaz.
types: statik katalog (packages/types/src/integrations.ts ya da web sabiti): {vendor, name, status:'coming_soon'}. Marka adları yalnız metin olarak; logo kullanılacaksa lisans kontrolü (yoksa metin).
api: değişiklik yok (ya da mevcut manifest'e salt okunur katalog — kodlayan seçer).
KAPSAM DIŞI: platform_connections, tool_invocations, satıcı adaptörleri → F2 (#378 deferred).

KABUL KRİTERLERİ:
- Entegrasyonlar sayfasında 1–2 platform kartı "Yakında" etiketiyle görünür.
- "Bağla" tıklanamaz, ağ isteği atmaz (test).
- Klavye/ekran okuyucu düğmenin pasif olduğunu bildirir.

KULLANILAN VARSAYIMLAR:
- K15.
- KN-06 P1 → medium (F1 parçası).

**Test Strategy:**

Web birim (disabled, istek yok), e2e görünürlük; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
