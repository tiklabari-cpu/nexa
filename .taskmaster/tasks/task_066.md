# Task ID: 66

**Title:** 08.6.3 — Skills-based routing + supervision/takeover  ·  dilim V2-3

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** FR-MOD-08.6.3 · Could (v2) · [MAX] ↑.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `FR-MOD-08.6.3`.

9 atomik alt-görev · ~11 pencere · etiket dağılımı: OPUS-MAX x2 · OPUS-XHIGH x3 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  08.6.3-a [OPUS-XHIGH] Skill kataloğu veri modeli (skills + agent_skills tabloları, RLS, seed)  (bağ: —)
  08.6.3-b [OPUS-XHIGH] Skill katalog CRUD + ajan-skill atama API'si (kontrat + rol kapılı backend)  (bağ: 08.6.3-a)
  08.6.3-c [OPUS-MAX] ADR-08 routing çekirdeği: skill-eşleşmeli aday seçimi + kural koşuluna skill_ids (BÖLÜNMEZ)  (bağ: 08.6.3-a, 08.6.3-b)
  08.6.3-d [OPUS-MAX] Supervisor takeover çekirdeği: rol kapısı + eşzamanlı devir reddi + audit + RTM (BÖLÜNMEZ)  (bağ: —)
  08.6.3-e [SONNET-XHIGH] Settings: Skills kataloğu bölümü + routing kuralında skill koşulu gösterimi  (bağ: 08.6.3-b, 08.6.3-c)
  08.6.3-f [SONNET-XHIGH] Team: ajan başına skill ataması ekranı  (bağ: 08.6.3-b)
  08.6.3-g [SONNET-XHIGH] Inbox: supervisor takeover butonu (rol kapılı, onaylı) + devir sonrası durum  (bağ: 08.6.3-d)
  08.6.3-h [SONNET-XHIGH] Çoklu-ajan çakışma uyarısı (aynı sohbette birden fazla present ajan)  (bağ: —)
  08.6.3-i [OPUS-XHIGH] Uçtan uca doğrulama: skill routing + takeover E2E, cross-tenant negatif matrisi, ADR-08 regresyonu  (bağ: 08.6.3-c, 08.6.3-d, 08.6.3-e, 08.6.3-f, 08.6.3-g)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): İki OPUS-MAX çekirdek bölünmez. (1) 08.6.3-c ADR-08 aday seçimi: `#selectAgent` (routing-service.ts:246-269) tek ham SQL'de yük sayımı + kapasite HAVING'i yapıyor ve seçim `GROUP_PRIORITY_ORDER` katman düşmesi → en az yüklü → `last_assigned_at` tie-break zincirinden oluşuyor; skill filtresi bu zincirin herhangi bir halkasından ayrılırsa "skill'li aday yok → hangi gevşetme" kararı ve transaction-içi yük tutarlılığı (kod yorumu: "computing load in one transaction and writing the assignment in another lets two chats arriving together both pick the agent who had a free slot") kaybolur. (2) 08.6.3-d takeover: rol kapısı + koşullu assignee güncellemesi (iki supervisor yarışı) + audit kaydı tek bağlamda akıl yürütülmeli — yetki kararını yazma yarışından ayırmak "yetkisiz ikinci yazıcı kazanır" sınıfı hataya kapı bırakır. Her iki çekirdeğin ETRAFI (migration/RLS, katalog CRUD, üç UI ekranı, uçtan uca doğrulama) ayrı ve daha ucuz alt-görevlere çıkarıldı; böylece pahalı pencereler 2'şer pencereye sıkıştı.

VARSAYIMLAR: Skill modeli düz (flat) bir katalogdur: seviye/ağırlık/hiyerarşi YOK. PRD FR-MOD-08.6.3 yalnız 'Uzmanlık/skill bazlı' diyor; seviyeli skill'e dair hiçbir kaynak satırı yok, eklenirse kapsam kayması olur. · Skill routing'de GEVŞETİLMEZ: bir kural skill istiyorsa o skill'i olmayan ajan hiçbir aşamada seçilmez; skill'li uygun aday yoksa ADR-08'in mevcut fallback grup → kuyruk zinciri işler. Alternatif (skill'i gevşetip herhangi bir ajana verme) kilitli ADR-08 zincirine yeni bir halka ekler ve 'yanlış ajana giden uzman sohbet' üretir. · 'Supervisor' AYRI bir rol olarak eklenmez; mevcut roleAtLeast(role,'admin') (owner > viceowner > admin > agent, principal.ts:70-78) supervisor yetkisi olarak kullanılır. Gerekçe: v2-04-guvenlik-uyumluluk.md:141 'yalnızca supervisor/admin rolüne açılması' diyor ve depoda admin zaten 'başkası üzerinde etkili aksiyon' rolü (agents.ts:161-183 suspension). · Takeover, mevcut POST /chats/{chatId}/transfer'i DEĞİŞTİRMEZ; ayrı bir path olarak eklenir. transfer = rızalı/kurala bağlı devir (scope kapılı, mevcut davranış korunur), takeover = rol kısıtlı zorla devir (audit'li). İki yolu tek endpoint'te birleştirmek mevcut TrafficPage 'Assign chat to me' akışını (TrafficPage.tsx:75-78) kırardı. · Eşzamanlı takeover koşullu güncelleme (updateMany + beklenen assignee → 0 satır ise 409) ile çözülür, satır kilidi (SELECT FOR UPDATE) ile değil — mevcut routing-service.ts'in transaction-içi deseniyle uyumlu ve kilit sırası riski getirmiyor. · Salt-okunur gözlemci ('watch' / non-participant supervisor izleme) bu kalemin KAPSAMI DIŞI. facts §eksikler bunu ayrı bir boşluk olarak işaretliyor (ChatUser.userType'a yeni tür gerekir); mevcut 'Supervise chat' aksiyonu (rowActions.ts:49) sohbeti inbox'ta açıyor — o minimum davranış korunur. · Çoklu-ajan çakışma uyarısı (08.6.3-h) bu kaleme dahil edildi çünkü PRD §5.3 satır 408 onu 'Skills-based routing, supervision + takeover' ile AYNI satırda sayıyor ve ayrı bir FR-MOD kodu yok. Kalem daraltılacaksa düşürülebilecek

AÇIK SORULAR (ürün kararı): Eşzamanlı takeover reddi için 409 gövdesinde hangi `error.type` kullanılacak? Mevcut 409'lar semantik olarak uymuyor (chat_inactive = kapalı sohbet; group_offline / group_unavailable = takım durumu). Yeni bir tip (ör. `takeover_conflict`) eklenirse tuzak: errors.ts'te İKİ yer (ERROR_TYPES + ERROR_STATUS) + packages/types/src/scopes.test.ts:95 sayaç + openapi enum + regen. Karar 08.6.3-d'nin başında verilmeli; `not_allowed`(403) uygun DEĞİL — çakışma bir yetki reddi değil. · Skill kataloğu Settings altında mı (`/settings/skills`, access_rules scope'u) yoksa Team altında mı (`/agents/skills`, agents--all scope'u) yaşamalı? Kırılımda Settings varsayıldı (routing yapılandırmasının parçası, RoutingRules ile aynı ekran); Team tarafı yalnız ATAMA yapıyor. Ters tercih varsa 08.6.3-b, -e ve -f'nin dosya listeleri değişir. · Bir routing kuralı birden fazla skill isteyebilir mi, isterse mantık AND mi OR mu? Kırılımda AND varsayıldı (`HAVING COUNT(DISTINCT skill_id) = n` — 'hepsine sahip'), çünkü 'uzmanlık gereği' semantiği kısıtlayıcıdır. PRD'de yazmıyor; OR seçilirse 08.6.3-c'nin SQL'i ve testleri değişir. · Takeover'dan sonra ÖNCEKİ assignee sohbeti hâlâ okuyabilmeli mi (ChatUser satırı kalır, present=false) yoksa erişimi tamamen kesilmeli mi? Kırılımda 'satır kalır, present=false' varsayıldı (transfer'in mevcut ChatUser deseniyle uyumlu, arşiv/denetim izini korur). Erişimin tamamen kesilmesi istenirse 08.6.3-d'nin izolasyon testleri genişler. · `agent_skills` AgentMembership'e mi bağ

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 66.1. 08.6.3-a [OPUS-XHIGH] Skill kataloğu veri modeli (skills + agent_skills tabloları, RLS, seed)

**Status:** done  
**Dependencies:** None  

Contract-first sıranın veri katmanı adımı (kontrat satırı route'uyla birlikte 08.6.3-b'de gider — contract-parity.test.ts iki yönlü çalışıyor, kontratta olup route'u olmayan path testi kırar). Prisma modelleri: `Skill` (licenseId + id composite PK — Group modelindeki desen; name, slug, archived, createdAt) ve `AgentSkill` (licenseId, agentId, skillId composite PK, @@index([agentId])). Migration SQ

**Details:**

08.6.3-a — Skill kataloğu veri modeli (skills + agent_skills tabloları, RLS, seed)  [OPUS-XHIGH]

PRD: FR-MOD-08.6.3 (+ NFR-S3, NFR-S4)
ETİKET GEREKÇESİ: OPUS-XHIGH: koşul 2 ihlali — yeni tenant-scoped tablolar + RLS politikası tenant izolasyon sınırıdır (NFR-S4), bu yüzden SONNET olamaz. Ancak authZ kararı, algoritma tasarımı veya eşzamanlılık akıl yürütmesi yok; mevcut migration RLS deseni (custom_fields / ticket_rules) birebir kopyalanıyor → MAX değil XHIGH.
NEDEN AÇIK: `grep -rn -i 'expertise' apps packages --include=*.ts --include=*.prisma` → 0 eşleşme. schema.prisma AgentMembership (satır 126-148: role / routingStatus / concurrentChatsLimit / lastAssignedAt / suspended) ve GroupAgent (satır 327-339: yalnız `priority String @default("normal")`) hiçbir skill/uzmanlık alanı taşımıyor. `skills` veya `agent_skills` adında tablo yok (facts §sema_tablolari: 'yok — migration gerek').
KAPSAM: Contract-first sıranın veri katmanı adımı (kontrat satırı route'uyla birlikte 08.6.3-b'de gider — contract-parity.test.ts iki yönlü çalışıyor, kontratta olup route'u olmayan path testi kırar). Prisma modelleri: `Skill` (licenseId + id composite PK — Group modelindeki desen; name, slug, archived, createdAt) ve `AgentSkill` (licenseId, agentId, skillId composite PK, @@index([agentId])). Migration SQL: iki tablo, FK'ler (license/account cascade), unique(license_id, slug), `ENABLE ROW LEVEL SECURITY` + USING/WITH CHECK (license_id = siyahtus_current_license()) politikaları, uygulama rolüne GRANT. Seed'e deterministik 3 örnek skill. Route, kontrat ve UI YOK.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/20260801100000_agent_skills/migration.sql · apps/api/prisma/seed.ts · apps/api/test/integration/data-model.test.ts · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260726200000_custom_fields/migration.sql · apps/api/prisma/migrations/20260726180000_ticket_rules/migration.sql · apps/api/prisma/schema.prisma (Group satır 311-324 + GroupAgent satır 327-339 — license-scoped composite PK deseni)
KK (birebir): "Uzmanlık/skill bazlı" | "KK-türetilmiş: 'Uzmanlık/skill bazlı' routing için ajan↔uzmanlık ilişkisini taşıyan, lisans-kapsamlı ve RLS korumalı bir veri modeli bulunur. (Türetme gerekçesi: PRD FR-MOD-08.6.3 satırı yalnız davranışı söylüyor — facts.kk_yetersiz=true; veri modeli PRD §8.4'te tanımlı değil, tablo yokluğu koda karşı doğrulandı.)"
KK DOĞRULAMA: data-model.test.ts — `skills` ve `agent_skills` tabloları mevcut, `relrowsecurity = true`, politikalar kayıtlı; `prisma migrate deploy` temiz koşuyor ve `prisma migrate diff` boş. tenant-isolation.test.ts — B lisansının tenant oturumunda A lisansının skill/agent_skill satırları 0 satır döner (RLS kanıtı).
KAPSAM DIŞI: CRUD endpoint'i ve kontrat satırı (08.6.3-b) · routing'de skill kullanımı (08.6.3-c) · tüm UI ekranları (08.6.3-e / -f / -g) · skill seviyesi/ağırlığı/hiyerarşisi — PRD'de yok · AI ajanına skill atama
SÖZLEŞME: yok — bu alt-görev route eklemiyor. UYARI: contract-parity.test.ts İKİ YÖNLÜ çalışıyor (dosya başlığı: 'an undocumented route fails, and so does a documented route that nothing serves'), bu yüzden kontrat satırı bu pencereye konmaz, 08.6.3-b'de route'uyla birlikte gider.
MIGRATION: EVET — yeni `skills` + `agent_skills` tabloları, FK'ler, unique(license_id, slug), RLS ENABLE + policy + GRANT
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 66.2. 08.6.3-b [OPUS-XHIGH] Skill katalog CRUD + ajan-skill atama API'si (kontrat + rol kapılı backend)

**Status:** done  
**Dependencies:** 66.1  

Contract-first: (1) openapi/paths/settings.yaml'a `skills` (GET liste + POST oluştur) ve `skill` (DELETE) blokları — routingRules/routingRule bloklarının (satır 379-440) birebir kalıbıyla; agents.yaml'a `agentSkills` (PUT /agents/{agentId}/skills, gövde `{skill_ids: integer[]}` — tam değiştirme, idempotent); openapi.yaml components/schemas'a `Skill`; ajanın skill listesi `GET /agents` yanıtına (se

**Details:**

08.6.3-b — Skill katalog CRUD + ajan-skill atama API'si (kontrat + rol kapılı backend)  [OPUS-XHIGH]

PRD: FR-MOD-08.6.3 (+ NFR-S3 authZ, NFR-S5 IDOR)
ETİKET GEREKÇESİ: OPUS-XHIGH: kullanıcı talimatı — 'yeni bir yetkili endpoint eklemek, mevcut scope'u genişletmek EN AZ OPUS-XHIGH olur'. Rol kapısı (roleAtLeast admin), scope seçimi ve IDOR/cross-tenant doğrulaması var → koşul 2 ihlali, SONNET olamaz. Eşzamanlılık/kilit yok, yeni algoritma yok, mevcut suspension deseni birebir kopyalanıyor → MAX değil.
NEDEN AÇIK: `packages/contract/openapi/paths/` altındaki 23 dosyanın hiçbirinde skill path'i yok (dizin listesi: account-lifecycle, agents, apps, auth, campaigns, channels, chats, copilot, custom-fields, customer-chat, customers, home, onboarding, playbook, reports, settings, ticket-email-templates, ticket-rules, tickets, traffic, uploads, webhooks, websites). agents.yaml yalnız `suspension` alt-path'ini taşıyor; routes/agents.ts'te `/agents/:agentId/skills` grep 0.
KAPSAM: Contract-first: (1) openapi/paths/settings.yaml'a `skills` (GET liste + POST oluştur) ve `skill` (DELETE) blokları — routingRules/routingRule bloklarının (satır 379-440) birebir kalıbıyla; agents.yaml'a `agentSkills` (PUT /agents/{agentId}/skills, gövde `{skill_ids: integer[]}` — tam değiştirme, idempotent); openapi.yaml components/schemas'a `Skill`; ajanın skill listesi `GET /agents` yanıtına (serialiseAgent) eklenir. Bundle yeniden üretilir. (2) Backend: routes/settings.ts'e katalog handler'ları (scope `access_rules:ro` / `access_rules:rw` — routing-rules ile aynı yüzey), routes/agents.ts'e atama handler'ı (scope `agents--all:rw`); her ikisinde principal.kind==='agent' + roleAtLeast(actorRole,'admin') çift kapısı ve `withTenant`; skill_ids tenant içinde doğrulanır (yabancı id → 404, enumerable olmaz).
DOSYALAR: packages/contract/openapi/paths/settings.yaml · packages/contract/openapi/paths/agents.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/settings.ts · apps/api/src/routes/agents.ts · packages/types/src/domain.ts · apps/api/test/integration/settings.test.ts · apps/api/test/integration/agents-suspension.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/agents.ts (satır 161-183: PUT /agents/:agentId/suspension — principal.kind + roleAtLeast(actorRole,'admin') çift kapı, RLS'e dayalı 404) · apps/api/src/routes/settings.ts (satır 582-640: routing-rules GET/PATCH — scope config + withTenant + ApiError.notFound) · packages/contract/openapi/paths/settings.yaml (satır 379-440: routingRules/routingRule kontrat kalıbı)
KK (birebir): "Uzmanlık/skill bazlı"
KK DOĞRULAMA: integration — katalog CRUD (POST oluştur → GET listede → DELETE sonrası yok) ve PUT /agents/{id}/skills ajanın skill kümesini TAM değiştirir (idempotent: aynı gövde iki kez → aynı sonuç). NEGATİF (önce): `agent` rolüyle POST/PUT → 403; PAT/bot principal → 403; başka lisansın skill_id'si ile PUT → 404; scope'suz token → 403. contract-parity.test.ts iki yönlü yeşil.
KAPSAM DIŞI: routing motorunda skill kullanımı (08.6.3-c) · takeover endpoint'i (08.6.3-d) · tüm UI (08.6.3-e / -f) · skill bazlı raporlama · toplu (bulk) skill import
SÖZLEŞME: EVET — settings.yaml: `skills` (GET/POST) + `skill` (DELETE); agents.yaml: `agentSkills` (PUT /agents/{agentId}/skills); openapi.yaml: `Skill` şeması + Agent şemasına katkısal `skills`. OpenAPI'ye eklenip RE-BUNDLE edilmezse contract-parity.test.ts kırılır (hafıza notu: siyahtus-contract-parity-gate). Parity İKİ YÖNLÜ olduğu için kontrat satırı ve route AYNI pencerede gitmek zorunda.
MIGRATION: yok — şema 08.6.3-a'da
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 66.3. 08.6.3-c [OPUS-MAX] ADR-08 routing çekirdeği: skill-eşleşmeli aday seçimi + kural koşuluna skill_ids (BÖLÜNMEZ)

**Status:** done  
**Dependencies:** 66.1, 66.2  

Contract-first: (1) settings.yaml RoutingRule `conditions` şemasına katkısal `skill_ids: integer[]` + `routingRule` PATCH gövdesine `conditions`, re-bundle. (2) routes/settings.ts `updateRuleBody`'ye skill_ids doğrulaması (tenant içi skill id'leri; yabancı id → 404). (3) routing-service.ts: `RoutingConditions`'a `skill_ids?: number[]`; `#selectAgent`'a gerekli skill listesi parametresi; ham SQL'e 

**Details:**

08.6.3-c — ADR-08 routing çekirdeği: skill-eşleşmeli aday seçimi + kural koşuluna skill_ids (BÖLÜNMEZ)  [OPUS-MAX]

PRD: FR-MOD-08.6.3 (+ NFR-P1, NFR-P2, NFR-S4)
ETİKET GEREKÇESİ: OPUS-MAX: kilitli ADR-08 algoritmasının değiştirilmesi (yeni algoritma tasarımı — koşul 4 ihlali) + transaction-içi 'yük sayımı okuma → atama yazma' invariantı (eşzamanlılık — koşul 3 ihlali) + tenant-scoped ham SQL'e yeni JOIN (izolasyon — koşul 2 ihlali). Yanlış karar pahalı: skill filtresi fallback zincirine yanlış yerleştirilirse sohbetler sessizce kuyrukta birikir. Çekirdek bölünmez.
NEDEN AÇIK: routing-service.ts `RoutingConditions` arayüzü yalnız `url_contains` / `url_equals` / `country_codes` taşıyor. `#selectAgent` ham SQL'i (satır 246-269) yalnız `group_agents` ⋈ `agent_memberships` ⋈ `threads` JOIN'i yapıyor; WHERE'de `ga.license_id` + `ga.group_id` + `m.routing_status='accepting_chats'` + NOT suspended/awaiting_approval var, skill tablosuna hiç dokunmuyor. Seçim sırası kodda sabit: `GROUP_PRIORITY_ORDER` en iyi katman → `active_chats` artan → `last_assigned_at` artan → `agent_id` localeCompare. Facts: 'priority yalnız takım-içi öncelik sırasıdır, ajan yetkinliği değil'.
KAPSAM: Contract-first: (1) settings.yaml RoutingRule `conditions` şemasına katkısal `skill_ids: integer[]` + `routingRule` PATCH gövdesine `conditions`, re-bundle. (2) routes/settings.ts `updateRuleBody`'ye skill_ids doğrulaması (tenant içi skill id'leri; yabancı id → 404). (3) routing-service.ts: `RoutingConditions`'a `skill_ids?: number[]`; `#selectAgent`'a gerekli skill listesi parametresi; ham SQL'e `agent_skills` JOIN + `license_id = ${licenseId}` filtresi + gerekli skill'lerin HEPSİNE sahip olma koşulu (HAVING COUNT(DISTINCT skill_id) = n); mevcut kapasite HAVING'i ve tie-break sırası KORUNUR. (4) Aday yoksa gevşetme sırası DETERMİNİSTİK ve tek yerde: skill'li aday yok → aynı grupta skill'siz aday DENENMEZ → mevcut `#fallbackGroup` zinciri → kuyruk; karar kodda yorumla gerekçelendirilir.
DOSYALAR: apps/api/src/services/routing/routing-service.ts · apps/api/src/routes/settings.ts · packages/contract/openapi/paths/settings.yaml · packages/contract/openapi/openapi.yaml · apps/api/test/integration/routing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/routing/routing-service.ts (#selectAgent satır 246-269 — genişletilecek SQL iskeleti; #fallbackGroup satır 237-244 — fallback deseni) · apps/api/test/integration/routing.test.ts (mevcut ADR-08 senaryo kalıbı)
KK (birebir): "Uzmanlık/skill bazlı" | "KK-türetilmiş: Bir routing kuralı skill istiyorsa, o skill(ler)e sahip OLMAYAN ajan hiçbir koşulda seçilmez; skill'li uygun aday yoksa ADR-08'in mevcut fallback grup → kuyruk zinciri işler (skill gevşetilmez). (Türetme gerekçesi: PRD KK yetersiz — facts.kk_yetersiz=true; 'gevşetme mi kuyruk mu' PRD'de yazmıyor ve ADR-08 zinciri PLAN.md:57'de 'havuz → priority katmanı → en az yüklü → last_assigned_at ASC → fallback → kuyruk' olarak kilitli; skill havuzun daraltıcısı olarak konumlandırıldı.)"
KK DOĞRULAMA: routing.test.ts — NEGATİF (önce): skill isteyen kuralda, skill'i olmayan tek uygun ajan varken atama YAPILMAZ, sohbet fallback/kuyruğa düşer. POZİTİF: skill'li iki aday arasında ADR-08 sırası birebir korunur (primary tier → en az yüklü → last_assigned_at ASC). REGRESYON: skill_ids taşımayan mevcut kurallar için routing.test.ts'in tüm eski senaryoları değişmeden yeşil. CROSS-TENANT: B lisansındaki agent_skills satırı A'nın adaylığını etkilemez.
KAPSAM DIŞI: supervisor takeover (08.6.3-d) · skill ağırlığı/seviyesi ile skorlama · AI ajanı skill'i · tüm UI (08.6.3-e / -f) · yeni routing kuralı OLUŞTURMA formu — mevcut UI'da zaten yok (SettingsPage.tsx yalnız liste+toggle), bu kalemin işi değil
SÖZLEŞME: EVET — settings.yaml: RoutingRule `conditions` şemasına katkısal `skill_ids`, `routingRule` PATCH gövdesine `conditions`. Yeni path YOK, mevcut şemalar katkısal genişliyor; yine de re-bundle şart (contract-parity.test.ts).
MIGRATION: yok — routing_rules.conditions jsonb esnek (facts §sema_tablolari: 'jsonb esnek olduğundan skill koşulu şema değişikliği gerektirmeden eklenebilir')
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 66.4. 08.6.3-d [OPUS-MAX] Supervisor takeover çekirdeği: rol kapısı + eşzamanlı devir reddi + audit + RTM (BÖLÜNMEZ)

**Status:** done  
**Dependencies:** None  

Contract-first: chats.yaml'a `takeover` bloğu (POST /chats/{chatId}/takeover, gövde `{reason}`, yanıt Chat, 403/404/409) + openapi.yaml + re-bundle. Backend: routes/chats.ts'e handler — principal.kind==='agent' + roleAtLeast(actorRole,'admin') ÇİFT KAPISI (transfer'den ayrışan yüzey: transfer = rızalı devir, takeover = rol-kısıtlı zorla devir). ChatService.takeover: `withTenant` transaction içinde

**Details:**

08.6.3-d — Supervisor takeover çekirdeği: rol kapısı + eşzamanlı devir reddi + audit + RTM (BÖLÜNMEZ)  [OPUS-MAX]

PRD: FR-MOD-08.6.3 (+ NFR-S3, NFR-S5, NFR-S12)
ETİKET GEREKÇESİ: OPUS-MAX: authZ sınırı (başka bir ajanın sohbetini ZORLA almak — yetki eskalasyonu yüzeyi) + eşzamanlılık/kilit (iki supervisor'ın aynı sohbeti aynı anda alma yarışı) + denetlenebilirlik (NFR-S12). Koşul 2 ve 3 birlikte ihlal; güvenlik işi asla sonnet'e verilmez. Çekirdek bölünmez: rol kapısı, koşullu yazma ve audit kaydı aynı bağlamda akıl yürütülmezse 'yetkisiz ikinci yazıcı kazanır' hatası doğar.
NEDEN AÇIK: `grep -rn -i 'takeover' apps packages` → API/kontrat yüzeyinde 0 eşleşme; yalnız apps/web/src/features/traffic/rowActions.ts:49 'Supervise chat' etiketi ve TrafficPage.tsx:95-97 (o da sadece `navigate('/app/inbox?chat=...')` yapıyor — izleme değil, sekme açma). Mevcut POST /chats/:chatId/transfer (routes/chats.ts:282-296) yalnız `chats--all:rw`/`chats--access:rw` scope'una bakıyor, roleAtLeast kontrolü YOK; TrafficPage.tsx:75-78 'Assign chat to me' bunu `agent_id = kendi hesabım` ile çağırıyor — yani bugün herhangi bir yazma-yetkili ajan başkasının sohbetini alabiliyor. AUDIT_ACTIONS kapalı sözlüğünde (audit-log.ts:34-67) takeover karşılığı yok. RTM_PUSH_ACTIONS (packages/types/src/rtm.ts:117-145) listesinde takeover push'u yok.
KAPSAM: Contract-first: chats.yaml'a `takeover` bloğu (POST /chats/{chatId}/takeover, gövde `{reason}`, yanıt Chat, 403/404/409) + openapi.yaml + re-bundle. Backend: routes/chats.ts'e handler — principal.kind==='agent' + roleAtLeast(actorRole,'admin') ÇİFT KAPISI (transfer'den ayrışan yüzey: transfer = rızalı devir, takeover = rol-kısıtlı zorla devir). ChatService.takeover: `withTenant` transaction içinde thread'in mevcut assignee'si okunur ve KOŞULLU güncellenir (`updateMany where { id, assigneeId: beklenen }`; etkilenen satır 0 → 409, ikinci supervisor reddedilir); önceki assignee `ChatUser.present=false`, yeni supervisor upsert `present=true`; `system_event: 'chat_taken_over'` olayı eklenir. AUDIT_ACTIONS'a `chat.taken_over` + writeAuditEntry (aktör id, önceki assignee id, chat id — PII-minimal, mesaj içeriği YOK). RTM_PUSH_ACTIONS'a `chat_taken_over` + publisher yayını (transfer'deki audience birleşimi deseniyle).
DOSYALAR: packages/contract/openapi/paths/chats.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/chats.ts · apps/api/src/services/chat/chat-service.ts · apps/api/src/services/audit/audit-log.ts · packages/types/src/rtm.ts · apps/api/test/integration/chats.test.ts · apps/api/test/integration/audit-log.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/agents.ts (satır 161-183 — 'başkası üzerinde etkili aksiyon' için principal.kind + roleAtLeast çift kapısı; kopyalanacak yorumlu desen) · apps/api/src/services/chat/chat-service.ts (transfer, satır 904-1016 — hedef doğrulama → ChatUser upsert → #appendEvent system_message → audience birleşimi → publisher.publish) · apps/api/src/services/audit/audit-log.ts (AUDIT_ACTIONS 'member.suspended' + writeAuditEntry) · packages/contract/openapi/paths/chats.yaml (transfer bloğu satır 243-276)
KK (birebir): "supervisor takeover" | "KK-türetilmiş: Takeover yalnız admin/viceowner/owner (roleAtLeast 'admin') rolündeki oturum açmış bir ekip üyesi tarafından çağrılabilir; aynı sohbete eşzamanlı iki takeover denemesinden yalnız biri başarılı olur ve her başarılı devir audit_log'a yazılır. (Türetme gerekçesi: PRD KK yalnız 'supervisor takeover' diyor — facts.kk_yetersiz=true; rol sınırı v2-04-guvenlik-uyumluluk.md:141 'Bu scope'un yalnızca supervisor/admin rolüne açılması' bulgusundan, eşzamanlılık ve audit facts.guvenlik_yuzeyi (3) ve (4)'ten türetildi.)"
KK DOĞRULAMA: chats.test.ts (veya yeni takeover.test.ts) — NEGATİF (önce): `agent` rolüyle POST /chats/{id}/takeover → 403; bot/PAT principal → 403; başka lisansın chat id'si → 404 (enumerable değil); kapalı chat → 409. EŞZAMANLILIK: aynı chat'e paralel iki takeover → tam olarak biri 200, diğeri 409 ve son assignee tek. POZİTİF: admin takeover → thread.assignee_id yeni supervisor, önceki assignee ChatUser.present=false, transcript'te system_event görünür. AUDIT: audit-log.test.ts — `chat.taken_over` satırı aktör + hedef id ile yazılıyor, metadata'da token/secret yok. RTM: `chat_taken_over` push'u audience'a yayınlanıyor.
KAPSAM DIŞI: skill katmanı (08.6.3-a/-b/-c) — bu çekirdek onlardan bağımsız, paralel gidebilir · salt-okunur gözlemci ('watch') rolü: ChatUser.userType'a yeni tür eklemek — facts §eksikler'de ayrı bir boşluk, bu kalemde YAPILMAZ · UI butonu (08.6.3-g) · çoklu-ajan çakışma uyarısı UI'ı (08.6.3-h) · mevcut /chats/:chatId/transfer davranışının değiştirilmesi — transfer olduğu gibi kalır
SÖZLEŞME: EVET — chats.yaml'a `takeover` path'i + openapi.yaml şema/enum; re-bundle edilmezse contract-parity.test.ts kırılır. AYRICA iki kapalı TS union'ı büyüyor: AUDIT_ACTIONS (audit-log.ts) ve RTM_PUSH_ACTIONS (packages/types/src/rtm.ts) — bunları tüketen testler/tipler güncellenmezse derleme hatası. YENİ ApiError TİPİ gerekirse (eşzamanlı devir 409'u için mevcut chat_inactive/group_offline/group_unavailable semantik olarak uymuyor) bu depodaki tuzak: errors.ts'te İKİ yer (ERROR_TYPES + ERROR_STATUS) + packages/types/src/scopes.test.ts:95 sayaç (`expect(ERROR_TYPES).toHaveLength(24 + SIYAHTUS_ADDED_TYPES.length)`) + openapi enum + regen (hafıza notu: siyahtus-error-type-additions).
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 66.5. 08.6.3-e [SONNET-XHIGH] Settings: Skills kataloğu bölümü + routing kuralında skill koşulu gösterimi

**Status:** done  
**Dependencies:** 66.2, 66.3  

Settings'e yeni `Skills` bölümü: katalog listesi (`GET /settings/skills`), skill ekle (`POST`), sil (`DELETE`), boş liste → anlamlı empty state (boş dikdörtgen değil — FR-EK-B.1 deseni), `canEdit` false ise salt-okunur. Ekle formu ortak form primitifiyle (alan-altı hata + geçersizken submit pasif). Ayrıca `describeConditions` çıktısına skill koşulu eklenir: `conditions.skill_ids` → skill adları. O

**Details:**

08.6.3-e — Settings: Skills kataloğu bölümü + routing kuralında skill koşulu gösterimi  [SONNET-XHIGH]

PRD: FR-MOD-08.6.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — tek dosya + testi, güvenlik sınırı yok (rol kapısı sunucuda 08.6.3-b'de; UI yalnız mevcut `canEdit` bayrağıyla gizler), eşzamanlılık yok, kopyalanacak desen ismen ve satır numarasıyla var (aynı dosyadaki RoutingRules bileşeni satır 1007-1075), kontrat değişikliği yok, KK mekanik doğrulanabilir (render + boş liste + ekle/sil).
NEDEN AÇIK: SettingsPage.tsx'teki `RoutingRules` bileşeni (satır 1007-1075) yalnız `GET /settings/routing-rules` listesini ve enable/disable toggle'ını render ediyor; skill/uzmanlık alanı yok. `describeConditions` yalnız url/ülke koşullarını metne çeviriyor. Settings sayfasında 'Skills' başlıklı bir bölüm yok.
KAPSAM: Settings'e yeni `Skills` bölümü: katalog listesi (`GET /settings/skills`), skill ekle (`POST`), sil (`DELETE`), boş liste → anlamlı empty state (boş dikdörtgen değil — FR-EK-B.1 deseni), `canEdit` false ise salt-okunur. Ekle formu ortak form primitifiyle (alan-altı hata + geçersizken submit pasif). Ayrıca `describeConditions` çıktısına skill koşulu eklenir: `conditions.skill_ids` → skill adları. Optimistic silme + hata geri alma mevcut `optimisticCacheUpdate` helper'ıyla.
DOSYALAR: apps/web/src/features/settings/SettingsPage.tsx · apps/web/src/features/settings/SettingsForms.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/SettingsPage.tsx (RoutingRules bileşeni satır 1007-1075 — useQuery + useMutation + optimisticCacheUpdate + Section/Card/EmptyState/StatusDot kalıbı ve `describeConditions`) · apps/web/src/features/settings/BannedCustomerIps.test.tsx (liste + ekle/sil ekranının test kalıbı) · apps/web/src/components/EmptyState.tsx
KK (birebir): "Uzmanlık/skill bazlı"
KK DOĞRULAMA: unit (vitest + RTL) — katalog listesi render eder; boş yanıt → anlamlı empty state; ekle formunda boş ad → alan-altı hata + submit pasif; sil → listeden düşer, sunucu hatasında geri gelir; `canEdit=false` → ekle/sil kontrolleri render edilmez; skill_ids taşıyan routing kuralı satırında skill adı görünür.
KAPSAM DIŞI: ajan başına skill ataması (08.6.3-f) · takeover butonu (08.6.3-g) · yeni routing kuralı OLUŞTURMA formu — bugün de yok, bu kalemin kapsamı değil · skill bazlı raporlama
SÖZLEŞME: yok — yalnız 08.6.3-b/-c'de eklenen mevcut endpoint'ler tüketilir
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 66.6. 08.6.3-f [SONNET-XHIGH] Team: ajan başına skill ataması ekranı

**Status:** done  
**Dependencies:** 66.2  

Team ekranında bir ajan satırından açılan skill atama yüzeyi: mevcut skill kataloğunu (`GET /settings/skills`) çoklu seçimle gösterir, kaydet → `PUT /agents/{agentId}/skills` (tam değiştirme). Ajanın mevcut skill'leri `GET /agents` yanıtından okunur (08.6.3-b'de serialiseAgent'a eklendi). Katalog boşsa 'önce Settings → Skills'ten skill ekleyin' yönlendirmeli empty state. Rol yetersizse (mevcut `ro

**Details:**

08.6.3-f — Team: ajan başına skill ataması ekranı  [SONNET-XHIGH]

PRD: FR-MOD-08.6.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 3 dosya, güvenlik kararı yok (PUT'un rol kapısı sunucuda 08.6.3-b'de), eşzamanlılık yok, kopyalanacak desen ismen var (TeamPage.tsx `useSuspension` satır 70-78 mutation kalıbı + CopilotKnowledge.tsx feature-içi ayrı bileşen/test deseni), kontrat değişikliği yok, KK mekanik doğrulanabilir.
NEDEN AÇIK: TeamPage.tsx teammates/roller/gruplar/chatbots sorgularını yapıyor (satır 106-124: `/agents`, `/agents?status=suspended`, `/ai-agents`, `/groups`) ama ajan başına skill/uzmanlık ataması yok (facts §mevcut_kod: 'Teammates/roller ekranı var; ajan başına skill/uzmanlık ataması yok').
KAPSAM: Team ekranında bir ajan satırından açılan skill atama yüzeyi: mevcut skill kataloğunu (`GET /settings/skills`) çoklu seçimle gösterir, kaydet → `PUT /agents/{agentId}/skills` (tam değiştirme). Ajanın mevcut skill'leri `GET /agents` yanıtından okunur (08.6.3-b'de serialiseAgent'a eklendi). Katalog boşsa 'önce Settings → Skills'ten skill ekleyin' yönlendirmeli empty state. Rol yetersizse (mevcut `roleAtLeast` yardımcısı, TeamPage.tsx:62) kontrol salt-okunur.
DOSYALAR: apps/web/src/features/team/AgentSkills.tsx · apps/web/src/features/team/AgentSkills.test.tsx · apps/web/src/features/team/TeamPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/team/TeamPage.tsx (useSuspension satır 70-78 — api.put + queryClient invalidate kalıbı; roleAtLeast satır 62) · apps/web/src/features/team/CopilotKnowledge.tsx + CopilotKnowledge.test.tsx (feature içinde ayrı bileşen + testinin kalıbı) · apps/web/src/components/ui/Modal.tsx (atama diyaloğu)
KK (birebir): "Uzmanlık/skill bazlı"
KK DOĞRULAMA: unit (RTL) — ajanın mevcut skill'leri işaretli açılır; seçim değişip kaydedilince `PUT /agents/{id}/skills` doğru `skill_ids` gövdesiyle çağrılır; katalog boşsa yönlendirmeli empty state; rol yetersizse kontroller devre dışı. E2E `team.spec.ts`'e skill atama görünürlük iddiası.
KAPSAM DIŞI: skill kataloğu CRUD'u (08.6.3-e) · routing davranışı (08.6.3-c) · takeover (08.6.3-d/-g) · toplu (bulk) skill atama
SÖZLEŞME: yok — 08.6.3-b'de eklenen endpoint tüketilir (ajanın mevcut skill listesinin `GET /agents` yanıtında dönmesi 08.6.3-b'nin kapsamındadır)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 66.7. 08.6.3-g [SONNET-XHIGH] Inbox: supervisor takeover butonu (rol kapılı, onaylı) + devir sonrası durum

**Status:** done  
**Dependencies:** 66.4  

Sohbet detayında 'Take over' aksiyonu: yalnız admin/viceowner/owner rolünde görünür; tıklayınca onay modali (kimden alınacağı yazar) → `POST /chats/{chatId}/takeover`; başarıda sohbet listesi + detay invalidate, assignee güncellenir; 403 → 'Bu işlem için yönetici olmalısınız', 409 → 'Bu sohbeti başka bir yönetici az önce devraldı' mesajı. Devir sonrası önceki assignee'nin ekranı RTM push'uyla günc

**Details:**

08.6.3-g — Inbox: supervisor takeover butonu (rol kapılı, onaylı) + devir sonrası durum  [SONNET-XHIGH]

PRD: FR-MOD-08.6.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 3 dosya, güvenlik KARARI yok (yetki 08.6.3-d'de sunucuda; UI yalnız `useAuth`'tan gelen rolle butonu gizler ve 403/409 yanıtını mesaja çevirir), eşzamanlılık akıl yürütmesi yok (yarışın çözümü sunucuda), kopyalanacak desen ismen var (TeamPage useSuspension mutation + ui/Modal onay + Banner), kontrat değişikliği yok.
NEDEN AÇIK: `grep -n 'transfer' apps/web/src/features/inbox/*.tsx` → tek eşleşme InboxPage.tsx:207'deki bir YORUM satırı; inbox'ta devir/takeover için hiçbir buton veya çağrı yok. Devralma bugün yalnız Customers/Traffic ekranındaki 'Assign chat to me' üzerinden ve rol kapısı olmadan yapılabiliyor (TrafficPage.tsx:75-78).
KAPSAM: Sohbet detayında 'Take over' aksiyonu: yalnız admin/viceowner/owner rolünde görünür; tıklayınca onay modali (kimden alınacağı yazar) → `POST /chats/{chatId}/takeover`; başarıda sohbet listesi + detay invalidate, assignee güncellenir; 403 → 'Bu işlem için yönetici olmalısınız', 409 → 'Bu sohbeti başka bir yönetici az önce devraldı' mesajı. Devir sonrası önceki assignee'nin ekranı RTM push'uyla güncellenir (push tüketimi mevcut RTM istemcisine yeni action'ı tanıtmakla sınırlı).
DOSYALAR: apps/web/src/features/inbox/DetailsPanel.tsx · apps/web/src/features/inbox/DetailsPanel.test.tsx · apps/web/src/features/inbox/useInbox.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/team/TeamPage.tsx (useSuspension satır 70-78 — yetkili aksiyon mutation kalıbı) · apps/web/src/components/ui/Modal.tsx + Modal.test.tsx (onay diyaloğu) · apps/web/src/features/traffic/rowActions.ts (aksiyonun rol/scope ile gating edilmesinin saf-fonksiyon kalıbı) · apps/web/src/components/ui/Banner.tsx (hata/uyarı tonları)
KK (birebir): "supervisor takeover"
KK DOĞRULAMA: unit (RTL) — `agent` rolünde buton HİÇ render edilmez (negatif, önce); admin rolünde render edilir; tıkla → onay modali → onayla → `POST /chats/{id}/takeover` çağrılır; 403 yanıtı yetki mesajı, 409 yanıtı 'başkası devraldı' mesajı gösterir. E2E `inbox-panel.spec.ts`'e admin oturumunda takeover görünürlüğü.
KAPSAM DIŞI: yetki/eşzamanlılık kararı (08.6.3-d, sunucu) · çoklu-ajan çakışma uyarısı (08.6.3-h) · salt-okunur gözlemci modu · mevcut transfer akışının UI'ı — bu kalemde eklenmiyor
SÖZLEŞME: yok — 08.6.3-d'de eklenen endpoint tüketilir
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 66.8. 08.6.3-h [SONNET-XHIGH] Çoklu-ajan çakışma uyarısı (aynı sohbette birden fazla present ajan)

**Status:** done  
**Dependencies:** None  

Saf `conflict.ts` modülü: ChatDetail.users içinden `user_type==='agent' && present` olanları sayar, kendim dışında en az bir ajan varsa çakışma durumu üretir (kaç kişi, kim). Inbox sohbet görünümünde uyarı banner'ı ('Bu sohbet şu anda başka bir ajanda da açık — aynı anda yanıt vermeyin'), yazarken görünür kalır. RTM `user_added_to_chat` / `user_removed_from_chat` push'ları geldiğinde durum canlı g

**Details:**

08.6.3-h — Çoklu-ajan çakışma uyarısı (aynı sohbette birden fazla present ajan)  [SONNET-XHIGH]

PRD: FR-MOD-08.6.3 (PRD §5.3 satır 408 'çoklu-ajan çakışma uyarısı')
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — saf türetme modülü + bir banner; veri ZATEN mevcut (ChatDetail.users[].present, types.ts:49-54) ve RTM push action'ları ZATEN kayıtlı (`user_added_to_chat` / `user_removed_from_chat`, rtm.ts:117-145), yani kontrat/şema değişikliği yok; güvenlik kararı yok (yalnız görsel uyarı, hiçbir şeyi engellemez); eşzamanlılık kararı yok (yarışın reddi 08.6.3-d'de sunucuda); kopyalanacak desen ismen var (typing.ts + TypingIndicator.tsx).
NEDEN AÇIK: facts §eksikler: 'Çoklu-ajan çakışma uyarısı (PRD §5.3 satır 408) için hiçbir mekanizma yok — iki ajanın aynı sohbete concurrent yazmasını/almasını tespit eden bir kontrol/uyarı bulunamadı.' Veri yolu hazır: ChatDetail yanıtı `users[]`'i `present` alanıyla döndürüyor (apps/web/src/features/inbox/types.ts:49-54; chat-service.ts chatInclude `users: true` satır 1314) ve RTM'de `user_added_to_chat` push'u zaten var (rtm.ts:117-145) — tüketen bir uyarı yok.
KAPSAM: Saf `conflict.ts` modülü: ChatDetail.users içinden `user_type==='agent' && present` olanları sayar, kendim dışında en az bir ajan varsa çakışma durumu üretir (kaç kişi, kim). Inbox sohbet görünümünde uyarı banner'ı ('Bu sohbet şu anda başka bir ajanda da açık — aynı anda yanıt vermeyin'), yazarken görünür kalır. RTM `user_added_to_chat` / `user_removed_from_chat` push'ları geldiğinde durum canlı güncellenir (mevcut istemci bu action'ları zaten taşıyor).
DOSYALAR: apps/web/src/features/inbox/conflict.ts · apps/web/src/features/inbox/conflict.test.ts · apps/web/src/features/inbox/InboxPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/inbox/typing.ts + typing.test.ts (saf türetme modülü + testi kalıbı) · apps/web/src/features/inbox/TypingIndicator.tsx (türetilmiş durumun göstergeye bağlanması) · apps/web/src/components/ui/Banner.tsx (tone'lu uyarı bileşeni)
KK (birebir): "KK-türetilmiş: Aynı sohbette kendimden başka en az bir 'present' ajan varsa sohbet görünümünde bir çakışma uyarısı görünür ve o ajan ayrılınca kaybolur. (Türetme gerekçesi: FR-MOD-08.6.3 satırının KK'sı yalnız 'Uzmanlık/skill bazlı; supervisor takeover' diyor — facts.kk_yetersiz=true; 'çoklu-ajan çakışma uyarısı' aynı v2 faz satırından geliyor: PRD §5.3 satır 408 'Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı'.)"
KK DOĞRULAMA: unit — conflict.ts: tek present ajan (ben) → uyarı yok; ben + başka present ajan → uyarı, sayı/isim doğru; başkası present=false → uyarı yok; müşteri kullanıcıları sayılmaz. RTL: uyarı banner'ı render edilir, `user_removed_from_chat` sonrası kaybolur.
KAPSAM DIŞI: eşzamanlı takeover'ın SUNUCU tarafında reddi (08.6.3-d — 409) · yazma kilidi / gerçek zamanlı 'kim yazıyor' kilidi · takeover butonu (08.6.3-g) · yeni RTM push action'ı eklemek — mevcut user_added_to_chat / user_removed_from_chat yeterli
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 66.9. 08.6.3-i [OPUS-XHIGH] Uçtan uca doğrulama: skill routing + takeover E2E, cross-tenant negatif matrisi, ADR-08 regresyonu

**Status:** done  
**Dependencies:** 66.3, 66.4, 66.5, 66.6, 66.7  

(1) Yeni E2E spec: admin oturumu → Settings'te skill oluştur → Team'de ajana ata → skill isteyen routing kuralı → sohbet doğru ajana düşer → başka bir admin sohbeti devralır → assignee değişir. (2) Cross-tenant negatif matrisi tek yerde toplanır (tenant-isolation.test.ts): skill CRUD, skill ataması, skill-eşleşmeli routing, takeover. (3) ADR-08 regresyon kapısı: skill taşımayan kurallar için mevcu

**Details:**

08.6.3-i — Uçtan uca doğrulama: skill routing + takeover E2E, cross-tenant negatif matrisi, ADR-08 regresyonu  [OPUS-XHIGH]

PRD: FR-MOD-08.6.3 (+ NFR-S3, NFR-S4, NFR-S12, NFR-M2, NFR-M3)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama (kontrat + backend + routing motoru + RTM + üç UI ekranı) ve güvenlik hassasiyeti olan doğrulama tasarımı — hangi negatifin hangi katmanda kanıtlandığına karar vermek yorum gerektiriyor (koşul 6 ihlali). Yeni güvenlik ÇEKİRDEĞİ yazılmıyor, mevcut sınırlar kanıtlanıyor → MAX değil XHIGH.
NEDEN AÇIK: facts §riskler: 'RLS: yeni agent_skills tablosu ve skill-eşleşmeli routing sorgusu için tenant-izolasyon negatif testleri (cross-tenant reddi) yazılmazsa NFR-S4 kritik R3 boşluğu tekrar açılır' ve 'Supervisor takeover, mevcut /chats/:chatId/transfer ile davranışsal çakışabilir — iki farklı sohbeti başka ajana ver yolu'. apps/e2e/tests altında skill/takeover senaryosu yok (dizin: ai-agent, billing, campaigns, command-palette, copilot, customers, demo-flow, inbox-panel, inbox-tabs, notifications, onboarding, playbook, reports, settings, team, tickets, traffic, widget).
KAPSAM: (1) Yeni E2E spec: admin oturumu → Settings'te skill oluştur → Team'de ajana ata → skill isteyen routing kuralı → sohbet doğru ajana düşer → başka bir admin sohbeti devralır → assignee değişir. (2) Cross-tenant negatif matrisi tek yerde toplanır (tenant-isolation.test.ts): skill CRUD, skill ataması, skill-eşleşmeli routing, takeover. (3) ADR-08 regresyon kapısı: skill taşımayan kurallar için mevcut routing.test.ts senaryolarının davranışı bit-bit korunur. (4) transfer↔takeover yüzey ayrımı testle sabitlenir (hangi yol hangi rol/`reason` ile). (5) DoD kapısı tam sürüm koşulur; DB-bağımlı süitler paket bazında SERİ.
DOSYALAR: apps/e2e/tests/skills-routing.spec.ts · apps/api/test/integration/tenant-isolation.test.ts · apps/api/test/integration/routing.test.ts · apps/api/test/integration/chats.test.ts
REFERANS DESEN (kopyalanacak): apps/e2e/tests/team.spec.ts · apps/e2e/tests/settings.spec.ts · apps/e2e/tests/demo-flow.spec.ts · apps/api/test/integration/tenant-isolation.test.ts
KK (birebir): "Uzmanlık/skill bazlı" | "supervisor takeover"
KK DOĞRULAMA: E2E: skill oluştur → ata → kural → sohbet skill'li ajana atanır (KK 'Uzmanlık/skill bazlı'); admin devralır → assignee değişir (KK 'supervisor takeover'). Integration: cross-tenant matrisinin dört maddesi de reddediliyor; routing.test.ts eski senaryoları değişmeden yeşil; audit_log'da `chat.taken_over` satırı görünüyor.
KAPSAM DIŞI: 08.6.3-h çakışma uyarısı — kendi unit testleriyle kapanır, RTM zamanlamasına bağlı kırılgan E2E yazılmaz · performans/yük ölçümü (NFR-P kapasite testi ayrı kalem) · yeni davranış eklemek — bu alt-görev yalnız doğrular
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
