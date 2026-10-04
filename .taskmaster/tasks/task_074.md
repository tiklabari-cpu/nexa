# Task ID: 74

**Title:** 13.3 — Goals (ziyaretçi→sohbet→dönüşüm hunisi)  ·  dilim V2-8

**Status:** done

**Dependencies:** 78 ✓

**Priority:** low

**Description:** FR-MOD-13.3 · Should (v2) · MOD-07.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `FR-MOD-13.3`.

9 atomik alt-görev · ~10 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x4 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  13.3-a [SONNET-XHIGH] Goal veri sözlüğü — @siyahtus/types tipleri + OpenAPI component şemaları (path YOK)  (bağ: —)
  13.3-b [OPUS-XHIGH] goal_achievements tablosu + RLS politikası + idempotency kısıtı (Prisma migration)  (bağ: —)
  13.3-c [OPUS-XHIGH] Goals CRUD — kontrat path + route + servis (license-scoped, .strict() definition)  (bağ: 13.3-a)
  13.3-d [OPUS-MAX] Hedef eşleşme + achievement kaydı çekirdeği — idempotent tetik, ziyaretçi yazma yolu, campaign conversion bağı (BÖLÜNMEZ)  (bağ: 13.3-b, 13.3-c)
  13.3-e [SONNET-XHIGH] /reports/overview "Achieved goals" sayacı (pencere + önceki pencere karşılaştırması)  (bağ: 13.3-b, 13.3-d)
  13.3-f [OPUS-XHIGH] GET /reports/goals — 3 aşamalı huni raporu + rapor grubu + CSV export  (bağ: 13.3-b, 13.3-c, 13.3-d)
  13.3-g [SONNET-XHIGH] Goals ekranı — liste + Create goal formu (Customers alanının 4. sekmesi)  (bağ: 13.3-c)
  13.3-h [SONNET-XHIGH] 3 aşamalı huni gösterimi (Goals ekranı) + Reports Overview "Achieved goals" KPI kartı  (bağ: 13.3-e, 13.3-f, 13.3-g)
  13.3-i [OPUS-XHIGH] Uçtan uca doğrulama — ziyaret→sohbet→hedef E2E + çapraz-tenant regresyon kapanışı  (bağ: 13.3-d, 13.3-e, 13.3-f, 13.3-g, 13.3-h)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): 13.3-d (hedef eşleşme + achievement kaydı çekirdeği) bölünmez. Üç akıl yürütme aynı bağlamı paylaşıyor: (1) idempotency — aynı ziyaretçi aynı hedefi iki kez tetiklememeli, kanıtı `@@unique([goalId, customerId])` + `createMany({skipDuplicates:true})`; (2) tenant izolasyonu — yazma yolu **ziyaretçi (customer principal)** tarafından tetikleniyor (customer.ts:341 `recordPageView` bloğu), yani kimliği doğrulanmış ajan değil, widget; (3) çapraz-özellik invariantı — achievement yazılınca aynı müşterinin `campaign_sends.converted` alanı güncelleniyor, bu da yalnız aynı licenseId için geçerli olmalı. Bu üçü ayrı pencerelere bölünürse "hangi koşulda satır yazılır" kararı ile "o satırın hangi lisansa ait olduğu" kararı farklı bağlamlara düşer ve izolasyon akıl yürütmesi kaybolur. Çekirdeğin ETRAFINDAKİ her şey ayrı ve daha ucuz etikete çıkarıldı: migration+RLS 13.3-b (OPUS-XHIGH), CRUD 13.3-c (OPUS-XHIGH), veri sözlüğü 13.3-a (SONNET-XHIGH), raporlar 13.3-e (SONNET-XHIGH), UI 13.3-g/-h (SONNET-XHIGH).

VARSAYIMLAR: `goal_achievements` YENİ bir tablodur ve PRD §8.4'e EK'tir (çelişki değil). Gerekçe: PRD §8.4 (satır 960) yalnız `goals`(`id`,`license_id`,`name`,`definition`,`active`) tanım tablosunu verir; ancak PRD KK 'rapor entegrasyonu' + PRD satır 212 'Reports "Achieved goals"' pencere içi SAYIM ister ve bu, zaman damgası olmayan bir tanım tablosundan üretilemez. Şema tek doğruluk kaynağı (PRD §8.4 + rapor-2 §5.3) korunur; yeni tablo o kaynağa eklenir. · `Goal.definition` (jsonb) v1 şeması `{ url_contains?: string }` olarak sabitlenir — `Campaign.conditions` ile aynı vokabüler (campaigns.ts:22 `.strict()`). Gerekçe: PRD definition'ın iç yapısını hiçbir yerde spesifiye etmiyor; depoda tek somut emsal `url_contains`. Şema açık obje kalır, geo/olay/satış koşulları ileride KATKISAL eklenir. · `campaign_sends` tablosuna `goal_id` FK EKLENMEZ. Bunun yerine achievement yazıldığında aynı müşterinin AYNI LİSANSTAKİ `campaign_sends` satırları `converted=true` yapılır. Gerekçe: FK + geriye dönük veri migrasyonu mevcut Campaigns testlerinin (campaigns.test.ts, CampaignsPage.test.tsx) conversion beklentilerini bozma riski taşıyor; bu risk sıfırlanıyor. Yan etki: `converted` semantiği 'tanımlı hedefe ulaştı' anlamına daralıyor (bkz. §açık sorular-3). · Huni denominatörleri: `visitors` = pencerede ziyareti olan distinct müşteri (TENANT GENELİ), `chats` = pencerede açılan thread'lerin distinct müşterisi, `conversions` = o hedefin achievement'ları. Gerekçe: PRD 'ziyaretçi→sohbet→dönüşüm' der ama denominatörü tanımlamaz; hedef bazında 'görebilecek ziyaretçi' kümesi hesaplanabilir değil (goal tetiklenmeden önce hangi ziyaretçinin aday olduğu kayıtlı değil). · Goals ekranı Customers alanının 4. sekmesidir (`/app/customers/goals`). Gerekçe: PRD 'Gözlem: Engage/Goals hunisi' der ama bu depoda Engage adında bir üst alan yok; Campaigns da (aynı Engage ailesinden) Customers altında yaşıyor (App.tsx:86, CustomersTabs.tsx). Yeni bir üst navigasyon alanı açmak kapsam genişletmesi olurdu. · Yeni scope ür

AÇIK SORULAR (ürün kararı): "Achieved goals" hem `/reports/overview` KPI kartında (13.3-e) hem ayrı bir Goals rapor grubunda (13.3-f) veriliyor. Tek yer isteniyorsa 13.3-e düşülebilir (−1 pencere) — ama o zaman Overview'daki 'Volume' bölümünde hedef sayısı görünmez. Hangisi tercih ediliyor? · `Goal.definition` v2'de sayfa URL'sinin ötesine (olay adı, satış tutarı, form gönderimi) genişleyecek mi? Plan `matchesGoal` fonksiyonunu şimdiden çok-koşullu AND olarak tasarlıyor (campaign-matching.ts deseni); genişlemeyecekse bu fazlalık. · `campaign_sends.converted` semantiği değişiyor: bugün serbest bir boolean, bu işten sonra yalnız tanımlı bir Goal tetiklendiğinde true olacak. Mevcut Campaigns E2E/unit beklentileri bu daralmayı kabul ediyor mu, yoksa `converted` kampanyaya özel (Goal'dan bağımsız) mı kalmalı? Kabul edilmezse 13.3-d'nin 3. maddesi düşer. · Huni 'visitors' denominatörü tenant geneli mi olmalı (planın seçimi) yoksa hedef bazında mı (yalnız hedefin sayfasına yakın olan ziyaretçiler)? Hedef bazında istenirse ek bir 'aday ziyaretçi' kaydı gerekir → 13.3-b'ye kolon, 13.3-d'ye yazma yolu eklenir (+1 pencere). · `goal_achievements` için retention/PII politikası gerekiyor mu? Satır `customer_id` taşıyor; `visits` tablosu NFR-S9 retention politikasına tabi (schema.prisma yorumu). Aynı politikanın achievement satırlarına da uygulanması isteniyorsa ayrı bir alt-görev gerekir.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 74.1. 13.3-a [SONNET-XHIGH] Goal veri sözlüğü — @siyahtus/types tipleri + OpenAPI component şemaları (path YOK)

**Status:** done  
**Dependencies:** None  

Contract-first ilk adım, yalnız vokabüler. (1) `packages/types/src/domain.ts`'e Goals bloğu: `GoalDefinition { url_contains?: string }` (açık obje — ileride geo/olay koşulu katkısal eklenir), `Goal { id, name, definition, active, created_at }`, `GoalFunnel { visitors, chats, conversions, conversion_rate }`, `GOAL_FILTERS = ['all','active','inactive'] as const` + `GoalFilter`. (2) `packages/contrac

**Details:**

13.3-a — Goal veri sözlüğü — @siyahtus/types tipleri + OpenAPI component şemaları (path YOK)  [SONNET-XHIGH]

PRD: FR-MOD-13.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 3 dosya + regen çıktısı. (2) Güvenlik sınırı yok — yalnız tip/şema vokabüleri, hiçbir route/scope/izolasyon kararı yok. (3) Eşzamanlılık yok. (4) Kopyalanacak mevcut desen ismen verilebiliyor: packages/types/src/domain.ts:230-288 Campaign bloğu ve openapi.yaml:1121-1177 CampaignConditions/CampaignContent/CampaignPerformance/Campaign şemaları. (5) Kontrat değişikliği katkısal ve mekanik (yalnız components/schemas). (6) KK mekanik: bundle + typecheck yeşil.
NEDEN AÇIK: `grep -rn "Goal" apps/api/src` 0 sonuç. `packages/types/src/domain.ts` içinde Goal tipi yok — Campaigns bloğu satır 230-288'de bitiyor, ardından TicketRule geliyor. `packages/contract/openapi/openapi.yaml` içinde "goal" geçen tek satır 1153: `description: Of those, how many reached a goal.` (CampaignPerformance açıklaması) — Goal şeması yok.
KAPSAM: Contract-first ilk adım, yalnız vokabüler. (1) `packages/types/src/domain.ts`'e Goals bloğu: `GoalDefinition { url_contains?: string }` (açık obje — ileride geo/olay koşulu katkısal eklenir), `Goal { id, name, definition, active, created_at }`, `GoalFunnel { visitors, chats, conversions, conversion_rate }`, `GOAL_FILTERS = ['all','active','inactive'] as const` + `GoalFilter`. (2) `packages/contract/openapi/openapi.yaml` `components/schemas` altına Goal, GoalDefinition, GoalFunnel, GoalsReport. (3) `pnpm --filter @siyahtus/contract generate` ile bundle + generated/api.ts yeniden üret. **`paths:` bölümüne HİÇBİR giriş eklenmez** — contract-parity.test.ts çift yönlüdür ve "documented but not served" yönü de kırar (`apps/api/test/integration/contract-parity.test.ts`, 'serves every route the contract documents' testi). Referanssız component şeması güvenli: bundle.ts:26 `'no-unused-components': 'off'`.
DOSYALAR: packages/types/src/domain.ts · packages/contract/openapi/openapi.yaml · packages/contract/src/generated/api.ts
REFERANS DESEN (kopyalanacak): packages/types/src/domain.ts (satır 230-288: CAMPAIGN_STATUSES / CampaignConditions / CampaignContent / CampaignPerformance / Campaign) · packages/contract/openapi/openapi.yaml (satır 1121-1177: CampaignConditions / CampaignContent / CampaignPerformance / Campaign şemaları)
KK (birebir): "hedef tanımı"
KK DOĞRULAMA: `pnpm --filter @siyahtus/contract generate` hatasız biter (bundle.ts spec hatasında çıkış kodu ≠ 0) → "hedef tanımı"nın makine-okunur şeması var. `pnpm -w typecheck` yeşil. Mevcut `contract-parity.test.ts` yeşil kalır (path eklenmediği için her iki yön de bozulmaz).
KAPSAM DIŞI: `/goals` path'lerinin OpenAPI'ye eklenmesi (13.3-c — route ile aynı pencerede olmalı, yoksa parity kırılır) · `/reports/goals` path'i (13.3-f) · Prisma şeması / migration (13.3-b) · route, servis, UI
SÖZLEŞME: openapi.yaml `components/schemas` altına Goal, GoalDefinition, GoalFunnel, GoalsReport eklenir. **Yeni path EKLENMEZ** (contract-parity çift yönlü). Re-bundle + regen zorunlu (`pnpm --filter @siyahtus/contract generate`).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 74.2. 13.3-b [OPUS-XHIGH] goal_achievements tablosu + RLS politikası + idempotency kısıtı (Prisma migration)

**Status:** done  
**Dependencies:** None  

(1) `apps/api/prisma/schema.prisma`'ya `GoalAchievement` modeli: `id uuid pk`, `licenseId BigInt @map("license_id")`, `goalId @map("goal_id")`, `customerId @map("customer_id")`, `chatId String? @db.VarChar(12) @map("chat_id")` (huninin 'sohbet' aşaması izi), `achievedAt @default(now()) @db.Timestamptz(6)`; `@@unique([goalId, customerId])` (idempotency kısıtı), `@@index([licenseId, achievedAt])` (p

**Details:**

13.3-b — goal_achievements tablosu + RLS politikası + idempotency kısıtı (Prisma migration)  [OPUS-XHIGH]

PRD: FR-MOD-13.3 (+ NFR-S4 RLS, NFR-S5 IDOR/enumeration)
ETİKET GEREKÇESİ: OPUS-XHIGH: migration SQL'i RLS politikasını (tenant izolasyon mekanizmasının kendisi) kuruyor — koşul 2 ihlali, SONNET olamaz. Ancak politika `campaign_sends` migration'ından (20260726170000) birebir kopyalanabilir bir satırdır ve yeni bir izolasyon modeli tasarlanmıyor; güvenlik/algoritma çekirdeği değil → OPUS-MAX de değil. Kullanıcı kuralı: güvenlik hassasiyeti olan ama çekirdek sınır olmayan iş = OPUS-XHIGH.
NEDEN AÇIK: `goals` tablosu (schema.prisma:812-824) hedef TANIMINI tutuyor ama hedefe ULAŞMA olayını tutan hiçbir tablo yok. Mevcut tek 'conversion' izi `campaign_sends.converted` (schema.prisma:799) — serbest boolean, `goal_id` FK'i yok, yani hangi Goal'e karşılık geldiği kayıtlı değil. Pencere içi "Achieved goals" sayımı (13.3-e/-f) zaman damgalı satır olmadan yapılamaz.
KAPSAM: (1) `apps/api/prisma/schema.prisma`'ya `GoalAchievement` modeli: `id uuid pk`, `licenseId BigInt @map("license_id")`, `goalId @map("goal_id")`, `customerId @map("customer_id")`, `chatId String? @db.VarChar(12) @map("chat_id")` (huninin 'sohbet' aşaması izi), `achievedAt @default(now()) @db.Timestamptz(6)`; `@@unique([goalId, customerId])` (idempotency kısıtı), `@@index([licenseId, achievedAt])` (pencere sorgusu), `@@map("goal_achievements")`; `Goal.achievements`, `License.goalAchievements`, `Customer` ters ilişkileri. (2) Migration SQL: CREATE TABLE + 4 FK (licenses/goals/customers ON DELETE CASCADE) + unique index + `ALTER TABLE goal_achievements ENABLE ROW LEVEL SECURITY; CREATE POLICY goal_achievements_tenant ON goal_achievements USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());`
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/20260801090000_goal_achievements/migration.sql · apps/api/test/integration/goal-achievements-rls.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260726170000_campaign_sends/migration.sql (CREATE TABLE + FK + unique + RLS policy birebir kalıp) · apps/api/prisma/migrations/20260722154008_domain_model/migration.sql:935-937 (goals_tenant RLS politikası — siyahtus_current_license() kalıbı) · apps/api/prisma/schema.prisma:789-824 (CampaignSend + Goal modelleri)
KK (birebir): "KK-türetilmiş: "3 aşamalı huni" — huninin 3. aşamasının bir zaman penceresinde SAYILABİLMESİ için zaman damgalı hedef-ulaşma satırı gerekir. Türetme gerekçesi: PRD §8.4 (satır 960) yalnız `goals`(`id`,`license_id`,`name`,`definition`,`active`) tanımını verir, olay tablosu vermez; PRD KK 'rapor entegrasyonu' pencere içi sayım ister, bu da tanım tablosundan üretilemez."
KK DOĞRULAMA: integration: migration uygulandıktan sonra (a) `goal_achievements` tablosu var ve aynı (goal_id, customer_id) ikinci INSERT unique ihlali verir (idempotency kısıtı kanıtı); (b) **cross-tenant:** `siyahtus_current_license()` A lisansına set edilmişken B lisansının satırı SELECT'te dönmez (RLS USING); (c) B lisansına ait `license_id` ile INSERT denemesi WITH CHECK'e takılır.
KAPSAM DIŞI: `campaign_sends.goal_id` FK EKLENMEZ — geriye dönük veri migrasyonu + mevcut Campaigns testlerinin (CampaignsPage.test.tsx, campaigns.test.ts) conversion beklentisini bozma riski (bkz. §varsayımlar-3) · hedef eşleşme mantığı ve satırı kimin yazdığı (13.3-d) · `goals` tablosunun kendisi — zaten var, RLS'i de var (migration 20260722154008:935)
MIGRATION: EVET — yeni `goal_achievements` tablosu: FK'ler (licenses, goals, customers), `UNIQUE(goal_id, customer_id)`, `INDEX(license_id, achieved_at)` ve `ENABLE ROW LEVEL SECURITY` + `goal_achievements_tenant` politikası.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 74.3. 13.3-c [OPUS-XHIGH] Goals CRUD — kontrat path + route + servis (license-scoped, .strict() definition)

**Status:** done  
**Dependencies:** 74.1  

Contract-first, tek pencerede: (1) `packages/contract/openapi/paths/goals.yaml` — `goals` (GET list, query `status=all|active|inactive`; POST create) + `goal` (PATCH, `goalId` uuid path param); (2) `openapi.yaml` `paths:` altına `/goals` ve `/goals/{goalId}` $ref girişleri + re-bundle; (3) `apps/api/src/routes/goals.ts` — zod şemaları: `definitionSchema = z.object({ url_contains: z.string().trim()

**Details:**

13.3-c — Goals CRUD — kontrat path + route + servis (license-scoped, .strict() definition)  [OPUS-XHIGH]

PRD: FR-MOD-13.3 (+ NFR-S3 route seviyesinde scope, NFR-S4 RLS, NFR-S5 enumeration'a 404)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni YETKİLİ endpoint eklemek (customers:ro/rw kapılı, license-scoped kaynak) — kullanıcının açık kuralı gereği en az OPUS-XHIGH; koşul 2 ihlali (tenant izolasyon/IDOR yüzeyi) olduğu için SONNET OLAMAZ. OPUS-MAX değil çünkü izolasyon mekanizması (request.withTenant + goals RLS politikası, migration 20260722154008:935) zaten mevcut ve apps/api/src/routes/campaigns.ts + campaign-service.ts birebir kopyalanabilir emsal; yeni algoritma/kripto/eşzamanlılık yok.
NEDEN AÇIK: `apps/api/src/routes/goals.ts` mevcut değil (routes/ dizininde 24 dosya var, goals yok). `packages/contract/openapi/paths/goals.yaml` mevcut değil (paths/ dizininde 23 dosya var, goals yok). `grep -rn "Goal" apps/api/src` 0 sonuç — okuyan/yazan tek bir route/service/test dahi yok.
KAPSAM: Contract-first, tek pencerede: (1) `packages/contract/openapi/paths/goals.yaml` — `goals` (GET list, query `status=all|active|inactive`; POST create) + `goal` (PATCH, `goalId` uuid path param); (2) `openapi.yaml` `paths:` altına `/goals` ve `/goals/{goalId}` $ref girişleri + re-bundle; (3) `apps/api/src/routes/goals.ts` — zod şemaları: `definitionSchema = z.object({ url_contains: z.string().trim().max(2048).optional() }).strict()` (tanımsız anahtar → 400, campaigns.ts:22 gerekçesi: sessizce kimseyi eşleştirmeyen hedef oluşmasın), `name` 1-120, `active` opsiyonel; scope: GET `['customers:ro','customers:rw']`, POST/PATCH `['customers:rw']`; (4) `apps/api/src/services/goals/goal-service.ts` — list/create/update, her sorguda `licenseId: tenant.licenseId`, `request.withTenant` içinde; bulunamayan → `ApiError.notFound` (403 değil, NFR-S5); (5) `apps/api/src/server.ts`'e `goalRoutes` register (campaignRoutes'un yanına, satır ~147).
DOSYALAR: packages/contract/openapi/paths/goals.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/goals.ts · apps/api/src/services/goals/goal-service.ts · apps/api/src/server.ts · apps/api/test/integration/goals.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/campaigns.ts (parse() + ApiError.validation + scope config + listQuery/createBody/updateBody kalıbı) · apps/api/src/services/campaigns/campaign-service.ts (list/create/update + licenseId filtresi + #reload + #toDto) · packages/contract/openapi/paths/campaigns.yaml (path dosyası yapısı, operationId, 400/401/403/404/429 response ref'leri)
KK (birebir): "hedef tanımı"
KK DOĞRULAMA: integration `goals.test.ts`: (a) POST `/goals` 201 + GET listede görünür + PATCH ile `active` toggle → "hedef tanımı" oluşturulabiliyor/düzenlenebiliyor; (b) `definition: { url_contain: 'x' }` (typo) → 400 (`.strict()`); (c) **cross-tenant:** B lisansının goalId'siyle PATCH → 404 (403 değil); (d) `customers:ro` token'ıyla POST → 403; (e) `contract-parity.test.ts` yeşil (path + route aynı pencerede eklendiği için her iki yön de tutar).
KAPSAM DIŞI: hedef eşleşme / achievement yazımı (13.3-d) · rapor sorguları (13.3-e, 13.3-f) · UI (13.3-g) · DELETE `/goals/{goalId}` — v1 Campaigns'te de yok, `active=false` yeterli · yeni scope veya yeni ApiError tipi üretmek (bkz. §varsayımlar-6 — errors.ts ×2 + scopes.test.ts sayacı + openapi enum + regen zinciri bilinçli olarak açılmıyor)
SÖZLEŞME: YENİ PATH: `paths/goals.yaml` (`listGoals`, `createGoal`, `updateGoal` operationId'leri) + `openapi.yaml` `paths:` altına `/goals` ve `/goals/{goalId}`. **OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts kırılır** — hem 'documents every route the server registers' hem 'serves every route the contract documents' yönü.
MIGRATION: yok — `goals` tablosu ve `goals_tenant` RLS politikası migration 20260722154008'de zaten var
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 74.4. 13.3-d [OPUS-MAX] Hedef eşleşme + achievement kaydı çekirdeği — idempotent tetik, ziyaretçi yazma yolu, campaign conversion bağı (BÖLÜNMEZ)

**Status:** done  
**Dependencies:** 74.2, 74.3  

(1) Saf `apps/api/src/services/goals/goal-matching.ts` — `hasGoalTrigger(definition)` ve `matchesGoal(definition, pageUrls)`: AND semantiği, boş predicate KİMSEYİ eşleştirmez (campaign-matching.ts:36-56 kuralının aynısı), malformed jsonb tek satır tüm değerlendirmeyi düşürmez (`visitorPageUrls` savunmacı okuma deseni). (2) `GoalService.evaluate(tx, tenant, customerId, pageUrls, now)` — `licenseId`

**Details:**

13.3-d — Hedef eşleşme + achievement kaydı çekirdeği — idempotent tetik, ziyaretçi yazma yolu, campaign conversion bağı (BÖLÜNMEZ)  [OPUS-MAX]

PRD: FR-MOD-13.3 (+ NFR-S4 tenant izolasyon, NFR-S5 IDOR, NFR-P2/P7)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 VE 3 birlikte ihlal. (a) Yazma yolu **ziyaretçi (customer principal)** tarafından tetikleniyor — widget'tan gelen istek tenant-scoped satır yazdırıyor (customer.ts:338-351), yani izolasyon sınırı; (b) idempotency/yarış — aynı ziyaretçi aynı hedefi iki kez tetiklememeli, doğru karar unique kısıt + skipDuplicates ile aynı transaction'da verilmeli; (c) yeni eşleşme algoritması (definition → huni aşaması) tasarlanıyor; (d) `campaign_sends.converted` güncellemesi çapraz-özellik veri invariantı. Yanlış karar pahalı: sızan/çift sayılan dönüşüm doğrudan raporu ve (Campaigns üzerinden) müşteriye gösterilen performansı bozar.
NEDEN AÇIK: `Goal.definition` (jsonb, schema.prisma:816) iç şeması hiçbir yerde tanımlı değil — `grep -rn "Goal" apps/api/src` 0 sonuç. Huninin 'dönüşüm' aşamasını yazan tek satır kod yok: `campaign_sends.converted` (schema.prisma:799) yalnız kampanya bazlı ve Goal'a bağlı değil. Ziyaretçinin sayfa gezintisini kaydeden tek yol `CustomerService.recordPageView` (customer-service.ts:187, tek çağıran customer.ts:341) ve orada hedef değerlendirmesi yapılmıyor.
KAPSAM: (1) Saf `apps/api/src/services/goals/goal-matching.ts` — `hasGoalTrigger(definition)` ve `matchesGoal(definition, pageUrls)`: AND semantiği, boş predicate KİMSEYİ eşleştirmez (campaign-matching.ts:36-56 kuralının aynısı), malformed jsonb tek satır tüm değerlendirmeyi düşürmez (`visitorPageUrls` savunmacı okuma deseni). (2) `GoalService.evaluate(tx, tenant, customerId, pageUrls, now)` — `licenseId` + `active: true` filtresiyle goal'ları oku, eşleşenler için `tx.goalAchievement.createMany({ data: [...], skipDuplicates: true })`; dönen `count` yeni tetiklenen hedef sayısı. (3) AYNI transaction içinde: en az bir yeni achievement varsa o müşterinin `campaign_sends` satırlarını `{ where: { licenseId: tenant.licenseId, customerId }, data: { converted: true } }` ile güncelle — `licenseId` filtresi zorunlu, çapraz-lisans güncelleme imkânsız olmalı. (4) `apps/api/src/routes/customer.ts` — `recordPageView` çağrısının hemen ardından, aynı best-effort `try/catch` içinde `goals.evaluate(...)`; hata ziyaretçinin mesaj gönderimini ASLA düşürmez (mevcut yorum satır 334-337'nin gerekçesi korunur).
DOSYALAR: apps/api/src/services/goals/goal-matching.ts · apps/api/src/services/goals/goal-matching.test.ts · apps/api/src/services/goals/goal-service.ts · apps/api/src/routes/customer.ts · apps/api/test/integration/goals-achievement.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/campaigns/campaign-matching.ts (visitorPageUrls savunmacı okuma + matchesConditions AND semantiği + 'boş predicate kimseyi eşleştirmez' kuralı) · apps/api/src/services/campaigns/campaign-service.ts:202-249 (#fireIfRunning — tenant filtreli okuma + createMany skipDuplicates ile idempotent yazma) · apps/api/src/routes/customer.ts:338-351 (best-effort try/catch bloğu)
KK (birebir): "3 aşamalı huni"
KK DOĞRULAMA: unit `goal-matching.test.ts`: boş definition → false; `url_contains` eşleşmesi case-insensitive; malformed pages dizisi throw etmez. integration `goals-achievement.test.ts`: (a) aktif hedefin URL'sine giden ziyaretçi için TAM 1 `goal_achievements` satırı; (b) **aynı sayfaya ikinci ziyaret → hâlâ 1 satır** (idempotency — huninin dönüşüm aşaması şişmez); (c) `active=false` hedef tetiklenmez; (d) **cross-tenant:** B lisansının hedefi A lisansının ziyaretçisiyle tetiklenmez ve hiçbir satır B'ye yazılmaz; (e) o müşteriye kampanya gönderimi varsa `campaign_sends.converted` true olur, başka lisansın send'i etkilenmez.
KAPSAM DIŞI: RTM `new_goal` bildirimi (v2-03-api-veri-referans.md:296) — PRD 13.3 KK'sında yok, ayrı kalem · `campaign_sends.goal_id` FK eklemek (13.3-b kapsam dışı gerekçesi) · rapor sorguları (13.3-e, 13.3-f) · UI (13.3-g, 13.3-h) · hedef tanımının URL dışı koşulları (olay, satış tutarı) — 13.5 e-ticaret izleme v2
SÖZLEŞME: yok — yeni endpoint eklenmiyor, mevcut `POST /customer/messages` (customer.ts) yanıt şekli değişmiyor. Re-bundle gerekmez.
MIGRATION: yok (13.3-b'de yapıldı)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 74.5. 13.3-e [SONNET-XHIGH] /reports/overview "Achieved goals" sayacı (pencere + önceki pencere karşılaştırması)

**Status:** done  
**Dependencies:** 74.2, 74.4  

(1) `apps/api/src/routes/reports.ts`'e `achievedGoalCount(tx, licenseId, from, to)` yardımcısı (mevcut `ticketCount` deseni — `goal_achievements` üzerinde `license_id` + `achieved_at` aralığı sayımı). (2) `/reports/overview` `withTenant` bloğunda **sıralı** iki çağrı (pencere + önceki pencere) — Promise.all YOK (reports.ts:521-523 yorumu: Prisma interactive transaction'da eşzamanlı sorgu yasak). (

**Details:**

13.3-e — /reports/overview "Achieved goals" sayacı (pencere + önceki pencere karşılaştırması)  [SONNET-XHIGH]

PRD: FR-MOD-13.3 (+ NFR-P2 rapor gecikmesi)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 4 dosya + testleri. (2) Güvenlik sınırı yok — MEVCUT `reports_read` kapılı endpoint'e katkısal alan; yeni yetki yüzeyi, yeni scope, yeni route yok. (3) Eşzamanlılık akıl yürütmesi yok — 'sıralı çağır, Promise.all kullanma' kuralı reports.ts:521-523 yorumunda yazılı ve mekanik. (4) Kopyalanacak desen ismen var: reports.ts `ticketCount`/`windowTotals` + reports-metrics.ts `resolutionRate`. (5) Kontrat katkısal (ReportsOverview'a iki alan). (6) KK mekanik doğrulanabilir (sayı eşitliği).
NEDEN AÇIK: `grep -i "achieved\|conversion" apps/api/src/routes/reports*.ts` 0 sonuç. `GET /reports/overview` (reports.ts:510) `totals` ve `previous_period` bloklarında goal ile ilgili hiçbir alan yok; tek 'conversion' kullanımı Campaigns özelliğinde ve Goals'la ilişkisiz.
KAPSAM: (1) `apps/api/src/routes/reports.ts`'e `achievedGoalCount(tx, licenseId, from, to)` yardımcısı (mevcut `ticketCount` deseni — `goal_achievements` üzerinde `license_id` + `achieved_at` aralığı sayımı). (2) `/reports/overview` `withTenant` bloğunda **sıralı** iki çağrı (pencere + önceki pencere) — Promise.all YOK (reports.ts:521-523 yorumu: Prisma interactive transaction'da eşzamanlı sorgu yasak). (3) Yanıta `totals.achieved_goals` ve `previous_period.achieved_goals`. (4) `reports-metrics.ts`'e `goalConversionRate(conversions, chats)` saf fonksiyonu — `resolutionRate` deseni, payda 0 iken **null** döner (0 değil). (5) `openapi.yaml` ReportsOverview şemasına iki katkısal alan + re-bundle.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/src/routes/reports-metrics.ts · apps/api/src/routes/reports-metrics.test.ts · packages/contract/openapi/openapi.yaml · apps/api/test/integration/reports.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts (ticketCount + windowTotals + satisfactionCounts; satır 521-580 sıralı sorgu bloğu ve previous_period kalıbı) · apps/api/src/routes/reports-metrics.ts (round + resolutionRate — 'null when empty' kuralı)
KK (birebir): "rapor entegrasyonu"
KK DOĞRULAMA: integration `reports.test.ts`: (a) 2 achievement yazıldıktan sonra `/reports/overview` → `totals.achieved_goals === 2` ("rapor entegrasyonu" kanıtı); (b) pencere dışına yazılan achievement sayıya girmez, `previous_period.achieved_goals`'a düşer; (c) **cross-tenant:** B lisansının achievement'ı A'nın sayısına girmez. unit `reports-metrics.test.ts`: `goalConversionRate(0, 0) === null`.
KAPSAM DIŞI: hedef bazında kırılım ve huni denominatörleri (13.3-f) · CSV export ve rapor grubu (13.3-f) · UI KPI kartı (13.3-h) · Tracked sales / e-ticaret geliri (13.5 — `ecommerce.configured=false` iskeleti 07.8'de zaten var)
SÖZLEŞME: `openapi.yaml` `ReportsOverview` şemasına `totals.achieved_goals` (integer) ve `previous_period.achieved_goals` (integer) — KATKISAL, yeni path yok. Re-bundle + regen zorunlu (`pnpm --filter @siyahtus/contract generate`).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 74.6. 13.3-f [OPUS-XHIGH] GET /reports/goals — 3 aşamalı huni raporu + rapor grubu + CSV export

**Status:** done  
**Dependencies:** 74.2, 74.3, 74.4  

(1) Kontrat: `packages/contract/openapi/paths/reports.yaml`'a `goals` operasyonu (`getReportsGoals`, from/to query) + `openapi.yaml` `paths:` `/reports/goals` + re-bundle. (2) Route (reports.ts): pencere içi **sıralı** sorgular — `visitors` = pencerede ziyareti olan distinct `visits.customer_id` (tenant), `chats` = pencerede açılan distinct thread'in müşterisi, `by_goal[] = { goal_id, name, conver

**Details:**

13.3-f — GET /reports/goals — 3 aşamalı huni raporu + rapor grubu + CSV export  [OPUS-XHIGH]

PRD: FR-MOD-13.3 (+ NFR-P2, NFR-S3 izin bazlı görünürlük)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni YETKİLİ endpoint (mevcut `reports_read` scope'unu yeni bir yüzeye genişletir) → kullanıcı kuralı gereği en az OPUS-XHIGH, koşul 2 ihlali. Ayrıca huninin denominatör tasarımı (ziyaretçi/sohbet aşamalarının hangi kümeden sayılacağı) PRD'de yazmıyor, yorum gerektiriyor → koşul 6 de tam sağlanmıyor. Güvenlik/algoritma çekirdeği veya eşzamanlılık yok → OPUS-MAX değil.
NEDEN AÇIK: 3 aşamalı huniyi (ziyaretçi→sohbet→dönüşüm) hedef bazında veren hiçbir endpoint yok. `REPORT_GROUPS` (apps/api/src/routes/reports-export.ts:39-43) yalnız overview/breakdown/ai-agent/reviews taşıyor — goals grubu yok, dolayısıyla CSV export'ta da yok.
KAPSAM: (1) Kontrat: `packages/contract/openapi/paths/reports.yaml`'a `goals` operasyonu (`getReportsGoals`, from/to query) + `openapi.yaml` `paths:` `/reports/goals` + re-bundle. (2) Route (reports.ts): pencere içi **sıralı** sorgular — `visitors` = pencerede ziyareti olan distinct `visits.customer_id` (tenant), `chats` = pencerede açılan distinct thread'in müşterisi, `by_goal[] = { goal_id, name, conversions }` = `goal_achievements` gruplaması; `conversion_rate` = `goalConversionRate` (13.3-e'den) ile; `previous_period` bloğu overview kalıbıyla. (3) `REPORT_GROUPS`'a `{ id: 'goals', label: 'Goals', scopes: ['reports_read'] }` + `/reports/export?group=goals` için CSV satır serileştirici (mevcut `toCsv` + injection guard kullanılır).
DOSYALAR: packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports-export.test.ts · apps/api/test/integration/reports.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts:510-600 (GET /reports/overview — pencere + önceki pencere sıralı agregasyon kalıbı) · apps/api/src/routes/reports-export.ts:39-68 (REPORT_GROUPS katalogu + visibleReportGroups + toCsv) · packages/contract/openapi/paths/reports.yaml (`overview` / `reviews` operasyon kalıbı)
KK (birebir): "3 aşamalı huni" | "rapor entegrasyonu"
KK DOĞRULAMA: integration: (a) yanıt `funnel.visitors >= funnel.chats >= toplam conversions` invariantını sağlar → "3 aşamalı huni"; (b) `by_goal` yalnız çağıranın lisansındaki hedefleri listeler — **cross-tenant:** B lisansının hedefi A'nın yanıtında yok; (c) `GET /reports/groups` `goals` grubunu içerir ve `reports_read` taşımayan token'da içermez (`visibleReportGroups`); (d) `GET /reports/export?group=goals` CSV döner; (e) contract-parity yeşil (path + route aynı pencerede).
KAPSAM DIŞI: Tracked sales / atfedilen gelir (13.5 v2 — 07.8'de `ecommerce.configured=false` iskeleti duruyor) · PDF ve benchmark karşılaştırma (v2, PLAN §4.4.8'de v1 dışı işaretli) · hedef bazında ziyaretçi denominatörü (tenant geneli seçildi — bkz. §varsayımlar-4, §açık sorular-4) · UI (13.3-h)
SÖZLEŞME: YENİ PATH: `paths/reports.yaml`'a `goals` operasyonu (`getReportsGoals`) + `openapi.yaml` `paths:` `/reports/goals`; ayrıca `/reports/export` `group` enum'una `goals` (katkısal). **OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts kırılır.**
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 74.7. 13.3-g [SONNET-XHIGH] Goals ekranı — liste + Create goal formu (Customers alanının 4. sekmesi)

**Status:** done  
**Dependencies:** 74.3  

(1) `apps/web/src/App.tsx`'e `customers/goals` route (satır 86'daki `customers/campaigns` girişinin yanına) + `CustomersTabs.tsx` TABS dizisine `{ to: '/app/customers/goals', label: 'Goals' }`. (2) Saf `goals.ts` — `GOAL_TABS`, `filterGoals(goals, 'all'|'active'|'inactive')`, `goalCounts` (campaigns.ts:14-48 deseni birebir). (3) `GoalsPage.tsx` — liste + `ListSkeleton` + anlamlı `EmptyState` (boş 

**Details:**

13.3-g — Goals ekranı — liste + Create goal formu (Customers alanının 4. sekmesi)  [SONNET-XHIGH]

PRD: FR-MOD-13.3 (+ FR-EK-A.1 form validasyon primitifi, FR-EK-B.1 skeleton/empty state, NFR-A11Y4)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 5 dosya + testleri. (2) Güvenlik sınırı YOK — yetki API tarafında 13.3-c'de zorlanıyor; UI yalnız `scopes.includes('customers:rw')` ile kontrolleri gizler (CampaignsPage.tsx:44 deseninin aynısı), gizlemek karar değil kozmetik. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: CampaignsPage.tsx + CampaignBuilder.tsx + CustomersTabs.tsx. (5) Kontrat değişikliği yok. (6) KK mekanik (sekme doğru alt kümeyi gösterir, geçersiz form submit pasif).
NEDEN AÇIK: `grep -rln -i goal apps/web/src` 0 sonuç — Goals ekranı ve 'Create goal' formu yok. `apps/web/src/features/customers/CustomersTabs.tsx` yalnız Contacts / Real-time / Campaigns sekmelerini taşıyor (TABS dizisi).
KAPSAM: (1) `apps/web/src/App.tsx`'e `customers/goals` route (satır 86'daki `customers/campaigns` girişinin yanına) + `CustomersTabs.tsx` TABS dizisine `{ to: '/app/customers/goals', label: 'Goals' }`. (2) Saf `goals.ts` — `GOAL_TABS`, `filterGoals(goals, 'all'|'active'|'inactive')`, `goalCounts` (campaigns.ts:14-48 deseni birebir). (3) `GoalsPage.tsx` — liste + `ListSkeleton` + anlamlı `EmptyState` (boş dikdörtgen yok, EK-B.1) + active toggle (`PATCH /goals/{id}`) + `customers:rw` yoksa yazma kontrolleri gizli. (4) `GoalBuilder.tsx` — 'Create goal' modalı: isim zorunlu, `definition.url_contains`; alan-altı hata + geçersizken submit pasif (EK-A.1 primitifi, CampaignBuilder.tsx deseni).
DOSYALAR: apps/web/src/features/goals/GoalsPage.tsx · apps/web/src/features/goals/GoalBuilder.tsx · apps/web/src/features/goals/goals.ts · apps/web/src/features/goals/goals.test.ts · apps/web/src/features/goals/GoalsPage.test.tsx · apps/web/src/features/customers/CustomersTabs.tsx · apps/web/src/App.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/campaigns/CampaignsPage.tsx (liste + sekme + skeleton + EmptyState + canWrite gizleme + toggle mutation) · apps/web/src/features/campaigns/CampaignBuilder.tsx (modal form + alan-altı hata + submit pasif) · apps/web/src/features/campaigns/campaigns.ts (saf filterCampaigns / campaignCounts / isCampaignActive) · apps/web/src/features/customers/CustomersTabs.tsx (NavLink sekme kalıbı) · apps/web/src/App.tsx:86 (route kaydı)
KK (birebir): "hedef tanımı"
KK DOĞRULAMA: unit `goals.test.ts`: her sekme doğru alt kümeyi döndürür; `goalCounts` sayıları tutar. unit `GoalsPage.test.tsx`: (a) 'Create goal' → isim boşken submit pasif + alan-altı hata ("hedef tanımı" oluşturma kapısı); (b) `customers:ro` scope'unda 'New goal' / toggle butonları render edilmez; (c) boş liste → anlamlı empty state metni (boş dikdörtgen değil).
KAPSAM DIŞI: huni gösterimi ve Reports KPI kartı (13.3-h) · hedef silme (DELETE yok — `active=false`) · Engage adında ayrı bir üst alan açmak (bkz. §varsayımlar-5) · E2E (13.3-i)
SÖZLEŞME: yok (mevcut `/goals` endpoint'leri tüketilir)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 74.8. 13.3-h [SONNET-XHIGH] 3 aşamalı huni gösterimi (Goals ekranı) + Reports Overview "Achieved goals" KPI kartı

**Status:** done  
**Dependencies:** 74.5, 74.6, 74.7  

(1) `GoalsFunnel.tsx` — `/reports/goals`'tan gelen 3 aşamalı huni (Visitors → Chats → Conversions) stat kartları + `%` dönüşüm oranı; veri yoksa anlamlı empty state ("Henüz dönüşüm yok"), 0'a bölme yok (`conversionRate` deseni: payda 0 → 0/—). (2) `goals.ts`'e saf `funnelStages(funnel)` yardımcısı (etiket + değer + oran üçlüsü — test edilebilir saf fonksiyon). (3) `ReportsPage.tsx` OverviewTab Vol

**Details:**

13.3-h — 3 aşamalı huni gösterimi (Goals ekranı) + Reports Overview "Achieved goals" KPI kartı  [SONNET-XHIGH]

PRD: FR-MOD-13.3 (+ FR-EK-B.1 empty state, NFR-A11Y4)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 4 dosya + testleri. (2) Güvenlik sınırı yok — salt-okunur rapor gösterimi. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: CampaignsPage.tsx:248-271 (`Stat` + 3'lü dl grid) ve campaigns.ts:66 (`conversionRate`), ReportsPage.tsx OverviewTab `Kpi`/`CountDelta`/`Section` bileşenleri. (5) Kontrat değişikliği yok. (6) KK mekanik (sayı/etiket render iddiası).
NEDEN AÇIK: `grep -rln -i goal apps/web/src` 0 sonuç — huni gösterimi yok. `apps/web/src/features/reports/ReportsPage.tsx` OverviewTab'ında Volume/Resolution/Chats bölümleri var, goal ile ilgili hiçbir kart yok.
KAPSAM: (1) `GoalsFunnel.tsx` — `/reports/goals`'tan gelen 3 aşamalı huni (Visitors → Chats → Conversions) stat kartları + `%` dönüşüm oranı; veri yoksa anlamlı empty state ("Henüz dönüşüm yok"), 0'a bölme yok (`conversionRate` deseni: payda 0 → 0/—). (2) `goals.ts`'e saf `funnelStages(funnel)` yardımcısı (etiket + değer + oran üçlüsü — test edilebilir saf fonksiyon). (3) `ReportsPage.tsx` OverviewTab Volume bölümüne `Achieved goals` Kpi kartı + `CountDelta current={totals.achieved_goals} previous={prev.achieved_goals}`.
DOSYALAR: apps/web/src/features/goals/GoalsFunnel.tsx · apps/web/src/features/goals/goals.ts · apps/web/src/features/goals/GoalsFunnel.test.tsx · apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/campaigns/CampaignsPage.tsx:248-271 (Stat bileşeni + 3 sütunlu dl grid — Displayed/Chats/Conversion) · apps/web/src/features/campaigns/campaigns.ts:61-69 (conversionRate saf fonksiyonu, payda 0 koruması) · apps/web/src/features/reports/ReportsPage.tsx:266-295 (Section + KpiGrid + Kpi + CountDelta)
KK (birebir): "3 aşamalı huni" | "rapor entegrasyonu"
KK DOĞRULAMA: unit `GoalsFunnel.test.tsx`: üç aşama da (Visitors/Chats/Conversions) etiketi ve sayısıyla render edilir → "3 aşamalı huni"; ziyaretçi 0 iken oran `—` (NaN/Infinity yok); veri yokken empty state. unit `ReportsPage.test.tsx`: Overview'da 'Achieved goals' kartı sayıyı ve önceki döneme göre deltayı gösterir → "rapor entegrasyonu".
KAPSAM DIŞI: hedef oluşturma/düzenleme formu (13.3-g) · CSV export butonu (mevcut export akışı 07.7'de zaten var, grup 13.3-f'te eklendi) · Tracked sales kartı (13.5 v2) · E2E (13.3-i)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 74.9. 13.3-i [OPUS-XHIGH] Uçtan uca doğrulama — ziyaret→sohbet→hedef E2E + çapraz-tenant regresyon kapanışı

**Status:** done  
**Dependencies:** 74.4, 74.5, 74.6, 74.7, 74.8  

(1) `apps/e2e/tests/goals.spec.ts`: owner ile Goals sekmesine git → 'New goal' (isim + url_contains) → kaydet; widget'tan hedef sayfasında mesaj gönder (widget.spec.ts kalıbı) → Goals ekranında huninin Conversions değeri 1 olur; Reports → Overview'da 'Achieved goals' 1 gösterir. (2) Tekrarlı tetikte sayının 1'de kalması (idempotency uçtan uca). (3) Tam DoD kapısı koşumu: typecheck + lint + unit + 

**Details:**

13.3-i — Uçtan uca doğrulama — ziyaret→sohbet→hedef E2E + çapraz-tenant regresyon kapanışı  [OPUS-XHIGH]

PRD: FR-MOD-13.3 (+ NFR-S4/S5 çapraz-tenant, NFR-A11Y4)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama — widget (ziyaretçi yazma yolu) + API (achievement) + web (Goals ekranı) + Reports aynı senaryoda doğrulanıyor; hangi katmanın kırıldığını teşhis etmek yorum gerektiriyor. Ayrıca e2e temiz-DB gereksinimi (truncate+reseed, sourced .env, serbest portlar) ve DB süitlerinin serial koşumu mekanik değil (bellek: siyahtus-e2e-clean-db, siyahtus-test-gate-parallel-db). Güvenlik çekirdeği/eşzamanlılık tasarımı yok → OPUS-MAX değil; 'dosyalar+referans_desen' verilebilse de belirsizlik nedeniyle SONNET yapılmadı.
NEDEN AÇIK: `apps/e2e/tests/` altında 20 spec var, goals yok — huninin uçtan uca (ziyaretçi→sohbet→dönüşüm) çalıştığını kanıtlayan tek bir akış testi mevcut değil. 13.3-a…-h'nin her biri kendi katmanını test ediyor; katmanların birbirine bağlandığı tek kanıt bu spec.
KAPSAM: (1) `apps/e2e/tests/goals.spec.ts`: owner ile Goals sekmesine git → 'New goal' (isim + url_contains) → kaydet; widget'tan hedef sayfasında mesaj gönder (widget.spec.ts kalıbı) → Goals ekranında huninin Conversions değeri 1 olur; Reports → Overview'da 'Achieved goals' 1 gösterir. (2) Tekrarlı tetikte sayının 1'de kalması (idempotency uçtan uca). (3) Tam DoD kapısı koşumu: typecheck + lint + unit + integration + build + e2e; DB süitleri paket bazında SERIAL (paylaşılan Postgres yarışı), e2e öncesi truncate+reseed. (4) Kalan çapraz-tenant iddialarının (13.3-c/-d/-e/-f) toplu yeşil olduğunun kanıtlanması ve HANDOFF'a kanıt satırı.
DOSYALAR: apps/e2e/tests/goals.spec.ts · apps/e2e/tests/fixtures.ts
REFERANS DESEN (kopyalanacak): apps/e2e/tests/campaigns.spec.ts (kampanya oluştur → performans sayısını doğrula akışı) · apps/e2e/tests/widget.spec.ts (widget'tan ziyaretçi mesajı gönderme) · apps/e2e/tests/reports.spec.ts (Reports sekmesi + KPI doğrulama)
KK (birebir): "3 aşamalı huni" | "hedef tanımı" | "rapor entegrasyonu"
KK DOĞRULAMA: E2E `goals.spec.ts` tek akışta üç KK'yı da kanıtlar: hedef oluşturulur ("hedef tanımı"), ziyaretçi→sohbet→dönüşüm sayıları huni kartlarında görünür ("3 aşamalı huni"), Reports Overview 'Achieved goals' aynı sayıyı gösterir ("rapor entegrasyonu"). Ayrıca ikinci kez tetiklendiğinde sayı artmaz.
KAPSAM DIŞI: yeni ürün davranışı eklemek — bu alt-görev yalnız doğrular · performans/yük ölçümü (NFR-P4 sanal liste kapsamı değil) · RTM `new_goal` bildirimi
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
