# Task ID: 330

**Title:** GEOIP-COUNTRY [OPUS-HIGH] (Opus 5.5) IP'den ülke (ortak bileşen): sunucu içinde çevrimdışı veritabanı, IP dışarı gitmez ve saklanmaz, ziyaret ve müşteri kaydına ülke kodu

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** customers.country_code yalnız elle/yönlendirme isteğiyle yazılıyor; IP'den ülke bulan bileşen yok. Oyuncu kartı (IN-02), kampanya ülke koşulu (EN-03) ve ülke yönlendirmesi (AU-02) aynı kaynağa ihtiyaç duyuyor — tek görevde kurulur. Kaynak: IN-02, EN-03, AU-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-02, EN-03, AU-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

services/geo/: çevrimdışı IP→ülke (ve şehir) okuyucu; veritabanı lisansı seçilir (MaxMind GeoLite2: kayıt + EULA; DB-IP Lite: CC-BY) ve güncelleme süreci runbook'a; testte sahte okuyucu (ağsız).
migration: visits.country_code, visits.city (nullable).
api: widget ziyaret başlangıcında/mint'te (routes/customer.ts, auth.ts) bir kez çözülür; customers.country_code boşsa doldurulur; IP saklanmaz, yalnız ülke kodu (EN-03-S1); her istekte yeniden hesaplanmaz.
Harita gösterilmez, yalnız ülke ve şehir (IN-02-S1).

KABUL KRİTERLERİ:
- Widget ziyaretinde ülke kodu ziyaret ve (boşsa) müşteri kaydına yazılır; IP saklanmaz, dış servise gitmez.
- Testler ağsız sahte okuyucuyla.

KULLANILAN VARSAYIMLAR:
- IN-02-S1, EN-03-S1 varsayılanları.
- Veritabanı lisans seçimi kodlayıcıya bırakıldı (07 açık risk).

**Test Strategy:**

Birim (okuyucu), entegrasyon (ziyaret kaydı); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
