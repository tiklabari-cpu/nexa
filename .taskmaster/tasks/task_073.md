# Task ID: 73

**Title:** 13.2 — Engage/Traffic (gelişmiş filtre + 360° ziyaretçi)  ·  dilim V2-8

**Status:** done

**Dependencies:** 78 ✓

**Priority:** low

**Description:** FR-MOD-13.2 · Should (v2) · MOD-03.1.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `13.2`.

11 atomik alt-görev · ~13 pencere · etiket dağılımı: OPUS-MAX x2 · OPUS-XHIGH x4 · SONNET-XHIGH x5

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  13.2-a [SONNET-XHIGH] TrafficActivity sözlüğünün supervised + invited ile genişletilmesi (kontrat + tip + web etiket haritası)  (bağ: yok)
  13.2-b [OPUS-XHIGH] `invited` durumu: campaign_sends'ten türetme + funnel öncelik kararı (backend)  (bağ: 13.2-a)
  13.2-c [OPUS-XHIGH] `chat_supervisions` tablosu + RLS politikası + Prisma modeli (yalnız migration, route yok)  (bağ: yok)
  13.2-d [OPUS-MAX] Supervision register/release API + yetki sınırı + heartbeat (BÖLÜNMEZ GÜVENLİK ÇEKİRDEĞİ)  (bağ: 13.2-c)
  13.2-e [OPUS-XHIGH] `supervised` durumunun Traffic funnel'ına bağlanması + öncelik sırası  (bağ: 13.2-a, 13.2-d)
  13.2-f [OPUS-MAX] "Match all filters + Add filter": GET /traffic çoklu-koşul filtre çekirdeği (kontrat + backend)  (bağ: 13.2-a, 13.2-b, 13.2-e)
  13.2-g [SONNET-XHIGH] Traffic durum sekmeleri (All/Chatting/Supervised/Queued/Waiting/Invited/Browsing) + sayaç + anlamlı empty state  (bağ: 13.2-f)
  13.2-h [SONNET-XHIGH] "Match all filters + Add filter" filtre paneli UI + query builder  (bağ: 13.2-f, 13.2-g)
  13.2-i [SONNET-XHIGH] CustomerDetail'e `visits_count` + `groups[]` (kontrat + servis)  (bağ: yok)
  13.2-j [SONNET-XHIGH] Ziyaretçi 360° panel: N visits özeti + Came from + Groups kartları (UI)  (bağ: 13.2-i)
  13.2-k [OPUS-XHIGH] Uçtan uca doğrulama: E2E (sekme + filtre + supervise + 360° panel) + NFR-P2 ölçümü + a11y kanıtı  (bağ: 13.2-a, 13.2-b, 13.2-c, 13.2-d, 13.2-e, 13.2-f, 13.2-g, 13.2-h, 13.2-i, 13.2-j)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): İki bölünmez çekirdek var. (1) **13.2-d** (supervision register/release): "kim hangi sohbeti izleyebilir" kararı (`chats--all:ro` global mi, `chats--access:ro` yalnız kendi grubunun `chat_access` üzerinden eriştiği sohbet mi), IDOR deseni (başka kiracının chatId'si → 404, 403 DEĞİL) ve iki ajanın aynı sohbeti eşzamanlı izlemesi/serbest bırakması (idempotent upsert + yalnız kendi satırını silme) tek bir akıl yürütmenin parçaları; ayrıştırılırsa "endpoint var ama yetki yarım" ara durumu doğar ve tam da orada sızıntı olur. Çekirdeğin ETRAFINDAKİ her şey ayrıştırıldı: tablo+RLS 13.2-c'ye (OPUS-XHIGH), funnel bağlama 13.2-e'ye (OPUS-XHIGH), UI 13.2-g/-h'ye (SONNET-XHIGH). (2) **13.2-f** (filtre predicate derleyicisi): istemciden gelen koşulların çok-kiracılı bir sorguya çevrilmesi — allowlist, tenant kapısı (`group_id` başka kiracıya sızmamalı) ve sorgu şekli (NFR-P2 bütçesi; Visit.pages JSONB üzerinde indekssiz tarama riski) aynı kararın üç yüzü. Filtre UI'ı (13.2-h) ve sekmeler (13.2-g) bu çekirdekten tamamen ayrıldı ve SONNET'e verildi.

VARSAYIMLAR: **Supervised kalıcı tabloyla modellenir, RTM/Redis presence ile DEĞİL.** `chat_supervisions` (chat_id, agent_id, license_id, started_at, last_seen_at) + heartbeat penceresi. Gerekçe: depo test kültürü Postgres'e karşı integration testidir (traffic.test.ts, tenant-isolation.test.ts); RTM presence'ın DoD kapısında deterministik kanıtı yoktur ve ADR-11 Redis'i pub/sub + Streams için tutar, yetki kaydı için değil. Redis TTL alternatifi bilinçli olarak reddedildi. · **Invited = `campaign_sends` satırı `engaged = false` ve canlı pencere içinde.** Yeni kolon/tablo açılmaz; CampaignSend zaten 'davet gönderildi' anlamını taşıyor (campaign-service.ts:238 `#fireIfRunning` tek yazıcı) ve `engaged` bayrağı 'ziyaretçi yanıtladı'yı ayırıyor. Bu ara durumu okuyan hiç kimse yoktu; 13.2-b onu bağlar. · **Ziyaretçi 'groups' = müşterinin bu lisanstaki sohbetlerine `chat_access` üzerinden erişen ajan grupları.** Yeni `customer_groups` segment tablosu AÇILMAZ. Gerekçe: v2-03 §7.2'deki `customer_groups` alanı RTM login payload'ının `__priv_dynamic_config`'i (widget grup yönlendirmesi), müşteri segmenti değil; PRD 13.2 hangi grup kavramını kastettiğini söylemiyor; `chat_access` zaten yazılıyor (chat-service.ts:947/1246) ve routing tarafından okunuyor (routing-service.ts:142) — 'bu ziyaretçiye hangi takım bakıyor' sorusunun kodda karşılığı olan tek cevabı odur. Mevcut agent `Group` modeli (schema.prisma:311) doğrudan ziyaretçiye BAĞLANMAZ, yalnız chat_access üzerinden türetilir. · **'Match all filters' = ayrık, AND'lenen query parametreleri** (`activity`, `page_url_contains`, `came_from_contains`, `country_code`, `is_lead`, `group_id`), JSON koşul dizisi değil. Gerekçe: OpenAPI'de ifade edilebilir, mevcut `GET /customers` `segment`/`query` deseniyle tutarlı, önbelleklenebilir ve `.strict()` zod ile bilinmeyen anahtar 400'e döner. 'Match any' (OR) kapsam dışı — PRD birebir 'Match all filters' diyor. · **Funnel öncelik sırası: `queued` > `supervised` > `waiting` > `chatting`;** `invited` yaln

AÇIK SORULAR (ürün kararı): Supervision heartbeat penceresi kaç dakika olmalı? Traffic'in `LIVE_WINDOW_MINUTES = 30` sabitiyle aynı olursa bir ajanın 25 dk önce kapattığı sekme hâlâ 'Supervised' gösterir. Öneri: 2 dk heartbeat + 5 dk canlılık penceresi — onay gerekiyor. · `chats--all:ro` taşıyan HER ajan her sohbeti izleyebilmeli mi, yoksa ek olarak bir rol şartı (owner/viceowner/admin) da aranmalı mı? PRD rol matrisi 'supervise' için ayrı bir izin tanımlamıyor; mevcut `rowActions.ts` yalnız okuma scope'una bakıyor. Yanlış kararın maliyeti: her ajan her sohbeti izleyebilir. · Ziyaretçi 'groups' için varsayım 3 (chat_access'ten türetme) onaylanıyor mu, yoksa gerçekten ayrı bir `customer_groups` segment tablosu mu isteniyor? İkincisi seçilirse migration + CRUD + atama UI'ı gerekir (≈3 pencere daha) ve 13.2-i/-j yeniden bölünmelidir. · Filtre `group_id` parametresi, `chats--access:ro` ile sınırlı bir ajan kendi grupları dışında bir değer verdiğinde 400 mü dönmeli, yoksa sessizce boş sonuç mu? (İkisi de sızıntı yapmaz; 400 daha açık, boş sonuç grup id'lerini enumerable yapmaz — repo deseni 404/boş tarafında.)

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 73.1. 13.2-a [SONNET-XHIGH] TrafficActivity sözlüğünün supervised + invited ile genişletilmesi (kontrat + tip + web etiket haritası)

**Status:** done  
**Dependencies:** None  

Contract-first, tek turda üç katman senkronlanır: (1) `packages/contract/openapi/openapi.yaml` → `TrafficVisitor.activity` enum'ı 4→6 (`supervised`, `invited`); (2) `paths/traffic.yaml` açıklamasındaki funnel maddelerine iki satır; (3) `pnpm --filter @siyahtus/contract generate` ile re-bundle + `src/generated/api.ts` yenilenir; (4) `traffic-service.ts` `TrafficActivity` union'ı ve web `types.ts` union

**Details:**

13.2-a — TrafficActivity sözlüğünün supervised + invited ile genişletilmesi (kontrat + tip + web etiket haritası)  [SONNET-XHIGH]

PRD: FR-MOD-13.2 (+ FR-MOD-03.1.1)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 5 dosya + testleri; güvenlik sınırı yok (enum değeri eklemek authN/authZ/izolasyon kararı değil, hiçbir yetki dalı değişmiyor); eşzamanlılık yok; kopyalanacak desen ismen var (openapi.yaml:1102-1105 mevcut 4 enum değeri + TrafficPage.tsx:28-33 ACTIVITY map'i); değişiklik tamamen katkısal (additive) ve mekanik; KK mekanik olarak doğrulanır (contract-parity yeşil + exhaustive Record derleme zorunluluğu).
NEDEN AÇIK: openapi.yaml:1104 `activity` enum'ı tam olarak `[browsing, queued, waiting, chatting]`; traffic-service.ts satır 20 `export type TrafficActivity = 'browsing' | 'queued' | 'waiting' | 'chatting'`; apps/web/src/features/traffic/types.ts aynı 4 değerli union'ı, TrafficPage.tsx satır 28-33 `ACTIVITY` map'i aynı 4 anahtarı taşıyor. rapor-1 §644 sekme listesi yedi öğe sayıyor — 'Supervised' ve 'Invited' üç katmanın hiçbirinde yok.
KAPSAM: Contract-first, tek turda üç katman senkronlanır: (1) `packages/contract/openapi/openapi.yaml` → `TrafficVisitor.activity` enum'ı 4→6 (`supervised`, `invited`); (2) `paths/traffic.yaml` açıklamasındaki funnel maddelerine iki satır; (3) `pnpm --filter @siyahtus/contract generate` ile re-bundle + `src/generated/api.ts` yenilenir; (4) `traffic-service.ts` `TrafficActivity` union'ı ve web `types.ts` union'ı genişletilir; (5) `TrafficPage.tsx` `ACTIVITY` map'ine `supervised` (tone 'info') + `invited` (tone 'warning') satırları. Servis bu iki değeri HENÜZ üretmez — üretimi 13.2-b ve 13.2-e yapar; bu adım yalnız sözlüğü tek yerden senkronlar ve contract-parity kırılma riskini tek pencereye hapseder.
DOSYALAR: packages/contract/openapi/openapi.yaml · packages/contract/openapi/paths/traffic.yaml · apps/api/src/services/traffic/traffic-service.ts · apps/web/src/features/traffic/types.ts · apps/web/src/features/traffic/TrafficPage.tsx
REFERANS DESEN (kopyalanacak): packages/contract/openapi/openapi.yaml (satır 1089-1119, TrafficVisitor şeması + mevcut enum) · apps/web/src/features/traffic/TrafficPage.tsx (satır 28-33, ACTIVITY Record map'i) · apps/api/src/services/traffic/traffic-service.ts (satır 20, union tanımı)
KK (birebir): "Gelişmiş filtre" | "KK-türetilmiş: Traffic funnel sözlüğü `Supervised` ve `Invited` durumlarını içerir. Türetme kaynağı rapor-1 §644 birebir: "Öğeler: All · Chatting · Supervised · Queued · Waiting for reply · Invited · Browsing (gözlemde hepsi 0)." — PRD 13.2 KK'sı yalnız 'Gelişmiş filtre' diyor, filtrelenebilir durum listesini vermiyor; liste rapor-1'den alındı."
KK DOĞRULAMA: contract-parity.test.ts yeşil kalır (yeni PATH eklenmediği, yalnız şema enum'ı genişlediği için çift yönlü parity bozulmaz) — bu, kontratın koda karşı hâlâ doğru olduğunun kanıtı. `ACTIVITY` bir `Record<TrafficActivity, …>` olduğu için eksik anahtar `pnpm typecheck`'te derleme hatası verir; bu da sözlüğün üç katmanda senkron olduğunun mekanik kanıtıdır.
KAPSAM DIŞI: Backend'in supervised/invited üretmesi (13.2-b, 13.2-e) · Sekme UI'ı (13.2-g) · Filtre parametreleri (13.2-f) · chat_supervisions tablosu (13.2-c)
SÖZLEŞME: packages/contract/openapi/openapi.yaml → `TrafficVisitor.activity` enum'ına `supervised` + `invited`; paths/traffic.yaml `listTraffic` açıklaması. YENİ PATH YOK. Re-bundle ZORUNLU (`pnpm --filter @siyahtus/contract generate`) — aksi hâlde üretilmiş tipler bayatlar ve contract-parity.test.ts kırılır.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.2. 13.2-b [OPUS-XHIGH] `invited` durumu: campaign_sends'ten türetme + funnel öncelik kararı (backend)

**Status:** done  
**Dependencies:** 73.1  

Backend-only (sözlük 13.2-a'da eklendi). `TrafficService.listLive` üçüncü kaynağı okur: `tx.campaignSend.findMany({ where: { licenseId: tenant.licenseId, engaged: false, createdAt: { gte: liveSince }, customer: { organizationId: tenant.organizationId } } })` — tenant filtresi aynı dosyadaki visits bloğundan BİREBİR kopyalanır (NFR-S4). Funnel öncelik: aktif sohbeti olan ziyaretçi sohbet durumunu k

**Details:**

13.2-b — `invited` durumu: campaign_sends'ten türetme + funnel öncelik kararı (backend)  [OPUS-XHIGH]

PRD: FR-MOD-13.2 (+ FR-MOD-03.1.1, FR-MOD-03.3.2; NFR-S4)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni veri şekli/sorgu tasarımı — hangi CampaignSend satırının 'invited' sayılacağı ve invited'ın browsing/chatting karşısında nerede duracağı KK'da yazmıyor, yorum gerektiriyor (koşul 4 ve 6 ihlali). Ayrıca çok-kiracılı bir okuma servisine ÜÇÜNCÜ bir kaynak bağlanıyor; tenant filtresi taşındığı için hafif güvenlik dokunuşu var → kullanıcı kuralı gereği SONNET'e verilmez. Çekirdek güvenlik sınırı (yetki kararı) olmadığı için MAX değil.
NEDEN AÇIK: traffic-service.ts `listLive` yalnız iki kaynağı birleştiriyor: `tx.chat.findMany` (aktif sohbetler) ve `tx.visit.findMany` (son 30 dk ziyaretler); `campaignSend` bu dosyada hiç geçmiyor. CampaignSend modeli (schema.prisma:789-809) `engaged`/`converted` boolean'larını tutuyor ve tek yazıcısı campaign-service.ts:238 `#fireIfRunning` — yani 'davet gönderildi ama ziyaretçi henüz yanıtlamadı' hâli VERİDE VAR (`engaged=false`) ama hiçbir okuyucu onu Traffic listesine yansıtmıyor.
KAPSAM: Backend-only (sözlük 13.2-a'da eklendi). `TrafficService.listLive` üçüncü kaynağı okur: `tx.campaignSend.findMany({ where: { licenseId: tenant.licenseId, engaged: false, createdAt: { gte: liveSince }, customer: { organizationId: tenant.organizationId } } })` — tenant filtresi aynı dosyadaki visits bloğundan BİREBİR kopyalanır (NFR-S4). Funnel öncelik: aktif sohbeti olan ziyaretçi sohbet durumunu korur (invited'a düşmez); aktif sohbeti olmayan ama canlı pencerede açık daveti olan ziyaretçi `browsing` yerine `invited` görünür; davet + ziyaret ikisi de yoksa satır üretilmez. Mevcut 'her ziyaretçi tam bir kovada' kuralı ve limit/over-fetch mantığı korunur.
DOSYALAR: apps/api/src/services/traffic/traffic-service.ts · apps/api/test/integration/traffic.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/traffic/traffic-service.ts (aynı dosyadaki visits bloğu: tenant filtre + over-fetch + JS de-dup) · apps/api/src/services/campaigns/campaign-service.ts (#fireIfRunning — aynı liveSince/organizationId kapısı)
KK (birebir): "proaktif aksiyon" | "KK-türetilmiş: 'Invited' = aktif kampanya daveti gönderilmiş ama ziyaretçi henüz yanıtlamamış (`campaign_sends.engaged = false`). Türetme gerekçesi: PRD 13.2 KK'sı yalnız 'proaktif aksiyon' diyor, durumun veri kaynağını söylemiyor; kaynak seçimi §C varsayımı olarak kaydedildi (yeni kolon açmadan mevcut CampaignSend bayrağı)."
KK DOĞRULAMA: integration `traffic.test.ts`: (a) `engaged=false` CampaignSend'i olan ve aktif sohbeti olmayan müşteri → `activity === 'invited'`; (b) `engaged=true` olan send invited üretmez; (c) aktif sohbeti olan ziyaretçide invited, sohbet durumunu EZMEZ; (d) cross-tenant: B lisansının campaign_sends satırı A'nın yanıtında hiç görünmez (NFR-S4).
KAPSAM DIŞI: supervised durumu (13.2-c/-d/-e) · kampanya tetikleyicisinin kendisi (FR-MOD-03.3.2 teslim — campaign-service.ts'e dokunulmaz) · Sekme/filtre UI (13.2-g/-h) · Davet mesajının içeriği veya gönderimi
SÖZLEŞME: yok (enum 13.2-a'da eklendi; yanıt şekli değişmiyor, yalnız mevcut alanın alabileceği değer artıyor).
MIGRATION: yok — `campaign_sends.engaged` mevcut kolon (schema.prisma:797), yeni kolon gerekmiyor.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.3. 13.2-c [OPUS-XHIGH] `chat_supervisions` tablosu + RLS politikası + Prisma modeli (yalnız migration, route yok)

**Status:** done  
**Dependencies:** None  

Yalnız veri katmanı. (1) Prisma modeli `ChatSupervision`: `chatId VarChar(12)` (FK chats), `agentId uuid` (FK accounts), `licenseId BigInt` (FK licenses), `startedAt`, `lastSeenAt`; `@@id([chatId, agentId])`; `@@index([licenseId, lastSeenAt(sort: Desc)])`. (2) migration.sql: CREATE TABLE + FK'ler + `ALTER TABLE chat_supervisions ENABLE ROW LEVEL SECURITY` + `CREATE POLICY chat_supervisions_tenant 

**Details:**

13.2-c — `chat_supervisions` tablosu + RLS politikası + Prisma modeli (yalnız migration, route yok)  [OPUS-XHIGH]

PRD: FR-MOD-13.2 (+ FR-MOD-03.1.1; NFR-S4)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni tablo doğrudan çok-kiracılı izolasyon yüzeyine giriyor — RLS politikası unutulur veya yanlış yazılırsa kiracı sızıntısı olur (koşul 2 ihlali) → kullanıcı kuralı gereği SONNET OLAMAZ. Ancak politika mevcut `campaign_sends` migration'ından birebir kopyalanabilir ve endpoint yetki kararı bu alt-görevde YOK; pahalı MAX penceresi (13.2-d) küçültülsün diye bilinçli olarak ayrıştırıldı, bu yüzden MAX değil.
NEDEN AÇIK: grep: 'supervisor' depoda yalnız yorum/docstring metninde geçiyor; şemada bir sohbeti kimin izlediğini tutan tablo/alan/kolon yok. UI'da `supervise` aksiyonu hiçbir yere yazmıyor — TrafficPage.tsx satır ~95 kendi yorumunda söylüyor: 'Watching is just opening the conversation in the inbox' ve yalnız `navigate('/app/inbox?chat=…')` çalıştırıyor. Yani 'Supervised' durumunun kaynak verisi SIFIR.
KAPSAM: Yalnız veri katmanı. (1) Prisma modeli `ChatSupervision`: `chatId VarChar(12)` (FK chats), `agentId uuid` (FK accounts), `licenseId BigInt` (FK licenses), `startedAt`, `lastSeenAt`; `@@id([chatId, agentId])`; `@@index([licenseId, lastSeenAt(sort: Desc)])`. (2) migration.sql: CREATE TABLE + FK'ler + `ALTER TABLE chat_supervisions ENABLE ROW LEVEL SECURITY` + `CREATE POLICY chat_supervisions_tenant ON chat_supervisions …` (campaign_sends politikasının birebir eşi) + indeks. (3) Prisma client regenerate. ROUTE VE OPENAPI PATH YOK — bilinçli: contract-parity.test.ts çift yönlü çalışıyor (implementedOperations ↔ documentedOperations), handler'sız bir path testi kırar; path ancak handler'ıyla birlikte 13.2-d'de eklenir.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/<yeni>/migration.sql · apps/api/test/integration/data-model.test.ts · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260726170000_campaign_sends/migration.sql (tablo + RLS + indeks üçlüsünün en küçük ve en yeni örneği) · apps/api/prisma/schema.prisma (satır 789-809, CampaignSend modeli: licenseId + FK + @@index deseni) · apps/api/prisma/migrations/20260726090000_webhook_deliveries/migration.sql (CREATE POLICY …_tenant örneği)
KK (birebir): "KK-türetilmiş: bir sohbeti hangi ajanın şu an izlediği kalıcı ve kiracı-kapsamlı olarak kaydedilir. Türetme kaynağı rapor-1 §678 birebir: "Supervise → mevcut sohbeti izler" ve §644'teki 'Supervised' öğesi. PRD 13.2 KK'sı ('Gelişmiş filtre; ziyaretçi geçmişi; proaktif aksiyon') veri modelini söylemiyor; kalıcı tablo tercihi §C varsayımı olarak kaydedildi (Redis/RTM presence alternatifi reddedildi — DoD kapısında deterministik kanıtı yok)."
KK DOĞRULAMA: data-model.test.ts: `chat_supervisions` tablosu var; `pg_class.relrowsecurity` true; `pg_policies` içinde `chat_supervisions_tenant` mevcut. tenant-isolation.test.ts: A lisansının supervision satırı B kiracısının oturumunda 0 satır döner — RLS unutulursa bu test KIRMIZI olur, kanıt budur.
KAPSAM DIŞI: register/release endpoint ve yetki kararı (13.2-d) · Traffic listesine bağlama (13.2-e) · OpenAPI path'i (bilinçli olarak açılmaz — parity çift yönlü) · Redis/RTM presence yaklaşımı (§C'de reddedildi)
SÖZLEŞME: yok — bilinçli olarak OpenAPI'ye DOKUNULMAZ. contract-parity.test.ts hem belgesiz route'u hem servissiz path'i fail ettiği için, handler'sız bir path eklemek bu pencereyi kırardı.
MIGRATION: EVET — yeni tablo `chat_supervisions` (chat_id, agent_id, license_id, started_at, last_seen_at) + `chat_supervisions_tenant` RLS politikası + `(license_id, last_seen_at DESC)` indeksi.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.4. 13.2-d [OPUS-MAX] Supervision register/release API + yetki sınırı + heartbeat (BÖLÜNMEZ GÜVENLİK ÇEKİRDEĞİ)

**Status:** done  
**Dependencies:** 73.3  

Kontrat + backend AYNI pencerede (parity çift yönlü). `POST /chats/{chatId}/supervise` — idempotent upsert, `lastSeenAt` yenilenir (heartbeat); `DELETE /chats/{chatId}/supervise` — yalnız çağıranın kendi satırı silinir. Scope: `chats--all:ro` / `chats--access:ro` — YAZMA scope'u İSTENMEZ (izleme bir okumadır; rowActions.ts'teki mevcut karar korunur: 'A read, so it needs no write scope'). `chats--a

**Details:**

13.2-d — Supervision register/release API + yetki sınırı + heartbeat (BÖLÜNMEZ GÜVENLİK ÇEKİRDEĞİ)  [OPUS-MAX]

PRD: FR-MOD-13.2 (+ FR-MOD-03.1.1; NFR-S4, NFR-S5)
ETİKET GEREKÇESİ: OPUS-MAX: authZ + tenant izolasyon sınırı (koşul 2 ihlali) VE eşzamanlılık/yarış akıl yürütmesi (koşul 3 ihlali) bir arada. Karar verilecekler: hangi scope izlemeye yeter (`chats--all:ro` global mi, `chats--access:ro` yalnız kendi grubunun `chat_access` üzerinden eriştiği sohbet mi), IDOR yanıtı (başka kiracının chatId'si → 404, 403 DEĞİL), bir ajanın yalnız KENDİ supervision satırını serbest bırakabilmesi ve aynı ajanın tekrar POST'unun idempotent upsert olması. Bu çekirdek daha küçüğe BÖLÜNMEZ: yetki kuralı, kimlik ve heartbeat penceresi aynı akıl yürütmenin parçaları; ayrıştırılırsa 'endpoint var, yetki yarım' ara durumu doğar. Etraftaki her şey (tablo+RLS → 13.2-c, funnel → 13.2-e, UI → 13.2-g) zaten çıkarıldı.
NEDEN AÇIK: Sunucuda 'izleme' diye bir kavram yok: `supervise` yalnız web tarafında bir navigate (TrafficPage.tsx). Buna karşılık grup bazlı erişim verisi VAR — chat-service.ts:947-948 ve :1246 `chatAccess` yazıyor, routing-service.ts:142 okuyor — yani 'bu ajan bu sohbeti görebilir mi' sorusunun cevabı kodda mevcut ama izleme akışında hiç sorulmuyor.
KAPSAM: Kontrat + backend AYNI pencerede (parity çift yönlü). `POST /chats/{chatId}/supervise` — idempotent upsert, `lastSeenAt` yenilenir (heartbeat); `DELETE /chats/{chatId}/supervise` — yalnız çağıranın kendi satırı silinir. Scope: `chats--all:ro` / `chats--access:ro` — YAZMA scope'u İSTENMEZ (izleme bir okumadır; rowActions.ts'teki mevcut karar korunur: 'A read, so it needs no write scope'). `chats--access:ro` ile gelen ajan yalnız gruplarının `chat_access` üzerinden eriştiği sohbeti izleyebilir; erişemediği sohbet → 404. Başka kiracının chatId'si → 404 (customers.ts'teki birebir desen: 'RLS returns nothing, and 404 keeps ids un-enumerable (NFR-S5)'). Bayat satır (`lastSeenAt` < canlılık penceresi) canlı sayılmaz. Yeni ApiError tipi GEREKMEZ (validation/notFound/forbidden mevcut); gerekirse depo tuzağı uygulanır: errors.ts (2 yer) + scopes testi sayacı + openapi enum + regen.
DOSYALAR: packages/contract/openapi/paths/chats.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/chats.ts · apps/api/src/services/traffic/supervision-service.ts (yeni) · apps/api/test/integration/traffic-supervision.test.ts (yeni)
REFERANS DESEN (kopyalanacak): apps/api/src/routes/customers.ts (404-not-403 IDOR deseni + parse/ApiError kullanımı) · apps/api/src/services/routing/routing-service.ts (satır 142, chatAccess ile grup erişim kontrolü) · apps/api/test/integration/webhooks.test.ts (negatif-önce güvenlik testi kültürü)
KK (birebir): "proaktif aksiyon" | "KK-türetilmiş: bir ajan yalnız görmeye yetkili olduğu sohbeti izleyebilir; başka kiracının sohbeti ayırt edilemez biçimde 404 döner. Türetme kaynağı rapor-1 §678 birebir: "Supervise → mevcut sohbeti izler" + NFR-S4/S5. PRD 13.2 KK'sı yetki kuralını vermiyor; kural mevcut chat scope modelinden ve customers.ts'teki yerleşik IDOR deseninden türetildi."
KK DOĞRULAMA: integration `traffic-supervision.test.ts`: scope'suz token → 403 · başka kiracının chatId'si → 404 (403 DEĞİL) · `chats--access:ro` ajanı grubunun erişmediği sohbette → 404 · A ajanı B'nin satırını DELETE edemez · aynı ajanın ikinci POST'u tek satır bırakır ve lastSeenAt'i tazeler · iki farklı ajan aynı sohbeti izlerse iki satır. contract-parity yeşil (route + path birlikte gitti).
KAPSAM DIŞI: Traffic listesine yansıtma (13.2-e) · UI değişikliği (13.2-g) · Supervisor'ın sohbete yazması / devralması — FR-MOD-08.6.3 ayrı v2 kalemi · RTM push ile canlı supervisor listesi · Supervision olayının audit log'a yazılması (08.9.7-audit kalemi)
SÖZLEŞME: packages/contract/openapi/paths/chats.yaml → `POST /chats/{chatId}/supervise` + `DELETE /chats/{chatId}/supervise`; openapi.yaml'a `ChatSupervision` şeması. YENİ ROUTE → OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts KIRILIR — ve bu test çift yönlü çalıştığı için tersi de geçerlidir (belgelenmiş ama servis edilmeyen path de fail eder). Bu yüzden route ve kontrat AYNI pencerede gider.
MIGRATION: yok — `chat_supervisions` tablosu 13.2-c'de geldi.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.5. 13.2-e [OPUS-XHIGH] `supervised` durumunun Traffic funnel'ına bağlanması + öncelik sırası

**Status:** done  
**Dependencies:** 73.1, 73.4  

`listLive`, canlı supervision satırlarını (`lastSeenAt >= canlılık penceresi`, `licenseId = tenant.licenseId`) chatId bazında TOPLU okur (N+1 yok — mevcut `assigneeIds` toplu okuma deseni). Öncelik: `queued` > `supervised` > `waiting` > `chatting`. Mevcut 'her ziyaretçi tam bir kovada' kuralı korunur; `chatting_with` alanı DEĞİŞMEZ (kimin izlediği bu alt-görevde yanıta eklenmez).

**Details:**

13.2-e — `supervised` durumunun Traffic funnel'ına bağlanması + öncelik sırası  [OPUS-XHIGH]

PRD: FR-MOD-13.2 (+ FR-MOD-03.1.1; NFR-S4, NFR-P2)
ETİKET GEREKÇESİ: OPUS-XHIGH: funnel öncelik tasarımı (supervised'ın queued/waiting/chatting karşısındaki yeri) KK'da yazmıyor, yorum gerektiriyor (koşul 6 ihlali) ve mevcut 'most-specific first' dallanmasını değiştiriyor (koşul 4 — kopyalanacak hazır desen değil, karar). Ayrıca canlı-supervision sorgusu tenant filtresi taşır (hafif güvenlik dokunuşu). Yeni yetki sınırı yazılmadığı için MAX değil — o iş 13.2-d'de bitti.
NEDEN AÇIK: traffic-service.ts'teki activity hesabı üç dallı bir üçlü operatör: `thread?.queuePosition != null ? 'queued' : lastEvent?.authorType === 'customer' ? 'waiting' : 'chatting'` — supervised için dal yok. 13.2-d'nin yazdığı `chat_supervisions` satırlarını okuyan hiçbir kod yok (yeni tablo, sıfır tüketici).
KAPSAM: `listLive`, canlı supervision satırlarını (`lastSeenAt >= canlılık penceresi`, `licenseId = tenant.licenseId`) chatId bazında TOPLU okur (N+1 yok — mevcut `assigneeIds` toplu okuma deseni). Öncelik: `queued` > `supervised` > `waiting` > `chatting`. Mevcut 'her ziyaretçi tam bir kovada' kuralı korunur; `chatting_with` alanı DEĞİŞMEZ (kimin izlediği bu alt-görevde yanıta eklenmez).
DOSYALAR: apps/api/src/services/traffic/traffic-service.ts · apps/api/test/integration/traffic.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/traffic/traffic-service.ts (assignees/persona toplu okuma + Map ile eşleme deseni; activity üçlü dallanması)
KK (birebir): "Gelişmiş filtre" | "KK-türetilmiş: izlenen bir sohbet Traffic listesinde 'Supervised' görünür ve kuyrukta bekleyen sohbet bunun önünde gelir. Türetme kaynağı rapor-1 §644 öğe listesi; öncelik sırası PRD'de YOK, §C varsayımı olarak kaydedildi (kuyruktaki sohbet henüz kimseye ait değildir)."
KK DOĞRULAMA: integration `traffic.test.ts`: canlı supervision satırı olan sohbet → `activity === 'supervised'` · bayat (pencere dışı) supervision → supervised ÜRETMEZ · kuyruktaki izlenen sohbet `queued` KALIR (öncelik testi) · cross-tenant: B'nin supervision satırı A'nın listesinde supervised üretmez.
KAPSAM DIŞI: Kimin izlediğini yanıta ekleme (`supervised_by`) — ayrı iş · Supervise butonunun sunucuya POST etmesi (13.2-g'de UI tarafı) · RTM canlı push
SÖZLEŞME: yok (enum 13.2-a'da eklendi; yanıt alanları değişmiyor).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.6. 13.2-f [OPUS-MAX] "Match all filters + Add filter": GET /traffic çoklu-koşul filtre çekirdeği (kontrat + backend)

**Status:** done  
**Dependencies:** 73.1, 73.2, 73.5  

Contract-first. (1) `paths/traffic.yaml` → `listTraffic`'e AND'lenen ayrık query parametreleri: `activity` (enum, çoklu), `page_url_contains`, `came_from_contains`, `country_code`, `is_lead`, `group_id`. Verilen TÜM koşullar sağlanmalı = 'Match all filters'; verilmeyen parametre kısıt getirmez = 'Add filter'. (2) `traffic.ts` zod şeması `.strict()` (campaigns.ts:22 deseni) — bilinmeyen anahtar 400

**Details:**

13.2-f — "Match all filters + Add filter": GET /traffic çoklu-koşul filtre çekirdeği (kontrat + backend)  [OPUS-MAX]

PRD: FR-MOD-13.2 (+ NFR-S4, NFR-P2)
ETİKET GEREKÇESİ: OPUS-MAX: istemciden gelen filtre koşullarının çok-kiracılı bir sorguya çevrilmesi — allowlist dışı bir anahtar veya tenant kapısı atlanmış bir `group_id` doğrudan izolasyon ihlalidir (koşul 2), ve indekssiz JSONB taraması NFR-P2 (<150ms okuma) bütçesini patlatır. Predicate derleyicisi yeni algoritma tasarımıdır (koşul 4) ve çekirdeği bölünmez: allowlist + tenant kapısı + sorgu şekli aynı kararın üç yüzü. Yanlış kararın maliyeti yüksek → MAX. Filtre UI'ı (13.2-h) ve sekmeler (13.2-g) bu çekirdekten tamamen ayrıldı ve SONNET'e verildi.
NEDEN AÇIK: traffic.ts satır 15-17: `const listQuery = z.object({ limit: z.coerce.number()… })` — TEK parametre; filtre/koşul parametresi yok. paths/traffic.yaml `parameters:` yalnız `$ref: "../openapi.yaml#/components/parameters/Limit"` taşıyor. En yakın emsal campaigns.ts:22 `conditionsSchema` ama o tek koşullu (`url_contains`) ve Traffic'e bağlı değil; `GET /customers` ise yalnız tek `segment` enum'u + serbest metin `query` destekliyor — çoklu-koşul yapısı depoda YOK.
KAPSAM: Contract-first. (1) `paths/traffic.yaml` → `listTraffic`'e AND'lenen ayrık query parametreleri: `activity` (enum, çoklu), `page_url_contains`, `came_from_contains`, `country_code`, `is_lead`, `group_id`. Verilen TÜM koşullar sağlanmalı = 'Match all filters'; verilmeyen parametre kısıt getirmez = 'Add filter'. (2) `traffic.ts` zod şeması `.strict()` (campaigns.ts:22 deseni) — bilinmeyen anahtar 400. (3) `group_id`, çağıranın kiracısının grupları içinde doğrulanır; doğrulanmadan sorguya girmez (başka kiracının grubuna sızma yok). (4) `page_url_contains`/`came_from_contains` servisin ZATEN yaptığı over-fetch + JS de-dup adımında uygulanır — `visits.pages` JSONB üzerinde indekssiz LIKE'tan kaçınmak için — ve `take` sınırının içinde kalır. YENİ PATH YOK: mevcut `GET /traffic` genişler.
DOSYALAR: packages/contract/openapi/paths/traffic.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/traffic.ts · apps/api/src/services/traffic/traffic-service.ts · apps/api/test/integration/traffic.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/campaigns.ts (satır 20-22, `.strict()` conditionsSchema — bilinmeyen anahtar 400 kararı ve yorumu) · apps/api/src/routes/customers.ts (listQuery + parse() + segment enum deseni) · packages/contract/openapi/paths/customers.yaml (query parametrelerinin kontratta ifadesi)
KK (birebir): "Gelişmiş filtre" | "KK-türetilmiş: 'Match all filters' = verilen tüm koşulların AND'lenmesi; 'Add filter' = koşulun isteğe bağlı eklenmesi. Türetme gerekçesi: PRD satırı yapıyı ismen veriyor ama koşul kataloğunu ve kodlamasını vermiyor; katalog (activity/page URL/came from/country/lead/group) PRD'nin 360° panel alan listesinden ve mevcut şema kolonlarından türetildi, kodlama tercihi §C varsayımı."
KK DOĞRULAMA: integration `traffic.test.ts`: her koşul tek başına listeyi daraltır · iki koşul birlikte AND'lenir (biri sağlanmayan satır düşer) · bilinmeyen anahtar → 400 · geçersiz `activity` değeri → 400 · başka kiracının `group_id`'si sonuç sızdırmaz · filtre verilmediğinde davranış birebir eskisi (regresyon). contract-parity yeşil.
KAPSAM DIŞI: 'Match any' (OR) mantığı — PRD birebir 'Match all filters' diyor · Kaydedilmiş filtre görünümleri (saved views — 07.7 kalemi) · Filtre paneli UI'ı (13.2-h) · Sekme UI'ı (13.2-g) · GET /customers'a çoklu-koşul filtre eklemek (bu kalem Traffic yüzeyidir)
SÖZLEŞME: packages/contract/openapi/paths/traffic.yaml → `listTraffic` `parameters` listesine 6 yeni query parametresi (+ gerekirse openapi.yaml `components/parameters` ortak tanımları). YENİ PATH YOK, ama re-bundle ZORUNLU (`pnpm --filter @siyahtus/contract generate`) — aksi hâlde üretilmiş tipler ve web istemci sözleşmesi bayatlar.
MIGRATION: yok — filtreler mevcut kolonlar üzerinden: `customers.country_code`/`is_lead`, `visits.came_from`/`pages`, `chat_access.group_id`. Ziyaret sorgusu zaten `(license_id, started_at DESC)` indeksini kullanıyor (schema.prisma:845); ölçüm NFR-P2'yi aşarsa indeks kararı ayrı bir iş olarak açılır, bu pencerede migration YOK.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.7. 13.2-g [SONNET-XHIGH] Traffic durum sekmeleri (All/Chatting/Supervised/Queued/Waiting/Invited/Browsing) + sayaç + anlamlı empty state

**Status:** done  
**Dependencies:** 73.6  

(1) Saf `traffic-tabs.ts`: `TRAFFIC_TABS` sabiti (7 sekme, rapor-1 sırasıyla) + `tabToActivity()` + `countByTab()`. (2) TrafficPage.tsx'e `role=tablist` sekme şeridi; seçilen sekme 13.2-f'nin `activity` query parametresini doldurur — İSTEMCİ TARAFI YENİDEN FİLTRELEME YOK, tek doğruluk kaynağı sunucudur. (3) Her sekme için anlamlı empty state (`EmptyState` bileşeni; FR-EK-B.1 'boş dikdörtgen yok' k

**Details:**

13.2-g — Traffic durum sekmeleri (All/Chatting/Supervised/Queued/Waiting/Invited/Browsing) + sayaç + anlamlı empty state  [SONNET-XHIGH]

PRD: FR-MOD-13.2 (+ FR-MOD-03.1.1; NFR-A11Y4, NFR-A11Y5, FR-EK-B.1)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4 dosya + testleri; güvenlik sınırı YOK (sekme yalnız 13.2-f'nin mevcut `activity` query parametresini önceden dolduruyor; hiçbir yetki/izolasyon kararı burada verilmiyor, sunucu zaten doğruluyor); eşzamanlılık yok; kopyalanacak desen İSMEN var (`playbook/knowledge-tabs.ts` saf partition+sayaç, `customers/CustomersTabs.tsx` tablist görünümü, `components/EmptyState.tsx`); kontrat değişikliği yok; KK mekanik doğrulanır (her sekme doğru alt küme + 7 sekme tam).
NEDEN AÇIK: TrafficPage.tsx'te durum sekmesi yok — sayfada yalnız üst-seviye `CustomersTabs` (Contacts/Real-time/Campaigns) var ve `role=tablist` grep 0. rapor-1 §644 birebir yedi öğe sayıyor. PLAN §3.13 Faz-0 kapanışında 'kalan 3 sekme (Supervised/Invited/Browsing) v2 gelişmiş' denerek bu kaleme taşınmıştı; Browsing bir `activity` DEĞERİ olarak teslim ama SEKME olarak hiç yok.
KAPSAM: (1) Saf `traffic-tabs.ts`: `TRAFFIC_TABS` sabiti (7 sekme, rapor-1 sırasıyla) + `tabToActivity()` + `countByTab()`. (2) TrafficPage.tsx'e `role=tablist` sekme şeridi; seçilen sekme 13.2-f'nin `activity` query parametresini doldurur — İSTEMCİ TARAFI YENİDEN FİLTRELEME YOK, tek doğruluk kaynağı sunucudur. (3) Her sekme için anlamlı empty state (`EmptyState` bileşeni; FR-EK-B.1 'boş dikdörtgen yok' kararı). (4) Seçili sekme URL parametresinde kalıcı (deep-link/reload) — CustomersPage.tsx `useSearchParams` deseni. (5) Supervise satır aksiyonu artık ek olarak 13.2-d'nin `POST /chats/{id}/supervise` çağrısını yapar; mevcut navigate davranışı korunur.
DOSYALAR: apps/web/src/features/traffic/traffic-tabs.ts (yeni) · apps/web/src/features/traffic/traffic-tabs.test.ts (yeni) · apps/web/src/features/traffic/TrafficPage.tsx · apps/web/src/features/traffic/types.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/playbook/knowledge-tabs.ts (saf partition + sayaç + 'bilinmeyen değer All'da kalır' güvenli-başarısızlık deseni) · apps/web/src/features/playbook/skill-tabs.ts · apps/web/src/features/customers/CustomersTabs.tsx (sekme şeridi görünümü + aria-label) · apps/web/src/features/customers/CustomersPage.tsx (useSearchParams deep-link + debounce deseni) · apps/web/src/components/EmptyState.tsx
KK (birebir): "Gelişmiş filtre" | "KK-türetilmiş: sekme listesi rapor-1 §644 birebir — "Öğeler: All · Chatting · Supervised · Queued · Waiting for reply · Invited · Browsing (gözlemde hepsi 0)." PRD 13.2 KK'sı sekme listesini vermiyor; liste rapor-1'den, empty-state şartı FR-EK-B.1'den ("her boş liste için anlamlı empty state (boş dikdörtgen yok)") alındı."
KK DOĞRULAMA: unit `traffic-tabs.test.ts`: 7 sekme tam ve sırası rapor-1 §644 ile aynı · her sekme doğru `activity` parametresini üretir (All hiçbir kısıt eklemez) · sayaçlar toplamı All'a eşit. `TrafficPage.test.tsx`: boş sekme → anlamlı empty state (boş dikdörtgen değil) · sekme değişimi URL parametresini günceller ve reload'da korunur.
KAPSAM DIŞI: Filtre paneli / 'Add filter' UI'ı (13.2-h) · Backend filtre mantığı (13.2-f) · 360° panel değişiklikleri (13.2-j) · Sekme başına farklı sütun düzeni
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.8. 13.2-h [SONNET-XHIGH] "Match all filters + Add filter" filtre paneli UI + query builder

**Status:** done  
**Dependencies:** 73.6, 73.7  

(1) Saf `traffic-filters.ts`: koşul listesi → query string derleyicisi (13.2-f'nin parametre adlarıyla birebir) + istemci tarafı ön-doğrulama. (2) `TrafficFilters.tsx`: 'Match all filters' başlıklı panel + 'Add filter' ile koşul satırı ekleme (alan seçimi: activity / page URL contains / came from contains / country / lead / group), satır kaldırma, temizleme. (3) Metin koşullarında 250ms debounce (

**Details:**

13.2-h — "Match all filters + Add filter" filtre paneli UI + query builder  [SONNET-XHIGH]

PRD: FR-MOD-13.2 (+ FR-EK-A.1 alan-altı hata; NFR-A11Y4)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 3 yeni dosya + TrafficPage.tsx dokunuşu; güvenlik sınırı YOK (tüm doğrulama ve tenant kapısı sunucuda, 13.2-f'de; UI yalnız query string kuruyor); eşzamanlılık yok; kopyalanacak desen İSMEN var (`CustomersPage.tsx` segment + 250ms debounce + URLSearchParams kurulumu, T4-a form-validasyon primitifi, `components/ui/*`); kontrat değişikliği yok; KK mekanik (koşul ekle → query string; kaldır → parametre düşer).
NEDEN AÇIK: TrafficPage.tsx sabit bir istek yapıyor: `api.get(...'/traffic?limit=100')` (satır ~55) ve doğrudan tabloyu render ediyor; 'Add filter' / 'Match all' grep 0. Yani filtre girişi için hiçbir UI yüzeyi yok.
KAPSAM: (1) Saf `traffic-filters.ts`: koşul listesi → query string derleyicisi (13.2-f'nin parametre adlarıyla birebir) + istemci tarafı ön-doğrulama. (2) `TrafficFilters.tsx`: 'Match all filters' başlıklı panel + 'Add filter' ile koşul satırı ekleme (alan seçimi: activity / page URL contains / came from contains / country / lead / group), satır kaldırma, temizleme. (3) Metin koşullarında 250ms debounce (CustomersPage deseni) — her tuşa istek gitmez. (4) Geçersiz girdide alan-altı hata + istek gönderilmez (T4-a primitifi). (5) Aktif koşullar URL parametrelerinde kalıcı ve 13.2-g'nin sekmesiyle birlikte çalışır (sekme = önceden dolu `activity` koşulu).
DOSYALAR: apps/web/src/features/traffic/traffic-filters.ts (yeni) · apps/web/src/features/traffic/traffic-filters.test.ts (yeni) · apps/web/src/features/traffic/TrafficFilters.tsx (yeni) · apps/web/src/features/traffic/TrafficFilters.test.tsx (yeni) · apps/web/src/features/traffic/TrafficPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/customers/CustomersPage.tsx (segment seçimi + 250ms debounce + URLSearchParams ile istek kurma) · apps/web/src/features/playbook/skill-filter.ts (saf filtre mantığının ayrı dosyada test edilmesi deseni) · apps/web/src/components/ui (Dropdown/Panel bileşenleri — EK-C.2 tasarım sistemi)
KK (birebir): "Gelişmiş filtre"
KK DOĞRULAMA: unit `traffic-filters.test.ts`: koşul ekle → doğru query parametresi üretilir · koşul kaldır → parametre düşer · iki koşul birlikte gönderilir (Match all) · boş/geçersiz değer istek üretmez. `TrafficFilters.test.tsx`: 'Add filter' yeni satır açar · geçersiz değerde alan-altı hata görünür ve istek atılmaz · temizle tüm koşulları kaldırır.
KAPSAM DIŞI: Kaydedilmiş filtre görünümleri (saved views — 07.7) · 'Match any' (OR) seçeneği · Backend doğrulama (13.2-f) · Filtre sonuçlarının dışa aktarımı
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.9. 13.2-i [SONNET-XHIGH] CustomerDetail'e `visits_count` + `groups[]` (kontrat + servis)

**Status:** done  
**Dependencies:** None  

(1) `CustomerService.get` iki ek okuma yapar: `tx.visit.count({ where: { customerId, licenseId: tenant.licenseId } })` → `visits_count`; müşterinin bu lisanstaki sohbetlerine bağlı `chat_access.group_id`'lerden distinct grup listesi + `groups` tablosundan ad → `groups: [{ id, name }]`. (2) `CustomerDetail` arayüzü ve openapi.yaml şeması iki KATKISAL alanla genişler. (3) `pnpm --filter @siyahtus/contra

**Details:**

13.2-i — CustomerDetail'e `visits_count` + `groups[]` (kontrat + servis)  [SONNET-XHIGH]

PRD: FR-MOD-13.2 (+ NFR-S4)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4 dosya + testleri; yeni bir yetki/izolasyon KARARI verilmiyor (aynı fonksiyon `CustomerService.get` zaten `visits` ve `chats` bloklarını `licenseId` ile daraltıyor; iki ek okuma aynı filtreyi BİREBİR kopyalar); eşzamanlılık yok; kopyalanacak desen İSMEN var (customer-service.ts `get()` visits/chats include blokları + routing-service.ts:142 chatAccess okuması); kontrat katkısal ve mekanik; KK mekanik doğrulanır (sayı doğru mu). Güvence için cross-tenant testi yine de zorunlu tutuldu.
NEDEN AÇIK: openapi.yaml:1534-1558 `CustomerDetail` `visits[]` ve `chats[]` döndürüyor ama toplam ziyaret sayısı alanı YOK — ve istemci diziyi sayarak bunu telafi EDEMEZ, çünkü customer-service.ts `MAX_VISITS = 10` sabitiyle diziyi kırpıyor (satır 71 + `get()` içindeki `take: MAX_VISITS`). Yani 12 ziyaretli bir müşteri için `visits.length` her zaman 10 döner. 'groups' için ise Customer modelinde (schema.prisma:228-253) hiçbir alan yok.
KAPSAM: (1) `CustomerService.get` iki ek okuma yapar: `tx.visit.count({ where: { customerId, licenseId: tenant.licenseId } })` → `visits_count`; müşterinin bu lisanstaki sohbetlerine bağlı `chat_access.group_id`'lerden distinct grup listesi + `groups` tablosundan ad → `groups: [{ id, name }]`. (2) `CustomerDetail` arayüzü ve openapi.yaml şeması iki KATKISAL alanla genişler. (3) `pnpm --filter @siyahtus/contract generate` ile re-bundle. YENİ PATH YOK. Ziyaretçi 'groups' kavramı = bu ziyaretçiye hangi ajan takımının baktığı (§C varsayımı — yeni `customer_groups` tablosu AÇILMAZ).
DOSYALAR: apps/api/src/services/customers/customer-service.ts · packages/contract/openapi/openapi.yaml · apps/api/test/integration/customers.test.ts · apps/web/src/features/customers/types.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/customers/customer-service.ts (`get()` içindeki visits/chats include blokları — licenseId daraltması; `#counts()` sayım deseni) · apps/api/src/services/routing/routing-service.ts (satır 142, `tx.chatAccess.findMany` okuması) · packages/contract/openapi/openapi.yaml (satır 1534-1558, CustomerDetail allOf yapısı)
KK (birebir): "ziyaretçi geçmişi" | "KK-türetilmiş: 'returning visitor N visits' ve 'groups' ayrı özet alanları olarak sunulur. Türetme gerekçesi: PRD 13.2 satırı alan adlarını sayıyor ama kırpılmış `visits[]` dizisinden N'in çıkarılamayacağını söylemiyor; `MAX_VISITS=10` kırpması koda karşı doğrulandı ve ayrı sayaç alanını zorunlu kılıyor."
KK DOĞRULAMA: integration `customers.test.ts`: 12 ziyaretli müşteride `visits.length === 10` AMA `visits_count === 12` (kırpma tuzağının doğrudan kanıtı) · iki farklı grubun eriştiği sohbeti olan müşteride `groups` iki kayıt döner · hiç sohbeti olmayan müşteride `groups` boş dizi. CROSS-TENANT: B lisansındaki ziyaretler A'nın `visits_count`'una girmez; B'nin grupları A'nın `groups`'unda görünmez. contract-parity yeşil.
KAPSAM DIŞI: UI render'ı (13.2-j) · Yeni `customer_groups` segment tablosu (§C varsayımı: açılmaz — açık soru 3) · Ziyaretçiye elle grup atama CRUD'ı · `Visit.ip` veya coğrafi konum döndürmek (NFR-S9 — mevcut Visit şeması ip döndürmüyor, öyle kalır)
SÖZLEŞME: packages/contract/openapi/openapi.yaml → `CustomerDetail` şemasına `visits_count` (integer) ve `groups` (array of {id, name}). YENİ PATH YOK; re-bundle + `pnpm --filter @siyahtus/contract generate` ZORUNLU, aksi hâlde üretilmiş tipler bayatlar.
MIGRATION: yok — `groups` yeni tablo değil, mevcut `chat_access` (schema.prisma:453) + `groups` (satır 311) tablolarından türetiliyor (§C varsayımı).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.10. 13.2-j [SONNET-XHIGH] Ziyaretçi 360° panel: N visits özeti + Came from + Groups kartları (UI)

**Status:** done  
**Dependencies:** 73.9  

(1) dl özet bloğuna `Visits` satırı (`visits_count`) + `visits_count > 1` iken 'Returning visitor' rozeti (StatusDot). (2) Her ziyaret satırında `came_from` gösterimi ('Came from …'); ziyaretçi girdisi olduğu için LİNK DEĞİL düz metin — dosyanın mevcut kararı korunur ('a link would be a one-click path to whatever a stranger put in the address bar'). (3) `Groups` kartı; boşsa anlamlı empty state (F

**Details:**

13.2-j — Ziyaretçi 360° panel: N visits özeti + Came from + Groups kartları (UI)  [SONNET-XHIGH]

PRD: FR-MOD-13.2 (+ NFR-S9, FR-EK-B.1)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2-3 dosya; güvenlik sınırı YOK (salt-okunur render, yeni istek yok, yeni yetki dalı yok); eşzamanlılık yok; kopyalanacak desen AYNI DOSYADA (CustomerDetailPanel.tsx'teki 'Visited pages' kartı, dl özet bloğu ve 'Conversations' kartı); kontrat değişikliği yok (alanlar 13.2-i'de geldi); KK mekanik doğrulanır (alan görünür mü, empty state var mı, IP render edilmiyor mu).
NEDEN AÇIK: CustomerDetailPanel.tsx 'Visited pages' kartında yalnız `visit.started_at`, `visit.browser`, `visit.os` ve `visit.pages` render ediliyor; `visit.came_from` yanıt tipinde VAR (`features/customers/types.ts` → `Visit.came_from`) ve API döndürüyor (customer-service.ts `came_from: visit.cameFrom`) ama dosyada HİÇ geçmiyor — yarım teslim. 'N visits' özeti ve 'Groups' kartı hiç yok; dl bloğu yalnız Conversations/Tickets/Country/Last active satırlarını taşıyor.
KAPSAM: (1) dl özet bloğuna `Visits` satırı (`visits_count`) + `visits_count > 1` iken 'Returning visitor' rozeti (StatusDot). (2) Her ziyaret satırında `came_from` gösterimi ('Came from …'); ziyaretçi girdisi olduğu için LİNK DEĞİL düz metin — dosyanın mevcut kararı korunur ('a link would be a one-click path to whatever a stranger put in the address bar'). (3) `Groups` kartı; boşsa anlamlı empty state (FR-EK-B.1). (4) PII sınırı korunur: `Visit.ip` panelde GÖSTERİLMEZ (schema.prisma:833-835 + NFR-S9) ve bu negatif iddia testle çivilenir.
DOSYALAR: apps/web/src/features/customers/CustomerDetailPanel.tsx · apps/web/src/features/customers/CustomerDetailPanel.test.tsx (yeni) · apps/web/src/features/customers/types.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/customers/CustomerDetailPanel.tsx (aynı dosyadaki 'Visited pages' kartı, dl özet bloğu, 'Conversations' kartı — kart iskeleti birebir kopyalanır) · apps/web/src/components/EmptyState.tsx · apps/web/src/components/StatusDot.tsx
KK (birebir): "ziyaretçi geçmişi" | "KK-türetilmiş: 360° panel 'returning visitor N visits', 'came from' ve 'groups' alanlarını gösterir; 'pre-chat form' payı ZATEN teslim. Türetme gerekçesi: PRD 13.2 satırı alan listesini parantez içinde veriyor ama render kuralını (link değil düz metin; IP gösterilmez) söylemiyor; bu kurallar mevcut dosyanın kararından ve NFR-S9'dan alındı."
KK DOĞRULAMA: unit `CustomerDetailPanel.test.tsx`: `visits_count > 1` → 'Returning visitor' rozeti görünür · `visits_count` değeri dl'de görünür ve kırpılmış `visits.length`'ten farklı olabilir · `came_from` dolu ziyarette metin görünür, null'da satır sessizce yok · `groups` boş → anlamlı empty state, dolu → grup adları · NEGATİF: hiçbir IP değeri DOM'a render edilmiyor.
KAPSAM DIŞI: Pre-chat form yanıtları — ZATEN TESLİM: widget start endpoint'i `custom_fields` yazıyor (routes/customer.ts startSchema, FR-MOD-08.7.7) ve panel bunları 'Custom fields' kartında gösteriyor; yeniden yapılmaz · IP / coğrafi konum gösterimi (NFR-S9) · Ziyaret haritası veya oturum kaydı (session replay) · Filtre/sekme yüzeyi (13.2-f/-g/-h) · Ziyaret listesinin sayfalanması (MAX_VISITS=10 kırpması olduğu gibi kalır)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 73.11. 13.2-k [OPUS-XHIGH] Uçtan uca doğrulama: E2E (sekme + filtre + supervise + 360° panel) + NFR-P2 ölçümü + a11y kanıtı

**Status:** done  
**Dependencies:** 73.1, 73.2, 73.3, 73.4, 73.5, 73.6, 73.7, 73.8, 73.9, 73.10  

traffic.spec.ts genişletilir: (1) 7 sekme görünür ve Browsing sekmesi ziyaretçiyi listeler; (2) 'Add filter' ile page-URL koşulu eklenir → liste daralır, koşul kaldırılınca geri döner; (3) 'Supervise chat' → satır 'Supervised' durumuna geçer (13.2-d + 13.2-e uçtan uca kanıtı); (4) satırdan 'Edit contact' → mevcut `/app/customers?customer={id}` deep-link'i (CustomersPage.tsx satır 38-57'de gerçekte

**Details:**

13.2-k — Uçtan uca doğrulama: E2E (sekme + filtre + supervise + 360° panel) + NFR-P2 ölçümü + a11y kanıtı  [OPUS-XHIGH]

PRD: FR-MOD-13.2 (+ FR-MOD-03.1.1; NFR-P2, NFR-P4, NFR-A11Y4, NFR-A11Y5)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama (kontrat + backend + DB + UI) üzerinden uçtan uca senaryo kurmak ve hangi iddiaların gerçekten kapıyı geçtiğine karar vermek yorum gerektiriyor (koşul 6 ihlali); NFR-P2 ölçüm bütçesinin yeterli sayılıp sayılmayacağı da karar konusudur. Yeni güvenlik sınırı YAZILMADIĞI için MAX değil — güvenlik çekirdekleri 13.2-d ve 13.2-f'de kapandı.
NEDEN AÇIK: apps/e2e/tests/traffic.spec.ts tek senaryo taşıyor: canlı ziyaretçi satırı + 'Supervise chat'/'Assign chat to me' butonlarının GÖRÜNÜR olması. Sekme, filtre, supervised/invited durumları ve 360° panel alanları için hiçbir e2e iddiası yok (dosyada bu terimler geçmiyor).
KAPSAM: traffic.spec.ts genişletilir: (1) 7 sekme görünür ve Browsing sekmesi ziyaretçiyi listeler; (2) 'Add filter' ile page-URL koşulu eklenir → liste daralır, koşul kaldırılınca geri döner; (3) 'Supervise chat' → satır 'Supervised' durumuna geçer (13.2-d + 13.2-e uçtan uca kanıtı); (4) satırdan 'Edit contact' → mevcut `/app/customers?customer={id}` deep-link'i (CustomersPage.tsx satır 38-57'de gerçekten okunuyor) 360° paneli açar ve 'Visits' sayacı + 'Came from' görünür. Ayrıca: filtreli `GET /traffic` süre ölçümü HANDOFF'a kanıt (NFR-P2 <150ms); tablist klavye gezinme a11y iddiası. E2E ÖN KOŞULU: temiz DB (truncate + reseed), `.env` source edilmiş, portlar boş — idempotent seed mutasyona uğramış tenant'ı sıfırlamaz.
DOSYALAR: apps/e2e/tests/traffic.spec.ts · apps/e2e/tests/fixtures.ts · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/e2e/tests/traffic.spec.ts (mevcut senaryo: openWidget + visitorSends + Customers alt-nav üzerinden erişim) · apps/e2e/tests/tickets.spec.ts (deep-link + sıralama iddiası deseni)
KK (birebir): "Gelişmiş filtre" | "ziyaretçi geçmişi" | "proaktif aksiyon"
KK DOĞRULAMA: E2E: sekme şeridi 7 öğe · filtre uygulanınca satır sayısı düşer, kaldırılınca geri gelir · Supervise sonrası satır 'Supervised' etiketiyle görünür · 360° panelde 'Visits' sayacı ve 'Came from' metni görünür. Perf: filtreli `GET /traffic` yanıt süresi NFR-P2 bütçesinde, ölçüm HANDOFF'a yazılır. a11y: tablist ok tuşlarıyla gezinilir, `aria-selected` doğru.
KAPSAM DIŞI: Yeni ürün davranışı eklemek (bu alt-görev yalnız doğrular) · Görsel regresyon (screenshot diff) altyapısı kurmak · RTM canlı traffic akışı (FR-EK-C.1 — ayrı kalem; board hâlâ 8sn polling)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
