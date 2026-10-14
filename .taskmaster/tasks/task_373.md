# Task ID: 373

**Title:** ROUTING-RULES-UI-PARITY [SONNET-HIGH] Yönlendirme kuralları arayüzünün API ile eşitlenmesi: URL içerir/tam eşit çoklu değer, ülke çoklu seçim, URL normalleştirme, widget sohbetine country_code

**Status:** pending

**Dependencies:** 330 ⏱

**Priority:** medium

**Description:** API url_contains[], url_equals[], country_codes[] destekliyor; arayüz yalnız tek url_contains değeri gösteriyor. Widget sohbeti yönlendirmeye ülke iletmiyor. Kaynak: AU-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AU-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: RoutingRules.tsx:84, :125-142; settings.ts:421-423, :3301-3303; routing-service.ts:423-441 matches() (türler arası VE, tür içi VEYA); customer.ts:840 (yalnız URL); chats.ts:84,255.
web: koşul satırları (URL içerir/tam eşit, çip; Ülke çoklu seçim ISO), okunabilir özet, semantik açıklaması, "ülkesi bilinmeyenler sonraki kurala düşer" notu, GV-06 kalıbı.
api: customer.ts:840 yönlendirme bağlamına müşterinin country_code'u (GEOIP #330 doldurur); url_equals hem kayıtta hem eşleşmede normalleştirme (şema + host küçük harf, sorgu ve # atılır, sondaki / eşitlenir). Contract değişmez.

KABUL KRİTERLERİ:
- "URL tam eşit https://site.com/tr/para-yatir" kuralı sorgu parametreli aynı sayfadan gelen sohbeti eşler.
- "Ülke = TR, AZ" TR'den gelen widget sohbetini hedef ekibe yönlendirir.
- Mevcut tek URL'li kurallar değişmeden görünür ve düzenlenir.

KULLANILAN VARSAYIMLAR:
- AU-02'de açık soru yok.

**Test Strategy:**

RoutingRules.test.tsx, routing.test.ts (ülke, tam eşleşme); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
