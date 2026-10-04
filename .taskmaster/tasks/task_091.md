# Task ID: 91

**Title:** 08.6.3-conflict — Çoklu-ajan çakışma uyarısı  ·  dilim V2-1

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Faz 2 (v2) · PLAN §5.2 · 7 atomik alt-görev. Bu turda kapsam süpürmesinde bulundu (PLAN §D62).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `08.6.3-conflict`.

7 atomik alt-görev · ~8 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x3 · SONNET-XHIGH x3

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  08.6.3-conflict-a [SONNET-XHIGH] Çakışma uyarısı RTM push action'ı + composer-registry anahtar/TTL tip sözleşmesi  (bağ: yok)
  08.6.3-conflict-b [OPUS-MAX] ConflictDetectionService — atomik eşzamanlı-yazıcı kaydı + çakışma kararı (güvenlik/algoritma çekirdeği)  (bağ: 08.6.3-conflict-a)
  08.6.3-conflict-c [OPUS-XHIGH] send_typing_indicator yolunda çakışma tespiti + uyarının bus envelope ile her iki ajana iletimi  (bağ: 08.6.3-conflict-a, 08.6.3-conflict-b)
  08.6.3-conflict-d [OPUS-XHIGH] Transfer/atama anında aktif yazıcı çakışmasının API tarafından uyarılması  (bağ: 08.6.3-conflict-a, 08.6.3-conflict-b)
  08.6.3-conflict-e [SONNET-XHIGH] Çakışma uyarısı istemci state'i + ConflictBanner bileşeni (salt görünüm)  (bağ: 08.6.3-conflict-a)
  08.6.3-conflict-f [SONNET-XHIGH] Realtime kablolama: agent_conflict_warning aboneliği + applyPush case'i + banner montajı  (bağ: 08.6.3-conflict-c, 08.6.3-conflict-e)
  08.6.3-conflict-g [OPUS-XHIGH] Uçtan uca doğrulama: iki-ajan çakışma senaryosu + cross-tenant/negatif süiti + kanıt  (bağ: 08.6.3-conflict-c, 08.6.3-conflict-d, 08.6.3-conflict-f)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): Tek bölünmez çekirdek `08.6.3-conflict-b` (ConflictDetectionService). Özelliğin kendisi bir yarış durumu tespitidir: iki ajanın aynı thread'de eşzamanlı yazması. Kayıt+okuma tek atomik Redis işleminde yapılmazsa (check-then-act) tespitin kendisi bir race condition içerir ve çakışma sessizce kaçırılır (false negative) — yani özellik "çalışıyor gibi görünüp" hiç uyarmaz. Aynı bağlamda üç şey birlikte akıl yürütülmek zorunda: (1) atomik komut seçimi ve pencere (TTL) genişliği, (2) tenant-scoped yetki kontrolü — kaydı yalnız chat'e erişimi olan ajan yapabilir, aksi halde "hangi ajan hangi chat'te" bilgisi sızar (NFR-S4), (3) düşen socket'in kalıcı çakışma bırakmaması (TTL lapse). Bunlar ayrı pencerelere bölünürse yarış penceresi yanlış kapatılır. Çekirdeğin ETRAFINDAKİ her şey ayrıldı: tip/anahtar sözleşmesi (-a, SONNET), dispatcher+yayın (-c, OPUS-XHIGH), API atama yüzeyi (-d, OPUS-XHIGH), salt-görünüm UI (-e, SONNET), kablolama (-f, SONNET), uçtan uca doğrulama (-g, OPUS-XHIGH). Böylece pahalı pencere 2 pencerelik tek bir çekirdeğe indirildi.

VARSAYIMLAR: §C — Çakışma UYARIDIR, ENGEL DEĞİLDİR. PRD 'çakışma uyarısı' diyor; ikinci ajanın yazması reddedilmez. Sonuç: yeni bir ApiError tipi (ve dolayısıyla errors.ts ×2 + scopes.test.ts sayacı + openapi enum + bundle regen dörtlüsü) GEREKMEZ. · §C — Kalıcı audit tablosu açılmaz. Çakışma anlık bir durumdur; Redis + TTL yeterli. Olgularda 'yok — migration gerek (eğer kalıcı audit isteniyorsa)' diye geçen `thread_conflict_warnings` seçeneği BİLİNÇLİ olarak seçilmedi → hiçbir alt-görevde migration yok. Kalıcı audit istenirse ayrı kalem açılır. · §C — Yeni bir RTM client action'ı EKLENMEZ; mevcut `send_typing_indicator` yeniden kullanılır. Gerekçe: ajan composer'ı bu action'ı zaten gönderiyor (apps/web useTypingStore.emit → client.sendTyping), TypingService'in `canType` tenant-scoped yetki kontrolü çakışma kaydının da ihtiyacı olan kontroldür, ve yeni action = yeni yetkisiz-erişim yüzeyi. Böylece web tarafında ek bir 'emit' işi doğmuyor. · §C — Çakışma iki ayrı yüzeyde tespit edilir: (1) RTM/typing yolu — eşzamanlı YAZAN iki ajan (-b/-c); (2) API/transfer yolu — devir sırasında hâlâ yazan ajan (-d). Orkestratörün 'eşzamanlı yazan/ATANAN iki ajan' ifadesi bu iki yüzeyi gerektiriyor. · §C — Uyarı `originConnectionId` SETLENMEDEN yayınlanır, çünkü fanout.ts origin socket'i eliyor; çakışan HER İKİ ajan da uyarıyı almalı. · §C — RTM gateway ilk kez envelope YAYINLAYAN taraf olur (bugüne kadar yalnız tüketiyordu). fanout.ts'in 'gateway yetki kararı vermez' kuralı korunuyor: audience envelope'a yazılıyor, gateway yine yalnız envelope'a bakıyor. Bu, farklı pod'daki ajana teslimi de garanti eder (v2-02 satır 330). · §C — `getChat` yanıtına `active_agent_ids` benzeri bir alan EKLENMEZ (olgulardaki 'olası ek' seçeneği). Özellik RTM-öncelikli; REST'e dokunulmadığı için contract-parity.test.ts hiçbir alt-görevde risk altında değil. · §C — Uyarı yalnız AJAN yüzeyidir; widget/müşteri tarafına hiçbir çakışma bilgisi gitmez.

AÇIK SORULAR (ürün kararı): Çakışma penceresi (AGENT_COMPOSING_TTL_SECONDS) kaç saniye olmalı? PRD hiçbir eşik vermiyor. Öneri: mevcut AGENT_TYPING_TTL_SECONDS=8 ile hizalı 8-10 sn. Onay gerekiyorsa -a'dan önce netleşmeli. · Uyarı ajan ADIYLA mı yoksa yalnız kimlikle mi gösterilsin? Ad göstermek ajan dizinine ek bir okuma (ve dolayısıyla ek bir yetki kararı) gerektirir; -e şu an payload'daki agent_id'ye dayanıyor. Ad isteniyorsa -c'nin payload'ına ad eklenmeli (audience'ın zaten gördüğü bilgi olduğu için sızıntı doğurmaz) ve -c bir miktar büyür. · 'Çakışma' tanımına ATAMA-ONLY durum girsin mi — yani iki ajan aynı chat'te ChatUser.present=true ama hiçbiri yazmıyorsa uyarı verilsin mi? Mevcut kırılım HAYIR diyor (yalnız aktif yazma + devir anı). Evet denirse presence tabanlı ayrı bir alt-görev (-h) gerekir ve v2-02 §330'daki presence:conn:* kayıt defteri kapsama girer. · FR-MOD-08.6.3'ün diğer yarısı (skills-based routing + supervisor takeover) ayrı bir kalem olarak mı planlanıyor? Bu kırılım yalnız 'çakışma uyarısı' payını kapsıyor; takeover UI'ı bu kalemin kapsamı dışında bırakıldı.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 91.1. 08.6.3-conflict-a [SONNET-XHIGH] Çakışma uyarısı RTM push action'ı + composer-registry anahtar/TTL tip sözleşmesi

**Status:** done  
**Dependencies:** None  

Kontrat-önce, mantık YOK. (1) packages/types/src/rtm.ts: RTM_PUSH_ACTIONS'a `agent_conflict_warning` eklenir + `AgentConflictWarningPush` payload arayüzü yazılır (chat_id, thread_id, agents: [{agent_id, since}], detected_at) — IncomingEventPush arayüz deseninde. (2) packages/types/src/realtime-bus.ts: `composerStateKey(licenseId, chatId)` + `AGENT_COMPOSING_TTL_SECONDS` eklenir; typingStateKey blo

**Details:**

08.6.3-conflict-a — Çakışma uyarısı RTM push action'ı + composer-registry anahtar/TTL tip sözleşmesi  [SONNET-XHIGH]

PRD: FR-MOD-08.6.3 (+ NFR-S4)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6'nın hepsi sağlandı. (1) 2 kaynak dosya + 1 test dosyası. (2) Güvenlik sınırı yok — anahtar, license_id'yi zaten gömen `typingStateKey` bloğunun birebir kopyası; yetki kararı verilmiyor. (3) Eşzamanlılık akıl yürütmesi yok — yalnız sabit + tip. (4) Kopyalanacak desen ismen verilebiliyor: realtime-bus.ts satır 22-35 ve rtm.ts RTM_PUSH_ACTIONS listesi. (5) Değişiklik katkısal (additive) ve mekanik. (6) Kabul kriteri mekanik: anahtar farklılığı + enum üyeliği.
NEDEN AÇIK: packages/types/src/rtm.ts satır ~117-141'deki RTM_PUSH_ACTIONS listesi çakışma uyarısı için bir push action TAŞIMIYOR (liste: incoming_typing_indicator, incoming_sneak_peek, routing_status_set, chat_transferred, user_added_to_chat …). apps/rtm/src'de 'conflict' grep'i 0 eşleşme veriyor. realtime-bus.ts'de yalnız `typingStateKey` (satır 30) + `AGENT_TYPING_TTL_SECONDS` (satır 35) var; 'kim yazıyor' kümesini tutan bir anahtar yok.
KAPSAM: Kontrat-önce, mantık YOK. (1) packages/types/src/rtm.ts: RTM_PUSH_ACTIONS'a `agent_conflict_warning` eklenir + `AgentConflictWarningPush` payload arayüzü yazılır (chat_id, thread_id, agents: [{agent_id, since}], detected_at) — IncomingEventPush arayüz deseninde. (2) packages/types/src/realtime-bus.ts: `composerStateKey(licenseId, chatId)` + `AGENT_COMPOSING_TTL_SECONDS` eklenir; typingStateKey bloğunun birebir deseni, licenseId anahtarın içine gömülü (tenant sınırı anahtar seviyesinde). (3) index.ts export'ları. (4) `pnpm --filter @siyahtus/types build` ile dist yenilenir (apps/rtm ve apps/web dist'ten tüketiyor).
DOSYALAR: packages/types/src/rtm.ts · packages/types/src/realtime-bus.ts · packages/types/src/realtime-bus.test.ts · packages/types/src/index.ts
REFERANS DESEN (kopyalanacak): packages/types/src/realtime-bus.ts (typingStateKey + AGENT_TYPING_TTL_SECONDS bloğu, satır 22-35 — yorum + license-scoped anahtar deseni) · packages/types/src/rtm.ts (RTM_PUSH_ACTIONS listesi satır 117-141 + IncomingEventPush payload arayüzü deseni) · packages/types/src/ids.test.ts (saf anahtar/tip birim testi deseni)
KK (birebir): "| Routing (gelişmiş) | Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı |" | "KK-türetilmiş: 'Çakışma uyarısı için ayrı bir RTM push action'ı ve license-scoped bir composer anahtarı tanımlıdır; aynı chat kimliği farklı lisanslarda aynı anahtara düşmez.' — Türetme gerekçesi: PRD §6 FR-MOD-08.6.3 KK'sı yalnız 'Uzmanlık/skill bazlı; supervisor takeover' diyor; 'çoklu-ajan çakışma uyarısı' ibaresi yalnız §5.3 (satır 408) ve §10 tablosunda (satır 1123/1133) geçiyor, hiçbirinde somut kriter/eşik yok (kk_yetersiz=true)."
KK DOĞRULAMA: packages/types/src/realtime-bus.test.ts: (i) `composerStateKey('1','ABC') !== composerStateKey('2','ABC')` — aynı chatId iki lisansta çakışmaz (KK-türetilmiş'in izolasyon maddesi); (ii) `RTM_PUSH_ACTIONS.includes('agent_conflict_warning')` — push action maddesi. `pnpm -w typecheck` + `pnpm --filter @siyahtus/types build` yeşil (apps/rtm/apps/api/apps/web derlenir).
KAPSAM DIŞI: Çakışma tespit mantığı (-b) · dispatcher bağlama ve push yayını (-c) · API/transfer yüzeyi (-d) · UI (-e/-f) · REST/OpenAPI değişikliği — bu kalem RTM-öncelikli, chats.yaml'a alan EKLENMEZ
SÖZLEŞME: OpenAPI'de değişiklik YOK (yeni REST route/alan eklenmiyor) → contract-parity.test.ts etkilenmez. Değişen sözleşme RTM tip sözleşmesidir: RTM_PUSH_ACTIONS + realtime-bus anahtar/TTL. Not: RTM tarafında parite testi yok (grep: RTM_PUSH_ACTIONS yalnız apps/rtm/src/dispatcher.ts:250'de tüketiliyor), ekleme katkısal; ancak @siyahtus/types build edilmeden apps/rtm ve apps/web eski dist'i görür.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 91.2. 08.6.3-conflict-b [OPUS-MAX] ConflictDetectionService — atomik eşzamanlı-yazıcı kaydı + çakışma kararı (güvenlik/algoritma çekirdeği)

**Status:** done  
**Dependencies:** 91.1  

apps/rtm/src/conflict.ts — yeni `ConflictDetectionService`: (1) typing.ts'teki `#scoped` + `canType` ile AYNI tenant-scoped RLS okumasıyla ajanın chat'e erişimi doğrulanır; erişim yoksa kayıt YAPILMAZ ve yanıt 'chat yok'tan ayırt edilemez olur. (2) Ajan TEK BİR ATOMİK Redis işlemiyle (Lua script veya tek MULTI/pipeline'da ZADD + ZREMRANGEBYSCORE(prune) + ZRANGE) `composerStateKey(licenseId, chatId

**Details:**

08.6.3-conflict-b — ConflictDetectionService — atomik eşzamanlı-yazıcı kaydı + çakışma kararı (güvenlik/algoritma çekirdeği)  [OPUS-MAX]

PRD: FR-MOD-08.6.3 (+ NFR-S3, NFR-S4, NFR-R2)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 VE koşul 3 ihlali. (a) Eşzamanlılık sınırı: iki ajanın aynı anda kayıt olması check-then-act ile yazılırsa her ikisi de karşısındakini göremez → çakışma sessizce kaçar; tespit mekanizmasının kendisi bir yarış durumu içerir. (b) Tenant izolasyonu + yetki: kayıt/okuma yalnız o chat'e erişimi olan ajan için yapılmalı, aksi halde 'hangi ajan hangi chat'te' bilgisi sızar (NFR-S4/S5 — typing.ts canType gerekçesiyle aynı). Atomik komut + TTL penceresi + yetki tek bağlamda akıl yürütülmek zorunda — çekirdek bölünmez.
NEDEN AÇIK: apps/rtm/src/typing.ts yalnız TEK bir bayrak tutuyor: `setAgentTyping` → `redis.set(typingStateKey(licenseId, chatId), '1', 'EX', TTL)` / `redis.del` — KİMİN yazdığını tutmuyor, dolayısıyla ikinci bir yazıcıyı ayırt edemez. apps/rtm/src'de 'conflict' grep 0. schema.prisma satır 440'ta ChatUser.present iki ajanın chat'te bulunabildiğini gösteriyor ama bunu 'ikisi de aktif yazıyor' sinyaline çeviren servis/sorgu yok. apps/api/src/services/routing/routing-service.ts eşzamanlılığı yalnız YENİ chat ataması için çözüyor (yorum: 'assignment happens inside the caller's transaction so the load count it reads cannot go stale'), mevcut thread üzerindeki iki ajanı kapsamıyor.
KAPSAM: apps/rtm/src/conflict.ts — yeni `ConflictDetectionService`: (1) typing.ts'teki `#scoped` + `canType` ile AYNI tenant-scoped RLS okumasıyla ajanın chat'e erişimi doğrulanır; erişim yoksa kayıt YAPILMAZ ve yanıt 'chat yok'tan ayırt edilemez olur. (2) Ajan TEK BİR ATOMİK Redis işlemiyle (Lua script veya tek MULTI/pipeline'da ZADD + ZREMRANGEBYSCORE(prune) + ZRANGE) `composerStateKey(licenseId, chatId)` altına yazılır ve AYNI işlemde pencerede bulunan tüm agent_id'ler geri okunur — check-then-act YOK. (3) Pencerede ≥2 farklı agent_id varsa çakışma kararı üretilir ve çakışan küme (agent_id + since) döner. (4) `AGENT_COMPOSING_TTL_SECONDS` ile kayıt kendiliğinden düşer (anahtarda PEXPIRE) — düşen socket kalıcı çakışma bırakmaz. (5) is_typing=false geldiğinde kayıt atomik silinir (ZREM). Servis PUSH GÖNDERMEZ, yalnız karar döner (-c yayınlar).
DOSYALAR: apps/rtm/src/conflict.ts · apps/rtm/src/conflict.test.ts
REFERANS DESEN (kopyalanacak): apps/rtm/src/typing.ts (canType tenant-scoped RLS okuması + #scoped transaction + TTL'li Redis yazımı — yetki deseni birebir kopyalanır) · apps/api/src/services/chat/chat-service.ts #appendEvent (satır ~1183-1200: `UPDATE … RETURNING` = artır ve oku tek işlemde; yorum: 'two concurrent sends cannot both observe the same value … which is what a read-then-write would allow') · apps/api/src/services/routing/routing-service.ts (karar+yazının aynı işlemde tutulması gerekçesi)
KK (birebir): "| Routing (gelişmiş) | Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı |" | "KK-türetilmiş: 'Aynı sohbette pencere içinde ikinci bir ajan yazmaya başladığında sistem çakışmayı tespit eder; tespit eşzamanlı iki kayıt altında da kaybolmaz; çakışma bilgisi yalnız o sohbete erişimi olan ajanlar için üretilir; yazıcı kaydı süre dolunca kendiliğinden düşer.' — Türetme gerekçesi: PRD §5.3 satır 408 yalnız ibareyi veriyor, §6 KK'sı ve §10 tablosu eşik/kriter tanımlamıyor (kk_yetersiz=true); orkestratörün bağlayıcı kararı 'RTM presence + event sırası; eşzamanlılık sınırı' bu türetmenin dayanağı."
KK DOĞRULAMA: apps/rtm/src/conflict.test.ts — NEGATİFLER ÖNCE: (i) erişimi olmayan ajan kayıt olamaz, boş küme döner (yetki maddesi); (ii) aynı chatId farklı licenseId altında birbirini GÖRMEZ (izolasyon maddesi); (iii) `Promise.all` ile iki eşzamanlı register → HER İKİSİ de 2 elemanlı küme görür ('tespit eşzamanlı iki kayıt altında kaybolmaz'); (iv) tek ajanın tekrarlı kaydı çakışma ÜRETMEZ; (v) TTL dolunca küme boşalır ('kendiliğinden düşer').
KAPSAM DIŞI: Dispatcher action bağlama ve envelope yayını (-c) · transfer/atama kaynaklı çakışma (-d) · UI (-e/-f) · kalıcı audit tablosu (thread_conflict_warnings) — açılmıyor, bkz. varsayımlar · v2-02 §330'daki `presence:conn:{orgId}:{accountId}` presence kayıt defteri (ayrı kalem)
SÖZLEŞME: yok (REST yok; RTM tip sözleşmesi -a'da eklendi).
MIGRATION: yok — çakışma anlık bir durumdur, Redis + TTL yeterli; `thread_conflict_warnings` benzeri tablo AÇILMAZ (varsayım §C). Kalıcı audit istenirse ayrı kalem olur.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 91.3. 08.6.3-conflict-c [OPUS-XHIGH] send_typing_indicator yolunda çakışma tespiti + uyarının bus envelope ile her iki ajana iletimi

**Status:** done  
**Dependencies:** 91.1, 91.2  

(1) apps/rtm/src/conflict-publisher.ts — RealtimePublisher'ın RTM tarafı eşi: `licenseChannel(licenseId)`'a `v:1` BusEnvelope yayınlar; action='agent_conflict_warning', audience={agentIds: çakışan ajanların hepsi}; boş audience yayınlanmaz. (2) dispatcher `#typing` case'i genişletilir: is_typing=true → ConflictDetectionService.register; dönen küme ≥2 ise envelope yayınlanır; is_typing=false → kayı

**Details:**

08.6.3-conflict-c — send_typing_indicator yolunda çakışma tespiti + uyarının bus envelope ile her iki ajana iletimi  [OPUS-XHIGH]

PRD: FR-MOD-08.6.3 (+ NFR-S4, NFR-P1, NFR-R2)
ETİKET GEREKÇESİ: OPUS-XHIGH: koşul 4 ve 5 ihlali + hafif güvenlik dokunuşu. RTM gateway bugüne kadar HİÇ envelope YAYINLAMIYOR (fanout.ts yalnız tüketiyor) — yayıncı yönün açılması çok dosyaya yayılan bir tasarım kararı ve depoda kopyalanacak RTM-tarafı örneği yok. Ayrıca uyarının kime gideceği (audience.agentIds) bir sızıntı yüzeyi: yanlış audience başka ajanın hangi chat'te olduğunu ifşa eder. Çekirdek yarış mantığı -b'de kapalı olduğu için MAX değil; 'güvenlik hassasiyeti olan iş asla SONNET'e verilmez' kuralı gereği SONNET olamaz.
NEDEN AÇIK: apps/rtm/src/dispatcher.ts `#typing` (satır 185-217) yalnız `typing.canType` + `typing.setAgentTyping` çağırıyor; ikinci bir ajanın aynı chat'te yazdığını tespit edip karşı tarafa push gönderen bir case/servis YOK (grep 'conflict'/'second'/'warning' → 0). apps/rtm/src/fanout.ts (satır 1-12) gateway'in 'hiçbir yetki kararı vermediğini, audience'a güvendiğini' söylüyor — dolayısıyla uyarı audience'ı ENVELOPE'A yazan bir yayın olarak akmalı ki farklı pod'daki ajana da ulaşsın (v2-02 satır 330: presence pod bazlı).
KAPSAM: (1) apps/rtm/src/conflict-publisher.ts — RealtimePublisher'ın RTM tarafı eşi: `licenseChannel(licenseId)`'a `v:1` BusEnvelope yayınlar; action='agent_conflict_warning', audience={agentIds: çakışan ajanların hepsi}; boş audience yayınlanmaz. (2) dispatcher `#typing` case'i genişletilir: is_typing=true → ConflictDetectionService.register; dönen küme ≥2 ise envelope yayınlanır; is_typing=false → kayıt silinir. `originConnectionId` SET EDİLMEZ — çakışan HER İKİ ajan da uyarıyı almalı (fanout.ts origin'i eler). (3) apps/rtm/src/server.ts DI: ayrı Redis publisher client + ConflictDetectionService. (4) Yayın best-effort: hata `send_typing_indicator` yanıtını BOZMAZ (publisher.ts'teki 'publishing never fails a request' kuralı birebir).
DOSYALAR: apps/rtm/src/dispatcher.ts · apps/rtm/src/server.ts · apps/rtm/src/conflict-publisher.ts · apps/rtm/src/conflict-publisher.test.ts · apps/rtm/test/integration/rtm.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/realtime/publisher.ts (BusEnvelope kurulumu + hasAudience boş-audience reddi + 'asla rethrow etme' kuralı) · apps/rtm/src/dispatcher.ts #typing (satır 185-217: yetki → yaz → yanıt akışı) · apps/rtm/src/fanout.ts #isAddressed (audience.agentIds yolunun nasıl okunduğu) · apps/rtm/test/helpers/rtm-harness.ts (gerçek socket üzerinden integration deseni)
KK (birebir): "| Routing (gelişmiş) | Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı |" | "KK-türetilmiş: 'İkinci ajan yazmaya başladığında uyarı çakışan ajanların HEPSİNE iletilir (yalnız sonradan gelene değil); tek ajan yazarken uyarı üretilmez; uyarı yalnız aynı lisansın ve o sohbete erişimi olan ajanlarına ulaşır.' — Türetme gerekçesi -b ile aynı (PRD KK'sı ibareyi somutlamıyor)."
KK DOĞRULAMA: apps/rtm/test/integration/rtm.test.ts — iki ajan socket'i aynı chat'te `send_typing_indicator` gönderir → HER İKİSİNE de `agent_conflict_warning` push'u düşer ('hepsine iletilir'); tek ajan yazarken push YOK ('tek ajan → uyarı yok'); erişimi olmayan chat'te yanıt `not_found` ve push YOK; başka lisansın socket'ine push GİTMEZ ('yalnız aynı lisans' — fanout licence eşleşmesi). Regresyon: typing.test.ts + rtm.test.ts yeşil kalır.
KAPSAM DIŞI: transfer/atama kaynaklı çakışma (-d) · UI (-e/-f) · yeni bir RTM client action'ı eklemek — mevcut `send_typing_indicator` yeniden kullanılır (bkz. varsayımlar) · v2-02 §330 presence:conn:* kayıt defteri · sert engelleme (ikinci ajanın yazmasının reddi) — uyarı, blok değil
SÖZLEŞME: yok — OpenAPI'ye dokunulmaz, yeni REST route eklenmez, contract-parity.test.ts etkilenmez. RTM push sözleşmesi -a'da eklendi.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 91.4. 08.6.3-conflict-d [OPUS-XHIGH] Transfer/atama anında aktif yazıcı çakışmasının API tarafından uyarılması

**Status:** done  
**Dependencies:** 91.1, 91.2  

chat-service `transfer` yolunda, transaction COMMIT sonrası (publisher.ts'in 'publishing happens after the transaction commits' kuralı): -a'daki `composerStateKey` ile o an chat'te yazan ajan kümesi SALT OKUNUR (-b'nin okuma yüzeyi yeniden kullanılır). Devir sonucu sorumlu ajan DEĞİŞTİYSE ve pencerede ≥1 başka ajan hâlâ yazıyorsa `agent_conflict_warning` yayınlanır; audience = yeni assignee + yaza

**Details:**

08.6.3-conflict-d — Transfer/atama anında aktif yazıcı çakışmasının API tarafından uyarılması  [OPUS-XHIGH]

PRD: FR-MOD-08.6.3 (+ NFR-S4, NFR-M4)
ETİKET GEREKÇESİ: OPUS-XHIGH: koşul 2'ye kısmi temas (tenant-scoped audience kararı + mevcut transfer akışına dokunuş; yanlış audience başka ajanın chat erişimini sızdırır) ve koşul 4 (kopyalanacak birebir desen yok; publishCustomerTyping benzer ama çakışma kümesini Redis'ten okuma yolu yeni). Yarış mantığı -b'de kapalı — burada yalnız hazır küme okunup audience'a çevriliyor — bu yüzden MAX değil; güvenlik hassasiyeti olduğu için SONNET olamaz.
NEDEN AÇIK: apps/api/src/routes/chats.ts transfer endpoint'i (satır ~282, operationId transferChat) devri yapıyor; schema.prisma satır 382'de `Thread.assigneeId` TEKİL bir alan (String?) — aynı anda yalnız bir sorumlu ajan modellenebiliyor ve iki ajanın eşzamanlı atanmasını/devrini uyaran veya bildiren bir kontrol yok. apps/api/src/services/chat/chat-service.ts `publishCustomerTyping` (satır ~499-551) audience hesabı + best-effort publish desenini taşıyor ama çakışma için kullanılmıyor.
KAPSAM: chat-service `transfer` yolunda, transaction COMMIT sonrası (publisher.ts'in 'publishing happens after the transaction commits' kuralı): -a'daki `composerStateKey` ile o an chat'te yazan ajan kümesi SALT OKUNUR (-b'nin okuma yüzeyi yeniden kullanılır). Devir sonucu sorumlu ajan DEĞİŞTİYSE ve pencerede ≥1 başka ajan hâlâ yazıyorsa `agent_conflict_warning` yayınlanır; audience = yeni assignee + yazan ajanlar, `#audienceFor(chat)` ile kesiştirilerek (chat'i görmeyen ajan audience'a giremez). Yayın best-effort, transfer'i BOZMAZ. Uyarı bilgilendirir; devir engellenmez.
DOSYALAR: apps/api/src/services/chat/chat-service.ts · apps/api/test/integration/agent-conflict.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/chat/chat-service.ts publishCustomerTyping (satır ~499-551: audience hesabı + boş audience'ta no-op + best-effort publish) · apps/api/src/services/realtime/publisher.ts (envelope + hasAudience reddi + asla rethrow etmeme) · apps/api/test/integration/chats.test.ts (transfer integration + cross-tenant iddia deseni)
KK (birebir): "| Routing (gelişmiş) | Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı |" | "KK-türetilmiş: 'Bir sohbet başka bir ajana devredilirken o sohbette hâlâ yazmakta olan ajan varsa, devralan ve yazan ajanlara çakışma uyarısı iletilir; kimse yazmıyorsa uyarı üretilmez; uyarı devri engellemez.' — Türetme gerekçesi: PRD §5.3 satır 408 çakışmayı yalnız isimlendiriyor, atama tarafı için kriter vermiyor; orkestratörün bağlayıcı kararı 'aynı thread'de eşzamanlı yazan/ATANAN iki ajan' bu ikinci yüzeyi kapsama alıyor."
KK DOĞRULAMA: apps/api/test/integration/agent-conflict.test.ts — (i) A ajanı yazarken chat B'ye devredilir → sahte publisher `agent_conflict_warning` envelope'unu yakalar, audience hem A hem B'yi içerir ('devralan ve yazan ajanlara iletilir'); (ii) kimse yazmıyorken devir → uyarı YOK ('kimse yazmıyorsa üretilmez'); (iii) publisher/Redis hata verdiğinde transfer yine başarılı yanıt döner ve thread devredilmiş olur ('uyarı devri engellemez'); (iv) başka lisansın ajanı audience'a GİRMEZ.
KAPSAM DIŞI: Sert engelleme / 409 + yeni ApiError tipi — YAPILMAZ. (Gerekseydi depo tuzağı: packages/types/src/errors.ts ×2 yer (ERROR_TYPES + ERROR_STATUS) + scopes.test.ts sayacı + openapi enum + bundle regen dörtlüsünün HEPSİ güncellenmeliydi.) · RTM typing yolundaki çakışma (-c) · ticket rules / otomatik atama (08.6.2) · supervision + takeover (FR-MOD-08.6.3'ün diğer yarısı — ayrı kalem) · UI (-e/-f)
SÖZLEŞME: yok — yeni REST route veya yanıt alanı eklenmiyor (getChat yanıtına `active_agent_ids` EKLENMEZ), contract-parity.test.ts etkilenmez. UYARI: ileride bir route/alan eklenirse packages/contract/openapi'ye eklenip re-bundle edilmezse contract-parity.test.ts KIRILIR.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 91.5. 08.6.3-conflict-e [SONNET-XHIGH] Çakışma uyarısı istemci state'i + ConflictBanner bileşeni (salt görünüm)

**Status:** done  
**Dependencies:** 91.1  

(1) apps/web/src/features/inbox/conflict.ts — typing.ts'in birebir deseninde zustand store: `byChat: Record<chatId, {agents: {agent_id, since}[], detectedAt}>`, `note(chatId, agents)`, `clear(chatId)` ve TYPING_IDLE_MS muadili bir idle temizleyici (karşı taraf yazmayı bırakınca uyarı kendiliğinden kaybolur). (2) ConflictBanner.tsx — TypingIndicator.tsx deseninde `role='status'` + `aria-live='polit

**Details:**

08.6.3-conflict-e — Çakışma uyarısı istemci state'i + ConflictBanner bileşeni (salt görünüm)  [SONNET-XHIGH]

PRD: FR-MOD-08.6.3 (+ NFR-A11Y)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 kaynak + 2 test dosyası. (2) Güvenlik sınırı yok — yetki sunucuda (-b/-c/-d) verildi; bu katman yalnız gelen payload'ı ekrana çevirir, ağ çağrısı yok. (3) Eşzamanlılık akıl yürütmesi yok — tek yönlü store yazımı. (4) Kopyalanacak desen ismen var: typing.ts (zustand + timer temizleme) ve TypingIndicator.tsx (role=status + null render). (5) Kontrat değişikliği yok. (6) Kabul kriteri mekanik: şerit görünür / null döner.
NEDEN AÇIK: apps/web/src/features/inbox dizin listesinde çakışma için hiçbir dosya yok (typing.ts / TypingIndicator.tsx / CopilotPanel.tsx / TicketGrid.tsx … var; conflict* YOK). Uyarıyı gösterecek bir yüzey bulunmuyor.
KAPSAM: (1) apps/web/src/features/inbox/conflict.ts — typing.ts'in birebir deseninde zustand store: `byChat: Record<chatId, {agents: {agent_id, since}[], detectedAt}>`, `note(chatId, agents)`, `clear(chatId)` ve TYPING_IDLE_MS muadili bir idle temizleyici (karşı taraf yazmayı bırakınca uyarı kendiliğinden kaybolur). (2) ConflictBanner.tsx — TypingIndicator.tsx deseninde `role='status'` + `aria-live='polite'` şerit: 'Bu sohbette N ajan aynı anda yazıyor' + ajan kimlikleri; çakışma yoksa `null` döner (layout zıplamaz). Hiçbir ağ çağrısı, hiçbir push aboneliği YOK (o -f'de).
DOSYALAR: apps/web/src/features/inbox/conflict.ts · apps/web/src/features/inbox/conflict.test.ts · apps/web/src/features/inbox/ConflictBanner.tsx · apps/web/src/features/inbox/ConflictBanner.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/inbox/typing.ts (zustand store + timers Map + TYPING_IDLE_MS ile kendiliğinden temizleme) · apps/web/src/features/inbox/TypingIndicator.tsx (role='status' + aria-live='polite' + çakışma yoksa null render + motion-safe animasyon) · apps/web/src/features/inbox/typing.test.ts · apps/web/src/features/inbox/TypingIndicator.test.tsx
KK (birebir): "| Routing (gelişmiş) | Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı |" | "KK-türetilmiş: 'Ajan, aynı sohbette başka bir ajanın da yazdığını ekranda görür; çakışma bitince uyarı kendiliğinden kaybolur; uyarı ekran okuyucuya nazikçe (polite) duyurulur.' — Türetme gerekçesi -b ile aynı; a11y payı depo deseninden (TypingIndicator aria-live='polite') alındı."
KK DOĞRULAMA: conflict.test.ts + ConflictBanner.test.tsx — (i) iki ajanlı payload → şerit görünür, her iki ajan görünür ('başka bir ajanın da yazdığını görür'); (ii) boş/tek ajan → `null` render; (iii) `clear` veya idle süresi sonrası kaybolur ('kendiliğinden kaybolur'); (iv) render edilen düğümde `role='status'` ve `aria-live='polite'` var (a11y maddesi).
KAPSAM DIŞI: push aboneliği / applyPush kablolaması / InboxPage montajı (-f) · uyarıyı kalıcı kapatma (dismiss) — v2 kapsamında değil · supervision/takeover UI · widget/müşteri tarafı görünürlüğü (uyarı yalnız ajan yüzeyi)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 91.6. 08.6.3-conflict-f [SONNET-XHIGH] Realtime kablolama: agent_conflict_warning aboneliği + applyPush case'i + banner montajı

**Status:** done  
**Dependencies:** 91.3, 91.5  

(1) useInbox.ts pushes listesine `agent_conflict_warning` eklenir. (2) applyPush'a case eklenir — `incoming_typing_indicator` case'inin birebir deseni: payload tip doğrulaması (chat_id string + agents dizisi) → conflict store `note()`. (3) `chat_deactivated` case'ine çakışma temizliği eklenir (kapanan sohbet 'çakışıyor' kalamaz — typing store'daki mevcut davranışın aynısı). (4) ConflictBanner Inbo

**Details:**

08.6.3-conflict-f — Realtime kablolama: agent_conflict_warning aboneliği + applyPush case'i + banner montajı  [SONNET-XHIGH]

PRD: FR-MOD-08.6.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 3 dosya düzenlemesi + e2e iddiası. (2) Güvenlik kararı yok — kimin uyarı alacağı sunucuda (-c/-d audience) belirlendi; istemci yalnız aboneliği açar. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: useInbox.ts pushes listesi (satır 166-173) + `case 'incoming_typing_indicator'`. (5) Kontrat değişikliği yok. (6) Kabul kriteri mekanik: push geldiğinde şerit görünür.
NEDEN AÇIK: apps/web/src/features/inbox/useInbox.ts'te RtmClient `pushes` listesi (satır ~166-173) yalnız 7 action'a abone: incoming_chat, incoming_event, chat_deactivated, chat_transferred, routing_status_set, incoming_typing_indicator, incoming_sneak_peek — çakışma action'ı yok. `applyPush` switch'inde (satır ~200 sonrası) çakışma case'i yok. InboxPage.tsx satır 527'de TypingIndicator monte ediliyor; yanında çakışma şeridi için yuva yok.
KAPSAM: (1) useInbox.ts pushes listesine `agent_conflict_warning` eklenir. (2) applyPush'a case eklenir — `incoming_typing_indicator` case'inin birebir deseni: payload tip doğrulaması (chat_id string + agents dizisi) → conflict store `note()`. (3) `chat_deactivated` case'ine çakışma temizliği eklenir (kapanan sohbet 'çakışıyor' kalamaz — typing store'daki mevcut davranışın aynısı). (4) ConflictBanner InboxPage.tsx'te TypingIndicator'ın yanına monte edilir (satır ~527). (5) apps/e2e/tests/inbox-panel.spec.ts'e görünürlük iddiası eklenir.
DOSYALAR: apps/web/src/features/inbox/useInbox.ts · apps/web/src/features/inbox/InboxPage.tsx · apps/e2e/tests/inbox-panel.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/inbox/useInbox.ts (pushes listesi satır 166-173 + `case 'incoming_typing_indicator'` payload doğrulama → store çağrısı + `case 'chat_deactivated'` temizlik deseni) · apps/web/src/features/inbox/InboxPage.tsx satır 527 (TypingIndicator montaj noktası ve prop geçişi) · apps/e2e/tests/inbox-panel.spec.ts (panel görünürlük iddiası deseni)
KK (birebir): "| Routing (gelişmiş) | Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı |" | "KK-türetilmiş: 'Sunucudan gelen çakışma uyarısı ajanın sohbet ekranında anında görünür; sohbet kapandığında uyarı temizlenir.' — Türetme gerekçesi -b ile aynı."
KK DOĞRULAMA: useInbox unit testi — sahte `agent_conflict_warning` push'u verildiğinde conflict store dolar ve ConflictBanner görünür ('anında görünür'); `chat_deactivated` push'u sonrası temizlenir ('kapandığında temizlenir'). E2E apps/e2e/tests/inbox-panel.spec.ts — şeridin `data-testid` ile görünürlüğü. Regresyon: mevcut inbox unit + e2e süitleri yeşil kalır.
KAPSAM DIŞI: Sunucu tarafı tespit/yayın (-b/-c/-d) · banner bileşeni ve store (-e) · widget tarafı · uyarıdan aksiyon alma (ör. 'devral' butonu) — supervision/takeover kalemi
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 91.7. 08.6.3-conflict-g [OPUS-XHIGH] Uçtan uca doğrulama: iki-ajan çakışma senaryosu + cross-tenant/negatif süiti + kanıt

**Status:** done  
**Dependencies:** 91.3, 91.4, 91.6  

(1) apps/rtm/test/integration/rtm.test.ts'e tam senaryo: iki ajan socket'i login → aynı chat'e subscribe → ikisi de send_typing_indicator → her ikisi de agent_conflict_warning alır → biri is_typing=false → uyarı düşer. (2) Cross-tenant süiti: ikinci lisansın socket'i aynı chatId ile aynı akışı koşar, HİÇBİR push almaz. (3) apps/api/test/integration/agent-conflict.test.ts'e devir senaryosunun uçtan

**Details:**

08.6.3-conflict-g — Uçtan uca doğrulama: iki-ajan çakışma senaryosu + cross-tenant/negatif süiti + kanıt  [OPUS-XHIGH]

PRD: FR-MOD-08.6.3 (+ NFR-S4, NFR-R2, NFR-M4)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama (RTM soketi + Redis + API transfer + web istemcisi) üzerinde davranışın BÜTÜN olarak kanıtlanması; alt-görevlerin hiçbiri tek başına yolun tamamını görmüyor ve bir yarış özelliğinin yanlış doğrulanması (yeşil ama gerçekte hiç uyarmayan test) bu planın pahalı hatası olur. Güvenlik iddiasının (cross-tenant sızıntı yok) uçtan uca kanıtlanması gerektiği için SONNET olamaz; çekirdek algoritma -b'de kapalı olduğu için MAX değil.
NEDEN AÇIK: apps/api/src/services/routing/ altında hiç test dosyası yok (dizinde yalnız routing-service.ts) — mevcut atama mantığı servis seviyesinde test edilmemiş; üstüne çakışma tespiti eklenince regresyon güvencesi ayrıca kurulmalı. Ayrıca -b/-c/-d'nin testleri kendi katmanlarına bakıyor; RTM'in yayınladığı payload ile web store'unun beklediği şeklin aynı olduğunu doğrulayan bir yer yok (apps/rtm/test/integration/rtm.test.ts tek RTM integration dosyası).
KAPSAM: (1) apps/rtm/test/integration/rtm.test.ts'e tam senaryo: iki ajan socket'i login → aynı chat'e subscribe → ikisi de send_typing_indicator → her ikisi de agent_conflict_warning alır → biri is_typing=false → uyarı düşer. (2) Cross-tenant süiti: ikinci lisansın socket'i aynı chatId ile aynı akışı koşar, HİÇBİR push almaz. (3) apps/api/test/integration/agent-conflict.test.ts'e devir senaryosunun uçtan uca hâli. (4) Payload şekil paritesi: RTM'in yayınladığı payload ile web applyPush'un okuduğu alanların aynı olduğunu doğrulayan tip/şekil iddiası. (5) CONVENTIONS.md DoD kapısının tam sürümü (typecheck+lint+unit+integration+build+e2e) koşulur, kanıt HANDOFF'a yazılır. YENİ DAVRANIŞ EKLENMEZ.
DOSYALAR: apps/rtm/test/integration/rtm.test.ts · apps/api/test/integration/agent-conflict.test.ts · apps/api/test/integration/tenant-isolation.test.ts · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/rtm/test/helpers/rtm-harness.ts (gerçek socket, RTM_PORT=0 ile paralel süit çakışmaz) · apps/api/test/integration/tenant-isolation.test.ts (cross-tenant iddia deseni) · apps/api/test/integration/webhooks.test.ts (güvenlik kalemi için negatif-önce süit deseni — 08.8.4 turu)
KK (birebir): "| Routing (gelişmiş) | Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı |" | "KK-türetilmiş: 'Aynı sohbette iki ajan eşzamanlı yazdığında her ikisi de uyarıyı alır; tek ajan yazarken kimse uyarı almaz; başka lisansın ajanı hiçbir koşulda uyarı almaz; uyarı yolu düşse bile mesaj gönderme ve devir işlemleri bozulmaz.' — Türetme gerekçesi -b ile aynı; bu alt-görev türetilmiş KK'nın TAMAMINI tek yerde kanıtlar."
KK DOĞRULAMA: Uçtan uca: (i) iki socket → iki push (madde 1); (ii) tek socket → 0 push (madde 2); (iii) ikinci lisans socket'i → 0 push (madde 3); (iv) Redis publish/register hatası enjekte edilir → send_typing_indicator ve transfer yine başarılı yanıt döner (madde 4). CONVENTIONS.md DoD kapısı tam sürüm yeşil; çıktı HANDOFF'a kanıt olarak yazılır.
KAPSAM DIŞI: Yeni davranış eklemek — bu alt-görev yalnız doğrular, özellik yüzeyini genişletmez · supervision + takeover · yük/perf ölçümü (NFR-P1 bütçesi ayrı kalem)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
