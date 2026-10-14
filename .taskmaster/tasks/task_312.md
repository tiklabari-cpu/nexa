# Task ID: 312

**Title:** REAL-WEB-CRAWLER [OPUS-XHIGH] Gerçek web sitesi taraması: tek sayfa / tüm alt sayfalar / sitemap, sayfa sınırı, robots, periyodik yenileme, değişiklik tespiti, iş kuyruğu (knowledge_jobs)

**Status:** pending

**Dependencies:** 289 ⏱, 309 ⏱

**Priority:** medium

**Description:** Getirme sahte: web-crawler.ts:32 mockFetcher her URL'ye "teslimat 3–5 gün" metni döndürüyor; casino sitesi eklenirse AI iade politikasıyla cevap verir. Link takibi/sitemap yok, tarama istek içinde eşzamanlı. Kaynak: AI-17.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-17. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3b — bilgi deposu ve bilgi kalitesi.

XHIGH GEREKÇESİ: (1) SSRF'e açık dış istek + güvenilmeyen HTML ayrıştırma.
KOD: web-crawler.ts :32 mockFetcher, :53 crawl, :72 htmlToText (regex); playbook.ts:679-739 (web sitesi dalı :696-701), yeniden indeksleme :1301, aralık PATCH :1180; knowledge-refresh-sweep.ts, jobs.ts:246 knowledge_refresh; knowledge-bulk-crawl.ts; lib/ssrf.ts :47, :99 HostResolver, :133, :200.
TİPLER: CRAWL_SCOPES single|all|sitemap; sınırlar (200 sayfa, derinlik 3, sayfa 5 MB, iş 200 MB); KNOWLEDGE_PAGE_STATUSES ok|unchanged|skipped_scope|robots_disallowed|blocked|needs_js|error|removed.
KONTRAT (KIRICI — web istemcisi aynı görevde güncellenir): oluşturma gövdesine crawl_scope, page_limit, include_paths, exclude_paths, brand_id; yanıt 201 status crawling + job_id; GET /knowledge-sources/{id}/pages, POST …/crawl, GET /knowledge-jobs/{id}, POST …/cancel.
PRİSMA: knowledge_sources crawl alanları, last_crawled_at, page_count; knowledge_pages (unique source_id+url_hash); knowledge_chunks.page_id; knowledge_jobs (kind crawl|refresh|document, status queued|running|waiting_budget|done|failed|cancelled, frontier jsonb, sayaçlar) + RLS.
ENV: CRAWLER_PROVIDER mock|http, varsayılan mock (kilitli karar); PILOT_MODE production'da http zorunlu.
SERVİS services/ai/crawler/: http-fetcher (her istek ve yönlendirme resolvePublicHttpTarget + pinnedConnection), frontier (normalleştirme: fragment, utm_*/gclid/fbclid, parametre sırası, sondaki /; canonical), robots (24 saat önbellek), sitemap (index ≤2 seviye, ≤50.000 URL), extract (script/style/nav/header/footer/aside/form/çerez bandı atılır; main/article; başlık "## ", liste "- ", tablo "| a | b |"; html lang; <200 karakter + çok script → needs_js); knowledge-job-runner (FOR UPDATE SKIP LOCKED, kiracı başına 1, global N; 15 sn iş, scheduler/lock.ts).
GETİRME: bot User-Agent, 10 sn, akışlı 5 MB, ≤5 yönlendirme (her adımda SSRF + kapsam), host başına ≥500 ms ve ≤2 eşzamanlı, 429/503 Retry-After (≤2), bot koruması → blocked, sıkıştırma bombası oranı.
DEĞİŞİKLİK: sha256 aynıysa unchanged (embedding yok); değiştiyse kısa transaction'da sayfa parçaları değiştirilir; iki ardışık 404/410 ya da kapsam dışı → removed + parçalar silinir.
KOTA: AiDailyCapError → waiting_budget, nextUtcMidnight'ta devam. Bitiş: ready/partial, AI-21 kaydı (knowledge.crawled), bildirim; inference.ts bölge kapısı embedding'den önce.
YENİLEME (AI-17-S1): değişen içerik varsayılan otomatik girer + "gözden geçir" listesi + Yönetici bildirimi; kaynak bazında "onaya tabi" (bonus/ödeme sayfalarında açık) — AI-20 gelince taslak olarak yazılır.
SINIR (S2): kaynak 200, kiracı toplam 2.000 sayfa. JS siteleri F1'de yok (S3), needs_js uyarısı.
HUKUKİ: ekleme modalında "bu siteyi taramaya yetkiliyim" onayı. HTML ayrıştırıcı: bakımlı, geri izlemesiz; lisans ve CVE kontrolü.
WEB: KnowledgeSourceActions ekleme modalı (kapsam, sınır, dahil/hariç, yenileme 5–365 gün, marka), detay çekmecesi (ilerleme 3 sn yoklama, sayfa tablosu, yeniden tara, hariç tut, needs_js/blocked çipleri).

KABUL KRİTERLERİ:
- Sitemap'inde kapsamda 50 URL olan site 50 sayfa ok olur; kapsam dışına istek yok.
- Özel IP'ye çözülen/yönlendiren URL'de bağlantı yok, sayfa error (resolver enjeksiyonu).
- robots yasaklı sayfa getirilmez.
- Yenilemede yalnız değişen sayfa embed edilir.
- İki kez 404 veren sayfanın parçaları silinir.
- Kota ortada dolarsa waiting_budget, gece yarısından sonra sürer.
- Testler CRAWLER_PROVIDER=mock ile ağsız; PILOT_MODE production'da mock reddedilir.
- Arayüz ilerlemeyi ve sayfa hatalarını Türkçe gösterir.

KULLANILAN VARSAYIMLAR:
- AI-17-S1/S2/S3 varsayılanları.

**Test Strategy:**

Birim (normalleştirme, kapsam, robots, sitemap index, tablo çıkarımı, değişiklik), entegrasyon (enjekte resolver/fetcher), e2e mock; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 312.1. CRAWL-SCHEMA [OPUS-HIGH] knowledge_pages, knowledge_jobs, kaynak alanları, page_id + kontrat (kırıcı yanıt) + tipler

**Status:** pending  
**Dependencies:** None  

Üst görev 312 ayrıntılarındaki ilgili bölüm.

### 312.2. CRAWL-FETCH-EXTRACT [OPUS-XHIGH] http-fetcher (SSRF), frontier, robots, sitemap, extract

**Status:** pending  
**Dependencies:** 312.1  

XHIGH GEREKÇESİ: (1) SSRF + güvenilmeyen girdi.

### 312.3. CRAWL-JOB-RUNNER [OPUS-MAX] knowledge-job-runner (SKIP LOCKED, kiracı başına 1), değişiklik tespiti, kota bekleme, refresh süpürmesinin kuyruğa bağlanması

**Status:** pending  
**Dependencies:** 312.2  

Eşzamanlılık/kilit.

### 312.4. CRAWL-WEB [SONNET-HIGH] Ekleme modalı + detay çekmecesi + Türkçe hata çipleri

**Status:** pending  
**Dependencies:** 312.3  

Üst görev 312 ayrıntılarındaki ilgili bölüm.
