# Task ID: 71

**Title:** 09.3 — API istek paketleri (Essential/Pro/Pro+)  ·  dilim V2-7

**Status:** done

**Dependencies:** 78 ✓

**Priority:** low

**Description:** FR-MOD-09.3 · Could (v2) · MOD-10.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `09.3`.

8 atomik alt-görev · ~9 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x3 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  09.3-a [SONNET-XHIGH] Statik API paket kataloğu + tipleri (@siyahtus/types)  (bağ: —)
  09.3-b [OPUS-XHIGH] api_package_purchases tablosu: Prisma modeli + migration + RLS politikası  (bağ: 09.3-a)
  09.3-c [OPUS-XHIGH] Okuma yüzeyi: GET /billing/api-packages (katalog) + GET /billing/api-packages/purchases + OpenAPI şemaları  (bağ: 09.3-a, 09.3-b)
  09.3-d [OPUS-MAX] Paket satın alma çekirdeği: POST /billing/api-packages + atomik kota artışı (mock ödeme, ADR-13)  (bağ: 09.3-a, 09.3-b, 09.3-c)
  09.3-e [SONNET-XHIGH] Satın alınan paketin fatura satır kalemi (invoice line_item)  (bağ: 09.3-d)
  09.3-f [SONNET-XHIGH] Billing ekranında API paketleri bölümü: kartlar + mock satın alma akışı  (bağ: 09.3-c, 09.3-d)
  09.3-g [SONNET-XHIGH] Satın alma geçmişi listesi (UI) + empty state  (bağ: 09.3-c, 09.3-f)
  09.3-h [OPUS-XHIGH] Uçtan uca doğrulama: satın alma → kota artışı → geçmiş → fatura (E2E + seed)  (bağ: 09.3-e, 09.3-f, 09.3-g)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): 09.3-d (paket satın alma çekirdeği) bölünmez. Üç sınır tek akıl yürütmede birleşiyor: (1) yetkilendirme — BILLING_WRITE_SCOPES + read-only lisansta yazılabilirlik kararı (allowWhenReadOnly, subscription PATCH/payment-method PUT ile aynı gerekçe zinciri), (2) tenant izolasyonu — satın alma license_id'ye bağlanır ve kota AYNI lisansın usage_record'ına yazılır, (3) eşzamanlılık — kota artışı ile eşzamanlı gelen recordApiCall aynı (license_id, metric, period) benzersiz satırında yarışır. metering.ts:117 recordApiCall'ın ON CONFLICT'i `included`'a DOKUNMUYOR (yalnız quantity+1); satın almanın ON CONFLICT'i bu yüzden `included = usage_records.included + quota` olmak ZORUNDA — VALUES'taki hesaplanmış değeri yazarsa dönemin ilk API çağrısı ile satın alma sırasına göre kota sessizce kaybolur veya çift eklenir. Bu üç şeyi ayrı pencerelere bölmek, upsert'ün doğruluğunu kanıtlayan bağlamı (recordApiCall'ın tam SQL'i + env varsayılanı + read-only kapısı) parçalar. Çekirdeğin ETRAFI zaten ayrıştırıldı: katalog (a), şema/RLS (b), okuma endpoint'leri (c), fatura satırı (e), UI (f/g), e2e (h).

VARSAYIMLAR: Paket = TEK SEFERLİK top-up (abonelik/otomatik yenileme DEĞİL). PRD satır 666 yalnız 'Fiyatlı API paketleri satışı' diyor; yenileme, iptal veya dönemsel tahsilat yazmıyor. Yenilemeli seçilseydi zamanlayıcı + iptal akışı + orantılı iade yüzeyi doğardı — bu tur kapsamına alınmadı. · Satın alınan kota, satın alındığı DÖNEMİN usage_records.included değerine eklenir; dönem devri (rollover) YOK. Gerekçe: usage_records (license_id, metric, period) benzersiz anahtarıyla dönem-bazlı; kalıcı kota subscription.aiResolutionsIncluded benzeri bir alan gerektirirdi ve api_calls tarafında böyle bir alan mevcut değil (Subscription modelinde yalnız aiResolutionsIncluded var). · Katalog KOD-İÇİ statik kalır (packages/types, APP_CATALOG deseni); DB'de paket katalog tablosu AÇILMAZ. Fiyat/kota değişimi bir kod değişimidir. Gerekçe: ADR-13 mock billing + 09.1/09.2'nin zaten kanıtlanmış statik katalog deseni; DB kataloğu yönetim UI'ı + yetkilendirme yüzeyi açardı. · Pro+ paketinin kotası ve fiyatı TÜRETİLDİ (1.000.000 çağrı / $249.99). PRD satır 666'nın Kaynak sütunu 'Essential 100K $29.99, Pro/Pro+ 500K $149.99' diyerek iki paketi tek rakama bağlıyor; v2-derin-analiz dosyalarında bu rakamların doğrulaması yok (grep 0). Essential ve Pro rakamları PRD gözleminden birebir alındı. · Ödeme tamamen MOCK: satın alma PaymentMethod kaydına dokunmaz, kart çekilmez, dış servis çağrılmaz ve kayıtlı ödeme yöntemi ZORUNLU TUTULMAZ. Kayıtlı kart şartı konsaydı mock akış kilitlenir ve e2e seed'i gerçek kart alanı taklidi gerektirirdi (NFR-C5 / PRD §11.1/1 sınırı). · Yeni ApiError tipi EKLENMEZ: bilinmeyen paket → not_found, geçersiz gövde → validation, scope eksikliği → authorization. Gerekçe: bu depoda yeni tip eklemek errors.ts'te iki yeri (ERROR_TYPES + ERROR_STATUS), scopes.test.ts sayacını, openapi enum'unu ve regen'i zorunlu kılıyor — mevcut tipler senaryoyu karşılıyorken bu maliyet gereksiz. · Aynı paket birden çok kez satın alınabilir (top-up mantığı); idempotency anahtarı yok. Çift gönderim UI'

AÇIK SORULAR (ürün kararı): Pro+ paketinin kotası ve fiyatı nedir? PRD satır 666 'Pro/Pro+ 500K $149.99' diyerek iki paketi tek rakama bağlıyor; v2-derin-analiz dosyalarında doğrulama yok. Türetilen 1M/$249.99 onaylanmazsa 09.3-a'daki katalog ve testleri güncellenir (ucuz düzeltme, yalnız 1 SONNET penceresi). · Satın alınan kota dönem sonunda yanar mı, yoksa bir sonraki döneme devreder mi (rollover)? Varsayım: yanar (dönem-bazlı). Devir istenirse usage_records'a yeni bir 'purchased_included' kolonu veya subscription tarafında kalıcı alan gerekir → 09.3-b migration'ı ve 09.3-d çekirdeği değişir (pahalı düzeltme). · Satın alma öncesi kayıtlı bir ödeme yöntemi zorunlu mu? Varsayım: hayır (mock). Zorunlu olursa 09.3-d'ye yeni bir reddetme dalı ve muhtemelen yeni ApiError tipi girer (errors.ts ×2 + scopes.test.ts sayacı + openapi enum + regen tuzağı). · Paketler tek seferlik mi, otomatik yenilenen abonelik mi? Yenilemeli olursa zamanlayıcı (ChatTimeoutSweeper benzeri bir job), iptal endpoint'i ve dönem geçişinde otomatik tahsilat yüzeyi doğar — bu, 09.3'ü tek kalemden ayrı bir alt-modüle çevirir. · İptal/iade politikası var mı? Kota geri alınabilir mi? Geri alma, usage_records.included'ı AZALTMA anlamına gelir ve kullanılmış kotanın altına düşme riski (negatif included / retroaktif aşım) doğurur — bu ayrı bir OPUS-MAX çekirdeği olur. · Bu kalem PRD'de 'Could (v2)' ve KK yetersiz (tek satırlık genel ifade); rapor-1-fonksiyonel.md'de [MOD-09.3] alt bölümü yok (grep 0) ve rakamların kaynağı doğrulanmamış. Ürün 

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 71.1. 09.3-a [SONNET-XHIGH] Statik API paket kataloğu + tipleri (@siyahtus/types)

**Status:** done  
**Dependencies:** None  

Kod-içi statik katalog: `ApiPackage` tipi (id, name, api_calls, price_cents) + `API_PACKAGE_CATALOG` readonly dizi (Essential/Pro/Pro+) + `findApiPackage(id)` + `isApiPackageId(v)`. APP_CATALOG'un birebir eşi; deterministik, dış servis yok. Kontrat/route/DB/UI YOK — bu alt-görev yalnız tip+veri katmanı.

**Details:**

09.3-a — Statik API paket kataloğu + tipleri (@siyahtus/types)  [SONNET-XHIGH]

PRD: FR-MOD-09.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 tamamı sağlandı — 3 dosya (2 yeni + 1 export satırı), güvenlik sınırı yok (saf veri + saf yardımcı, tenant/authz/kripto yok), eşzamanlılık yok, kopyalanacak desen ismen var (packages/types/src/apps.ts APP_CATALOG/findApp/isAppId), kontrat değişikliği yok, kabul mekanik (katalog invariant testi).
NEDEN AÇIK: packages/types/src/ listesinde api-package benzeri dosya YOK (apps.ts, custom-fields.ts, domain.ts, errors.ts, home.ts, ids.ts, index.ts, realtime-bus.ts, rtm.ts, scopes.ts, template-variables.ts, widget.ts). Essential/Pro/Pro+ paket adları, kotaları ve fiyatları hiçbir kod dosyasında yok (grep 'Essential' / 'Pro+' 0 sonuç). Kodda var olan tek API-kota kavramı apps/api/src/services/billing/metering.ts:31 `API_CALL_OVERAGE_UNIT = 100_000` — bu OTOMATİK aşım bloğu (FR-MOD-10.1.5), proaktif satın alınan adlandırılmış paket değil.
KAPSAM: Kod-içi statik katalog: `ApiPackage` tipi (id, name, api_calls, price_cents) + `API_PACKAGE_CATALOG` readonly dizi (Essential/Pro/Pro+) + `findApiPackage(id)` + `isApiPackageId(v)`. APP_CATALOG'un birebir eşi; deterministik, dış servis yok. Kontrat/route/DB/UI YOK — bu alt-görev yalnız tip+veri katmanı.
DOSYALAR: packages/types/src/api-packages.ts · packages/types/src/api-packages.test.ts · packages/types/src/index.ts
REFERANS DESEN (kopyalanacak): packages/types/src/apps.ts (APP_CATALOG satır 91, findApp satır 363, isAppId satır 368 — statik katalog + lookup deseni) · packages/types/src/apps.test.ts (katalog invariant testi: benzersiz id, sayı aralığı, lookup doğruluğu)
KK (birebir): "Fiyatlı API paketleri satışı" | "KK-türetilmiş: katalog üç paketi taşır — Essential 100.000 çağrı / $29.99, Pro 500.000 çağrı / $149.99, Pro+ 1.000.000 çağrı / $249.99. Türetme gerekçesi: PRD KK sütunu tek satırlık genel ifade; paket adları ve rakamlar PRD satır 666'nın 'Kaynak' sütunundaki gözlem notundan ('Essential 100K $29.99, Pro/Pro+ 500K $149.99') alındı. Pro+ rakamı PRD'de ayrı verilmediği için türetildi (bkz. açık soru 1)."
KK DOĞRULAMA: api-packages.test.ts: (1) katalog tam 3 giriş ve id'ler benzersiz, (2) her paketin api_calls > 0 ve price_cents > 0, (3) Essential/Pro id'lerinin kota+fiyatı PRD gözlem rakamlarıyla birebir, (4) findApiPackage(bilinmeyen) === undefined ve isApiPackageId(bilinmeyen) === false. Komut: `pnpm --filter @siyahtus/types test`.
KAPSAM DIŞI: OpenAPI şeması (09.3-c) · api_package_purchases tablosu (09.3-b) · satın alma yazma yolu (09.3-d) · fatura satırı (09.3-e) · UI (09.3-f/g) · fiyat/kota'nın DB'den yönetilmesi (varsayım 3: katalog kod-içi kalır)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 71.2. 09.3-b [OPUS-XHIGH] api_package_purchases tablosu: Prisma modeli + migration + RLS politikası

**Status:** done  
**Dependencies:** 71.1  

Prisma modeli `ApiPackagePurchase` → tablo `api_package_purchases`: id (uuid), licenseId (BigInt, map license_id), packageId (map package_id), apiCalls (BigInt, map api_calls — satın alınan kota), priceCents (Int, map price_cents), period (Char(6), yyyymm — kotanın eklendiği dönem), purchasedAt (Timestamptz, map purchased_at), License ilişkisi onDelete: Cascade, @@index([licenseId, period]). Migra

**Details:**

09.3-b — api_package_purchases tablosu: Prisma modeli + migration + RLS politikası  [OPUS-XHIGH]

PRD: FR-MOD-09.3 (+ NFR-S4 tenant izolasyon/RLS)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni tablonun RLS politikası tenant izolasyon sınırına dokunuyor → koşul 2 ihlali, SONNET olamaz (kullanıcı kuralı: güvenlik işi asla sonnet'e verilmez). Ancak algoritma tasarımı/eşzamanlılık yok — mevcut app_installations RLS deseninin birebir kopyası ve tüketici kod yok → OPUS-MAX gerekmiyor.
NEDEN AÇIK: apps/api/prisma/schema.prisma'da satın alınan paketi tutan model YOK: UsageRecord (satır ~1236) yalnız metric/period/quantity/included/overage_unit/overage_unit_price_cents taşıyor, Subscription (satır ~1213) plan/billing_cycle/seats/unit_price_cents/ai_resolutions_included taşıyor. Hangi lisansın hangi paketi ne zaman satın aldığı hiçbir tabloda saklanmıyor. Migration dizininde en son giriş 20260727090000_app_installations — api_package benzeri migration yok.
KAPSAM: Prisma modeli `ApiPackagePurchase` → tablo `api_package_purchases`: id (uuid), licenseId (BigInt, map license_id), packageId (map package_id), apiCalls (BigInt, map api_calls — satın alınan kota), priceCents (Int, map price_cents), period (Char(6), yyyymm — kotanın eklendiği dönem), purchasedAt (Timestamptz, map purchased_at), License ilişkisi onDelete: Cascade, @@index([licenseId, period]). Migration SQL'de `ALTER TABLE api_package_purchases ENABLE ROW LEVEL SECURITY;` + `CREATE POLICY api_package_purchases_tenant ...` (app_installations migration.sql satır 43-44 deseninin birebir eşi). Tüketici kod YOK — yalnız şema.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/<timestamp>_api_package_purchases/migration.sql · apps/api/test/integration/data-model.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260727090000_app_installations/migration.sql (satır 43-44: ENABLE ROW LEVEL SECURITY + CREATE POLICY <tablo>_tenant) · apps/api/prisma/schema.prisma (PaymentMethod ve UsageRecord modelleri — licenseId + @map + Cascade + @@map deseni) · apps/api/test/integration/data-model.test.ts (satır ~463/469: cross-tenant erişim /permission denied|policy/i ile reddedilir iddiası)
KK (birebir): "Fiyatlı API paketleri satışı" | "KK-türetilmiş: satın alınan her paket kalıcı bir kayda düşer (hangi lisans, hangi paket, ne kadar kota, ne fiyat, hangi dönem). Türetme gerekçesi: PRD KK 'satış' diyor ama kaydın nerede tutulacağını söylemiyor; ADR-13 (Stripe MOCK) gereği dış sağlayıcıda kayıt yok, dolayısıyla kayıt yerel tabloda tutulmak zorunda."
KK DOĞRULAMA: data-model.test.ts: (1) migration deploy sonrası api_package_purchases tablosu ve api_package_purchases_tenant politikası mevcut, RLS enabled; (2) CROSS-TENANT NEGATİF (önce yazılır): B lisansı bağlamında A lisansının satın alma satırı okunamaz → /permission denied|policy/i. Komut: `pnpm --filter @siyahtus/api test -- data-model` (DB süiti serial).
KAPSAM DIŞI: satın alma yazma yolu ve kota artışı (09.3-d) · okuma endpoint'leri (09.3-c) · fatura satırı (09.3-e) · katalog tablosu — katalog kod-içi statik kalır (varsayım 3), DB'de paket kataloğu tablosu AÇILMAZ
MIGRATION: EVET — yeni tablo api_package_purchases (license_id, package_id, api_calls, price_cents, period, purchased_at) + ENABLE ROW LEVEL SECURITY + CREATE POLICY api_package_purchases_tenant + index (license_id, period)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 71.3. 09.3-c [OPUS-XHIGH] Okuma yüzeyi: GET /billing/api-packages (katalog) + GET /billing/api-packages/purchases + OpenAPI şemaları

**Status:** done  
**Dependencies:** 71.1, 71.2  

Contract-first: (1) packages/contract/openapi/paths/reports.yaml'a `apiPackages.get` (katalog) + `apiPackagePurchases.get` (satın alma geçmişi) operasyonları, ADR-13 mock notu açıklamada; (2) openapi.yaml components/schemas'a `ApiPackage` (id, name, api_calls, price_cents) + `ApiPackagePurchase` (package_id, name, api_calls, price_cents, period, purchased_at); (3) bundle regen; (4) apps/api/src/ro

**Details:**

09.3-c — Okuma yüzeyi: GET /billing/api-packages (katalog) + GET /billing/api-packages/purchases + OpenAPI şemaları  [OPUS-XHIGH]

PRD: FR-MOD-09.3 (+ NFR-S4)
ETİKET GEREKÇESİ: OPUS-XHIGH: iki YENİ yetkili endpoint ekleniyor (BILLING_READ_SCOPES kapısı) — kullanıcı kuralı 'yeni bir yetkili endpoint eklemek / mevcut scope'u genişletmek EN AZ OPUS-XHIGH olur'. purchases tenant-scoped okuma olduğu için izolasyon hassasiyeti var (koşul 2 ihlali → SONNET olamaz). Ancak yazma, kota mutasyonu, kripto veya eşzamanlılık yok → çekirdek güvenlik sınırı değil, MAX gerekmiyor.
NEDEN AÇIK: apps/api/src/routes/reports.ts'te billing route'ları: GET /billing/subscription (857), PATCH /billing/subscription (868), GET /billing/usage (909), GET /billing/invoices (931), GET /billing/invoices/:period/download (940), GET /billing/payment-method (968), PUT /billing/payment-method (978). 09.3'e özgü paket route'u YOK (grep 'api-packages' 0 sonuç). packages/contract/openapi/paths/reports.yaml'da subscription/usage/invoices/invoiceDownload/paymentMethod operasyonları tanımlı, api-packages tanımlı değil; openapi.yaml'da UsageSummary (1626), SubscriptionView (1677), Invoice (1723), PaymentMethod (1750) şemaları var, ApiPackage/ApiPackagePurchase yok.
KAPSAM: Contract-first: (1) packages/contract/openapi/paths/reports.yaml'a `apiPackages.get` (katalog) + `apiPackagePurchases.get` (satın alma geçmişi) operasyonları, ADR-13 mock notu açıklamada; (2) openapi.yaml components/schemas'a `ApiPackage` (id, name, api_calls, price_cents) + `ApiPackagePurchase` (package_id, name, api_calls, price_cents, period, purchased_at); (3) bundle regen; (4) apps/api/src/routes/reports.ts'e iki GET — katalog @siyahtus/types API_PACKAGE_CATALOG'dan (tenant sorgusu yok), purchases request.withTenant ile api_package_purchases'tan (purchasedAt desc). İkisi de `config: { scopes: BILLING_READ_SCOPES }`. UYARI: contract-parity.test.ts İKİ YÖNLÜ çalışıyor ('an undocumented route fails, and so does a documented route that nothing serves') — bu yüzden kontrat ve route AYNI pencerede iner; salt-kontrat alt-görevi DoD kapısından geçemez.
DOSYALAR: packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/reports.ts · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts satır 931-938 (GET /billing/invoices: BILLING_READ_SCOPES + request.withTenant + reply.send({ items })) · packages/contract/openapi/paths/reports.yaml satır 300-330 (invoices.get: tags/operationId/summary/description + 401/403/429 ref deseni) · apps/api/src/routes/apps.ts satır 43-51 (GET /settings/apps: statik katalog + kurulum durumu birleştirme)
KK (birebir): "Fiyatlı API paketleri satışı" | "KK-türetilmiş: satın alınabilir paketler ve satın alınmış paketlerin geçmişi API üzerinden okunabilir. Türetme gerekçesi: PRD 'satış' diyor; satış akışının önkoşulu katalogun ve geçmişin okunabilmesidir, PRD bu iki okumayı ayrıca yazmıyor."
KK DOĞRULAMA: reports-billing.test.ts: (1) GET /billing/api-packages üç paketi (@siyahtus/types kataloğuyla aynı id/kota/fiyat) döner; (2) GET /billing/api-packages/purchases yalnız kendi lisansının satırlarını döner — CROSS-TENANT: A lisansının satın alması B'nin yanıtında görünmez; (3) NEGATİF: billing/reports scope'u olmayan token → 403; (4) satın alma yokken purchases boş dizi (200, hata değil). contract-parity.test.ts yeşil (iki yön).
KAPSAM DIŞI: POST satın alma ve kota artışı (09.3-d) · fatura satırı (09.3-e) · UI (09.3-f/g) · katalogun tenant'a göre filtrelenmesi/özelleştirilmesi (katalog global sabittir)
SÖZLEŞME: OpenAPI: paths/reports.yaml'a `apiPackages.get` + `apiPackagePurchases.get`; openapi.yaml components/schemas'a `ApiPackage` + `ApiPackagePurchase`. YENİ ROUTE EKLENDİĞİ İÇİN packages/contract/openapi'ye eklenip RE-BUNDLE EDİLMEZSE contract-parity.test.ts KIRILIR; parite iki yönlü olduğu için kontrat ile route aynı pencerede inmelidir.
MIGRATION: yok (tablo 09.3-b'de açıldı)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 71.4. 09.3-d [OPUS-MAX] Paket satın alma çekirdeği: POST /billing/api-packages + atomik kota artışı (mock ödeme, ADR-13)

**Status:** done  
**Dependencies:** 71.1, 71.2, 71.3  

Contract-first: (1) reports.yaml'a `apiPackages.post` (requestBody: {package_id}, response: satın alma + güncel usage özeti), ADR-13 mock ödeme notu; bundle regen. (2) Yeni servis apps/api/src/services/billing/api-package-service.ts — TEK transaction içinde: paket id doğrula (bilinmeyen → ApiError.notFound), api_package_purchases satırı yaz (licenseId, packageId, apiCalls, priceCents, period=curre

**Details:**

09.3-d — Paket satın alma çekirdeği: POST /billing/api-packages + atomik kota artışı (mock ödeme, ADR-13)  [OPUS-MAX]

PRD: FR-MOD-09.3 (+ NFR-S4 tenant izolasyon/RLS, NFR-C5 kart/ödeme verisi sınırı)
ETİKET GEREKÇESİ: OPUS-MAX (BÖLÜNMEZ ÇEKİRDEK): koşul 2 ve 3 birlikte ihlal ediliyor. (a) Yetkilendirme sınırı — BILLING_WRITE_SCOPES + read-only lisansta yazılabilirlik (allowWhenReadOnly) kararı; (b) tenant izolasyonu — satın alma license_id'ye bağlanır ve kota AYNI lisansın usage_record'ına yazılır, yanlış scope/tenant başka müşterinin kotasını arttırır; (c) eşzamanlılık — kota artışı ile recordApiCall aynı (license_id, metric, period) benzersiz satırında yarışır ve ON CONFLICT ifadesinin yanlış yazılması kotayı sessizce kaybettirir/çift ekler; (d) para etkisi — yanlış kararın maliyeti faturaya yansır. Bu iş asla SONNET'e verilmez.
NEDEN AÇIK: Kota artışının yazılabileceği tek yer usage_records: apps/api/src/services/billing/metering.ts:117 recordApiCall() 'INSERT INTO usage_records (...) VALUES (..., 1, included, ...) ON CONFLICT (license_id, metric, period) DO UPDATE SET quantity = usage_records.quantity + 1' — `included` alanını ON CONFLICT'te GÜNCELLEMİYOR, yani dönemin ilk API çağrısı included'ı env varsayılanından (apps/api/src/config/env.ts:84 API_CALLS_INCLUDED = 100_000) sabitliyor ve sonraki çağrılar ona dokunmuyor. Bu, satın almanın included'ı güvenle arttırabileceği anlamına gelir — AMA yalnız ON CONFLICT'te 'included = usage_records.included + quota' yazılırsa; VALUES'ta hesaplanmış değer yazılıp DO UPDATE'te aynen kullanılırsa dönemin ilk çağrısı ile satın alma sırasına göre kota kaybolur veya çift eklenir. apps/api/src/routes/reports.ts'te 09.3'e özgü yazma route'u YOK (grep 0).
KAPSAM: Contract-first: (1) reports.yaml'a `apiPackages.post` (requestBody: {package_id}, response: satın alma + güncel usage özeti), ADR-13 mock ödeme notu; bundle regen. (2) Yeni servis apps/api/src/services/billing/api-package-service.ts — TEK transaction içinde: paket id doğrula (bilinmeyen → ApiError.notFound), api_package_purchases satırı yaz (licenseId, packageId, apiCalls, priceCents, period=currentPeriod()), usage_records'a ATOMİK upsert: INSERT ... VALUES (quantity 0, included = env varsayılanı + paket kotası, overage_unit/price = API_CALL_OVERAGE_UNIT/env) ON CONFLICT (license_id, metric, period) DO UPDATE SET included = usage_records.included + <quota>, updated_at = now(); writeAuditEntry('billing.api_package_purchased', {package_id, api_calls, price_cents}). (3) routes/reports.ts'e POST /billing/api-packages — config: { scopes: BILLING_WRITE_SCOPES, allowWhenReadOnly: true } (subscription PATCH:872 ve payment-method PUT:982 ile aynı gerekçe: kota satın almak read-only lisansın çıkış yoludur). ÖDEME MOCK (ADR-13): kart çekilmez, PaymentMethod'a dokunulmaz, dış servis çağrılmaz, gerçek PAN hiçbir yere yazılmaz (NFR-C5).
DOSYALAR: packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/services/billing/api-package-service.ts · apps/api/src/routes/reports.ts · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/billing/metering.ts satır 117-131 (recordApiCall: usage_records üzerinde atomik INSERT ... ON CONFLICT DO UPDATE — yarışa dayanıklı sayaç deseni; satın almanın karşı-deseni buradan türetilir) · apps/api/src/routes/reports.ts satır 868-905 (PATCH /billing/subscription: BILLING_WRITE_SCOPES + allowWhenReadOnly + withTenant tek transaction + writeAuditEntry + yanıtı aynı transaction'da geri okuma) · apps/api/src/services/billing/metering.ts satır 134-190 (usageSummary: included/overage/blok fiyatlama okuma yolu — satın alma sonrası bu fonksiyonun çıktısı değişmeli)
KK (birebir): "Fiyatlı API paketleri satışı" | "KK-türetilmiş: bir paket satın alındığında o dönemin API çağrı kotası paketin kotası kadar artar ve aşım hesabı yeni kotaya göre yapılır; ödeme mock'tur (ADR-13), gerçek kart çekilmez. Türetme gerekçesi: PRD KK yalnız 'satış' diyor; orkestratörün bağlayıcı kapsam kararı 'gerçek ödeme YOK — paket satın alma mock, kota artışı gerçek' bu kriteri belirliyor."
KK DOĞRULAMA: reports-billing.test.ts — NEGATİFLER POZİTİFLERDEN ÖNCE: (1) billing yazma scope'u olmayan token (ör. yalnız reports_read) → 403; (2) bilinmeyen package_id → 404 (not_found); (3) CROSS-TENANT: A lisansı paket satın aldığında B lisansının usage_records.included'ı DEĞİŞMİYOR ve B'nin GET /billing/usage yanıtı aynı kalıyor; (4) EŞZAMANLILIK: dönemde 0 kayıt varken satın alma ile N paralel recordApiCall birlikte koşturulur → sonuçta quantity === N ve included === env_varsayılanı + paket_kotası (ne kayıp ne çift); aynı test satın alma ÖNCE ve SONRA sıralarıyla tekrarlanır; (5) POZİTİF: satın alma sonrası GET /billing/usage'da api_calls.included artmış, overage ve overage_cents düşmüş; (6) audit_log'da billing.api_package_purchased girdisi var; (7) read-only lisansta satın alma 200 döner (allowWhenReadOnly). contract-parity yeşil.
KAPSAM DIŞI: gerçek ödeme / Stripe çağrısı (⛔ ADR-13, MASTER-PROMPT sınırı) · otomatik yenilenen abonelik paketi ve zamanlayıcı (varsayım 1: tek seferlik top-up) · iade / iptal / kota geri alma (açık soru 5) · satın alınan kotanın dönem devri — rollover (varsayım 2: dönem-bazlı, devir yok) · fatura satır kalemi (09.3-e) · UI (09.3-f/g) · idempotency anahtarı (varsayım 7: aynı paket tekrar satın alınabilir)
SÖZLEŞME: OpenAPI: paths/reports.yaml'a `apiPackages.post` (requestBody {package_id}, 200 satın alma + usage, 400/401/403/404/429). YENİ ROUTE — packages/contract/openapi'ye eklenip RE-BUNDLE edilmezse contract-parity.test.ts KIRILIR (parite iki yönlü). YENİ ApiError TİPİ EKLENMEZ: bilinmeyen paket → mevcut not_found, geçersiz gövde → validation, scope → authorization yeter. Zorunlu hale gelirse bu depodaki tuzak: packages/types/src/errors.ts'te İKİ yer (ERROR_TYPES listesi + ERROR_STATUS haritası, satır 57/63) + scopes.test.ts sayacı + openapi.yaml error type enum + regen.
MIGRATION: yok (tablo 09.3-b'de açıldı; bu alt-görev yalnız o tabloya yazar ve usage_records'u günceller)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 71.5. 09.3-e [SONNET-XHIGH] Satın alınan paketin fatura satır kalemi (invoice line_item)

**Status:** done  
**Dependencies:** 71.4  

buildInvoices() içinde dönem başına api_package_purchases okuması ekle; her satın alma için line_item üret ({ description: 'API package — <ad> (<kota> calls)', amount_cents: price_cents }) ve subtotal/total'a ekle. Mevcut seat + overage satırlarının hesabı DEĞİŞMEZ. CSV indirme (invoiceCsvRows) yeni satırı kendiliğinden taşır — injection-safe kaçış deseni korunur. Kontrat değişmez.

**Details:**

09.3-e — Satın alınan paketin fatura satır kalemi (invoice line_item)  [SONNET-XHIGH]

PRD: FR-MOD-09.3 (+ FR-MOD-10.3)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2 dosya + test; güvenlik sınırı yok (endpoint, scope ve RLS zaten yerinde, yeni yüzey açılmıyor); eşzamanlılık yok (kapanmış/açık dönemin salt okuması); kopyalanacak desen AYNI dosyada (invoice-service.ts overageCents + line_items üretimi); kontrat değişikliği yok (Invoice.line_items zaten dizi, openapi.yaml:1723); kabul mekanik (total === subtotal === satırların toplamı).
NEDEN AÇIK: apps/api/src/services/billing/invoice-service.ts buildInvoices() faturayı subscription + usage_records + agentMembership'ten TÜRETİYOR (dosya başı yorumu: 'derives them from the two things that are real — the subscription and the per-period usage records'); api_package_purchases tablosunu okumuyor. 09.3-b'de açılan tablo bu değişiklik olmadan faturada 0 tüketicili kalır — satın alınan paket para harcatır ama hiçbir faturada görünmez.
KAPSAM: buildInvoices() içinde dönem başına api_package_purchases okuması ekle; her satın alma için line_item üret ({ description: 'API package — <ad> (<kota> calls)', amount_cents: price_cents }) ve subtotal/total'a ekle. Mevcut seat + overage satırlarının hesabı DEĞİŞMEZ. CSV indirme (invoiceCsvRows) yeni satırı kendiliğinden taşır — injection-safe kaçış deseni korunur. Kontrat değişmez.
DOSYALAR: apps/api/src/services/billing/invoice-service.ts · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/billing/invoice-service.ts (overageCents() satır ~78-97 ve buildInvoices() satır ~100-130 — dönem başına kayıt okuma + line_item üretme + toplama deseni; InvoiceLineItem tipi satır 39) · apps/api/src/routes/reports.ts satır 931-960 (fatura listesi + CSV indirme yolu — değiştirilmez, yalnız yeni satırı taşır)
KK (birebir): "Fiyatlı API paketleri satışı" | "KK-türetilmiş: satın alınan paket, satın alındığı dönemin faturasında ayrı bir satır kalemi olarak görünür ve fatura toplamına eklenir. Türetme gerekçesi: PRD 09.3 KK yalnız 'satış' diyor, faturalandırmayı FR-MOD-10.3 ('Fatura listesi/indirme') taşıyor; ADR-13 gereği fatura türetilmiş olduğundan satır kalemi türetme yolunda üretilmek zorunda."
KK DOĞRULAMA: reports-billing.test.ts: (1) satın alma sonrası GET /billing/invoices'ta ilgili dönemin faturasında 'API package' satırı var ve amount_cents = paket fiyatı; (2) total_cents === subtotal_cents === line_items toplamı (mevcut seat/overage satırlarıyla birlikte); (3) satın alma yokken fatura satır sayısı değişmiyor (regresyon); (4) CSV indirmede satır görünür; (5) CROSS-TENANT: başka lisansın satın alması bu lisansın faturasına girmiyor.
KAPSAM DIŞI: fatura şemasında yeni alan (line_items zaten var — kontrat değişmez) · PDF fatura (v2 kapsam dışı) · iade satırı / negatif line_item (açık soru 5) · UI (09.3-f/g)
SÖZLEŞME: yok (Invoice.line_items dizisi openapi.yaml:1723'te tanımlı; yeni path/schema eklenmiyor → contract-parity etkilenmez)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 71.6. 09.3-f [SONNET-XHIGH] Billing ekranında API paketleri bölümü: kartlar + mock satın alma akışı

**Status:** done  
**Dependencies:** 71.3, 71.4  

BillingPage.tsx'e `ApiPackagesSection`: GET /billing/api-packages ile üç paket kartı (ad, kota, fiyat — formatCount/formatMoney ile); 'Buy' → onay adımı → POST /billing/api-packages; başarıda usage + invoices + purchases query'lerini invalidate (kota artışı sayaçta anında görünür); hata → Banner (tone='error'); loading/disabled durumları; ödeme mock olduğunu söyleyen açık metin (ADR-13). Read-only

**Details:**

09.3-f — Billing ekranında API paketleri bölümü: kartlar + mock satın alma akışı  [SONNET-XHIGH]

PRD: FR-MOD-09.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2 dosya (aynı feature klasörü) + test; güvenlik kararı tamamen backend'de (09.3-d), UI yalnız endpoint çağırıyor; eşzamanlılık yok; kopyalanacak desen ismen var (BillingPage.tsx PaymentMethodSection satır 531 ve ManagePlan satır 388 — useQuery + useMutation + invalidateQueries + readOnly gating; kart gridi için AppsMarketplace.tsx); kontrat değişikliği yok (09.3-c/d'de indi); kabul mekanik (render + çağrı + pasif buton + hata bannerı).
NEDEN AÇIK: apps/web/src/features/billing/BillingPage.tsx (900 satır) subscription/usage okuyor ve ManagePlan (satır 388), QuotaBar (357), PaymentMethodSection (531), PaymentMethodForm (628), InvoicesSection (801) render ediyor; api_calls yalnız sayaç olarak okunuyor (satır 140) ve 'overage-package' testid'i (satır 273) OTOMATİK aşım bloğunu gösteriyor — satın alınabilir paket kartı/checkout YOK. apps/web/src/features/ altında 09.3'e özgü ekran yok (mevcut tek marketplace ekranı apps/AppsMarketplace.tsx, entegrasyon kartları = 09.1/09.2).
KAPSAM: BillingPage.tsx'e `ApiPackagesSection`: GET /billing/api-packages ile üç paket kartı (ad, kota, fiyat — formatCount/formatMoney ile); 'Buy' → onay adımı → POST /billing/api-packages; başarıda usage + invoices + purchases query'lerini invalidate (kota artışı sayaçta anında görünür); hata → Banner (tone='error'); loading/disabled durumları; ödeme mock olduğunu söyleyen açık metin (ADR-13). Read-only lisansta buton pasif DEĞİL — backend allowWhenReadOnly (09.3-d) olduğu için satın alma açık kalır; bu davranış testte kilitlenir.
DOSYALAR: apps/web/src/features/billing/BillingPage.tsx · apps/web/src/features/billing/BillingPage.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/billing/BillingPage.tsx satır 531-700 (PaymentMethodSection + PaymentMethodForm: useQuery + useMutation + useQueryClient.invalidateQueries + readOnly gating + Banner hata gösterimi) · apps/web/src/features/billing/BillingPage.tsx satır 388-530 (ManagePlan: seçim → mutation → yeniden okuma deseni) · apps/web/src/features/apps/AppsMarketplace.tsx (katalog kartı gridi deseni) · apps/web/src/lib/format.ts (formatCount/formatMoney)
KK (birebir): "Fiyatlı API paketleri satışı" | "KK-türetilmiş: kullanıcı Billing ekranında üç paketi fiyat ve kotasıyla görür ve tek akışta satın alabilir; satın alma sonrası API çağrı sayacındaki kota anında güncellenir. Türetme gerekçesi: PRD'de 09.3 için ayrı UX/akış tanımı yok — rapor-1-fonksiyonel.md'de [MOD-09.3] alt bölümü YOK (grep 0), v2-01/03/04'te paket adları geçmiyor; ekran davranışı mevcut Billing ekranı desenlerinden türetildi."
KK DOĞRULAMA: BillingPage.test.tsx: (1) üç paket kartı ad/kota/fiyatla render ediliyor; (2) 'Buy' → POST /billing/api-packages çağrılıyor ve usage query invalidate ediliyor (sayaç yeniden okunuyor); (3) POST hata dönerse Banner görünüyor ve sayaç değişmiyor; (4) katalog yüklenirken loading, boş katalogda anlamlı empty state; (5) read-only lisansta buton etkin kalıyor (backend allowWhenReadOnly ile hizalı).
KAPSAM DIŞI: satın alma geçmişi listesi (09.3-g) · e2e (09.3-h) · kart/ödeme bilgisi girişi — mevcut PaymentMethodForm'a dokunulmaz (NFR-C5, gerçek PAN yok) · paket karşılaştırma tablosu / pazarlama sayfası
SÖZLEŞME: yok (endpoint'ler 09.3-c/d'de kontrata girdi)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 71.7. 09.3-g [SONNET-XHIGH] Satın alma geçmişi listesi (UI) + empty state

**Status:** done  
**Dependencies:** 71.3, 71.6  

BillingPage.tsx'e `ApiPackagePurchasesSection`: GET /billing/api-packages/purchases → tarih / paket adı / kota / tutar satırları (formatDate + formatCount + formatMoney), en yeni önce; satın alma yokken anlamlı empty state (boş dikdörtgen değil, EK-B.1 kuralı); yükleme durumu. Kısa liste olduğu için VirtualTable gerekmez.

**Details:**

09.3-g — Satın alma geçmişi listesi (UI) + empty state  [SONNET-XHIGH]

PRD: FR-MOD-09.3 (+ FR-EK-B.1 anlamlı empty state)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2 dosya + test; güvenlik sınırı yok (salt-okunur liste, izolasyon 09.3-c'de kapatıldı); eşzamanlılık yok; kopyalanacak desen aynı dosyada ismen var (BillingPage.tsx InvoicesSection satır 801 — liste + formatMoney/formatDate + boş durum); kontrat değişikliği yok; kabul mekanik (satır sayısı + empty state).
NEDEN AÇIK: 09.3-c'de eklenen GET /billing/api-packages/purchases endpoint'i tüketicisiz kalır. apps/web/src/features/billing/BillingPage.tsx'te satın alma geçmişi bölümü yok; en yakın liste deseni InvoicesSection (satır 801) ve o yalnız faturaları listeliyor.
KAPSAM: BillingPage.tsx'e `ApiPackagePurchasesSection`: GET /billing/api-packages/purchases → tarih / paket adı / kota / tutar satırları (formatDate + formatCount + formatMoney), en yeni önce; satın alma yokken anlamlı empty state (boş dikdörtgen değil, EK-B.1 kuralı); yükleme durumu. Kısa liste olduğu için VirtualTable gerekmez.
DOSYALAR: apps/web/src/features/billing/BillingPage.tsx · apps/web/src/features/billing/BillingPage.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/billing/BillingPage.tsx satır 801-900 (InvoicesSection: useQuery + satır listesi + formatMoney/formatDate + indirme bağlantısı) · apps/web/src/lib/format.ts (formatDate/formatMoney/formatCount) · apps/web/src/components/ui/index.js (Banner/Panel bileşenleri)
KK (birebir): "Fiyatlı API paketleri satışı" | "KK-türetilmiş: satın alınan paketlerin geçmişi (tarih, paket, kota, tutar) ekranda görünür. Türetme gerekçesi: PRD'de 09.3 için satın alma geçmişi/iptal ekranı tanımlanmamış (eksik #1); FR-MOD-10.3 fatura listesi deseniyle hizalanarak türetildi."
KK DOĞRULAMA: BillingPage.test.tsx: (1) purchases yanıtındaki her satın alma bir satır olarak render ediliyor (tarih/ad/kota/tutar); (2) boş yanıt → anlamlı empty state metni, boş dikdörtgen değil; (3) sıralama en yeni önce; (4) 09.3-f'deki satın alma sonrası liste invalidate olup yeni satır görünüyor.
KAPSAM DIŞI: fatura ekranı (mevcut InvoicesSection değişmez) · filtre/arama/sayfalama (liste kısa) · iptal/iade aksiyonu (kapsam dışı — açık soru 5) · e2e (09.3-h)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 71.8. 09.3-h [OPUS-XHIGH] Uçtan uca doğrulama: satın alma → kota artışı → geçmiş → fatura (E2E + seed)

**Status:** done  
**Dependencies:** 71.5, 71.6, 71.7  

apps/e2e/tests/billing.spec.ts'e senaryo: Billing sayfası aç → API paketleri bölümünde Essential kartı → satın al → (1) API çağrı sayacında included/kota metni artmış, (2) satın alma geçmişinde yeni satır, (3) fatura listesinde 'API package' satır kalemi ve artmış toplam. Gerekirse apps/api/prisma/seed.ts'e deterministik başlangıç (bilinen api_calls kullanımı) eklenir — seed idempotent kalır. Mevc

**Details:**

09.3-h — Uçtan uca doğrulama: satın alma → kota artışı → geçmiş → fatura (E2E + seed)  [OPUS-XHIGH]

PRD: FR-MOD-09.3 (+ NFR-S4)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama doğrulaması (kontrat + backend + usage metering + UI + seed + Playwright) ve 'kota artışı gerçek' iddiasının uçtan uca kanıtı — tek dosyalık mekanik iş değil, akış ve fixture tasarımı gerektiriyor; SONNET koşul 4 (kopyalanacak tek desen) tam karşılanmıyor. Güvenlik/algoritma çekirdeği yok (o 09.3-d'de kapandı) → MAX değil.
NEDEN AÇIK: apps/e2e/tests/ altında billing.spec.ts mevcut ama paket satın alma akışını bilmiyor (09.3 kodu bu turdan önce hiç yoktu — apps/api/src/routes/'da grep 0). Kota artışının usage sayacına ve faturaya yansıması yalnız integration seviyesinde doğrulanır; ekrandan başlayıp faturaya varan tek bir kanıt yok.
KAPSAM: apps/e2e/tests/billing.spec.ts'e senaryo: Billing sayfası aç → API paketleri bölümünde Essential kartı → satın al → (1) API çağrı sayacında included/kota metni artmış, (2) satın alma geçmişinde yeni satır, (3) fatura listesinde 'API package' satır kalemi ve artmış toplam. Gerekirse apps/api/prisma/seed.ts'e deterministik başlangıç (bilinen api_calls kullanımı) eklenir — seed idempotent kalır. Mevcut billing.spec.ts senaryoları regresyonsuz yeşil kalır.
DOSYALAR: apps/e2e/tests/billing.spec.ts · apps/api/prisma/seed.ts · apps/web/src/features/billing/BillingPage.tsx
REFERANS DESEN (kopyalanacak): apps/e2e/tests/billing.spec.ts (mevcut billing senaryoları — data-testid ile sayaç/quota iddiaları) · apps/e2e/tests/fixtures.ts + global-setup.ts (oturum + temiz DB kurulumu) · apps/api/prisma/seed.ts (idempotent seed deseni)
KK (birebir): "Fiyatlı API paketleri satışı" | "KK-türetilmiş: satın alma akışı uçtan uca çalışır — ekrandan yapılan mock satın alma, gerçek kota artışı ve fatura satırı üretir. Türetme gerekçesi: orkestratörün bağlayıcı kapsam kararı ('gerçek ödeme YOK — paket satın alma mock, kota artışı gerçek') yalnız uçtan uca kanıtla doğrulanabilir; PRD bu doğrulamayı yazmıyor."
KK DOĞRULAMA: apps/e2e/tests/billing.spec.ts — tek senaryoda üç iddia: satın alma sonrası (1) api_calls kota/sayaç metni paketin kotası kadar artmış, (2) satın alma geçmişinde yeni satır görünür, (3) fatura listesinde 'API package' satırı ve artmış toplam görünür. Ayrıca mevcut billing e2e iddiaları değişmeden geçer. NOT (memory: siyahtus-e2e-clean-db): truncate+reseed, .env source edilmiş, portlar boş; (memory: siyahtus-test-gate-parallel-db) DB süitleri paket başına SERIAL koşulur.
KAPSAM DIŞI: yük/performans ölçümü · gerçek ödeme sağlayıcısı ile e2e (⛔ ADR-13) · mobil/widget yüzeyi · dönem devri (rollover) senaryosu (varsayım 2 gereği yok)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
