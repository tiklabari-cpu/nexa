# Task ID: 77

**Title:** §5.3-Vardiya — Work scheduler / staffing prediction  ·  dilim V2-9

**Status:** done

**Dependencies:** 78 ✓

**Priority:** low

**Description:** PRD §5.3 (v2) · KK-türetilmiş.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `§5.3-Vardiya (WORKSCHED)`.

10 atomik alt-görev · ~11 pencere · etiket dağılımı: OPUS-MAX x2 · OPUS-XHIGH x4 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  WORKSCHED-a [SONNET-XHIGH] Work schedule kontratı + @siyahtus/types haftalık plan tipi ve normalizer  (bağ: yok)
  WORKSCHED-b [OPUS-XHIGH] work_schedules + agent_presence_events tabloları, Prisma modelleri ve RLS migration'ı  (bağ: WORKSCHED-a)
  WORKSCHED-c [OPUS-XHIGH] GET/PUT /agents/{agentId}/work-schedule — scope kapısı ve self-vs-admin yetkilendirme  (bağ: WORKSCHED-a, WORKSCHED-b)
  WORKSCHED-d [OPUS-MAX] Presence olay günlüğü yazma yolu + planlı vardiya ↔ manuel routingStatus öncelik kuralı (bölünmez çekirdek)  (bağ: WORKSCHED-b)
  WORKSCHED-e [SONNET-XHIGH] /reports/breakdown yanıtına saat-bazlı hacim kırılımı (by_hour)  (bağ: yok)
  WORKSCHED-f [OPUS-MAX] Deterministik staffing tahmin çekirdeği (saf modül, LLM yok — bölünmez)  (bağ: yok)
  WORKSCHED-g [OPUS-XHIGH] GET /reports/staffing-forecast — kontrat + üç girdinin tek yanıta bağlanması  (bağ: WORKSCHED-b, WORKSCHED-d, WORKSCHED-e, WORKSCHED-f)
  WORKSCHED-h [SONNET-XHIGH] Team → Work schedule düzenleyici (haftalık ızgara + timezone + alan-altı hata)  (bağ: WORKSCHED-a, WORKSCHED-c)
  WORKSCHED-i [SONNET-XHIGH] Reports → Staffing sekmesi (salt-okunur gün × saat ızgarası + düşük-baz uyarısı)  (bağ: WORKSCHED-g)
  WORKSCHED-j [OPUS-XHIGH] Uçtan uca doğrulama: staffing e2e akışı + izolasyon iddiaları + ADR-09 sayı tutarlılığı  (bağ: WORKSCHED-c, WORKSCHED-d, WORKSCHED-g, WORKSCHED-h, WORKSCHED-i)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): İki bölünmez çekirdek var. (1) WORKSCHED-d — presence olay günlüğünün YAZMA yolu `PUT /agents/me/routing-status` handler'ının içindedir ve o handler aynı `withTenant` bloğunda `routing.drainQueue` çağırıyor (apps/api/src/routes/agents.ts:74); olay yazımı bu transaction'dan koparılırsa kısmi yazma (durum değişti, olay yok / olay var, atama geri alındı) oluşur. Aynı alt-görev planlı vardiya ile manuel routingStatus arasındaki öncelik kuralını da sabitler — kural bağlamdan koparılırsa ajanın kuyruk alıp almadığı yanlış kararlaşır. (2) WORKSCHED-f — deterministik personel tahmini yeni bir algoritma tasarımıdır; depoda kopyalanacak eşdeğeri yoktur (reports-metrics.ts yalnız oran/yuvarlama içerir) ve kapasite modeli parçalara bölünürse "düşük-baz → null, 0 değil" ile "kapsama açığı" kuralları birbirinden kopar. Bu iki çekirdeğin ETRAFINDAKİ her şey daha ucuz alt-görevlere çıkarıldı: kontrat/tip (-a, SONNET), migration/RLS (-b, OPUS-XHIGH), saat-bazlı sorgu (-e, SONNET), endpoint bağlama (-g, OPUS-XHIGH), iki ekran (-h/-i, SONNET), uçtan uca doğrulama (-j, OPUS-XHIGH).

VARSAYIMLAR: KK-türetilmiş kalemdir: PRD §5.3 satır 412 iki sütunlu ("Alan | Kapsam") tablodadır, ayrı "Kabul Kriteri" sütunu yoktur ve PRD §6 FR-MOD tablosunda bu koda karşılık gelen satır yoktur. Bu kalemdeki TÜM kabul kriterleri türetilmiştir; dayanaklar v2-03 §294-295/§817 (WorkScheduler şekli), rapor-1 §573/§2164 (vardiya devri değeri), NFR-S3/S4 ve depodaki mevcut desenlerdir. · Tahmin LLM'siz ve deterministiktir (orkestratörün bağlayıcı kararı): girdi = saat-bazlı geçmiş hacim + presence kapsaması + AgentMembership.concurrentChatsLimit + ortalama sohbet süresi; aynı girdi her zaman aynı çıktıyı verir. · StaffingForecast TABLOSU AÇILMAZ — tahmin API-time hesaplanır, persist edilmez. (Olgulardaki 'persist edilecekse' notu bu turda hayır olarak karara bağlandı; ihtiyaç doğarsa ayrı kalem.) · Tarihsel presence, ÖRNEKLEYİCİ CRON ile değil, OLAY GÜNLÜĞÜ (append-on-change) ile tutulur: routingStatus zaten tek noktadan (agents.ts PUT /agents/me/routing-status) yazılıyor, bu yüzden olay yazımı deterministik ve eksiksizdir; ayrıca zamanlanmış iş eklemek gerekmez. · ÖNCELİK KURALI: manuel routingStatus HER ZAMAN planlı vardiyayı ezer. WorkSchedule routing/atama kararını değiştirmez — yalnız beklenen kapasite ve tahmin girdisidir. Böylece ADR-08 atama sırası ve mevcut drainQueue davranışı (agents.ts:74) korunur; 'planda var ama manuel offline' hâli çatışma değil, tanımlı sonuçtur. · Vardiya planı AJAN bazlı ve lisans kapsamlıdır (PK license_id + agent_id). Grup/ekip bazlı vardiya bu kalemin kapsamı dışındadır (PRD 'Ekip/Vardiya' diyor ama §6'da tanım yok). · YENİ SCOPE AÇILMAZ: work-schedule mevcut agents--my/agents--all scope'larını, staffing raporu mevcut reports_read'i kullanır → packages/types/src/scopes.ts ve scopes.test.ts sayacına dokunulmaz. · YENİ ApiError TİPİ AÇILMAZ (ör. schedule_conflict gerekmez — çatışma hata değil karardır). Böylece errors.ts (×2 yer) + scopes.test.ts sayacı + openapi enum + regen zinciri tetiklenmez. · Saat kovaları UTC'dir (mevcut by_day UTC-gün kal

AÇIK SORULAR (ürün kararı): Vardiya planı ajan bazlı mı olmalı, yoksa grup/ekip (Group) bazlı mı? PRD §5.3 satırı 'Ekip/Vardiya' diyor ama §6'da tanım yok. Varsayım: ajan bazlı (PK license_id+agent_id). Grup bazlı istenirse WORKSCHED-b'deki şema ve -c'deki authZ yeniden ele alınır. · Tahmin çıktısı zaman içinde saklanıp 'tahmin vs gerçekleşen' karşılaştırması istenir mi? Varsayım: hayır — API-time hesap, StaffingForecast tablosu yok. İstenirse ayrı bir migration + kalem gerekir. · Planlı vardiya routing'i GERÇEKTEN sürmeli mi (vardiya başında ajanı otomatik accepting_chats yapmak)? Varsayım: HAYIR (manuel kazanır — WORKSCHED-d). Otomatik sürüş istenirse bu ayrı bir OPUS-MAX kalemidir: zamanlanmış iş + kuyruk yan etkisi + ajan rızası sınırı doğar. · Düşük-baz (low_confidence) eşiği kaç sohbet/saat olmalı? PRD'de sayı yok. Varsayım: sabit bir eşik, mevcut rapor 'düşük-baz uyarısı' deseniyle hizalı; sayı kullanıcı kararı gerektiriyorsa WORKSCHED-f'ten önce netleşmeli. · agent_presence_events için retention politikası ne olmalı — mevcut retention yolu bu tabloyu da süpürmeli mi? Süpürürse tahmin penceresi geçmişe doğru kısalır; süpürmezse tablo sınırsız büyür. · Vardiya planı UI'ı ajanın kendisine mi (self-servis) yoksa yalnız yöneticiye mi açılmalı? Varsayım (WORKSCHED-c): ikisi de — self için agents--my, başkası için agents--all. Yalnız-yönetici isteniyorsa -c'deki scope kapısı daraltılır.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 77.1. WORKSCHED-a [SONNET-XHIGH] Work schedule kontratı + @siyahtus/types haftalık plan tipi ve normalizer

**Status:** done  
**Dependencies:** None  

Contract-first ilk adım, çalışan kod yok. (1) packages/contract/openapi/paths/agents.yaml'a `workSchedule` bloğu — GET + PUT /agents/{agentId}/work-schedule; (2) openapi.yaml components.schemas'a `WorkSchedule` = {timezone, schedule[{day: monday…sunday, start, end, enabled}]} (v2-03 §817 şekli birebir) ve re-bundle; (3) packages/types/src/work-schedule.ts — `WorkScheduleDay` union + `WORK_SCHEDULE

**Details:**

WORKSCHED-a — Work schedule kontratı + @siyahtus/types haftalık plan tipi ve normalizer  [SONNET-XHIGH]

PRD: §5.3-Vardiya (WORKSCHED) — PRD §6 FR-MOD tablosunda karşılığı yok (+ NFR-M2)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 5 dosya; güvenlik sınırı yok (yalnız şema/tip, çalışan endpoint yok); eşzamanlılık yok; kopyalanacak desen ismen var (packages/types/src/widget.ts — WidgetAppearance + WIDGET_COLOR_PATTERN + normalizeWidgetAppearance); kontrat değişikliği katkısal ve mekanik; KK mekanik doğrulanabilir (normalizer unit + contract-parity).
NEDEN AÇIK: packages/contract/openapi/paths altında 'schedule|staffing|WorkSchedule|Shift' grep → 0 eşleşme; ilgili path yok. packages/types/src listesinde 16 dosya var (apps.ts, custom-fields.ts, widget.ts, scopes.ts …) ve work-schedule tipi yok.
KAPSAM: Contract-first ilk adım, çalışan kod yok. (1) packages/contract/openapi/paths/agents.yaml'a `workSchedule` bloğu — GET + PUT /agents/{agentId}/work-schedule; (2) openapi.yaml components.schemas'a `WorkSchedule` = {timezone, schedule[{day: monday…sunday, start, end, enabled}]} (v2-03 §817 şekli birebir) ve re-bundle; (3) packages/types/src/work-schedule.ts — `WorkScheduleDay` union + `WORK_SCHEDULE_DAYS`, `WorkScheduleSlot`, `DEFAULT_WORK_SCHEDULE`, `WORK_SCHEDULE_TIME_PATTERN` (^([01]\d|2[0-3]):[0-5]\d$) ve `normalizeWorkSchedule()` (bilinmeyen gün reddi, gün tekrarı reddi, start<end zorunlu, boş girdi → default); (4) index.ts export.
DOSYALAR: packages/contract/openapi/paths/agents.yaml · packages/contract/openapi/openapi.yaml · packages/types/src/work-schedule.ts · packages/types/src/work-schedule.test.ts · packages/types/src/index.ts
REFERANS DESEN (kopyalanacak): packages/types/src/widget.ts · packages/types/src/custom-fields.ts · packages/contract/openapi/paths/reports.yaml
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Ajan başına haftalık vardiya planı (timezone + gün/başlangıç/bitiş/etkin) tek şemada tanımlanır ve geçersiz saat/gün reddedilir." — Türetme gerekçesi: PRD §5.3 satır 412 iki sütunlu ("Alan | Kapsam") tablodadır, ayrı "Kabul Kriteri" sütunu yoktur ve PRD §6 FR-MOD tablosunda bu koda karşılık gelen satır yoktur. Alan listesi destek kaynaktan alındı: v2-derin-analiz/v2-03-api-veri-referans.md:817 — "WorkScheduler | {timezone, schedule[{enabled, day (monday…sunday), start, end}]}"."
KK DOĞRULAMA: packages/types/src/work-schedule.test.ts normalizer'ın her reddini kanıtlar (KK-türetilmiş "geçersiz saat/gün reddedilir" maddesi); apps/api/test/integration/contract-parity.test.ts yeşil kalması eklenen path'in bundle ile eşleştiğini kanıtlar ("tek şemada tanımlanır" maddesi).
KAPSAM DIŞI: Prisma modeli ve migration (WORKSCHED-b) · Route/handler ve authZ (WORKSCHED-c) · Presence olay günlüğü (WORKSCHED-d) · StaffingForecast şeması (WORKSCHED-g) · UI (WORKSCHED-h)
SÖZLEŞME: packages/contract/openapi/paths/agents.yaml → `workSchedule` (GET + PUT /agents/{agentId}/work-schedule); openapi.yaml → components.schemas.WorkSchedule. UYARI: OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts KIRILIR (proje notu).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.2. WORKSCHED-b [OPUS-XHIGH] work_schedules + agent_presence_events tabloları, Prisma modelleri ve RLS migration'ı

**Status:** done  
**Dependencies:** 77.1  

Tek migration, iki tablo, veri yazılmaz. (1) `work_schedules`: license_id BIGINT, agent_id UUID, timezone TEXT, schedule JSONB, updated_at; PK (license_id, agent_id); FK licenses(id) + accounts(id) ON DELETE CASCADE. (2) `agent_presence_events` (append-only): id UUID, license_id, agent_id, status TEXT, changed_at TIMESTAMPTZ; index (license_id, agent_id, changed_at) — webhook_deliveries olay tablo

**Details:**

WORKSCHED-b — work_schedules + agent_presence_events tabloları, Prisma modelleri ve RLS migration'ı  [OPUS-XHIGH]

PRD: §5.3-Vardiya (WORKSCHED) + NFR-S4 (tenant izolasyon/RLS), NFR-C9 (veri bölgesi)
ETİKET GEREKÇESİ: OPUS-XHIGH: iki yeni tenant tablosu + RLS policy = güvenlik hassasiyeti olan ama çekirdek güvenlik kararı olmayan iş (kullanıcı kuralı: hafif güvenlik dokunuşu EN AZ OPUS-XHIGH). Koşul 2 ihlali → SONNET OLAMAZ; policy unutulursa cross-tenant sızıntı olur. Yeni izolasyon algoritması tasarlanmıyor, mevcut siyahtus_current_license() deseni uygulanıyor → MAX değil.
NEDEN AÇIK: apps/api/prisma/schema.prisma'da 41 model tanımlı (grep '^model '); WorkSchedule/Shift/StaffingForecast/PresenceHistory 0 eşleşme — kalıcı vardiya planı saklanamıyor. AgentMembership.routingStatus (schema.prisma:131, default 'offline') yalnız ANLIK presence. Mevcut 41 modelin tamamı RLS'li (migrations/20260726130000_inbox_settings ve 20260726150000_widget_settings: ENABLE ROW LEVEL SECURITY + siyahtus_current_license() policy + siyahtus_app GRANT) — yeni tablolar bu standarttan sapamaz.
KAPSAM: Tek migration, iki tablo, veri yazılmaz. (1) `work_schedules`: license_id BIGINT, agent_id UUID, timezone TEXT, schedule JSONB, updated_at; PK (license_id, agent_id); FK licenses(id) + accounts(id) ON DELETE CASCADE. (2) `agent_presence_events` (append-only): id UUID, license_id, agent_id, status TEXT, changed_at TIMESTAMPTZ; index (license_id, agent_id, changed_at) — webhook_deliveries olay tablosu deseni. Her iki tabloda ENABLE ROW LEVEL SECURITY + `<tablo>_tenant` policy (USING + WITH CHECK = siyahtus_current_license()) + GRANT SELECT,INSERT,UPDATE,DELETE TO siyahtus_app. Prisma modelleri + @map/@@map.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/20260801090000_work_scheduler/migration.sql · apps/api/test/integration/data-model.test.ts · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260726130000_inbox_settings/migration.sql · apps/api/prisma/migrations/20260726150000_widget_settings/migration.sql · apps/api/prisma/migrations/20260726090000_webhook_deliveries/migration.sql
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Vardiya planı ve presence geçmişi kalıcı olarak saklanır; bir lisansın verisi başka lisanstan ne okunabilir ne yazılabilir." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok, §6'da satır yok; izolasyon payı NFR-S4'ten ve depodaki 41 modelin tamamının RLS taşıması olgusundan türetildi."
KK DOĞRULAMA: tenant-isolation.test.ts'e eklenen iki tablo satırı KK-türetilmiş izolasyon maddesini kanıtlar; data-model.test.ts migration'ın uygulandığını ve tabloların RLS-enabled olduğunu kanıtlar ("kalıcı saklanır" maddesi).
KAPSAM DIŞI: Tabloya yazan kod yolu (WORKSCHED-d) · Route/handler (WORKSCHED-c) · StaffingForecast tablosu — AÇILMAZ, tahmin API-time hesaplanır (§C varsayımı) · Retention/temizlik politikası (açık soru 5)
SÖZLEŞME: yok (kontrat WORKSCHED-a'da yazıldı)
MIGRATION: GEREKLİ — yeni `work_schedules` (PK license_id+agent_id, JSONB schedule) ve `agent_presence_events` (append-only, index license_id+agent_id+changed_at); ikisinde de RLS policy + siyahtus_app GRANT.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.3. WORKSCHED-c [OPUS-XHIGH] GET/PUT /agents/{agentId}/work-schedule — scope kapısı ve self-vs-admin yetkilendirme

**Status:** done  
**Dependencies:** 77.1, 77.2  

agents.ts'e iki handler: GET ve PUT /agents/:agentId/work-schedule. (1) yazma config.scopes = ['agents--all:rw'], okuma ['agents--all:ro','agents--my:ro'] — `agents--my:*` ile gelen çağıran YALNIZ kendi accountId'sine eşit agentId'ye erişebilir, başkasına 403. (2) Gövde WORKSCHED-a'nın normalizeWorkSchedule() fonksiyonundan geçer, geçersiz → ApiError.validation (MEVCUT hata tipi — yeni ApiError ti

**Details:**

WORKSCHED-c — GET/PUT /agents/{agentId}/work-schedule — scope kapısı ve self-vs-admin yetkilendirme  [OPUS-XHIGH]

PRD: §5.3-Vardiya (WORKSCHED) + NFR-S3 (yetkilendirme/scope), NFR-S4 (tenant izolasyon)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni YETKİLİ endpoint + 'kendi planım' (agents--my) ile 'başkasının planı' (agents--all) arasındaki authZ ayrımı — kullanıcının açık kuralı: yeni yetkili endpoint EN AZ OPUS-XHIGH, güvenlik işi asla sonnet'e verilmez (koşul 2 ihlali). Çekirdek izolasyon -b'deki RLS + mevcut withTenant deseninde çözüldüğü için MAX değil.
NEDEN AÇIK: apps/api/src/routes altında 28 dosya var (agents.ts, settings.ts, reports.ts …) ve schedule/staffing route'u yok — grep 0 doğrudan eşleşme; campaigns/chat-timeout/retention'daki 'schedule' kelimesi kampanya zamanlaması / cron bağlamında, personel vardiyasıyla ilgisiz. Mevcut yüzey yalnız PUT /agents/me/routing-status (agents.ts:51-53) — anlık durum, planlı vardiya değil.
KAPSAM: agents.ts'e iki handler: GET ve PUT /agents/:agentId/work-schedule. (1) yazma config.scopes = ['agents--all:rw'], okuma ['agents--all:ro','agents--my:ro'] — `agents--my:*` ile gelen çağıran YALNIZ kendi accountId'sine eşit agentId'ye erişebilir, başkasına 403. (2) Gövde WORKSCHED-a'nın normalizeWorkSchedule() fonksiyonundan geçer, geçersiz → ApiError.validation (MEVCUT hata tipi — yeni ApiError tipi açılmaz). (3) withTenant içinde upsert (license_id+agent_id). (4) AuditLogEntry'ye `work_schedule.updated` kaydı (audit_log mevcut, schema.prisma:1260).
DOSYALAR: apps/api/src/routes/agents.ts · apps/api/test/integration/work-schedule.test.ts · apps/api/test/integration/route-config.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/agents.ts · apps/api/test/integration/agents-suspension.test.ts · apps/api/src/routes/settings.ts
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Ajan kendi vardiya planını okuyup yazabilir; başkasının planını yalnız yönetici scope'u (agents--all) değiştirebilir; geçersiz plan reddedilir." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok; yetki payı depodaki mevcut agent yüzeyinin ikili deseninden türetildi (PUT /agents/me/routing-status = agents--my:rw · PUT /agents/{agentId}/suspension = agents--all:rw)."
KK DOĞRULAMA: work-schedule.test.ts'teki 403 testi "yalnız yönetici scope'u değiştirebilir" maddesini, 400 testi "geçersiz plan reddedilir" maddesini, PUT→GET round-trip testi "okuyup yazabilir" maddesini kanıtlar; route-config.test.ts iki yeni route'un scope config'i taşıdığını kanıtlar (NFR-S3).
KAPSAM DIŞI: Presence olay yazımı ve öncelik kuralı (WORKSCHED-d) · Vardiyanın routing'i sürmesi — YAPILMAZ (§C varsayımı: manuel routingStatus kazanır) · Tahmin endpoint'i (WORKSCHED-g) · UI (WORKSCHED-h)
SÖZLEŞME: yok — path/şema WORKSCHED-a'da eklendi. Yanıt şekli kontrattan saparsa openapi.yaml güncellenip re-bundle edilmeli, yoksa contract-parity.test.ts kırılır. YENİ SCOPE AÇILMAZ (mevcut agents--my/all) → packages/types/src/scopes.ts + scopes.test.ts sayacına dokunulmaz.
MIGRATION: yok (WORKSCHED-b'de)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.4. WORKSCHED-d [OPUS-MAX] Presence olay günlüğü yazma yolu + planlı vardiya ↔ manuel routingStatus öncelik kuralı (bölünmez çekirdek)

**Status:** done  
**Dependencies:** 77.2  

(1) Olay yazımı: routingStatus değişiminde (agents.ts PUT /agents/me/routing-status) ve suspend/unsuspend'de `agent_presence_events`'e append — drainQueue ile AYNI withTenant transaction'ı içinde (atama geri alınırsa olay da geri alınır); aynı duruma tekrar PUT idempotent (yeni olay yazılmaz). (2) `presence-coverage.ts`: olay günlüğünden [from,to] aralığı için ajan × saat online-dakika kapsaması t

**Details:**

WORKSCHED-d — Presence olay günlüğü yazma yolu + planlı vardiya ↔ manuel routingStatus öncelik kuralı (bölünmez çekirdek)  [OPUS-MAX]

PRD: §5.3-Vardiya (WORKSCHED) + NFR-R3 (tutarlılık), NFR-S4 (izolasyon), NFR-M2 (izlenebilirlik)
ETİKET GEREKÇESİ: OPUS-MAX: (1) EŞZAMANLILIK/TRANSACTION-INVARIANT — yazma noktası PUT /agents/me/routing-status handler'ı, aynı withTenant bloğunda routing.drainQueue çağırıyor (agents.ts:74) ve atamaları RTM'e publish ediyor; olay yazımı bu atomik bloktan koparılırsa kısmi durum oluşur → koşul 3 ihlali. (2) Planlı vardiya ile manuel durum arasındaki öncelik kararı yanlışsa ajan kuyruktan sohbet alır/almaz — yanlış kararın pahalı olduğu yüzey. (3) Yeni tenant tablosuna yazma → koşul 2 ihlali. Çekirdek bağlam bölününce güvenlik/eşzamanlılık akıl yürütmesi kaybolur → tek alt-görev.
NEDEN AÇIK: AgentMembership.routingStatus (schema.prisma:131, default 'offline') yalnız ANLIK durum; tüketicilerinin hepsi 'şu an'ı okuyor — customer.ts:167, home-service.ts:117, chat-service.ts:936/956/959. Tarihsel presence (geçmiş online/offline aralıkları) hiçbir tabloda loglanmıyor; orkestratörün bağlayıcı 'geçmiş hacim + presence verisinden deterministik hesap' kararı bu veri üretilmeden karşılanamaz. Ayrıca agents.ts:74'teki `status === 'accepting_chats' ? routing.drainQueue(...)` satırı durum değişiminin kuyruk boşaltan yan etkisi olduğunu koda karşı gösteriyor.
KAPSAM: (1) Olay yazımı: routingStatus değişiminde (agents.ts PUT /agents/me/routing-status) ve suspend/unsuspend'de `agent_presence_events`'e append — drainQueue ile AYNI withTenant transaction'ı içinde (atama geri alınırsa olay da geri alınır); aynı duruma tekrar PUT idempotent (yeni olay yazılmaz). (2) `presence-coverage.ts`: olay günlüğünden [from,to] aralığı için ajan × saat online-dakika kapsaması türetir; hiç olay yoksa 0 DEĞİL `null` (reports-metrics.ts'in null-when-empty felsefesi). (3) ÖNCELİK KURALI: manuel routingStatus HER ZAMAN planlı vardiyayı ezer; WorkSchedule routing/atama kararını DEĞİŞTİRMEZ (yalnız beklenen kapasite girdisi). ADR-08 atama sırası ve mevcut drainQueue davranışı korunur; kural testle sabitlenir ve §C varsayımı olarak yazılır.
DOSYALAR: apps/api/src/routes/agents.ts · apps/api/src/services/staffing/presence-coverage.ts · apps/api/src/services/staffing/presence-coverage.test.ts · apps/api/test/integration/presence-log.test.ts · apps/api/test/integration/routing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/agents.ts · apps/api/test/integration/routing.test.ts · apps/api/src/routes/reports-metrics.ts
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Ajanın uygunluk durumundaki her değişiklik zaman damgalı olarak kaydedilir; planlı vardiya bu anlık durumu ezmez — ajan manuel olarak offline ise vardiyada olsa bile kuyruktan sohbet almaz." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok ve §6'da satır yok; kural, orkestratörün 'presence verisinden deterministik hesap' kapsam kararı ile depodaki mevcut davranış (agents.ts:74 — drainQueue yalnız accepting_chats'te) çakıştırılarak türetildi. Destek: rapor-1-fonksiyonel.md:573 — "➕ Vardiya devri, denetim ve raporlama için büyük zaman tasarrufu.""
KK DOĞRULAMA: presence-log.test.ts'teki 'manuel offline → vardiyada olsa da atama yok' testi KK-türetilmiş ikinci cümleyi kanıtlar; 'durum geçişi → tam 1 olay, tekrar PUT → 0 yeni olay' testi birinci cümleyi kanıtlar; routing.test.ts'in yeşil kalması ADR-08 atama sırasının değişmediğini kanıtlar.
KAPSAM DIŞI: Tahmin aritmetiği (WORKSCHED-f) · Endpoint (WORKSCHED-g) · UI (WORKSCHED-h/-i) · Vardiya başında otomatik accepting_chats'e geçirme — AÇIKÇA YAPILMAZ (açık soru 3) · ADR-08 atama algoritmasının kendisi değişmez
SÖZLEŞME: yok — mevcut PUT /agents/me/routing-status yanıtı ({routing_status, assigned_from_queue}) değişmez. YENİ ApiError TİPİ AÇILMAZ: çatışma hata değil karardır (manuel kazanır) → errors.ts (×2 yer) + scopes.test.ts sayacı + openapi enum + regen zinciri TETİKLENMEZ.
MIGRATION: yok (tablolar WORKSCHED-b'de açıldı)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.5. WORKSCHED-e [SONNET-XHIGH] /reports/breakdown yanıtına saat-bazlı hacim kırılımı (by_hour)

**Status:** done  
**Dependencies:** None  

(1) `breakdownByHour(tx, licenseId, from, to)` helper'ı — breakdownByDay ile aynı `$queryRaw` + SPLIT_COUNTS kalıbı, UTC saat kovası (0-23), boş saat 0; (2) /reports/breakdown yanıtına `by_hour[]`; (3) reports.yaml açıklaması + openapi.yaml `ReportsBreakdown` şemasına katkısal alan + re-bundle. CSV export yolu (reports-export.ts) DEĞİŞMEZ — by_day çıktısı birebir korunur (kod yorumu: tüketiciler a

**Details:**

WORKSCHED-e — /reports/breakdown yanıtına saat-bazlı hacim kırılımı (by_hour)  [SONNET-XHIGH]

PRD: §5.3-Vardiya (WORKSCHED) girdisi + FR-MOD-07.5 (Metrics breakdown) · NFR-P7
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4 dosya; YENİ route/scope yok (mevcut /reports/breakdown + reports_read aynen), izolasyon mevcut withTenant + license_id filtresinden geliyor, yeni güvenlik kararı yok; eşzamanlılık yok; kopyalanacak desen İSMEN var: apps/api/src/routes/reports.ts:279 `breakdownByDay` ve 664-723 handler; kontrat katkısal; KK mekanik (by_hour toplamı = by_day toplamı).
NEDEN AÇIK: apps/api/src/routes/reports.ts /reports/breakdown (satır 664-723) yalnız `by_day` (breakdownByDay helper'ı, satır 279) ve `by_agent` ($queryRaw agent split) üretiyor; saat-bazlı kırılım YOK — tahmin motoru saat dilimi ister, mevcut sorgu genişletilmeden kullanılamaz.
KAPSAM: (1) `breakdownByHour(tx, licenseId, from, to)` helper'ı — breakdownByDay ile aynı `$queryRaw` + SPLIT_COUNTS kalıbı, UTC saat kovası (0-23), boş saat 0; (2) /reports/breakdown yanıtına `by_hour[]`; (3) reports.yaml açıklaması + openapi.yaml `ReportsBreakdown` şemasına katkısal alan + re-bundle. CSV export yolu (reports-export.ts) DEĞİŞMEZ — by_day çıktısı birebir korunur (kod yorumu: tüketiciler aynı güne farklı sayı veremez).
DOSYALAR: apps/api/src/routes/reports.ts · packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/test/integration/reports-billing.test.ts
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Geçmiş sohbet hacmi saat bazında (UTC, 24 kova) okunabilir ve bu sayılar günlük kırılımla birebir tutarlıdır." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok; kriter orkestratörün bağlayıcı kapsam kararındaki 'geçmiş hacim' girdisinden ve depodaki mevcut kod sözleşmesinden (breakdown ile CSV export aynı helper'ı paylaşır) türetildi."
KK DOĞRULAMA: reports-billing.test.ts'e eklenen 'by_hour toplamı = by_day toplamı' iddiası KK-türetilmiş tutarlılık maddesini kanıtlar; '24 kova, boş saat 0' iddiası saat-bazlı okunabilirlik maddesini; CSV regresyon iddiası mevcut tüketicinin bozulmadığını kanıtlar; contract-parity yeşil.
KAPSAM DIŞI: Tahmin aritmetiği (WORKSCHED-f) · Staffing endpoint'i (WORKSCHED-g) · UI (WORKSCHED-i) · CSV export'a by_hour grubu eklemek — YAPILMAZ (mevcut grup listesi korunur)
SÖZLEŞME: packages/contract/openapi/openapi.yaml → `ReportsBreakdown` şemasına katkısal `by_hour[]`; paths/reports.yaml açıklaması. UYARI: OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts KIRILIR.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.6. WORKSCHED-f [OPUS-MAX] Deterministik staffing tahmin çekirdeği (saf modül, LLM yok — bölünmez)

**Status:** done  
**Dependencies:** None  

Saf TypeScript modülü — Fastify/Prisma/env importu YOK (reports-metrics.ts felsefesi), tek başına unit-test edilebilir. GİRDİ: saat-bazlı geçmiş hacim (-e), ajan × saat presence kapsaması (-d), ajan başına eşzamanlı sohbet limiti (AgentMembership.concurrentChatsLimit, schema.prisma:132, default 6), ortalama sohbet süresi. ÇIKTI: gün × saat (7×24) ızgarasında {required_agents, scheduled_agents, gap

**Details:**

WORKSCHED-f — Deterministik staffing tahmin çekirdeği (saf modül, LLM yok — bölünmez)  [OPUS-MAX]

PRD: §5.3-Vardiya (WORKSCHED) — 'staffing prediction' payı · NFR-P7
ETİKET GEREKÇESİ: OPUS-MAX: YENİ ALGORİTMA TASARIMI — depoda kopyalanacak eşdeğer desen YOK (reports-metrics.ts yalnız round/resolutionRate gibi oran aritmetiği içeriyor), yani koşul 4 ihlali ve SONNET'in zorunlu 'referans_desen' alanı gerçek anlamda doldurulamıyor. Kapasite modeli yanlışsa tüm öneri ve ekran yanlış olur (yanlış kararın pahalı olduğu yüzey). Çekirdek bölünmez; girdi sorgusu (-e), presence kapsaması (-d), endpoint (-g) ve UI (-i) ayrı ve ucuz alt-görevlere çıkarıldı.
NEDEN AÇIK: apps/api/src/routes/reports-metrics.ts saf metrik modülü olarak var ama içeriği yalnız `round` ve `resolutionRate` (oran/yuvarlama) — personel ihtiyacı/kapsama açığı hesabı yok. Depo genelinde 'staffing|forecast' grep → 0 eşleşme.
KAPSAM: Saf TypeScript modülü — Fastify/Prisma/env importu YOK (reports-metrics.ts felsefesi), tek başına unit-test edilebilir. GİRDİ: saat-bazlı geçmiş hacim (-e), ajan × saat presence kapsaması (-d), ajan başına eşzamanlı sohbet limiti (AgentMembership.concurrentChatsLimit, schema.prisma:132, default 6), ortalama sohbet süresi. ÇIKTI: gün × saat (7×24) ızgarasında {required_agents, scheduled_agents, gap}. KURALLAR: deterministik — aynı girdi = aynı çıktı, rastgelelik/LLM yok (orkestratör kararı); örneklem eşiğinin altında required_agents = null + low_confidence = true (0 DEĞİL — bilinmeyen ≠ sıfır); limit 0/negatif → bölme-sıfır koruması ve açık hata.
DOSYALAR: apps/api/src/services/staffing/staffing-forecast.ts · apps/api/src/services/staffing/staffing-forecast.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports-metrics.ts
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Personel ihtiyacı tahmini geçmiş hacim ve presence verisinden deterministik olarak hesaplanır (aynı girdi = aynı çıktı, LLM yok); yeterli veri yoksa sayı üretilmez, 'yeterli veri yok' döner." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok ve §6'da satır yok; 'deterministik, LLM yok' kısıtı orkestratörün BAĞLAYICI kapsam kararından, 'null-when-empty' kuralı depodaki mevcut reports-metrics.ts sözleşmesinden türetildi."
KK DOĞRULAMA: staffing-forecast.test.ts'teki determinizm testi (aynı girdi iki kez → derin-eşit çıktı) KK-türetilmiş birinci cümleyi kanıtlar; 'sıfır hacim → null + low_confidence, 0 değil' testi ikinci cümleyi kanıtlar; modülün Fastify/Prisma import etmediğinin testi saf/deterministik iddiasını yapısal olarak kanıtlar.
KAPSAM DIŞI: Veri okuma/sorgu (WORKSCHED-d ve -e) · Endpoint ve kontrat (WORKSCHED-g) · UI (WORKSCHED-i) · Tahminin persist edilmesi — StaffingForecast tablosu AÇILMAZ (§C varsayımı) · LLM/ML tabanlı tahmin — kapsam dışı (orkestratör kararı)
SÖZLEŞME: yok (iç servis modülü)
MIGRATION: yok — tahmin API-time hesaplanır, kalıcı tablo açılmaz (§C varsayımı)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.7. WORKSCHED-g [OPUS-XHIGH] GET /reports/staffing-forecast — kontrat + üç girdinin tek yanıta bağlanması

**Status:** done  
**Dependencies:** 77.2, 77.4, 77.5, 77.6  

Contract-first: (1) packages/contract/openapi/paths/reports.yaml'a `staffingForecast` (GET /reports/staffing-forecast, from/to query — mevcut breakdown/aiAgent parametre bloğunun aynısı) + openapi.yaml `StaffingForecast` şeması + re-bundle. (2) reports.ts'e handler: rangeQuery/resolveRange ile aralık çözümü, `request.withTenant` içinde breakdownByHour (-e) + presence-coverage (-d) + work_schedules

**Details:**

WORKSCHED-g — GET /reports/staffing-forecast — kontrat + üç girdinin tek yanıta bağlanması  [OPUS-XHIGH]

PRD: §5.3-Vardiya (WORKSCHED) · NFR-S3 (scope), NFR-S4 (izolasyon), NFR-P7
ETİKET GEREKÇESİ: OPUS-XHIGH: YENİ yetkili endpoint — kullanıcının açık kuralı 'yeni bir yetkili endpoint eklemek EN AZ OPUS-XHIGH'. Ayrıca üç ayrı girdiyi (saat-bazlı hacim, presence kapsaması, vardiya planı) tek yanıt şekline bağlayan yeni veri-şekli tasarımı var (koşul 4 sınırda). Yeni scope açılmadığı ve izolasyon mevcut withTenant + RLS deseninden geldiği için MAX değil.
NEDEN AÇIK: packages/contract/openapi/paths altında 'schedule|staffing|WorkSchedule|Shift' grep → 0 eşleşme — staffing path'i yok. apps/api/src/routes/reports.ts'te /reports/overview, /reports/breakdown, /reports/ai-agent, /reports/reviews var; staffing endpoint'i yok.
KAPSAM: Contract-first: (1) packages/contract/openapi/paths/reports.yaml'a `staffingForecast` (GET /reports/staffing-forecast, from/to query — mevcut breakdown/aiAgent parametre bloğunun aynısı) + openapi.yaml `StaffingForecast` şeması + re-bundle. (2) reports.ts'e handler: rangeQuery/resolveRange ile aralık çözümü, `request.withTenant` içinde breakdownByHour (-e) + presence-coverage (-d) + work_schedules (-b) okunur, staffing-forecast (-f) çağrılır. (3) config.scopes = ['reports_read'] — YENİ SCOPE AÇILMAZ. (4) ADR-09 tutarlılığı: yanıttaki hacim sayıları /reports/breakdown by_hour ile birebir aynı (aynı helper).
DOSYALAR: packages/contract/openapi/paths/reports.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/reports.ts · apps/api/test/integration/staffing-forecast.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts · packages/contract/openapi/paths/reports.yaml · apps/api/test/integration/reports-billing.test.ts
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Seçilen tarih aralığı için gün × saat personel önerisi (gerekli / planlı / açık) tek uç noktadan okunur; sayılar aynı pencerenin hacim raporuyla çelişmez ve yalnız rapor yetkisi olan kullanıcı erişir." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok; erişim payı depodaki mevcut rapor uçlarının reports_read kapısından, tutarlılık payı ADR-09'dan (rapor = fatura aynı sayı) türetildi."
KK DOĞRULAMA: staffing-forecast.test.ts'teki 'staffing yanıtındaki saatlik hacim = /reports/breakdown by_hour' iddiası KK-türetilmiş tutarlılık maddesini, 403 testi erişim maddesini, ızgara testi 'gün × saat öneri' maddesini kanıtlar; contract-parity.test.ts yeşil kalması kontrat-kod paritesini kanıtlar.
KAPSAM DIŞI: UI (WORKSCHED-i) · CSV export'a staffing grubu eklemek — YAPILMAZ · Tahminin persist edilmesi / geçmiş tahmin karşılaştırması (açık soru 2)
SÖZLEŞME: packages/contract/openapi/paths/reports.yaml → `staffingForecast` (GET /reports/staffing-forecast); openapi.yaml → components.schemas.StaffingForecast. UYARI: yeni route OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts KIRILIR (proje notu). Yeni scope YOK → scopes.ts/scopes.test.ts sayacı değişmez.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.8. WORKSCHED-h [SONNET-XHIGH] Team → Work schedule düzenleyici (haftalık ızgara + timezone + alan-altı hata)

**Status:** done  
**Dependencies:** 77.1, 77.3  

TeamPage'e 'Work schedule' yüzeyi: 7 gün satırı (enabled toggle + start/end saat girdisi) + timezone seçici; apps/web/src/lib/form.tsx primitifi ile alan-altı hata (start ≥ end → satır-içi hata, geçersizken submit pasif) ve apps/web/src/lib/dirty-guard.tsx ile yarım-form kapatma onayı; GET/PUT /agents/{agentId}/work-schedule (WORKSCHED-c) çağrısı; hiç plan kaydedilmemişse components/EmptyState.tsx

**Details:**

WORKSCHED-h — Team → Work schedule düzenleyici (haftalık ızgara + timezone + alan-altı hata)  [SONNET-XHIGH]

PRD: §5.3-Vardiya (WORKSCHED) + FR-EK-A.1 (tek form/validasyon), FR-EK-B.1 (anlamlı empty state)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 3 dosya + test; güvenlik kararı tamamen backend'de (WORKSCHED-c'deki scope/403 kapısı), ekran yalnız form; eşzamanlılık yok; kopyalanacak desen İSMEN var: WidgetCustomization.tsx (config formu + kaydet), InviteTeammates.tsx (form + alan-altı hata), apps/web/src/lib/form.tsx (T4-a primitifi); kontrat değişikliği yok; KK mekanik (render + hata + submit-disabled).
NEDEN AÇIK: apps/web/src/features/team/ yalnız TeamPage.tsx, InviteTeammates.tsx, TeamAiPerformance.tsx, CopilotKnowledge.tsx (+ testleri) içeriyor — ekip yönetimi davet/AI performans/knowledge kapsıyor; vardiya takvimi/shift planlama ekranı yok. apps/web/src/features altında (15 klasör) hiçbir vardiya ekranı yok.
KAPSAM: TeamPage'e 'Work schedule' yüzeyi: 7 gün satırı (enabled toggle + start/end saat girdisi) + timezone seçici; apps/web/src/lib/form.tsx primitifi ile alan-altı hata (start ≥ end → satır-içi hata, geçersizken submit pasif) ve apps/web/src/lib/dirty-guard.tsx ile yarım-form kapatma onayı; GET/PUT /agents/{agentId}/work-schedule (WORKSCHED-c) çağrısı; hiç plan kaydedilmemişse components/EmptyState.tsx ile anlamlı empty state (boş dikdörtgen yok).
DOSYALAR: apps/web/src/features/team/WorkSchedule.tsx · apps/web/src/features/team/WorkSchedule.test.tsx · apps/web/src/features/team/TeamPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/WidgetCustomization.tsx · apps/web/src/features/settings/WidgetCustomization.test.tsx · apps/web/src/features/team/InviteTeammates.tsx · apps/web/src/lib/form.tsx · apps/web/src/components/EmptyState.tsx
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Haftalık vardiya planı ekrandan gün gün düzenlenir (etkin/başlangıç/bitiş + timezone); geçersiz saat aralığında alan-altı hata gösterilir ve kaydet pasifleşir; plan yoksa anlamlı bir boş durum gösterilir." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok; form davranış payı PRD FR-EK-A.1 ("Tek form/validasyon kütüphanesi; alan-altı hata mesajı") ve FR-EK-B.1 ("her boş liste için anlamlı empty state (boş dikdörtgen yok)") maddelerinden türetildi. Destek: rapor-1-fonksiyonel.md:2164 — "➕ Zaman tasarrufu + tutarlılık + vardiya devri.""
KK DOĞRULAMA: WorkSchedule.test.tsx'teki 'start ≥ end → alan-altı hata + submit pasif' testi KK-türetilmiş ikinci maddeyi (ve FR-EK-A.1'i), '7 gün render + kaydet → normalize gövde' testi birinci maddeyi, 'plan yok → EmptyState metni' testi üçüncü maddeyi (FR-EK-B.1) kanıtlar.
KAPSAM DIŞI: Tahmin ekranı (WORKSCHED-i) · Vardiya devri/handover akışı · Grup/ekip bazlı vardiya (§C varsayımı: ajan bazlı) · Takvimde sürükle-bırak düzenleme — yapılmaz (basit gün satırı ızgarası)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.9. WORKSCHED-i [SONNET-XHIGH] Reports → Staffing sekmesi (salt-okunur gün × saat ızgarası + düşük-baz uyarısı)

**Status:** done  
**Dependencies:** 77.7  

ReportsPage'e 5. sekme 'Staffing': GET /reports/staffing-forecast (-g) mevcut `useReport` hook'u ve paylaşılan aralık kontrolüyle çağrılır; gün × saat ızgarası (required / scheduled / gap) render edilir, gap > 0 hücreleri vurgulanır; low_confidence/null hücreler '—' + 'yeterli veri yok' uyarısıyla gösterilir (0 YAZILMAZ); pencerede hiç veri yoksa anlamlı empty state. Mevcut sekme kabuğunun role=ta

**Details:**

WORKSCHED-i — Reports → Staffing sekmesi (salt-okunur gün × saat ızgarası + düşük-baz uyarısı)  [SONNET-XHIGH]

PRD: §5.3-Vardiya (WORKSCHED) + FR-EK-B.1 (empty state) · NFR-A11Y (sekme rolleri)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2 dosya; salt-okunur rapor sekmesi, hiçbir güvenlik/yetki kararı içermiyor (scope kapısı -g'de); eşzamanlılık yok; kopyalanacak desen İSMEN var: ReportsPage.tsx'in TABS + role="tablist" kabuğu (satır 182-226) ve BreakdownTab; hesap backend'de (-f), ekran yalnız render; kontrat değişikliği yok; KK mekanik.
NEDEN AÇIK: apps/web/src/features/reports/ReportsPage.tsx'te sekmeler overview / ai-agent / reviews / breakdown ile sınırlı (satır 219-226'daki dallanma); staffing sekmesi yok.
KAPSAM: ReportsPage'e 5. sekme 'Staffing': GET /reports/staffing-forecast (-g) mevcut `useReport` hook'u ve paylaşılan aralık kontrolüyle çağrılır; gün × saat ızgarası (required / scheduled / gap) render edilir, gap > 0 hücreleri vurgulanır; low_confidence/null hücreler '—' + 'yeterli veri yok' uyarısıyla gösterilir (0 YAZILMAZ); pencerede hiç veri yoksa anlamlı empty state. Mevcut sekme kabuğunun role=tab/tabpanel + aria-controls deseni birebir korunur.
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx · apps/web/src/components/EmptyState.tsx
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Personel önerisi raporda gün × saat ızgarası olarak görünür; gerekli-planlı farkı (açık) vurgulanır; veri yetersizse sayı yerine 'yeterli veri yok' uyarısı gösterilir (sıfır gösterilmez)." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok; 'sıfır gösterilmez' payı depodaki mevcut rapor sözleşmesinden (oy yoksa null — %0 felaket gibi okunur) ve FR-EK-B.1 empty-state maddesinden türetildi."
KK DOĞRULAMA: ReportsPage.test.tsx'teki 'low_confidence → uyarı metni, 0 render edilmez' testi KK-türetilmiş üçüncü maddeyi, 'gap > 0 hücresi vurgu sınıfı taşır' testi ikinci maddeyi, 'Staffing sekmesi tıklanınca 7×24 ızgara render edilir' testi birinci maddeyi kanıtlar; role=tab/aria-controls iddiası a11y desenini kanıtlar.
KAPSAM DIŞI: Tahmin aritmetiğini istemcide yeniden hesaplamak — YAPILMAZ (tek doğruluk kaynağı backend -f) · CSV/PDF export · Vardiya düzenleme (WORKSCHED-h)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 77.10. WORKSCHED-j [OPUS-XHIGH] Uçtan uca doğrulama: staffing e2e akışı + izolasyon iddiaları + ADR-09 sayı tutarlılığı

**Status:** done  
**Dependencies:** 77.3, 77.4, 77.7, 77.8, 77.9  

(1) apps/e2e/staffing.spec.ts: Team ekranında vardiya kaydet → ajan uygunluk durumunu değiştir (presence olayı yazılır) → Reports ▸ Staffing sekmesinde ızgara ve 'yeterli veri yok' durumu görünür. (2) apps/api/test/integration/tenant-isolation.test.ts'e work_schedules + agent_presence_events satırları (iki lisans fixture'ı). (3) ADR-09 tutarlılık iddiası: staffing yanıtındaki saatlik hacim = /repo

**Details:**

WORKSCHED-j — Uçtan uca doğrulama: staffing e2e akışı + izolasyon iddiaları + ADR-09 sayı tutarlılığı  [OPUS-XHIGH]

PRD: §5.3-Vardiya (WORKSCHED) — kalem kapanış kapısı · NFR-S4, NFR-R3, NFR-M2
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama doğrulaması (kontrat + DB/RLS + backend + presence yazma yolu + iki ekran) ve iddiaların hangi katmanda kanıtlandığına dair yorum gerektiriyor; cross-tenant fixture kurgusu güvenlik hassasiyeti taşıyor → kullanıcı kuralı gereği SONNET OLAMAZ. Yeni güvenlik çekirdeği yazılmadığı için MAX değil.
NEDEN AÇIK: apps/e2e altında 20 spec var (reports.spec.ts, team.spec.ts, settings.spec.ts, traffic.spec.ts …) ve vardiya/staffing akışı için spec yok. PLAN.md §5.1 (satır 1130) bu kalemi atomik kırılıma açmamıştı ve §G İş Kırılımı Dizini'nde (satır 1264+) ayrı satırı yok — Task Master'a hiç aktarılmamış, kapanış kanıtı da yok.
KAPSAM: (1) apps/e2e/staffing.spec.ts: Team ekranında vardiya kaydet → ajan uygunluk durumunu değiştir (presence olayı yazılır) → Reports ▸ Staffing sekmesinde ızgara ve 'yeterli veri yok' durumu görünür. (2) apps/api/test/integration/tenant-isolation.test.ts'e work_schedules + agent_presence_events satırları (iki lisans fixture'ı). (3) ADR-09 tutarlılık iddiası: staffing yanıtındaki saatlik hacim = /reports/breakdown by_hour. (4) DoD kanıtı HANDOFF.md'ye yazılır. NOT: e2e temiz DB ister — truncate+reseed, .env source, portlar boş (proje notu); DB süitleri paket bazlı SERİ koşulur.
DOSYALAR: apps/e2e/staffing.spec.ts · apps/api/test/integration/tenant-isolation.test.ts · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/e2e/reports.spec.ts · apps/e2e/team.spec.ts · apps/e2e/fixtures.ts
KK (birebir): "| Ekip/Vardiya | Work scheduler / staffing prediction |" | "KK-türetilmiş: "Vardiya planı → presence kaydı → personel önerisi zinciri uçtan uca çalışır; bir lisansın vardiya/presence verisi başka lisansta hiçbir yüzeyde görünmez; öneri ekranındaki hacim sayıları hacim raporuyla aynıdır." — Türetme gerekçesi: PRD §5.3 satır 412'de KK sütunu yok; zincir maddesi bu kalemin alt-görevlerinin bileşimidir, izolasyon maddesi NFR-S4'ten, sayı tutarlılığı ADR-09'dan türetildi."
KK DOĞRULAMA: staffing.spec.ts uçtan uca zincirin çalıştığını (birinci madde), tenant-isolation.test.ts'e eklenen iki tablo satırı izolasyonu (ikinci madde), staffing↔breakdown karşılaştırması ADR-09 tutarlılığını (üçüncü madde) kanıtlar. DoD kapısı (typecheck+lint+unit+integration+build+e2e) HANDOFF'a kanıtla yazılır.
KAPSAM DIŞI: Yeni özellik eklemek — bu alt-görev yalnız doğrulama/kanıt · Performans/yük testi (NFR-P7 ölçümü ayrı kalem) · PLAN.md §G / Task Master satır senkronu (ayrı iş)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
