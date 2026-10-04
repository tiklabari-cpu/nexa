# Task ID: 99

**Title:** 09.2 — 100+ entegrasyon (marketplace katalog genişlemesi)  ·  dilim V2-7

**Status:** done

**Dependencies:** 78 ✓

**Priority:** low

**Description:** Faz 2 (v2) · PLAN §5.2 · 8 atomik alt-görev. Bu turda kapsam süpürmesinde bulundu (PLAN §D62).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `09.2-v2`.

8 atomik alt-görev · ~8 pencere · etiket dağılımı: OPUS-XHIGH x3 · SONNET-MAX x2 · SONNET-XHIGH x3

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  09.2-v2-a [SONNET-XHIGH] Marketplace liste kontratı — arama/kategori/sayfalama parametreleri + sayfalama meta alanları  (bağ: yok)
  09.2-v2-b [SONNET-XHIGH] Saf katalog filtre + sayfalama fonksiyonları (@siyahtus/types) + determinizm testleri  (bağ: yok)
  09.2-v2-c [OPUS-XHIGH] GET /settings/apps sorgu bağlama — zod parse + sayfalama + tenant join korunumu  (bağ: 09.2-v2-a, 09.2-v2-b)
  09.2-v2-d [SONNET-MAX] Katalog verisi 20 → 60 kart (mock, mevcut 8 kategori) + üst-sınır iddialarının kaldırılması  (bağ: yok)
  09.2-v2-e [SONNET-MAX] Katalog verisi 60 → 100+ kart + "100+" hedefinin testle sabitlenmesi  (bağ: 09.2-v2-d)
  09.2-v2-f [SONNET-XHIGH] Marketplace arama kutusu + tıklanabilir kategori filtresi + empty/skeleton durumları  (bağ: 09.2-v2-c)
  09.2-v2-g [OPUS-XHIGH] Virtualized kart grid'i + sayfa zinciri (NFR-P4 "yalnız görünür satır DOM'da")  (bağ: 09.2-v2-f, 09.2-v2-e)
  09.2-v2-h [OPUS-XHIGH] Uçtan uca doğrulama — 100+ katalogla e2e + NFR-P4 ölçüm notu + izolasyon/kontrat regresyonu  (bağ: 09.2-v2-c, 09.2-v2-e, 09.2-v2-g)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): Bu kalemde OPUS-MAX gerektiren, bölünemeyen bir güvenlik/algoritma çekirdeği YOK. Mevcut yetki modeli (route scope kapısı `access_rules:ro/rw`, in-chat okuma `chats--all:ro`/`chats--access:ro`) ve tenant izolasyonu (`request.withTenant` + `app_installations` license-scoped `@@unique(licenseId, appId)`) genişletilmiyor — yalnız korunuyor. Katalog tenant-bağımsız statik veri olduğu için arama/kategori filtresi izolasyon sınırına hiç dokunmuyor. En yüksek iki yüzey: (1) `09.2-v2-c` — tenant-scoped `GET /settings/apps` yanıtının kesiti ve katalog⋈kurulum join sırası değişiyor + input uzunluk sınırı konuyor → hafif güvenlik dokunuşu, kullanıcı kuralı gereği SONNET'e verilmez, OPUS-XHIGH; (2) `09.2-v2-g` — depoda çok-sütunlu grid virtualization deseni olmadığı için yeni UI kompozisyon kararı → OPUS-XHIGH. Kalan altı alt-görev (kontrat satırı, saf fonksiyon, katalog verisi ×2, filtre UI'ı) mekaniktir ve SONNET-* ile ucuzlatılmıştır.

VARSAYIMLAR: Kategori enum'u 8 değerde SABİT kalır (crm/support/ecommerce/payments/marketing/productivity/analytics/channels) — 100+ kart bu 8 kategoriye dağıtılır. Gerekçe: enum genişletmek `packages/types/src/apps.ts` APP_CATEGORIES + `packages/contract/openapi/openapi.yaml` satır 1345 enum + `AppsMarketplace.tsx` CATEGORY_LABEL (satır 29-38) + testlerin ×N senkron güncellenmesini gerektirir ([[siyahtus-error-type-additions]] ile aynı drift sınıfı) ve PRD 100+ için yeni kategori istemiyor. · Katalog DB'ye TAŞINMAZ — statik TS dizisi (`@siyahtus/types/apps.ts` APP_CATALOG) kalır, Prisma migration YOK. Gerekçe: `AppInstallation` (schema.prisma satır 1287) yalnız bağlantı kaydı tutuyor; katalog tüm tenant'lar için ortak sabit veri. · Yeni KANAL-TİPLİ kart EKLENMEZ — mevcut 5 kanal kartı (whatsapp/messenger/instagram/telegram/twilio-sms) aynen korunur, eklenen 80+ kartın hepsi veri app'idir. Gerekçe: yeni kanal kartı `CHANNEL_TYPES` (domain.ts) enum'una ve 08.5 adaptör yüzeyine dokunur; bu kalemin kapsamı değil. · Filtreleme/sayfalama SERVER-SIDE yapılır (customers.ts deseni), client-side değil. Gerekçe: 100+ kartın tek yanıtta dönmesi yanıt boyutunu ve ilk render maliyetini büyütür; ayrıca kalemin KK'sı 'kataloğun ölçeklendiğinin kanıtı' olduğu için kanıt KONTRATTA durmalı. · Sayfalama cursor'ı katalog kart id'si üzerinden kurulur (deterministik, tenant-bağımsız); cursor'a HİÇBİR tenant/lisans verisi girmez. · '100+' hedefi test eşiğiyle sabitlenir: `APP_CATALOG.length >= 100`, üst sınır YOK. v1'in `toBeLessThanOrEqual(20)` üst sınırı (apps.test.ts:40 ve integration apps.test.ts:196) kaldırılır. · Kart ikonları emoji kalır (mevcut desen — apps.ts satır 64-65 yorumu 'no asset pipeline for a mock'); 100+ kart için görsel varlık üretilmez. · Sayfa zinciri sonsuz kaydırma ile yüklenir; klavye erişilebilirliği için ek olarak görünür bir 'Daha fazla yükle' düğmesi bulunur (NFR-A11Y6 — yalnız kaydırmaya bağlı yükleme klavye kullanıcısını dışarıda bırakır).

AÇIK SORULAR (ürün kararı): 100+ kartın isimleri GERÇEK marka adları mı (Notion/Asana/Zapier/Airtable...) yoksa jenerik mock isimler mi olsun? Mevcut 20 kart gerçek marka adı taşıyor (HubSpot/Shopify/Stripe...); aynı desen 80+ gerçek marka adı üretir. Bu MASTER-PROMPT §5 'dış servisler mock' sınırını ihlal etmez (hiçbir gerçek çağrı yok, yalnız isim/açıklama/emoji), ama karar kullanıcıya ait. · Kategori enum'u 8'de mi kalsın (varsayım 1)? 100+ kartlık bir dizinde 12-15 kategori kullanıcı deneyimi açısından daha doğal olabilir; genişletilecekse openapi enum + CATEGORY_LABEL + test drift maliyeti kabul ediliyor mu? · `limit` varsayılanı customers.ts emsalinde 25; kart grid'i için 25 düşük kalabilir (ekranda ~12-16 kart). Varsayılan 48/60 mi olsun, max 100 mü kalsın? · 09.4 (Zapier/Make + Build-your-app, '700+ Zapier' katalog/desen kanıtı) ile 09.2-v2 aynı APP_CATALOG'u mu paylaşacak, yoksa ayrı bir partner dizini mi olacak? Aynı katalog paylaşılacaksa bu kalemin veri şekli (partner/creator alanları) şimdiden ona göre kurulmalı.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 99.1. 09.2-v2-a [SONNET-XHIGH] Marketplace liste kontratı — arama/kategori/sayfalama parametreleri + sayfalama meta alanları

**Status:** done  
**Dependencies:** None  

Contract-first birinci adım. `paths/apps.yaml` `apps.get`'e `parameters` bloğu: `query` (string, maxLength 320, kart adı+açıklaması üzerinde büyük/küçük harf duyarsız eşleşme), `category` (string enum = APP_CATEGORIES'in 8 değeri), `$ref: PageId`, `$ref: Limit` (paylaşılan bileşenler — customers.yaml satır 37-38 ile aynı ref'ler). Yanıt şeması `required: [items, total]` + opsiyonel `next_page_id: 

**Details:**

09.2-v2-a — Marketplace liste kontratı — arama/kategori/sayfalama parametreleri + sayfalama meta alanları  [SONNET-XHIGH]

PRD: FR-MOD-09.2 (+ NFR-P2, NFR-P4)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 tam sağlandı. (1) 2 dosya + bundle/client regen. (2) Güvenlik sınırı yok — salt şema, hiçbir yetki/izolasyon kararı içermiyor. (3) Eşzamanlılık yok. (4) Kopyalanacak mevcut desen ismen verilebiliyor: `packages/contract/openapi/paths/customers.yaml` satır 23-54 aynı dört parametreyi ve aynı `{items,total,next_page_id}` yanıt şeklini zaten tanımlıyor. (5) Kontrat değişikliği katkısal (mevcut path'e parametre + yanıt alanı). (6) KK mekanik doğrulanabilir (contract-parity yeşil + bundle idempotent).
NEDEN AÇIK: `packages/contract/openapi/paths/apps.yaml` satır 11-30: `apps.get` altında `parameters` bloğu YOK — `operationId: listApps` doğrudan `responses`'a geçiyor; yanıt şeması `{items: AppListItem[]}` (satır 22-27), `total`/`next_page_id` alanı yok, `400 BadRequest` yanıtı da yok. Karşılaştırma kanıtı: `customers.yaml` satır 23-38 `query` (maxLength 320) + `segment` + `$ref PageId` + `$ref Limit` parametrelerini ve satır 46-54'te `required:[items,total]` + `next_page_id`'yi zaten taşıyor.
KAPSAM: Contract-first birinci adım. `paths/apps.yaml` `apps.get`'e `parameters` bloğu: `query` (string, maxLength 320, kart adı+açıklaması üzerinde büyük/küçük harf duyarsız eşleşme), `category` (string enum = APP_CATEGORIES'in 8 değeri), `$ref: PageId`, `$ref: Limit` (paylaşılan bileşenler — customers.yaml satır 37-38 ile aynı ref'ler). Yanıt şeması `required: [items, total]` + opsiyonel `next_page_id: {type: string}`. `400 BadRequest` yanıtı eklenir. `@siyahtus/types` tarafında liste yanıt DTO'su (AppListItem'ı saran tip) sayfalama meta alanlarını taşıyacak şekilde güncellenir. Bundle + client yeniden üretilir. Backend implementasyonu bu alt-görevde YOK (09.2-v2-c).
DOSYALAR: packages/contract/openapi/paths/apps.yaml · packages/contract/openapi/openapi.yaml · packages/types/src/apps.ts
REFERANS DESEN (kopyalanacak): packages/contract/openapi/paths/customers.yaml · packages/contract/openapi/openapi.yaml
KK (birebir): "KK-türetilmiş: "Katalog listesi arama, kategori filtresi ve sayfalama parametreleriyle daraltılabilir; yanıt eşleşen toplam sayıyı ve bir sonraki sayfa göstericisini taşır." — TÜRETME GEREKÇESİ: FR-MOD-09.2'nin kendi KK metni ("Her biri OAuth/API key; kanal-tipli olanlar Channels'ta da yönetilir") arama/filtre/sayfalama içermiyor; 100+ sayısı yalnız Öncelik sütununda geçiyor ("Should (v1: 15–20; v2: 100+)"). Ölçeklenme gereksinimi PRD'de FR-MOD-09.1 ve FR-EK-B.1/NFR-P4 üzerinden dolaylı destekleniyor." | "kategori/ödeme/yerleşim filtreleri + arama" | "virtualized grids (Contacts/Teammates/Skills/Tickets/Knowledge/Apps/Campaigns), infinite scroll, skeleton, anlamlı empty state | ... 10.000+ satırda 60fps"
KK DOĞRULAMA: `apps/api/test/integration/contract-parity.test.ts` yeşil kalır (5/5). `pnpm --filter @siyahtus/contract bundle` sonrası bundle diff'i idempotent; üretilen client tipinde `listApps` operasyonu query parametrelerini taşır (typecheck 11/11 bunu kanıtlar — parametreler yanlış tiplenirse derleme kırılır).
KAPSAM DIŞI: route/servis implementasyonu (09.2-v2-c) · katalog verisinin büyütülmesi (09.2-v2-d / -e) · web arayüzü (09.2-v2-f / -g) · kategori enum'unun genişletilmesi (varsayım 1: 8'de sabit)
SÖZLEŞME: GET /settings/apps — `query` / `category` / `page_id` / `limit` query parametreleri eklenir; yanıt şemasına `total` (zorunlu) + `next_page_id` (opsiyonel) eklenir; `400 BadRequest` yanıtı eklenir. YENİ ROUTE YOK (mevcut path genişliyor) — ancak `packages/contract/openapi`'ye eklenip **re-bundle** edilmez ve client yeniden üretilmezse `contract-parity.test.ts` KIRILIR ([[siyahtus-contract-parity-gate]]).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 99.2. 09.2-v2-b [SONNET-XHIGH] Saf katalog filtre + sayfalama fonksiyonları (@siyahtus/types) + determinizm testleri

**Status:** done  
**Dependencies:** None  

@siyahtus/types içine iki saf fonksiyon: (1) `filterAppCatalog(entries, {query?, category?})` — `query` trim edilir, kart `name` + `description` üzerinde büyük/küçük harf duyarsız `includes`; boş/verilmemiş `query` tüm listeyi geçirir; `category` verilmişse kesişim alınır. (2) `paginateApps(entries, {limit, pageId?})` → `{page, total, nextPageId?}` — cursor = sayfanın son kartının `id`'si (determinist

**Details:**

09.2-v2-b — Saf katalog filtre + sayfalama fonksiyonları (@siyahtus/types) + determinizm testleri  [SONNET-XHIGH]

PRD: FR-MOD-09.2 (+ NFR-P2)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya (apps.ts + apps.test.ts). (2) Güvenlik sınırı yok — fonksiyonlar saf, tenant/DB/istek görmüyor, yalnız statik dizi üzerinde çalışıyor. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: aynı dosyadaki mevcut `channelApps()`/`connectableApps()` yardımcıları (apps.ts satır 362+) ve `apps/web/src/features/playbook/skill-filter.ts` saf filtre deseni (`skillMatchesControls`/`applySkillControls`). (5) Kontrat değişikliği yok. (6) KK mekanik doğrulanabilir (cursor zinciri tüm katalogu tekrarsız gezer — sayılabilir iddia).
NEDEN AÇIK: `packages/types/src/apps.ts` yalnız `findApp`/`isAppId`/`isChannelApp`/`channelApps`/`connectableApps`/`appChatData` taşıyor (satır 362 ve sonrası); arama, kategori filtresi veya sayfalama için hiçbir fonksiyon YOK — `APP_CATALOG` (satır 91) düz `readonly AppCatalogEntry[]`, indeks veya arama alanı içermiyor.
KAPSAM: @siyahtus/types içine iki saf fonksiyon: (1) `filterAppCatalog(entries, {query?, category?})` — `query` trim edilir, kart `name` + `description` üzerinde büyük/küçük harf duyarsız `includes`; boş/verilmemiş `query` tüm listeyi geçirir; `category` verilmişse kesişim alınır. (2) `paginateApps(entries, {limit, pageId?})` → `{page, total, nextPageId?}` — cursor = sayfanın son kartının `id`'si (deterministik, tenant-bağımsız); bilinmeyen cursor `null` döner (400'e çevirmek route'un işi, 09.2-v2-c). Sıralama katalog dizisinin doğal sırası (stabil — cursor'ın anlamlı olması için şart). Hiçbir tenant/DB kavramı bu katmana girmez.
DOSYALAR: packages/types/src/apps.ts · packages/types/src/apps.test.ts
REFERANS DESEN (kopyalanacak): packages/types/src/apps.ts · apps/web/src/features/playbook/skill-filter.ts · apps/web/src/features/playbook/skill-filter.test.ts
KK (birebir): "KK-türetilmiş: "Arama ve kategori filtresi kataloğu daraltır; sayfa zinciri kataloğun tamamını tekrarsız ve eksiksiz gezer." — TÜRETME GEREKÇESİ: FR-MOD-09.2 KK'sı yalnız "Her biri OAuth/API key" + kanal çapraz-linkini söylüyor; sayfalama/arama davranışı PRD'de FR-MOD-09.1 ("kategori/ödeme/yerleşim filtreleri + arama") üzerinden destekleniyor, bu alt-görev o davranışın saf çekirdeğidir." | "kategori/ödeme/yerleşim filtreleri + arama"
KK DOĞRULAMA: `packages/types/src/apps.test.ts`: arama büyük/küçük harf duyarsız daraltır; kategori daraltır; iki filtre birlikte kesişir; `limit=10` ile `nextPageId` zinciri izlendiğinde dönen kart id'lerinin birleşimi = `APP_CATALOG` (tekrarsız + eksiksiz kapsama); son sayfada `nextPageId` yok; bilinmeyen cursor → `null`; `total` filtreye göre hesaplanır (sayfa uzunluğuna değil).
KAPSAM DIŞI: route zod parse ve HTTP hata çevirimi (09.2-v2-c) · tenant join / installed alanı (09.2-v2-c) · katalog verisinin büyütülmesi (09.2-v2-d / -e) · UI
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 99.3. 09.2-v2-c [OPUS-XHIGH] GET /settings/apps sorgu bağlama — zod parse + sayfalama + tenant join korunumu

**Status:** done  
**Dependencies:** 99.1, 99.2  

Route'a `listQuery` zod şeması — `customers.ts` satır 16-18'in birebir uyarlaması: `query: z.string().trim().max(320).optional()`, `category: z.enum(APP_CATEGORIES).optional()`, `limit: z.coerce.number().int().min(1).max(100).default(...)`, `page_id` opsiyonel. Servis `list(tx, tenant, params)` sırası: (1) katalog `filterAppCatalog` ile daraltılır — TENANT-BAĞIMSIZ, (2) `paginateApps` ile sayfa ke

**Details:**

09.2-v2-c — GET /settings/apps sorgu bağlama — zod parse + sayfalama + tenant join korunumu  [OPUS-XHIGH]

PRD: FR-MOD-09.2 (+ NFR-P2, NFR-S5 tenant izolasyonu korunumu)
ETİKET GEREKÇESİ: OPUS-XHIGH: tenant-scoped bir endpoint'in yanıt kesiti ve katalog⋈`app_installations` join sırası değişiyor (`app-service.ts` `list()`); filtre/sayfalama kesitinin `request.withTenant` join'inin ÖNÜNE mi ARKASINA mı düşeceği kararı + input uzunluk sınırı (aşırı büyük sorgu maliyeti) = hafif güvenlik dokunuşu. Kullanıcı kuralı: güvenlik hassasiyeti olan iş ASLA SONNET'e verilmez → en az OPUS-XHIGH (SONNET koşul 2 ihlali). Çekirdek güvenlik sınırı (authN/authZ modeli, scope kapısı, izolasyon mekanizması) DEĞİŞMİYOR — yalnız korunuyor — bu yüzden OPUS-MAX gerekmez.
NEDEN AÇIK: `apps/api/src/routes/apps.ts` satır 43-51: `GET /settings/apps` handler'ı yalnız `request.tenant()` ve `apps.list(tx, tenant)` çağırıyor — `request.query` HİÇ okunmuyor (grep: dosyada `request.query` yok, tek `parse()` kullanımı OAuth callback body'sinde). `apps/api/src/services/apps/app-service.ts` `list()` katalog ⋈ workspace kurulumlarını TAM döndürüyor; filtreleme/sayfalama mantığı yok.
KAPSAM: Route'a `listQuery` zod şeması — `customers.ts` satır 16-18'in birebir uyarlaması: `query: z.string().trim().max(320).optional()`, `category: z.enum(APP_CATEGORIES).optional()`, `limit: z.coerce.number().int().min(1).max(100).default(...)`, `page_id` opsiyonel. Servis `list(tx, tenant, params)` sırası: (1) katalog `filterAppCatalog` ile daraltılır — TENANT-BAĞIMSIZ, (2) `paginateApps` ile sayfa kesilir, (3) YALNIZ o sayfanın app id'leri için kurulum join'i `request.withTenant` içinde yapılır (mevcut `withTenant` sarmalayıcı aynen korunur). Yanıt `{items, total, next_page_id?}` (customers.ts satır 78-79 deseni). Bilinmeyen `page_id` → `ApiError.validation` (400). Scope kapısı (`access_rules:ro`, `access_rules:rw`) DEĞİŞMEZ; `requireConnectableApp` kanal invariant'ı DEĞİŞMEZ.
DOSYALAR: apps/api/src/routes/apps.ts · apps/api/src/services/apps/app-service.ts · apps/api/test/integration/apps.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/customers.ts · apps/api/src/services/apps/app-service.ts
KK (birebir): "KK-türetilmiş: "Liste uç noktası arama/kategori/sayfalama parametrelerini doğrular; geçersiz parametreyi 400 ile reddeder; filtre ve sayfalama tenant izolasyonunu değiştirmez — bir lisansın bağlantısı başka lisansın hiçbir sayfasında görünmez." — TÜRETME GEREKÇESİ: FR-MOD-09.2 KK'sı bu davranışı içermiyor; izolasyon şartı NFR-S5 ve mevcut kodun (app_installations license-scoped) korunması gereğinden geliyor." | "kanal-tipli olanlar Channels'ta da yönetilir"
KK DOĞRULAMA: `apps/api/test/integration/apps.test.ts`: `?query=` daraltır; `?category=channels` yalnız kanal kartlarını verir; `?limit=10` + `next_page_id` zinciri kataloğun tamamını gezer; `total` filtreye göre. NEGATİF (önce): 321 karakterlik `query` → 400, `limit=0` ve `limit=101` → 400, geçersiz `category` → 400, bilinmeyen `page_id` → 400. CROSS-TENANT: mevcut satır 233 testi ("never shows or lets one tenant touch another's connection") sayfalanmış/filtrelenmiş yanıt altında da yeşil — B lisansının bağlantısı A'nın hiçbir sayfasında `installed=true` çıkmaz. Read-only admin testi (satır 218) parametrelerle de geçerli kalır.
KAPSAM DIŞI: katalog verisinin büyütülmesi (09.2-v2-d / -e) · web arayüzü (09.2-v2-f / -g) · scope veya yetki modelinde herhangi bir değişiklik (mevcut access_rules kapısı aynen korunur) · `GET /chats/:chatId/apps` in-chat okuma yolu (dokunulmaz)
SÖZLEŞME: yok (yeni path yok) — 09.2-v2-a'da eklenen parametrelerin implementasyonu. Yine de bu pencerede re-bundle sonrası `contract-parity.test.ts` yeşil doğrulanır; parametre adları kontratla birebir eşleşmezse (ör. `pageId` vs `page_id`) kontrat-koda sapması sessizce oluşur.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 99.4. 09.2-v2-d [SONNET-MAX] Katalog verisi 20 → 60 kart (mock, mevcut 8 kategori) + üst-sınır iddialarının kaldırılması

**Status:** done  
**Dependencies:** None  

`APP_CATALOG`'a 40 yeni VERİ app'i eklenir (kanal-tipli kart eklenmez — varsayım 3). Mevcut 8 kategoriye dağıtılır; hem `oauth` hem `api_key` sağlayıcı türü temsil edilir (KK payı). Her yeni kart mevcut invariant'ları sağlar: tekil `id`, boş olmayan `name`, `scopes.length > 0`, `dataLabel` + en az 1 `dataField` (her `dataField.options.length > 0`) — apps.test.ts satır 16-35 testi bunları zaten zor

**Details:**

09.2-v2-d — Katalog verisi 20 → 60 kart (mock, mevcut 8 kategori) + üst-sınır iddialarının kaldırılması  [SONNET-MAX]

PRD: FR-MOD-09.2 (PRD §5.5 MOD-09 v2 hücresi: "○ (100+)")
ETİKET GEREKÇESİ: SONNET-MAX: koşul 2 ve 3 sağlanıyor (güvenlik sınırı yok — salt statik veri; eşzamanlılık yok) AMA iş mekanik olarak GİRİFT: 40 yeni katalog girdisi × (id/name/category/provider/icon/description/scopes/dataLabel/en az 1 dataField × options) = çok sayıda benzer dönüşüm, yani matrisin "büyük katalog/veri dönüşümü" tanımı. SONNET yapabilir ama daha fazla düşünme bütçesi ister (id tekilliği + invariant testlerini elle korumak gerekiyor).
NEDEN AÇIK: `grep -n 'id:' packages/types/src/apps.ts` = TAM 20 katalog girdisi (satır 93-350: 15 veri app'i + 5 kanal-tipli kart). `packages/types/src/apps.test.ts` satır 40 `expect(APP_CATALOG.length).toBeLessThanOrEqual(20)` ve `apps/api/test/integration/apps.test.ts` satır 196 aynı üst sınırı iddia ediyor — katalog büyürken bu İKİ satır aynı pencerede güncellenmezse DoD kapısı KIRILIR.
KAPSAM: `APP_CATALOG`'a 40 yeni VERİ app'i eklenir (kanal-tipli kart eklenmez — varsayım 3). Mevcut 8 kategoriye dağıtılır; hem `oauth` hem `api_key` sağlayıcı türü temsil edilir (KK payı). Her yeni kart mevcut invariant'ları sağlar: tekil `id`, boş olmayan `name`, `scopes.length > 0`, `dataLabel` + en az 1 `dataField` (her `dataField.options.length > 0`) — apps.test.ts satır 16-35 testi bunları zaten zorluyor. Testlerde eşik `>= 60`'a çekilir, ÜST SINIR KALDIRILIR (hem types hem integration). Mevcut 20 kartın id/name/category alanları DEĞİŞMEZ (mevcut testler ve `data-testid="app-${id}"` seçicileri buna bağlı).
DOSYALAR: packages/types/src/apps.ts · packages/types/src/apps.test.ts · apps/api/test/integration/apps.test.ts
REFERANS DESEN (kopyalanacak): packages/types/src/apps.ts · packages/types/src/apps.test.ts
KK (birebir): "Her biri OAuth/API key" | "kanal-tipli olanlar Channels'ta da yönetilir"
KK DOĞRULAMA: `packages/types/src/apps.test.ts`: `APP_CATALOG.length >= 60`; id tekilliği (satır 18 `new Set(ids).size === ids.length`) 60 kartta da geçer; her veri app'inin `dataFields` dolu (satır 31); iki sağlayıcı türü de mevcut (satır 41-43); kanal/veri partisyonu toplamı = katalog (satır 53). `apps/api/test/integration/apps.test.ts` liste sayısı iddiası güncel ve yeşil.
KAPSAM DIŞI: 60 → 100+ genişletme (09.2-v2-e) · kategori enum'unun genişletilmesi (varsayım 1: 8'de sabit) · yeni kanal-tipli kart / CHANNEL_TYPES enum'una dokunma (varsayım 3) · arama/sayfalama mantığı (09.2-v2-b / -c)
SÖZLEŞME: yok — kategori enum'u değişmediği için OpenAPI'ye dokunulmaz (varsayım 1). Kategori enum'u genişletilirse `openapi.yaml` satır 1345 enum + `CATEGORY_LABEL` + testler ×N senkron güncellenmek zorundadır.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 99.5. 09.2-v2-e [SONNET-MAX] Katalog verisi 60 → 100+ kart + "100+" hedefinin testle sabitlenmesi

**Status:** done  
**Dependencies:** 99.4  

`APP_CATALOG` 60'tan 100+'a çıkarılır (en az 40 yeni veri app'i daha), aynı invariant'larla ve aynı 8 kategoriyle. Test eşikleri `>= 100` yapılır (types + integration). `findApp` her yeni id'yi çözer. Bu pencere kapandığında "100+" hedefi KODDA gerçekleşmiş ve TESTLE kilitlenmiş olur.

**Details:**

09.2-v2-e — Katalog verisi 60 → 100+ kart + "100+" hedefinin testle sabitlenmesi  [SONNET-MAX]

PRD: FR-MOD-09.2 (PRD §5.5 MOD-09 v2 hücresi: "○ (100+)")
ETİKET GEREKÇESİ: SONNET-MAX: 09.2-v2-d ile aynı sınıf — güvenlik/eşzamanlılık yok (koşul 2, 3 ✅) ama 40+ yeni katalog girdisinin mekanik üretimi geniş yüzeyli, tekrarlı veri dönüşümü. Ayrıca 100 kartlık dizide id tekilliğini elle korumak artan dikkat gerektiriyor.
NEDEN AÇIK: 09.2-v2-d katalogu 60'a taşıyor; PRD §5.5 matrisinin MOD-09 v2 hücresi `○ (100+)` diyor ve FR-MOD-09.2 Öncelik sütunu "Should (v1: 15–20; v2: 100+)" — hedef sayı yalnız bu iki yerde geçiyor, kalemin KK cümlesinde geçmiyor. Bu alt-görev hedefi kodda ve testte sabitler.
KAPSAM: `APP_CATALOG` 60'tan 100+'a çıkarılır (en az 40 yeni veri app'i daha), aynı invariant'larla ve aynı 8 kategoriyle. Test eşikleri `>= 100` yapılır (types + integration). `findApp` her yeni id'yi çözer. Bu pencere kapandığında "100+" hedefi KODDA gerçekleşmiş ve TESTLE kilitlenmiş olur.
DOSYALAR: packages/types/src/apps.ts · packages/types/src/apps.test.ts · apps/api/test/integration/apps.test.ts
REFERANS DESEN (kopyalanacak): packages/types/src/apps.ts · packages/types/src/apps.test.ts
KK (birebir): "Her biri OAuth/API key" | "KK-türetilmiş: "Katalog en az 100 kart taşır." — TÜRETME GEREKÇESİ: 100+ sayısı FR-MOD-09.2'nin KK sütununda DEĞİL, Öncelik sütununda ("v2: 100+") ve PRD §5.5 MOD-09 v2 hücresinde ("○ (100+)") geçiyor; kalem kapanış ölçütü olarak KK'ya bu turda türetildi."
KK DOĞRULAMA: `packages/types/src/apps.test.ts`: `APP_CATALOG.length >= 100` (üst sınır yok); id tekilliği 100+ kartta geçer; her veri app'inin dataFields'ı dolu; iki sağlayıcı türü mevcut; kanal/veri partisyon toplamı = katalog. `apps/api/test/integration/apps.test.ts` liste uzunluğu iddiası 100+ ve yeşil.
KAPSAM DIŞI: kategori enum'unun genişletilmesi · yeni kanal-tipli kart · UI ve performans ölçümü (09.2-v2-g / -h) · kataloğun DB'ye taşınması (varsayım 2: statik TS kalır)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 99.6. 09.2-v2-f [SONNET-XHIGH] Marketplace arama kutusu + tıklanabilir kategori filtresi + empty/skeleton durumları

**Status:** done  
**Dependencies:** 99.3  

Arama input'u (250ms debounce → `?query=`), kategori çip satırı ("Tümü" + 8 kategori, seçili çip `aria-pressed`, `?category=` ekler); react-query `queryKey` filtre state'ini içerir (aksi halde önbellek yanlış sonucu gösterir). `apps.isPending` → `Skeleton`, boş sonuç → `EmptyState` ("Hiçbir uygulama eşleşmiyor" + "Daha kısa bir arama deneyin") — filtre varken/yokken farklı metin (CustomersPage sat

**Details:**

09.2-v2-f — Marketplace arama kutusu + tıklanabilir kategori filtresi + empty/skeleton durumları  [SONNET-XHIGH]

PRD: FR-MOD-09.2 (+ FR-MOD-09.1 filtre/arama payı, FR-EK-B.1 empty state, NFR-A11Y6)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya. (2) Güvenlik sınırı yok — salt-okunur liste ekranı; hiçbir yetki/scope kararı yok, mevcut `useApiClient` çağrısı aynen kalıyor. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `CustomersPage.tsx` satır 60-75 (250ms debounce → `?query=`) + satır 40-41 (filtre state) + satır 150-162 (isPending → Skeleton, boş → EmptyState dallanması). (5) Kontrat değişikliği yok (09.2-v2-a'da yapıldı). (6) KK mekanik doğrulanabilir (mock `api.get` hangi URL ile çağrıldı).
NEDEN AÇIK: `apps/web/src/features/apps/AppsMarketplace.tsx` satır 42-45: `api.get('/settings/apps')` PARAMETRESİZ çağrılıyor; dosyada arama input'u yok (grep 0). Kategori `CATEGORY_LABEL` (satır 29-38) yalnız kart üstünde salt görsel çip olarak render ediliyor (ChannelAppCard satır 92-94, DataAppCard satır 151-153) — tıklanabilir/filtrelenebilir DEĞİL. Boş sonuç için `EmptyState` kullanımı yok; yükleme için `Skeleton` kullanımı yok (dosyada ikisinin de importu yok).
KAPSAM: Arama input'u (250ms debounce → `?query=`), kategori çip satırı ("Tümü" + 8 kategori, seçili çip `aria-pressed`, `?category=` ekler); react-query `queryKey` filtre state'ini içerir (aksi halde önbellek yanlış sonucu gösterir). `apps.isPending` → `Skeleton`, boş sonuç → `EmptyState` ("Hiçbir uygulama eşleşmiyor" + "Daha kısa bir arama deneyin") — filtre varken/yokken farklı metin (CustomersPage satır 154-161 deseni). KRİTİK KISIT: mevcut `data-testid="app-${id}"` seçicileri, `ChannelAppCard`/`DataAppCard` ayrımı ve `ConsentDialog` davranışı DEĞİŞMEZ; mevcut 4 web testi yeşil kalır.
DOSYALAR: apps/web/src/features/apps/AppsMarketplace.tsx · apps/web/src/features/apps/AppsMarketplace.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/customers/CustomersPage.tsx · apps/web/src/components/EmptyState.tsx · apps/web/src/components/Skeleton.tsx · apps/web/src/features/playbook/PlaybookPage.tsx
KK (birebir): "kategori/ödeme/yerleşim filtreleri + arama" | "virtualized grids (Contacts/Teammates/Skills/Tickets/Knowledge/Apps/Campaigns), infinite scroll, skeleton, anlamlı empty state | ... 10.000+ satırda 60fps"
KK DOĞRULAMA: `AppsMarketplace.test.tsx`: arama kutusuna yazınca debounce sonrası `api.get` `query=` içeren URL ile çağrılır; kategori çipine tıklayınca `category=` eklenir ve çip `aria-pressed="true"` olur; API boş `items` dönerse EmptyState görünür (boş dikdörtgen değil); `isPending` iken Skeleton görünür. Mevcut 4 test (kart durumu, consent→OAuth, disconnect, kanal kartı link) yeşil kalır.
KAPSAM DIŞI: virtualization ve sayfa zinciri UI'ı (09.2-v2-g) · kategori enum'unun genişletilmesi · kart görsel tasarımının değişmesi / ConsentDialog akışı · e2e spec (09.2-v2-h)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 99.7. 09.2-v2-g [OPUS-XHIGH] Virtualized kart grid'i + sayfa zinciri (NFR-P4 "yalnız görünür satır DOM'da")

**Status:** done  
**Dependencies:** 99.6, 99.5  

(1) Saf yardımcı `chunkIntoRows(items, columns)` — kartları satırlara böler; sütun sayısı responsive ölçümden (ResizeObserver / kırılım noktası) türetilir, tek doğruluk kaynağı bu fonksiyondur. (2) `VirtualList` sarmalayıcısı — sabit kart yüksekliği `rowHeight`, `role="list"`/`role="listitem"` a11y sözleşmesi korunur (VirtualList satır 157-160 yorumu). (3) Sayfa zinciri: `next_page_id` ile gelen s

**Details:**

09.2-v2-g — Virtualized kart grid'i + sayfa zinciri (NFR-P4 "yalnız görünür satır DOM'da")  [OPUS-XHIGH]

PRD: FR-EK-B.1 + NFR-P4 (FR-MOD-09.2 ölçeklenme kanıtı)
ETİKET GEREKÇESİ: OPUS-XHIGH: SONNET koşul 4 İHLAL — depoda çok-sütunlu GRID virtualization deseni YOK. `apps/web/src/components/VirtualList.tsx` (satır 138-196) tek-sütun düz satır primitifi (sabit `rowHeight`, `renderRow` başına bir satır); Contacts/Teammates/Skills/Tickets/Traffic/Team kullanımlarının hepsi tek sütunlu liste/tablo. Kartları satırlara bölme (kaç sütun, responsive ölçüm) ve mevcut `grid-cols-[repeat(auto-fill,minmax(260px,1fr))]` düzenini bozmadan sarma bir UI KOMPOZİSYON KARARI. Güvenlik sınırı yok → OPUS-MAX gerekmez.
NEDEN AÇIK: `apps/web/src/features/apps/AppsMarketplace.tsx` satır 55-59: düz CSS grid içinde `(apps.data?.items ?? []).map(...)` ile HER kart doğrudan DOM'a basılıyor; dosyada `VirtualList` importu YOK (grep 0). PRD satır 728 (FR-EK-B.1) "Apps"i virtualized-grid gerektiren listeler arasında ismen sayıyor; NFR-P4 (satır 745) "10.000+ satırda 60 fps; yalnız görünür satır DOM'da" diyor. 20 kartta bu ihlal ölçülemezdi; 100+ kartta somutlaşıyor.
KAPSAM: (1) Saf yardımcı `chunkIntoRows(items, columns)` — kartları satırlara böler; sütun sayısı responsive ölçümden (ResizeObserver / kırılım noktası) türetilir, tek doğruluk kaynağı bu fonksiyondur. (2) `VirtualList` sarmalayıcısı — sabit kart yüksekliği `rowHeight`, `role="list"`/`role="listitem"` a11y sözleşmesi korunur (VirtualList satır 157-160 yorumu). (3) Sayfa zinciri: `next_page_id` ile gelen sayfalar biriktirilir; sonsuz kaydırma + görünür "Daha fazla yükle" düğmesi (varsayım 8, NFR-A11Y6). KRİTİK KISIT: `data-testid="app-${id}"` seçicileri korunur — ancak artık yalnız görünür penceredeki kartlar DOM'dadır, bu yüzden mevcut testler ve (varsa) e2e seçicileri ilk pencerede kalan kartlara göre ayarlanır (sessiz kırılma riski).
DOSYALAR: apps/web/src/features/apps/AppsMarketplace.tsx · apps/web/src/features/apps/app-grid.ts · apps/web/src/features/apps/app-grid.test.ts · apps/web/src/features/apps/AppsMarketplace.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/components/VirtualList.tsx · apps/web/src/components/VirtualList.test.tsx · apps/web/src/features/customers/CustomersPage.tsx
KK (birebir): "NFR-P4 | Liste render (virtualization) | 10.000+ satırda 60 fps; yalnız görünür satır DOM'da" | "virtualized grids (Contacts/Teammates/Skills/Tickets/Knowledge/Apps/Campaigns), infinite scroll, skeleton, anlamlı empty state | ... 10.000+ satırda 60fps"
KK DOĞRULAMA: `AppsMarketplace.test.tsx`: 100+ kartlık yanıtla render edildiğinde DOM'daki `role="listitem"` sayısı toplam kart sayısından belirgin biçimde KÜÇÜK (yalnız görünür pencere + overscan) — NFR-P4'ün "yalnız görünür satır DOM'da" maddesinin birebir kanıtı. `app-grid.test.ts`: `chunkIntoRows` sütun sayısına göre doğru satırları üretir, son satır eksik olabilir, boş liste boş satır üretmez. Sayfa zinciri: `next_page_id` varken "Daha fazla yükle" düğmesi görünür ve ikinci sayfayı listeye ekler; yokken düğme yoktur.
KAPSAM DIŞI: `VirtualList.tsx` primitifinin kendisini değiştirmek (mevcut hâliyle kullanılır — Contacts/Teammates/Tickets ona bağlı, regresyon riski) · arama/kategori filtresi (09.2-v2-f) · e2e spec ve performans ölçüm notu (09.2-v2-h) · kart görsel tasarımı
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 99.8. 09.2-v2-h [OPUS-XHIGH] Uçtan uca doğrulama — 100+ katalogla e2e + NFR-P4 ölçüm notu + izolasyon/kontrat regresyonu

**Status:** done  
**Dependencies:** 99.3, 99.5, 99.7  

`apps/e2e/tests/apps.spec.ts`: marketplace açılır (100+ kart), arama daraltır, kategori çipi daraltır, "Daha fazla yükle" ile ikinci sayfa gelir, kanal-tipli kart Connect yerine Channels'a linkler (KK "kanal-tipli olanlar Channels'ta da yönetilir" 100+ katalogda hâlâ geçerli). NFR-P4 kanıtı: DOM'daki kart sayısının toplam karttan küçük olduğu ölçümü HANDOFF'a yazılır. Tam DoD kapısı: typecheck + l

**Details:**

09.2-v2-h — Uçtan uca doğrulama — 100+ katalogla e2e + NFR-P4 ölçüm notu + izolasyon/kontrat regresyonu  [OPUS-XHIGH]

PRD: FR-MOD-09.2 (+ FR-EK-B.1, NFR-P4, NFR-P2, NFR-S5 regresyonu)
ETİKET GEREKÇESİ: OPUS-XHIGH: dört yüzeyi (kontrat + backend + katalog verisi + UI) BİRLİKTE doğrulayan kapanış işi — hangi iddianın hangi KK maddesini kanıtladığına karar vermek yorum gerektiriyor (kalemin kendi KK'sı ölçeklenme kanıtını içermiyor, kanıt FR-EK-B.1/NFR-P4 üzerinden kuruluyor). Tek bir mekanik dosya işi değil → SONNET koşul 4 ve 6 ihlal. Güvenlik sınırı yok (yalnız mevcut izolasyonun regresyon doğrulaması) → OPUS-MAX gerekmez.
NEDEN AÇIK: Apps için browser e2e spec'i YOK — `apps/e2e/tests/` listesinde apps yer almıyor (ai-agent, billing, campaigns, command-palette, copilot, customers, demo-flow, inbox-panel, inbox-tabs, notifications, onboarding, playbook, reports, settings, team, tickets, traffic, widget). PLAN §D49/§D50 bunu açıkça kaydediyor: "Apps için ayrı browser e2e spec'i yok". 09.2-v2'nin kapanış ölçütü kataloğun ÖLÇEKLENDİĞİNİN kanıtı olduğu için bu turda bir kanıt yüzeyi gerekiyor.
KAPSAM: `apps/e2e/tests/apps.spec.ts`: marketplace açılır (100+ kart), arama daraltır, kategori çipi daraltır, "Daha fazla yükle" ile ikinci sayfa gelir, kanal-tipli kart Connect yerine Channels'a linkler (KK "kanal-tipli olanlar Channels'ta da yönetilir" 100+ katalogda hâlâ geçerli). NFR-P4 kanıtı: DOM'daki kart sayısının toplam karttan küçük olduğu ölçümü HANDOFF'a yazılır. Tam DoD kapısı: typecheck + lint + unit + integration (`--concurrency=1`, paket-paket seri) + build + e2e; contract-parity 5/5; cross-tenant testi 100+ katalog + sayfalama altında yeşil.
DOSYALAR: apps/e2e/tests/apps.spec.ts · apps/api/test/integration/apps.test.ts
REFERANS DESEN (kopyalanacak): apps/e2e/tests/customers.spec.ts · apps/e2e/tests/tickets.spec.ts · apps/e2e/tests/fixtures.ts
KK (birebir): "Her biri OAuth/API key" | "kanal-tipli olanlar Channels'ta da yönetilir" | "NFR-P4 | Liste render (virtualization) | 10.000+ satırda 60 fps; yalnız görünür satır DOM'da"
KK DOĞRULAMA: e2e: arama yazınca kart sayısı azalır; kategori çipi seçilince yalnız o kategorinin kartları kalır; "Daha fazla yükle" sonrası yeni kart id'leri görünür; kanal-tipli kartta "Manage in Channels" linki var, "Connect" düğmesi yok. integration: `total >= 100`; sayfa zinciri kataloğun tamamını gezer; cross-tenant testi (apps.test.ts satır 233) yeşil. contract-parity 5/5. NFR-P4: DOM kart sayısı << toplam (ölçüm HANDOFF'a kanıt olarak yazılır).
KAPSAM DIŞI: yeni özellik eklemek (bu alt-görev yalnız doğrular ve kapatır) · kategori enum'u genişletme · 09.4 Zapier/Make partner dizini (ayrı kalem) · kataloğun DB'ye taşınması
SÖZLEŞME: yok — yalnız contract-parity ve bundle idempotentliği doğrulanır.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
