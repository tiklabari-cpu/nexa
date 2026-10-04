# Task ID: 175

**Title:** M-TEAM — Teams yazma yollari — FR-MOD-04.5 (Must/MVP) yalniz OKUMA olarak vardi

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** `GET /groups` tek uctu; repoda `group.create`/`groupAgent.*` icin tek bir yazma cagrisi yoktu. Yonlendirme tumuyle `group_agents`e bagli oldugundan (ADR-08 adim 2) sifirdan acilan workspace hicbir sohbeti yonlendiremiyordu. PLAN.md:218 bu maddeyi "✅ Dilim 8 · /groups" diye kapatmisti — denetimin K1 kritik bulgusu.

**Details:**

PRD `urun-gereksinim-dokumani-PRD.md` satır **536-551** (FR-MOD-04.5) · denetim `prd-uyum-denetimi.md` §5 K1.

**DAL — yeni dal AÇMA.** Uçlar `feat/g2-group-write-paths` dalında commit `6ebc898` ile YAZILI (typecheck yeşil, test YOK, konsol ekranı YOK). `git fetch origin && git checkout feat/g2-group-write-paths`.

**Dalda hazır olan:** `routes/agents.ts` grup CRUD + üyelik uçları ve yardımcıları · `errors.ts` `group_in_use` (409) · `audit-log.ts` beş `group.*` eylemi · `lifecycle-service.ts` `#seedDefaultTeam` (signup → `General` takımı + owner `primary`) · OpenAPI `GroupWrite`/`GroupIdPath`/`AgentIdPath` + üretilmiş tipler. Doğrula, yeniden yazma.

**Neden güvenlik işi:** takım üyeliği erişim kontrolüdür — hangi ajanın hangi sohbeti göreceğini belirler. `routing_rules.target_group_id` ve `chat_access.group_id` **FK taşımıyor**, yani yanlış bir silmeyi veritabanı durdurmaz; uçtaki iki refüz tek savunmadır.

**Test Strategy:**

Her iş kalemi kendi DoD kapısından geçer (CONVENTIONS §1). Kalem bütününün kabul kriteri: sıfırdan açılan bir workspace gelen ilk sohbeti bir takıma yönlendirebiliyor (boş `chat_access` DEĞİL) ve konsoldan takım kurulabiliyor.

## Subtasks

### 175.1. M-TEAM-a [OPUS-MAX] BÖLÜNMEZ: grup CRUD uçlarını doğrula + tenant izolasyonu ve silme korumalarının testi

**Status:** done  
**Dependencies:** None  

WIP dalını kodu okuyarak doğrula. `groups.test.ts` aç: CRUD; B lisansının takımına A ile 404 (403 değil — enumeration koruması); `groups--all:ro` ile 403; **silme koruması A** takımı hedefleyen routing rule varken 409 `group_in_use` + `details.rule_id`; **silme koruması B** o takım üzerinden görünen AÇIK sohbet varken 409 + `details.active_chats`; arşivlenmiş sohbet silmeyi engellemez. Desen: `test/integration/channels-adapters.test.ts` (fixture + grantToken + tenant izolasyon kalıbı).

**Details:**

Bağımlılık: yok. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 175.2. M-TEAM-b [OPUS-XHIGH] Üyelik uçları: routing gerçekten değişiyor mu + priority tiers

**Status:** done  
**Dependencies:** None  

PUT ile ekle → `RoutingService` o ajanı aday görüyor; DELETE ile çıkar → görmüyor; aynı PUT priority değiştiriyor (idempotent upsert); workspace üyesi olmayan uuid → 404. `GROUP_PRIORITIES = [primary, first, normal, last]` (`packages/types/src/domain.ts:14`) ve DB `group_agents_priority_check` kısıtı. Beş `group.*` audit kaydının yazıldığını doğrula.

**Details:**

Bağımlılık: M-TEAM-a. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 175.3. M-TEAM-c [OPUS-XHIGH] KABUL: signup ile açılan taze workspace yönlendirebiliyor

**Status:** done  
**Dependencies:** None  

Kalemin varlık nedeni. Signup → `General` takımı + owner `primary` üyeliği → gelen ilk sohbet boş `chat_access` ile DEĞİL, o takıma açılıyor. `chat-service.ts` `defaultGroupIds` "ilk takıma düş" emniyetini yalnız bir takım varsa uygulayabiliyor; bu test o emniyetin artık devreye girdiğini kanıtlar. DoD yeşilse `main`e merge.

**Details:**

Bağımlılık: M-TEAM-a, M-TEAM-b. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 175.4. M-TEAM-d [SONNET-XHIGH] Teams konsol ekranı: liste + CRUD + üye yönetimi + Priority dropdown

**Status:** done  
**Dependencies:** None  

PRD KK: "Routing hedefi; edit sayfası; Priority dropdown". `apps/web/src/features/team/` altı; mevcut Team sayfası desenleri ve `apps/web/src/lib/form.tsx` (elle useState ile form kurma). 409 `group_in_use` gövdesi **görünür alan-altı hataya** dönüşmeli, sessizce yutulmamalı. Ajan seçici `GET /agents`. i18n en+tr; yeni rotayı `apps/e2e/tests/a11y.spec.ts` rota listesine ekle yoksa router-parse pini kırmızıya çeker. e2e: takım oluştur → ajan ekle → sohbet o takıma düşüyor; `kanit/04.5-teams.png`.

**Details:**

Bağımlılık: M-TEAM-c. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 175.5. M-TEAM-e [OPUS-MAX] BÖLÜNMEZ: SCIM /Groups yazma — provizyon yolu konsoldan gevşek olamaz

**Status:** done  
**Dependencies:** None  

`routes/scim.ts` şu an /Groups için salt-okunur. POST/PUT/PATCH(add|remove members)/DELETE. `displayName`→`Group.name`, `members`→`group_agents`, priority varsayılan `normal`. **M-TEAM-a silme korumaları SCIM yolunda da uygulanmalı** — servis katmanını paylaş, mantığı kopyalama. Mevcut /Users yazma yollarının hata biçimi, filtre ve sayfalama desenini izle; testler /Users testleriyle aynı sertlikte.

**Details:**

Bağımlılık: M-TEAM-b. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
