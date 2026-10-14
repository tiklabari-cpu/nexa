# Task ID: 352

**Title:** CAMPAIGN-MULTI-CONDITIONS [OPUS-HIGH] Çok koşullu kampanya hedefleme: {match all|any, rules[]} (url, oturum url, referrer, ülke, ziyaretçi tipi, sayfada süre, çıkış niyeti, özel değişken), SPA sayfa takibi, iki aşamalı değerlendirme

**Status:** pending

**Dependencies:** 351 ⏱, 330 ⏱

**Priority:** medium

**Description:** Koşul yalnız url_contains; tek sayfalık uygulamada sayfa değişimi izlenmiyor; ülke/çıkış niyeti/süre koşulu yok. Kaynak: EN-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: EN-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: domain.ts:451-454 CampaignConditions; campaign-matching.ts:63-86; campaign-trigger.ts:114-132; loader.ts:296-300/:329-335 (host_url yalnız yüklemede); widget.ts:3285 returningVisitor; loader.ts:115 siyahtus().
types/contract: CampaignConditions v2 {match, rules: Rule[]}; field current_url|session_url|referrer|country|visitor_type|time_on_page|exit_intent|custom_var; op contains|not_contains|equals|not_equals|gt|gte|lt|lte; eski {url_contains} → current_url contains; campaigns.yaml.
prisma: conditions JSON şeması değişmez, veri dönüştürme migration'ı; visits.variables JSONB; ülke GEOIP (#330).
api: kural motoru (sunucu kuralları); istemci kuralları (exit_intent, time_on_page) gönderimle widget'a "bekleyen koşul"; POST /customer/visit (sayfa değişimi + değişkenler, oran sınırlı — müşteri kovası 60/dk, debounce); teslim damgası istemci koşullu gönderimde "gösterildi" bildirimine taşınır (koşulsuzda mevcut davranış).
loader/widget: pushState/popstate → iframe mesajı (debounce), siyahtus('setSessionVariables'), çıkış niyeti (mouseout üst kenar, mobilde hızlı yukarı kaydırma), sayfada kalma zamanlayıcısı; sayfa değişimi bildirimi yalnız çalışan kampanyası olan kiracıda (mint bayrağı).
KURALLAR: özel değişken ≤20 anahtar, ≤100 karakter, kart maskeli, yalnız hedeflemede (05 karar 2); kampanya başına ≤10 kural; eşleme bellekte; IP saklanmaz.
web: koşul satırı oluşturucu (alan → operatör → değer), VE/VEYA.

KABUL KRİTERLERİ:
- "Ülke=TR VE sayfa /deposit içerir VE 30 sn" yalnız üçü sağlanınca; "Herhangi biri"nde biri yeterli.
- Çıkış niyeti kampanyası üst kenardan çıkınca görünür ve o an "gösterildi" sayılır.
- SPA'da sayfa değişimi koşulu doğru tetikler.
- Eski kampanyalar dönüşüm sonrası aynı ziyaretçilere gösterilir.

KULLANILAN VARSAYIMLAR:
- 05 EN-03 karar 2: özel değişkenler yalnız hedefleme.

**Test Strategy:**

Kural motoru birim (her operatör), eski koşul dönüşümü, loader SPA testi, widget.campaign.test.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
