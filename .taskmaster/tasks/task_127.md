# Task ID: 127

**Title:** 13.7 — Mobil modül paritesi borcu: Billing/Playbook/Team yüzeyleri (§D96 payı · M-MOBILE-PARITY)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** PRD FR-MOD-13.7'nin "tam modül paritesi" payı karşılanmadı: telefonda dört yüzey var (Inbox/AI/CRM/Reports) ama Billing/Playbook/Team yok — §C-A28 ile daraltıldı, §D96'da kabul edilen borç olarak kayıtlı, ama bugüne dek onu ödeyecek hiçbir görev açılmadı. Bu görev o borcun kapatılabilir yarısını üç salt-okunur mobil modülle öder; mağaza payı (.ipa/.apk) CLAUDE.md sınırı gereği dışarıda kalır.

**Details:**

BULGU (panel sağlık taraması · çelişki denetimi 2026-08-17 · PLAN.md:572):
Tarama şunu gördü: `13.7` gereksinim satırı `◐` damgalı ama bu PRD'yi kapsayan Task Master
görevlerinin TAMAMI kapalı (tm 90 + 90.1–90.11 + 125 + 126). Yani damga bir borç ilan ediyor,
kuyrukta o borcu ödeyecek hiçbir görev yok — borç yalnız düzyazıda yaşıyor. Bu görev o boşluğu
kapatır. HANDOFF.md (tm 126, "Sonraki pencereye not") bu kalemi zaten adıyla aday göstermişti:
**M-MOBILE-PARITY**.

DENETİMİN KOD SONUCU — görev ERKEN KAPATILMADI, damga da BAYAT DEĞİL: İŞ KISMİDİR.
PRD FR-MOD-13.7 KK'sı (urun-gereksinim-dokumani-PRD.md:719) üç pay ister:
  (1) "Inbox/AI/CRM/Reports mobilde" → KARŞILANDI. Dördü de diskte ve MONTELİ:
      apps/mobile/src/features/inbox/{ChatListScreen,ChatScreen}.tsx ·
      features/copilot/CopilotScreen.tsx ·
      features/customers/{CustomerListScreen,CustomerDetailScreen}.tsx ·
      features/reports/ReportsScreen.tsx — tab'lar apps/mobile/src/app/RootNavigator.tsx:25-28.
  (2) "push" → KARŞILANDI. Sunucu apps/api/src/routes/notifications.ts:115-240 +
      apps/api/src/services/notifications/push.ts; telefon ucu apps/mobile/src/auth/push-tokens.ts
      + apps/mobile/src/auth/device-token-transport.ts (tm 125).
  (3) "**tam modül paritesi**" → KARŞILANMADI. apps/mobile/src/features/ altında BEŞ dizin var
      (copilot · customers · inbox · notifications · reports); billing/playbook/team YOK.
      apps/mobile/src/__tests__/parity.test.ts:188-215 bunu bir iddia olarak PİNLER: dört modül
      (Settings · Billing · Playbook · Team) `OUT_OF_SCOPE`'tur ve test telefonun onların
      uçlarını HİÇ çağırmadığını doğrular (parity.test.ts:332-340).
Kapı bu turda ölçüldü: apps/mobile jest **331/331 · 26 süit · exit 0**. Yani anlatılan iş gerçekten
yerinde; eksik olan gizlenmiş iş değil, §D96'da **ilan edilmiş borçtur**.

BU GÖREVİN PAYI: §D96'nın iki borcundan **yalnız ikincisi** (modül paritesi daraltması).
Birincisi (mağaza payı: `.ipa`/`.apk` + store yüklemesi) CLAUDE.md sınırıdır ("production deploy
YOK") ve BU GÖREVİN DIŞINDADIR — kalıcıdır.

DOKUNULACAK DOSYALAR (üç alt-görev, her biri kendi modülü):
  yeni: apps/mobile/src/features/team/     (127.1)
  yeni: apps/mobile/src/features/playbook/ (127.2)
  yeni: apps/mobile/src/features/billing/  (127.3)
  ortak: apps/mobile/src/app/navigation.ts · app/RootNavigator.tsx · app/stacks/*.tsx ·
         apps/mobile/src/lib/contract.ts (`MOBILE_ENDPOINTS`) ·
         apps/mobile/src/__tests__/parity.test.ts (matris — aşağıdaki 1. tuzak)

CONTRACT-FIRST SIRA: bu görevde **sözleşme adımı YOKTUR** — üç modülün uçları zaten belgeli ve
sunuluyor (openapi.yaml:236 `/agents` · :254 `/groups` · :261 `/skills` · :278 `/copilot/knowledge`
· :475-489 `/billing/*`). Migration YAZILMAZ, şema DEĞİŞMEZ, sunucu DEĞİŞMEZ. Sıra tersine değil,
kısaltılmış işler: tipli istemci (`features/<mod>/api.ts`, tipler sözleşmeden TÜRETİLİR —
`ContractResponseBody<'/agents','get'>` deseni, 13.7-g'nin yaptığı gibi; web'in elle yazılmış
`types.ts`'i KOPYALANMAZ) → Provider/context ayrımı (13.7-f/-g deseni: tek yerde `useServices()`,
ekranlar yalnız context tüketir; testler sahte api enjekte edebilsin diye) → ekranlar → navigasyon
→ parite matrisi → testler.

HEPSİ SALT-OKUNUR. Gerekçe: telefonun mevcut dört yüzeyinin üçü zaten salt-okunur (CRM 13.7-g ·
Reports 13.7-h · Copilot 13.7-i) ve §C-A28'in "authoring is desk work" gerekçesi yazma payı için
HÂLÂ geçerlidir. Bu görev **görünürlüğü** getirir, yazmayı değil — daraltma her modülün matris
satırındaki `narrowedTo` alanına YAZILIR (parity.test.ts:266-271 boş bırakılmasına izin vermez).

BİLİNEN TUZAKLAR:
1) **`parity.test.ts` ilk yeni istekte KIRMIZIYA DÖNER — tasarım gereği.** Matris iki yönlü tam
   eşitlik iddia eder: telefonun çağırdığı her yol ya bir yüzeye ya `SUPPORTING`'e sınıflanmış
   olmalı (parity.test.ts:294-303), ve `OUT_OF_SCOPE`'un dört modülünden hiçbirinin yolu
   çağrılmamış olmalı (:332-340). Yani her alt-görev, kendi modülünü `OUT_OF_SCOPE`'tan ÇIKARIP
   matrise EKLEMEK zorundadır — AYNI alt-görevte. Testi susturmak (`OUT_OF_SCOPE`'u budamak ama
   yüzeyi sınıflamamak) kapıyı geçmez. `expect(OUT_OF_SCOPE).toHaveLength(4)` ve
   `.toEqual(['Settings','Billing','Playbook','Team'])` (:323-330) de güncellenir; üçü de
   ödendiğinde geriye **yalnız `Settings`** kalır (§C-A28 · aşağıdaki KAPSAM SINIRI).
2) `MATRIX`'in `criterion` tipi PRD KK'sının ismen saydığı dördü sabitler
   ('Inbox'|'AI'|'CRM'|'Reports', parity.test.ts:94). Yeni üç modül o dördün üyesi DEĞİLDİR —
   KK'nın "tam modül paritesi" payıdır. Onları o birliğe zorla sokmak matrisi yalancı yapar;
   ayrı bir liste (ör. `PARITY_MODULES`) açıp `classified` kümesine katmak doğru şekildir.
   Serbest bırakılan tek şey adı; ZORUNLU olan, 1. tuzaktaki iki yönlü eşitliğin korunmasıdır.
3) `MOBILE_ENDPOINTS` (apps/mobile/src/lib/contract.ts:73-80) ile matrisin `registry` alanları
   arasında da TAM eşitlik aranır (parity.test.ts:275-283). Yeni uçlar oraya da kaydedilir;
   `contractPath()` sözleşmeye karşı `tsc` ile doğrulandığı için yanlış yazılmış bir yol
   `pnpm -w typecheck`'te kırmızıya döner (kastedilen davranış).
4) Matris `api.ts`'i **regex ile okur**: `.request('get', '/agents')` gibi **string literal**
   ister (parity.test.ts:260-262). Yolu değişkenden/şablondan kurarsan test onu göremez ve
   "karşılığı olmayan matris satırı" hatası alırsın.
5) apps/mobile'da **production kaynak `node:*` import EDEMEZ** (Metro); `node:fs` yalnız testlerde
   (parity.test.ts zaten öyle kullanıyor). Ayrıca bir `jest.mock` fabrikası yerel bir `const`'u
   KAPATAMAZ (hoisting) — mevcut mobil testlerin deseni izlenir.
6) Expo **managed** workflow; custom native modül YAZILMAZ (§C-A28). Yeni bir bağımlılık
   `expo export`'u kırabilir — build kapısı ios+android iki bundle üretmeye devam etmeli.
7) `GET /agents/{agentId}/expertise` YOKTUR (yalnız `put`, agents.yaml:282-290). Uzmanlık
   salt-okunur gösterilecekse kaynağı `GET /agents` satırıdır, ayrı bir uç değil.

KAPSAM SINIRI — NEYE DOKUNULMAYACAK:
- **Sunucu · şema · sözleşme**: DOKUNULMAZ. Migration yazılmaz, yeni uç açılmaz, `openapi.yaml`
  değişmez. Bir uç eksik görünüyorsa doğru cevap onu eklemek değil, ekranı daraltmaktır.
- **§D96'nın mağaza payı**: bu görevin dışında ve kalıcı. `parity.test.ts:224-226`'daki
  `OPEN_DEBTS` dizisinin tek maddesi (store publishing) AYNEN KALIR.
- **`13.7` satırı bu görev bitince de `◐` KALIR** (PLAN.md:572) — mağaza payı sürüyor. `✅`
  UYDURULMAZ; yapılacak olan §K13.7'ye madde eklemek ve §C-A28 (PLAN.md:3945-3948) +
  §D96 (PLAN.md:4400) + PLAN.md:2531-2536'daki daraltma cümlelerini GÜNCELLEMEKTİR
  (silmek değil — geçmiş kaydıdır; CONVENTIONS §1.2).
- **Settings (workspace administration) mobil kapsam dışı KALIR** — §C-A28 dört modül sayar ama
  §D96'nın borç cümlesi yalnız üçünü sayar (Billing/Playbook/Team). Settings'ten gelen tek pay
  bildirim tercihleridir ve 13.7-j'de teslim edildi.
- **apps/web · apps/e2e · apps/api'ye DOKUNULMAZ.** Mobil Playwright'a girmez (§C-A28) —
  `pnpm -w test:e2e` regresyon kontrolüdür, yeni kanıt PNG üretilmez.
- **Kapalı görevler (tm 90.x · 125 · 126) GERİ AÇILMAZ** (BUILD-BLUEPRINT K1).

NOT (öncelik): bu görev `critical` çünkü panelin sağlık taramasının bulgusundan doğdu
(CONVENTIONS §4.1). Alt-görevleri bittiğinde priority DEĞİŞTİRİLMEZ — işin nereden geldiğinin
izidir. Ayrıca HANDOFF'un tm 126 notu "kendiliğinden açılması gereken görev yoktur, sıradaki adım
kullanıcının seçimidir" diyordu; bu görevi açan şey kendiliğindenlik değil, panelin bu bulguyu
düzeltme penceresine göndermesidir.

**Test Strategy:**

Üç alt-görevin üçü de `done` olduğunda bitmiştir. Her alt-görev kendi kapısından geçer; üst görev
ayrıca şu ölçülebilir sonucu ister (hepsi exit 0):
- `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` (mobil `expo export` ios+android iki bundle)
- `pnpm --filter @siyahtus/mobile test` — tüm mobil süit yeşil (taban: 331/331 · 26 süit)
- `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w test:e2e` regresyonsuz
- ÖLÇÜLEBİLİR KABUL: `apps/mobile/src/__tests__/parity.test.ts` içinde `OUT_OF_SCOPE` **4 → 1**
  (yalnız `Settings` kalır), telefonun sınıflanmış uç sayısı 15'ten artar, ve `OPEN_DEBTS`
  **1 maddede kalır** (mağaza payı) — yani matris paritenin ödendiğini SAYARAK gösterir.
- PLAN.md: `13.7` satırı `◐` KALIR; §K13.7'ye madde eklenir; §C-A28 + §D96 + §5 daraltma
  cümleleri güncellenir (CONVENTIONS §1.2 — hücreye kanıt yazılmaz).

## Subtasks

### 127.1. 13.7-m [SONNET-XHIGH] Mobil Team (ekip) yüzeyi — ajan listesi + ajan detayı + gruplar (SALT-OKUNUR)

**Status:** done  
**Dependencies:** None  

§D96'nın modül paritesi borcunun "Team" payı: telefonda ekip görünürlüğü. Kim çevrimiçi, kim askıda, kim hangi rolde, hangi gruplar var — mobilde okunabilir olsun.

**Details:**

NE YAPILACAK: `apps/mobile/src/features/team/` — ajan listesi + ajan detayı + grup listesi.

UÇLAR (üçü de GET, üçü de zaten belgeli ve sunuluyor):
- `GET /agents` — openapi.yaml:236 → paths/agents.yaml:138-139. Liste satırının kendisi
  rol/askı/durum bilgisini taşır; ayrı bir `GET /agents/{agentId}` **YOKTUR**, detay ekranı bu
  satırdan + çalışma takviminden kurulur.
- `GET /agents/{agentId}/work-schedule` — openapi.yaml:244 → paths/agents.yaml:328-340.
- `GET /groups` — openapi.yaml:254 → paths/agents.yaml:389-390.
DIŞARIDA: `PUT /agents/{agentId}/role` · `/suspension` · `/expertise` (yalnız `put`, GET'i yok —
agents.yaml:282-290) · davet akışı. Hepsi yazma/masa işi; `narrowedTo`'ya yazılır.

EKRANLAR:
- `TeamListScreen` — ajan satırları (ad · rol · çevrimiçi/askıda rozeti). Boş/yükleniyor/hata
  üç ayrı cümle (`ListPlaceholder` deseni, 13.7-f/-g).
- `TeamMemberScreen` — liste satırından gelen kimlik kartı + çalışma takvimi (salt-okunur).
- Grup listesi ayrı ekran ya da liste ekranında ikinci segment — ikisi de kabul; seçim
  `narrowedTo`'da gerekçelenir.
NAVİGASYON: yeni bir kök tab AÇMAK ZORUNLU DEĞİL — `SettingsStack` altına bağlamak da geçerlidir
(dört tab'lık kabuk 13.7-e'nin kararıdır). Hangisi seçilirse `navigation.ts`'te TİPLİ ve bir
`Stack.Screen`'e FİİLEN verilmiş olmalı; parity.test.ts:250-256 yalnız tipte var olan rotayı
reddeder.

WEB KARŞILIĞI (kopyalanmaz, referanstır): apps/web/src/features/team/{TeamPage,WorkSchedule,
InviteTeammates,AgentSkills}.tsx.
ORTAK KURALLAR (üst görev tm 127'nin details'i tam sürümdür — tuzaklar 1-7 ve kapsam sınırı orada):
- Salt-okunur. Yazma ucu ÇAĞRILMAZ. Daraltma matrisin `narrowedTo` alanına yazılır.
- Sunucu/şema/sözleşme DEĞİŞMEZ; uçlar zaten belgeli ve sunuluyor.
- `parity.test.ts` AYNI alt-görevte güncellenir: bu modül `OUT_OF_SCOPE`'tan çıkar, matrise girer,
  uçları `MOBILE_ENDPOINTS`'e kaydedilir. Test susturulmaz.
- Tipler sözleşmeden türetilir (`ContractResponseBody<...>`); web'in `types.ts`'i kopyalanmaz.
- Provider/context ayrımı 13.7-f/-g deseniyle; ekranlar `useServices()`'i doğrudan bilmez.
- `13.7` satırı `◐` kalır (mağaza payı, §D96).

### 127.2. 13.7-n [SONNET-XHIGH] Mobil Playbook/AI yönetimi yüzeyi — skill listesi + detay + çalışmalar + bilgi kaynakları (SALT-OKUNUR)

**Status:** done  
**Dependencies:** None  

§D96'nın modül paritesi borcunun "Playbook" payı: AI'ın ne yaptığı telefonda görünsün. Yazma (skill authoring, knowledge upload) masa işi olarak kapsam dışı kalır.

**Details:**

NE YAPILACAK: `apps/mobile/src/features/playbook/` — skill listesi + skill detayı + son
çalışmalar + bilgi kaynakları listesi.

UÇLAR (dördü de GET, dördü de zaten belgeli ve sunuluyor):
- `GET /skills` — openapi.yaml:261 → paths/playbook.yaml:77-78.
- `GET /skills/{skillId}` — openapi.yaml:267 → paths/playbook.yaml:131 (+`patch`, KULLANILMAZ).
- `GET /skills/{skillId}/runs` — openapi.yaml:269 → paths/playbook.yaml:280.
- `GET /copilot/knowledge` — openapi.yaml:278 → paths/copilot.yaml:1-2.
DIŞARIDA: `POST /skills/compile` · `POST /skills/preview` · `PATCH /skills/{skillId}` ·
`/knowledge-sources*` (bulk import dahil) · `/ai-agents*`. Skill yazmak/derlemek/önizlemek ve
bilgi yüklemek masa işidir (§C-A28'in kendi gerekçesi) — `narrowedTo`'ya yazılır.

EKRANLAR:
- `SkillListScreen` — skill satırları (ad · durum/enabled · son çalışma özeti).
- `SkillDetailScreen` — skill'in salt-okunur özeti + `runs` listesi (son N çalışma, sonuç rozeti).
- `KnowledgeSourceListScreen` — copilot bilgi kaynakları, salt-okunur.
NAVİGASYON: 13.7-m ile aynı kural — yeni kök tab zorunlu değil, ama rota TİPLİ + `Stack.Screen`'e
fiilen verilmiş olmalı (parity.test.ts:250-256).

DİKKAT: `13.7-i` (tm 90.9) zaten `/copilot/chats/{chatId}/{summary,reply}` çağırıyor ve matriste
'AI' yüzeyidir. Bu alt-görev O YÜZEYİ GENİŞLETMEZ — 'AI' KK'nın ismen saydığı dörttendir,
`/copilot/knowledge` ise §C-A28'in 'Playbook / AI administration' modülüdür. İkisi matriste
AYRI kalır; karıştırmak 'AI' yüzeyinin uç listesini bozar ve parity.test.ts:259-265 kırmızıya
döner.

WEB KARŞILIĞI (kopyalanmaz, referanstır): apps/web/src/features/playbook/{PlaybookPage,
SkillEditor,KbArticleList}.tsx.
ORTAK KURALLAR (üst görev tm 127'nin details'i tam sürümdür — tuzaklar 1-7 ve kapsam sınırı orada):
- Salt-okunur. Yazma ucu ÇAĞRILMAZ. Daraltma matrisin `narrowedTo` alanına yazılır.
- Sunucu/şema/sözleşme DEĞİŞMEZ; uçlar zaten belgeli ve sunuluyor.
- `parity.test.ts` AYNI alt-görevte güncellenir: bu modül `OUT_OF_SCOPE`'tan çıkar, matrise girer,
  uçları `MOBILE_ENDPOINTS`'e kaydedilir. Test susturulmaz.
- Tipler sözleşmeden türetilir (`ContractResponseBody<...>`); web'in `types.ts`'i kopyalanmaz.
- Provider/context ayrımı 13.7-f/-g deseniyle; ekranlar `useServices()`'i doğrudan bilmez.
- `13.7` satırı `◐` kalır (mağaza payı, §D96).

### 127.3. 13.7-o [SONNET-XHIGH] Mobil Billing yüzeyi — abonelik + kullanım + faturalar + entitlement (SALT-OKUNUR; kart/ödeme YOK)

**Status:** done  
**Dependencies:** None  

§D96'nın modül paritesi borcunun "Billing" payı: plan, kullanım ve fatura geçmişi telefonda okunabilsin. Kart/ödeme yüzeyi CLAUDE.md gereği AÇILMAZ.

**Details:**

NE YAPILACAK: `apps/mobile/src/features/billing/` — abonelik/plan + kullanım + fatura listesi +
entitlement özeti. Hepsi salt-okunur.

UÇLAR (hepsi GET, hepsi zaten belgeli ve sunuluyor — paths/reports.yaml):
- `GET /billing/subscription` — openapi.yaml:475 → reports.yaml:848-849.
- `GET /billing/usage` — openapi.yaml:477 → reports.yaml:916-917.
- `GET /billing/invoices` — openapi.yaml:479 → reports.yaml:946-947.
- `GET /billing/entitlements` — openapi.yaml:489 → reports.yaml:1160-1161.
- `GET /billing/api-packages` — openapi.yaml:485 → reports.yaml:1059-1060 (opsiyonel; alınırsa
  yalnız katalog gösterimi).

KESİN OLARAK DIŞARIDA (CLAUDE.md: "kart / ödeme YOK"):
- `/billing/payment-method` (okuma dahil — kart yüzeyi telefonda açılmaz),
- `POST /billing/api-packages/purchases` (satın alma),
- `GET /billing/invoices/{period}/download` (dosya indirme; mobil dosya/paylaşım akışı bu görevin
  işi değil).
Bu üçü modülün `narrowedTo` cümlesinde ADIYLA sayılır: "Billing kapsam dışı" demek artık yanlış
olacağı için daraltmanın nerede durduğu yazılı olmalıdır.

EKRANLAR:
- `BillingScreen` — tek ekran yeterlidir: plan kartı + dönem kullanımı + entitlement listesi +
  fatura satırları (tarih · dönem · tutar · durum). Reports'un (13.7-h) KPI kartı deseni izlenir.
NAVİGASYON: `SettingsStack` altı en doğal yer; kural 13.7-m ile aynı (tipli + fiilen monteli).

YAN FAYDA (kayda değer): `/billing/entitlements`, tm 126'nın §F.1/7 denetiminde "hiçbir istemci
çağıranı yok" diye sayılan 7 uçtan biridir. Bu alt-görev ona bir çağıran kazandırır.

WEB KARŞILIĞI (kopyalanmaz, referanstır): apps/web/src/features/billing/BillingPage.tsx.
ORTAK KURALLAR (üst görev tm 127'nin details'i tam sürümdür — tuzaklar 1-7 ve kapsam sınırı orada):
- Salt-okunur. Yazma ucu ÇAĞRILMAZ. Daraltma matrisin `narrowedTo` alanına yazılır.
- Sunucu/şema/sözleşme DEĞİŞMEZ; uçlar zaten belgeli ve sunuluyor.
- `parity.test.ts` AYNI alt-görevte güncellenir: bu modül `OUT_OF_SCOPE`'tan çıkar, matrise girer,
  uçları `MOBILE_ENDPOINTS`'e kaydedilir. Test susturulmaz.
- Tipler sözleşmeden türetilir (`ContractResponseBody<...>`); web'in `types.ts`'i kopyalanmaz.
- Provider/context ayrımı 13.7-f/-g deseniyle; ekranlar `useServices()`'i doğrudan bilmez.
- `13.7` satırı `◐` kalır (mağaza payı, §D96).
