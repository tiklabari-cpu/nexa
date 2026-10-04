# Task ID: 78

**Title:** §5.3-Marka — Multibrand (tek hesapta çok marka)  ·  dilim V2-2

**Status:** done

**Dependencies:** 80 ✓, 91 ✓, 92 ✓

**Priority:** high

**Description:** PRD §5.3 (v2) · [MAX] ↑ · KK-türetilmiş.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `MULTIBRAND`.

8 atomik alt-görev · ~10 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x4 · SONNET-XHIGH x3

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  MULTIBRAND-a [OPUS-XHIGH] `brands` tablosu + license-scoped RLS + lisans başına varsayılan marka backfill  (bağ: yok)
  MULTIBRAND-b [OPUS-MAX] Marka izolasyon çekirdeği — `app.current_brand` context + marka çözümleyici + brand-scoped RLS (channels üzerinde kanıtlanır)  (bağ: MULTIBRAND-a)
  MULTIBRAND-c [OPUS-XHIGH] brand_id yayılımı — websites + üç singleton ayar tablosunun (widget/security/inbox) marka-scoped hâle getirilmesi  (bağ: MULTIBRAND-b)
  MULTIBRAND-d [OPUS-XHIGH] `/brands` CRUD kontratı + route + `brands--all` scope + `brand_not_found` hata tipi  (bağ: MULTIBRAND-a, MULTIBRAND-b)
  MULTIBRAND-e [SONNET-XHIGH] Settings → Brands ekranı (liste + ekle + yeniden adlandır + sil + boş durum)  (bağ: MULTIBRAND-d)
  MULTIBRAND-f [SONNET-XHIGH] AppShell marka değiştirici + seçili markanın persist'i + isteklerde `X-SiyahTus-Brand` başlığı  (bağ: MULTIBRAND-b, MULTIBRAND-d, MULTIBRAND-e)
  MULTIBRAND-g [SONNET-XHIGH] Marka-scoped ayar ekranlarının seçili markaya bağlanması (Widget / Websites / Channels)  (bağ: MULTIBRAND-c, MULTIBRAND-f)
  MULTIBRAND-h [OPUS-XHIGH] Uçtan uca cross-brand doğrulama — otomatik izolasyon test matrisi + kapsam-kaçağı alarmı + e2e  (bağ: MULTIBRAND-c, MULTIBRAND-g)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): MULTIBRAND-b (marka izolasyon çekirdeği) bölünmez. Çekirdek üç şeyi TEK akıl yürütmede tutmak zorunda: (1) `withTenant` transaction'ına üçüncü bir `SET LOCAL app.current_brand` eklenmesi — v2-02:476 bunun yanlış yapılmasının PgBouncer transaction-mode'da connection-pool context sızıntısı ürettiğini açıkça uyarıyor; (2) `siyahtus_current_brand()` + RLS policy semantiği (NULL = lisansın tüm markaları, NOT NULL = tek marka) — policy ile context aynı anda tasarlanmazsa ya her sorgu boş döner ya da filtre hiç uygulanmaz; (3) istekten gelen marka kimliğinin lisansa aitliğinin doğrulanması (cross-brand IDOR). Bu üçü ayrı pencerelere bölünürse, aradaki pencerede sistem "policy var ama context yok" (tüm veri görünmez) veya "context var ama policy yok" (tüm veri sızar) durumunda kalır ve ikinci durum sessizce yanlış-ama-makul veri döndürür — orkestratörün "en riskli v2 kalemi" dediği tam senaryo. Çekirdeğin ETRAFINDAKİ her şey (tablo oluşturma -a, kolon yayılımı -c, CRUD API -d, üç UI alt-görevi -e/-f/-g, doğrulama matrisi -h) ayrı ve daha ucuz alt-görevlere çıkarıldı; çekirdek 2 pencereye indirildi (yalnız `channels` tablosunda kanıtlanır).

VARSAYIMLAR: Katman sırası Organization → License → Brand olarak kuruldu: Brand, License'ın ALTINDA yeni bir izolasyon katmanıdır. PRD §8.4 tablo envanterinde `brands` tablosu hiç yok (grep 'model Brand' → 0), yani tasarım tamamen türetilmiştir; §5.3'ün 'tek lisansta çok marka' ifadesi bu yerleşimi dayatıyor. · Geriye dönük uyum: her lisans migration ile bir 'Default' markası alır ve mevcut TÜM veri ona bağlanır; tek-markalı lisansların davranışı hiç değişmez ve UI'da marka seçici gösterilmez. (Aksi hâlde -c'nin PK değişimi mevcut kurulumları kırardı.) · `app.current_brand` NULL = 'lisansın tüm markaları', NOT NULL = tek marka. Bu sayede lisans-geneli mevcut sorgular (reports, billing, metering) marka bilgisi taşımadan çalışmaya devam eder ve -b'nin policy değişimi geniş regresyon üretmez. · v2 kapsamındaki brand-scoped tablo kümesi ŞUNLARLA SINIRLI: channels, websites, widget_settings, security_settings, inbox_settings. `chats`, `tickets`, `campaigns` marka alanı almaz — aksi hâlde kalem 10 pencereyi ciddi biçimde aşar. · `customers` marka-agnostik kalır (bugünkü hâliyle organization_id scoped). Aynı müşteri birden çok markayla konuşabilir; marka ayrımı kanal/ayar düzeyinde taşınır. PII sahipliğinin markaya bağlanması ayrı bir kapsam kararıdır (olgulardaki güvenlik yüzeyi notu bunu açıkça belirsiz bırakıyor). · Marka seçimi istemciden `X-SiyahTus-Brand` başlığıyla taşınır (yol parametresi değil) — böylece ADR-04'ün mevcut `/api/v1/...` REST yüzeyi ve 23 path dosyası yeniden yazılmaz; sunucu markanın lisansa aitliğini doğrular, ait değilse `websites.ts`'teki gerekçeyle 403 değil 404 döner (id'ler enumerate edilemesin, NFR-S5). · Marka silme: varsayılan marka HİÇ silinemez; varsayılan olmayan bir markaya bağlı satır varsa silme reddedilir (409). Kaskad silme veya veri taşıma bu turda yapılmaz. · Tüm ajanlar lisanstaki tüm markaları görür — marka bazlı ajan yetkisi bu turda YOK. (Olsaydı -b'nin OPUS-MAX kapsamı büyür ve ayrı bir MAX alt-görev gerekirdi.) · PRD §5.3-Marka satırındaki d

AÇIK SORULAR (ürün kararı): `chats` / `tickets` / `campaigns` marka-scoped olacak mı? Bu turda kapsam dışı varsayıldı. Olacaksa +3-4 alt-görev (her biri OPUS-XHIGH, chats için muhtemelen OPUS-MAX çünkü RTM kanal adresleme de markalanır) ve toplam pencere 10 → 15+ olur. · Faturalama marka bazında mı kırılacak? Bugün `usage_records`/metering lisans bazında (ADR-13 mock). Marka bazlı kullanım/fatura isteniyorsa ayrı bir kalem gerekir — bu kırılım lisans bazında kalmasını varsaydı. · Ajanlar markaya atanabilecek mi (marka bazlı yetki)? Varsayım: hayır, tüm ajanlar tüm markaları görür. Evet ise MULTIBRAND-b'nin çekirdeği büyür (authZ kararı marka katmanına iner) ve ayrı bir OPUS-MAX alt-görev açılması gerekir. · `customers` markaya bağlanacak mı? Varsayım: hayır (organization_id scoped kalır). Evet ise PII sahipliği + CRM ekranları + retention politikaları etkilenir; bu ayrı bir kapsam kararıdır. · Her markanın ayrı bir widget domain'i / website'ı olması ZORUNLU mu, yoksa bir domain birden çok markaya hizmet edebilir mi? -c, `@@unique([licenseId, brandId, domain])` ile aynı domain'in iki markada yaşayabilmesini varsaydı; tersi isteniyorsa unique kısıt `(licenseId, domain)` kalmalı ve widget handshake'inin markayı nasıl seçeceği ayrıca tasarlanmalı. · Marka logosu/teması widget'a yansıyacak mı (marka bazlı görsel kimlik)? Bu kırılım `logoUrl` kolonunu tanımlıyor ama widget'a bağlamıyor; bağlanacaksa `apps/widget` tarafında ayrı bir SONNET-XHIGH alt-görev gerekir.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 78.1. MULTIBRAND-a [OPUS-XHIGH] `brands` tablosu + license-scoped RLS + lisans başına varsayılan marka backfill

**Status:** done  
**Dependencies:** None  

Contract-first sırada bu adım kontrat ÖNCESİ şema katmanı — hiçbir route/OpenAPI path eklemez. (1) `model Brand { id uuid, licenseId BigInt, name, slug, logoUrl?, isDefault, createdAt, updatedAt }`, `@@unique([licenseId, slug])`, `@@map("brands")`, License ilişkisi `onDelete: Cascade` — `Website` modelinin birebir şekli. (2) Migration: tablo + `ALTER TABLE brands ENABLE ROW LEVEL SECURITY` + `CREA

**Details:**

MULTIBRAND-a — `brands` tablosu + license-scoped RLS + lisans başına varsayılan marka backfill  [OPUS-XHIGH]

PRD: §5.3-Marka (Multibrand) + NFR-S4
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni tenant-scoped tablo + RLS policy + geri-doldurma migration'ı = güvenlik hassasiyeti olan ama çekirdek sınır OLMAYAN iş (kullanıcı kuralı: bu sınıf en az OPUS-XHIGH olur; güvenlik işi asla sonnet'e verilmez). Koşul 2 sınırda ihlal: policy `websites`/`widget_settings` desenlerinin birebir kopyası ve YENİ izolasyon sınırı burada tanımlanmıyor (o -b'de), bu yüzden MAX değil XHIGH.
NEDEN AÇIK: grep 'model Brand' apps/api/prisma/schema.prisma → 0 sonuç; PRD §8.4 tablo envanterinde de `brands` listelenmemiş (tamamen yeni tasarım). License altında çoklu satır kabul eden tek analog `Website` (schema.prisma:1059-1073) ve o yalnız `licenseId+domain` tutuyor — name/logo/config gibi marka alanı yok. Bugün `SecuritySettings`/`InboxSettings`/`WidgetSettings` (schema.prisma:1124-1183) `licenseId BigInt @id` ile 'tek lisans = tek marka' varsayımını şema seviyesinde somutlaştırmış durumda.
KAPSAM: Contract-first sırada bu adım kontrat ÖNCESİ şema katmanı — hiçbir route/OpenAPI path eklemez. (1) `model Brand { id uuid, licenseId BigInt, name, slug, logoUrl?, isDefault, createdAt, updatedAt }`, `@@unique([licenseId, slug])`, `@@map("brands")`, License ilişkisi `onDelete: Cascade` — `Website` modelinin birebir şekli. (2) Migration: tablo + `ALTER TABLE brands ENABLE ROW LEVEL SECURITY` + `CREATE POLICY brands_tenant ON brands USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license())` — `websites`/`widget_settings` policy'lerinin birebir kopyası. (3) Lisans başına yalnız bir varsayılan: partial unique index `ON brands(license_id) WHERE is_default`. (4) Backfill: mevcut her license için bir `Default` markası (is_default=true) — böylece tek-markalı davranış birebir korunur. (5) `seed.ts` aynı satırı üretir.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/<yeni_ts>_brands/migration.sql · apps/api/prisma/seed.ts · apps/api/test/integration/tenant-isolation.test.ts · apps/api/test/integration/data-model.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/schema.prisma (model Website, satır 1059-1073 — licenseId + unique + Cascade şekli) · apps/api/prisma/migrations/20260726150000_widget_settings/migration.sql (tablo + ENABLE RLS + tek policy deseni) · apps/api/prisma/migrations/20260722151255_auth_and_tenancy/migration.sql (siyahtus_current_license() ve `<tablo>_tenant` policy adlandırması)
KK (birebir): "KK-türetilmiş: «Her lisansta en az bir marka bulunur; migration sonrası mevcut tüm veri lisansın varsayılan markasına bağlıdır ve tek-markalı davranış değişmez; bir lisansta ikinci bir varsayılan marka oluşturulamaz.» — Türetme gerekçesi: PRD §5.3 tablosunun sütunları yalnız 'Alan | Kapsam'; ayrı bir Kabul Kriteri sütunu YOK, ham hücre metni («Multibrand; 100+ entegrasyon; command palette AI komutları») biçim olarak bir KK değil (olgular: kk_yetersiz=true)." | "Destek (birebir, urun-gereksinim-dokumani-PRD.md:58): «Multi-tenant | Çok kiracılı SaaS; izolasyon anahtarı `organization_id` / `license_id` / `account_id`»"
KK DOĞRULAMA: `apps/api/test/integration/data-model.test.ts` — migrate+seed sonrası her license için tam 1 `is_default` marka sayılır (KK'nın 'en az bir marka' + 'tek varsayılan' maddesi); aynı lisansa ikinci `is_default=true` INSERT → unique ihlali (KK'nın 'ikinci varsayılan oluşturulamaz' maddesi). `apps/api/test/integration/tenant-isolation.test.ts`'e `brands` satırı eklenir: A lisansının context'inde B lisansının markası 0 satır döner (NFR-S4 çapraz-tenant reddi). `contract-parity.test.ts` DEĞİŞMEDEN yeşil kalır (bu alt-görev hiçbir route eklemediği için).
KAPSAM DIŞI: brand_id kolonunun başka tablolara eklenmesi (-b: channels; -c: websites + üç ayar tablosu) · `app.current_brand` context'i ve brand-scoped RLS (-b) · /brands API + kontrat (-d) — bilerek ayrıldı: contract-parity.test.ts İKİ YÖNLÜ çalışıyor (belgelenmiş ama servis edilmeyen path de kırar), bu yüzden yaml+route aynı pencerede olmalı · UI (-e/-f/-g) · `customers` tablosunun markalanması (varsayım: organization_id scoped kalır) · marka bazlı ajan yetkisi / marka bazlı faturalama
SÖZLEŞME: yok — bu alt-görev hiçbir OpenAPI path'i veya route eklemez. UYARI: `apps/api/test/integration/contract-parity.test.ts` iki yönlü karşılaştırma yapıyor (servis edilen ama belgelenmeyen route KIRAR, belgelenen ama servis edilmeyen path de KIRAR); bu yüzden `brands.yaml` bilerek -d'ye bırakıldı ve orada route ile AYNI pencerede eklenip re-bundle edilecek.
MIGRATION: EVET — yeni `brands` tablosu (+ ENABLE ROW LEVEL SECURITY + `brands_tenant` policy + `license_id WHERE is_default` partial unique index) + mevcut her `licenses` satırı için bir varsayılan marka backfill'i.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 78.2. MULTIBRAND-b [OPUS-MAX] Marka izolasyon çekirdeği — `app.current_brand` context + marka çözümleyici + brand-scoped RLS (channels üzerinde kanıtlanır)

**Status:** done  
**Dependencies:** 78.1  

Contract-first: önce kontrat alanı (additive), sonra migration, sonra backend. (1) `apps/api/src/lib/tenant.ts`: `TenantContext`'e `brandId?: string`; `withTenant` transaction'ının içine ÜÇÜNCÜ `SELECT set_config('app.current_brand', <uuid|''>, true)` (transaction-scoped — PgBouncer transaction-mode ile uyumlu, connection'a taşmaz); `assertValidContext`'e brand UUID doğrulaması (malformed → raise,

**Details:**

MULTIBRAND-b — Marka izolasyon çekirdeği — `app.current_brand` context + marka çözümleyici + brand-scoped RLS (channels üzerinde kanıtlanır)  [OPUS-MAX]

PRD: §5.3-Marka (Multibrand) + NFR-S4 + NFR-S5 + NFR-S3
ETİKET GEREKÇESİ: OPUS-MAX: tenant/marka izolasyon SINIRININ kendisi burada tanımlanıyor — koşul 2 (güvenlik sınırı yok) ve koşul 3 (eşzamanlılık/transaction-invariant akıl yürütmesi yok) doğrudan ihlal. `SET LOCAL` transaction invariant'ı + connection-pool context sızıntısı (v2-02:476'da 'kritik operasyonel tuzak' olarak uyarılmış) + cross-brand IDOR kararı aynı anda tutulmak zorunda. Yanlış karar pahalı: sessizce yanlış-ama-makul veri döner. ÇEKİRDEK BÖLÜNMEZ (bkz. bolunmeyen_gerekce).
NEDEN AÇIK: `apps/api/src/lib/tenant.ts` yalnız iki alan taşıyor: `withTenant` içinde `set_config('app.current_license', ...)` ve `set_config('app.current_organization', ...)` — brand-level üçüncü bir context alanı YOK; `TenantContext` arayüzü `{ licenseId, organizationId }`. `apps/api/src/plugins/auth.ts:106-110` `request.tenant()` → `tenantOf(principal)` ve `principal.ts:57-59` yalnız bu iki alanı döndürüyor. Migration 20260722151255_auth_and_tenancy'de tanımlı `siyahtus_current_license()` dışında marka karşılığı bir SQL fonksiyonu yok. `channels` tablosunda (schema.prisma:1005-1017) `brand_id` kolonu yok; `@@unique([licenseId, type])` bugün 'lisans başına tek kanal tipi' diyor — multibrand'de bu kısıt yanlışa döner.
KAPSAM: Contract-first: önce kontrat alanı (additive), sonra migration, sonra backend. (1) `apps/api/src/lib/tenant.ts`: `TenantContext`'e `brandId?: string`; `withTenant` transaction'ının içine ÜÇÜNCÜ `SELECT set_config('app.current_brand', <uuid|''>, true)` (transaction-scoped — PgBouncer transaction-mode ile uyumlu, connection'a taşmaz); `assertValidContext`'e brand UUID doğrulaması (malformed → raise, sessizce eşleşmeme yok — mevcut licenseId/organizationId davranışının aynısı); `TenantScopedRepository`'ye `brandId` getter'ı. (2) Migration: `CREATE OR REPLACE FUNCTION siyahtus_current_brand() RETURNS UUID` (`siyahtus_current_license()` deseninin birebir eşi, `NULLIF(current_setting('app.current_brand', true), '')::UUID`) + `GRANT EXECUTE ... TO siyahtus_app`. (3) `channels.brand_id` kolonu: nullable ekle → varsayılan markaya backfill → NOT NULL + FK; `@@unique([licenseId, type])` → `@@unique([licenseId, brandId, type])`. (4) `channels_tenant` policy'sinin yeniden yazımı: `USING (license_id = siyahtus_current_license() AND (siyahtus_current_brand() IS NULL OR brand_id = siyahtus_current_brand()))` + aynı `WITH CHECK` — NULL semantiği: 'lisansın tüm markaları' (mevcut lisans-geneli sorgular kırılmadan çalışır). (5) Marka çözümleyici: `X-SiyahTus-Brand` başlığı (yoksa null=tüm markalar) → markanın İSTEYENİN lisansına ait olduğu doğrulanır; ait değilse `not_found` (404) — `websites.ts`'teki 'id'ler enumerate edilemesin' gerekçesiyle aynı, 403 değil.
DOSYALAR: apps/api/src/lib/tenant.ts · apps/api/src/plugins/auth.ts · apps/api/src/services/auth/principal.ts · apps/api/prisma/schema.prisma · apps/api/prisma/migrations/<yeni_ts>_brand_context/migration.sql · apps/api/src/routes/channels.ts · packages/contract/openapi/paths/channels.yaml · apps/api/test/integration/brand-isolation.test.ts · apps/api/test/integration/channels-adapters.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/lib/tenant.ts (withTenant + set_config transaction deseni — genişletilecek TAM dosya) · apps/api/prisma/migrations/20260722151255_auth_and_tenancy/migration.sql:334-344 (siyahtus_current_license() fonksiyon + GRANT deseni) · apps/api/src/routes/websites.ts (başka tenant'ın kaydında 404 dönme gerekçesi — RLS boş döner ve 404 id'leri enumerate edilemez tutar, NFR-S5) · apps/api/test/integration/tenant-isolation.test.ts (çapraz-tenant negatif test kurgusu)
KK (birebir): "KK-türetilmiş: «Bir markanın bağlamıyla açılan hiçbir sorgu başka bir markanın satırını döndürmez; marka bağlamı transaction dışına (bağlantı havuzuna) sızmaz; istekle gelen marka kimliği isteyenin lisansına ait değilse 404 döner.» — Türetme gerekçesi: PRD §5.3'te KK sütunu yok (kk_yetersiz=true); kriter NFR-S4'ün çapraz-tenant reddi maddesinin marka katmanına genişletilmesiyle türetildi." | "Destek (birebir, urun-gereksinim-dokumani-PRD.md:758): «NFR-S4 | Tenant izolasyonu | Her sorgu `organization_id`/`license_id` filtreli; PostgreSQL RLS (`current_setting('app.current_org')`) + `TenantScopedRepository`; PgBouncer transaction-mode + `SET LOCAL`; CI'da çapraz-tenant reddi negatif testleri»" | "Destek (birebir, v2-derin-analiz/v2-02-teknik-mimari-derin.md:476): «her transaction başında `SET LOCAL app.current_org_id` çağrılmalı — aksi halde bağlantı havuzunda önceki tenant'ın context'i sızabilir (kritik operasyonel tuzak).»"
KK DOĞRULAMA: Yeni `apps/api/test/integration/brand-isolation.test.ts` — NEGATİF TESTLER ÖNCE YAZILIR VE KIRMIZI GÖRÜLÜR (bu deponun 08.8.4/06.3.2 kuralı): (a) A markası bağlamında B markasının channel id'si → 404/0 satır [KK maddesi 1]; (b) başka LİSANSA ait bir brand id başlıkla gönderilir → 404, 403 değil [KK maddesi 3]; (c) context sızıntısı: aynı havuz bağlantısı üzerinde ardışık iki istek (marka A → marka B) — ikinci istek birincinin markasını GÖRMEZ, `set_config(..., true)` transaction sonunda geri alınır [KK maddesi 2, v2-02:476 tuzağı]; (d) `X-SiyahTus-Brand` yokken lisans-geneli davranış korunur (NULL semantiği). Regresyon: `tenant-isolation.test.ts` ve `channels-adapters.test.ts` yeşil kalır.
KAPSAM DIŞI: `websites` + `widget_settings` + `security_settings` + `inbox_settings` tablolarının brand-scoped hale getirilmesi (-c) — çekirdek yalnız `channels` üzerinde kanıtlanır · /brands CRUD route + kontrat (-d) · tüm UI (-e/-f/-g) · otomatik izolasyon test MATRİSİ (-h) — burada yalnız çekirdeğin kendi negatif testleri var · chats/tickets/campaigns tablolarına brand_id (varsayım: v2 kapsamı dışı) · marka bazlı ajan yetkisi (açık soru 3)
SÖZLEŞME: `packages/contract/openapi/paths/channels.yaml` — Channel şemasına `brand_id` alanı (ADDITIVE, mevcut path'ler aynı kalır) + `X-SiyahTus-Brand` başlığının belgelenmesi. YENİ PATH YOK, bu yüzden contract-parity'nin yön kontrolü tetiklenmez; yine de `packages/contract` re-bundle + `packages/types` regen ZORUNLU, aksi halde üretilen tipler kontrattan sapar (ADR-05).
MIGRATION: EVET — `CREATE OR REPLACE FUNCTION siyahtus_current_brand()` + GRANT; `channels.brand_id` (nullable ekle → varsayılan markaya backfill → NOT NULL + FK brands(id)); `@@unique([licenseId, type])` → `@@unique([licenseId, brandId, type])`; `channels_tenant` policy DROP+CREATE (marka koşulu eklenmiş hâliyle).
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 78.3. MULTIBRAND-c [OPUS-XHIGH] brand_id yayılımı — websites + üç singleton ayar tablosunun (widget/security/inbox) marka-scoped hâle getirilmesi

**Status:** done  
**Dependencies:** 78.2  

-b'de kurulan deseni 4 tabloya uygula. (1) `websites.brand_id`: nullable → varsayılan markaya backfill → NOT NULL + FK; `@@unique([licenseId, domain])` → `@@unique([licenseId, brandId, domain])`. (2) `widget_settings` / `security_settings` / `inbox_settings`: `licenseId @id` → `@@id([licenseId, brandId])` (satır başına marka), mevcut satırlar varsayılan markaya backfill. (3) Dört tablonun `_tenant

**Details:**

MULTIBRAND-c — brand_id yayılımı — websites + üç singleton ayar tablosunun (widget/security/inbox) marka-scoped hâle getirilmesi  [OPUS-XHIGH]

PRD: §5.3-Marka (Multibrand) + NFR-S4 + NFR-S5
ETİKET GEREKÇESİ: OPUS-XHIGH: izolasyon sınırının 4 tabloya daha yayılması — koşul 2 ihlali (unutulan tek tablo/callsite cross-brand sızıntı üretir; v2-04 §7.1'in doğrudan uyardığı senaryo). MAX değil çünkü SINIR KARARI -b'de verildi; burada kurulmuş desen uygulanıyor ve üç singleton tablonun PK değişimi mekanik ama geniş yüzeyli. Kesinlikle SONNET olamaz: izolasyon işi asla sonnet'e verilmez.
NEDEN AÇIK: `SecuritySettings`, `InboxSettings`, `WidgetSettings` (schema.prisma:1124-1183) üçü de `licenseId BigInt @id` — yani lisans başına TEK satır (singleton); bugünkü kod 'tek lisans = tek marka' varsayımını şema seviyesinde somutlaştırmış durumda. `apps/api/src/routes/settings.ts` bu varsayıma yaslanıyor: `/settings/chat-timeout` ve `/settings/widget` GET'leri `findFirst()`'ü WHERE'siz çağırıyor ('id-by-licenseId key means there is at most one row' yorumu) ve PUT'lar `upsert({ where: { licenseId } })` kullanıyor — marka eklenince ikisi de yanlışa döner. `Website` (schema.prisma:1059-1073) `licenseId+domain` tutuyor, `brand_id` kolonu yok.
KAPSAM: -b'de kurulan deseni 4 tabloya uygula. (1) `websites.brand_id`: nullable → varsayılan markaya backfill → NOT NULL + FK; `@@unique([licenseId, domain])` → `@@unique([licenseId, brandId, domain])`. (2) `widget_settings` / `security_settings` / `inbox_settings`: `licenseId @id` → `@@id([licenseId, brandId])` (satır başına marka), mevcut satırlar varsayılan markaya backfill. (3) Dört tablonun `_tenant` policy'leri -b'deki şablonla yeniden yazılır: `USING (license_id = siyahtus_current_license() AND (siyahtus_current_brand() IS NULL OR brand_id = siyahtus_current_brand()))`. (4) Callsite'lar: `settings.ts`'teki `findFirst()` → marka filtresi, `upsert({ where: { licenseId } })` → `where: { licenseId_brandId }`; `services/websites/website-service.ts` marka bağlamını taşır. (5) Kırılan mevcut testlerin onarımı (riskler listesinde öngörülmüştü).
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/<yeni_ts>_brand_scoped_settings/migration.sql · apps/api/src/routes/settings.ts · apps/api/src/routes/websites.ts · apps/api/src/services/websites/website-service.ts · packages/contract/openapi/paths/settings.yaml · packages/contract/openapi/paths/websites.yaml · apps/api/test/integration/settings.test.ts · apps/api/test/integration/websites.test.ts · apps/web/src/features/settings/WidgetCustomization.test.tsx · apps/web/src/features/settings/BannedCustomerIps.test.tsx
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/<yeni_ts>_brand_context/migration.sql (-b'de üretilen policy şablonu — birebir kopyalanacak) · apps/api/src/routes/settings.ts:519-560 (/settings/widget GET findFirst + PUT upsert — dönüştürülecek TAM kalıp) · apps/api/src/routes/websites.ts (tenant + 404 deseni)
KK (birebir): "KK-türetilmiş: «Marka-scoped her tablo `brand_id` taşır ve marka bağlamıyla filtrelenir; bir markanın widget/güvenlik/inbox ayarı ile website listesi başka bir markada görünmez; marka ayrımı olmadan hiçbir ayar satırı okunmaz.» — Türetme gerekçesi: PRD §5.3'te KK sütunu yok (kk_yetersiz=true); kriter v2-04 §7.1'in merkezi tenant-scoping zorunluluğundan türetildi." | "Destek (birebir, v2-derin-analiz/v2-04-guvenlik-uyumluluk.md:432-434): «Repository katmanında merkezi tenant-scoping — her `findMany`/`findFirst` çağrısı bir taban sınıf/yardımcı fonksiyondan geçmeli, `organization_id` filtresi *asla* çağıran koda bırakılmamalı»"
KK DOĞRULAMA: `apps/api/test/integration/settings.test.ts` — iki markalı lisansta marka A'nın `/settings/widget` PUT'u marka B'nin ayarını DEĞİŞTİRMEZ (KK: 'başka markada görünmez'); marka B'nin GET'i kendi değerini/varsayılanı döner. `apps/api/test/integration/websites.test.ts` — marka A'da eklenen domain marka B'nin listesinde yok; aynı domain iki farklı markada eklenebilir (yeni `@@unique([licenseId, brandId, domain])`). Negatif: marka A bağlamıyla marka B'nin websiteId'si → 404. Regresyon: `WidgetCustomization.test.tsx` + `BannedCustomerIps.test.tsx` + `chat-timeout.test.ts` yeşile döner (singleton varsayımı kırıldığı için onarılırlar).
KAPSAM DIŞI: /brands CRUD route + kontrat (-d) · UI'ın marka bağlamına bağlanması (-g) · chats / tickets / campaigns / customers tablolarına brand_id (varsayım: v2 kapsamı dışı) · marka bazlı faturalama (usage_records lisans bazında kalır) · otomatik izolasyon matrisi (-h)
SÖZLEŞME: `packages/contract/openapi/paths/settings.yaml` ve `packages/contract/openapi/paths/websites.yaml` — mevcut path'lere `X-SiyahTus-Brand` başlığı + response şemalarına `brand_id` alanı (ADDITIVE; path'ler AYNI kalır, ADR-04 REST yüzeyi değişmez). Yeni path yok → contract-parity'nin yön kontrolü tetiklenmez; buna rağmen re-bundle + `packages/types` regen ZORUNLU (ADR-05).
MIGRATION: EVET — `websites.brand_id` (nullable→backfill→NOT NULL+FK) + unique genişletme; `widget_settings` / `security_settings` / `inbox_settings` için `brand_id` ekle → varsayılan markaya backfill → PK'yı `(license_id, brand_id)` bileşiğine çevir; dört tablonun `_tenant` policy'leri DROP+CREATE (marka koşullu). RİSK: backfill migration ile AYNI transaction'da olmalı ve sonrasında `brand_id IS NULL` sayacı 0 doğrulanmalı.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 78.4. MULTIBRAND-d [OPUS-XHIGH] `/brands` CRUD kontratı + route + `brands--all` scope + `brand_not_found` hata tipi

**Status:** done  
**Dependencies:** 78.1, 78.2  

ADR-05 contract-first, TEK PENCEREDE: kontrat + route birlikte (zorunlu — parity iki yönlü). (1) `packages/contract/openapi/paths/brands.yaml`: `GET/POST /brands`, `GET/PATCH/DELETE /brands/{brandId}` — `websites.yaml`'ın iki-bloklu şeklinin birebir eşi. (2) `openapi.yaml`'a `Brand` şeması + Error enum'a `brand_not_found`. (3) `packages/types/src/scopes.ts`'e `brands--all:ro` / `brands--all:rw` + 

**Details:**

MULTIBRAND-d — `/brands` CRUD kontratı + route + `brands--all` scope + `brand_not_found` hata tipi  [OPUS-XHIGH]

PRD: §5.3-Marka (Multibrand) + NFR-S5
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni YETKİLİ endpoint ailesi + YENİ scope tanımı + rol eşlemesi — kullanıcı kuralı birebir: 'yeni bir yetkili endpoint eklemek, mevcut scope'u genişletmek EN AZ OPUS-XHIGH olur; güvenlik işi asla sonnet'e verilmez'. Koşul 2 ihlali. MAX değil: izolasyon çekirdeği -b'de kapandı, burada kurulmuş context tüketiliyor ve CRUD şekli `websites.ts`'ten kopyalanıyor.
NEDEN AÇIK: `apps/api/src/routes/` altında 28 route dosyası var (channels.ts, campaigns.ts, settings.ts, websites.ts dahil) ama `brands.ts` veya `organizations.ts` YOK — grep 0. `packages/contract/openapi/paths/` altında 23 path dosyası var, `brands.yaml` YOK — grep 0. `packages/types/src/scopes.ts` içinde marka scope'u yok. En yakın CRUD analog `websites.ts` (123 satır) marka değil yalnız domain kaydı tutuyor.
KAPSAM: ADR-05 contract-first, TEK PENCEREDE: kontrat + route birlikte (zorunlu — parity iki yönlü). (1) `packages/contract/openapi/paths/brands.yaml`: `GET/POST /brands`, `GET/PATCH/DELETE /brands/{brandId}` — `websites.yaml`'ın iki-bloklu şeklinin birebir eşi. (2) `openapi.yaml`'a `Brand` şeması + Error enum'a `brand_not_found`. (3) `packages/types/src/scopes.ts`'e `brands--all:ro` / `brands--all:rw` + rol varsayılan eşlemesi (owner/admin yazar, agent okur). (4) `packages/types/src/errors.ts`: `ERROR_TYPES` + `ERROR_STATUS` (İKİ AYRI YER) → `brand_not_found: 404`. (5) `packages/types/src/scopes.test.ts` sayaçları (`SCOPES` uzunluğu + `ERROR_TYPES` 24+N). (6) `apps/api/src/routes/brands.ts` — `websites.ts` deseni; varsayılan marka SİLİNEMEZ; markaya bağlı satır varsa silme reddi; duplicate slug → 409. (7) `server.ts`'e route kaydı. (8) re-bundle + regen.
DOSYALAR: packages/contract/openapi/paths/brands.yaml · packages/contract/openapi/openapi.yaml · packages/types/src/scopes.ts · packages/types/src/scopes.test.ts · packages/types/src/errors.ts · apps/api/src/routes/brands.ts · apps/api/src/server.ts · apps/api/test/integration/brands.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/websites.ts (TAM CRUD şekli: zod parse helper, ApiError.validation, isUniqueViolation→409, cross-tenant 404 gerekçesi) · packages/contract/openapi/paths/websites.yaml (iki-bloklu path dosyası: koleksiyon + tekil, 401/403/404/429 response referansları) · apps/api/test/integration/websites.test.ts (CRUD + cross-tenant integration kurgusu)
KK (birebir): "KK-türetilmiş: «Marka oluştur / listele / yeniden adlandır / sil çalışır; başka lisansın markası ne listede görünür ne de id ile erişilebilir (404); varsayılan marka silinemez; aynı lisansta aynı slug'a sahip ikinci marka reddedilir (409).» — Türetme gerekçesi: PRD §5.3'te KK sütunu yok (kk_yetersiz=true); kriter 'tek lisansta çok marka' kapsam hücresinden + `websites` CRUD KK deseninden türetildi." | "Destek (birebir, PRD §5.3-Marka, satır 415 ham kapsam hücresi): «Multibrand; 100+ entegrasyon; command palette AI komutları»"
KK DOĞRULAMA: Yeni `apps/api/test/integration/brands.test.ts` — CRUD döngüsü (POST 201 → GET listede → PATCH ad değişir → DELETE 204) [KK maddesi 1]; cross-tenant negatif ÖNCE: B lisansının brandId'siyle GET/PATCH/DELETE → 404 ve listede görünmez [KK maddesi 2]; varsayılan markayı DELETE → 4xx `not_allowed` [KK maddesi 3]; aynı slug ikinci kez POST → 409 [KK maddesi 4]; `brands--all` scope'u olmayan token → 403. `contract-parity.test.ts` YEŞİL (yaml+route aynı pencerede geldiği için). `packages/types/src/scopes.test.ts` yeşil (sayaçlar güncellendi).
KAPSAM DIŞI: UI (-e/-f/-g) · marka bazlı ajan atama/yetkisi (açık soru 3) · marka logosu yükleme akışı (mevcut `uploads.ts` yüzeyi — ayrı kalem) · marka silinince bağlı verinin taşınması/arşivlenmesi (varsayım: bağlı satır varsa silme reddi)
SÖZLEŞME: YENİ PATH'LER: `POST /brands`, `GET /brands`, `GET /brands/{brandId}`, `PATCH /brands/{brandId}`, `DELETE /brands/{brandId}` → `packages/contract/openapi/paths/brands.yaml` + `openapi.yaml`'a `Brand` şeması ve `brand_not_found` error enum girdisi. ZORUNLU: OpenAPI'ye eklenip RE-BUNDLE edilmeli, aksi halde `contract-parity.test.ts` KIRILIR — ve test İKİ YÖNLÜ olduğu için yaml'ı route'suz eklemek de kırar; ikisi aynı pencerede. TUZAK (MEMORY 'Error-type additions'): yeni ApiError tipi `packages/types/src/errors.ts`'te İKİ YERE (ERROR_TYPES + ERROR_STATUS) + `scopes.test.ts` sayacına + openapi error enum'una eklenip regen edilmezse test kırılır.
MIGRATION: yok — tablo -a'da, brand_id kolonları -b/-c'de oluşturuldu; bu alt-görev yalnız API yüzeyi.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 78.5. MULTIBRAND-e [SONNET-XHIGH] Settings → Brands ekranı (liste + ekle + yeniden adlandır + sil + boş durum)

**Status:** done  
**Dependencies:** 78.4  

UI-only, contract-first sıranın SONUNDA (backend -d'de hazır). `Brands.tsx`: react-query ile `GET /brands` listesi; 'Add brand' formu (ad zorunlu — `lib/form.tsx` primitifi, alan-altı hata + submit-disabled); satır içi yeniden adlandırma (`PATCH`); sil butonu (varsayılan markada gizli/pasif, sunucu reddini de ErrorNotice ile gösterir); marka yokken `EmptyState` (boş dikdörtgen değil, EK-B.1 kuralı

**Details:**

MULTIBRAND-e — Settings → Brands ekranı (liste + ekle + yeniden adlandır + sil + boş durum)  [SONNET-XHIGH]

PRD: §5.3-Marka (Multibrand)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 3 dosya + test. (2) Güvenlik sınırı yok — yetki -d'deki scope'ta, izolasyon -b/-c'de; ekran yalnız `/brands` çağırır. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen mevcut: `WebsiteWidgets.tsx` (aynı lisans-altı çoklu-kayıt CRUD ekranı: liste+ekle+kaldır). (5) Kontrat değişikliği yok (-d'de kapandı). (6) KK mekanik: render + ekle/sil + boş durum.
NEDEN AÇIK: `apps/web/src/features/` altında 15 feature dizini var (settings, campaigns, team, traffic dahil) ama brand/workspace-switcher ekranı YOK — 'brand'/'switcher' araması yalnız isim çakışmalarından (ör. 'vibrant', JS switch ifadeleri) false-positive dönüyor, gerçek UI 0. `apps/web/src/features/settings/` içeriği: BannedCustomerIps, Channels, SettingsPage, WebsiteWidgets, WidgetCustomization — marka ekranı yok.
KAPSAM: UI-only, contract-first sıranın SONUNDA (backend -d'de hazır). `Brands.tsx`: react-query ile `GET /brands` listesi; 'Add brand' formu (ad zorunlu — `lib/form.tsx` primitifi, alan-altı hata + submit-disabled); satır içi yeniden adlandırma (`PATCH`); sil butonu (varsayılan markada gizli/pasif, sunucu reddini de ErrorNotice ile gösterir); marka yokken `EmptyState` (boş dikdörtgen değil, EK-B.1 kuralı); `canEdit` prop'u ile salt-okunur rol davranışı (WidgetCustomization deseni). `SettingsPage.tsx`'e bölüm kaydı.
DOSYALAR: apps/web/src/features/settings/Brands.tsx · apps/web/src/features/settings/Brands.test.tsx · apps/web/src/features/settings/SettingsPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/WebsiteWidgets.tsx (lisans altında çoklu kayıt: liste + ekle + kaldır — kopyalanacak ANA desen) · apps/web/src/features/settings/WebsiteWidgets.test.tsx (aynı ekranın test kurgusu) · apps/web/src/features/settings/WidgetCustomization.tsx (useQuery/useMutation + queryClient.setQueryData + canEdit salt-okunur deseni) · apps/web/src/lib/form.tsx (alan-altı hata + submit-disabled primitifi, T4-a) · apps/web/src/components/EmptyState.tsx (anlamlı boş durum)
KK (birebir): "KK-türetilmiş: «Markalar ekranı mevcut markaları listeler; yeni marka eklenebilir, adı değiştirilebilir, varsayılan olmayan marka silinebilir; hiç marka yokken anlamlı boş durum gösterilir (boş dikdörtgen değil); salt-okunur rolde form pasiftir.» — Türetme gerekçesi: PRD §5.3'te KK sütunu yok (kk_yetersiz=true); kriter -d'nin API KK'sının ekran payı olarak ve EK-B.1 empty-state kuralıyla türetildi."
KK DOĞRULAMA: `apps/web/src/features/settings/Brands.test.tsx` — (a) iki markalı yanıt → iki satır render [KK: listeler]; (b) boş ad ile submit → alan-altı hata + submit pasif [KK: form davranışı]; (c) ekle → mutation çağrılır ve liste güncellenir [KK: eklenebilir]; (d) varsayılan markada sil butonu yok/pasif [KK: varsayılan silinemez]; (e) boş liste → EmptyState metni görünür [KK: anlamlı boş durum]; (f) `canEdit=false` → tüm kontroller pasif.
KAPSAM DIŞI: üst çubuk marka değiştirici (-f) · ayar ekranlarının marka bağlamına bağlanması (-g) · marka logosu yükleme · e2e (-h)
SÖZLEŞME: yok — -d'de eklenen `/brands` path'leri tüketilir, kontrat değişmez.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 78.6. MULTIBRAND-f [SONNET-XHIGH] AppShell marka değiştirici + seçili markanın persist'i + isteklerde `X-SiyahTus-Brand` başlığı

**Status:** done  
**Dependencies:** 78.2, 78.4, 78.5  

İstemci plumbing. (1) `AppShell.tsx`: üst çubukta marka `Dropdown`'ı — `GET /brands` listesinden; tek marka varsa gizli (tek-markalı lisansta görsel gürültü yok). (2) Seçim `localStorage`'da persist (i18n dil tercihinin birebir deseni); geçersiz/silinmiş marka id'si varsa varsayılana düşer. (3) `api-client.ts`: seçili marka varsa her isteğe `X-SiyahTus-Brand` başlığı eklenir (mevcut Authorization enje

**Details:**

MULTIBRAND-f — AppShell marka değiştirici + seçili markanın persist'i + isteklerde `X-SiyahTus-Brand` başlığı  [SONNET-XHIGH]

PRD: §5.3-Marka (Multibrand)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 5 dosya (AppShell + api-client + auth-store + iki test). (2) Güvenlik sınırı YOK: istemci yalnız bir başlık taşır; markanın lisansa aitliğini SUNUCU doğruluyor (-b) ve uydurma başlık 404 döner — istemci tarafı yanlışlığı sızıntı üretemez. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen mevcut: AppShell hesap menüsü + `components/ui/Dropdown.tsx` + `lib/i18n.ts` localStorage persist. (5) Kontrat değişikliği yok. (6) KK mekanik (seç → persist → istekte başlık).
NEDEN AÇIK: `apps/web/src/features/` altında workspace/brand switcher ekranı YOK (grep sonuçları tamamı false-positive). `apps/web/src/components/AppShell.tsx` mevcut hesap menüsünü barındırıyor (EK-C.2'de `Dropdown`'a oturtulmuştu) ama marka seçici taşımıyor; `apps/web/src/lib/api-client.ts` isteklere marka başlığı eklemiyor.
KAPSAM: İstemci plumbing. (1) `AppShell.tsx`: üst çubukta marka `Dropdown`'ı — `GET /brands` listesinden; tek marka varsa gizli (tek-markalı lisansta görsel gürültü yok). (2) Seçim `localStorage`'da persist (i18n dil tercihinin birebir deseni); geçersiz/silinmiş marka id'si varsa varsayılana düşer. (3) `api-client.ts`: seçili marka varsa her isteğe `X-SiyahTus-Brand` başlığı eklenir (mevcut Authorization enjeksiyon noktasının yanına); seçili marka yoksa başlık HİÇ gönderilmez (lisans-geneli NULL semantiği korunur). (4) Marka değişince react-query cache'i invalidate edilir.
DOSYALAR: apps/web/src/components/AppShell.tsx · apps/web/src/components/AppShell.test.tsx · apps/web/src/lib/api-client.ts · apps/web/src/lib/api-client.test.ts · apps/web/src/lib/auth-store.ts
REFERANS DESEN (kopyalanacak): apps/web/src/components/AppShell.tsx (mevcut hesap menüsü = kopyalanacak Dropdown yerleşimi) · apps/web/src/components/ui/Dropdown.tsx (EK-C.2 tek tasarım sistemi bileşeni) · apps/web/src/lib/i18n.ts + apps/web/src/lib/i18n.test.ts (localStorage tercih persist + reload sonrası koruma deseni) · apps/web/src/lib/api-client.ts + apps/web/src/lib/api-client.test.ts (mevcut başlık enjeksiyonu ve test kurgusu)
KK (birebir): "KK-türetilmiş: «Kullanıcı üst çubuktan marka değiştirebilir; seçim sayfa yeniden yüklendiğinde korunur; seçim sonrası tüm API istekleri seçili markanın bağlamında gider ve önceki markanın verisi ekranda kalmaz; lisansta tek marka varsa seçici gösterilmez.» — Türetme gerekçesi: PRD §5.3'te KK sütunu yok (kk_yetersiz=true); kriter 'tek lisansta çok marka' kapsamının kullanıcı yüzeyi payı olarak ve mevcut tercih-persist deseninden (T1-a / i18n) türetildi."
KK DOĞRULAMA: `AppShell.test.tsx` — (a) iki markalı yanıt → seçici görünür, seçim değişir [KK: değiştirebilir]; (b) seçimden sonra store yeniden kurulduğunda seçili marka korunur [KK: reload'da korunur]; (c) tek markalı yanıt → seçici render edilmez [KK: tek markada gizli]; (d) marka değişince `queryClient.invalidateQueries` çağrılır [KK: önceki veri kalmaz]. `api-client.test.ts` — seçili marka varken istekte `X-SiyahTus-Brand` var, yokken başlık hiç gönderilmiyor [KK: bağlamında gider].
KAPSAM DIŞI: ayar ekranlarının queryKey'lerinin markaya bağlanması (-g) · command palette'e marka komutu eklenmesi (ayrı PRD kalemi — `CommandPalette.tsx` zaten var) · marka bazlı tema/logo görselinin uygulanması
SÖZLEŞME: yok — `X-SiyahTus-Brand` başlığı -b/-c'de kontrata yazıldı, burada yalnız tüketiliyor.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 78.7. MULTIBRAND-g [SONNET-XHIGH] Marka-scoped ayar ekranlarının seçili markaya bağlanması (Widget / Websites / Channels)

**Status:** done  
**Dependencies:** 78.3, 78.6  

UI-only. (1) Üç ekranın react-query `queryKey`'lerine seçili `brandId` eklenir (`['settings','widget', brandId]` vb.) — marka değişince otomatik yeniden fetch. (2) Her ekranın başlığında hangi markanın düzenlendiği görünür (yanlış markayı düzenleme kazasını önler). (3) Kaydetme sonrası `setQueryData` markaya özgü anahtara yazar. (4) Marka seçili değilken (lisans-geneli) mevcut davranış korunur.

**Details:**

MULTIBRAND-g — Marka-scoped ayar ekranlarının seçili markaya bağlanması (Widget / Websites / Channels)  [SONNET-XHIGH]

PRD: §5.3-Marka (Multibrand) + NFR-S5
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 5 dosya (3 ekran + 2 test). (2) Güvenlik sınırı yok — sunucu tarafı marka scope'u -c'de kapandı; burada yalnız react-query cache anahtarları ve başlık etiketleri değişiyor. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen mevcut: `WidgetCustomization.tsx`'in `queryKey: ['settings','widget']` kalıbı. (5) Kontrat değişikliği yok. (6) KK mekanik: marka değişince doğru veri gelir.
NEDEN AÇIK: `apps/web/src/features/settings/WidgetCustomization.tsx` `queryKey: ['settings','widget']` ile markadan bağımsız tek bir cache girdisi tutuyor ve `api.put('/settings/widget')` ile lisans-singleton'ı yazıyor — marka eklendiğinde (bkz. -c) iki marka aynı cache girdisini paylaşır ve marka değişince ekranda önceki markanın değeri kalır. `WebsiteWidgets.tsx` ve `Channels.tsx` aynı feature dizininde aynı kalıbı kullanıyor.
KAPSAM: UI-only. (1) Üç ekranın react-query `queryKey`'lerine seçili `brandId` eklenir (`['settings','widget', brandId]` vb.) — marka değişince otomatik yeniden fetch. (2) Her ekranın başlığında hangi markanın düzenlendiği görünür (yanlış markayı düzenleme kazasını önler). (3) Kaydetme sonrası `setQueryData` markaya özgü anahtara yazar. (4) Marka seçili değilken (lisans-geneli) mevcut davranış korunur.
DOSYALAR: apps/web/src/features/settings/WidgetCustomization.tsx · apps/web/src/features/settings/WidgetCustomization.test.tsx · apps/web/src/features/settings/WebsiteWidgets.tsx · apps/web/src/features/settings/WebsiteWidgets.test.tsx · apps/web/src/features/settings/Channels.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/WidgetCustomization.tsx (useQuery queryKey + useMutation + queryClient.setQueryData kalıbı — dönüştürülecek TAM kalıp) · apps/web/src/features/settings/WebsiteWidgets.test.tsx (aynı ekranın mevcut test kurgusu) · apps/web/src/components/AppShell.tsx (-f'te eklenen seçili marka kaynağı)
KK (birebir): "KK-türetilmiş: «Marka değiştirildiğinde widget görünümü, website listesi ve kanal ayarları o markanın verisini gösterir; önceki markanın verisi ekranda kalmaz; ekranda hangi markanın düzenlendiği görünür.» — Türetme gerekçesi: PRD §5.3'te KK sütunu yok (kk_yetersiz=true); kriter -c'nin sunucu tarafı KK'sının ekran payı olarak türetildi."
KK DOĞRULAMA: `WidgetCustomization.test.tsx` — marka A seçiliyken A'nın rengi render edilir; marka B'ye geçildiğinde B'nin rengi fetch edilip render edilir ve A'nın değeri EKRANDA KALMAZ [KK maddesi 1-2]; başlıkta marka adı görünür [KK maddesi 3]. `WebsiteWidgets.test.tsx` — marka değişince liste yeniden fetch edilir ve diğer markanın domain'i listede yok.
KAPSAM DIŞI: Inbox / Reports / Billing ekranlarının markalanması (varsayım: lisans-geneli kalır) · marka bazlı tema/logo görseli · e2e (-h)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 78.8. MULTIBRAND-h [OPUS-XHIGH] Uçtan uca cross-brand doğrulama — otomatik izolasyon test matrisi + kapsam-kaçağı alarmı + e2e

**Status:** done  
**Dependencies:** 78.3, 78.7  

(1) `brand-isolation.test.ts` matrisi: brand-scoped tablo listesi (channels, websites, widget_settings, security_settings, inbox_settings) tek yerde tanımlanır ve her biri için 'marka A'nın bağlamı + marka B'nin ID'si → boş/404' testi otomatik üretilir. (2) KAPSAM-KAÇAĞI ALARMI: liste, şemadaki `brand_id` kolonu olan tabloların gerçek kümesiyle karşılaştırılır — yeni bir brand-scoped tablo eklenip

**Details:**

MULTIBRAND-h — Uçtan uca cross-brand doğrulama — otomatik izolasyon test matrisi + kapsam-kaçağı alarmı + e2e  [OPUS-XHIGH]

PRD: §5.3-Marka (Multibrand) + NFR-S4 + NFR-S5 + NFR-M4
ETİKET GEREKÇESİ: OPUS-XHIGH: doğrulama TASARIMI — hangi tabloların brand-scoped sayılacağı yargı gerektiriyor ve matris şemadan türetilerek 'yeni brand-scoped tablo eklenip teste eklenmezse kırılır' alarmı kuruluyor. Güvenlik yüzeyi var (izolasyonun kanıtı) ama YENİ sınır kurmuyor → MAX değil. Kesinlikle SONNET olamaz: izolasyon doğrulaması güvenlik işidir.
NEDEN AÇIK: `apps/api/test/integration/tenant-isolation.test.ts` bugün yalnız lisans/organizasyon düzeyinde çapraz-tenant reddini kanıtlıyor; marka kavramı depoda hiç bulunmadığı için (grep 'model Brand' → 0) marka düzeyi hiç test edilmiyor. v2-04:441 her repository metodu için otomatik izolasyon testini ZORUNLU kılıyor. `apps/e2e/tests/` altında 20 spec var (settings.spec.ts, widget.spec.ts dahil) ama marka senaryosu yok.
KAPSAM: (1) `brand-isolation.test.ts` matrisi: brand-scoped tablo listesi (channels, websites, widget_settings, security_settings, inbox_settings) tek yerde tanımlanır ve her biri için 'marka A'nın bağlamı + marka B'nin ID'si → boş/404' testi otomatik üretilir. (2) KAPSAM-KAÇAĞI ALARMI: liste, şemadaki `brand_id` kolonu olan tabloların gerçek kümesiyle karşılaştırılır — yeni bir brand-scoped tablo eklenip matrise yazılmazsa test KIRILIR (v2-04 §7.1'in 'unutulan tablo sızıntı üretir' uyarısının mekanik karşılığı). (3) Ters yön: taşıması beklenen ama `brand_id` taşımayan tablo varsa alarm. (4) `apps/e2e/tests/brands.spec.ts`: iki markalı lisansta marka değiştir → widget ayarı + website listesi değişir, diğer markanınki görünmez. (5) HANDOFF'a kanıt notu.
DOSYALAR: apps/api/test/integration/brand-isolation.test.ts · apps/api/test/integration/tenant-isolation.test.ts · apps/e2e/tests/brands.spec.ts · apps/e2e/tests/fixtures.ts · apps/api/prisma/seed.ts
REFERANS DESEN (kopyalanacak): apps/api/test/integration/tenant-isolation.test.ts (çapraz-tenant reddi matris kurgusu — marka katmanına genişletilecek) · apps/api/test/integration/contract-parity.test.ts (şemadan/router'dan küme türetip iki yönlü karşılaştıran 'kaçağı yakalayan test' deseni — kapsam-kaçağı alarmının birebir modeli) · apps/e2e/tests/settings.spec.ts (ayar ekranı e2e akışı)
KK (birebir): "KK-türetilmiş: «Her brand-scoped repository metodu için 'marka A'nın bağlamıyla marka B'nin ID'sini sorgula → sonuç boş' testi CI'da zorunludur; brand_id taşıyan yeni bir tablo eklenip bu matrise yazılmazsa test kırılır.» — Türetme gerekçesi: PRD §5.3'te KK sütunu yok (kk_yetersiz=true); kriter v2-04:441'in zorunlu izolasyon testinin marka katmanına birebir genişletilmesidir." | "Destek (birebir, v2-derin-analiz/v2-04-guvenlik-uyumluluk.md:441): «Otomatik izolasyon testi — CI'da her repository metodu için "org A'nın token'ı ile org B'nin ID'sini sorgula, sonuç boş dönmeli" testi zorunlu kılınmalı.»"
KK DOĞRULAMA: `apps/api/test/integration/brand-isolation.test.ts` — matristeki her tablo için cross-brand sorgu boş/404 döner [KK maddesi 1]; matrise yazılmamış bir `brand_id` kolonu enjekte edildiğinde (test fixture'ı) alarm testi KIRMIZI olur [KK maddesi 2 — alarmın kendisi kanıtlanır]. `apps/e2e/tests/brands.spec.ts` — iki markalı lisansta marka değiştirme sonrası widget rengi ve website listesi değişir, diğer markanınki görünmez. Tam DoD kapısı: typecheck+lint+unit+integration+build+e2e. NOT (MEMORY 'E2E clean DB'): e2e için truncate+reseed + sourced .env + serbest portlar gerekir; idempotent seed mutasyona uğramış tenant'ı sıfırlamaz.
KAPSAM DIŞI: yeni üretim kodu (bu alt-görev yalnız doğrulama katmanı; bulunan bir açık varsa ilgili alt-göreve geri döner) · chats/tickets/campaigns marka matrisi (bu tablolar v2 kapsamı dışı varsayıldı) · performans/yük testi (NFR-P kapsamı)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
