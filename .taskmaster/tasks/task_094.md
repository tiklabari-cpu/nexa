# Task ID: 94

**Title:** 07.9 — Zamanlanmış (scheduled) rapor export  ·  dilim V2-4

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** Faz 2 (v2) · PLAN §5.2 · 10 atomik alt-görev. Bu turda kapsam süpürmesinde bulundu (PLAN §D62).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `07.9-sched`.

10 atomik alt-görev · ~12 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x5 · SONNET-MAX x1 · SONNET-XHIGH x3

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  07.9-sched-a [OPUS-XHIGH] Şema + migration: scheduled_reports / scheduled_report_runs (RLS + dönem tekilleştirme kısıtı)  (bağ: yok)
  07.9-sched-b [OPUS-XHIGH] `reports_manage` scope + kontrat/route: zamanlanmış export listeleme ve oluşturma  (bağ: 07.9-sched-a)
  07.9-sched-c [OPUS-XHIGH] Kontrat/route: tek kayıt okuma + güncelleme + iptal (GET/PATCH/DELETE)  (bağ: 07.9-sched-b)
  07.9-sched-d1 [SONNET-XHIGH] Rapor teslim e-postası: Mailer `kind` genişletme + saf konu/gövde biçimlendirici  (bağ: yok)
  07.9-sched-d2 [SONNET-MAX] Rapor CSV üretimini paylaşılan `services/reports/report-csv.ts` modülüne çıkar  (bağ: yok)
  07.9-sched-e [OPUS-MAX] Zamanlayıcı çekirdeği: dönem hesabı + tek-teslim claim (idempotens) + tenant-scoped sweep  (bağ: 07.9-sched-a, 07.9-sched-b, 07.9-sched-d1, 07.9-sched-d2)
  07.9-sched-f [SONNET-XHIGH] `scheduled-reports:run` operatör betiği + npm script (dry-run varsayılanı)  (bağ: 07.9-sched-e)
  07.9-sched-g [OPUS-XHIGH] Teslim geçmişi okuması: kontrat + `GET /reports/scheduled-exports/{id}/runs`  (bağ: 07.9-sched-c, 07.9-sched-e)
  07.9-sched-h [SONNET-XHIGH] Settings UI: "Scheduled exports" bölümü (liste + oluştur + iptal + son çalışma durumu)  (bağ: 07.9-sched-c, 07.9-sched-g)
  07.9-sched-i [OPUS-XHIGH] Uçtan uca doğrulama: cross-tenant zinciri + tekrar-tetik idempotens regresyonu + e2e  (bağ: 07.9-sched-c, 07.9-sched-e, 07.9-sched-f, 07.9-sched-g, 07.9-sched-h)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): Tek bölünmez çekirdek `07.9-sched-e` (zamanlayıcı çekirdeği). "Bir dönem için en fazla bir teslim" garantisi üç şeyin AYNI ANDA doğru olmasına bağlıdır: (1) dönem anahtarının (period_key) sıklıktan deterministik türetilmesi, (2) `scheduled_report_runs` üzerindeki `@@unique([scheduledReportId, periodKey])` kısıtına dayalı transactional claim — çakışma "başkası aldı" demektir, hata değil, (3) claim ile e-posta gönderiminin sırası (önce claim, sonra gönder; gönderim hatası satırı `failed` bırakır ama dönemi serbest bırakmaz). Bu üçü ayrı pencerelere bölünürse "iki e-posta gitmesin" akıl yürütmesi bağlamıyla birlikte kaybolur — claim'i yazan pencere gönderim sırasını görmez, gönderimi yazan pencere claim'in yarış semantiğini görmez. Çekirdeğin ETRAFINDAKİ her şey ayrı ve daha ucuz etiketlere çıkarıldı: şema/migration (-a), CRUD yüzeyi (-b/-c), CSV üretimi (-d2), e-posta biçimi (-d1), CLI koşum betiği (-f), teslim geçmişi okuması (-g), UI (-h), uçtan uca doğrulama (-i). Böylece OPUS-MAX penceresi yalnız yarış/idempotens mantığını taşır.

VARSAYIMLAR: Zamanlama motoru: bu depoda production scheduler YOK (proje sınırı). Zamanlanmış export, `retention:run` ve `chat-timeout:run` ile aynı 'operatör / host-cron tetikler' desenini izler → yeni `scheduled-reports:run` betiği. v2-02 §625'in önerdiği BullMQ cron KULLANILMAZ: ADR-11 Kafka/RabbitMQ yasağının ruhu + depoda kuyruk altyapısı yok (chat-timeout-run.ts NO_REDIS stub'ı ile çalışıyor). · Format yalnız CSV. PDF karara bağlanmamıştı; `apps/api/src/routes/reports-export.ts` başlık yorumu 'PDF and benchmark comparison are explicitly out of scope for v1' diyor ve depoda PDF üretici yok → zamanlanmış export da CSV ile sınırlı, PDF kapsam dışı. · Teslim kanalı: `FileMailer` mock (`.data/mail`), gerçek SMTP yok (MASTER-PROMPT §5 / PLAN §9). Teslim 'gönderildi' kabulü = posta kutusuna dosya düşmesi. · Yeni yazma scope'u `reports_manage` eklenir ve YALNIZ `ADMIN_SCOPES`'a verilir (principal.ts). Gerekçe: `AGENT_SCOPES` içinde `reports_read` bile yok — ajan raporu okumuyorsa zamanlanmış export tanımlayamaz. Owner/admin işi. · Sıklık kümesi: `daily | weekly | monthly`. PRD sıklık listelemiyor → türetilmiş. Gün sınırı UTC (ADR-12 tek bölge eu; depodaki tüm rapor sorguları zaten UTC gün ile gruplanıyor — reports.ts `SPLIT_COUNTS`). · Rapor penceresi: her çalışmada 'önceki TAM dönem' (daily → dün 00:00–24:00 UTC). Kısmi dönem hiç gönderilmez; böylece aynı period_key için içerik deterministiktir ve tekrar çalıştırma aynı CSV'yi üretir. · Alıcılar yalnız aynı workspace'in kayıtlı ajan e-postalarıdır; serbest metin dış adres kabul edilmez. Gerekçe: düzenli CSV teslimi PII dışa taşıma yüzeyidir (NFR-S9) ve serbest alıcı alanı, yetkili bir kullanıcı için kalıcı bir sızdırma kanalı olur. · Idempotens anahtarı `(scheduled_report_id, period_key)` unique — `CampaignSend.@@unique([campaignId, customerId])` (schema.prisma:806) deseninin birebir eşdeğeri. · `scheduled_reports` / `scheduled_report_runs` PRD §8.4 veri modelinde YOK → SiyahTuş eklentisi (tickets/channels scope'larında olduğu gibi g

AÇIK SORULAR (ürün kararı): Alıcı kümesi gerçekten workspace-içi ajan e-postalarıyla sınırlansın mı, yoksa doğrulanmış dış adres (ör. muhasebe/yönetim) de olsun mu? Varsayım #7 dar tarafı seçti; geniş taraf seçilirse -b'nin güvenlik yüzeyi büyür ve alıcı doğrulama/onay akışı ayrı bir alt-göreve çıkar. · `reports_manage` yeni bir scope olarak mı eklensin, yoksa mevcut bir yönetim scope'u (`billing_manage` veya `properties.configuration:rw`) mı yeniden kullanılsın? Yeni scope `packages/types/src/scopes.ts` + `scopes.test.ts`'teki `SIYAHTUS_ADDED_SCOPES` listesine + `principal.ts` `ADMIN_SCOPES`'a dokunur. (Doğrulandı: `packages/contract/openapi/openapi.yaml` içinde scope enum'ı YOK — scope eklemek kontratı kırmaz; o tuzak yalnız ERROR_TYPES için geçerlidir.) · Kalıcı teslim hatasında retry beklenir mi? Webhook tarafında NFR-M5 gereği 3× retry + her deneme log satırı var (`webhook-dispatcher.ts`). Zamanlanmış export için varsayım #11 retry'ı v1 dışı bıraktı; istenirse -e'nin çekirdeğine değil, ayrı bir alt-göreve eklenmeli (claim semantiği değişir: `failed` satırı yeniden denenebilir olmalı). · Sıklık için saat/gün seçimi gerekiyor mu (ör. 'her Pazartesi 09:00')? Şu an tüm dönem hesabı UTC gün sınırında; tenant saat dilimi alanı depoda yok. Gerekiyorsa `scheduled_reports`'a timezone kolonu ve dönem hesabına DST akıl yürütmesi girer — bu -e'nin çekirdeğini büyütür. · PRD §5.3-Reports satırındaki 'zamanlanmış export', aynı satırdaki Chat topics ve Team performance raporlarını da kapsıyor mu? Bu kırılım yalnız me

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 94.1. 07.9-sched-a [OPUS-XHIGH] Şema + migration: scheduled_reports / scheduled_report_runs (RLS + dönem tekilleştirme kısıtı)

**Status:** done  
**Dependencies:** None  

Contract-first sıranın veri katmanı adımı — kod yolu (route/servis/job) BU alt-görevde yok. İki Prisma modeli: (1) `ScheduledReport` — `licenseId`, `groupId` (REPORT_GROUPS id'si), `frequency` (daily|weekly|monthly), `format` ('csv'), `recipients String[]`, `enabled Boolean @default(true)`, `createdByAgentId`, `createdAt`, `lastRunAt DateTime?`; `@@index([licenseId, enabled])`. (2) `ScheduledRepor

**Details:**

07.9-sched-a — Şema + migration: scheduled_reports / scheduled_report_runs (RLS + dönem tekilleştirme kısıtı)  [OPUS-XHIGH]

PRD: §5.3-Reports (FR-MOD-07.7 uzantısı) + NFR-C8 + NFR-S9
ETİKET GEREKÇESİ: OPUS-XHIGH: koşul 2 ihlali — yeni tablolara RLS politikası + GRANT yazmak tenant izolasyon sınırıdır, SONNET olamaz. Ancak bölünmez güvenlik çekirdeği DEĞİL: politika `20260726180000_ticket_rules/migration.sql` içinden birebir kopyalanabilir (`license_id = siyahtus_current_license()` USING+WITH CHECK + `GRANT ... TO siyahtus_app`) ve unique kısıt CampaignSend'den kopyalanır → xhigh yeterli.
NEDEN AÇIK: `grep -c -i scheduled apps/api/prisma/schema.prisma` = **0**. Zamanlanmış rapor tanımı (sıklık, alıcı, grup, format) için hiçbir model yok; teslim geçmişi için de yok. En yakın şablonlar depoda hazır: `CampaignSend` (schema.prisma:789, `@@unique([campaignId, customerId])` satır 806) ve `WebhookDelivery` (schema.prisma:1104, her deneme bir satır + `permanent` bayrağı).
KAPSAM: Contract-first sıranın veri katmanı adımı — kod yolu (route/servis/job) BU alt-görevde yok. İki Prisma modeli: (1) `ScheduledReport` — `licenseId`, `groupId` (REPORT_GROUPS id'si), `frequency` (daily|weekly|monthly), `format` ('csv'), `recipients String[]`, `enabled Boolean @default(true)`, `createdByAgentId`, `createdAt`, `lastRunAt DateTime?`; `@@index([licenseId, enabled])`. (2) `ScheduledReportRun` — `licenseId`, `scheduledReportId`, `periodKey String` (deterministik dönem etiketi: `2026-07-31` / `2026-W31` / `2026-07`), `periodFrom`/`periodTo`, `status`, `recipientCount`, `rowCount`, `error String?`, `createdAt`; `@@unique([scheduledReportId, periodKey])` + `@@index([licenseId, scheduledReportId, createdAt])`. Migration SQL: `prisma migrate diff` çıktısı + EL YAZIMI RLS bloğu (Prisma görmez) — her iki tabloya `ENABLE ROW LEVEL SECURITY`, `license_id = siyahtus_current_license()` politikası, `GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_reports TO siyahtus_app`, runs için `GRANT SELECT, INSERT, UPDATE` (bir çalışma silinmez). FK'ler `onDelete: Cascade`.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/20260801090000_scheduled_reports/migration.sql · apps/api/test/integration/data-model.test.ts · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260726180000_ticket_rules/migration.sql · apps/api/prisma/schema.prisma (CampaignSend, satır 789-809 — @@unique tekilleştirme) · apps/api/prisma/schema.prisma (WebhookDelivery, satır 1104-1121 — teslim log satırı) · apps/api/prisma/schema.prisma (TicketRule, satır 505-519 — license-scoped konfigürasyon modeli)
KK (birebir): "KK-türetilmiş: "Zamanlanmış export tanımı ve her çalışması lisansa bağlıdır; bir lisansın tanımı/çalışma kaydı başka lisanstan ne okunabilir ne yazılabilir." — Türetme gerekçesi: PRD §5.3 satırı (satır 409) yalnız 'zamanlanmış export' ifadesini içeriyor, §6 FR-MOD tablosunda karşılık gelen satır ve Kabul Kriteri sütunu YOK (kk_yetersiz=true). İzolasyon kriteri depodaki her tenant tablosunun (ticket_rules, campaigns, webhooks) taşıdığı sabit kuraldan türetildi." | "KK-türetilmiş: "Aynı zamanlanmış export tanımı + aynı dönem için ikinci bir çalışma kaydı veritabanı düzeyinde reddedilir." — Türetme gerekçesi: PRD idempotens demiyor; kriter, orkestratörün bağlayıcı kapsam kararındaki 'Tekrarlanan iş + e-posta = eşzamanlılık dokunuşu, idempotenslik şart' ifadesinden ve CampaignSend'in mevcut tekilleştirme deseninden türetildi."
KK DOĞRULAMA: `data-model.test.ts` — iki tablo mevcut, `relrowsecurity` true, beklenen kolon/kısıt seti doğru (bu dosya zaten şema envanterini böyle doğruluyor). Tekilleştirme: aynı `(scheduledReportId, periodKey)` ile ikinci `create` unique ihlali fırlatır. `tenant-isolation.test.ts` — B lisansı bağlamında A'nın satırı `findMany` ile 0 döner; A'nın id'sine `update`/`delete` 0 satır etkiler (RLS).
KAPSAM DIŞI: OpenAPI kontratı ve route (-b/-c) · Zamanlayıcı/job mantığı, due hesabı, claim (-e) · CSV üretimi (-d2) ve e-posta biçimi (-d1) · UI (-h) · `report_aggregates` cache tablosu (v2-02 §625'te geçen ayrı fikir — bu kalemin parçası değil)
SÖZLEŞME: yok — bu alt-görev yalnız veri katmanı. Yeni route eklenmediği için `contract-parity.test.ts` etkilenmez.
MIGRATION: EVET. Yeni migration `20260801090000_scheduled_reports`: `scheduled_reports` + `scheduled_report_runs` tabloları, FK'ler (licenses / scheduled_reports, ON DELETE CASCADE), `UNIQUE (scheduled_report_id, period_key)`, her iki tabloda `ENABLE ROW LEVEL SECURITY` + `siyahtus_current_license()` politikası + `siyahtus_app` GRANT'leri (Prisma'nın görmediği el yazımı bölüm — ticket_rules migration'ının birebir aynı yapısı).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.2. 07.9-sched-b [OPUS-XHIGH] `reports_manage` scope + kontrat/route: zamanlanmış export listeleme ve oluşturma

**Status:** done  
**Dependencies:** 94.1  

Contract-first, TEK pencerede kontrat+backend (zorunlu: `contract-parity.test.ts` ÇİFT YÖNLÜ — 'sunulmayan dokümante route' da kırar, kontrat tek başına merge edilemez). (1) `scopes.ts`'e `reports_manage` eklenir, `scopes.test.ts`'teki `SIYAHTUS_ADDED_SCOPES` listesine gerekçeli yorumla eklenir (sayaç `SOURCE_SCOPE_COUNT(58) + SIYAHTUS_ADDED_SCOPES.length` olduğu için liste güncellenmezse test kırılır); `

**Details:**

07.9-sched-b — `reports_manage` scope + kontrat/route: zamanlanmış export listeleme ve oluşturma  [OPUS-XHIGH]

PRD: FR-MOD-07.7 (+ §5.3-Reports) + NFR-S9 + NFR-C8
ETİKET GEREKÇESİ: OPUS-XHIGH: kullanıcının açık kuralı — 'yeni bir yetkili endpoint eklemek, mevcut scope'u genişletmek EN AZ OPUS-XHIGH olur'. Burada İKİSİ birden var: SCOPES kataloğuna yeni bir yazma scope'u ekleniyor ve onunla kapılı yeni bir mutasyon endpoint'i açılıyor. Ayrıca alıcı doğrulama kararı (workspace-içi ajan e-postası sınırı) PII dışa taşıma yüzeyini belirliyor. Çekirdek eşzamanlılık/kripto sınırı yok → MAX değil.
NEDEN AÇIK: `packages/types/src/scopes.ts` içinde raporlarla ilgili tek scope `reports_read` — salt-okunur; zamanlanmış export TANIMLAMAK bir mutasyondur ve karşılığı yazma scope'u yok. `apps/api/src/services/auth/principal.ts`: `ADMIN_SCOPES` `reports_read` + `billing_manage` içeriyor, `AGENT_SCOPES` hiçbir rapor scope'u içermiyor. `packages/contract/openapi/paths/reports.yaml` içindeki bloklar yalnız overview(8)/breakdown(42)/aiAgent(72)/reviews(99)/groups(138)/export(160)/subscription(203)/usage(271)/invoices(301)/invoiceDownload(332)/paymentMethod(359) — zamanlanmış export için hiçbir path yok. `apps/api/src/routes/reports.ts` içindeki tüm `/reports/*` route'ları senkron GET (satır 510/664/725/763/811/822); arka plan işi tanımlayan hiçbir POST yok.
KAPSAM: Contract-first, TEK pencerede kontrat+backend (zorunlu: `contract-parity.test.ts` ÇİFT YÖNLÜ — 'sunulmayan dokümante route' da kırar, kontrat tek başına merge edilemez). (1) `scopes.ts`'e `reports_manage` eklenir, `scopes.test.ts`'teki `SIYAHTUS_ADDED_SCOPES` listesine gerekçeli yorumla eklenir (sayaç `SOURCE_SCOPE_COUNT(58) + SIYAHTUS_ADDED_SCOPES.length` olduğu için liste güncellenmezse test kırılır); `principal.ts`'te YALNIZ `ADMIN_SCOPES`'a verilir. (2) `reports.yaml`'a `scheduledExports` bloğu: `get` (liste) + `post` (oluştur); `openapi.yaml` components'e `ScheduledExport` şeması + `ScheduledExportFrequency` enum; `pnpm --filter @siyahtus/contract generate` ile re-bundle. (3) Yeni `routes/scheduled-reports.ts` + `services/reports/scheduled-report-service.ts`: tenant-scoped list/create; zod doğrulama — `group` mutlaka `reportGroup(id)` ile kataloğa karşı doğrulanır (bilinmeyen → 400), `frequency` enum, `format` yalnız 'csv', `recipients` boş olamaz ve HER alıcı aynı lisansın ajan e-postası olmalı (varsayım #7). Mevcut ERROR_TYPES yeterli — YENİ ApiError tipi YOK (aksi halde errors.ts ×2 + scopes.test.ts sayacı + openapi enum + regen zinciri açılırdı).
DOSYALAR: packages/types/src/scopes.ts · packages/types/src/scopes.test.ts · apps/api/src/services/auth/principal.ts · packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/scheduled-reports.ts · apps/api/src/services/reports/scheduled-report-service.ts · apps/api/test/integration/scheduled-reports.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/ticket-rules.ts (zod .strict() gövde şeması + scope'lu config + request.withTenant CRUD) · apps/api/src/services/tickets/ticket-rule-service.ts · packages/contract/openapi/paths/webhooks.yaml (liste + kayıt CRUD kontrat şekli) · apps/api/src/routes/reports-export.ts (reportGroup() katalog doğrulaması + EXPORT_SCOPES) · apps/api/test/integration/ticket-rules.test.ts
KK (birebir): "FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "İzin bazlı görünürlük" + "export"." | "KK-türetilmiş: "Zamanlanmış export tanımlamak yalnız `reports_manage` taşıyan owner/admin'in yapabileceği bir işlemdir; ajan token'ı 403 alır." — Türetme gerekçesi: PRD §5.3'te bu satırın Kabul Kriteri sütunu yok (kk_yetersiz); kriter FR-MOD-07.7'nin 'İzin bazlı görünürlük' ibaresi + depodaki mevcut kural (AGENT_SCOPES'ta hiçbir rapor scope'u yok) birleştirilerek türetildi." | "KK-türetilmiş: "Bilinmeyen rapor grubu, tanımsız sıklık, boş alıcı listesi veya workspace dışı bir alıcı e-postası ile tanım oluşturulamaz (400)." — Türetme gerekçesi: PRD zorunlu alan listesi vermiyor; kriter aynı ailedeki 08.6.2 KK'sı ('Koşul+eylem zorunlu') ve 08.7.5 KK'sı ('Geçersiz değişken/format engeli') zorunlu-alan mantığından ve varsayım #7'den türetildi."
KK DOĞRULAMA: `scheduled-reports.test.ts`: (i) `reports_manage` scope'suz token POST → 403 → 'İzin bazlı görünürlük' payı; (ii) admin POST 201 + GET listede görünür → 'export' payı; (iii) bilinmeyen `group` / `frequency` / boş `recipients` / dış alıcı → 400 (dört ayrı negatif) → türetilmiş doğrulama kriteri; (iv) B lisansı A'nın tanımını listede görmez. `scopes.test.ts` yeşil (sayaç + SIYAHTUS_ADDED_SCOPES). `contract-parity.test.ts` yeşil.
KAPSAM DIŞI: Tek kayıt okuma / güncelleme / silme (-c) · Zamanlayıcı, due hesabı, gerçek teslim (-e) · Teslim geçmişi okuması (-g) · UI (-h) · Serbest dış alıcı adresi desteği (açık soru #1 kapanana dek yok) · `GET /reports/export` senkron endpoint'inde değişiklik
SÖZLEŞME: EVET. `packages/contract/openapi/paths/reports.yaml` içine `scheduledExports` bloğu (`get` = listScheduledExports, `post` = createScheduledExport) + `openapi.yaml` components'e `ScheduledExport` ve `ScheduledExportFrequency`. UYARI: yeni route OpenAPI'ye eklenip `pnpm --filter @siyahtus/contract generate` ile re-bundle edilmezse `contract-parity.test.ts` KIRILIR — test ÇİFT YÖNLÜ olduğu için tersi de doğrudur (route'suz kontrat da kırar), ikisi aynı pencerede gitmeli. NOT (doğrulandı): `openapi.yaml` içinde scope enum'ı YOK, yeni scope kontratta enum güncellemesi gerektirmez.
MIGRATION: yok — tablolar -a'da oluşturuldu.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.3. 07.9-sched-c [OPUS-XHIGH] Kontrat/route: tek kayıt okuma + güncelleme + iptal (GET/PATCH/DELETE)

**Status:** done  
**Dependencies:** 94.2  

Kontrat+backend aynı pencerede (parity çift yönlü). `reports.yaml`'a `scheduledExport` bloğu: `scheduledExportId` path parametresi + `get` (`reports_read`), `patch` (`reports_manage`, en az bir alan zorunlu — `.refine` deseni), `delete` (`reports_manage`, 204). Servise `get`/`update`/`remove`; hepsi `request.withTenant` altında, id başka lisansa aitse `not_found` (403 değil — varlığı sızdırmaz, `t

**Details:**

07.9-sched-c — Kontrat/route: tek kayıt okuma + güncelleme + iptal (GET/PATCH/DELETE)  [OPUS-XHIGH]

PRD: FR-MOD-07.7 (+ §5.3-Reports)
ETİKET GEREKÇESİ: OPUS-XHIGH: kullanıcının kuralı gereği 'yeni bir yetkili endpoint eklemek' en az OPUS-XHIGH. PATCH alıcı listesini değiştirebildiği için -b'deki alıcı doğrulama kararı burada yeniden uygulanmak zorunda (aksi halde PATCH, create'in kapattığı sızdırma yolunu yeniden açar) — mekanik CRUD kopyasının ötesinde doğrulama akıl yürütmesi. Yeni scope/kripto/eşzamanlılık yok → MAX değil.
NEDEN AÇIK: -b yalnız liste + oluşturma yüzeyini açıyor; `packages/contract/openapi/paths/reports.yaml`'da id'li hiçbir zamanlanmış export path'i yok (mevcut bloklar satır 8/42/72/99/138/160/203/271/301/332/359). Tanımı iptal etmenin veya sıklığını/alıcısını değiştirmenin yolu olmadan kalem kullanılabilir değil.
KAPSAM: Kontrat+backend aynı pencerede (parity çift yönlü). `reports.yaml`'a `scheduledExport` bloğu: `scheduledExportId` path parametresi + `get` (`reports_read`), `patch` (`reports_manage`, en az bir alan zorunlu — `.refine` deseni), `delete` (`reports_manage`, 204). Servise `get`/`update`/`remove`; hepsi `request.withTenant` altında, id başka lisansa aitse `not_found` (403 değil — varlığı sızdırmaz, `ticket-rules.ts` deseni). PATCH gövdesi -b'deki AYNI zod parçalarını yeniden kullanır: değişen `recipients` yine workspace-içi ajan e-postası kontrolünden geçer, değişen `group` yine `reportGroup()` kataloğuna karşı doğrulanır. DELETE tanımı siler; `scheduled_report_runs` FK cascade ile birlikte gider (-a).
DOSYALAR: packages/contract/openapi/paths/reports.yaml · apps/api/src/routes/scheduled-reports.ts · apps/api/src/services/reports/scheduled-report-service.ts · apps/api/test/integration/scheduled-reports.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/ticket-rules.ts (updateBody .refine 'at least one field is required' + id'li PATCH/DELETE + 404 semantiği) · packages/contract/openapi/paths/webhooks.yaml (`webhook:` bloğu — path parametreli tek kayıt işlemleri) · apps/api/src/routes/ticket-email-templates.ts
KK (birebir): "FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "İzin bazlı görünürlük" (tek kayıt okuma/değiştirme de aynı izin kapısından geçer)." | "KK-türetilmiş: "Zamanlanmış export iptal edilebilir; iptal edilen tanım bir daha çalışmaz ve geçmiş kayıtlarıyla birlikte kaldırılır." — Türetme gerekçesi: PRD §5.3 satırı yaşam döngüsü tarif etmiyor; iptal kriteri orkestratörün kontrat yolları listesindeki 'DELETE /reports/scheduled-exports/{id} (iptal)' kararından türetildi." | "KK-türetilmiş: "Güncelleme, oluşturmayla aynı doğrulamadan geçer: geçersiz grup/sıklık ya da workspace dışı alıcı ile güncelleme reddedilir." — Türetme gerekçesi: PRD karşılığı yok; kriter -b'nin türetilmiş doğrulama kriterinin PATCH yüzeyine mantıksal uzantısı (aksi halde doğrulama tek yüzeyde kalır ve anlamsızlaşır)."
KK DOĞRULAMA: `scheduled-reports.test.ts`: (i) admin PATCH sıklık değiştirir → GET yeni değeri döner; (ii) PATCH ile workspace dışı alıcı → 400 (create ile aynı hata) → türetilmiş güncelleme kriteri; (iii) DELETE → 204, sonraki GET 404, run satırları da gitmiş → iptal kriteri; (iv) B lisansı A'nın id'sine GET/PATCH/DELETE → 404; (v) `reports_manage`'siz token PATCH/DELETE → 403 → 'İzin bazlı görünürlük'. `contract-parity.test.ts` yeşil.
KAPSAM DIŞI: Zamanlayıcı/teslim (-e) · Teslim geçmişi listesi endpoint'i (-g) · UI (-h) · Toplu (bulk) iptal / tanım kopyalama
SÖZLEŞME: EVET. `reports.yaml` içine `scheduledExport` bloğu (path param `scheduledExportId`; `get`/`patch`/`delete`). OpenAPI'ye eklenip re-bundle edilmezse `contract-parity.test.ts` kırılır; çift yönlü olduğu için route'suz kontrat da kırar — aynı pencerede gitmeli.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.4. 07.9-sched-d1 [SONNET-XHIGH] Rapor teslim e-postası: Mailer `kind` genişletme + saf konu/gövde biçimlendirici

**Status:** done  
**Dependencies:** None  

(1) `mailer.ts`'te `Message.kind` union'ına `'scheduled_report'` eklenir; ayrı kind olmasının nedeni yorumla belirtilir (posta kutusunda ve testte ayırt edilebilirlik — dosya adı `${stamp}-${kind}-...`). (2) Yeni saf modül `services/reports/scheduled-report-mail.ts`: `buildScheduledReportMail({ groupLabel, periodFrom, periodTo, csv, rowCount, filename })` → `{ subject, body }`. Konu: rapor grubu e

**Details:**

07.9-sched-d1 — Rapor teslim e-postası: Mailer `kind` genişletme + saf konu/gövde biçimlendirici  [SONNET-XHIGH]

PRD: §5.3-Reports (FR-MOD-07.7 uzantısı) + NFR-M4
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 kaynak dosya + 1 test; (2) güvenlik sınırı yok — authZ/izolasyon/kripto/PII maskeleme kararı içermiyor; alıcı doğrulaması -b/-c'de kapandı, burada yalnız zaten doğrulanmış alıcıya gidecek metin üretiliyor; (3) eşzamanlılık yok — saf fonksiyon; (4) kopyalanacak desen ismen var: `mailer.ts` Message arayüzü + `chat-service.ts:829` kind kullanımı; (5) union genişletme katkısal ve mekanik; (6) KK mekanik doğrulanabilir (posta kutusu dosya adı + konu/gövde alanları).
NEDEN AÇIK: `apps/api/src/services/mail/mailer.ts:21` — `Message.kind` union'ı tam olarak `'password_reset' | 'invitation' | 'notification'`; rapor teslimi için dördüncü değer yok. Mevcut dört tüketici doğrulandı (`routes/customer.ts:137`, `routes/account-lifecycle.ts:86`, `routes/account-lifecycle.ts:217`, `services/chat/chat-service.ts:829`) — hiçbiri union'ı exhaustive switch ile tüketmiyor, bu yüzden genişletme katkısal ve mevcut testleri kırmaz.
KAPSAM: (1) `mailer.ts`'te `Message.kind` union'ına `'scheduled_report'` eklenir; ayrı kind olmasının nedeni yorumla belirtilir (posta kutusunda ve testte ayırt edilebilirlik — dosya adı `${stamp}-${kind}-...`). (2) Yeni saf modül `services/reports/scheduled-report-mail.ts`: `buildScheduledReportMail({ groupLabel, periodFrom, periodTo, csv, rowCount, filename })` → `{ subject, body }`. Konu: rapor grubu etiketi + UTC dönem; gövde: dönem, satır sayısı, dosya adı ve CSV içeriği (FileMailer gövdeyi düz metin yazdığı için MIME ek kavramı yok — CSV gövdeye gömülür, mock teslimin dürüst şekli). Dosya adı mevcut `exportFilename()` ile üretilir. Prisma/DB/HTTP dokunuşu YOK — fonksiyon tamamen saf.
DOSYALAR: apps/api/src/services/mail/mailer.ts · apps/api/src/services/reports/scheduled-report-mail.ts · apps/api/src/services/reports/scheduled-report-mail.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/mail/mailer.ts (Message arayüzü + FileMailer.send dosya adı şeması) · apps/api/src/services/chat/chat-service.ts (satır ~829 — transkript e-postasının konu/gövde kurma biçimi) · apps/api/src/routes/reports-export.ts (`exportFilename()` — dosya adı üretimi) · apps/api/src/routes/reports-export.test.ts (saf fonksiyon test biçimi)
KK (birebir): "KK-türetilmiş: "Teslim edilen e-posta hangi rapor grubunun hangi UTC dönemine ait olduğunu ve kaç satır içerdiğini açıkça taşır; posta kutusunda rapor teslimi diğer e-posta türlerinden ayırt edilebilir." — Türetme gerekçesi: PRD §5.3'te bu satırın Kabul Kriteri sütunu yok (kk_yetersiz=true) ve §6'da karşılık gelen FR-MOD satırı yok. Kriter, teslimin gözlemlenebilir olması gereğinden (NFR-M4) ve depodaki mevcut kind-bazlı posta kutusu ayrımından türetildi."
KK DOĞRULAMA: `scheduled-report-mail.test.ts` (unit, DB'siz): konu grup etiketi + dönem taşır; gövde satır sayısı, dosya adı ve CSV başlık satırını içerir; 0 satırlık CSV'de anlamlı 'kayıt yok' ifadesi → türetilmiş KK. Mevcut FileMailer tüketen dört integration süiti (notifications / account-lifecycle / chat-transcript / cc-masking) değişmeden yeşil kalır.
KAPSAM DIŞI: Gerçek SMTP / MIME attachment desteği (§9 sınırı — FileMailer düz metin yazar) · Kime gönderileceğine karar verme (alıcı doğrulaması -b/-c'de) · Gönderimin ne zaman tetikleneceği (-e) · CSV'nin nasıl üretileceği (-d2)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.5. 07.9-sched-d2 [SONNET-MAX] Rapor CSV üretimini paylaşılan `services/reports/report-csv.ts` modülüne çıkar

**Status:** done  
**Dependencies:** None  

Davranış-değişmez (pure refactor) taşıma. Yeni `apps/api/src/services/reports/report-csv.ts`: `buildGroupCsv` + bağlı SQL yardımcıları + paylaşılan `Prisma.sql` parçaları buraya taşınır ve export edilir. `routes/reports.ts` bunları import ederek kullanır — dört GET route'u ve `/reports/export` aynı fonksiyonlara bağlı kalır. İmzalar `(tx: TenantClient, licenseId: bigint, from: Date, to: Date)` biç

**Details:**

07.9-sched-d2 — Rapor CSV üretimini paylaşılan `services/reports/report-csv.ts` modülüne çıkar  [SONNET-MAX]

PRD: FR-MOD-07.7 (+ §5.3-Reports) + ADR-09
ETİKET GEREKÇESİ: SONNET-MAX: koşul 2 ve 3 sağlandı (güvenlik sınırı yok — mevcut sorgular birebir taşınıyor, davranış değişmiyor; eşzamanlılık yok). AMA mekanik olarak GİRİFT: `buildGroupCsv` + ona bağlı ~10 özel yardımcı (`windowTotals`, `breakdownByDay`, `satisfactionByDay`, `satisfactionCounts`, `ticketCount`, `transferCount`, `csatSummary`, `satisfactionScore`, `roundOrNull` + `AGENT_EVENT`/`SKILL_RUN`/`SPLIT_COUNTS` Prisma.sql parçaları) ~250 satırlık geniş yüzey olarak taşınıyor ve `reports.ts`'in dört GET route'u ile CSV export'unun AYNI sayıyı üretmeye devam etmesi (ADR-09) satır satır doğrulanmalı → daha fazla düşünme bütçesi, MAX efor.
NEDEN AÇIK: `buildGroupCsv` `apps/api/src/routes/reports.ts` içinde (satır ~343-427) route dosyasına gömülü ve besleyici sorguların hepsi aynı dosyada module-private. Zamanlanmış işin (-e) bu üreticiyi çağırması gerekiyor; bir arka plan servisinin `routes/` içinden import etmesi katman ihlali olur. `reports.ts` yorumu ADR-09'u açıkça bağlıyor: 'Every figure is the same one its JSON report exposes — the export reuses the report's aggregation helpers rather than recomputing' — bu sözleşme taşımada korunmak zorunda.
KAPSAM: Davranış-değişmez (pure refactor) taşıma. Yeni `apps/api/src/services/reports/report-csv.ts`: `buildGroupCsv` + bağlı SQL yardımcıları + paylaşılan `Prisma.sql` parçaları buraya taşınır ve export edilir. `routes/reports.ts` bunları import ederek kullanır — dört GET route'u ve `/reports/export` aynı fonksiyonlara bağlı kalır. İmzalar `(tx: TenantClient, licenseId: bigint, from: Date, to: Date)` biçiminde korunur (zaten öyle) ki hem istek yolu hem arka plan işi aynı tenant-bağlı client'ı geçirebilsin. `reports-export.ts` (toCsv/csvField/exportFilename/REPORT_GROUPS) OLDUĞU YERDE KALIR — zaten route'suz saf modül. Hiçbir SQL metni, yuvarlama veya başlık adı değişmez.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/src/services/reports/report-csv.ts · apps/api/src/services/reports/report-csv.test.ts · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports-export.ts (route'tan ayrılmış saf rapor modülünün depodaki mevcut örneği — dosya başı yorum biçimi dahil) · apps/api/src/routes/reports-metrics.ts (aynı ayrıştırma deseni: resolutionRate/round) · apps/api/src/services/billing/invoice-service.ts (services/ altında CSV satırı üreten mevcut servis)
KK (birebir): "FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "export" (CSV üretiminin tek doğruluk kaynağı olarak korunması)." | "KK-türetilmiş: "Taşıma sonrası her rapor grubunun CSV çıktısı, aynı pencere için JSON raporunun verdiği sayılarla birebir aynı kalır (ADR-09)." — Türetme gerekçesi: PRD refactor kriteri vermez; kriter `reports.ts`'in kendi yorumundaki 'a CSV can never disagree with the screen it was exported from' sözleşmesinden ve ADR-09'dan türetildi."
KK DOĞRULAMA: `apps/api/test/integration/reports-billing.test.ts` DEĞİŞTİRİLMEDEN yeşil kalır — dört GET raporu ve `/reports/export` taşımadan önce ne döndürüyorsa aynısını döndürür (davranış-değişmezlik kanıtı = ADR-09 türetilmiş KK). Ek `report-csv.test.ts`: her grup için başlık satırı ve satır şekli (breakdown/reviews = gün başına satır; overview/ai-agent = `metric,value`), bilinmeyen grup → `validation` hatası.
KAPSAM DIŞI: Yeni rapor grubu eklemek (Chat topics / Team performance ayrı v2 kalemleri) · PDF üretimi (kapsam dışı — varsayım #2) · `reports-export.ts` içindeki toCsv/csvField/exportFilename/REPORT_GROUPS'un taşınması (yerinde kalır) · Sorgu performans iyileştirmesi veya `report_aggregates` cache'i
SÖZLEŞME: yok — hiçbir route eklenmiyor/kaldırılmıyor, `contract-parity.test.ts` etkilenmez.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.6. 07.9-sched-e [OPUS-MAX] Zamanlayıcı çekirdeği: dönem hesabı + tek-teslim claim (idempotens) + tenant-scoped sweep

**Status:** done  
**Dependencies:** 94.1, 94.2, 94.4, 94.5  

Yeni `services/reports/scheduled-report-sweeper.ts` (+ saf `scheduled-report-period.ts`). ÜÇ parça, tek bağlamda: (1) DÖNEM HESABI — saf `periodFor(frequency, now)` → `{ periodKey, from, to }`; her zaman ÖNCEKİ TAM dönem (daily → dün 00:00–24:00 UTC, weekly → geçen ISO haftası, monthly → geçen ay), hepsi UTC. (2) CLAIM — teslim ÖNCESİ `scheduled_report_runs`'a `(scheduledReportId, periodKey)` satı

**Details:**

07.9-sched-e — Zamanlayıcı çekirdeği: dönem hesabı + tek-teslim claim (idempotens) + tenant-scoped sweep  [OPUS-MAX]

PRD: §5.3-Reports (FR-MOD-07.7 uzantısı) + NFR-M4 + NFR-M5 + NFR-S9 + NFR-C8
ETİKET GEREKÇESİ: OPUS-MAX: koşul 3 ihlali (eşzamanlılık / transaction-invariant) + tenant izolasyon sınırı. Yanlış karar pahalı: dönem anahtarı yanlış türetilirse ya hiç gönderilmez ya her koşuda tekrar gönderilir; claim ile gönderim sırası ters olursa kalıcı hata dönemi kilitler ya da tekrar tetik çift e-posta gönderir; sweep tenant bağlamını yanlış kurarsa bir lisansın raporu başka lisansın alıcısına gider. Bu üç akıl yürütme aynı bağlamda olmak zorunda → bölünmez çekirdek.
NEDEN AÇIK: Depoda tekrarlanan iş + e-posta birleşimi için tekilleştirme/kilit mekanizması YOK: `CampaignSend`'in `@@unique([campaignId, customerId])` (schema.prisma:806) tekilleştirmesinin zamanlanmış rapor tarafında eşdeğeri yok. Mevcut iki sweep (`retention/retention.ts`, `chat/chat-timeout.ts`) idempotent ama yan etkileri kendinden idempotent (silinen satır bir daha aday değil, kapanan chat bir daha aday değil); e-POSTA GÖNDERİMİ öyle değil — gönderilmiş e-posta geri alınamaz ve 'gönderildi mi?' sorusunun cevabı yalnız bir kayıt satırında durur. Ayrıca `chat-timeout.ts` tenant bağlamının nasıl kurulacağını gösteriyor (tek SECURITY DEFINER enumerator `retention_list_tenants()` + her tenant için `withTenant`) — bu desen izlenmezse RLS devre dışı kalır.
KAPSAM: Yeni `services/reports/scheduled-report-sweeper.ts` (+ saf `scheduled-report-period.ts`). ÜÇ parça, tek bağlamda: (1) DÖNEM HESABI — saf `periodFor(frequency, now)` → `{ periodKey, from, to }`; her zaman ÖNCEKİ TAM dönem (daily → dün 00:00–24:00 UTC, weekly → geçen ISO haftası, monthly → geçen ay), hepsi UTC. (2) CLAIM — teslim ÖNCESİ `scheduled_report_runs`'a `(scheduledReportId, periodKey)` satırı `status='pending'` ile INSERT; unique ihlali (Prisma P2002) 'bu dönem zaten alındı' demektir ve o tanım SESSİZCE atlanır (hata değil). Böylece aynı anda koşan iki süreç ya da art arda iki manuel tetik ikinci e-postayı gönderemez. Başarılı teslimde satır `delivered` + rowCount/recipientCount ile UPDATE; hata alırsa `failed` + sanitize edilmiş `error` ile UPDATE — satır SİLİNMEZ (dönem tüketilmiş sayılır; retry v1 dışı, varsayım #11). (3) SWEEP — `retention_list_tenants()` ile tenant listesi, her tenant için `withTenant`: enabled tanımları oku → dönemi hesapla → claim → `buildGroupCsv` (-d2) → `buildScheduledReportMail` (-d1) → her alıcıya `FileMailer.send({ kind:'scheduled_report' })` → run satırını kapat. Rapor `{ startedAt, finishedAt, tenants[], totals:{ tenants, delivered, skipped, failed } }` — `ChatTimeoutReport` şekli. Mailer ve `now` enjekte edilir (test determinizmi).
DOSYALAR: apps/api/src/services/reports/scheduled-report-sweeper.ts · apps/api/src/services/reports/scheduled-report-period.ts · apps/api/src/services/reports/scheduled-report-period.test.ts · apps/api/test/integration/scheduled-reports-sweep.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/chat/chat-timeout.ts (retention_list_tenants() + withTenant sweep iskeleti + rapor şekli + 'neden idempotent' yorum disiplini) · apps/api/src/services/retention/retention.ts (tenant-bazlı idempotent sweep + rapor) · apps/api/src/services/webhooks/webhook-dispatcher.ts (her denemede teslim-log satırı yazma disiplini — NFR-M5)
KK (birebir): "KK-türetilmiş: "Bir zamanlanmış export tanımı, aynı dönem için en fazla BİR kez teslim edilir; iş art arda iki kez tetiklenirse ikinci koşu hiçbir e-posta göndermez ve dönemi 'atlandı' olarak raporlar." — Türetme gerekçesi: PRD §5.3 satırının Kabul Kriteri sütunu yok (kk_yetersiz=true) ve §6'da karşılık gelen FR-MOD satırı yok. Kriter, orkestratörün bağlayıcı kapsam kararındaki 'Tekrarlanan iş + e-posta = eşzamanlılık dokunuşu, idempotenslik şart' ifadesinden birebir türetildi." | "KK-türetilmiş: "Zamanlanmış iş her tenant'ın verisini yalnız o tenant'ın bağlamında okur ve teslim eder; bir lisansın raporu başka lisansın alıcısına gitmez." — Türetme gerekçesi: PRD izolasyon kriteri vermiyor; kriter `chat-timeout.ts`'in kodda yazılı 'RLS is the cross-tenant guard' sözleşmesinden ve orkestratörün güvenlik yüzeyi maddesi (2)'den türetildi." | "KK-türetilmiş: "Her çalışma — teslim edilen, atlanan ve başarısız olan — bir kayıt satırı bırakır; başarısızlık sessizce kaybolmaz." — Türetme gerekçesi: PRD karşılığı yok; kriter NFR-M5'in webhook tarafındaki karşılığından ('her webhook teslimi/retry loglanır') zamanlanmış teslime uyarlandı."
KK DOĞRULAMA: `scheduled-reports-sweep.test.ts`: (i) IDEMPOTENS — aynı `now` ile sweep iki kez koşturulur → `.data/mail` posta kutusunda `scheduled_report` türünde TAM 1 dosya, ikinci koşunun raporunda `skipped=1`, tabloda 1 satır → tek-teslim KK'sı; (ii) CROSS-TENANT — iki lisansta birer tanım → her lisansın e-postası yalnız kendi alıcısına, CSV içeriği yalnız kendi verisi → izolasyon KK'sı; (iii) HATA YOLU — mailer fırlatırsa run satırı `failed` + `error` dolu, üçüncü koşu yine göndermez → kayıt KK'sı; (iv) `enabled=false` → gönderim ve run satırı yok; (v) `periodFor` UTC sınırlarını doğru verir (saf unit).
KAPSAM DIŞI: CLI koşum betiği ve npm script (-f) · Kalıcı hata sonrası retry / exponential backoff (varsayım #11 — açık soru #3) · Gerçek cron / BullMQ / durable queue (proje sınırı, varsayım #1) · Teslim geçmişini okuyan endpoint (-g) ve UI (-h) · Tenant saat dilimi desteği (açık soru #4)
SÖZLEŞME: yok — bu alt-görev hiç route eklemez (arka plan servisi); `contract-parity.test.ts` etkilenmez.
MIGRATION: yok — tablolar ve kısıt -a'da; bu alt-görev onları KULLANIR (özellikle `UNIQUE (scheduled_report_id, period_key)` claim'in tek dayanağıdır).
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.7. 07.9-sched-f [SONNET-XHIGH] `scheduled-reports:run` operatör betiği + npm script (dry-run varsayılanı)

**Status:** done  
**Dependencies:** 94.6  

Yeni `apps/api/src/services/reports/scheduled-reports-run.ts`: `loadEnvFile()` → `parseEnv()` → `new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl })` → `new FileMailer(env.MAIL_DIR)` → `new ScheduledReportSweeper(db, mailer).run({ dryRun })` → makine-okunur JSON rapor stdout'a, tek satırlık insan özeti stderr'e, `finally` içinde `$disconnect`, hata yakalayıcı `process.exitCode = 1`. `apps/

**Details:**

07.9-sched-f — `scheduled-reports:run` operatör betiği + npm script (dry-run varsayılanı)  [SONNET-XHIGH]

PRD: §5.3-Reports (FR-MOD-07.7 uzantısı) + NFR-C8
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 1 yeni dosya + 1 package.json satırı; (2) güvenlik sınırı yok — tenant bağlamını kuran ve RLS'e dayanan mantık -e'nin içinde; bu dosya PrismaClient'ı `env.runtimeDatabaseUrl` (RLS-bağlı rol) ile kurup sweeper'ı çağırır ve JSON basar; (3) eşzamanlılık akıl yürütmesi yok; (4) desen ismen var ve satır satır eşleşiyor: `chat-timeout-run.ts`; (5) kontrat değişikliği yok; (6) KK mekanik. UYARI (gözden geçiren için): `datasourceUrl: env.runtimeDatabaseUrl` seçimi tek kritik satırdır — yanlış URL RLS'i devre dışı bırakır; bu yüzden referans dosya ismen verildi ve cross-tenant regresyonu zorunlu testlere kondu. Bu satır dışında dosyada karar yok.
NEDEN AÇIK: `apps/api/package.json` scripts bölümünde yalnız `retention:run` (satır 22) ve `chat-timeout:run` (satır 23) var — zamanlanmış export'u tetikleyecek giriş noktası yok. Depoda production scheduler yok: `retention/run.ts` ve `chat-timeout-run.ts` dosya başı yorumları 'There is no production scheduler in this environment (a project boundary)' diyor — tetik yolu bir operatör/host-cron betiğidir.
KAPSAM: Yeni `apps/api/src/services/reports/scheduled-reports-run.ts`: `loadEnvFile()` → `parseEnv()` → `new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl })` → `new FileMailer(env.MAIL_DIR)` → `new ScheduledReportSweeper(db, mailer).run({ dryRun })` → makine-okunur JSON rapor stdout'a, tek satırlık insan özeti stderr'e, `finally` içinde `$disconnect`, hata yakalayıcı `process.exitCode = 1`. `apps/api/package.json`'a `"scheduled-reports:run": "tsx src/services/reports/scheduled-reports-run.ts"`. VARSAYILAN DRY-RUN, `--apply` ile teslim — `retention/run.ts` gerekçesinin aynısı: yan etki geri alınamaz (gönderilmiş e-posta geri çağrılamaz), o yüzden `chat-timeout-run.ts`'in dry-run'sız biçimi değil retention'ın dry-run varsayılanı kopyalanır. Dry-run HİÇBİR claim yazmaz, yalnız hangi tanımın hangi dönem için hazır olduğunu listeler.
DOSYALAR: apps/api/src/services/reports/scheduled-reports-run.ts · apps/api/package.json · apps/api/test/integration/scheduled-reports-sweep.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/chat/chat-timeout-run.ts (birebir yapı: loadEnvFile → parseEnv → PrismaClient(runtimeDatabaseUrl) → FileMailer → sweeper → stdout JSON / stderr özet / finally disconnect / exitCode) · apps/api/src/services/retention/run.ts (dry-run varsayılanı + `--apply` bayrağı deseni ve gerekçe yorumu) · apps/api/package.json (satır 22-23 — mevcut iki :run script'i)
KK (birebir): "KK-türetilmiş: "Zamanlanmış export, operatörün (veya host cron'unun) çalıştırdığı tek bir komutla tetiklenir; komut varsayılan olarak hiçbir şey göndermez, ne teslim edeceğini listeler; `--apply` ile teslim eder ve ne teslim ettiğini, neyi atladığını, neyin başarısız olduğunu makine-okunur bir rapor olarak yazar." — Türetme gerekçesi: PRD §5.3 satırının Kabul Kriteri sütunu yok ve PRD zamanlama altyapısını tarif etmiyor; kriter, depodaki iki mevcut sweep betiğinin yazılı sözleşmesinden ('There is no production scheduler in this environment — a project boundary'), `retention/run.ts`'in geri-alınamaz-yan-etki gerekçesinden ve varsayım #1'den türetildi."
KK DOĞRULAMA: Betik bayraksız (dry-run) koştuğunda `.data/mail` boş kalır ve `scheduled_report_runs` satır sayısı değişmez; `--apply` ile teslim gerçekleşir ve stdout'taki JSON `totals.delivered` tabloyla tutarlı → türetilmiş KK'nın iki yarısı. `scheduled-reports-sweep.test.ts`'e eklenen kanıt: betiğin kullandığı yapılandırma (RLS-bağlı runtime rolü) altında iki lisanslı senaryo çapraz teslim üretmez.
KAPSAM DIŞI: Gerçek cron kurulumu / systemd timer / deploy (production sınırı, PLAN §9) · Retry mantığı (açık soru #3) · İş kuyruğu altyapısı (BullMQ / Redis Streams — varsayım #1) · Zamanlanmış export'u API'den elle tetikleyen endpoint (bu turda yok)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.8. 07.9-sched-g [OPUS-XHIGH] Teslim geçmişi okuması: kontrat + `GET /reports/scheduled-exports/{id}/runs`

**Status:** done  
**Dependencies:** 94.3, 94.6  

Kontrat+backend aynı pencerede (parity çift yönlü). `reports.yaml`'a `scheduledExportRuns` bloğu: `get`, `scheduledExportId` path parametresi + `limit` query (varsayılan 20, üst sınır 100), `reports_read` kapısı; `openapi.yaml`'a `ScheduledExportRun` şeması (`period_key`, `period_from`, `period_to`, `status`, `row_count`, `recipient_count`, `error`, `created_at`). Route: `request.withTenant` altın

**Details:**

07.9-sched-g — Teslim geçmişi okuması: kontrat + `GET /reports/scheduled-exports/{id}/runs`  [OPUS-XHIGH]

PRD: §5.3-Reports (FR-MOD-07.7 uzantısı) + NFR-M5
ETİKET GEREKÇESİ: OPUS-XHIGH: kullanıcının açık kuralı gereği 'yeni bir yetkili endpoint eklemek' en az OPUS-XHIGH — salt-okunur olsa bile yeni bir authZ kapısı (`reports_read`) + tenant-scoped okuma yüzeyi açıyor ve id başka lisansa aitse 404 (403 değil) verme kararını taşıyor. Yeni scope/eşzamanlılık/algoritma yok → MAX değil.
NEDEN AÇIK: -e her çalışma için `scheduled_report_runs`'a satır yazıyor (delivered/failed), ama bu satırları okuyan hiçbir yüzey yok — `packages/contract/openapi/paths/reports.yaml`'da id'li runs path'i tanımlı değil ve `apps/api/src/routes/` altında karşılığı yok. Kayıt tutulup okunamıyorsa NFR-M5'in gözlemlenebilirlik payı ölü kalır; UI (-h) 'son çalışma ne oldu?' sorusunu cevaplayamaz.
KAPSAM: Kontrat+backend aynı pencerede (parity çift yönlü). `reports.yaml`'a `scheduledExportRuns` bloğu: `get`, `scheduledExportId` path parametresi + `limit` query (varsayılan 20, üst sınır 100), `reports_read` kapısı; `openapi.yaml`'a `ScheduledExportRun` şeması (`period_key`, `period_from`, `period_to`, `status`, `row_count`, `recipient_count`, `error`, `created_at`). Route: `request.withTenant` altında önce tanımın varlığı doğrulanır (yoksa/başka lisanssa 404 — varlık sızdırmaz, `ticket-rules.ts` deseni), sonra `createdAt desc` sıralı basit sayfa döner. `error` alanı -e'de zaten sanitize edilerek yazıldığı için burada olduğu gibi döner (alıcı adresi ya da secret taşımaz).
DOSYALAR: packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/scheduled-reports.ts · apps/api/src/services/reports/scheduled-report-service.ts · apps/api/test/integration/scheduled-reports.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/ticket-rules.ts (id'li alt kaynak okuması + withTenant + 404 semantiği) · packages/contract/openapi/paths/webhooks.yaml (path parametreli alt kaynak bloğu) · apps/api/src/routes/reports.ts (satır ~931 `GET /billing/invoices` — türetilmiş liste dönen salt-okunur endpoint)
KK (birebir): "FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "İzin bazlı görünürlük" (teslim geçmişi de aynı izin kapısından geçer)." | "KK-türetilmiş: "Bir zamanlanmış export'un her çalışması — teslim edilen ve başarısız olan — sahibi tarafından dönemi, durumu ve hata nedeniyle birlikte görülebilir." — Türetme gerekçesi: PRD §5.3'te Kabul Kriteri sütunu yok; kriter NFR-M5'in webhook tarafındaki karşılığından ('her webhook teslimi/retry loglanır' + `WebhookDelivery` tablosunun okunabilir olması) zamanlanmış teslime uyarlandı."
KK DOĞRULAMA: `scheduled-reports.test.ts`: (i) sweep sonrası `GET .../runs` teslim edilen dönemi `status='delivered'` + `row_count` ile döndürür; (ii) başarısız çalışma `status='failed'` + `error` dolu döner → türetilmiş görünürlük KK'sı; (iii) `reports_read` taşımayan token → 403 → 'İzin bazlı görünürlük'; (iv) B lisansı A'nın tanımının runs'ını isterse 404; (v) `limit` üst sınırını aşan değer → 400. `contract-parity.test.ts` yeşil.
KAPSAM DIŞI: Çalışmayı elle yeniden tetikleyen endpoint (retry — açık soru #3) · Teslim edilmiş CSV'yi endpoint'ten yeniden indirme (CSV saklanmıyor; yalnız posta kutusunda) · UI gösterimi (-h) · Keyset sayfalama (basit limit yeterli — geçmiş küçük)
SÖZLEŞME: EVET. `reports.yaml` içine `scheduledExportRuns` bloğu (`get`) + `openapi.yaml` components'e `ScheduledExportRun` şeması. OpenAPI'ye eklenip re-bundle edilmezse `contract-parity.test.ts` KIRILIR; çift yönlü olduğu için route'suz kontrat da kırar → aynı pencerede.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.9. 07.9-sched-h [SONNET-XHIGH] Settings UI: "Scheduled exports" bölümü (liste + oluştur + iptal + son çalışma durumu)

**Status:** done  
**Dependencies:** 94.3, 94.8  

`SettingsPage.tsx`'e yeni `Section title="Scheduled exports"` — Reports değil Settings altında, çünkü mevcut Ticket rules / Ticket email templates gibi workspace otomasyonu (ReportsPage sekme yapısı bozulmaz). İçerik: (a) tanım listesi — rapor grubu etiketi, sıklık, alıcı sayısı, son çalışma durumu rozeti (delivered / failed / hiç çalışmadı; veri `GET .../runs`'tan); (b) boş durumda `title="No sch

**Details:**

07.9-sched-h — Settings UI: "Scheduled exports" bölümü (liste + oluştur + iptal + son çalışma durumu)  [SONNET-XHIGH]

PRD: FR-MOD-07.7 (+ §5.3-Reports) + FR-EK-A.1 + FR-EK-B.1
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 yeni dosya + SettingsPage'e bağlama; (2) güvenlik sınırı yok — yetki API'de zorlanıyor, UI yalnız sunum (yanlış UI kararı veri sızdırmaz, API 403/404 verir); (3) eşzamanlılık yok; (4) kopyalanacak desen ismen var ve aynı dosyanın içinde: SettingsPage.tsx "Ticket rules" bölümü (satır ~1191-1342) ve "Ticket email templates" (satır ~1447-1584) — Section + liste + empty state + form + sil; (5) kontrat değişikliği yok (tipler -b/-c/-g'de hazır); (6) KK mekanik (render testleri).
NEDEN AÇIK: `apps/web/src/features/reports/ReportsPage.tsx` yalnız dört sekme render ediyor — `TABS` sabiti (satır 119-123) tam olarak `overview / ai-agent / reviews / breakdown`; zamanlanmış export kurulum/listeleme/düzenleme ekranı yok. Ayrıca `grep -rn 'reports/export|reports/groups' apps/web/src apps/e2e` = **0** — web tarafında rapor export yüzeyi hiç tüketilmiyor. `apps/web/src/features/settings/` altında da karşılığı yok (mevcut dosyalar: SettingsPage, Channels, WebsiteWidgets, WidgetCustomization, BannedCustomerIps).
KAPSAM: `SettingsPage.tsx`'e yeni `Section title="Scheduled exports"` — Reports değil Settings altında, çünkü mevcut Ticket rules / Ticket email templates gibi workspace otomasyonu (ReportsPage sekme yapısı bozulmaz). İçerik: (a) tanım listesi — rapor grubu etiketi, sıklık, alıcı sayısı, son çalışma durumu rozeti (delivered / failed / hiç çalışmadı; veri `GET .../runs`'tan); (b) boş durumda `title="No scheduled exports"` + anlamlı açıklama (boş dikdörtgen YOK); (c) oluşturma formu — grup seçimi (`GET /reports/groups`'tan gelen görünür gruplar), sıklık, alıcı çoklu seçim (workspace ajanları), geçersizken submit pasif + alan-altı hata (T4-a form primitifi); (d) satır başına iptal (DELETE) + onay. `reports_manage` taşımayan kullanıcıda bölüm salt-okunur (aksiyonlar gizli/pasif; API zaten 403 verir). Tüm çağrılar mevcut typed ApiClient üzerinden.
DOSYALAR: apps/web/src/features/settings/ScheduledExports.tsx · apps/web/src/features/settings/ScheduledExports.test.tsx · apps/web/src/features/settings/SettingsPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/SettingsPage.tsx ("Ticket rules" bölümü satır ~1191-1342: Section + liste + empty state (title="No ticket rules") + oluşturma formu + sil) · apps/web/src/features/settings/SettingsPage.tsx ("Ticket email templates" bölümü satır ~1447-1584) · apps/web/src/features/settings/SettingsForms.test.tsx (bölüm render + form testi biçimi) · apps/web/src/features/settings/BannedCustomerIps.test.tsx
KK (birebir): "FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "İzin bazlı görünürlük" (kullanıcı yalnız görebildiği rapor gruplarını zamanlayabilir)." | "FR-EK-B.1 KK (PRD, birebir): "10.000+ satırda 60fps; skeleton; her boş liste için anlamlı empty state (boş dikdörtgen yok)" — bu alt-göreve düşen pay: "her boş liste için anlamlı empty state (boş dikdörtgen yok)"." | "FR-EK-A.1 KK (PRD, birebir): "Tek form/validasyon kütüphanesi; alan-altı hata mesajı" — oluşturma formu bu primitifi kullanır." | "KK-türetilmiş: "Kullanıcı bir rapor grubunu sıklık ve alıcılarla zamanlayabilir, listede son çalışmasının ne olduğunu görebilir ve iptal edebilir." — Türetme gerekçesi: PRD §5.3'te bu satırın Kabul Kriteri sütunu yok; kriter, orkestratörün kontrat yolları kararındaki beş işlemin (oluştur/listele/oku/güncelle/iptal) kullanıcı yüzeyi karşılığı olarak türetildi."
KK DOĞRULAMA: `ScheduledExports.test.tsx`: (i) tanım yokken `No scheduled exports` başlıklı anlamlı empty state render edilir (boş dikdörtgen değil) → FR-EK-B.1 payı; (ii) grup/alıcı seçilmeden submit PASİF, geçersiz alanda alan-altı hata → FR-EK-A.1 KK'sı; (iii) `GET /reports/groups` boş dönerse zamanlanabilir grup listesi boş ve oluşturma kapalı → 'İzin bazlı görünürlük' payı; (iv) liste satırı son çalışma rozetini üç durumda doğru gösterir; (v) iptal → DELETE çağrısı + satır kaybolur → türetilmiş KK.
KAPSAM DIŞI: ReportsPage'e manuel CSV export butonu eklemek (açık soru #6 — ayrı kalem) · Zamanlanmış export'u UI'dan elle tetikleme · Teslim edilen CSV'nin tarayıcıda önizlenmesi · Sıklık için saat/gün seçici (açık soru #4) · Sanallaştırılmış liste (geçmiş küçük — T6-a primitifi gerekmiyor)
SÖZLEŞME: yok — kontrat -b/-c/-g'de tamamlandı; UI yalnız üretilen tipleri tüketir.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 94.10. 07.9-sched-i [OPUS-XHIGH] Uçtan uca doğrulama: cross-tenant zinciri + tekrar-tetik idempotens regresyonu + e2e

**Status:** done  
**Dependencies:** 94.3, 94.6, 94.7, 94.8, 94.9  

(1) `tenant-isolation.test.ts`'e zamanlanmış export zinciri: A ve B lisanslarında birer tanım + birer teslim; B'nin token'ı A'nın tanımını listeleyemez / okuyamaz / güncelleyemez / silemez / runs'ını göremez (beş yüzey, hepsi 404 veya boş); B'nin posta kutusunda A'nın CSV'si YOK ve A'nın CSV'sinde B'nin ajan adı/tag'i geçmiyor (PII sızıntısı negatifi, NFR-S9). (2) Idempotens regresyonu: `scheduled

**Details:**

07.9-sched-i — Uçtan uca doğrulama: cross-tenant zinciri + tekrar-tetik idempotens regresyonu + e2e  [OPUS-XHIGH]

PRD: FR-MOD-07.7 (+ §5.3-Reports) + NFR-S9 + NFR-M4 + NFR-M5 + NFR-C8
ETİKET GEREKÇESİ: OPUS-XHIGH: tek bir alt-görevin değil ZİNCİRİN (scope → route → claim → teslim → geçmiş → UI) izolasyon ve idempotens iddialarını birlikte doğruluyor; hangi katmanın hangi garantiyi taşıdığına dair yorum gerektiren çok-yüzeyli akıl yürütme (kontrat + backend + job + UI + e2e). Yeni güvenlik mekanizması TASARLAMIYOR (o -e'de), yalnız kanıtlıyor → MAX değil. SONNET olamaz çünkü doğrulanan şey güvenlik sınırıdır ve testin neyi kanıtladığına karar vermek yorum gerektirir.
NEDEN AÇIK: Alt-görevler kendi testlerini taşıyor ama hiçbiri zinciri uçtan uca kanıtlamıyor: -b/-c yalnız route seviyesinde 403/404, -e yalnız servis seviyesinde sweep, -h yalnız render. Depoda bu bütünlük kanıtı için hazır yer var: `apps/e2e/tests/reports.spec.ts` + `apps/e2e/tests/settings.spec.ts` (ikisi de mevcut) ve `apps/api/test/integration/tenant-isolation.test.ts` (mevcut, tenant sınırının merkezi kanıt dosyası).
KAPSAM: (1) `tenant-isolation.test.ts`'e zamanlanmış export zinciri: A ve B lisanslarında birer tanım + birer teslim; B'nin token'ı A'nın tanımını listeleyemez / okuyamaz / güncelleyemez / silemez / runs'ını göremez (beş yüzey, hepsi 404 veya boş); B'nin posta kutusunda A'nın CSV'si YOK ve A'nın CSV'sinde B'nin ajan adı/tag'i geçmiyor (PII sızıntısı negatifi, NFR-S9). (2) Idempotens regresyonu: `scheduled-reports:run` ÜÇ kez art arda koşturulur (biri dry-run) → toplam bir `scheduled_report` postası, bir `delivered` run satırı; tanım devre dışı bırakılıp yeniden etkinleştirilse bile aynı dönem için ikinci teslim olmaz. (3) `settings.spec.ts`'e e2e akış: admin → Settings → Scheduled exports → empty state görünür → tanım oluştur → listede görünür → iptal → empty state'e döner; ajan rolüyle bölüm aksiyonsuz. (4) DoD kapısı TAM SÜRÜM koşulur (typecheck+lint+unit+integration+build+e2e) ve kanıt HANDOFF'a yazılır. Bu alt-görevde yeni kod yolu eklenmez — bulunan kusur ilgili alt-görevde düzeltilir.
DOSYALAR: apps/api/test/integration/tenant-isolation.test.ts · apps/api/test/integration/scheduled-reports-sweep.test.ts · apps/e2e/tests/settings.spec.ts · apps/e2e/tests/reports.spec.ts
REFERANS DESEN (kopyalanacak): apps/api/test/integration/tenant-isolation.test.ts (çok-kaynaklı cross-tenant iddia biçimi) · apps/api/test/integration/webhooks.test.ts (zincir kanıtı: kayıt → imza → teslim → log) · apps/e2e/tests/settings.spec.ts · apps/e2e/tests/reports.spec.ts
KK (birebir): "FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-görev 'İzin bazlı görünürlük' ve 'export' paylarını UÇTAN UCA kanıtlar (benchmark v2 — kapsam dışı)." | "KK-türetilmiş: "Zamanlanmış export zinciri boyunca (tanım → çalışma → teslim → geçmiş → ekran) hiçbir noktada bir lisansın verisi başka bir lisansa görünmez veya teslim edilmez." — Türetme gerekçesi: PRD §5.3 satırının Kabul Kriteri sütunu yok; kriter orkestratörün güvenlik yüzeyi maddesi (2) — 'arka plan job'ının licenseId/organization_id bazlı RLS altında çalışması şart' — ifadesinden türetildi." | "KK-türetilmiş: "İş kaç kez tetiklenirse tetiklensin, bir dönem için bir tanımdan tek bir e-posta çıkar." — Türetme gerekçesi: orkestratörün 'idempotenslik şart' kapsam kararından türetildi; -e'nin çekirdek KK'sının uçtan uca karşılığı."
KK DOĞRULAMA: `tenant-isolation.test.ts` — beş yüzeyde çapraz erişim reddi + posta kutusu ve CSV içerik ayrımı (bir lisansın CSV'sinde diğerinin agent adı/tag'i geçmiyor) → izolasyon KK'sı. `scheduled-reports-sweep.test.ts` — üç ardışık koşu sonunda posta kutusunda tam 1 `scheduled_report` dosyası ve tam 1 `delivered` satırı → tek-teslim KK'sı. `settings.spec.ts` — admin akışı (empty state → oluştur → listede → iptal → empty state) ve ajan rolünde aksiyonların bulunmaması → izin bazlı görünürlük. DoD kapısının tam sürümü (CONVENTIONS.md exit code'ları) yeşil.
KAPSAM DIŞI: Yeni kod yolu eklemek (bu alt-görev yalnız doğrular; kusur ilgili alt-görevde düzeltilir) · Performans/yük ölçümü (NFR-P7 ayrı kalem) · Retry davranışının doğrulanması (v1'de yok — açık soru #3) · PLAN §5 / §G / §8 tablo güncellemeleri (ayrı planlama işi)
SÖZLEŞME: yok — yeni route eklenmez; `contract-parity.test.ts` yalnız regresyon olarak koşulur.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
