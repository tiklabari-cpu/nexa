# Task ID: 75

**Title:** 13.5 — Sales tracker (Ecommerce/Tracked sales)  ·  dilim V2-8

**Status:** done

**Dependencies:** 45 ✓, 74 ✓, 78 ✓

**Priority:** low

**Description:** FR-MOD-13.5 · Could (v2) · MOD-07.8/13.3.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `13.5`.

8 atomik alt-görev · ~9 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x3 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  13.5-a [SONNET-XHIGH] Sales tracker veri modeli — sales_tracker_settings (lisans-tekil) + tracked_sales (olay tablosu) + migration  (bağ: 13.3 Goals (dış bağımlılık — orkestratörün bağlayıcı kararı: 13.3 önce; `goals` tablosu şemada var ama 0 tüketici, bu kalem başlamadan 13.3'ün CRUD+UI'si bitmeli))
  13.5-b [OPUS-XHIGH] Sales tracker konfigürasyon endpoint'i — GET/PUT /settings/sales-tracker (kontrat + route + scope kapısı + audit)  (bağ: 13.5-a)
  13.5-c [OPUS-MAX] Tracked-sale ingest + atıf (attribution) çekirdeği — POST /customer/chat/sale (BÖLÜNMEZ)  (bağ: 13.5-a, 13.5-b)
  13.5-d [OPUS-XHIGH] GET /reports/reviews ecommerce bloğunu gerçek veriyle doldur — trackedSalesSummary agregasyonu  (bağ: 13.5-b, 13.5-c)
  13.5-e [SONNET-XHIGH] Settings ekranı — 'Sales tracker' bölümü (enabled / currency / atıf penceresi formu)  (bağ: 13.5-b)
  13.5-f [SONNET-XHIGH] Reports/Reviews — Ecommerce KPI'ları + dürüst empty state + 'Configure sales platforms' CTA  (bağ: 13.5-d, 13.5-e (CTA'nın hedefi olan Settings bölümü var olmalı))
  13.5-g [SONNET-XHIGH] Widget izleme kodu — siyahtus('trackSale', …) JS API + kurulum snippet'i  (bağ: 13.5-c)
  13.5-h [OPUS-XHIGH] Uçtan uca doğrulama — seed/demo verisi + e2e (izleme kodu → Reports Ecommerce) + 13.3 Goals tutarlılığı  (bağ: 13.5-d, 13.5-e, 13.5-f, 13.5-g, 13.3 Goals (dış bağımlılık — tutarlılık kontrolü için teslim olmalı))

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): 13.5-c (tracked-sale ingest + atıf çekirdeği) bölünmez. Bu tek noktada üç sınır aynı anda kesişiyor: (1) **güven sınırı** — parayı bildiren taraf müşteri token'ı, yani widget'ın çalıştığı sayfa; `amount_cents`/`currency`/`external_order_id` tamamen ziyaretçi kontrolündeki girdidir ve `license_id` ASLA gövdeden alınamaz (tenant'tan alınır); (2) **idempotency/çift-sayım invariantı** — aynı `external_order_id` iki kez POST edildiğinde ciro iki kez sayılmamalı, bu kısıt `(license_id, external_order_id)` unique + upsert davranışının birlikte akıl yürütülmesini ister; (3) **atıf algoritması** — satışın hangi chat'e bağlanacağı (attribution_window_days içindeki son chat, yoksa attributed=false) rapordaki `attributed_revenue_cents`'i doğrudan belirler. Bu üçü ayrı pencerelere bölünürse "kim neyi doğruluyor" bağlamı kaybolur: doğrulamayı ingest'ten ayırmak, ya doğrulanmamış yazma yolu ya da atıf kararını gövdeye güvenerek veren bir kod bırakır. Çekirdeğin ETRAFINDAKİ her şey (şema/migration 13.5-a, config endpoint 13.5-b, rapor agregasyonu 13.5-d, iki UI 13.5-e/-f, widget istemcisi 13.5-g, e2e 13.5-h) ayrı ve daha ucuz etiketlere çıkarıldı — pahalı pencere yalnız 13.5-c.

VARSAYIMLAR: **Veri kaynağı = first-party izleme kodu, harici platform webhook'u DEĞİL.** PRD 'satış/dönüşüm izleme kodu/kuralı' diyor ama kaynağı belirtmiyor. Olgular MOD-09.2 e-ticaret entegrasyonlarının (Shopify/BigCommerce/Adobe Commerce/Medusa) MVP'de ertelendiğini gösteriyor ve MASTER-PROMPT dış servisleri mock'a zorluyor. Karar: v2 kapsamı **widget JS API'si (`siyahtus('trackSale', …)`) → müşteri-token'lı `POST /customer/chat/sale`**. Platform webhook'u (HMAC imzalı inbound) bu kalemin dışında; gerekirse ayrı kalem açılır — `apps/api/src/services/webhooks` HMAC+SSRF deseni (tm 34) zaten hazır. · **Atıf (attribution) kuralı deterministik:** satış, aynı müşterinin `attribution_window_days` içindeki EN SON chat'ine bağlanır. Pencere içinde chat yoksa satış yine kaydedilir ama `attributed=false` olur ve `attributed_revenue_cents` toplamına GİRMEZ — 'sohbete atfedilen ciro' iddiası ancak sohbet varsa dürüsttür. LLM/heuristik yok. · **Tek para birimi:** lisans başına tek ISO 4217 kodu (`sales_tracker_settings.currency`). Farklı para biriminde gelen satış 400 ile reddedilir; çoklu-para toplama YAPILMAZ. Gerekçe: `ReportsReviews.ecommerce.attributed_revenue_cents` kontratta tek bir tamsayı + tek bir `currency` alanı taşıyor (openapi.yaml:2032-2060); kur çevrimi bu şemaya sığmaz ve kur kaynağı = yeni dış servis olurdu. · **Idempotency anahtarı `(license_id, external_order_id)`.** Aynı sipariş kaç kez bildirilirse bildirilsin bir kez sayılır. Tekrar POST 200 döner (hata değil) — checkout sayfası retry yaparsa müşteri hata görmemeli. · **`configured` semantiği:** `sales_tracker_settings` satırı VAR **ve** `enabled=true` → `configured:true`. Satır yok veya kapalı → bugünkü `configured:false` + üç null iskeleti AYNEN korunur. Böylece mevcut `reports-billing.test.ts` / `ReportsPage.test.tsx` / `reports.spec.ts` beklentileri kırılmaz. · **Yeni scope AÇILMAZ.** Konfigürasyon `access_rules:ro/rw`, rapor `reports_read`, ingest `principals:['customer']` — hepsi mevcut. Böylece `packages/types/s

AÇIK SORULAR (ürün kararı): **13.3 Goals şeması:** tracked sale, `goals.definition` jsonb'sinde bir dönüşüm tipi (`type:'purchase'`) olarak mı temsil edilecek, yoksa `tracked_sales` tamamen bağımsız mı kalacak? 13.3'ün kırılımı bu şemayı kilitlemeden 13.5-d/-h'nin huni bağı tam netleşmiyor. Şu anki plan: bağımsız tablo + 13.5-h'de tutarlılık doğrulaması, FK yok. · **Rapor yüzeyi:** MOD-07.7'nin v2 payı ayrı bir 'Sales' rapor grubu/sekmesi (Leads/Cases/Sales/Team performance — rapor-1:1363-1371) istiyor. Satış verisi Reviews sekmesindeki Ecommerce bölümünde mi kalacak, yoksa 07.7 kalemi geldiğinde oraya mı taşınacak? İki kalem aynı veriyi iki ekranda gösterirse çift bakım riski var. Şu anki plan: Reviews/Ecommerce'te kalır, 07.7 gelirse aynı `trackedSalesSummary` fonksiyonunu tüketir. · **Origin kontrolü:** izleme kodu müşterinin checkout/teşekkür sayfasında çalışacak. Widget token'ı zaten trusted-domain kapısından geçiyor; satış bildirimi için EK bir origin/referer kontrolü isteniyor mu, yoksa mevcut token kapısı yeterli mi? (13.5-c'de mevcut kapı yeterli varsayıldı.) · **Çoklu para birimi:** tek-currency varsayımı (varsayım 3) kabul edilirse bu soru kapanır. Kabul edilmezse `ReportsReviews.ecommerce` şeması kırıcı biçimde değişir (para birimi başına kırılım) ve 13.5-d'nin etiketi OPUS-MAX'a çıkar. · **Üst sınır/anomali:** ziyaretçi kontrolündeki `amount_cents` için mantıklı bir üst sınır (ör. 100.000.000 kuruş) konulacak mı, yoksa yalnız tamsayı+negatif-değil kontrolü mü? Sınır konulmazsa tek bir hatal

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 75.1. 13.5-a [SONNET-XHIGH] Sales tracker veri modeli — sales_tracker_settings (lisans-tekil) + tracked_sales (olay tablosu) + migration

**Status:** done  
**Dependencies:** None  

Contract-first sırada ilk adım veri katmanı (bu alt-görev kontrata DOKUNMAZ — parity iki yönlü çalıştığı için route'suz path eklenemez). (1) `schema.prisma`ya `SalesTrackerSettings` modeli: `licenseId BigInt @id`, `enabled Boolean @default(false)`, `currency String @default("USD")`, `attributionWindowDays Int @default(7)`, `updatedAt`, `license` relation — `WidgetSettings` deseninin birebir eşi. (

**Details:**

13.5-a — Sales tracker veri modeli — sales_tracker_settings (lisans-tekil) + tracked_sales (olay tablosu) + migration  [SONNET-XHIGH]

PRD: FR-MOD-13.5 (+ NFR-S4 tenant izolasyon, NFR-P2)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 2 dosya + 1 migration + 1 test dosyası (koşul 1). Bu alt-görevde HİÇBİR yetkilendirme kararı verilmiyor — route yok, scope yok, iş mantığı yok (koşul 2); RLS policy satırı `apps/api/prisma/migrations/20260726130000_inbox_settings/migration.sql`ten karakter karakter kopyalanıyor ve `apps/api/test/integration/data-model.test.ts:364-370` her tabloda RLS'i MEKANİK olarak zorunlu kılıyor (koşul 4+6). Eşzamanlılık yok (koşul 3), kontrat değişmiyor (koşul 5). Kullanıcının bölme politikası şema/migration'ı açıkça 'daha ucuz etikete çıkarılacak yüzey' olarak sayıyor.
NEDEN AÇIK: `apps/api/prisma/schema.prisma`da satış/dönüşüm olayını tutan HİÇBİR model yok — order_id/value/currency/chat ilişkisi taşıyan tablo yok; §8.4 DDL envanterinde yalnız `goals` var, `sales` yok. `sales_tracker_settings` benzeri bir konfigürasyon tablosu da yok (grep 0). Mevcut `apps/api/src/routes/reports.ts:797-802` ecommerce bloğu bu boşluk yüzünden sabit `configured:false` + null döndürüyor (kod yorumu birebir: 'No sales source is wired yet').
KAPSAM: Contract-first sırada ilk adım veri katmanı (bu alt-görev kontrata DOKUNMAZ — parity iki yönlü çalıştığı için route'suz path eklenemez). (1) `schema.prisma`ya `SalesTrackerSettings` modeli: `licenseId BigInt @id`, `enabled Boolean @default(false)`, `currency String @default("USD")`, `attributionWindowDays Int @default(7)`, `updatedAt`, `license` relation — `WidgetSettings` deseninin birebir eşi. (2) `TrackedSale` modeli: `id uuid @id`, `licenseId BigInt`, `chatId String?` (atıf edilen chat, nullable), `customerId String?`, `externalOrderId String`, `amountCents Int`, `currency String`, `attributed Boolean @default(false)`, `createdAt` — `Rating` modelinin olay-tablosu deseni. (3) Migration SQL: iki CREATE TABLE + FK licenses(id) ON DELETE CASCADE + `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY <t>_tenant ... USING (license_id = siyahtus_current_license()) WITH CHECK (...)` + `GRANT ... TO siyahtus_app` + `UNIQUE (license_id, external_order_id)` + `INDEX (license_id, created_at)` + CHECK kısıtları (`amount_cents >= 0`, `attribution_window_days > 0`, `char_length(currency) = 3`). (4) `data-model.test.ts`e iki yeni tablonun RLS + cross-tenant görünmezlik iddiası.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/20260801100000_sales_tracker/migration.sql · apps/api/test/integration/data-model.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260726130000_inbox_settings/migration.sql · apps/api/prisma/schema.prisma (model WidgetSettings, satır 1166-1184) · apps/api/prisma/schema.prisma (model Rating, satır 716-729 — licenseId+createdAt indeksli olay tablosu) · apps/api/prisma/migrations/20260726150000_widget_settings/migration.sql
KK (birebir): "KK-türetilmiş: PRD FR-MOD-13.5 KK sütunu yalnız "İzleme yapılandırması" ve "Reports Ecommerce ile ilişki" diyor; ikisi de veri modeline dair somut bir kabul ölçütü vermiyor. Türetildi: "İzleme yapılandırması lisans başına kalıcı saklanır ve izlenen her satış olayı, ait olduğu lisansın dışından okunamaz." Gerekçe: konfigürasyonun 'yapılandırma' olabilmesi için kalıcı bir satırı olması, olayın 'tracked sale' olabilmesi için tenant-scoped bir satırı olması zorunlu — bu iki koşul olmadan sonraki hiçbir alt-görevin KK'sı doğrulanamaz."
KK DOĞRULAMA: `apps/api/test/integration/data-model.test.ts` — (a) `pg_tables` taramasında `sales_tracker_settings` ve `tracked_sales` `rowsecurity=true` (mevcut 'unprotected boş' iddiası bunu zaten yakalar, satır 364-370); (b) A lisansı olarak açılan oturumda B lisansının tracked_sale satırı 0 satır döner; (c) aynı `(license_id, external_order_id)` ikinci INSERT'te unique ihlali; (d) `amount_cents = -1` INSERT'i CHECK ile reddedilir. `pnpm --filter @siyahtus/api prisma migrate deploy` temiz DB'de hatasız koşar.
KAPSAM DIŞI: Herhangi bir route/endpoint (13.5-b, 13.5-c) · OpenAPI'ye satır ekleme — route'suz path contract-parity.test.ts'i iki yönlü kırar · Atıf (attribution) mantığı (13.5-c) · goals tablosuyla FK/ilişki kurma (13.3'ün şeması kilitlenene kadar bekler — bkz. açık soru 1)
SÖZLEŞME: yok — bu alt-görev kontrata DOKUNMAZ. Uyarı: `apps/api/test/integration/contract-parity.test.ts` iki yönlü çalışır (belgelenmiş ama sunulmayan route da kırar), bu yüzden OpenAPI satırı route'uyla AYNI pencerede eklenir (13.5-b / 13.5-c).
MIGRATION: EVET — `apps/api/prisma/migrations/20260801100000_sales_tracker/migration.sql`: yeni `sales_tracker_settings` (license_id PK) + `tracked_sales` tabloları; her ikisinde RLS policy + siyahtus_app GRANT; `tracked_sales` üzerinde UNIQUE(license_id, external_order_id) ve INDEX(license_id, created_at); CHECK kısıtları (amount_cents >= 0, char_length(currency)=3, attribution_window_days > 0).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 75.2. 13.5-b [OPUS-XHIGH] Sales tracker konfigürasyon endpoint'i — GET/PUT /settings/sales-tracker (kontrat + route + scope kapısı + audit)

**Status:** done  
**Dependencies:** 75.1  

Contract-first: (1) `packages/contract/openapi/paths/settings.yaml`e `salesTracker` operasyon bloğu (get/put) + `packages/contract/openapi/openapi.yaml`e `/settings/sales-tracker` path girişi ve `SalesTrackerSettings` / `UpdateSalesTrackerSettings` şemaları; re-bundle. (2) `apps/api/src/routes/settings.ts`e GET (`scopes: ['access_rules:ro','access_rules:rw']`, `findFirst` + satır yoksa şema varsay

**Details:**

13.5-b — Sales tracker konfigürasyon endpoint'i — GET/PUT /settings/sales-tracker (kontrat + route + scope kapısı + audit)  [OPUS-XHIGH]

PRD: FR-MOD-13.5 (+ NFR-S3 authZ, NFR-S4 tenant izolasyon, NFR-S12 audit)
ETİKET GEREKÇESİ: OPUS-XHIGH: kullanıcının açık kuralı — 'yeni bir yetkili endpoint eklemek ... EN AZ OPUS-XHIGH olur'. Bu alt-görev yeni bir scope-gated (`access_rules:ro/rw`), tenant-scoped yazma endpoint'i açıyor; desen mevcut (chat-timeout) ama karar yüzeyi authZ + tenant sınırı içeriyor → SONNET koşul 2 ihlali. Çekirdek güvenlik sınırı (kripto/izolasyon algoritması) DEĞİL, mevcut RLS+scope altyapısına oturuyor → MAX değil, XHIGH.
NEDEN AÇIK: 'Settings/Sales tracker' ekranının arkasında ne bir Prisma modeli ne de bir `/settings/sales-tracker` route'u var — grep 0 sonuç. `packages/contract/openapi/paths/settings.yaml` anahtarları: trustedDomains, trustedDomain, cannedResponses, cannedResponse, securitySettings, chatTimeout, widgetSettings, routingRules, routingRule, tags, tag — sales-tracker YOK. PRD KK'sı birebir 'İzleme yapılandırması' diyor; yapılandırmayı okuyup yazacak yüzey mevcut değil.
KAPSAM: Contract-first: (1) `packages/contract/openapi/paths/settings.yaml`e `salesTracker` operasyon bloğu (get/put) + `packages/contract/openapi/openapi.yaml`e `/settings/sales-tracker` path girişi ve `SalesTrackerSettings` / `UpdateSalesTrackerSettings` şemaları; re-bundle. (2) `apps/api/src/routes/settings.ts`e GET (`scopes: ['access_rules:ro','access_rules:rw']`, `findFirst` + satır yoksa şema varsayılanları — chat-timeout'un 'satır yok = kapalı' okuması) ve PUT (`scopes: ['access_rules:rw']`, zod ile `enabled: boolean`, `currency: 3 harf ISO 4217 whitelist`, `attribution_window_days: int 1..90`; upsert-on-licenseId; `writeAuditEntry(... action: 'settings.sales_tracker_updated', metadata: { fields: Object.keys(body) })`). (3) `packages/types` regen. YENİ SCOPE AÇILMAZ (mevcut `access_rules:*` kullanılır) — böylece `packages/types/src/scopes.test.ts:31`'deki SCOPES sayacı bozulmaz.
DOSYALAR: packages/contract/openapi/paths/settings.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/settings.ts · apps/api/test/integration/settings.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/settings.ts:474-515 (GET/PUT /settings/chat-timeout — findFirst + upsert + audit) · apps/api/src/routes/settings.ts:517-560 (GET/PUT /settings/widget — kısmi gövde + varsayılanlarla create) · packages/contract/openapi/paths/settings.yaml#chatTimeout (satır 266) ve #widgetSettings (satır 320)
KK (birebir): "İzleme yapılandırması"
KK DOĞRULAMA: `apps/api/test/integration/settings.test.ts` — (a) satır yokken GET varsayılanları döner (`enabled:false`), PUT sonrası GET yazılanı döner (= 'yapılandırma' kalıcıdır, KK'nın birebir karşılığı); (b) `contract-parity.test.ts` yeşil (yeni iki operasyon hem belgede hem router'da); (c) audit: PUT sonrası `audit_log`da `settings.sales_tracker_updated` satırı var ve metadata yalnız ALAN ADLARI taşıyor.
KAPSAM DIŞI: Satış olayı yazma yolu (13.5-c) · Rapor tarafındaki ecommerce agregasyonu (13.5-d) · Settings UI bölümü (13.5-e) · Harici e-ticaret platformu (Shopify/BigCommerce) OAuth/webhook bağlama — MOD-09.2 ertelendi, bkz. varsayım 1 · Yeni scope tanımı — mevcut access_rules:* yeniden kullanılır
SÖZLEŞME: EVET — `packages/contract/openapi/openapi.yaml`e `/settings/sales-tracker` path'i (get+put) ve `SalesTrackerSettings` + `UpdateSalesTrackerSettings` şemaları; `packages/contract/openapi/paths/settings.yaml`e `salesTracker` bloğu. **OpenAPI'ye eklenip re-bundle EDİLMEZSE `apps/api/test/integration/contract-parity.test.ts` KIRILIR** (test iki yönlüdür: belgelenmemiş route da, sunulmayan belgelenmiş path de kırar) — bu yüzden kontrat satırı ve route AYNI pencerede gider. `packages/types` generate koşulur. Yeni ApiError tipi HEDEFLENMİYOR; gerekirse tuzak: `packages/types/src/errors.ts` (×2 yer) + `packages/types/src/scopes.test.ts:95` ERROR_TYPES sayacı + openapi enum + regen.
MIGRATION: yok (tablolar 13.5-a'da geldi)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 75.3. 13.5-c [OPUS-MAX] Tracked-sale ingest + atıf (attribution) çekirdeği — POST /customer/chat/sale (BÖLÜNMEZ)

**Status:** done  
**Dependencies:** 75.1, 75.2  

Contract-first: (1) `packages/contract/openapi/paths/customer-chat.yaml`e `sale` bloğu + `openapi.yaml`e `/customer/chat/sale` path'i ve `TrackSaleRequest`/`TrackedSale` şemaları; re-bundle + types regen. (2) `apps/api/src/routes/customer.ts`e `POST /customer/chat/sale`, `config: { principals: ['customer'] }` — rating route'unun (satır 462-500) kimlik iskeleti. (3) Saf, test edilebilir atıf modülü

**Details:**

13.5-c — Tracked-sale ingest + atıf (attribution) çekirdeği — POST /customer/chat/sale (BÖLÜNMEZ)  [OPUS-MAX]

PRD: FR-MOD-13.5 (+ NFR-S3, NFR-S4, NFR-S5 IDOR, NFR-S12)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ve 3 birlikte ihlal. (a) Güven sınırı — ciro/para birimi/sipariş kimliğini bildiren taraf müşteri token'ıdır (ziyaretçi kontrolündeki girdi); `license_id` gövdeden ASLA alınamaz, tenant'tan gelir → tenant izolasyon sınırı. (b) Transaction-invariant/eşzamanlılık — aynı `external_order_id`in iki eşzamanlı POST'unda ciro çift sayılmamalı (unique + upsert yarışı). (c) Yeni algoritma tasarımı — atıf kuralı (pencere içindeki son chat, yoksa attributed=false) rapordaki parayı belirler; depoda kopyalanacak eşdeğer bir atıf deseni YOK. Yanlış karar doğrudan yanlış ciro raporlar → pahalı. Çekirdek bölünmez (bkz. bolunmeyen_gerekce).
NEDEN AÇIK: İzleme kodu/kural mekanizması tanımlı değil: widget'tan gelen bir sale event'i ya da harici webhook için ne route ne şema var (grep 0). v2-03 §769'daki legacy 'Ecommerce postback (product_id/option_id/quantity)' alanı SiyahTuş event şemasına HİÇ taşınmamış — `apps/api/prisma/schema.prisma:408-432` `Event.properties` için böyle bir şema dokümante değil. Sonuç: `apps/api/src/routes/reports.ts:797-802` ecommerce bloğunun besleyeceği tek bir yazma yolu bile yok (0 üretici).
KAPSAM: Contract-first: (1) `packages/contract/openapi/paths/customer-chat.yaml`e `sale` bloğu + `openapi.yaml`e `/customer/chat/sale` path'i ve `TrackSaleRequest`/`TrackedSale` şemaları; re-bundle + types regen. (2) `apps/api/src/routes/customer.ts`e `POST /customer/chat/sale`, `config: { principals: ['customer'] }` — rating route'unun (satır 462-500) kimlik iskeleti. (3) Saf, test edilebilir atıf modülü `apps/api/src/services/sales/attribution.ts`: `resolveAttribution({ chats, now, windowDays })` → `{ chatId | null, attributed }`; kural = müşterinin `attribution_window_days` içindeki EN SON chat'i; yoksa `attributed:false` (satır yine kaydedilir, ciroya girmez). (4) Route'un doğrulama zinciri, negatif testler ÖNCE yazılıp kırmızı görülerek: `sales_tracker_settings.enabled=false` veya satır yok → yazma reddi; `currency` konfigüre edilenle birebir eşleşmeli (aksi 400 — çoklu para birimi toplanmaz, varsayım 3); `amount_cents` tamsayı, 0 ≤ x ≤ üst sınır; `external_order_id` uzunluk/karakter sınırı; `license_id` gövdede gelse bile YOK SAYILIR, `request.tenant()`ten alınır; idempotency = `(license_id, external_order_id)` üzerinde upsert/`ON CONFLICT DO NOTHING`, tekrar POST 200 döner ama ikinci satır/ikinci ciro YARATMAZ. (5) Mevcut customer rate-limit'i bu route'a da uygulanır. (6) `writeAuditEntry` ile `sale.tracked` kaydı.
DOSYALAR: packages/contract/openapi/paths/customer-chat.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/customer.ts · apps/api/src/services/sales/attribution.ts · apps/api/src/services/sales/attribution.test.ts · apps/api/test/integration/customer-chat.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/customer.ts:461-500 (POST /customer/chat/rating — customer principal kapısı + withTenant + licenseId tenant'tan) · apps/api/src/services/security/spam-filter.ts (saf, deterministik karar modülü + kendi unit testi deseni — GL-7/tm 69) · apps/api/src/lib/cc-mask.ts (yazma anında ziyaretçi girdisi sanitizasyonu deseni)
KK (birebir): "KK-türetilmiş: PRD KK sütunu yalnız "İzleme yapılandırması" / "Reports Ecommerce ile ilişki" diyor, yazma yolunu tanımlamıyor. Türetme dayanağı PRD §6 satır 717'nin Gereksinim sütunundaki birebir ifade: "satış/dönüşüm izleme kodu/kuralı". Türetilmiş KK: "İzleme kodu bir satışı bildirdiğinde satış, yapılandırma açıksa ve para birimi eşleşiyorsa kaydedilir; aynı sipariş iki kez bildirilse bile bir kez sayılır; satış yalnız kendi lisansının verisi olur ve atıf penceresi içinde bir sohbet varsa o sohbete bağlanır." Gerekçe: 'kod/kural' ifadesinin doğrulanabilir tek karşılığı yazma + idempotency + atıf kuralıdır."
KK DOĞRULAMA: `apps/api/src/services/sales/attribution.test.ts` — atıf kuralı saf fonksiyon olarak: pencere içi son chat seçilir; pencere dışı chat → `attributed:false`; hiç chat yok → `attributed:false`. `apps/api/test/integration/customer-chat.test.ts` — (a) enabled=false iken POST reddi; (b) aynı `external_order_id` iki kez → `tracked_sales`ta 1 satır, toplam ciro tek katı (idempotency invariantı = 'bir kez sayılır'); (c) gövdedeki sahte `license_id` yok sayılır, satır çağıranın lisansına yazılır; (d) A lisansının müşteri token'ı B lisansının satışını ne yaratır ne okur. Bu dört iddia türetilmiş KK'nın dört cümlesinin birebir karşılığıdır.
KAPSAM DIŞI: Widget istemci tarafı JS API (13.5-g) — bu alt-görev yalnız sunucu sözleşmesini ve doğrulamayı verir · Rapor agregasyonu / ecommerce bloğunu doldurma (13.5-d) · Harici e-ticaret platformu webhook'u + HMAC imza doğrulama (MOD-09.2 ertelendi; gerekirse ayrı kalem, `apps/api/src/services/webhooks` HMAC deseni hazır) · Ürün/varyant kırılımı (legacy postback'teki product_id/option_id/quantity) — v2-03'te legacy alan, SiyahTuş şemasına taşınmıyor (varsayım 1) · Geri ödeme/iptal (refund) akışı
SÖZLEŞME: EVET — `openapi.yaml`e `/customer/chat/sale` (post) + `TrackSaleRequest` (external_order_id, amount_cents, currency) ve `TrackedSale` yanıt şemaları; `paths/customer-chat.yaml`e `sale` bloğu (mevcut anahtarlar: state/events/typing/close/rating). **OpenAPI'ye eklenip re-bundle EDİLMEZSE contract-parity.test.ts KIRILIR.** Yeni ApiError tipi hedeflenmiyor (reddler `validation` zarfıyla, ADR-06). Zorunlu olursa tuzak: `packages/types/src/errors.ts` (×2 yer: ERROR_TYPES listesi + HTTP eşlemesi) + `packages/types/src/scopes.test.ts:95` ERROR_TYPES sayacı + openapi enum + regen.
MIGRATION: yok — 13.5-a'daki `tracked_sales` tablosu ve UNIQUE(license_id, external_order_id) kısıtı yeterli. (Yeni kolon ihtiyacı doğarsa 13.5-a'ya geri yazılmaz, ek migration açılır.)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 75.4. 13.5-d [OPUS-XHIGH] GET /reports/reviews ecommerce bloğunu gerçek veriyle doldur — trackedSalesSummary agregasyonu

**Status:** done  
**Dependencies:** 75.2, 75.3  

(1) `apps/api/src/routes/reports.ts` içine `satisfactionCounts` komşuluğuna `trackedSalesSummary(tx, licenseId, from, to)` — `tracked_sales` üzerinde `attributed = true` ve `created_at` aralığı için `COUNT(*)` + `SUM(amount_cents)`; `(license_id, created_at)` indeksi kullanılır. (2) `/reports/reviews` handler'ında `sales_tracker_settings` okunur: satır yok VEYA `enabled=false` → mevcut `configured

**Details:**

13.5-d — GET /reports/reviews ecommerce bloğunu gerçek veriyle doldur — trackedSalesSummary agregasyonu  [OPUS-XHIGH]

PRD: FR-MOD-13.5 · FR-MOD-07.8 (+ NFR-P2 rapor gecikmesi)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni sorgu/veri şekli tasarımı + geriye dönük uyumluluk kararı bir arada. `ecommerce`in dört alanı kontratta `required` (openapi.yaml:1997) ve bugün her zaman false/null dönüyor; `configured:true` dalını açmak mevcut e2e/unit testleri kırmadan yapılmalı. Ayrıca 'configured' semantiğinin tanımı (satır var + enabled) bir yorum kararıdır → SONNET koşul 6 ihlali. Yeni endpoint/scope yok, izolasyon mevcut `withTenant`/RLS üzerinden → MAX değil.
NEDEN AÇIK: `apps/api/src/routes/reports.ts:797-802` ecommerce'i sabit iskelet olarak döndürüyor (`configured:false`, üç alan null); kod yorumu birebir 'FR-MOD-13.5, v2. No sales source is wired yet'. Yani alan 0 tüketicili bir placeholder. `satisfactionCounts`/`satisfactionByDay` (reports.ts:189 ve devamı) aynı dosyada inline agregasyon fonksiyonları olarak duruyor — eşdeğer `trackedSalesSummary`in doğal yeri orası.
KAPSAM: (1) `apps/api/src/routes/reports.ts` içine `satisfactionCounts` komşuluğuna `trackedSalesSummary(tx, licenseId, from, to)` — `tracked_sales` üzerinde `attributed = true` ve `created_at` aralığı için `COUNT(*)` + `SUM(amount_cents)`; `(license_id, created_at)` indeksi kullanılır. (2) `/reports/reviews` handler'ında `sales_tracker_settings` okunur: satır yok VEYA `enabled=false` → mevcut `configured:false` + üç null iskeleti AYNEN korunur (geriye dönük uyumlu); enabled=true → `configured:true`, `tracked_sales`, `attributed_revenue_cents` (satış yoksa 0, null değil — 'yapılandırılmış ama satış yok' bilinen bir sıfırdır, CSAT'ın 'oy yok = null' kuralından farkı yorumda açıklanır), `currency` konfigürasyondan. (3) Sıralı sorgu — `withTenant` tek interaktif transaction, `Promise.all` YASAK (dosyadaki mevcut yorum bunu söylüyor). (4) OpenAPI'de yalnız `ecommerce` AÇIKLAMA metni güncellenir; alan listesi/required DEĞİŞMEZ → şema kırılmaz.
DOSYALAR: apps/api/src/routes/reports.ts · packages/contract/openapi/openapi.yaml · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts:189-230 (satisfactionCounts — tenant-scoped agregasyon fonksiyonu imzası) · apps/api/src/routes/reports.ts:763-804 (GET /reports/reviews — sıralı withTenant sorguları + yanıt kompozisyonu) · apps/api/src/routes/reports.ts:740-760 (ai-agent raporu — round/roundOrNull null-güvenli sayı deseni)
KK (birebir): "Reports Ecommerce ile ilişki"
KK DOĞRULAMA: `apps/api/test/integration/reports-billing.test.ts` — (a) sales tracker kapalıyken `/reports/reviews` yanıtı BUGÜNKÜ iskeletle birebir aynı (`configured:false`, üç null) → regresyon yok; (b) açıkken ve pencerede atıflı satış varken `configured:true` + `tracked_sales` = satış adedi + `attributed_revenue_cents` = kuruş toplamı + `currency` = konfigüre edilen kod → KK'nın 'Reports Ecommerce ile ilişki' ifadesinin doğrudan kanıtı; (c) `attributed:false` satışlar toplama GİRMEZ; (d) tarih penceresi dışındaki satışlar sayılmaz. `contract-parity` ve `packages/contract` bundle yeşil.
KAPSAM DIŞI: UI değişikliği (13.5-f) · MOD-07.7'nin ayrı 'Sales' rapor grubu/sekmesi — o kalem kendi v2 satırında (bkz. açık soru 2) · PDF/benchmark export (07.7 v2 payı) · 13.3 Goals dönüşüm hunisiyle ortak sorgu (13.5-h'de tutarlılık doğrulanır, burada değil)
SÖZLEŞME: Yeni path YOK. `packages/contract/openapi/openapi.yaml:2032-2060` `ecommerce` alt-şemasının AÇIKLAMA metni güncellenir ('Always false in v1' ifadesi kaldırılır); alan adları, tipleri ve `required: [configured, tracked_sales, attributed_revenue_cents, currency]` listesi DEĞİŞMEZ. Bundle yeniden üretilir; alan listesi değişmediği için `apps/web` ve `apps/e2e` tarafında tip kırılması beklenmiyor.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 75.5. 13.5-e [SONNET-XHIGH] Settings ekranı — 'Sales tracker' bölümü (enabled / currency / atıf penceresi formu)

**Status:** done  
**Dependencies:** 75.2  

(1) Yeni `apps/web/src/features/settings/SalesTracker.tsx`: `Section`+`Card` içinde `useQuery('/settings/sales-tracker')` + `useMutation` PUT; alanlar — `enabled` toggle, `currency` seçici (sunucudaki ISO 4217 whitelist ile aynı liste), `attribution_window_days` sayı girdisi. `useForm`/`required`/`FieldError` primitifi (`apps/web/src/lib/form.ts`) kullanılır: geçersizken submit pasif + alan-altı h

**Details:**

13.5-e — Settings ekranı — 'Sales tracker' bölümü (enabled / currency / atıf penceresi formu)  [SONNET-XHIGH]

PRD: FR-MOD-13.5 (+ FR-EK-A.1 tek form/validasyon primitifi)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 3 dosya (koşul 1); yalnız mevcut endpoint'i çağıran salt-form UI, hiçbir yetki kararı burada verilmiyor — `canEdit` görünürlük kapısı `SettingsPage.tsx:101-105`teki mevcut `scopes.includes('access_rules:rw')` deseninin kopyası ve gerçek kapı sunucuda (13.5-b) (koşul 2); eşzamanlılık yok (koşul 3); kopyalanacak desen ismen verildi — `WidgetCustomization.tsx` (koşul 4); kontrat değişmiyor (koşul 5); KK mekanik doğrulanabilir (koşul 6).
NEDEN AÇIK: `apps/web/src/features/settings/` içinde sales tracker'a dair hiçbir bileşen yok (dizin listesi: BannedCustomerIps, Channels, Integrations, SettingsForms, WebsiteWidgets, WidgetCustomization — sales YOK) ve `SettingsPage.tsx`in render listesi (satır 108-122) 15 bölüm sayıyor, Sales tracker bunların arasında değil. PRD KK'sı birebir 'İzleme yapılandırması' ve gözlem sütunu 'Gözlem (Settings/Sales tracker)' diyor — ekran mevcut değil.
KAPSAM: (1) Yeni `apps/web/src/features/settings/SalesTracker.tsx`: `Section`+`Card` içinde `useQuery('/settings/sales-tracker')` + `useMutation` PUT; alanlar — `enabled` toggle, `currency` seçici (sunucudaki ISO 4217 whitelist ile aynı liste), `attribution_window_days` sayı girdisi. `useForm`/`required`/`FieldError` primitifi (`apps/web/src/lib/form.tsx`) kullanılır: geçersizken submit pasif + alan-altı hata. `canEdit=false` iken salt-okunur. (2) `SettingsPage.tsx`e `<SalesTracker canEdit={canManageAccess} />` mount'u (WidgetCustomization'ın hemen ardına). (3) Kaydedince Reports/Ecommerce'e giden bir bağlam metni.
DOSYALAR: apps/web/src/features/settings/SalesTracker.tsx · apps/web/src/features/settings/SalesTracker.test.tsx · apps/web/src/features/settings/SettingsPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/WidgetCustomization.tsx (canEdit'li ayar formu + useQuery/useMutation + Section/Card) · apps/web/src/features/settings/WidgetCustomization.test.tsx (ayar formu test deseni) · apps/web/src/lib/form.tsx (useForm/required/compose/FieldError — FR-EK-A.1 primitifi) · apps/web/src/features/settings/SettingsPage.tsx:100-123 (scope→canEdit türetimi + bölüm mount listesi)
KK (birebir): "İzleme yapılandırması"
KK DOĞRULAMA: `SalesTracker.test.tsx` — (a) sunucudan gelen değerler forma basılır ve kaydet → PUT gövdesi doğru (= 'yapılandırma' kullanıcı tarafından yönetilebilir, KK'nın birebir karşılığı); (b) `attribution_window_days = 0` girildiğinde alan-altı hata + submit pasif (FR-EK-A.1); (c) `canEdit=false` iken girdiler devre dışı ve PUT çağrılmaz.
KAPSAM DIŞI: Rapor ekranı (13.5-f) · Widget izleme kodu snippet'i (13.5-g) · Yeni bir Settings navigasyon/sekme yapısı — mevcut tek sayfa Section listesi korunur · Harici platform bağlama kartı (MOD-09.2, ertelendi)
SÖZLEŞME: yok (13.5-b'de eklenen path tüketilir)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 75.6. 13.5-f [SONNET-XHIGH] Reports/Reviews — Ecommerce KPI'ları + dürüst empty state + 'Configure sales platforms' CTA

**Status:** done  
**Dependencies:** 75.4  

(1) `ReviewsTab`ın Ecommerce bölümü: `configured:true` dalında KPI grid'e `currency` görünürlüğü ve 'atıflı satış yok' durumunda 0 değerinin dürüst gösterimi (null-fallback `?? 0` yerine gerçek 0); (2) `configured:false` empty state metni güncellenir — 'later release' ifadesi kaldırılır, yerine Settings/Sales tracker'a giden **'Configure sales platforms'** CTA (react-router `Link`, rapor-1:1290 re

**Details:**

13.5-f — Reports/Reviews — Ecommerce KPI'ları + dürüst empty state + 'Configure sales platforms' CTA  [SONNET-XHIGH]

PRD: FR-MOD-13.5 · FR-MOD-07.8
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 3 dosya (koşul 1); salt-okunur rapor kartı, hiçbir yetki/izolasyon kararı yok — veri zaten scope'lu endpoint'ten geliyor (koşul 2); eşzamanlılık yok (koşul 3); dokunulacak bileşen ve KPI grid kodu ZATEN yazılmış durumda (`ReportsPage.tsx:611-639`), iş onu doğru metin+CTA ile tamamlamak (koşul 4); kontrat değişmiyor (koşul 5); KK mekanik doğrulanabilir (koşul 6).
NEDEN AÇIK: `apps/web/src/features/reports/ReportsPage.tsx:611-639` 'Ecommerce' bölümünü zaten render ediyor: `data.ecommerce.configured` false ise EmptyState('Sales tracking not set up ... Tracked sales arrive in a later release'), true ise `Tracked sales` + `Attributed revenue` KPI gridi. Ama `configured` sunucuda sabit false olduğu için KPI dalı HİÇ çalışmıyor ve empty state metni 'later release' diyerek artık yanlış olacak. rapor-1-fonksiyonel.md:1290 bu ekranın referans davranışını birebir veriyor: 'All sales $0 [Configure sales platforms].'
KAPSAM: (1) `ReviewsTab`ın Ecommerce bölümü: `configured:true` dalında KPI grid'e `currency` görünürlüğü ve 'atıflı satış yok' durumunda 0 değerinin dürüst gösterimi (null-fallback `?? 0` yerine gerçek 0); (2) `configured:false` empty state metni güncellenir — 'later release' ifadesi kaldırılır, yerine Settings/Sales tracker'a giden **'Configure sales platforms'** CTA (react-router `Link`, rapor-1:1290 referansı); (3) `ReportsPage.test.tsx`e her iki dalın testi; (4) `apps/e2e/tests/reports.spec.ts`e Reviews sekmesinde Ecommerce bölümünün görünürlük iddiası.
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx · apps/e2e/tests/reports.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/reports/ReportsPage.tsx:543-639 (ReviewsTab — Section/Card/EmptyState/KpiGrid/Kpi kompozisyonu, tam olarak genişletilecek yer) · apps/web/src/components/EmptyState.tsx (anlamlı empty state deseni, T6-b) · apps/web/src/features/settings/SettingsPage.tsx (Integrations bölümü — bir başka ekrana Link ile CTA verme deseni)
KK (birebir): "Reports Ecommerce ile ilişki"
KK DOĞRULAMA: `ReportsPage.test.tsx` — (a) `ecommerce.configured=true` mock'unda 'Tracked sales' ve 'Attributed revenue' KPI'ları ekrandaki sayılarla render olur (= 'Reports Ecommerce ile ilişki' KK'sının görünür karşılığı); (b) `configured=false` mock'unda EmptyState + 'Configure sales platforms' CTA görünür ve Settings'e link verir; (c) 'later release' metni artık DOM'da yok (grep-benzeri negatif iddia). E2E `reports.spec.ts` Reviews sekmesinde Ecommerce bölümünü görür.
KAPSAM DIŞI: Yeni bir 'Sales' rapor sekmesi/grubu (MOD-07.7 v2 payı — açık soru 2) · Grafik/zaman serisi (satış trendi) — bu kalemde yalnız KPI · CSV/PDF export'a satış sütunu ekleme (07.7 v2)
SÖZLEŞME: yok (13.5-d'de semantiği açılan mevcut `ReportsReviews.ecommerce` alanları tüketilir)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 75.7. 13.5-g [SONNET-XHIGH] Widget izleme kodu — siyahtus('trackSale', …) JS API + kurulum snippet'i

**Status:** done  
**Dependencies:** 75.3  

(1) `apps/widget/src/api.ts`e `trackSale({ external_order_id, amount_cents, currency })` → `POST /customer/chat/sale` (mevcut `#request` + token yenileme yolu aynen kullanılır). (2) `apps/widget/src/loader.ts`ta `window.__siyahtus` üzerinden çağrılabilir genel bir komut yüzeyi: `siyahtus('trackSale', {...})`; widget yüklenmeden önce çağrılırsa kuyruğa alınıp boot sonrası boşaltılır (klasik komut kuyruğu).

**Details:**

13.5-g — Widget izleme kodu — siyahtus('trackSale', …) JS API + kurulum snippet'i  [SONNET-XHIGH]

PRD: FR-MOD-13.5 (+ NFR-P3 widget bundle bütçesi)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 3-4 dosya (koşul 1); istemci tarafı kod — TÜM doğrulama, yetki ve idempotency sunucuda (13.5-c) yapıldı, burada hiçbir güvenlik kararı verilmiyor ve istemci zaten güvenilmez taraf (koşul 2); eşzamanlılık yok (koşul 3); kopyalanacak desen ismen var — `loader.ts` `window.__siyahtus` boot deseni + `api.ts` `#request` (koşul 4); kontrat 13.5-c'de kilitlendi, burada katkısal tüketim (koşul 5); KK mekanik doğrulanabilir (koşul 6).
NEDEN AÇIK: `apps/widget/src/loader.ts`ta dışa açılan tek giriş `boot()` ve `window.__siyahtus` konfigürasyonu (satır 5, 17, 53); satış/dönüşüm bildiren bir genel API YOK. `apps/widget/src/api.ts`ta `WidgetApi` sınıfının çağrıları token/olay/yükleme ile sınırlı — satış çağrısı yok. PRD §6 satır 717 birebir 'satış/dönüşüm izleme kodu/kuralı' diyor; 'izleme kodu' karşılığı olan istemci yüzeyi mevcut değil.
KAPSAM: (1) `apps/widget/src/api.ts`e `trackSale({ external_order_id, amount_cents, currency })` → `POST /customer/chat/sale` (mevcut `#request` + token yenileme yolu aynen kullanılır). (2) `apps/widget/src/loader.ts`ta `window.__siyahtus` üzerinden çağrılabilir genel bir komut yüzeyi: `siyahtus('trackSale', {...})`; widget yüklenmeden önce çağrılırsa kuyruğa alınıp boot sonrası boşaltılır (klasik komut kuyruğu). (3) Hatalar SESSİZ yutulur — müşterinin checkout sayfasını asla bozmaz (konsola uyarı, exception yok). (4) `WebsiteWidgets.tsx`teki kurulum snippet'ine örnek `trackSale` satırı (yalnız metin/dokümantasyon). (5) NFR-P3 bundle bütçesi korunur (mevcut ölçüm eşiği aşılmaz).
DOSYALAR: apps/widget/src/api.ts · apps/widget/src/loader.ts · apps/widget/src/loader.test.ts · apps/web/src/features/settings/WebsiteWidgets.tsx
REFERANS DESEN (kopyalanacak): apps/widget/src/loader.ts:53-175 (boot + window.__siyahtus okuma + normaliseOrigin — genel API yerleştirme noktası) · apps/widget/src/api.ts:184-209 (#request — 401'de token yenileyip yeniden deneyen çağrı deseni) · apps/widget/src/loader.test.ts (loader birim testi kurulumu) · apps/widget/src/widget.prechat.test.ts (widget davranış testi deseni)
KK (birebir): "KK-türetilmiş: PRD KK sütunu istemci yüzeyini tanımlamıyor. Türetme dayanağı PRD §6 satır 717 Gereksinim sütunundaki birebir ifade: "satış/dönüşüm izleme kodu/kuralı". Türetilmiş KK: "Müşterinin sitesine yerleştirilen izleme kodu tek bir çağrıyla satışı bildirir; widget henüz yüklenmemişse çağrı kaybolmaz; çağrı başarısız olsa bile barındıran sayfa bozulmaz." Gerekçe: 'izleme kodu'nun doğrulanabilir karşılığı bir genel JS API + kuyruk + hata izolasyonudur."
KK DOĞRULAMA: `apps/widget/src/loader.test.ts` — (a) boot'tan SONRA `siyahtus('trackSale', payload)` çağrısı `/customer/chat/sale`e beklenen gövdeyle gider; (b) boot'tan ÖNCE yapılan çağrı kuyruğa alınır ve boot sonrası tam bir kez gönderilir (kaybolmaz, çift gitmez); (c) sunucu 4xx/ağ hatası verdiğinde çağrı reject ETMEZ, exception fırlamaz (barındıran sayfa korunur). Üç iddia türetilmiş KK'nın üç cümlesinin birebir karşılığıdır. Bundle bütçesi ölçümü NFR-P3 eşiğinin altında.
KAPSAM DIŞI: Sunucu tarafı doğrulama/idempotency/atıf (13.5-c — istemciye ASLA güvenilmez) · Ürün/varyant/adet alanları (legacy postback, varsayım 1) · Harici e-ticaret platformu SDK'sı veya piksel entegrasyonu (MOD-09.2, ertelendi) · Widget görünümü/tema değişikliği
SÖZLEŞME: yok — 13.5-c'de kilitlenen `/customer/chat/sale` sözleşmesi tüketilir. (Bu alt-görev yeni path EKLEMEZ; eklerse contract-parity.test.ts iki yönlü kırılır.)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 75.8. 13.5-h [OPUS-XHIGH] Uçtan uca doğrulama — seed/demo verisi + e2e (izleme kodu → Reports Ecommerce) + 13.3 Goals tutarlılığı

**Status:** done  
**Dependencies:** 75.4, 75.5, 75.6, 75.7  

(1) `apps/api/prisma/seed.ts`e idempotent sales-tracker demo verisi: `sales_tracker_settings` (enabled, USD, 7 gün) + birkaç atıflı/atıfsız `tracked_sale` — mevcut seed'in idempotency sözleşmesi korunur. (2) `apps/e2e/tests/reports.spec.ts`e uçtan uca senaryo: widget sayfasında `siyahtus('trackSale', …)` çağrılır → ajan Reports/Reviews/Ecommerce'te KPI'ların arttığı görülür. (3) `apps/e2e/tests/settin

**Details:**

13.5-h — Uçtan uca doğrulama — seed/demo verisi + e2e (izleme kodu → Reports Ecommerce) + 13.3 Goals tutarlılığı  [OPUS-XHIGH]

PRD: FR-MOD-13.5 (+ FR-MOD-13.3 bağımlılığı, FR-MOD-07.8, NFR-S4)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama (widget + API + DB + rapor UI) uçtan uca doğrulanıyor ve 13.3 Goals dönüşüm hunisiyle sayı tutarlılığı bir YORUM kararı gerektiriyor (aynı dönüşüm iki yerde farklı sayılmamalı) → SONNET koşul 6 ihlali. Yeni güvenlik sınırı açılmıyor, mevcut yollar doğrulanıyor → MAX değil.
NEDEN AÇIK: Zincirin her halkası ayrı alt-görevde test edilecek ama uçtan uca hiçbir kanıt olmayacak: bugün `apps/e2e/tests/reports.spec.ts` ve `apps/e2e/tests/widget.spec.ts` satış izlemeye dair sıfır iddia taşıyor ve `apps/api/prisma/seed.ts` sales tracker verisi üretmiyor (grep 0). Ayrıca orkestratörün bağlayıcı kararı 13.5'i 13.3 Goals üzerine oturtuyor; 13.3 teslim edildiğinde 'dönüşüm' sayısının iki ekranda çelişmediği hiçbir yerde kanıtlanmış olmayacak.
KAPSAM: (1) `apps/api/prisma/seed.ts`e idempotent sales-tracker demo verisi: `sales_tracker_settings` (enabled, USD, 7 gün) + birkaç atıflı/atıfsız `tracked_sale` — mevcut seed'in idempotency sözleşmesi korunur. (2) `apps/e2e/tests/reports.spec.ts`e uçtan uca senaryo: widget sayfasında `siyahtus('trackSale', …)` çağrılır → ajan Reports/Reviews/Ecommerce'te KPI'ların arttığı görülür. (3) `apps/e2e/tests/settings.spec.ts`e Sales tracker bölümünü kapatma → Reports'un dürüst empty state'e dönmesi. (4) **13.3 tutarlılık kontrolü:** aynı pencerede 13.3'ün dönüşüm sayacı ile `tracked_sales` sayısı çelişmiyor — ya aynı kaynaktan okunur ya da farkın gerekçesi kodda yorumla sabitlenir; bulgu HANDOFF'a kanıt olarak yazılır. (5) e2e temiz-DB gereksinimi: truncate+reseed, sourced .env, boşaltılmış portlar; DB süitleri paket başına SERİ koşulur (paylaşılan Postgres yarışı).
DOSYALAR: apps/api/prisma/seed.ts · apps/e2e/tests/reports.spec.ts · apps/e2e/tests/settings.spec.ts · apps/e2e/tests/widget.spec.ts
REFERANS DESEN (kopyalanacak): apps/e2e/tests/reports.spec.ts (mevcut rapor e2e kurulumu + fixtures.ts) · apps/e2e/tests/widget.spec.ts (widget sayfası sürücüsü) · apps/api/prisma/seed.ts (idempotent seed sözleşmesi) · apps/e2e/tests/tickets.spec.ts (deep-link/grid e2e iddia deseni, tm 40)
KK (birebir): "İzleme yapılandırması" | "Reports Ecommerce ile ilişki"
KK DOĞRULAMA: E2E: (a) yapılandırma AÇIKKEN izleme kodu bir satış bildirir → Reports/Reviews/Ecommerce KPI'ları o satışı gösterir — bu tek senaryo KK'nın iki maddesini de (yapılandırma + Reports Ecommerce ilişkisi) uçtan uca kanıtlar; (b) yapılandırma KAPATILINCA aynı ekran dürüst empty state'e döner (yapılandırmanın gerçekten raporu yönettiğinin kanıtı); (c) 13.3 dönüşüm sayacı ile tracked_sales sayısı arasında açıklanmamış fark yok. DoD kapısı tam sürüm (typecheck+lint+unit+integration+build+e2e) yeşil.
KAPSAM DIŞI: Yeni ürün davranışı — bu alt-görev yalnız doğrular ve kanıtlar · Performans/yük testi (satış hacmi) · Harici platform entegrasyonu senaryosu (MOD-09.2, ertelendi)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
