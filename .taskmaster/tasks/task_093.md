# Task ID: 93

**Title:** 07.7 — Rapor grupları v2 payı (Team performance/PDF/benchmark/Save view)  ·  dilim V2-4

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** Faz 2 (v2) · PLAN §5.2 · 12 atomik alt-görev. Bu turda kapsam süpürmesinde bulundu (PLAN §D62).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `07.7-v2`.

12 atomik alt-görev · ~13 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x3 · SONNET-MAX x1 · SONNET-XHIGH x7

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  07.7-a [SONNET-XHIGH] Cases rapor grubu — kontrat + lisans-kapsamlı ticket sorgusu + CSV exporter  (bağ: yok)
  07.7-b [OPUS-MAX] Leads rapor grubu — organizasyon-kapsamlı `customers` verisinin lisans sınırına oturtulması (izolasyon çekirdeği)  (bağ: 07.7-a)
  07.7-c [SONNET-MAX] Team performance rapor grubu — ajan bazlı KPI genişletmesi (mevcut by_agent üzerine)  (bağ: 07.7-b)
  07.7-d [SONNET-XHIGH] Sales rapor grubu — 13.5 Sales tracker'a bağlı `configured:false` dürüst iskelet  (bağ: 07.7-c)
  07.7-e [OPUS-XHIGH] Benchmark karşılaştırma katmanı — tüm rapor gruplarına ortak vs-baseline (lisans-içi, dönemler-arası)  (bağ: 07.7-a, 07.7-b, 07.7-c, 07.7-d)
  07.7-f [OPUS-XHIGH] Deterministik, bağımlılıksız PDF serializer (saf modül) — `toCsv`'nin PDF eşi  (bağ: yok)
  07.7-g [SONNET-XHIGH] PDF export rotası — `/reports/export` `format` parametresi + content-type/attachment bağlama  (bağ: 07.7-f, 07.7-d, 07.7-e)
  07.7-h [SONNET-XHIGH] Reports Save view — rapora özgü kaydedilmiş görünüm (saf modül, Inbox views deseni)  (bağ: yok)
  07.7-i [SONNET-XHIGH] Reports UI — Leads + Cases sekmeleri (kartlar + benchmark rozetleri + empty state)  (bağ: 07.7-a, 07.7-b, 07.7-e)
  07.7-j [SONNET-XHIGH] Reports UI — Sales + Team performance sekmeleri (ajan tablosu + `configured:false` empty state)  (bağ: 07.7-c, 07.7-d, 07.7-i)
  07.7-k [SONNET-XHIGH] Reports UI — Export butonu (CSV/PDF indirme) + Save view çubuğu  (bağ: 07.7-g, 07.7-h, 07.7-i, 07.7-j)
  07.7-l [OPUS-XHIGH] Uçtan uca doğrulama — 8 grup için izin matrisi, cross-tenant süpürmesi, ağır sorgu bütçesi (NFR-P7)  (bağ: 07.7-a, 07.7-b, 07.7-c, 07.7-d, 07.7-e, 07.7-f, 07.7-g, 07.7-h, 07.7-i, 07.7-j, 07.7-k)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): 07.7-b (Leads) tek bölünemez güvenlik çekirdeği. Gerekçe koda karşı: `customers` tablosu `organization_id` ile scope'lu (schema.prisma:228-236 — `licenseId` alanı YOK) ve RLS `app.current_organization` ile kapatılıyor (lib/tenant.ts:60); buna karşılık TÜM mevcut rapor sorguları `license_id` ile scope'lu (`WHERE t.license_id = ${licenseId}`, `ticketCount` `where:{licenseId}`). Bir Organization birden çok License taşır (`Organization.licenses License[]`). Dolayısıyla `customers.is_lead`'i doğrudan saymak, aynı organizasyonun KARDEŞ LİSANSLARININ müşterilerini bu lisansın raporuna sızdırır. Hangi sınırın doğru olduğu (org-scope mu, chats/tickets üzerinden lisans-bağlı join mi) bir erişim-kontrolü kararıdır; sorgu + RLS + negatif test aynı pencerede kalmalı, bölünürse izolasyon akıl yürütmesi kaybolur. Çekirdeğin ETRAFINDAKİ her şey daha ucuz etiketli alt-görevlere çıkarıldı: PDF serializer (07.7-f) ile rota bağlama (07.7-g SONNET) ayrıldı; Save view saf modülü (07.7-h SONNET) ile UI çubuğu (07.7-k SONNET) ayrıldı; dört rapor grubunun UI'ı iki ayrı SONNET penceresine (07.7-i / 07.7-j) bölündü.

VARSAYIMLAR: §V1 — BENCHMARK TANIMI: PRD 'benchmark karşılaştırma' der ama neye karşı olduğunu söylemez. Karar: benchmark = AYNI LİSANSIN kendi geçmişiyle karşılaştırması (baseline: önceki eşit-uzunluk dönem | geçen yıl aynı dönem). Dayanak: (a) FR-MOD-07.3.1 'vs. önceki dönem' deseni zaten teslim (reports.ts:516-517 + `previous_period`, tm 21); (b) lisanslar-arası/sektör karşılaştırması başka tenant'ların verisine erişim demektir — RLS izolasyonu ve ADR-12 tek bölge kısıtıyla çelişir. `baseline=industry` gibi değerler kod düzeyinde REDDEDİLİR ve negatif testle kilitlenir. · §V2 — PDF KAPSAMI: PDF çıktısı TABLO'dur; grafik/donut/bar çizimi yoktur. Dayanak: depoda hiçbir PDF/çizim bağımlılığı yok (package.json grep 0) ve CONVENTIONS'ın dış servis mock kuralı deterministik/yerel üretimi zorunlu kılıyor. Yeni npm bağımlılığı EKLENMEZ — PDF core font (Helvetica) ile elle yazılan, bayt-deterministik serializer kullanılır. · §V3 — LEADS/CASES EXPORT'U AGREGATTIR: Bu iki grup satır-bazlı müşteri verisi (ad/e-posta/telefon) döndürmez; yalnız sayılar/gün kırılımı döner. Dayanak: PRD KK'sı yalnız 'export' diyor, satır-bazlı PII export'u talep etmiyor; PII'li export ayrı bir maskeleme/scope kararı gerektirir ve bu kalemin kapsamında değildir. CSV'nin mevcut formül-enjeksiyon kalkanı (reports-export.ts:76-95) yine de tüm kullanıcı-etkili alanlarda (ör. Team performance'taki ajan adı) korunur. · §V4 — SAVE VIEW İSTEMCİ TARAFIDIR: Kaydedilmiş rapor görünümü `localStorage`'da tutulur, sunucuda tablo açılmaz. Dayanak: aynı özelliğin yazılı emsali Inbox'ta böyle teslim edildi (FR-MOD-02.1.4, tm 38, `features/inbox/views.ts`); PRD 07.7 kalıcılık/paylaşım için gereksinim yazmıyor. Cihazlar arası paylaşım istenirse ayrı kalem + migration gerekir. · §V5 — SALES GRUBU 13.5'E BAĞLIDIR: Şemada satış/sipariş tablosu yok; Sales grubu `configured:false` dürüst iskelet olarak teslim edilir (reviews raporundaki `ecommerce` bloğunun birebir emsali, reports.ts:796-802). FR-MOD-13.5 Sales tracker geldiğinde te

AÇIK SORULAR (ürün kararı): Leads sayımının lisans sınırı: 07.7-b 'bu lisansa dokunmuş lead' (chats/tickets join) yorumunu alıyor. Alternatif yorum 'organizasyon geneli lead' olurdu ve o da savunulabilir (customers zaten org-scope'lu). Karar 07.7-b penceresinde kodda gerekçesiyle sabitlenecek; ürün tarafı 'bir organizasyonun iki lisansı lead havuzunu paylaşır mı' sorusuna farklı cevap verirse alt-görev yeniden açılmalı. · Cases grubunda merge edilmiş ticket'lar (`merged_into_id IS NOT NULL`) sayılmalı mı? 07.7-a çift sayım olmasın diye `merged_into_id IS NULL` filtresini varsayıyor; 13.6 HelpDesk merge semantiğiyle çelişirse doğrulanmalı. · NFR-P7 ('ağır raporlar → read-replica / kolon-tabanlı analitik depo') bu depoda karşılanamaz (altyapı, §9 sınırı). 07.7-l ikame olarak aralık üst sınırı veya export rate-limit'i öneriyor — üst sınır kaç gün olmalı (365 mi, 730 mü)? Kararsız kalırsa varsayılan 365 gün alınır. · PDF'e benchmark bloğu nasıl yerleşecek: ayrı bir 'Önceki dönem' tablosu mu, yoksa her satırda delta sütunu mu? 07.7-g bunu tablo-şekli kararı olarak bırakıyor; UI ile tutarlılık istenirse delta sütunu tercih edilmeli. · Team performance sorgusunda mevcut `LIMIT 20` (reports.ts:697) korunacak mı, yoksa tam ajan listesi mi dönecek? Tam liste NFR-P7 yükstartırır; 07.7-c mevcut limiti korumayı varsayıyor ama yönetici ihtiyacı farklı olabilir.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 93.1. 07.7-a [SONNET-XHIGH] Cases rapor grubu — kontrat + lisans-kapsamlı ticket sorgusu + CSV exporter

**Status:** done  
**Dependencies:** None  

Contract-first: (1) `packages/contract/openapi/paths/reports.yaml`'a `cases` operation + `openapi.yaml`'a `/reports/cases` path ref; `pnpm --filter @siyahtus/contract generate` ile re-bundle. (2) `reports.ts`'e `casesByDay(tx, licenseId, from, to)` + `casesByStatus(...)` + `casesByPriority(...)` saf sorgu fonksiyonları (mevcut `(tx, licenseId, from, to)` imzası birebir) ve `GET /reports/cases` handler

**Details:**

07.7-a — Cases rapor grubu — kontrat + lisans-kapsamlı ticket sorgusu + CSV exporter  [SONNET-XHIGH]

PRD: FR-MOD-07.7 (+ NFR-S3)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 5 dosya + 2 test dosyası. (2) Güvenlik sınırı yok — `tickets` zaten `license_id` scope'lu (schema.prisma:625) ve mevcut `ticketCount` deseni aynen kopyalanıyor; yeni scope/authZ kararı yok, katalog satırı `scopes:['reports_read']` mirası. (3) Eşzamanlılık yok — salt-okunur agregasyon. (4) Kopyalanacak desen ismen var: `reports.ts` `/reports/reviews` handler'ı + `satisfactionByDay()` + `reports-export.ts` `buildGroupCsv` 'reviews' case'i. (5) Kontrat katkısal (yeni path + katalog satırı). (6) KK mekanik: grup listede görünür + CSV indirilir + yetkisiz token'a görünmez.
NEDEN AÇIK: `reports-export.ts:39-44` REPORT_GROUPS yalnız 4 grup taşıyor (overview/breakdown/ai-agent/reviews) — 'cases' grep 0. `reports.ts:343` `buildGroupCsv()` switch'inde 4 case var, `default` dalı `throw ApiError.validation('No exporter for report group: ...')` (satır 423-427) — kataloğa grup eklenip exporter eklenmezse 400 atar. `packages/contract/openapi/openapi.yaml:296-306` yalnız 6 reports path'i tanımlı, `/reports/cases` yok. `Ticket` modeli (schema.prisma:623) `licenseId` + `status` + `priority` + `createdAt` taşıyor ve `ticketCount()` (reports.ts:184) zaten lisans-kapsamlı sayıyor.
KAPSAM: Contract-first: (1) `packages/contract/openapi/paths/reports.yaml`'a `cases` operation + `openapi.yaml`'a `/reports/cases` path ref; `pnpm --filter @siyahtus/contract generate` ile re-bundle. (2) `reports.ts`'e `casesByDay(tx, licenseId, from, to)` + `casesByStatus(...)` + `casesByPriority(...)` saf sorgu fonksiyonları (mevcut `(tx, licenseId, from, to)` imzası birebir) ve `GET /reports/cases` handler'ı (`request.withTenant`, yanıt: `range` + `by_day` + `by_status` + `by_priority`). (3) `reports-export.ts` REPORT_GROUPS'a `{ id:'cases', label:'Cases', scopes:['reports_read'] }`. (4) `buildGroupCsv`'ye 'cases' case'i (zaman serisi şekli `date,open,closed,total` — 'breakdown'/'reviews' kalıbı).
DOSYALAR: packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · packages/contract/src/generated/api.ts · apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports-export.test.ts · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts (satır 244 `satisfactionByDay` + satır 279 `breakdownByDay` sorgu fonksiyonları ve `GET /reports/reviews` handler'ı — imza ve yanıt şekli birebir kopyalanacak) · apps/api/src/routes/reports-export.ts (satır 39-44 REPORT_GROUPS katalog satırı deseni) · apps/api/src/routes/reports.ts (satır 378-390 `buildGroupCsv` 'breakdown' case'i — zaman serisi CSV şekli) · packages/contract/openapi/paths/reports.yaml (`reviews` operation bloğu — açıklama/parametre/response şekli)
KK (birebir): "İzin bazlı görünürlük" | "export"
KK DOĞRULAMA: `reports-export.test.ts` — REPORT_GROUPS 'cases' içerir ve `visibleReportGroups([])` boş döner ('İzin bazlı görünürlük'). `reports-billing.test.ts` 'report groups + CSV export (07.7)' bloğu — `GET /reports/export?group=cases` 200 + `content-type: text/csv` + attachment adı `siyahtus-cases-<from>-<to>.csv` ('export'); `reports_read` taşımayan token `/reports/groups` yanıtında 'cases' görmez. `contract-parity.test.ts` yeşil (iki yönlü: belgelenmiş ama sunulmayan path de FAIL eder — dosya başlığı satır 14-17).
KAPSAM DIŞI: Satır-bazlı (PII taşıyan) ticket export'u — bu grup yalnız AGREGAT sayılar döner; müşteri adı/e-posta/konu metni CSV'ye girmez (varsayım §V3) · Leads/Sales/Team performance grupları (07.7-b/-c/-d) · Benchmark / vs-önceki dönem alanları (07.7-e) · PDF çıktısı (07.7-f/-g) · Web UI sekmesi (07.7-i) · Ticket merge/unmerge semantiği (13.6) — yalnız `merged_into_id IS NULL` filtresi uygulanır, yeni davranış tanımlanmaz
SÖZLEŞME: YENİ PATH: `GET /reports/cases` → `paths/reports.yaml`'a `cases` operation + `openapi.yaml` `paths` bloğuna `/reports/cases: $ref: "./paths/reports.yaml#/cases"`; `export` operation açıklamasındaki grup listesine 'cases' eklenir. ZORUNLU: `pnpm --filter @siyahtus/contract generate` ile re-bundle + `src/generated/api.ts` yeniden üretimi — aksi halde `contract-parity.test.ts` KIRILIR (iki yönlü kontrol).
MIGRATION: yok — `tickets` tablosu (schema.prisma:623) mevcut, yeni kolon/tablo gerekmiyor.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.2. 07.7-b [OPUS-MAX] Leads rapor grubu — organizasyon-kapsamlı `customers` verisinin lisans sınırına oturtulması (izolasyon çekirdeği)

**Status:** done  
**Dependencies:** 93.1  

(1) İzolasyon kararı: leads sayımı bu LİSANSA bağlanır — `customers` doğrudan sayılmaz; `chats`/`tickets` üzerinden `license_id` join'i ile bu lisansa dokunmuş lead'ler sayılır; organizasyon-geneli sayım açıkça reddedilir ve gerekçesi kodda yorumla kayda geçer. (2) `reports.ts`'e `leadsByDay(tx, licenseId, from, to)` + `leadTotals(...)` — mevcut imza; `request.withTenant` içinde (RLS hem org hem l

**Details:**

07.7-b — Leads rapor grubu — organizasyon-kapsamlı `customers` verisinin lisans sınırına oturtulması (izolasyon çekirdeği)  [OPUS-MAX]

PRD: FR-MOD-07.7 (+ NFR-S3 yetkilendirme, NFR-P7 ağır rapor)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ihlali — tenant izolasyon sınırı. `customers` tablosu `organization_id` scope'lu (schema.prisma:228-236, licenseId YOK) ve RLS `app.current_organization` ile kapatılıyor (lib/tenant.ts:60); tüm rapor sorguları ise `license_id` scope'lu. Bir Organization birden çok License taşır (`Organization.licenses License[]`), dolayısıyla `is_lead` naif sayımı kardeş lisansların müşterilerini bu lisansın raporuna sızdırır. Hangi sınırın doğru olduğu bir erişim-kontrolü kararıdır ve yanlışı pahalıdır. Çekirdek bölünmez; etrafındaki UI (07.7-i) ve export butonu (07.7-k) ayrı ve daha ucuz etiketlere çıkarıldı.
NEDEN AÇIK: `customers.is_lead` alanı schema.prisma:236'da mevcut (`Boolean @default(false) @map("is_lead")`) ama `reports.ts` içinde `customer`/`isLead` grep 0 — Reports yüzeyi bu alanı hiç tüketmiyor. `reports-export.ts:39-44` kataloğunda 'leads' yok. `openapi.yaml:296-306` içinde `/reports/leads` yok. Ayrıca `Customer` modelinde `licenseId` alanı YOKTUR (schema.prisma:228-252 — yalnız `organizationId`), oysa `reports.ts`'in her sorgusu `license_id` ile filtreliyor — iki farklı scope ekseni.
KAPSAM: (1) İzolasyon kararı: leads sayımı bu LİSANSA bağlanır — `customers` doğrudan sayılmaz; `chats`/`tickets` üzerinden `license_id` join'i ile bu lisansa dokunmuş lead'ler sayılır; organizasyon-geneli sayım açıkça reddedilir ve gerekçesi kodda yorumla kayda geçer. (2) `reports.ts`'e `leadsByDay(tx, licenseId, from, to)` + `leadTotals(...)` — mevcut imza; `request.withTenant` içinde (RLS hem org hem license set eder). (3) `GET /reports/leads` handler'ı. (4) Kontrat: `paths/reports.yaml` `leads` operation + `openapi.yaml` ref + re-bundle. (5) REPORT_GROUPS'a `{ id:'leads', label:'Leads', scopes:['reports_read'] }` + `buildGroupCsv` 'leads' case'i. (6) NEGATİF TESTLER ÖNCE: aynı organizasyonun ikinci lisansı için lead sızmıyor; başka organizasyon 0.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/src/lib/tenant.ts · packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/test/integration/reports-billing.test.ts · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts (satır 279 `breakdownByDay` — `WHERE t.license_id = ${licenseId}` desenli lisans-kapsamlı raw sorgu) · apps/api/src/routes/customers.ts (satır 109/149 `tx.customer.findFirst` — RLS'e güvenen org-kapsamlı erişim; bu alt-görevin REDDEDECEĞİ desen, karşılaştırma için) · apps/api/test/integration/tenant-isolation.test.ts (cross-tenant negatif test kalıbı)
KK (birebir): "İzin bazlı görünürlük" | "export"
KK DOĞRULAMA: `tenant-isolation.test.ts` — AYNI organizasyonun iki lisansı kurulur; L1'de lead olan müşteri L2'nin `/reports/leads` yanıtında ve `?group=leads` CSV'sinde SAYILMAZ (izolasyon kararının kanıtı). `reports-billing.test.ts` — `reports_read` taşımayan token `/reports/groups` yanıtında 'leads' görmez ('İzin bazlı görünürlük'); `GET /reports/export?group=leads` 200 + text/csv ('export').
KAPSAM DIŞI: Satır-bazlı lead export'u (müşteri adı/e-posta/telefon) — AGREGAT sayı döner, PII CSV'ye girmez (varsayım §V3); PII'li export ayrı kalem olarak kendi maskeleme/scope kararıyla açılmalı · CRM tarafındaki lead yönetimi (MOD-03) — bu alt-görev yalnız okuma/raporlama · `customers` tablosuna `license_id` kolonu eklemek — çapraz-kesen şema değişikliği, bu pencerede YAPILMAZ · Web UI sekmesi (07.7-i), PDF (07.7-f/-g), benchmark (07.7-e)
SÖZLEŞME: YENİ PATH: `GET /reports/leads` → `paths/reports.yaml` `leads` operation + `openapi.yaml` `/reports/leads` ref; `export` açıklamasındaki grup listesine 'leads' eklenir. ZORUNLU re-bundle (`pnpm --filter @siyahtus/contract generate`) — aksi halde `contract-parity.test.ts` KIRILIR (iki yönlü).
MIGRATION: yok — `customers.is_lead` (schema.prisma:236) mevcut. `customers`'a `license_id` EKLENMEZ (kapsam dışı); izolasyon join ile çözülür.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.3. 07.7-c [SONNET-MAX] Team performance rapor grubu — ajan bazlı KPI genişletmesi (mevcut by_agent üzerine)

**Status:** done  
**Dependencies:** 93.2  

(1) `reports.ts`'e `teamPerformanceByAgent(tx, licenseId, from, to)` — mevcut `SPLIT_COUNTS` fragment'i (satır 117-123) yeniden kullanılır; üzerine ajan başına ortalama ilk-yanıt/süre + `ratings` join'li good/bad/CSAT + transfer sayısı eklenir; limit kararı breakdown deseniyle hizalanır. (2) `GET /reports/team-performance` handler'ı. (3) Kontrat: `paths/reports.yaml` `teamPerformance` operation + 

**Details:**

07.7-c — Team performance rapor grubu — ajan bazlı KPI genişletmesi (mevcut by_agent üzerine)  [SONNET-MAX]

PRD: FR-MOD-07.7 (+ NFR-P7 ağır rapor)
ETİKET GEREKÇESİ: SONNET-MAX: koşul 2 ve 3 sağlanıyor (yeni güvenlik sınırı YOK — `breakdown` raporu zaten `reports_read` sahibine `by_agent` kırılımı veriyor, reports.ts:677-698; yeni scope/izolasyon kararı yok, `WHERE t.license_id` filtresi aynen miras alınıyor; eşzamanlılık yok, salt-okunur agregasyon). ANCAK iş mekanik olarak GİRİFT: dört agregasyon ekseni (chat split, ilk-yanıt/süre ortalamaları, ratings→threads→assignee join'li CSAT, transfer sayımı) tek sorgu şekline oturtuluyor — yoğun rapor sorgusu, daha fazla düşünme bütçesi ister. Kopyalanacak desen ismen var (`SPLIT_COUNTS` + breakdown byAgent raw sorgusu) → OPUS'a çıkarılmadı.
NEDEN AÇIK: `reports.ts:677-698` breakdown içinde ajan bazlı sorgu ZATEN VAR (`SELECT t.assignee_id::text AS agent_id, a.name, ${SPLIT_COUNTS} ... LIMIT 20`) — ajan kırılımı sıfırdan değil; eksik olan ADANMIŞ 'team-performance' RAPOR GRUBU: `reports-export.ts:39-44` kataloğunda yok, `openapi.yaml:296-306` içinde `/reports/team-performance` yok, `buildGroupCsv` switch'inde case'i yok. Ajan bazlı CSAT için gereken bağ mevcut: `Rating` modeli `threadId` taşıyor (schema.prisma:719), `threads.assignee_id` üzerinden join edilebilir.
KAPSAM: (1) `reports.ts`'e `teamPerformanceByAgent(tx, licenseId, from, to)` — mevcut `SPLIT_COUNTS` fragment'i (satır 117-123) yeniden kullanılır; üzerine ajan başına ortalama ilk-yanıt/süre + `ratings` join'li good/bad/CSAT + transfer sayısı eklenir; limit kararı breakdown deseniyle hizalanır. (2) `GET /reports/team-performance` handler'ı. (3) Kontrat: `paths/reports.yaml` `teamPerformance` operation + `openapi.yaml` ref + re-bundle. (4) REPORT_GROUPS'a `{ id:'team-performance', label:'Team performance', scopes:['reports_read'] }` + `buildGroupCsv` case'i (satır başına bir ajan; ajan adı kullanıcı-etkili alan → mevcut `FORMULA_LEAD` kalkanı `csvField` üzerinden otomatik uygulanır, reports-export.ts:76-95).
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports-export.test.ts · packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts (satır 677-698 breakdown `byAgent` raw sorgusu — ajan join'i + SPLIT_COUNTS kullanımı birebir kopyalanacak) · apps/api/src/routes/reports.ts (satır 117-123 `SPLIT_COUNTS` Prisma.sql fragment'i) · apps/api/src/routes/reports.ts (satır 189-210 `satisfactionCounts` — ratings agregasyonu deseni) · apps/api/src/routes/reports.ts (satır 391-410 `buildGroupCsv` 'ai-agent' case'i — CSV şekli)
KK (birebir): "İzin bazlı görünürlük" | "export"
KK DOĞRULAMA: `reports-billing.test.ts` — `GET /reports/team-performance` her ajan için chats/closed/automated/assisted/manual + avg_first_response_seconds + CSAT döner; oy verilmemiş ajanda CSAT `null` (0 değil — mevcut `satisfactionScore` kuralı, reports.ts:211-214). `?group=team-performance` CSV'de `=` ile başlayan ajan adı `'` ön ekiyle nötrleniyor ('export' + formül-enjeksiyon kalkanı korunmuş). `reports-export.test.ts` — katalogda var + yetkisiz scope'ta görünmez ('İzin bazlı görünürlük').
KAPSAM DIŞI: Isı haritası / saat × ajan çapraz kırılımı — FR-MOD-07.5 'Metrics breakdown (ajan/takım/kanal/saat)' kaleminin işi (PLAN §5.0 satır 1107), burada YAPILMAZ · Takım (group) ve kanal boyutları — yine 07.5 · Ajan performansına dayalı otomatik yönlendirme/uyarı · Web UI sekmesi (07.7-j)
SÖZLEŞME: YENİ PATH: `GET /reports/team-performance` → `paths/reports.yaml` + `openapi.yaml` ref + `export` açıklamasına grup eklenir. ZORUNLU re-bundle — aksi halde `contract-parity.test.ts` KIRILIR.
MIGRATION: yok — `threads.assignee_id`, `accounts`, `ratings.thread_id` (schema.prisma:719) mevcut.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.4. 07.7-d [SONNET-XHIGH] Sales rapor grubu — 13.5 Sales tracker'a bağlı `configured:false` dürüst iskelet

**Status:** done  
**Dependencies:** 93.3  

(1) `reports.ts`'e `GET /reports/sales` handler'ı — reviews'ün `ecommerce` bloğuyla AYNI dürüst şekil: `{ range, configured:false, tracked_sales:null, attributed_revenue_cents:null, currency:null, conversions:null }`; 13.5 geldiğinde tek yerden doldurulur. (2) Kontrat: `paths/reports.yaml` `sales` operation (açıklamasında 13.5 bağımlılığı açıkça yazılır) + `openapi.yaml` ref + re-bundle. (3) REPOR

**Details:**

07.7-d — Sales rapor grubu — 13.5 Sales tracker'a bağlı `configured:false` dürüst iskelet  [SONNET-XHIGH]

PRD: FR-MOD-07.7 (+ FR-MOD-13.5 bağımlılığı)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 4 dosya + testleri. (2) Güvenlik sınırı yok — hiçbir veri okunmuyor, sabit `configured:false` bloğu dönüyor. (3) Eşzamanlılık yok. (4) Kopyalanacak desen İSMEN var ve birebir aynı problem için yazılmış: `reports.ts:796-802` reviews raporundaki `ecommerce: { configured:false, tracked_sales:null, attributed_revenue_cents:null, currency:null }` bloğu. (5) Kontrat katkısal. (6) KK mekanik: grup listede görünür, `configured:false` döner, CSV tek satır.
NEDEN AÇIK: Şemada satış/sipariş tablosu YOK — `grep '^model ' schema.prisma` çıktısında Order/Sale/Transaction modeli bulunmuyor. Mevcut tek satış izi `reports.ts:796-802`'deki reviews raporunun `ecommerce` bloğu ve o blok zaten `configured:false` + `tracked_sales:null` döndürüyor (PLAN §4.4.8: 'e-ticaret satış izleme iskeleti (configured=false, §13.5 v2)'). `reports-export.ts:39-44` kataloğunda 'sales' yok.
KAPSAM: (1) `reports.ts`'e `GET /reports/sales` handler'ı — reviews'ün `ecommerce` bloğuyla AYNI dürüst şekil: `{ range, configured:false, tracked_sales:null, attributed_revenue_cents:null, currency:null, conversions:null }`; 13.5 geldiğinde tek yerden doldurulur. (2) Kontrat: `paths/reports.yaml` `sales` operation (açıklamasında 13.5 bağımlılığı açıkça yazılır) + `openapi.yaml` ref + re-bundle. (3) REPORT_GROUPS'a `{ id:'sales', label:'Sales', scopes:['reports_read'] }` + `buildGroupCsv` 'sales' case'i (metric/value şekli; null değerler `csvField` ile boş hücre). (4) UI bağlama 07.7-j'de anlamlı empty state ile.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports-export.test.ts · packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts (satır 796-802 reviews `ecommerce: { configured:false, tracked_sales:null, ... }` bloğu — birebir aynı 'henüz yapılandırılmadı' sözleşmesi) · apps/api/src/routes/reports.ts (satır 366-377 `buildGroupCsv` 'overview' case'i — metric/value CSV şekli) · apps/api/src/routes/reports-export.ts (satır 39-44 katalog satırı)
KK (birebir): "İzin bazlı görünürlük" | "export"
KK DOĞRULAMA: `reports-billing.test.ts` — `GET /reports/sales` 200 + `configured:false` + tüm sayısal alanlar `null` (0 DEĞİL — yapılandırılmamış ile sıfır satış farklı şeydir, reviews `ecommerce` kuralıyla aynı). `?group=sales` CSV 200 + metric/value başlığı. `reports-export.test.ts` — katalogda 'sales' + yetkisiz scope'ta görünmez ('İzin bazlı görünürlük').
KAPSAM DIŞI: Gerçek satış izleme, sipariş/gelir modeli, dönüşüm atfı — tamamı FR-MOD-13.5 Sales tracker'ın işi (PLAN §5.0) · `orders`/`sales` tablosu migration'ı — bu pencerede AÇILMAZ · Goals hunisi (FR-MOD-13.3) — ayrı v2 kalemi · Web UI sekmesi (07.7-j)
SÖZLEŞME: YENİ PATH: `GET /reports/sales` → `paths/reports.yaml` + `openapi.yaml` ref + `export` açıklamasına grup eklenir. ZORUNLU re-bundle — aksi halde `contract-parity.test.ts` KIRILIR.
MIGRATION: yok — bilinçli olarak tablo AÇILMAZ; `configured:false` sözleşmesi 13.5'e kadar geçerlidir.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.5. 07.7-e [OPUS-XHIGH] Benchmark karşılaştırma katmanı — tüm rapor gruplarına ortak vs-baseline (lisans-içi, dönemler-arası)

**Status:** done  
**Dependencies:** 93.1, 93.2, 93.3, 93.4  

(1) Belirsizlik kararı kodda yorumla kayda geçer: benchmark = AYNI LİSANSIN kendi geçmişiyle karşılaştırması (`baseline: previous_period | previous_year`); lisanslar-arası/sektör karşılaştırması AÇIKÇA reddedilir. (2) `reports.ts:516-517`'deki pencere hesabı ve `previous_period` üretimi tek `benchmarkWindow(from, to, baseline)` + `withBenchmark(...)` yardımcısına çıkarılır — overview/reviews davra

**Details:**

07.7-e — Benchmark karşılaştırma katmanı — tüm rapor gruplarına ortak vs-baseline (lisans-içi, dönemler-arası)  [OPUS-XHIGH]

PRD: FR-MOD-07.7 (+ FR-MOD-07.3.1 vs-önceki dönem deseni, NFR-S3)
ETİKET GEREKÇESİ: OPUS-XHIGH: KK'da YORUM GEREKTİREN BELİRSİZLİK + çok yüzeyli bağlama + hafif güvenlik dokunuşu. PRD 'benchmark karşılaştırma' der ama neye karşı olduğunu söylemez; lisanslar-arası/sektör yorumu tenant izolasyonunu ihlal ederdi (RLS + ADR-12), bu yüzden yorumun kendisi bir erişim-sınırı kararıdır ve sonnet'e verilmez. Ayrıca kontrat + 8 operation + ortak yardımcı fonksiyon aynı anda bağlanıyor (yeni veri şekli tasarımı). Güvenlik çekirdeği UYGULANMIYOR (yalnız lisans-içi agregasyon) → MAX değil XHIGH.
NEDEN AÇIK: Kod tabanında 'benchmark' kelimesi YALNIZ yorum satırlarında geçiyor — grep'in 5 isabetinin hepsi yorum/açıklama: `reports-export.ts:15`, `reports.ts:821`, `paths/reports.yaml:179`, `generated/api.ts:2720` (üretilmiş), `lib/ssrf.ts:144` (alakasız 198.18.0.0/15 CIDR'ı). Hiçbir servis/route/model implementasyonu yok. Buna karşılık karşılaştırma ALTYAPISI var: `reports.ts:516-517` 'The comparison window: the same span immediately before `from`' + `previous_period` bloğu (satır 599 overview, satır 788 reviews) — hesap iki grupta yazılmış ama ortak yardımcıya çıkarılmamış ve diğer gruplarda yok.
KAPSAM: (1) Belirsizlik kararı kodda yorumla kayda geçer: benchmark = AYNI LİSANSIN kendi geçmişiyle karşılaştırması (`baseline: previous_period | previous_year`); lisanslar-arası/sektör karşılaştırması AÇIKÇA reddedilir. (2) `reports.ts:516-517`'deki pencere hesabı ve `previous_period` üretimi tek `benchmarkWindow(from, to, baseline)` + `withBenchmark(...)` yardımcısına çıkarılır — overview/reviews davranışı DEĞİŞMEZ. (3) `?baseline=` query parametresi tüm rapor endpoint'lerine eklenir (varsayılan `previous_period` → geriye dönük uyumlu). (4) Kontrat: her operation'a `baseline` parametresi + `previous_period` şeması; re-bundle. (5) `buildGroupCsv` çıktısına benchmark sütun/satırı.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports-metrics.test.ts · packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts (satır 516-520 karşılaştırma penceresi hesabı + satır 565-605 overview `previous_period` bloğu — çıkarılacak ortak mantığın kaynağı) · apps/api/src/routes/reports.ts (satır 770-795 reviews `previous_period` — ikinci kopya, aynı yardımcıya taşınacak) · apps/api/src/routes/reports.ts (satır 87 `resolveRange` — query parametresi çözümleme deseni)
KK (birebir): "benchmark karşılaştırma"
KK DOĞRULAMA: `reports-metrics.test.ts` (saf unit) — `benchmarkWindow` eşit uzunlukta ve `from`'dan 1 ms önce biten pencere üretir; `previous_year` baseline'ı 365 gün kaydırır. `reports-billing.test.ts` — her rapor grubu `?baseline=previous_period` ile `previous_period` bloğu döner; `baseline` verilmezse overview/reviews çıktısı MEVCUT testlerle birebir aynı kalır. Cross-tenant negatif: benchmark yanıtı hiçbir koşulda başka lisansın rakamını içermez.
KAPSAM DIŞI: Lisanslar-arası / sektör / anonim havuz benchmark'ı — AÇIKÇA REDDEDİLDİ (tenant izolasyonu; varsayım §V1). İstenirse ayrı kalem olarak kendi izolasyon+anonimleştirme tasarımıyla açılmalı · Hedef/SLA eşiği tanımlama (Goals, FR-MOD-13.3) · Benchmark'ın UI rozetleri — 07.7-i/-j (mevcut `Kpi` delta bileşeni yeniden kullanılır) · PDF çıktısında benchmark yerleşimi (07.7-g)
SÖZLEŞME: YENİ PATH YOK — mevcut reports operation'larına katkısal `baseline` query parametresi + `previous_period` şema bloğu. Yine de re-bundle (`pnpm --filter @siyahtus/contract generate`) ZORUNLU; parametre/şema `src/generated/api.ts`'e yansımazsa web istemcisi tip hatası verir.
MIGRATION: yok — hesaplama katmanı; benchmark referans tablosu AÇILMAZ.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.6. 07.7-f [OPUS-XHIGH] Deterministik, bağımlılıksız PDF serializer (saf modül) — `toCsv`'nin PDF eşi

**Status:** done  
**Dependencies:** None  

Yalnızca SAF modül — sunucu/rota yok. `toPdf(title, headers, rows, meta)`: tek/çok sayfalı tablo düzeni, PDF core font (Helvetica — dosya gömme yok), DETERMİNİSTİK çıktı (aynı girdi → bayt-birebir aynı çıktı; değişken tarih/UUID üretilmez, `meta`'dan alınır). Metin kaçışı: `(`, `)`, `\` PDF string kaçışı ZORUNLU. CSV'nin `FORMULA_LEAD` kalkanı PDF'te GEÇERSİZDİR (PDF formül çalıştırmaz) — gerekçes

**Details:**

07.7-f — Deterministik, bağımlılıksız PDF serializer (saf modül) — `toCsv`'nin PDF eşi  [OPUS-XHIGH]

PRD: FR-MOD-07.7 (Export CSV/PDF)
ETİKET GEREKÇESİ: OPUS-XHIGH: SONNET koşul 4 ihlali — depoda kopyalanacak MEVCUT bir PDF deseni YOK (`grep -n pdf` apps/api/package.json + apps/web/package.json + kök package.json → 0 isabet; hiçbir PDF kütüphanesi bağımlılığı yok). Yeni bir çıktı-format algoritması (PDF obje/xref/stream düzeni + metin kaçışı) tasarlanıyor ve bağımlılık ekleme kararı ADR düzeyinde bir seçim. Güvenlik ÇEKİRDEĞİ değil (authZ/izolasyon yok) → MAX değil XHIGH. Çekirdek burada izole edildi; rota bağlama işi 07.7-g'ye SONNET-XHIGH olarak çıkarıldı — pahalı pencere küçültüldü.
NEDEN AÇIK: `reports-export.ts` içinde `toCsv()` dışında hiçbir serializer yok (satır 96-104 tek serializer). `reports.ts:843` export rotası yalnız `'text/csv; charset=utf-8'` content-type döndürüyor. `apps/*` ve kök package.json dosyalarında 'pdf' geçen bağımlılık YOK (grep 0). Modülün kendi başlığı bunu ertelediğini yazıyor: `reports-export.ts:14-16` 'PDF and benchmark comparison are explicitly out of scope for v1'.
KAPSAM: Yalnızca SAF modül — sunucu/rota yok. `toPdf(title, headers, rows, meta)`: tek/çok sayfalı tablo düzeni, PDF core font (Helvetica — dosya gömme yok), DETERMİNİSTİK çıktı (aynı girdi → bayt-birebir aynı çıktı; değişken tarih/UUID üretilmez, `meta`'dan alınır). Metin kaçışı: `(`, `)`, `\` PDF string kaçışı ZORUNLU. CSV'nin `FORMULA_LEAD` kalkanı PDF'te GEÇERSİZDİR (PDF formül çalıştırmaz) — gerekçesiyle kod yorumuna yazılır ki yanlışlıkla taşınmasın. Dış servis yok (CONVENTIONS dış servis mock kuralıyla uyumlu: üretim tamamen yerel/deterministik).
DOSYALAR: apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports-export.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports-export.ts (satır 96-104 `toCsv` — imza şekli `(headers, rows) => string`, saf ve sunucusuz test edilebilirlik felsefesi; satır 76-95 `csvField` kaçış disiplini) · apps/api/src/routes/reports-export.ts (satır 106-113 `exportFilename` — uzantı parametrelenecek) · apps/api/src/routes/reports-export.test.ts (satır 47-79 `toCsv` unit test kalıbı — PDF için aynı yapı)
KK (birebir): "export"
KK DOĞRULAMA: `reports-export.test.ts` — `toPdf(...)` çıktısı `%PDF-` ile başlar, `%%EOF` ile biter, tutarlı `xref` taşır; AYNI girdiyle iki çağrı bayt-birebir eşit (determinizm); `(`/`)`/`\` içeren hücre kaçışlanmış görünür ve dosya bozulmaz; 0 satırlı tablo geçerli PDF üretir (boş dosya değil).
KAPSAM DIŞI: Rota bağlama, `format` query parametresi, content-type/attachment başlıkları — 07.7-g · Web UI indirme butonu — 07.7-k · Grafik/donut/bar çizimi — PDF yalnız TABLO üretir (varsayım §V2) · Yeni npm bağımlılığı eklemek — açıkça YAPILMAZ · Fatura PDF'i (10.3-a faturaları CSV indiriyor) — dokunulmaz
SÖZLEŞME: yok — bu alt-görev yalnız saf modül ekler, rota/OpenAPI değişmez.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.7. 07.7-g [SONNET-XHIGH] PDF export rotası — `/reports/export` `format` parametresi + content-type/attachment bağlama

**Status:** done  
**Dependencies:** 93.6, 93.4, 93.5  

(1) `exportQuery` zod şemasına `format: z.enum(['csv','pdf']).default('csv')`. (2) Rota gövdesinde tek dallanma: `format==='pdf'` → `toPdf(...)` + `content-type: application/pdf` + `.pdf` uzantılı attachment; CSV yolu DEĞİŞMEZ. (3) `exportFilename(groupId, from, to, ext)` — uzantı parametrelenir, mevcut çağrılar `'csv'` varsayılanıyla kırılmaz. (4) Mevcut güvenlik başlıkları (`x-content-type-optio

**Details:**

07.7-g — PDF export rotası — `/reports/export` `format` parametresi + content-type/attachment bağlama  [SONNET-XHIGH]

PRD: FR-MOD-07.7 (Export CSV/PDF)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 4 dosya. (2) Güvenlik sınırı yok — mevcut `EXPORT_SCOPES` route-gate + grup-bazlı `hasAnyScope` yeniden denetimi (reports.ts:822-836) AYNEN korunur, yeni scope/karar eklenmez. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `reports.ts:838-853` mevcut CSV dalı (withTenant → buildGroupCsv → toCsv → header'lar). (5) Kontrat katkısal (mevcut path'e `format` parametresi). (6) KK mekanik: `?format=pdf` → application/pdf + .pdf uzantılı attachment.
NEDEN AÇIK: `reports.ts:843-853` export rotası tek dalda `toCsv(...)` çağırıp `'text/csv; charset=utf-8'` gönderiyor — `format` parametresi grep 0; `exportQuery` zod şemasında yalnız `group`+`from`+`to` var. `paths/reports.yaml:180-191` `export` operation'ında yalnız `group`/`from`/`to` parametreleri tanımlı ve response yalnız `text/csv`.
KAPSAM: (1) `exportQuery` zod şemasına `format: z.enum(['csv','pdf']).default('csv')`. (2) Rota gövdesinde tek dallanma: `format==='pdf'` → `toPdf(...)` + `content-type: application/pdf` + `.pdf` uzantılı attachment; CSV yolu DEĞİŞMEZ. (3) `exportFilename(groupId, from, to, ext)` — uzantı parametrelenir, mevcut çağrılar `'csv'` varsayılanıyla kırılmaz. (4) Mevcut güvenlik başlıkları (`x-content-type-options: nosniff`, `cache-control: no-store`) HER İKİ formatta da korunur. (5) Kontrat: `export` operation'ına `format` parametresi + `application/pdf` response içeriği; `paths/reports.yaml:179`'daki 'PDF ... v2 ... not offered here' cümlesi düzeltilir; re-bundle.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports-export.test.ts · packages/contract/openapi/paths/reports.yaml · packages/contract/src/generated/api.ts · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts (satır 822-853 `GET /reports/export` — scope gate, grup çözümleme, withTenant, başlıklar; PDF dalı bu yapının içine girer) · apps/api/src/routes/reports-export.ts (satır 106-113 `exportFilename` — uzantı parametrelenecek fonksiyon) · packages/contract/openapi/paths/reports.yaml (satır 180-201 `export` operation parametre + response bloğu)
KK (birebir): "export" | "İzin bazlı görünürlük"
KK DOĞRULAMA: `reports-billing.test.ts` — `GET /reports/export?group=overview&format=pdf` 200 + `content-type: application/pdf` + `content-disposition` `.pdf` uzantılı + gövde `%PDF-` ile başlıyor ('export'). `format` verilmeyince davranış birebir eskisi (text/csv) — geriye dönük uyum regresyonu. `reports_read` taşımayan token `format=pdf` ile de 403 ('İzin bazlı görünürlük' — format yetkiyi değiştirmez).
KAPSAM DIŞI: PDF içeriğinin görsel tasarımı/grafikleri — 07.7-f'de tablo olarak sabitlendi · Web UI indirme butonu — 07.7-k · Zamanlanmış (scheduled) export — ayrı v2 kalemi `07.9-sched` (PLAN §5.0) · Fatura PDF'i (10.3-a)
SÖZLEŞME: YENİ PATH YOK — mevcut `GET /reports/export`'a katkısal `format` query parametresi (enum csv|pdf, default csv) + `application/pdf` response content'i; `paths/reports.yaml:179` açıklaması güncellenir. ZORUNLU re-bundle — `src/generated/api.ts` yenilenmezse web istemcisi `format`'ı tip düzeyinde göremez.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.8. 07.7-h [SONNET-XHIGH] Reports Save view — rapora özgü kaydedilmiş görünüm (saf modül, Inbox views deseni)

**Status:** done  
**Dependencies:** None  

Yalnızca SAF modül: `apps/web/src/features/reports/report-views.ts` — `SavedReportView { id, name, tab, mode, customFrom, customTo, baseline }` tipi; `isSavedReportView` katı doğrulayıcı (bilinmeyen `tab`/`mode` değerini DÜŞÜRÜR — bozuk/eski `localStorage` kaydı ekranı kırmaz); `safeStorage()`; `loadSavedReportViews`/`saveSavedReportViews`/`addSavedReportView`/`removeSavedReportView`; `useSavedRep

**Details:**

07.7-h — Reports Save view — rapora özgü kaydedilmiş görünüm (saf modül, Inbox views deseni)  [SONNET-XHIGH]

PRD: FR-MOD-07.7 (Save view)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya (yeni modül + testi). (2) Güvenlik sınırı yok — yalnız istemci tarafı `localStorage`, sunucuya yazılmaz, PII taşımaz (yalnız sekme adı + tarih aralığı). (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var ve BİREBİR aynı problem için yazılmış: `apps/web/src/features/inbox/views.ts` satır 96-243 (`SavedView`/`SavedViewInput` tipleri, `isSavedView` doğrulayıcı, `safeStorage` try/catch, `loadSavedViews`/`saveSavedViews`/`addSavedView`/`removeSavedView`, `useSavedViews` hook'u). (5) Kontrat değişikliği YOK. (6) KK mekanik: ekle/sil/reload-sonrası-kalıcı.
NEDEN AÇIK: Reports'a özgü kaydedilmiş görünüm YOK — `apps/web/src/features/reports/` dizininde yalnız `ReportsPage.tsx` + `ReportsPage.test.tsx` var (ls çıktısı); `SavedView` grep'i yalnız `features/inbox/views.ts` ve `features/inbox/InboxPage.tsx`'te isabet ediyor. `ReportsPage.tsx`'te sekme/aralık state'i (`tab`, `mode`, `customFrom`, `customTo` — satır 157-160) yalnız `useState` ile tutuluyor, hiçbir kalıcılık yok.
KAPSAM: Yalnızca SAF modül: `apps/web/src/features/reports/report-views.ts` — `SavedReportView { id, name, tab, mode, customFrom, customTo, baseline }` tipi; `isSavedReportView` katı doğrulayıcı (bilinmeyen `tab`/`mode` değerini DÜŞÜRÜR — bozuk/eski `localStorage` kaydı ekranı kırmaz); `safeStorage()`; `loadSavedReportViews`/`saveSavedReportViews`/`addSavedReportView`/`removeSavedReportView`; `useSavedReportViews()` hook'u. Ayrı `STORAGE_KEY = 'siyahtus.reports.saved-views'` (Inbox'ın `siyahtus.inbox.saved-views` anahtarıyla çakışmaz). İsim uzunluk sınırı `SAVED_VIEW_NAME_MAX` emsaline göre. UI bağlama 07.7-k'da.
DOSYALAR: apps/web/src/features/reports/report-views.ts · apps/web/src/features/reports/report-views.test.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/inbox/views.ts (satır 96-243 — `SavedView` tipi, `isSavedView` katı doğrulayıcı, `safeStorage`, load/save/add/remove, `useSavedViews` hook'u: BİREBİR kopyalanacak mimari) · apps/web/src/features/inbox/views.test.ts (19 test — aynı test kalıbı: bozuk kayıt düşürme, storage throw'unda çökmeme, ekle/sil/round-trip)
KK (birebir): "KK-türetilmiş: "Save view" — PRD FR-MOD-07.7 gereksinim başlığında ve rapor-1-fonksiyonel.md §MOD-07.7 öğe listesinde geçiyor ama PRD'nin KK sütunu yalnız "İzin bazlı görünürlük; export; benchmark karşılaştırma" diyor — Save view için KK yazılmamış. Türetilen kriter: "Bir rapor görünümü (sekme + tarih aralığı + baseline) adla kaydedilir; listeden seçilince aynı görünüm geri gelir; silinebilir; sayfa yenilendikten sonra kalıcıdır; bozuk/eski kayıt ekranı kırmaz." Gerekçe: aynı özelliğin yazılı emsali FR-MOD-02.1.4 'custom saved views eklenebilir' (tm 38, teslim) — davranış oradan türetildi, uydurulmadı."
KK DOĞRULAMA: `report-views.test.ts` — ekle → `loadSavedReportViews` aynı kaydı döner (kalıcılık); sil → liste küçülür; `localStorage`'a elle `{"tab":"hacked"}` yazılırsa kayıt DÜŞER (katı doğrulayıcı); `getItem` throw ederse boş liste döner ve exception sızmaz; boş ad / sınır üstü ad reddedilir.
KAPSAM DIŞI: Sunucu tarafı kalıcılık / `report_views` tablosu — AÇILMAZ (varsayım §V4); cihazlar arası paylaşım istenirse ayrı kalem · Görünüm paylaşma / URL deep-link — 02.7-a'nın `ticket_sort` deseni ayrıdır, burada YAPILMAZ · UI çubuğu ve butonlar — 07.7-k · Inbox `views.ts`'i değiştirmek / ortaklaştırmak — dokunulmaz (regresyon riski)
SÖZLEŞME: yok — tamamen istemci tarafı, hiçbir API çağrısı yok.
MIGRATION: yok — bilinçli olarak `report_views` tablosu açılmaz.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.9. 07.7-i [SONNET-XHIGH] Reports UI — Leads + Cases sekmeleri (kartlar + benchmark rozetleri + empty state)

**Status:** done  
**Dependencies:** 93.1, 93.2, 93.5  

(1) `TABS` dizisine `{ id:'leads', label:'Leads' }` + `{ id:'cases', label:'Cases' }`. (2) `LeadsTab` ve `CasesTab` bileşenleri — `useReport<ReportsLeads>('leads', ...)` / `useReport<ReportsCases>('cases', ...)`; `Kpi`/`KpiGrid` kartları + günlük seri; benchmark rozetleri MEVCUT `Kpi` delta desenini (Overview'ün vs-önceki rozetleri) yeniden kullanır. (3) `previous_period` alanı geldiğinde delta gö

**Details:**

07.7-i — Reports UI — Leads + Cases sekmeleri (kartlar + benchmark rozetleri + empty state)  [SONNET-XHIGH]

PRD: FR-MOD-07.7 (+ FR-EK-B.1 anlamlı empty state)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya (sayfa + testi) + e2e dokunuşu. (2) Güvenlik sınırı yok — salt-okunur render; yetki kararı backend'de (07.7-a/-b). (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `ReportsPage.tsx` `TABS` dizisi (satır 120-123) + `useReport<T>()` generic hook'u (satır 238) + `ReviewsTab` (satır 545) render dalı + `Kpi`/`KpiGrid`/`Card`/`CardSkeleton`/`ErrorNotice`/`EmptyState` bileşenleri. (5) Kontrat değişikliği yok (endpoint'ler 07.7-a/-b'de geldi). (6) KK mekanik: sekme render, veri yokken empty state, yetki yokken sekme görünmez.
NEDEN AÇIK: `ReportsPage.tsx:120-123` `TABS` dizisi yalnız 4 eleman taşıyor (`overview`/`ai-agent`/`reviews`/`breakdown`) — Leads/Cases sekmesi yok. `useReport<T>(kind, api, props)` (satır 238) grup-parametreli generic veri çekme sağlıyor ve dört tab bileşeni (satır 248/472/545/773) aynı kalıbı tekrarlıyor — yeni sekme bu kalıbın beşinci/altıncı örneğidir.
KAPSAM: (1) `TABS` dizisine `{ id:'leads', label:'Leads' }` + `{ id:'cases', label:'Cases' }`. (2) `LeadsTab` ve `CasesTab` bileşenleri — `useReport<ReportsLeads>('leads', ...)` / `useReport<ReportsCases>('cases', ...)`; `Kpi`/`KpiGrid` kartları + günlük seri; benchmark rozetleri MEVCUT `Kpi` delta desenini (Overview'ün vs-önceki rozetleri) yeniden kullanır. (3) `previous_period` alanı geldiğinde delta gösterilir, gelmezse rozet yok (07.7-e'ye uyumlu). (4) Boş pencerede `EmptyState` (boş dikdörtgen değil — FR-EK-B.1). (5) Sekme görünürlüğü `/reports/groups` yanıtına bağlanır: yetkisiz kullanıcıda sekme RENDER EDİLMEZ (backend zaten 403 verir; UI gizleme tek başına yetki değildir — kod yorumunda not edilir).
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx · apps/e2e/tests/reports.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/reports/ReportsPage.tsx (satır 120-123 `TABS` dizisi; satır 238 `useReport<T>` generic hook; satır 545 `ReviewsTab` — yeni sekmenin birebir kalıbı) · apps/web/src/components/Page.tsx (`Card`/`CardSkeleton`/`ErrorNotice`/`Kpi`/`KpiGrid`/`Section` bileşenleri) · apps/web/src/components/EmptyState.tsx (anlamlı empty state deseni, FR-EK-B.1) · apps/web/src/features/reports/ReportsPage.test.tsx (mevcut sekme render testleri kalıbı)
KK (birebir): "İzin bazlı görünürlük" | "benchmark karşılaştırma"
KK DOĞRULAMA: `ReportsPage.test.tsx` — 'Leads' ve 'Cases' sekmeleri render edilir ve tıklanınca ilgili endpoint çağrılır; `/reports/groups` yanıtında grup yoksa sekme RENDER EDİLMEZ ('İzin bazlı görünürlük'); `previous_period` gelen alanda delta rozeti görünür ('benchmark karşılaştırma'); veri boşken `EmptyState` metni görünür, boş dikdörtgen değil.
KAPSAM DIŞI: Sales / Team performance sekmeleri — 07.7-j · Export butonu + Save view çubuğu — 07.7-k · Grafik kütüphanesi eklemek — mevcut `Kpi`/`Card` bileşenleriyle sayı/liste render edilir · Backend sorgu değişikliği — 07.7-a/-b'de kilitlendi
SÖZLEŞME: yok — endpoint'ler 07.7-a/-b'de sözleşmeye girdi; bu alt-görev yalnız tüketir.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.10. 07.7-j [SONNET-XHIGH] Reports UI — Sales + Team performance sekmeleri (ajan tablosu + `configured:false` empty state)

**Status:** done  
**Dependencies:** 93.3, 93.4, 93.9  

(1) `TABS` dizisine `{ id:'sales', label:'Sales' }` + `{ id:'team-performance', label:'Team performance' }`. (2) `SalesTab` — `configured:false` iken 13.5'e işaret eden ANLAMLI empty state, sıfır rakam GÖSTERMEZ (null ≠ 0 kuralı backend'le hizalı). (3) `TeamPerformanceTab` — ajan başına satır tablosu (chats/closed/automated/assisted/manual/avg first response/CSAT); CSAT `null` olan ajanda '—', %0 

**Details:**

07.7-j — Reports UI — Sales + Team performance sekmeleri (ajan tablosu + `configured:false` empty state)  [SONNET-XHIGH]

PRD: FR-MOD-07.7 (+ FR-EK-B.1 anlamlı empty state, NFR-P4 liste)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya + e2e dokunuşu. (2) Güvenlik sınırı yok — salt-okunur render. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `ReportsPage.tsx:773` `BreakdownTab` içindeki `by_agent` tablosu (aynı ajan-satırı render'ı) + `ReviewsTab`'in `ecommerce.configured` dalı + `EmptyState`. (5) Kontrat değişikliği yok. (6) KK mekanik: sekme render, `configured:false` → anlamlı empty state, yetki yoksa sekme yok.
NEDEN AÇIK: `ReportsPage.tsx:120-123` `TABS` dizisinde Sales / Team performance sekmesi yok. Ancak ajan tablosu render'ı sıfırdan değil: `ReportsBreakdown` arayüzü `by_agent: Array<SplitRow & { agent_id, name }>` taşıyor (satır 80-84) ve `BreakdownTab` (satır 773) bunu render ediyor. `configured:false` empty state emsali de var: `ReportsReviews.ecommerce.configured` alanı (satır 105-111).
KAPSAM: (1) `TABS` dizisine `{ id:'sales', label:'Sales' }` + `{ id:'team-performance', label:'Team performance' }`. (2) `SalesTab` — `configured:false` iken 13.5'e işaret eden ANLAMLI empty state, sıfır rakam GÖSTERMEZ (null ≠ 0 kuralı backend'le hizalı). (3) `TeamPerformanceTab` — ajan başına satır tablosu (chats/closed/automated/assisted/manual/avg first response/CSAT); CSAT `null` olan ajanda '—', %0 değil. Mevcut tablo/`VirtualTable` bileşeni kullanılabiliyorsa tercih edilir. (4) Sekme görünürlüğü `/reports/groups` yanıtına bağlı.
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx · apps/e2e/tests/reports.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/reports/ReportsPage.tsx (satır 773+ `BreakdownTab` `by_agent` tablo render'ı — Team performance satır kalıbı) · apps/web/src/features/reports/ReportsPage.tsx (satır 545+ `ReviewsTab` — `ecommerce.configured` dalı, Sales empty state emsali) · apps/web/src/components/EmptyState.tsx · apps/web/src/features/inbox/TicketGrid.tsx (sıralanabilir/virtualize tablo deseni, T6-a `VirtualTable`)
KK (birebir): "İzin bazlı görünürlük"
KK DOĞRULAMA: `ReportsPage.test.tsx` — 'Sales' ve 'Team performance' sekmeleri render edilir; `/reports/groups` bunları döndürmezse sekme YOK ('İzin bazlı görünürlük'); `configured:false` yanıtında anlamlı empty state görünür ve hiçbir sayı '0' olarak gösterilmez; CSAT `null` olan ajan satırında '—' görünür.
KAPSAM DIŞI: Isı haritası görselleştirmesi — FR-MOD-07.5 · Satış verisi gösterimi — FR-MOD-13.5 gelince doldurulur · Export butonu + Save view çubuğu — 07.7-k · Ajan detay sayfasına derin bağlantı
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.11. 07.7-k [SONNET-XHIGH] Reports UI — Export butonu (CSV/PDF indirme) + Save view çubuğu

**Status:** done  
**Dependencies:** 93.7, 93.8, 93.9, 93.10  

(1) `Page` `actions` alanına Export kontrolü: aktif sekme + seçili aralık ile `GET /reports/export?group=<tab>&from&to&format=csv|pdf` çağrısı → Blob indirme; `content-disposition` adı korunur; yetkisiz/hatalı durumda GÖRÜNÜR hata (sessiz yutma yok). (2) Save view çubuğu: 07.7-h'nin `useSavedReportViews()` hook'u bağlanır — 'Bu görünümü kaydet' (ad girişi, boş ad reddi, alan-altı hata + submit pas

**Details:**

07.7-k — Reports UI — Export butonu (CSV/PDF indirme) + Save view çubuğu  [SONNET-XHIGH]

PRD: FR-MOD-07.7 (Export + Save view) (+ FR-EK-A.1 alan-altı hata)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 3 dosya. (2) Güvenlik sınırı yok — indirme yetkisi backend'de (`EXPORT_SCOPES` + grup-bazlı denetim, reports.ts:822-836); UI yalnız mevcut token'la istek atar. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: Save view için `InboxPage.tsx` satır 300-302 (`onSelectSaved`/`onAddSavedView`/`onRemoveSavedView` bağlama); indirme için `BillingPage` fatura CSV indirme akışı; yerleşim için `ReportsPage.tsx:162` `Page actions={<RangeControls/>}` slot'u. (5) Kontrat değişikliği yok. (6) KK mekanik: butona bas → dosya iner; görünüm kaydet → yeniden yüklemede kalıcı.
NEDEN AÇIK: `ReportsPage.tsx` içinde 'csv'/'download'/'export' araması YALNIZCA `export function ReportsPage` satırında isabet ediyor (satır 156) — yani v1'de CSV export API düzeyinde teslim edildi ama WEB'DE İNDİRME BUTONU HİÇ YOK (PLAN §D35 bunu doğruluyor: 'web rapor grupları = `ReportsPage.tsx` tabs'). Save view kontrolü de yok — sekme/aralık state'i (satır 157-160) yalnız `useState`.
KAPSAM: (1) `Page` `actions` alanına Export kontrolü: aktif sekme + seçili aralık ile `GET /reports/export?group=<tab>&from&to&format=csv|pdf` çağrısı → Blob indirme; `content-disposition` adı korunur; yetkisiz/hatalı durumda GÖRÜNÜR hata (sessiz yutma yok). (2) Save view çubuğu: 07.7-h'nin `useSavedReportViews()` hook'u bağlanır — 'Bu görünümü kaydet' (ad girişi, boş ad reddi, alan-altı hata + submit pasif — T4-a form primitifi deseni), kayıtlı görünüm listesi (seç → sekme+aralık+baseline geri gelir), sil. (3) Kayıtlı görünüm seçimi `tab`/`mode`/`customFrom`/`customTo`/`baseline` state'ini toptan uygular.
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx · apps/e2e/tests/reports.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/inbox/InboxPage.tsx (satır 181-184 + 300-302 — `useSavedViews` bağlama, `onSelectSaved`/`onAddSavedView`/`onRemoveSavedView` prop kalıbı) · apps/web/src/features/reports/ReportsPage.tsx (satır 160-175 `Page actions={<RangeControls .../>}` — Export kontrolünün takılacağı slot) · apps/web/src/features/billing/BillingPage.tsx (fatura CSV indirme akışı — Blob/attachment indirme deseni) · apps/web/src/features/reports/report-views.ts (07.7-h'de gelen hook)
KK (birebir): "export" | "İzin bazlı görünürlük" | "KK-türetilmiş: "Save view" (türetme gerekçesi 07.7-h'de) — bu alt-görevin payı: "Kayıtlı görünüm listeden seçilince sekme + tarih aralığı + baseline geri gelir; adsız kayıt reddedilir; silinebilir.""
KK DOĞRULAMA: `ReportsPage.test.tsx` — Export butonuna basınca `/reports/export?group=<aktif sekme>&format=csv` çağrılır ve indirme tetiklenir; `format=pdf` seçilince aynı çağrı `format=pdf` ile gider ('export'). Yetkisiz sekmede Export butonu görünmez ('İzin bazlı görünürlük'). Görünüm kaydet → yeniden mount sonrası aynı sekme+aralık geri gelir; boş adla kaydet → alan-altı hata + submit pasif (türetilmiş Save view KK'ı). E2E `reports.spec.ts`'te indirme + kayıtlı görünüm akışı.
KAPSAM DIŞI: Sunucu tarafı kayıtlı görünüm — 07.7-h kapsam dışı kararıyla aynı · Zamanlanmış export UI'ı — `07.9-sched` ayrı kalem · İndirilen dosyanın içeriği/serileştirmesi — 07.7-f/-g'de kilitlendi · Inbox Views çubuğunu değiştirmek
SÖZLEŞME: yok — mevcut `/reports/export` tüketilir.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 93.12. 07.7-l [OPUS-XHIGH] Uçtan uca doğrulama — 8 grup için izin matrisi, cross-tenant süpürmesi, ağır sorgu bütçesi (NFR-P7)

**Status:** done  
**Dependencies:** 93.1, 93.2, 93.3, 93.4, 93.5, 93.6, 93.7, 93.8, 93.9, 93.10, 93.11  

(1) İzin matrisi süpürmesi: 8 grup × {`/reports/groups` listesi, JSON endpoint, CSV export, PDF export} için tablo-güdümlü test; boş-liste-değil-403 tasarım kararının (NFR-S3, reports.ts:806-810) 4 yeni grupta da korunduğu kanıtlanır. (2) Cross-tenant süpürmesi: `tenant-isolation.test.ts`'e 4 yeni endpoint + iki export formatı eklenir; 07.7-b'nin org/lisans kararı bağımsız fixture ile tekrar doğru

**Details:**

07.7-l — Uçtan uca doğrulama — 8 grup için izin matrisi, cross-tenant süpürmesi, ağır sorgu bütçesi (NFR-P7)  [OPUS-XHIGH]

PRD: FR-MOD-07.7 (+ NFR-S3 yetkilendirme, NFR-P7 ağır raporlar)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama + hafif güvenlik dokunuşu. Sekiz rapor grubunun (4 mevcut + 4 yeni) izin matrisi, iki format (CSV/PDF), iki baseline ve iki tenant ekseni ÇAPRAZ denetleniyor; bir yüzeyin eksik kapatıldığını görmek dosya-lokal değil sistem düzeyinde akıl yürütmedir. Güvenlik ÇEKİRDEĞİ burada uygulanmıyor (kararlar 07.7-b'de verildi) → MAX değil XHIGH. SONNET olamaz: koşul 2 ihlali (yetki/izolasyon denetimi) ve koşul 6 ihlali (hangi kombinasyonun anlamlı olduğu yorum gerektirir).
NEDEN AÇIK: Mevcut testler 4-grup varsayımıyla yazılmış: `reports-export.test.ts` REPORT_GROUPS'u dizi olarak dolaşıyor (satır 20 ve satır 30 `visible).toEqual(REPORT_GROUPS.map(...))`), `reports-billing.test.ts` 'report groups + CSV export (07.7)' bloğu 11 test (PLAN §D35). Ayrıca `reports.ts` export rotasında AYRI BİR RATE-LIMIT görülmedi — rota yalnız `config: { scopes: EXPORT_SCOPES }` taşıyor (satır 822); NFR-P7 'ağır raporlar → read-replica / ayrı kolon-tabanlı analitik depo' diyor (PRD:748) ve bu depoda karşılığı yok.
KAPSAM: (1) İzin matrisi süpürmesi: 8 grup × {`/reports/groups` listesi, JSON endpoint, CSV export, PDF export} için tablo-güdümlü test; boş-liste-değil-403 tasarım kararının (NFR-S3, reports.ts:806-810) 4 yeni grupta da korunduğu kanıtlanır. (2) Cross-tenant süpürmesi: `tenant-isolation.test.ts`'e 4 yeni endpoint + iki export formatı eklenir; 07.7-b'nin org/lisans kararı bağımsız fixture ile tekrar doğrulanır. (3) NFR-P7 kapısı: Team performance ve Leads sorguları için ölçüm alınır; gerekiyorsa export rotasına ayrı rate-limit VEYA aralık üst sınırı (varsayılan 365 gün) eklenir ve gerekçesi kodda yazılır; karar HANDOFF'a kanıtla geçer. (4) E2E `reports.spec.ts` tam akış: sekmeler → benchmark → export (CSV+PDF) → save view.
DOSYALAR: apps/api/test/integration/reports-billing.test.ts · apps/api/test/integration/tenant-isolation.test.ts · apps/api/src/routes/reports-export.test.ts · apps/api/src/routes/reports.ts · apps/e2e/tests/reports.spec.ts · apps/web/src/features/reports/ReportsPage.test.tsx
REFERANS DESEN (kopyalanacak): apps/api/test/integration/tenant-isolation.test.ts (cross-tenant negatif fixture kalıbı) · apps/api/test/integration/reports-billing.test.ts ('report groups + CSV export (07.7)' bloğu — genişletilecek 11 test) · apps/api/test/integration/route-config.test.ts (rota scope/config denetimi deseni) · apps/api/src/routes/reports.ts (satır 806-836 — boş-liste-değil-403 kararı + iki katmanlı scope denetimi)
KK (birebir): "İzin bazlı görünürlük" | "export" | "benchmark karşılaştırma"
KK DOĞRULAMA: `reports-billing.test.ts` — 8 grup × yetki var/yok matrisi tablo-güdümlü koşar: `reports_read` yokken `/reports/groups` BOŞ liste (403 değil), her JSON endpoint 403, her export 403 ('İzin bazlı görünürlük'). Her grup CSV+PDF olarak indirilir ('export'). Her grup `?baseline=previous_period` ile karşılaştırma bloğu döner ('benchmark karşılaştırma'). `tenant-isolation.test.ts` — 4 yeni endpoint + 2 format için başka lisans/organizasyon verisi sızmıyor. E2E `reports.spec.ts` tam akış yeşil.
KAPSAM DIŞI: Yeni özellik eklemek — bu alt-görev yalnız doğrular ve gerekirse aralık sınırı/rate-limit ekler · Read-replica / kolon-tabanlı analitik depo kurmak (NFR-P7'nin tam çözümü) — altyapı işi, bu deponun dışında (§9); burada yalnız ölçüm + koruyucu sınır · tm 46'yı yeniden açmak — v1 payı kapalı (PLAN §D35); bu kırılım YENİ task olarak açılır · FR-MOD-07.5 / 07.6 / 07.9-sched kalemleri
SÖZLEŞME: Aralık üst sınırı eklenirse `paths/reports.yaml`'daki `from`/`to` parametre açıklamalarına sınır notu yazılır (yeni path YOK); yine de re-bundle çalıştırılır.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
