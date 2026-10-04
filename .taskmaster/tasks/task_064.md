# Task ID: 64

**Title:** 07.6 — Chat topics (AI kümeleme)  ·  dilim V2-4

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** FR-MOD-07.6 · Could (v2) · LLM.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `07.6`.

8 atomik alt-görev · ~9 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x3 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  07.6-a [OPUS-XHIGH] `GET /reports/topics` kontratı + yetkili route iskeleti + yetersiz-veri (empty) yanıtı  (bağ: yok)
  07.6-b [OPUS-MAX] Deterministik konu kümeleme çekirdeği: `packages/ai-mock/src/topics.ts` (kümeleme + etiket türetme + yeterlilik eşiği)  (bağ: 07.6-a)
  07.6-c [OPUS-XHIGH] Kümelemeyi route'a bağla: tenant-scoped konu sorgusu + hacim/trend (önceki dönem) + performans tavanı  (bağ: 07.6-a, 07.6-b)
  07.6-d [SONNET-XHIGH] Demo seed'de konu çeşitliliği: kümelenebilir sohbet özetleri  (bağ: 07.6-b, 07.6-c)
  07.6-e [SONNET-XHIGH] Reports'ta 'Chat topics' sekmesi: hacim/trend listesi + yetersiz-veri empty state  (bağ: 07.6-a, 07.6-c)
  07.6-f [SONNET-XHIGH] Overview'da 'Top chat topics' promo bandı (See chat topics / Remind me later — kalıcı dismiss)  (bağ: 07.6-e)
  07.6-g [SONNET-XHIGH] Topics rapor grubu: `/reports/groups` kataloğu + CSV export satırı  (bağ: 07.6-c)
  07.6-h [OPUS-XHIGH] Uçtan uca doğrulama: Chat topics e2e (dolu + empty) + ai-mock paylaşım regresyonu  (bağ: 07.6-c, 07.6-d, 07.6-e, 07.6-f)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): 07.6-b (deterministik kümeleme + etiket türetme çekirdeği) bölünmez. Üç şey aynı akıl yürütmenin parçası ve ayrı pencerelere dağılınca kaybolur: (1) determinizm garantisi — aynı sohbet kümesi girdi sırasından bağımsız aynı kümeleri/etiketleri vermeli, yoksa rapor her yenilemede değişir ve testler kırılgan olur; (2) eşik kalibrasyonu — benzerlik eşiği, minimum küme boyutu ve "yeterli veri" eşiği birbirine bağlı üç sayıdır, biri diğerinden ayrı ayarlanamaz ("yeterli veri yoksa empty" KK'sı doğrudan bu üçlüye dayanıyor); (3) etiket türetmede PII elemesi — etiket, müşteri konuşma metninden türeyen tokenlardan oluşuyor; salt-rakam tokenların (kart/sipariş numarası) elenmesi kümeleme skorlamasıyla aynı fonksiyonda yaşıyor, ayrı pencereye çıkarılırsa "etiketi kim üretti, neyi eledi" bağlamı kopar. Ayrıca packages/ai-mock/src/embedding.ts hem RAG (knowledge-service.ts) hem bu iş tarafından tüketiliyor — kümelemenin embedding.ts'e DOKUNMADAN üstüne bina edilmesi kararı da bu pencerede verilir. Çekirdeğin etrafındaki her şey (kontrat satırı, route/tenant kapısı, seed, sekme UI, promo bandı, CSV grubu, e2e) ayrı ve daha ucuz etiketli alt-görevlere çıkarıldı.

VARSAYIMLAR: YENİ TABLO YOK — kümeleme istek anında (on-the-fly) hesaplanır. Gerekçe: CLAUDE.md'ye göre şema tek doğruluk kaynağı PRD §8.4 + rapor-2-teknik-mimari.md §5.3 ve ikisinde de chat_topics / topic_clusters / thread_topic_assignments tablosu TANIMLI DEĞİL; şema dışına tablo eklemek sapma olur. Ayrıca yeni tablo paylaşılan Postgres'te test yarışı riski getirir (proje hafızası: siyahtus-test-gate-parallel-db). Trend, ReportsReviews'ün previous_period deseniyle aynı istekte eşit uzunlukta önceki pencere hesaplanarak üretilir. · Kümeleme girdisi: thread başına `threads.summary` doluysa o, değilse thread'in ilk müşteri `events.text` mesajı (type='message', author_type='customer'). `summary` yalnız AI'ın kapattığı thread'lerde doluyor (ai-responder.ts:65-69), tek başına kullanılırsa insanın yürüttüğü sohbetler rapordan tamamen düşerdi. · Performans tavanı: pencere başına en fazla 1000 en yeni kümelenebilir sohbet işlenir; üstü kesilir ve yanıtta `analyzed` alanı gerçek sayıyı söyler. NFR-P7 ölçümü HANDOFF'a kanıt olarak yazılır. · 'Yeterli veri yoksa empty' bir HATA DEĞİL, bir DURUM: 200 + `sufficient_data:false` + `topics: []`. Yeni ApiError tipi EKLENMEZ — böylece errors.ts (×2 yer) + scopes.test.ts sayacı + openapi enum + regen tuzağına (proje hafızası: siyahtus-error-type-additions) hiç girilmez. · Chat topics ayrı bir sol-nav girdisi veya `/chat-topics` rotası DEĞİL, Reports sayfasının 5. sekmesidir. Sol navigasyonda 'NEW' kırmızı nokta rozeti YAPILMAZ: v2-01-fonksiyonel-ux-derin.md §132/138 'Yeni rozeti hem sol navigasyonda hem üstteki promo bandında tekrarlanıyor — aynı özelliği iki kez pazarlamak gereksiz tekrar' bulgusu gereği tanıtım yalnız Overview'daki promo bandında bir kez görünür. · `share` ve `trend` boşken 0 değil null döner — depodaki yerleşik kural (ReportsOverview.automated_rate, ReportsReviews.score: 'unrated period is unknown, not bad'). Önceki dönemde 0 hacim varsa trend null'dır, %100 artış değil. · Etiket üretiminde salt-rakam tokenlar atılır (sipariş/kart num

AÇIK SORULAR (ürün kararı): 'Yeterli veri' eşiği kaç sohbet? PRD sayı vermiyor ('yeterli veri yoksa empty'). Önerilen kalibrasyon: pencerede ≥20 kümelenebilir sohbet VE küme başına ≥3 sohbet; altındaysa `sufficient_data:false`. Onay gerekiyor — bu sayı 07.6-b'de sabitlenip 07.6-d seed'i ve 07.6-h e2e'si ona göre kurgulanacak. · Trend hangi biçimde sunulsun: sayısal değişim oranı mı (önceki döneme göre), yoksa ayrık 'up/down/flat' mı? Öneri: kontrat `previous_volume` (integer) + `trend` (number|null, oran) taşısın, ok/renk kararını UI türetsin — böylece CSV export'ta da ham sayı kalır. · Kümeleme girdisi olarak müşteri mesaj metni kullanılsın mı, yoksa yalnız `threads.summary` mi? Yalnız summary kullanılırsa insan-yürüttüğü sohbetler rapordan düşer (summary'yi sadece ai-responder yazıyor); mesaj metni kullanılırsa ham müşteri içeriği kümeleme girdisi olur (tenant içinde yeni bir maruziyet sınıfı değil, ajan zaten okuyor — ama karar yazılı olsun). · Topics CSV export grubu (07.6-g) bu kalemin kapsamında mı kalsın, yoksa 07.7 'Rapor grupları + Export'a mı bırakılsın? Şu an 07.6'ya alındı çünkü reports-export.ts:34-44 kataloğu 'sekmeler, gruplar listesi ve export tek kelime dağarcığı' diyor — sekme eklenip katalog eklenmezse üç yüzey tutarsız kalır.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 64.1. 07.6-a [OPUS-XHIGH] `GET /reports/topics` kontratı + yetkili route iskeleti + yetersiz-veri (empty) yanıtı

**Status:** done  
**Dependencies:** None  

Contract-first ilk adım, ADR-05 sırasıyla. (1) KONTRAT: paths/reports.yaml'a `topics:` bloğu (operationId `getReportsTopics`, from/to query, 200/400/401/403/429 — `breakdown:` bloğunun birebir yapısı); openapi.yaml'a `/reports/topics: $ref: "./paths/reports.yaml#/topics"` kaydı + `components/schemas/ReportsTopics`. Şema alanları BU alt-görevde PİNLENİR ve sonraki alt-görevler ona uyar: `range{from

**Details:**

07.6-a — `GET /reports/topics` kontratı + yetkili route iskeleti + yetersiz-veri (empty) yanıtı  [OPUS-XHIGH]

PRD: FR-MOD-07.6 (+ NFR-S3, NFR-S4, NFR-P7)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni bir YETKİLİ endpoint ekleniyor (scopes:['reports_read'] + request.withTenant tenant kapısı) — kullanıcı kuralı 'yeni bir yetkili endpoint eklemek EN AZ OPUS-XHIGH olur, güvenlik işi asla sonnet'e verilmez' doğrudan uygulanıyor. Çekirdek güvenlik sınırı değil (yeni scope/kripto/authN modeli yok, mevcut reports_read + RLS deseni birebir tekrarlanıyor), bu yüzden MAX değil. Ayrıca kontrat + backend'in tek pencerede birleşmesi bir TASARIM kararı (contract-parity çift yönlü denetliyor) — koşul 5/6 mekanik ama koşul 2 ihlali etiketi belirliyor.
NEDEN AÇIK: packages/contract/openapi/openapi.yaml `paths` bloğunda /reports altında yalnız overview/breakdown/ai-agent/reviews/groups/export + billing yolları kayıtlı (satır 296-317); `/reports/topics` YOK. packages/contract/openapi/paths/reports.yaml'daki operationId listesi getReportsOverview/getReportsBreakdown/getReportsAiAgent/getReportsReviews/getReportGroups/exportReport/getSubscription/updateSubscription/getUsage/listInvoices/downloadInvoice/getPaymentMethod/updatePaymentMethod — topics operationId'si yok. apps/api/src/routes/ altında 'topic' geçen hiçbir route/dosya yok (grep 0 sonuç). apps/api/test/integration/contract-parity.test.ts dosya başlığı (satır 14-17) parity'nin çift yönlü olduğunu söylüyor: kontratta olup servis edilmeyen yol da kırar — bu yüzden kontrat ve route aynı pencerede.
KAPSAM: Contract-first ilk adım, ADR-05 sırasıyla. (1) KONTRAT: paths/reports.yaml'a `topics:` bloğu (operationId `getReportsTopics`, from/to query, 200/400/401/403/429 — `breakdown:` bloğunun birebir yapısı); openapi.yaml'a `/reports/topics: $ref: "./paths/reports.yaml#/topics"` kaydı + `components/schemas/ReportsTopics`. Şema alanları BU alt-görevde PİNLENİR ve sonraki alt-görevler ona uyar: `range{from,to}`, `previous_period{range{from,to}}`, `min_conversations:integer`, `analyzed:integer`, `sufficient_data:boolean`, `topics[]{id, label, keywords[], volume, share(number|null), previous_volume(integer), trend(number|null)}`. `share`/`trend` boşken 0 değil null — ReportsOverview.automated_rate ve ReportsReviews.score ile aynı kural, şema açıklamasında gerekçesiyle yazılır. (2) BACKEND İSKELETİ: apps/api/src/routes/reports.ts'e `app.get('/reports/topics', { config: { scopes: ['reports_read'] } }, ...)` — rangeQuery zod parse + resolveRange + request.withTenant içinde YALNIZ kümelenebilir sohbet SAYIMI (license_id filtreli); sayım eşiğin altındaysa `sufficient_data:false` + `topics: []` döner. Bu pencerede kümeleme YOK — `sufficient_data:true` dalı da şimdilik boş `topics: []` döner ve 07.6-c'de doldurulur. (3) Bundle yeniden üretilir + @siyahtus/types generate.
DOSYALAR: packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/reports.ts · apps/api/test/integration/reports-topics.test.ts
REFERANS DESEN (kopyalanacak): packages/contract/openapi/paths/reports.yaml (satır 42-70 `breakdown:` ve 99-136 `reviews:` blokları) · packages/contract/openapi/openapi.yaml (satır 1908-1948 `ReportsBreakdown`, 1988+ `ReportsReviews` şemaları; satır 298-303 path kayıtları) · apps/api/src/routes/reports.ts (satır 664-701 `/reports/breakdown` route'u — rangeQuery.safeParse + resolveRange + request.tenant() + request.withTenant deseni) · apps/api/test/integration/reports-billing.test.ts (reports integration + cross-tenant test iskeleti)
KK (birebir): "yeterli veri yoksa empty"
KK DOĞRULAMA: apps/api/test/integration/contract-parity.test.ts yeşil → kontrat ile servis edilen route birebir eşleşiyor (yeni yol her iki yönde de doğrulanır). Yeni apps/api/test/integration/reports-topics.test.ts: veri yokken / eşiğin altındayken 200 + `sufficient_data:false` + `topics: []` → 'yeterli veri yoksa empty' KK'sının backend payı. Cross-tenant: başka lisansın sohbetleri `analyzed` sayacına girmiyor.
KAPSAM DIŞI: Gerçek kümeleme algoritması ve etiket türetme (07.6-b) · Kümelemenin route'a bağlanması + trend/önceki dönem sorgusu (07.6-c) · UI sekmesi ve promo bandı (07.6-e / 07.6-f) · CSV export grubu (07.6-g) · Yeni ApiError tipi — yetersiz veri hata değil durum (varsayım 4)
SÖZLEŞME: packages/contract/openapi/paths/reports.yaml → yeni `topics:` bloğu (operationId getReportsTopics, from/to query). packages/contract/openapi/openapi.yaml → `/reports/topics` path kaydı + `components/schemas/ReportsTopics`. UYARI: OpenAPI'ye eklenip RE-BUNDLE edilmezse ve/veya route aynı pencerede servis edilmezse contract-parity.test.ts ÇİFT YÖNLÜ kırılır (kontratta var-route'ta yok da hata). @siyahtus/types generate zorunlu.
MIGRATION: yok — yeni tablo eklenmiyor; kümeleme on-the-fly (varsayım 1: PRD §8.4 + rapor-2 §5.3'te chat_topics/topic_clusters tanımlı değil, şema tek doğruluk kaynağı dışına çıkılmaz).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 64.2. 07.6-b [OPUS-MAX] Deterministik konu kümeleme çekirdeği: `packages/ai-mock/src/topics.ts` (kümeleme + etiket türetme + yeterlilik eşiği)

**Status:** done  
**Dependencies:** 64.1  

Yeni SAF modül packages/ai-mock/src/topics.ts (DB yok, Fastify yok, env yok — embedding.ts komşusu). İçerik: (1) `clusterTopics(docs: Array<{id, text}>, options?)` — greedy leader kümeleme: dokümanlar id'ye göre SIRALANIR (girdi sırasından bağımsız determinizm), her doküman embed() ile vektörleştirilir, mevcut kümelerin merkezine cosine similarity eşiğinin üstündeyse ona katılır, değilse yeni küme

**Details:**

07.6-b — Deterministik konu kümeleme çekirdeği: `packages/ai-mock/src/topics.ts` (kümeleme + etiket türetme + yeterlilik eşiği)  [OPUS-MAX]

PRD: FR-MOD-07.6 (+ NFR-M2, NFR-P7)
ETİKET GEREKÇESİ: OPUS-MAX: YENİ ALGORİTMA TASARIMI — koşul 4 ihlali (depoda kopyalanacak mevcut bir kümeleme deseni YOK; embed()/similarity() var ama kümeleme, merkez hesabı, etiket türetme ve eşik kalibrasyonu tasarlanacak). Ayrıca yanlış kararın pahalı olduğu yer: (a) determinizm bozulursa rapor her yenilemede değişir ve testler kırılganlaşır, (b) etiket müşteri konuşma metninden türediği için salt-rakam token elemesi yapılmazsa sipariş/kart numarası rapor etiketine sızabilir (PII), (c) packages/ai-mock/src/embedding.ts hem RAG (knowledge-service.ts) hem bu iş tarafından paylaşılıyor — yanlış bir dokunuş iki süiti birden kırar. Bölünmeyen çekirdek.
NEDEN AÇIK: packages/ai-mock/src/embedding.ts içindeki deterministik embed()/tokenize()/similarity() fonksiyonları YALNIZCA apps/api/src/services/ai/knowledge-service.ts (RAG/KnowledgeChunk) tarafından tüketiliyor; kümeleme amaçlı hiçbir kullanım yok. packages/ai-mock/src/index.ts yalnız embedding/steps/compiler/intent/assist export ediyor — topics modülü yok. apps/api/prisma/schema.prisma'da Topic/Cluster/ChatTopic adında hiçbir model yok (grep 0) ve PRD §8.4'te de böyle bir tablo tanımlı değil, yani kümeleme mantığının yaşayacağı tek yer saf bir fonksiyon.
KAPSAM: Yeni SAF modül packages/ai-mock/src/topics.ts (DB yok, Fastify yok, env yok — embedding.ts komşusu). İçerik: (1) `clusterTopics(docs: Array<{id, text}>, options?)` — greedy leader kümeleme: dokümanlar id'ye göre SIRALANIR (girdi sırasından bağımsız determinizm), her doküman embed() ile vektörleştirilir, mevcut kümelerin merkezine cosine similarity eşiğinin üstündeyse ona katılır, değilse yeni küme açar; merkez normalize ortalama. (2) Etiket türetme: küme içi token frekansı yüksek + korpus geneli düşük (hafif tf-idf) ilk 3 token; SALT-RAKAM tokenlar ATILIR (sipariş/kart numarası sızıntısı); eşitlikte deterministik tie-break (hacim azalan, sonra etiket alfabetik). (3) Sabitler: `TOPIC_SIMILARITY_THRESHOLD`, `MIN_CLUSTER_SIZE`, `MIN_CONVERSATIONS` — ve `sufficient` bayrağı: kümelenebilir doküman sayısı `MIN_CONVERSATIONS` altındaysa `{ sufficient:false, topics: [] }`. (4) topics.ts index.ts'ten export edilir. embedding.ts'e TEK SATIR dokunulmaz.
DOSYALAR: packages/ai-mock/src/topics.ts · packages/ai-mock/src/topics.test.ts · packages/ai-mock/src/index.ts
REFERANS DESEN (kopyalanacak): packages/ai-mock/src/embedding.ts (tokenize/embed/similarity/normalise — salt-tüketici olarak kullanılacak, DEĞİŞTİRİLMEZ) · packages/ai-mock/src/intent.ts (eşikli deterministik lexical eşleştirme + eşik gerekçesinin yorumda yazılması deseni; INTENT_THRESHOLD) · apps/api/src/services/ai/knowledge-service.ts (RETRIEVAL_THRESHOLD — 'eşiğin altı gürültüdür' karar gerekçesi deseni)
KK (birebir): "AI kümeleme" | "yeterli veri yoksa empty"
KK DOĞRULAMA: packages/ai-mock/src/topics.test.ts: (a) aynı doküman kümesi FARKLI SIRAYLA verildiğinde birebir aynı küme/etiket/sıra → determinizm ('AI kümeleme' tekrarlanabilir); (b) aynı konudan 3 metin tek kümede, ilgisiz metin ayrı kümede → gerçekten kümeliyor; (c) `MIN_CONVERSATIONS` altındaki girdi → `sufficient:false` + `topics: []` → 'yeterli veri yoksa empty' KK'sının çekirdek payı; (d) içinde 16 haneli rakam dizisi geçen metinlerden üretilen etikette rakam yok. Regresyon: packages/ai-mock mevcut süiti (embedding.test.ts, intent.test.ts) ve knowledge/RAG testleri yeşil kalır.
KAPSAM DIŞI: packages/ai-mock/src/embedding.ts'te HERHANGİ bir değişiklik (RAG regresyon riski) · DB sorgusu / Prisma / tenant erişimi (07.6-c) · Kontrat şeması (07.6-a'da pinlendi — bu fonksiyonun çıktısı ona uyarlanır) · Gerçek LLM/embedding sağlayıcısı (ADR: dış servisler mock) · Kümelerin kalıcılaştırılması / yeni tablo (varsayım 1)
SÖZLEŞME: yok — saf fonksiyon, HTTP yüzeyi yok. (Çıktı şekli 07.6-a'da pinlenen ReportsTopics.topics[] alanlarını karşılamalı.)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 64.3. 07.6-c [OPUS-XHIGH] Kümelemeyi route'a bağla: tenant-scoped konu sorgusu + hacim/trend (önceki dönem) + performans tavanı

**Status:** done  
**Dependencies:** 64.1, 64.2  

apps/api/src/routes/reports.ts içinde `/reports/topics` handler'ını doldur — contract-first sıradaki backend adımı. (1) request.withTenant içinde tenant-scoped sorgu: seçili pencerede license_id filtreli thread'ler; her thread için kümeleme metni = `threads.summary` doluysa o, değilse thread'in ilk müşteri mesajı (events.type='message' AND author_type='customer', createdAt asc LIMIT 1). (2) Perfor

**Details:**

07.6-c — Kümelemeyi route'a bağla: tenant-scoped konu sorgusu + hacim/trend (önceki dönem) + performans tavanı  [OPUS-XHIGH]

PRD: FR-MOD-07.6 (+ NFR-S3, NFR-S4, NFR-P7)
ETİKET GEREKÇESİ: OPUS-XHIGH: güvenlik hassasiyeti var ama çekirdek güvenlik sınırı değil — mevcut reports_read scope'u ve request.withTenant/RLS deseni birebir tekrarlanıyor, yeni yetki modeli/kripto yok (kullanıcı kuralı: yetkili endpoint yüzeyi ≥ OPUS-XHIGH, asla sonnet). Ek olarak koşul 2 ve 6 ihlali: kümeleme girdisi ham müşteri konuşma metni/özeti (PII yüzeyi) ve license_id filtresiz bir aggregate çapraz-tenant konu sızıntısı yaratır (NFR-S4); ayrıca 'hacim/trend' için önceki dönem sorgusunun veri şekli tasarlanacak. MAX değil: izolasyon mekanizması hazır (withTenant), eşzamanlılık/kilit yok, algoritma 07.6-b'de kapandı.
NEDEN AÇIK: 07.6-a'nın bıraktığı route `sufficient_data:true` dalında bile boş `topics: []` dönüyor. threads.summary alanı (apps/api/prisma/schema.prisma:383-384) AI özet metni taşıyor — apps/api/src/services/ai/ai-responder.ts:65-69 yazıyor — ama tek tüketicisi chat-service.ts:1620'deki tekil getChat serileştirmesi; hiçbir toplu/analitik tüketicisi yok, yani kümeleme için hazır bir girdi boşta duruyor. reports.ts'te önceki-dönem karşılaştırma deseni zaten var (ReportsOverview/ReportsReviews previous_period) ama topics için hiçbir sorgu yok.
KAPSAM: apps/api/src/routes/reports.ts içinde `/reports/topics` handler'ını doldur — contract-first sıradaki backend adımı. (1) request.withTenant içinde tenant-scoped sorgu: seçili pencerede license_id filtreli thread'ler; her thread için kümeleme metni = `threads.summary` doluysa o, değilse thread'in ilk müşteri mesajı (events.type='message' AND author_type='customer', createdAt asc LIMIT 1). (2) Performans tavanı: en yeni 1000 thread (varsayım 3); `analyzed` yanıtta gerçek sayıyı söyler. (3) `clusterTopics()` çağrısı → `sufficient` false ise 07.6-a'nın empty yanıtı korunur. (4) TREND: eşit uzunlukta önceki pencere için aynı metin kümesi çekilir ve MEVCUT dönemin küme merkezlerine atanır (yeniden kümelenmez — yoksa iki dönemin etiketleri eşleşmez ve trend anlamsızlaşır); `previous_volume` + `trend` (oran; previous_volume=0 iken null) üretilir. (5) `share` = volume/analyzed, analyzed=0 iken null. Kümeleme veri toplama işi reports.ts içinde PAYLAŞILAN bir yardımcıya konur ki 07.6-g'nin CSV'si aynı sayıyı yeniden hesaplamak yerine tüketebilsin (breakdownByDay deseni).
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/test/integration/reports-topics.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts (satır 664-730 `/reports/breakdown` — withTenant + $queryRaw + license_id filtresi; satır 279+ `breakdownByDay` paylaşılan yardımcı deseni; ReportsReviews'ün eşit-uzunluk önceki-pencere hesabı) · apps/api/src/services/ai/knowledge-service.ts (satır 76-94 — license_id filtreli tenant-scoped ham SQL + bağlı parametre deseni)
KK (birebir): "AI kümeleme" | "hacim/trend" | "yeterli veri yoksa empty"
KK DOĞRULAMA: apps/api/test/integration/reports-topics.test.ts: (a) farklı konulardan sohbetler seed edilir → yanıtta ≥2 küme ve her birinde `volume` > 0 → 'AI kümeleme' + 'hacim'; (b) önceki pencerede daha az/çok aynı-konu sohbet → `previous_volume` ve `trend` beklenen yönde, önceki dönem 0 iken `trend` null → 'trend'; (c) eşiğin altındaki tenant → `sufficient_data:false`, `topics: []` → 'yeterli veri yoksa empty'; (d) aynı istek iki kez → birebir aynı yanıt (determinizm).
KAPSAM DIŞI: UI sekmesi (07.6-e) ve promo bandı (07.6-f) · CSV export grubu (07.6-g) · Kümelerin kalıcılaştırılması / yeni tablo (varsayım 1) · packages/ai-mock içindeki algoritma değişikliği (07.6-b'de kapandı) · Konu bazlı drill-down (konuya tıklayınca sohbet listesi) — KK'da yok
SÖZLEŞME: yok — path ve şema 07.6-a'da eklendi; bu alt-görev yalnız o alanları doldurur. Şema alanı EKLEMEK gerekirse OpenAPI'ye eklenip re-bundle edilmeli, yoksa contract-parity.test.ts kırılır.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 64.4. 07.6-d [SONNET-XHIGH] Demo seed'de konu çeşitliliği: kümelenebilir sohbet özetleri

**Status:** done  
**Dependencies:** 64.2, 64.3  

seed.ts'teki sohbet üreticisine konu çeşitliliği ekle: kapatılan thread'lerin özeti sabit metin yerine o sohbetin mesaj içeriğine uygun DETERMİNİSTİK bir özet olsun (ör. kargo/teslimat, iade/geri ödeme, fatura/ödeme, ürün/stok gibi ayrık konu grupları — konu başına ≥3 sohbet, toplam kümelenebilir sohbet 07.6-b'nin `MIN_CONVERSATIONS` eşiğinin üstünde). Seed'in idempotent + deterministik olma özell

**Details:**

07.6-d — Demo seed'de konu çeşitliliği: kümelenebilir sohbet özetleri  [SONNET-XHIGH]

PRD: FR-MOD-07.6
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — tek kaynak dosya (prisma/seed.ts) + tek test dosyası; güvenlik sınırı yok (seed yalnız demo verisi yazar, NODE_ENV=production'da zaten reddediyor — seed.ts:622); eşzamanlılık yok; yeni algoritma yok — 07.6-b'nin fonksiyonu ve eşikleri hazır; kontrat/şema değişikliği yok; kabul kriteri mekanik (seed sonrası ≥2 küme). Dosyalar ve referans desen ismen verilebiliyor.
NEDEN AÇIK: apps/api/prisma/seed.ts:593 — kapatılan HER thread'e birebir aynı özet yazılıyor: `summary: 'Delivery query, resolved.'`. Yani demo tenant'ta kümeleme girdisi tek metinden ibaret; 07.6-c'nin raporu ya tek küme ya da `sufficient_data:false` verir, dolu durum (hacim/trend) hiçbir yerde gösterilemez ve e2e'de doğrulanamaz.
KAPSAM: seed.ts'teki sohbet üreticisine konu çeşitliliği ekle: kapatılan thread'lerin özeti sabit metin yerine o sohbetin mesaj içeriğine uygun DETERMİNİSTİK bir özet olsun (ör. kargo/teslimat, iade/geri ödeme, fatura/ödeme, ürün/stok gibi ayrık konu grupları — konu başına ≥3 sohbet, toplam kümelenebilir sohbet 07.6-b'nin `MIN_CONVERSATIONS` eşiğinin üstünde). Seed'in idempotent + deterministik olma özelliği korunur (aynı seed → aynı konular → aynı kümeler). Ek olarak önceki döneme (seçili pencereden bir dönem öncesine) düşen birkaç sohbet üretilir ki trend alanı demo/e2e'de null olmayan bir değer alsın. Mevcut seed sözleşmesi (hesaplar, lisanslar, mevcut sayılar) bozulmaz.
DOSYALAR: apps/api/prisma/seed.ts · apps/api/test/integration/reports-topics.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/seed.ts (satır 555-619 sohbet+thread+event üretici fonksiyonu; `messages` dizisi ve `startedAt` geriye-kaydırma deseni; satır 593 değiştirilecek satır) · packages/ai-mock/src/topics.test.ts (07.6-b'de yazılan kümelenebilirlik iddiaları — seed metinleri bu eşikleri geçmeli)
KK (birebir): "KK-türetilmiş: PRD 07.6 KK'sı yalnız 'yeterli veri yoksa empty' diyor; dolu durumun (AI kümeleme + hacim/trend) demo ve e2e'de gösterilebilmesi için yeterli veri ÜRETİLMESİ gerekiyor. Türetme gerekçesi: seed.ts:593 tüm kapalı thread'lere aynı özeti yazıyor, bu haliyle KK'nın yalnız empty kutbu kanıtlanabilir."
KK DOĞRULAMA: apps/api/test/integration/reports-topics.test.ts: seed edilmiş demo lisansında `GET /reports/topics` → `sufficient_data:true` ve `topics.length >= 2`, her kümenin `volume >= MIN_CLUSTER_SIZE`; en az bir kümede `previous_volume > 0` (trend null değil). Seed iki kez koşturulduğunda aynı kümeler (idempotent + deterministik).
KAPSAM DIŞI: Yeni tablo/migration · Prod veri veya gerçek müşteri metni (§9 sınırları) · Seed'in hesap/lisans/plan yapısının değiştirilmesi · Kümeleme eşiklerinin ayarlanması (07.6-b'de sabitlendi — seed eşiğe uyar, eşik seed'e değil)
MIGRATION: yok — yalnız seed verisi; şema değişmiyor.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 64.5. 07.6-e [SONNET-XHIGH] Reports'ta 'Chat topics' sekmesi: hacim/trend listesi + yetersiz-veri empty state

**Status:** done  
**Dependencies:** 64.1, 64.3  

UI, contract+backend'den SONRA. (1) TABS dizisine `{ id: 'topics', label: 'Chat topics' }` eklenir ve panel seçimine `topics` dalı bağlanır. (2) `ReportsTopics` TS arayüzü dosyanın üstündeki diğer rapor arayüzlerinin yanına yazılır (07.6-a şemasıyla birebir). (3) `TopicsTab` bileşeni: `useReport<ReportsTopics>('topics', api, props)`; hata → ErrorNotice; yükleniyor → CardSkeleton (rapor-1'in 'Loadi

**Details:**

07.6-e — Reports'ta 'Chat topics' sekmesi: hacim/trend listesi + yetersiz-veri empty state  [SONNET-XHIGH]

PRD: FR-MOD-07.6
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2 dosya (ReportsPage.tsx + testi); güvenlik sınırı yok (salt-okunur rapor sekmesi, mevcut useReport/api client üzerinden; yetki kapısı backend'de); eşzamanlılık yok; yeni algoritma yok — kopyalanacak desen ismen var: BreakdownTab (satır 771-833) + useReport<T> (satır 238-244) + SplitTable + EmptyState; kontrat değişikliği yok (07.6-a'da eklendi, tipler generate edilmiş); kabul kriteri mekanik (render testi + empty state).
NEDEN AÇIK: apps/web/src/features/reports/ReportsPage.tsx TABS dizisinde (satır 119-124) yalnız overview/ai-agent/reviews/breakdown var — 'Chat topics' sekmesi hiç yok; sekme paneli seçimi de dört dala sabit (satır 218-227). rapor-1-fonksiyonel.md:1348-1355 bu ekranın üç durumunu tarif ediyor: Default / Loading (AI kümeliyor) / Empty.
KAPSAM: UI, contract+backend'den SONRA. (1) TABS dizisine `{ id: 'topics', label: 'Chat topics' }` eklenir ve panel seçimine `topics` dalı bağlanır. (2) `ReportsTopics` TS arayüzü dosyanın üstündeki diğer rapor arayüzlerinin yanına yazılır (07.6-a şemasıyla birebir). (3) `TopicsTab` bileşeni: `useReport<ReportsTopics>('topics', api, props)`; hata → ErrorNotice; yükleniyor → CardSkeleton (rapor-1'in 'Loading (AI kümeliyor)' durumu); `sufficient_data:false` → EmptyState ('Not enough conversations yet' + kaç sohbet gerektiği `min_conversations`'tan okunur) — boş dikdörtgen değil, anlamlı empty (EK-B.1 kuralı); dolu → konu tablosu: etiket, hacim (`volume`), pay (`share`, null → '—'), trend (`trend`/`previous_volume`, null → '—'; renk tek başına anlam taşımaz, ok/işaretle birlikte). Sıralama backend'den geldiği gibi korunur (determinizm).
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/reports/ReportsPage.tsx (satır 771-833 `BreakdownTab` — error/pending/empty/dolu dalları; satır 836+ `SplitTable`; satır 182-227 tablist + tabpanel; satır 238-244 `useReport<T>`) · apps/web/src/components/EmptyState.tsx (anlamlı empty state bileşeni) · apps/web/src/features/reports/ReportsPage.test.tsx (satır 108 ve 213 — `getByRole('tab', { name: ... })` ile sekme gezinme deseni)
KK (birebir): "hacim/trend" | "yeterli veri yoksa empty"
KK DOĞRULAMA: apps/web/src/features/reports/ReportsPage.test.tsx: (a) 'Chat topics' sekmesine tıklayınca konu satırları, `volume` ve trend değeri görünür → 'hacim/trend'; (b) `sufficient_data:false` payload'ında konu tablosu yerine anlamlı empty state metni görünür → 'yeterli veri yoksa empty'; (c) `trend: null` satırında '—' render edilir, 0% değil. Mevcut sekme testleri regresyonsuz yeşil kalır.
KAPSAM DIŞI: Overview promo bandı ve 'See chat topics' CTA'sı (07.6-f) · Sol navigasyonda NEW rozeti (varsayım 5 — yapılmıyor) · Konuya tıklayınca sohbet listesi (drill-down) — KK'da yok · CSV indirme düğmesi (07.6-g) · Yeni grafik kütüphanesi eklemek — mevcut tablo/bar desenleri kullanılır
SÖZLEŞME: yok — tipler 07.6-a'nın generate edilmiş şemasından gelir.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 64.6. 07.6-f [SONNET-XHIGH] Overview'da 'Top chat topics' promo bandı (See chat topics / Remind me later — kalıcı dismiss)

**Status:** done  
**Dependencies:** 64.5  

Reports Overview sekmesinin üstüne tek `Banner` (tone: brand): başlık 'Top chat topics in one place'; birincil CTA 'See chat topics' → sekmeyi `topics`'e çevirir (aynı sayfa, yeni rota yok); ikincil eylem 'Remind me later' → Banner'ın `dismissible` + stabil `id` mekanizmasıyla localStorage'a yazılır ve reload sonrası bir daha görünmez. Sol navigasyona NEW rozeti EKLENMEZ (varsayım 5). Band yalnız 

**Details:**

07.6-f — Overview'da 'Top chat topics' promo bandı (See chat topics / Remind me later — kalıcı dismiss)  [SONNET-XHIGH]

PRD: FR-MOD-07.6 (+ FR-EK-C.2 banner deseni)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2 dosya (ReportsPage.tsx + testi); güvenlik sınırı yok (salt görsel tanıtım bandı, veri okumaz, yetki yüzeyi yok); eşzamanlılık yok; yeni algoritma yok — kopyalanacak desen ismen var: components/ui/Banner.tsx `dismissible` + stabil `id` ile localStorage kalıcı kapatma (EK-C.2, tm 62) ve Banner.test.tsx; kontrat/şema değişikliği yok; kabul kriteri mekanik (band görünür → CTA sekmeyi açar → dismiss kalıcı).
NEDEN AÇIK: rapor-1-fonksiyonel.md:297 Reports'ta "Top chat topics in one place [See chat topics][Remind me later]" bandını tarif ediyor; apps/web/src/features/reports/ReportsPage.tsx'te böyle bir banner/CTA yok (Overview sekmesi yalnız KPI kartları + Resolution/Volume bölümleri render ediyor). v2-01-fonksiyonel-ux-derin.md §132/138 aynı tanıtımın hem sol navda hem promo bandında tekrarlanmasını 'gereksiz tekrar' olarak işaretliyor.
KAPSAM: Reports Overview sekmesinin üstüne tek `Banner` (tone: brand): başlık 'Top chat topics in one place'; birincil CTA 'See chat topics' → sekmeyi `topics`'e çevirir (aynı sayfa, yeni rota yok); ikincil eylem 'Remind me later' → Banner'ın `dismissible` + stabil `id` mekanizmasıyla localStorage'a yazılır ve reload sonrası bir daha görünmez. Sol navigasyona NEW rozeti EKLENMEZ (varsayım 5). Band yalnız Overview sekmesinde görünür; Chat topics sekmesindeyken görünmez.
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/components/ui/Banner.tsx (tone + cta + `dismissible` + stabil `id` ile localStorage kalıcı dismiss; storage yoksa yine kapanır, hata fırlatmaz) · apps/web/src/components/ui/Banner.test.tsx (dismiss kalıcılığı test deseni) · apps/web/src/features/reports/ReportsPage.tsx (satır 156-166 `tab`/`setTab` state'i — CTA'nın çağıracağı geçiş)
KK (birebir): "KK-türetilmiş: PRD 07.6 KK'sında promo bandı yok; birebir kaynak rapor-1-fonksiyonel.md:297 — "Reports'ta 'Top chat topics in one place [See chat topics][Remind me later]' — CTA ilgili turu/görünümü açar". Türetme gerekçesi: PRD KK'sı yalnız kümeleme/hacim/empty diyor; keşfedilebilirlik yüzeyi destek kaynağında tarif edilmiş."
KK DOĞRULAMA: ReportsPage.test.tsx: (a) Overview'da band görünür ve 'See chat topics' tıklanınca 'Chat topics' sekmesi seçili olur (aria-selected=true) → 'CTA ilgili görünümü açar'; (b) 'Remind me later' tıklanınca band kaybolur ve bileşen yeniden monte edildiğinde geri gelmez (localStorage kalıcılığı); (c) Chat topics sekmesindeyken band render edilmez.
KAPSAM DIŞI: Sol navigasyonda 'NEW' kırmızı nokta rozeti (varsayım 5 — bilinçli yapılmıyor) · Yeni `/chat-topics` rotası (sekme olarak kaldı) · apps/web/src/components/navigation.ts değişikliği · Genel bir 'yeni özellik duyuru' altyapısı
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 64.7. 07.6-g [SONNET-XHIGH] Topics rapor grubu: `/reports/groups` kataloğu + CSV export satırı

**Status:** done  
**Dependencies:** 64.3  

(1) reports-export.ts `REPORT_GROUPS` dizisine `{ id: 'topics', label: 'Chat topics', scopes: ['reports_read'] }` satırı (Reports sayfasındaki sekme sırasına uygun konumda). (2) reports.ts `buildGroupCsv` switch'ine `case 'topics'` — 07.6-c'nin PAYLAŞILAN kümeleme yardımcısını yeniden kullanır (yeniden hesaplama YOK; `case 'breakdown'`/breakdownByDay felsefesi: CSV ekranla asla çelişmez); başlıkla

**Details:**

07.6-g — Topics rapor grubu: `/reports/groups` kataloğu + CSV export satırı  [SONNET-XHIGH]

PRD: FR-MOD-07.6 (+ FR-MOD-07.7 izin bazlı görünürlük/export)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2 kaynak dosya + testleri; GÜVENLİK SINIRI YOK çünkü yetki MANTIĞINA dokunulmuyor: reports-export.ts:39-44 kataloğuna mevcut `reports_read` scope'uyla TEK SATIR ekleniyor, `EXPORT_SCOPES` (satır 54) ve `visibleReportGroups` (satır 67) katalogdan TÜRETİLDİĞİ için kapı otomatik tutarlı kalıyor; yeni scope/yeni endpoint yok. Eşzamanlılık yok; yeni algoritma yok — `buildGroupCsv`'deki `case 'breakdown'` birebir kopyalanacak desen; kabul kriteri mekanik. (Etiket sonnet ama izin ve enjeksiyon negatifleri yine de zorunlu tutuldu.)
NEDEN AÇIK: apps/api/src/routes/reports-export.ts:39-44 `REPORT_GROUPS` kataloğu tam olarak dört satır taşıyor (overview/breakdown/ai-agent/reviews) — topics yok. Aynı dosyanın modül başlığı (satır 34-38) kataloğun sekmeler/gruplar listesi/export için tek doğruluk kaynağı olduğunu söylüyor; 07.6-e beşinci sekmeyi eklediği anda katalog eksik kalır. apps/api/src/routes/reports.ts `buildGroupCsv` switch'i de (satır 350-410+) yalnız bu dört grubu tanıyor.
KAPSAM: (1) reports-export.ts `REPORT_GROUPS` dizisine `{ id: 'topics', label: 'Chat topics', scopes: ['reports_read'] }` satırı (Reports sayfasındaki sekme sırasına uygun konumda). (2) reports.ts `buildGroupCsv` switch'ine `case 'topics'` — 07.6-c'nin PAYLAŞILAN kümeleme yardımcısını yeniden kullanır (yeniden hesaplama YOK; `case 'breakdown'`/breakdownByDay felsefesi: CSV ekranla asla çelişmez); başlıklar `label,volume,share,previous_volume,trend`; yetersiz veri durumunda yalnız başlık satırı döner (uydurma 0 satırı yok). (3) paths/reports.yaml `export` bloğundaki `group` parametre açıklamasına `topics` eklenir + re-bundle. CSV formül-enjeksiyon koruması mevcut `csvField`'dan gelir — konu etiketi kullanıcı-etkili metindir, bu koruma testle kanıtlanır.
DOSYALAR: apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.test.ts · apps/api/test/integration/reports-topics.test.ts · packages/contract/openapi/paths/reports.yaml
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports-export.ts (satır 39-44 `REPORT_GROUPS` katalog satırları; satır 54 `EXPORT_SCOPES` türetimi; satır 90-97 `csvField` enjeksiyon koruması) · apps/api/src/routes/reports.ts (satır 378-391 `buildGroupCsv` içindeki `case 'breakdown'` — paylaşılan yardımcıyı tüketen CSV üretimi) · apps/api/src/routes/reports-export.test.ts (grup görünürlüğü + CSV alan testleri)
KK (birebir): "KK-türetilmiş: PRD 07.6 KK'sı export demiyor; birebir kaynak FR-MOD-07.7 KK'sı "İzin bazlı görünürlük; export; benchmark karşılaştırma". Türetme gerekçesi: reports-export.ts kataloğu sekme/grup/export'un tek doğruluk kaynağı; beşinci sekme kataloğa yazılmazsa üç yüzey tutarsız kalır."
KK DOĞRULAMA: reports-export.test.ts: `reports_read` taşıyan token için `visibleReportGroups` çıktısında 'topics' var, taşımayanda YOK → 'izin bazlı görünürlük'. reports-topics.test.ts: `GET /reports/export?group=topics` 200 + text/csv ve satırlar `/reports/topics` JSON'undaki `volume`/`trend` ile BİREBİR aynı → 'export' + 'CSV ekranla çelişmez'. Yetersiz veri durumunda yalnız başlık satırı.
KAPSAM DIŞI: PDF export ve benchmark karşılaştırma (PRD 07.7'de v2; PLAN §4.4.8 kapsam dışı) · Yeni scope tanımı veya izin mantığı değişikliği — katalog satırı dışında hiçbir authZ dosyasına dokunulmaz · Web'de indirme düğmesi UI'ı (mevcut export deseni neyse o) · Kümeleme mantığı (07.6-b / 07.6-c)
SÖZLEŞME: packages/contract/openapi/paths/reports.yaml → `export` bloğunun `group` parametre açıklamasına `topics` eklenir (yeni path YOK, yalnız açıklama genişlemesi). Yeni path eklenmediği için contract-parity kırılmaz, ama bundle yine de yenilenir — aksi halde dokümantasyon sapar.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 64.8. 07.6-h [OPUS-XHIGH] Uçtan uca doğrulama: Chat topics e2e (dolu + empty) + ai-mock paylaşım regresyonu

**Status:** done  
**Dependencies:** 64.3, 64.4, 64.5, 64.6  

(1) apps/e2e/tests/reports.spec.ts'e 'Chat topics' sekmesi testi: sekme rol/ad ile bulunur, seçilir, seed'lenmiş demo lisansta konu satırları + hacim görünür, kanıt ekran görüntüsü `kanit/` altına mevcut numaralandırma deseniyle yazılır. (2) Yetersiz-veri kutbu: veri içermeyen bir tarih aralığı (veya temiz lisans) seçilerek anlamlı empty state metni doğrulanır — 'yeterli veri yoksa empty' KK'sının

**Details:**

07.6-h — Uçtan uca doğrulama: Chat topics e2e (dolu + empty) + ai-mock paylaşım regresyonu  [OPUS-XHIGH]

PRD: FR-MOD-07.6 (+ NFR-P7, NFR-M2)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama doğrulaması (kontrat + backend + seed + UI + export) ve KK'da yorum gerektiren belirsizlik — 'yeterli veri' eşiğinin e2e ortamında hangi kutba düştüğü (dolu mu empty mi) veri durumuna bağlı ve testin hangi durumu iddia edeceği karar gerektiriyor; ayrıca temiz DB + truncate/reseed + .env + port koşulları (siyahtus-e2e-clean-db) ve paylaşılan ai-mock kodunun RAG'ı kırmadığının kanıtlanması akıl yürütme istiyor. Güvenlik çekirdeği olmadığı için MAX değil; mekanik olmadığı için SONNET değil (koşul 4 ve 6 ihlali).
NEDEN AÇIK: apps/e2e/tests/reports.spec.ts yalnız Overview / AI Agent / Breakdown / Reviews sekmelerini geziyor (satır 29-62) — 'Chat topics' sekmesi için hiçbir iddia yok. Ayrıca packages/ai-mock/src/embedding.ts'in bugüne dek tek tüketicisi knowledge-service.ts idi; 07.6-b sonrası iki tüketicisi olacak ve 'aynı metin → aynı vektör' garantisi bozulursa hem RAG hem topics aynı anda kırılır — bu ikili bağın uçtan uca koşulmuş kanıtı yok.
KAPSAM: (1) apps/e2e/tests/reports.spec.ts'e 'Chat topics' sekmesi testi: sekme rol/ad ile bulunur, seçilir, seed'lenmiş demo lisansta konu satırları + hacim görünür, kanıt ekran görüntüsü `kanit/` altına mevcut numaralandırma deseniyle yazılır. (2) Yetersiz-veri kutbu: veri içermeyen bir tarih aralığı (veya temiz lisans) seçilerek anlamlı empty state metni doğrulanır — 'yeterli veri yoksa empty' KK'sının uçtan uca kanıtı. (3) Promo bandı: 'See chat topics' CTA'sı sekmeyi açar; 'Remind me later' reload sonrası bandı geri getirmez (gerçek localStorage). (4) REGRESYON KANITI: packages/ai-mock süiti + knowledge/RAG integration testleri + reports süiti aynı turda koşulur ve HANDOFF'a yazılır (embedding.ts değişmedi, iki tüketici de yeşil). (5) NFR-P7: `/reports/topics` yanıt süresi tavan altında ölçülüp HANDOFF'a kanıt not edilir. E2E öncesi truncate+reseed, .env source, portların boşaltılması (siyahtus-e2e-clean-db).
DOSYALAR: apps/e2e/tests/reports.spec.ts · apps/api/test/integration/reports-topics.test.ts
REFERANS DESEN (kopyalanacak): apps/e2e/tests/reports.spec.ts (satır 29-62 — sekme gezinme + aria-selected iddiası + kanıt ekran görüntüsü deseni) · apps/e2e/tests/fixtures.ts (agentPage fixture'ı) · apps/api/test/integration/knowledge-crawl.test.ts (ai-mock tüketen integration süiti — regresyon turunda birlikte koşacak)
KK (birebir): "AI kümeleme" | "hacim/trend" | "yeterli veri yoksa empty"
KK DOĞRULAMA: E2E: (a) Chat topics sekmesinde ≥1 konu satırı + hacim değeri görünür → 'AI kümeleme' + 'hacim'; (b) trend sütunu bir değer veya '—' gösterir (uydurma 0% yok) → 'trend'; (c) verisiz aralıkta anlamlı empty state metni görünür, boş tablo değil → 'yeterli veri yoksa empty'. Regresyon: ai-mock + knowledge/RAG + reports süitleri aynı turda yeşil. DoD kapısı TAM sürüm (typecheck+lint+unit+integration+build+e2e).
KAPSAM DIŞI: Yeni ürün davranışı eklemek — yalnız doğrulama; bulunan hata ilgili alt-göreve geri yazılır · CSV export e2e'si (07.6-g'nin integration testleri yeterli) · Gerçek LLM ile kalite karşılaştırması (mock felsefesi) · Görsel regresyon/snapshot altyapısı kurmak
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
