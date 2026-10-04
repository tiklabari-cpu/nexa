# Task ID: 97

**Title:** 06.3.2-bulk — Bulk/CSV KB import (YALNIZ çoklu-satır; tek-kaynak yolu v1'de ✅)  ·  dilim V2-6

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** Faz 2 (v2) · PLAN §5.2.13 · 8 atomik alt-görev.
KAPSAM SINIRI — ÖNEMLİ: FR-MOD-06.3.2'nin TEK KAYNAK yolu v1'de TESLİM EDİLDİ (tm 33.4): geçersiz URL/tür reddi + website crawl/parse + SSRF guard + RAG indeksleme (routes/playbook.ts POST /knowledge-sources · services/ai/web-crawler.ts · lib/ssrf.ts · services/ai/knowledge-service.ts, testleriyle). PLAN.md:520 satırındaki ✅ ODUR — bu görev DEĞİL.
BU GÖREV YALNIZ: çoklu-satır CSV/bulk yolu. Koda karşı doğrulandı 2026-08-01: parseCsv/csv-parse/papaparse grep 0 · playbook.yaml'da 'bulk' grep 0 · /knowledge-sources yalnız 2 yol (koleksiyon + {sourceId}) · apps/api/package.json'da csv/multipart bağımlılığı yok.
Mevcut tek-kaynak yolunu YENİDEN YAZMA — üstüne otur (bkz. alt-görev referans desenleri).

**Details:**

!! KAPSAM SINIRI: FR-MOD-06.3.2'nin tek-kaynak yolu v1'de ✅ teslim (tm 33.4, PLAN.md:520). Bu görev YALNIZ çoklu-satır CSV/bulk yolunu kapsar. Mevcut crawl/SSRF/index yolunu yeniden yazma.
Panel bu ayrımı 'plan-tm-reverse' çelişkisi olarak işaretledi (9c619e2b7579) — yanlış-pozitif; eşleştirici '-bulk' sonekini atıp v1 satırıyla eşleştiriyor. Karar: PLAN §D67.

Faz 2 (v2) · PLAN §5.2 · kalem `06.3.2-bulk`.

8 atomik alt-görev · ~11 pencere · etiket dağılımı: OPUS-MAX x3 · OPUS-XHIGH x1 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  06.3.2-bulk-a [OPUS-MAX] RFC4180 CSV ayrıştırıcı + formül-enjeksiyon nötrleme (saf modül, lineer zaman)  (bağ: —)
  06.3.2-bulk-b [SONNET-XHIGH] CSV satır şeması: kolon eşleme + satır-başı doğrulama (saf modül)  (bağ: —)
  06.3.2-bulk-c [OPUS-MAX] POST /knowledge-sources/bulk — kontrat + route: tenant sahipliği, satır tavanı, tx sınırı, kısmi-başarı zarfı  (bağ: 06.3.2-bulk-a, 06.3.2-bulk-b)
  06.3.2-bulk-d [SONNET-XHIGH] Frontend saf yardımcılar: örnek CSV şablonu katalogu + dosya okuma/ön-kontrol modülü  (bağ: —)
  06.3.2-bulk-e [SONNET-XHIGH] Knowledge panelinde "Bulk import" formu: dosya seç → dry-run önizleme  (bağ: 06.3.2-bulk-c, 06.3.2-bulk-d)
  06.3.2-bulk-f [SONNET-XHIGH] İçe aktarma sonuç tablosu: satır no / başlık / durum / hata + kısmi-başarı özeti + empty state  (bağ: 06.3.2-bulk-e)
  06.3.2-bulk-g [OPUS-MAX] CSV'de website satırları: satır-başı SSRF guard + crawl'ın transaction DIŞINDA, sıralı ve bütçeli çalışması  (bağ: 06.3.2-bulk-c)
  06.3.2-bulk-h [OPUS-XHIGH] Uçtan uca doğrulama: E2E CSV içe aktarma akışı + RAG'de aranabilirlik + regresyon/parite kanıtı  (bağ: 06.3.2-bulk-f, 06.3.2-bulk-g)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): Üç bölünmez çekirdek var, hepsi izole edildi ve etraflarındaki ucuz yüzeyler ayrı alt-görevlere çıkarıldı. (1) 06.3.2-bulk-a — CSV ayrıştırıcı: depoda kopyalanacak parser YOK (reports-export.ts ters yön/serileştirme, apps/api'de csv-parse/papaparse grep 0), yani yeni algoritma tasarımı; ayrıca formül-enjeksiyon nötrleme + lineer-zaman (ReDoS) garantisi aynı fonksiyonun içinde yaşıyor — tırnak/gömülü satır-sonu durum makinesini enjeksiyon guard'ından ayırmak, guard'ın hangi hücreye uygulandığı bilgisini kaybettirir. (2) 06.3.2-bulk-c — bulk endpoint: satır-başı tenant/ai_agent sahiplik kontrolü + tx sınırı + kısmi-başarı semantiği tek bir akıl yürütme; "ilk satırdan sonra sahiplik kontrolünü atlama" bu işin somut hata sınıfı ve döngüyü sonuç-zarfından ayırınca görünmez oluyor. (3) 06.3.2-bulk-g — website satırları: tek istek → N dış fetch = SSRF amplifikasyonu; guard'ın satır başına tekrarı ve crawl'ın tx DIŞINDA tutulması aynı kararın iki yüzü (playbook.ts:385-395'teki mevcut disiplin). Çekirdeklerin çevresi (satır şeması, frontend saf yardımcılar, form UI, sonuç tablosu, uçtan uca doğrulama) 5 ayrı ve daha ucuz alt-göreve çıkarıldı — pahalı pencere böylece küçültüldü.

VARSAYIMLAR: TAŞIMA (§C adayı): Yeni bir multipart bağımlılığı EKLENMEZ. CSV, JSON gövdesinde ham metin alanı (`csv`) olarak gelir; route-özel `bodyLimit` ile `server.ts:120`'daki 1 MiB varsayılanı aşılır (`uploads.ts:69-79` deseninin birebir aynısı). Gerekçe: (a) `@fastify/multipart` + bir CSV parser paketi = iki yeni tedarik-zinciri kalemi; (b) ayrıştırma sunucuda kalmalı — istemcide ayrıştırıp satır göndermek, enjeksiyon/tavan guard'larını doğrudan API çağrısıyla atlanabilir kılar. Alternatif (uploads.ts iki-adımlı imzalı yol + AV taraması) daha fazla yüzey açtığı ve `text/csv` mevcut MIME allowlist'inde olmadığı için seçilmedi. · BÜYÜKLÜK: Senkron ve sınırlı — istek başına satır tavanı (~200), hücre başına 100.000 karakter (mevcut `createSourceBody.content` zod tavanıyla aynı), toplam gövde tavanı ~5 MiB. Asenkron kuyruk/ilerleme YOK. v2-04 §312'deki "50 MB'a kadar" ifadesi *dosya-türü knowledge kaynağı* yüzeyine aittir, bulk satır listesine değil. · YANIT ŞEKLİ: Kısmi başarı 200 + `{ imported, failed, dry_run, results[] }` ile raporlanır; 207 kullanılmaz ve ADR-06 hata zarfı yalnız TÜM isteğin reddinde döner. Böylece `api-error.ts`'in tek-`type` varsayımı ve mevcut istemci kodu kırılmaz. Yeni ApiError tipi eklenmez (eklenseydi errors.ts ×2 + `packages/types/src/scopes.test.ts:95` sayacı + openapi enum + regen zinciri tetiklenirdi). · TX SINIRI: Her satır kendi kısa transaction'ında yazılır (create + `knowledge.index()` çifti). Tek uzun tx seçilmedi: kısmi başarı zaten sözleşme, ve N embedding boyunca açık kalan tx mevcut "crawl tx dışında" disiplininin ihlali olurdu. · ÖNİZLEME: İstemciye ikinci bir CSV parser yazılmaz; önizleme `dry_run: true` ile sunucudan alınır. Böylece önizlemede görülen kural ile yazmada uygulanan kural aynı koddur. · VERİ MODELİ: Batch/job/import-durumu tablosu EKLENMEZ → migration yok. PRD §8.4 DDL'inde böyle bir tablo tanımlı değil ve senkron+sınırlı akış onu gerektirmiyor. Sonuç raporu isteğe özgüdür, kalıcı saklanmaz. · YETKİ: Yeni scope tanımlanm

AÇIK SORULAR (ürün kararı): Satır tavanı 200 doğru büyüklük mü? PRD/NFR bulk için bir sayı vermiyor; üründe daha büyük (birkaç bin satırlık) bir beklenti varsa akış senkron kalamaz ve asenkron iş + batch tablosu (yani migration) gerekir — bu kırılım o yolu bilinçle dışlıyor. · İçe aktarılan kaynaklar bir 'batch' izi taşımalı mı? Bugün `addedBy` dışında iz yok; toplu geri alma ("bu içe aktarmayı sil") isteniyorsa `knowledge_sources`'a bir `import_batch_id` kolonu + migration gerekir. Şu anki karar: gerekmiyor. · v2-04 §312 "PDF/DOCX/PPTX/TXT/CSV/TSV/MD, 50 MB'a kadar" satırı hangi yüzeye ait? Bu kırılım onu *dosya-türü knowledge kaynağı ayrıştırma* hedefi kabul etti ve ikili doküman parse'ını (PDF/DOCX) tamamen kapsam dışı bıraktı. Eğer bu satır bulk import'un taşıyıcı beklentisiyse tavanlar ve taşıma kararı (§varsayım 1/2) yeniden açılmalı. · Kısmi başarıda, düşen satırların düzeltilebilir bir 'hata CSV'si' olarak indirilebilmesi isteniyor mu? Şu an kapsam dışı (06.3.2-bulk-f kapsam_disi). İsteniyorsa `reports-export.ts` serileştiricisini yeniden kullanan ek bir SONNET-XHIGH alt-görev açılır. · Bulk'ta `type:'file'` satırı ne anlama gelmeli? Bu kırılım onu 'CSV hücresindeki düz metin' kabul etti (tek-kaynak akışıyla aynı: `content` indekslenir). Eğer beklenti 'daha önce `POST /uploads` ile yüklenmiş bir dosyanın key'i' ise, bulk endpoint'in upload yüzeyine bağlanması gerekir — bu yeni bir güvenlik yüzeyi (AV/MIME/sahiplik) ve ayrı bir OPUS-MAX alt-görev demektir.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 97.1. 06.3.2-bulk-a [OPUS-MAX] RFC4180 CSV ayrıştırıcı + formül-enjeksiyon nötrleme (saf modül, lineer zaman)

**Status:** done  
**Dependencies:** None  

Saf, bağımlılıksız modül: `parseCsv(text, limits)` → `{ header: string[], rows: string[][] }` veya tipli ayrıştırma hatası (satır/sütun konumlu). Kapsanan: RFC4180 tırnaklı alanlar, alan içi virgül/çift-tırnak (ikiye katlama), gömülü satır sonu, CRLF/LF karışımı, baştaki BOM, sondaki boş satır toleransı, boş hücre. Güvenlik: her hücre `=`/`+`/`-`/`@`/TAB/CR ile başlıyorsa `'` ön-eki ile nötrlenir 

**Details:**

06.3.2-bulk-a — RFC4180 CSV ayrıştırıcı + formül-enjeksiyon nötrleme (saf modül, lineer zaman)  [OPUS-MAX]

PRD: FR-MOD-06.3.2 (+ NFR-S9 PII/içerik yazma yolu, NFR-S8 DoS bütçesi)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 4 ihlali — depoda kopyalanacak bir CSV *parser* yok (apps/api'de csv-parse/papaparse/multipart grep 0; reports-export.ts yalnız serileştirme, ters yön), yani yeni algoritma tasarımı. Üstüne enjeksiyon (formül lead) sınıfı + ReDoS riski var; bu depoda tam bu sınıf bir kez ısırdı (spam-filter normaliseToken O(n²), §5 tablosu 08.9.3 notu). Yanlış parser = sessiz veri bozulması → KB'den yanlış AI cevabı; kararın maliyeti yüksek. Çekirdek bölünmez.
NEDEN AÇIK: apps/api'de CSV *ayrıştırma* kodu grep ile 0 sonuç; tek CSV-farkındalıklı dosya `apps/api/src/routes/reports-export.ts` ve o serileştirme (export) yönünde — `FORMULA_LEAD = /^[=+\-@\t\r]/` + `csvField()` quoting orada var, parse yok. `csv-parse`/`papaparse`/`@fastify/multipart` apps/api/package.json'da yok (dependencies listesi doğrulandı).
KAPSAM: Saf, bağımlılıksız modül: `parseCsv(text, limits)` → `{ header: string[], rows: string[][] }` veya tipli ayrıştırma hatası (satır/sütun konumlu). Kapsanan: RFC4180 tırnaklı alanlar, alan içi virgül/çift-tırnak (ikiye katlama), gömülü satır sonu, CRLF/LF karışımı, baştaki BOM, sondaki boş satır toleransı, boş hücre. Güvenlik: her hücre `=`/`+`/`-`/`@`/TAB/CR ile başlıyorsa `'` ön-eki ile nötrlenir (reports-export.ts'teki FORMULA_LEAD sınıfının ters yönü — içe aktarılan metin ileride 07.7 export'undan geri çıkarsa aynı risk yeniden doğar). Bütçe: `maxRows`, `maxCellChars`, `maxBytes` parametreleri; aşım tipli hata (sessiz kırpma YOK). Uygulama tek geçişli karakter yürüyüşü olur — geri-izlemeli regex YASAK (lineerlik testle kanıtlanır). Kontrat/DB'ye dokunmaz.
DOSYALAR: apps/api/src/lib/csv-import.ts · apps/api/src/lib/csv-import.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports-export.ts · apps/api/src/services/security/spam-filter.ts · apps/api/src/lib/cc-mask.ts · apps/api/src/lib/cc-mask.test.ts
KK (birebir): "crawl/parse" | "KK-türetilmiş: ayrıştırılan her CSV hücresi, formül-lead (=,+,-,@,TAB,CR) taşıyorsa nötrlenerek saklanır ve ayrıştırma süresi girdi uzunluğunda lineer kalır. — PRD KK yalnız 'crawl/parse' diyor, ayrıştırıcının savunması gereken saldırı sınıfını (spreadsheet formula injection / ReDoS) adlandırmıyor; sınıf reports-export.ts'teki mevcut guard'dan ve depodaki spam-filter ReDoS regresyonundan türetildi."
KK DOĞRULAMA: `pnpm --filter @siyahtus/api test:unit` → `src/lib/csv-import.test.ts`: (a) tırnaklı/gömülü-satır-sonlu CSV doğru satırlara ayrışır = 'parse' KK payı; (b) `=cmd|' /C calc'!A0` hücresi `'` ön-ekli döner = türetilmiş KK'nın enjeksiyon payı; (c) 100k'lık patolojik girdi (tırnak/ZWSP dolgusu) için süre lineer bant içinde = türetilmiş KK'nın ReDoS payı.
KAPSAM DIŞI: HTTP route, kontrat, DB — bu alt-görev saf modül · TSV/XLSX/PDF/DOCX ayrıştırma (v2-04 §312'deki ikili doküman listesi bu kalemin dışında) · kolon→alan eşlemesi ve satır doğrulaması (06.3.2-bulk-b) · kaynak oluşturma/indeksleme (06.3.2-bulk-c)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 97.2. 06.3.2-bulk-b [SONNET-XHIGH] CSV satır şeması: kolon eşleme + satır-başı doğrulama (saf modül)

**Status:** done  
**Dependencies:** None  

Saf modül: (1) başlık satırı normalizasyonu — kırpma, küçük harfe indirme, BOM kalıntısı temizliği, bilinmeyen kolona tolerans (yok sayılır, hata değil); (2) zorunlu kolon seti `name,type,content,source_url` (createSourceBody alan adlarıyla birebir) — eksik zorunlu kolon → tüm dosya reddi için tipli hata; (3) satır → `{ name, type, content?, source_url? }` eşlemesi, `type` boşsa `article` varsayıl

**Details:**

06.3.2-bulk-b — CSV satır şeması: kolon eşleme + satır-başı doğrulama (saf modül)  [SONNET-XHIGH]

PRD: FR-MOD-06.3.2
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2 dosya; güvenlik sınırı yok (authN/authZ/tenant/kripto/SSRF'e dokunmaz, yalnız şekil doğrulaması); eşzamanlılık yok; kopyalanacak mevcut desen ismen var (`createSourceBody` zod bloğu, playbook.ts:56-72 — website→source_url / diğer→content zorunluluğu dahil `superRefine` mantığı birebir aynadır); kontrat değişikliği yok; kabul kriteri mekanik (satır geçer/geçmez).
NEDEN AÇIK: `createSourceBody` (apps/api/src/routes/playbook.ts:56-72) tek bir JSON gövdesi için yazılmış: `type` enum website/file/article/faq, `content` maks 100.000 karakter, website ise `source_url` zorunlu. CSV'deki bir *satırı* bu kurallara çeviren hiçbir kod yok — bulk parametresi/endpoint/dosya alanı grep ile 0.
KAPSAM: Saf modül: (1) başlık satırı normalizasyonu — kırpma, küçük harfe indirme, BOM kalıntısı temizliği, bilinmeyen kolona tolerans (yok sayılır, hata değil); (2) zorunlu kolon seti `name,type,content,source_url` (createSourceBody alan adlarıyla birebir) — eksik zorunlu kolon → tüm dosya reddi için tipli hata; (3) satır → `{ name, type, content?, source_url? }` eşlemesi, `type` boşsa `article` varsayılanı (createSourceBody `.default('article')` ile aynı); (4) satır-başı zod doğrulaması, createSourceBody'nin superRefine kuralını birebir yansıtır (website→source_url zorunlu, diğer→content zorunlu); (5) her satır için `{ line, ok, value | error }` sonucu — ilk hatada durmaz, tüm satırları raporlar.
DOSYALAR: apps/api/src/services/ai/knowledge-bulk-row.ts · apps/api/src/services/ai/knowledge-bulk-row.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/playbook.ts · apps/web/src/features/playbook/knowledge-tabs.ts · apps/web/src/features/playbook/knowledge-tabs.test.ts · apps/api/src/services/security/spam-filter.ts
KK (birebir): "Geçersiz URL/tür reddi" | "KK-türetilmiş: bir CSV satırının `type` değeri enum dışıysa veya türünün gerektirdiği alan (website→source_url, diğer→content) boşsa o SATIR reddedilir, dosyanın geri kalanı işlenmeye devam eder. — PRD KK 'Geçersiz URL/tür reddi' der ama tek-kaynak/all-or-nothing bağlamında yazılmıştır; N-satırlık bir dosyada reddin satır düzeyinde olduğu PRD'de yazmıyor, kısmi-başarı kararından (§varsayım 3) türetildi."
KK DOĞRULAMA: `pnpm --filter @siyahtus/api test:unit` → `src/services/ai/knowledge-bulk-row.test.ts`: `type: 'workflow'` satırı ve `type: 'website'` + boş `source_url` satırı `ok:false` + konumlu hata döner (= 'Geçersiz URL/tür reddi' payı), aynı dosyadaki geçerli satırlar `ok:true` kalır (= türetilmiş kısmi-red maddesi).
KAPSAM DIŞI: CSV metnini satırlara ayırma (06.3.2-bulk-a) · DB yazımı, tenant/ai_agent sahiplik kontrolü, indeksleme (06.3.2-bulk-c) · website satırının gerçekten crawl edilmesi/SSRF guard'ı (06.3.2-bulk-g) — burada yalnız alan varlığı doğrulanır, URL ağa çıkmaz
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 97.3. 06.3.2-bulk-c [OPUS-MAX] POST /knowledge-sources/bulk — kontrat + route: tenant sahipliği, satır tavanı, tx sınırı, kısmi-başarı zarfı

**Status:** done  
**Dependencies:** 97.1, 97.2  

Contract-first sırayla tek pencerede: (1) KONTRAT — `packages/contract/openapi/paths/playbook.yaml`'a `knowledgeSourcesBulk` bloğu (`POST`, gövde: `ai_agent_id`, `csv` ham metin, `dry_run` boolean), `openapi.yaml`'a path `$ref` + `KnowledgeBulkRowResult`/`KnowledgeBulkResult` şemaları; `pnpm --filter @siyahtus/contract generate` ile re-bundle + tip üretimi. (2) ROUTE — `playbook.ts`'e mevcut WRITE sco

**Details:**

06.3.2-bulk-c — POST /knowledge-sources/bulk — kontrat + route: tenant sahipliği, satır tavanı, tx sınırı, kısmi-başarı zarfı  [OPUS-MAX]

PRD: FR-MOD-06.3.2 (+ NFR-S4/S5 tenant izolasyon & IDOR, NFR-S8 rate-limit/DoS, NFR-P2)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ve 3 ihlali. (2) Tenant izolasyon sınırı — satır-başı `ai_agent` sahipliği + `licenseId` yazımı; mevcut tek-satır kodda kontrol `tx.aiAgent.findFirst` ile var ama bir döngüde ilk satırdan sonra atlanması somut ve pahalı bir hata sınıfı (başka lisansın ajanına kaynak yazmak). (3) Transaction-invariant akıl yürütmesi — N satır tek uzun tx'te mi, satır başına kısa tx'te mi; kısmi başarı ile commit sınırı aynı kararın parçası. Ayrıca kısmi-başarı yanıt şekli ADR-06 hata zarfıyla çakışmadan tasarlanmalı (yanlış tasarım mevcut `api-error.ts` istemci varsayımını kırar). Çekirdek bölünmez.
NEDEN AÇIK: `/knowledge-sources` altında veya başka bir yerde toplu-oluşturma endpoint'i yok — route, OpenAPI path'i, handler hiçbiri grep'te çıkmıyor; kontratta yalnız `/knowledge-sources` (openapi.yaml:196-199) ve `paths/playbook.yaml:313-368` tek-kaynak POST tanımlı. Mevcut POST all-or-nothing 201 dönüyor (playbook.ts:425-435), satır bazlı hata raporlama modeli yok. `server.ts:120` varsayılan `bodyLimit: 1_048_576` (1 MiB) — büyük CSV bu tavanla sessizce reddedilir; route-özel override deseni yalnız `uploads.ts:69-79`'da var.
KAPSAM: Contract-first sırayla tek pencerede: (1) KONTRAT — `packages/contract/openapi/paths/playbook.yaml`'a `knowledgeSourcesBulk` bloğu (`POST`, gövde: `ai_agent_id`, `csv` ham metin, `dry_run` boolean), `openapi.yaml`'a path `$ref` + `KnowledgeBulkRowResult`/`KnowledgeBulkResult` şemaları; `pnpm --filter @siyahtus/contract generate` ile re-bundle + tip üretimi. (2) ROUTE — `playbook.ts`'e mevcut WRITE scope'uyla (`agents-bot--all:rw`, yeni scope YOK) kayıt; route-özel `bodyLimit` (uploads.ts deseni) ile 1 MiB tavanı aşılır. (3) AKIŞ — csv-import (bulk-a) ile ayrıştır → knowledge-bulk-row (bulk-b) ile satır doğrula → `ai_agent` sahipliği tenant-scoped **bir kez** doğrulanır ve döngü boyunca yeniden kullanılır (kontrol atlanmaz, testle kanıtlanır) → her geçerli satır için kaynak `create` + `knowledge.index()` **satır başına kısa tx** içinde (mevcut tek-satır akışıyla aynı çift, playbook.ts:397-423). (4) BÜTÇE — satır tavanı, hücre tavanı, gövde tavanı aşımı tüm isteği ADR-06 zarfıyla `validation` olarak reddeder (yeni ApiError tipi EKLENMEZ). (5) YANIT — 200 + `{ imported, failed, dry_run, results: [{ line, name, status, id?, error? }] }`; 207 kullanılmaz, ADR-06 zarfı yalnız TÜM istek reddinde. (6) `dry_run: true` → hiçbir şey yazılmaz, aynı `results` döner (önizleme bu yolla sunucudan gelir, istemciye ikinci parser yazılmaz). CSV'deki `type: 'website'` satırları bu alt-görevde satır düzeyinde reddedilir (ağa çıkış yok) — website desteği 06.3.2-bulk-g'de.
DOSYALAR: packages/contract/openapi/paths/playbook.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/playbook.ts · apps/api/test/integration/knowledge-bulk.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/playbook.ts · apps/api/src/routes/uploads.ts · apps/api/test/integration/knowledge-crawl.test.ts · apps/api/src/services/ai/knowledge-service.ts
KK (birebir): "**bulk/CSV import** (SiyahTuş)" | "RAG indeksleme" | "KK-türetilmiş: N satırlık bir içe aktarımda geçerli satırlar yazılır, geçersiz satırlar satır numarası ve nedeniyle raporlanır; istek bütünüyle başarısız sayılmaz. — PRD KK yalnız 'bulk/CSV import (SiyahTuş)' der, yanıt şeklini ve kısmi başarıyı tanımlamaz; mevcut all-or-nothing 201 davranışı bir CSV'de doğru değildir (bkz. §varsayım 3)."
KK DOĞRULAMA: `apps/api/test/integration/knowledge-bulk.test.ts`: (a) 3 geçerli satırlık CSV → 3 `knowledge_source` + her birinde `chunk_count > 0` (= 'bulk/CSV import' + 'RAG indeksleme' KK payı, indeksleme `knowledge_chunks` sayımıyla doğrudan SQL ile kanıtlanır); (b) 2 geçerli + 2 geçersiz satır → `imported:2, failed:2` ve yalnız 2 satır DB'de (= türetilmiş kısmi-başarı maddesi); (c) `dry_run:true` → 0 satır DB'de, `results` aynı; (d) `contract-parity.test.ts` yeşil (iki yönlü parite).
KAPSAM DIŞI: website satırlarının gerçekten crawl edilmesi + satır-başı SSRF guard (06.3.2-bulk-g) · herhangi bir UI (06.3.2-bulk-e/-f) · batch/job tablosu, asenkron kuyruk, ilerleme yüzdesi (§varsayım 2 — migration yok) · yeni ApiError tipi (eklenmiyor; eklenseydi errors.ts ×2 + scopes.test.ts sayacı + openapi enum + regen zinciri tetiklenirdi) · multipart/form-data dosya yükleme (§varsayım 1 — CSV ham metin olarak JSON gövdesinde)
SÖZLEŞME: YENİ PATH: `POST /knowledge-sources/bulk` → `packages/contract/openapi/paths/playbook.yaml` içine `knowledgeSourcesBulk` bloğu + `openapi.yaml`'a `/knowledge-sources/bulk: $ref` satırı; yeni `components/schemas`: `KnowledgeBulkResult`, `KnowledgeBulkRowResult`. UYARI: OpenAPI'ye eklenip `pnpm --filter @siyahtus/contract generate` ile re-bundle + tip üretimi yapılmazsa `contract-parity.test.ts` KIRILIR — test iki yönlü çalışır (belgelenmemiş route da, servis edilmeyen belge satırı da kırar), bu yüzden kontrat ve route AYNI pencerede iner.
MIGRATION: yok — `knowledge_sources` ve `knowledge_chunks` mevcut ve kullanımda (schema.prisma:939-976); bulk aynı tablolara satır satır INSERT eder. Batch/job izleme tablosu bilinçli olarak eklenmiyor (§varsayım 2).
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 97.4. 06.3.2-bulk-d [SONNET-XHIGH] Frontend saf yardımcılar: örnek CSV şablonu katalogu + dosya okuma/ön-kontrol modülü

**Status:** done  
**Dependencies:** None  

İki saf modül + testleri, hiçbir bileşene mount edilmeden. (1) `bulk-template.ts` — kolon sözlüğü (`name,type,content,source_url`, her biri için kısa açıklama + zorunluluk kuralı) ve bu sözlükten üretilen örnek CSV metni (`toTemplateCsv()`), indirilebilir Blob adı/tipi dahil; katalog deterministik ve yerel (dış servis yok). (2) `bulk-file.ts` — seçilen `File`'ı metne çeviren yardımcı + ön-kontroll

**Details:**

06.3.2-bulk-d — Frontend saf yardımcılar: örnek CSV şablonu katalogu + dosya okuma/ön-kontrol modülü  [SONNET-XHIGH]

PRD: FR-MOD-06.3.2
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4 dosya (2 modül + 2 test); güvenlik sınırı yok (sunucu yeniden doğruluyor, bu katman salt UX ön-kontrolü); eşzamanlılık yok; kopyalanacak desen ismen var (`apps/web/src/features/playbook/templates.ts` — aynı klasörde deterministik yerel katalog + test); kontrat değişikliği yok; kabul kriteri mekanik.
NEDEN AÇIK: `apps/web/src/features/playbook/PlaybookPage.tsx`'teki `KnowledgePanel` (satır ~606-680) yalnız tek satırlık name/content/source_url girişi taşıyor ve `api.post('/knowledge-sources', …)` ile tek çağrı yapıyor; dosya seçici, CSV okuma veya kolon sözlüğü yok. v2-01 §94: "toplu içe aktarma (bulk import/CSV) arayüzde görünmüyor".
KAPSAM: İki saf modül + testleri, hiçbir bileşene mount edilmeden. (1) `bulk-template.ts` — kolon sözlüğü (`name,type,content,source_url`, her biri için kısa açıklama + zorunluluk kuralı) ve bu sözlükten üretilen örnek CSV metni (`toTemplateCsv()`), indirilebilir Blob adı/tipi dahil; katalog deterministik ve yerel (dış servis yok). (2) `bulk-file.ts` — seçilen `File`'ı metne çeviren yardımcı + ön-kontroller: uzantı/MIME (`text/csv`, `.csv`), boyut tavanı (sunucu gövde tavanının altında), boş dosya; her ret için kullanıcıya gösterilecek tipli neden döner. Ön-kontroller UX'tir — otorite sunucudur, bu modül hiçbir güvenlik kararı vermez.
DOSYALAR: apps/web/src/features/playbook/bulk-template.ts · apps/web/src/features/playbook/bulk-template.test.ts · apps/web/src/features/playbook/bulk-file.ts · apps/web/src/features/playbook/bulk-file.test.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/playbook/templates.ts · apps/web/src/features/playbook/templates.test.ts · apps/web/src/features/playbook/knowledge-tabs.ts · apps/web/src/lib/format.ts
KK (birebir): "KK-türetilmiş: yönetici, beklenen kolonları gösteren örnek bir CSV şablonu indirebilir ve seçtiği dosya CSV değilse/boşsa/tavanı aşıyorsa yüklemeden önce anlaşılır bir neden görür. — PRD KK bulk import'un arayüz payını hiç tarif etmiyor; madde v2-01 §350 "Knowledge kaynakları için toplu içe aktarma (CSV/klasör yükleme) eklemek" ve depodaki mevcut EK-A.1 alan-altı hata disiplininden türetildi."
KK DOĞRULAMA: `pnpm --filter @siyahtus/web test` → `bulk-template.test.ts`: üretilen şablon CSV'nin başlık satırı sunucunun beklediği kolon setiyle birebir aynı (sözlükten türetiliyor, elle yazılmıyor); `bulk-file.test.ts`: `.txt` uzantılı dosya, 0 bayt dosya ve tavan üstü dosya için üç ayrı tipli ret nedeni döner.
KAPSAM DIŞI: Herhangi bir React bileşeni / ekrana mount (06.3.2-bulk-e) · İstemci tarafı CSV *ayrıştırma* — bilinçli olarak yapılmaz; önizleme sunucu `dry_run` çağrısıyla gelir (§varsayım 5) · Klasör yükleme (v2-01 §350'deki "klasör" payı) — yalnız tek CSV dosyası
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 97.5. 06.3.2-bulk-e [SONNET-XHIGH] Knowledge panelinde "Bulk import" formu: dosya seç → dry-run önizleme

**Status:** done  
**Dependencies:** 97.3, 97.4  

`BulkImportForm.tsx`: Knowledge panelinin içinde ikincil eylem ("Bulk import") → dosya seçici (06.3.2-bulk-d'nin `bulk-file.ts` ön-kontrolleriyle) + "Şablonu indir" (bulk-template.ts Blob'u) + hedef `ai_agent_id` mevcut panelden devralınır. Dosya seçilince `POST /knowledge-sources/bulk` **`dry_run: true`** ile çağrılır ve dönen `results` önizleme olarak gösterilir (istemcide parse YOK). "İçe aktar

**Details:**

06.3.2-bulk-e — Knowledge panelinde "Bulk import" formu: dosya seç → dry-run önizleme  [SONNET-XHIGH]

PRD: FR-MOD-06.3.2 (+ FR-EK-A.1 alan-altı hata / geçersizken submit pasif)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 3 dosya (bileşen + test + mount); güvenlik sınırı yok (mevcut `useApiClient` ile aynı scope'ta çağrı, yetki kararı sunucuda); eşzamanlılık yok; kopyalanacak desen ismen var (`PlaybookPage.tsx` `KnowledgePanel` formu satır 606-680: aynı `useQuery`/`useMutation` + `Section`/`Card` düzeni; `TemplateGallery.tsx` galeri/modal deseni; `lib/form.tsx` alan-altı hata primitifi); kontrat 06.3.2-bulk-c'de sabitlendi, burada değişmiyor; kabul kriteri mekanik (render + çağrı iddiaları).
NEDEN AÇIK: `PlaybookPage.tsx` `KnowledgePanel` (satır ~606-680) tek satırlık form; `create` mutation'ı `api.post('/knowledge-sources', …)` tek kaynak gönderiyor. Dosya/CSV yükleme input'u, çoklu-satır önizleme yok. v2-01 §94: "toplu içe aktarma (bulk import/CSV) arayüzde görünmüyor".
KAPSAM: `BulkImportForm.tsx`: Knowledge panelinin içinde ikincil eylem ("Bulk import") → dosya seçici (06.3.2-bulk-d'nin `bulk-file.ts` ön-kontrolleriyle) + "Şablonu indir" (bulk-template.ts Blob'u) + hedef `ai_agent_id` mevcut panelden devralınır. Dosya seçilince `POST /knowledge-sources/bulk` **`dry_run: true`** ile çağrılır ve dönen `results` önizleme olarak gösterilir (istemcide parse YOK). "İçe aktar" düğmesi yalnız en az bir geçerli satır varken etkin (EK-A.1: geçersizken submit pasif); ret nedenleri alan-altı hata olarak. Yükleme sırasında `Skeleton`, hata durumunda `Banner`. `PlaybookPage.tsx`'te `KnowledgePanel` içine mount + başarıdan sonra `['playbook']` query invalidasyonu (mevcut `invalidate` deseni).
DOSYALAR: apps/web/src/features/playbook/BulkImportForm.tsx · apps/web/src/features/playbook/BulkImportForm.test.tsx · apps/web/src/features/playbook/PlaybookPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/playbook/PlaybookPage.tsx · apps/web/src/features/playbook/TemplateGallery.tsx · apps/web/src/lib/form.tsx · apps/web/src/components/ui/Modal.tsx · apps/web/src/components/Skeleton.tsx · apps/web/src/features/team/CopilotKnowledge.tsx
KK (birebir): "**bulk/CSV import** (SiyahTuş)" | "KK-türetilmiş: yönetici bir CSV seçtiğinde, yazma yapılmadan önce hangi satırların geçeceğini/düşeceğini görür ve hiç geçerli satır yoksa içe aktarma düğmesi pasif kalır. — PRD KK arayüz davranışını tarif etmiyor; madde v2-01 §94 ("arayüzde görünmüyor") ile depodaki EK-A.1 kapısından ("alan-altı hata mesajı; geçersizken submit pasif") türetildi."
KK DOĞRULAMA: `BulkImportForm.test.tsx`: (a) dosya seçimi `dry_run:true` gövdesiyle `/knowledge-sources/bulk` çağırır ve yazma çağrısı yapılmaz (= türetilmiş önizleme maddesi); (b) tüm satırlar geçersiz dönen dry-run'da "İçe aktar" düğmesi `disabled` (= EK-A.1 payı); (c) "İçe aktar" `dry_run:false` ile ikinci çağrıyı yapar ve `['playbook']` invalidasyonu tetiklenir (= 'bulk/CSV import' payı).
KAPSAM DIŞI: Sonuç tablosu ve kısmi-başarı özeti bileşeni (06.3.2-bulk-f) — bu alt-görevde önizleme ham sayılarla gösterilir · Sürükle-bırak dosya alanı · İlerleme çubuğu / asenkron iş takibi (senkron akış, §varsayım 2)
SÖZLEŞME: yok (06.3.2-bulk-c'de tanımlanan path tüketilir)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 97.6. 06.3.2-bulk-f [SONNET-XHIGH] İçe aktarma sonuç tablosu: satır no / başlık / durum / hata + kısmi-başarı özeti + empty state

**Status:** done  
**Dependencies:** 97.5  

`BulkImportResults.tsx`: `KnowledgeBulkResult` zarfını (bulk-c) tablo olarak render eder — satır no, başlık, tür, durum rozeti (eklendi / atlandı), hata nedeni. Üstte özet: `X eklendi · Y atlandı` (kısmi başarıda `Banner` tone uyarı, tam başarıda başarı). Önizleme (dry-run) ve gerçek içe aktarma AYNI bileşeni kullanır, yalnız başlık metni farklıdır. Satır sayısı tavana yakınken liste `VirtualList`

**Details:**

06.3.2-bulk-f — İçe aktarma sonuç tablosu: satır no / başlık / durum / hata + kısmi-başarı özeti + empty state  [SONNET-XHIGH]

PRD: FR-MOD-06.3.2 (+ FR-EK-B.1 anlamlı empty state / virtualized liste)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 3 dosya (salt-okunur sunum bileşeni + test + bağlama); güvenlik sınırı yok (veri zaten sunucudan gelmiş sonuç zarfı); eşzamanlılık yok; kopyalanacak desen ismen var (`EmptyState.tsx`, `VirtualList.tsx`, `Banner.tsx`, `AiPerformance.tsx` kart/tablo düzeni); kontrat değişmiyor; kabul kriteri mekanik (render iddiaları).
NEDEN AÇIK: `PlaybookPage.tsx`'te çoklu-satır sonuç tablosu yok (yalnız tek kaynak listesi render ediliyor); mevcut POST all-or-nothing 201 döndüğü için (playbook.ts:425-435) gösterilecek satır-bazlı sonuç hiç üretilmemişti.
KAPSAM: `BulkImportResults.tsx`: `KnowledgeBulkResult` zarfını (bulk-c) tablo olarak render eder — satır no, başlık, tür, durum rozeti (eklendi / atlandı), hata nedeni. Üstte özet: `X eklendi · Y atlandı` (kısmi başarıda `Banner` tone uyarı, tam başarıda başarı). Önizleme (dry-run) ve gerçek içe aktarma AYNI bileşeni kullanır, yalnız başlık metni farklıdır. Satır sayısı tavana yakınken liste `VirtualList` üzerine oturur (EK-B.1). Hiç satır yoksa `EmptyState` — boş dikdörtgen değil, ne yapılacağını söyleyen metin. `BulkImportForm.tsx` ham sayılar yerine bu bileşeni kullanacak şekilde bağlanır.
DOSYALAR: apps/web/src/features/playbook/BulkImportResults.tsx · apps/web/src/features/playbook/BulkImportResults.test.tsx · apps/web/src/features/playbook/BulkImportForm.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/components/EmptyState.tsx · apps/web/src/components/VirtualList.tsx · apps/web/src/components/ui/Banner.tsx · apps/web/src/features/playbook/AiPerformance.tsx · apps/web/src/features/playbook/RecommendedSkills.tsx
KK (birebir): "KK-türetilmiş: içe aktarma bittiğinde kaç satırın eklendiği ve kaç satırın hangi nedenle atlandığı satır numarasıyla görünür; hiç satır yoksa anlamlı bir boş durum gösterilir. — PRD KK kısmi başarı raporlamasını tarif etmiyor (tek-kaynak bağlamında yazılmış); madde bulk-c'nin kısmi-başarı sözleşmesinden ve depodaki EK-B.1 kapısından ("her boş liste için anlamlı empty state (boş dikdörtgen yok)") türetildi."
KK DOĞRULAMA: `BulkImportResults.test.tsx`: 2 eklendi / 2 atlandı zarfı verildiğinde özet "2 eklendi · 2 atlandı" ve her atlanan satır için satır numarası + hata nedeni DOM'da; boş `results` dizisiyle `EmptyState` render edilir (boş dikdörtgen değil) = EK-B.1 payı.
KAPSAM DIŞI: Başarısız satırların düzeltilebilir CSV olarak yeniden indirilmesi (hata-CSV'si) — açık soru 4 · Tek tek satır yeniden deneme · Sonuçların kalıcı saklanması (batch tablosu yok, §varsayım 2)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 97.7. 06.3.2-bulk-g [OPUS-MAX] CSV'de website satırları: satır-başı SSRF guard + crawl'ın transaction DIŞINDA, sıralı ve bütçeli çalışması

**Status:** done  
**Dependencies:** 97.3  

06.3.2-bulk-c'de satır düzeyinde reddedilen `type:'website'` satırlarını etkinleştirir. (1) Her website satırı için `assertPublicHttpUrl` + `crawl()` **tx dışında** ve **satır başına**; guard'ın tek bir satır için bile atlanamayacağı testle kanıtlanır. (2) Sıralı (paralel değil) yürütme + istek başına website-satırı üst sınırı + toplam crawl süre bütçesi — tek istekle iç ağa N sonda atılmasını sın

**Details:**

06.3.2-bulk-g — CSV'de website satırları: satır-başı SSRF guard + crawl'ın transaction DIŞINDA, sıralı ve bütçeli çalışması  [OPUS-MAX]

PRD: FR-MOD-06.3.2 (+ NFR-S7 SSRF, NFR-S8 rate-limit/DoS, NFR-P2)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ihlali — SSRF doğrudan güvenlik sınırı ve burada YENİ bir boyut kazanıyor: tek istek → N dış fetch = SSRF amplifikasyonu (iç ağ port taraması / DoS aracı). Ayrıca transaction-invariant kararı (koşul 3): mevcut kod crawl'ı bilerek tx dışında tutuyor; bir döngüde bu disiplinin nasıl korunacağı çözülmemiş bir tasarım sorunu ve yanlış çözülürse DB tx'i dakikalarca açık kalır. Güvenlik işi asla sonnet'e verilmez. Çekirdek bölünmez.
NEDEN AÇIK: Mevcut tek-istek akışında `assertPublicHttpUrl` tx DIŞINDA çağrılıyor ve koddaki yorum gerekçeyi yazıyor: crawl "has no business holding a DB row open" (playbook.ts:385-395). Bulk akışında N adet website satırı olursa bu guard'ın satır başına nasıl tekrarlanacağı ve tx'in ne kadar açık kalacağı kodda tanımsız. Guard'ın kendisi tek-istek için doğrulanmış (`src/lib/ssrf.test.ts`, 15 negatif) ama toplu çağrı sarmalayıcısı yok.
KAPSAM: 06.3.2-bulk-c'de satır düzeyinde reddedilen `type:'website'` satırlarını etkinleştirir. (1) Her website satırı için `assertPublicHttpUrl` + `crawl()` **tx dışında** ve **satır başına**; guard'ın tek bir satır için bile atlanamayacağı testle kanıtlanır. (2) Sıralı (paralel değil) yürütme + istek başına website-satırı üst sınırı + toplam crawl süre bütçesi — tek istekle iç ağa N sonda atılmasını sınırlar (SSRF amplifikasyon kapısı). (3) Reddedilen/başarısız crawl satır düzeyinde `failed` olur, dosyanın kalanını durdurmaz; hata mesajı hedefi/iç ağ topolojisini SIZDIRMAZ (jenerik — mevcut `message_rejected`/`customer_banned` disiplinindeki gibi kural sızmaz). (4) Crawl edilen metin, saklanmadan önce 06.3.2-bulk-a'nın hücre nötrleme kuralından geçer. (5) Yazma yine satır başına kısa tx: crawl bittikten SONRA tx açılır. `lib/ssrf.ts` DEĞİŞTİRİLMEZ — yeniden kullanılır.
DOSYALAR: apps/api/src/routes/playbook.ts · apps/api/test/integration/knowledge-bulk-website.test.ts · packages/contract/openapi/paths/playbook.yaml · packages/contract/openapi/openapi.yaml
REFERANS DESEN (kopyalanacak): apps/api/src/routes/playbook.ts · apps/api/src/lib/ssrf.ts · apps/api/src/lib/ssrf.test.ts · apps/api/test/integration/knowledge-crawl.test.ts · apps/api/src/services/ai/web-crawler.ts
KK (birebir): "Geçersiz URL/tür reddi" | "crawl/parse" | "KK-türetilmiş: bir CSV'deki her website satırı, tek-kaynak akışındaki SSRF guard'ının aynısından ayrı ayrı geçer; guard'a takılan satır dosyanın kalanını durdurmaz ve hiçbir dış istek yapılmaz. — PRD KK 'Geçersiz URL/tür reddi' + 'crawl/parse' der ama toplu akışta guard'ın satır başına tekrarını ve amplifikasyon sınırını tarif etmez; madde mevcut koddaki tx-dışı crawl disiplininden ve NFR-S7'den türetildi."
KK DOĞRULAMA: `apps/api/test/integration/knowledge-bulk-website.test.ts`: (a) `http://127.0.0.1/`, `http://localhost/internal`, `http://169.254.169.254/`, `http://10.0.0.1/`, `file://…` satırlarını taşıyan CSV → hepsi `failed`, crawler HİÇ çağrılmadı, 0 kaynak (= 'Geçersiz URL/tür reddi' + türetilmiş madde; `knowledge-crawl.test.ts` BLOCKED listesinin bulk karşılığı); (b) 1 engelli + 2 public satır → 2 kaynak oluşur ve chunk sayıları > 0 (= 'crawl/parse' payı); (c) website-satırı üst sınırı aşıldığında istek ADR-06 zarfıyla reddedilir ve 0 dış istek yapılır.
KAPSAM DIŞI: `lib/ssrf.ts`'in kendisinde değişiklik (yeniden kullanılır, dokunulmaz) · Paralel/eşzamanlı crawl (bilinçli olarak sıralı) · robots.txt / sitemap takibi, çok sayfalı site tarama (06.3.2-a kapsamı da tek sayfa) · Redirect izleme (mevcut guard'da kapalı, açılmaz)
SÖZLEŞME: Katkısal: `KnowledgeBulkRowResult` şemasına website satırlarına özgü ret nedeni değeri eklenir (yeni path YOK). `pnpm --filter @siyahtus/contract generate` ile re-bundle + tip üretimi yapılmazsa `contract-parity.test.ts` ve tip derlemesi kırılır.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 97.8. 06.3.2-bulk-h [OPUS-XHIGH] Uçtan uca doğrulama: E2E CSV içe aktarma akışı + RAG'de aranabilirlik + regresyon/parite kanıtı

**Status:** done  
**Dependencies:** 97.6, 97.7  

(1) `apps/e2e/tests/playbook.spec.ts`'e (veya yeni `bulk-import.spec.ts`) akış: Playbook → Knowledge → Bulk import → şablonu indir → hazırlanmış CSV'yi yükle → önizleme tablosu görünür → içe aktar → sonuç özeti (kısmi başarı dahil) → kaynaklar Knowledge listesinde ve doğru alt-sekmede (`knowledge-tabs.ts` filtresi) görünür. (2) İçe aktarılan içeriğin RAG'den geri geldiğinin kanıtı: mevcut AI/Copil

**Details:**

06.3.2-bulk-h — Uçtan uca doğrulama: E2E CSV içe aktarma akışı + RAG'de aranabilirlik + regresyon/parite kanıtı  [OPUS-XHIGH]

PRD: FR-MOD-06.3.2 (+ NFR-M4 test piramidi)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama (kontrat + backend + UI + RAG geri okuma) ve KK'nın 'RAG indeksleme' payının gerçekten uçtan uca kanıtlandığına dair yorum gerektiren doğrulama — koşul 6 (mekanik kabul) tam sağlanmıyor; ayrıca güvenlik hassasiyeti olan yolların (SSRF/tenant) regresyon kanıtını toparlıyor, ama yeni güvenlik sınırı KURMUYOR → MAX değil, XHIGH. E2E temiz DB gerektirir (truncate+reseed, sourced .env, boş portlar) — bu da mekanik olmayan bir kurulum yargısı.
NEDEN AÇIK: `apps/e2e/tests/playbook.spec.ts` mevcut ama bulk/CSV akışı yok (bulk endpoint/UI bu turda ilk kez geliyor — apps/api ve apps/web genelinde bulk grep 0). PRD KK'nın 'RAG indeksleme' payı yalnız `chunk_count` ile değil, içe aktarılan içerikten cevap dönmesiyle tam kanıtlanır.
KAPSAM: (1) `apps/e2e/tests/playbook.spec.ts`'e (veya yeni `bulk-import.spec.ts`) akış: Playbook → Knowledge → Bulk import → şablonu indir → hazırlanmış CSV'yi yükle → önizleme tablosu görünür → içe aktar → sonuç özeti (kısmi başarı dahil) → kaynaklar Knowledge listesinde ve doğru alt-sekmede (`knowledge-tabs.ts` filtresi) görünür. (2) İçe aktarılan içeriğin RAG'den geri geldiğinin kanıtı: mevcut AI/Copilot yüzeyinden içe aktarılan metne dayalı bir cevap/alıntı iddiası. (3) DoD kapısının tam sürümü koşulur (typecheck+lint+unit+integration+build+e2e); `contract-parity.test.ts` 5/5 ve test sayacı güncellenir. (4) HANDOFF'a kanıt: satır/boyut tavanları, kısmi-başarı sözleşmesi ve SSRF amplifikasyon kapısının hangi testle tutulduğu.
DOSYALAR: apps/e2e/tests/playbook.spec.ts · apps/e2e/tests/fixtures.ts · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/e2e/tests/playbook.spec.ts · apps/e2e/tests/copilot.spec.ts · apps/e2e/tests/demo-flow.spec.ts · apps/e2e/tests/global-setup.ts
KK (birebir): "Geçersiz URL/tür reddi" | "crawl/parse" | "RAG indeksleme" | "**bulk/CSV import** (SiyahTuş)"
KK DOĞRULAMA: E2E: CSV yükleme → önizleme → içe aktarma → kaynakların listede görünmesi ('bulk/CSV import' + 'crawl/parse' payı); içe aktarılan metinden AI/Copilot yüzeyinde cevap/alıntı ('RAG indeksleme' payı); CSV'deki geçersiz tür/URL satırının sonuç tablosunda atlandı olarak görünmesi ('Geçersiz URL/tür reddi' payı). Kapı: `contract-parity.test.ts` 5/5 + tam DoD komut zinciri yeşil.
KAPSAM DIŞI: Yeni özellik eklemek (yalnız doğrulama + kanıt) · Performans yük testi (10k satırlık CSV) — tavan zaten çok altında · PLAN.md/§G tablo güncellemesi (ayrı görev)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
