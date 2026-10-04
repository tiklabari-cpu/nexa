# Task ID: 65

**Title:** 08.5.7 — Instagram (DM, MOCK)  ·  dilim V2-9

**Status:** done

**Dependencies:** 35 ✓, 78 ✓

**Priority:** low

**Description:** FR-MOD-08.5.7 · Should (Ent./v2).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `08.5.7`.

8 atomik alt-görev · ~9 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x2 · SONNET-XHIGH x5

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  08.5.7-a [SONNET-XHIGH] Instagram kanal tipinin kontrata eklenmesi (ChannelType enum + connect/webhook gövde tanımı)  (bağ: yok)
  08.5.7-b [SONNET-XHIGH] InstagramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri  (bağ: 08.5.7-a)
  08.5.7-c [OPUS-XHIGH] instagram'ın adapter kanalı olarak devreye alınması (CHANNEL_TYPES + registry) + inbound→chat / outbound uçtan uca kanıtı  (bağ: 08.5.7-a, 08.5.7-b)
  08.5.7-d [OPUS-MAX] Kanal adresinin lisanslar arası tekilliği — çakışan adres bağlamanın reddi (bölünmez izolasyon çekirdeği)  (bağ: 08.5.7-c)
  08.5.7-e [SONNET-XHIGH] Settings → Channels: Instagram kartının statik 'Coming soon'dan canlı connect/disconnect kartına dönüşü  (bağ: 08.5.7-c)
  08.5.7-f [SONNET-XHIGH] 'Get notified' kaydının kalıcılaştırılması (kalan coming-soon kanalları)  (bağ: 08.5.7-e)
  08.5.7-g [SONNET-XHIGH] Inbox Views grubunda Instagram kanal görünümü  (bağ: 08.5.7-c)
  08.5.7-h [OPUS-XHIGH] Uçtan uca doğrulama: Instagram bağla → DM gelsin → inbox'ta chat (e2e)  (bağ: 08.5.7-e, 08.5.7-g)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): 08.5.7-d (kanal adresi sahiplenme çakışmasının reddi) bölünmez. Kısıt (DB unique index), yazma yolu (ChannelService.connect upsert + P2002 yarış dalı) ve okuma yolu (resolveLicense çoklu-satır reddi) tek bir izolasyon akıl yürütmesinin üç ucudur; ayrı pencerelere bölünürse "adres bir lisansa aittir" invaryantı yarım kalır ve arada geçen sürümde çapraz-tenant yanlış yönlendirme açık kalır. Migration'ı ayrı alt-göreve çıkarmak da güvenli değil: kısmi/fonksiyonel index'in tam şekli (status='connected' + address IS NOT NULL kısıtı, seed'in config={} website_widget satırı) servis kodundaki ret kararıyla birlikte tasarlanmalı. Çekirdeğin ETRAFINDAKİ her şey (kontrat satırı -a, saf adapter -b, UI -e/-f/-g, e2e -h) zaten ayrı ve daha ucuz etiketlere çıkarıldı; pahalı pencere yalnız bu çekirdekle sınırlı.

VARSAYIMLAR: Instagram mock connect alan seti Messenger'a paralel seçildi: `code` (mock OAuth kodu) + `ig_user_id` (kanal adresi) + opsiyonel `username`; gönderici kimliği IGSID. PRD ve rapor-1 bunu yazmıyor — 08.5.7 satırı davranışsal kriter taşımıyor. Gerekçe: Instagram DM aynı Meta Graph ailesinde ve depodaki en yakın desen messenger.ts. · Kanal adresi olarak `page_id` değil `ig_user_id` alan adı seçildi. Gerekçe: Messenger'ın adres uzayıyla isim düzeyinde karışmaması; gerçek çakışma riski 08.5.7-d'de DB kısıtıyla kapatılıyor. · Inbound gövde şekli depodaki düzleştirilmiş {recipient, sender, message} kalıbını izler; Meta'nın gerçek entry[].messaging[] sarmalayıcısı taklit edilmez (mevcut MessengerAdapter de etmiyor). · Mock outbound provider message id öneki `aigid.` (Messenger'ın `mid.`, WhatsApp'ın `wamid.`, Twilio'nun `SM` muadili). · 'Get notified' kaydı backend'e yazılmaz; localStorage'da kalıcılaştırılır (Banner'ın kalıcı dismiss deseni). Gerekçe: yeni tablo/route açmamak, PRD kaydın nereye yazılacağını söylemiyor. · Kanal adresi tekilliği yalnız `status='connected'` iken zorlanır; disconnect edilen bir kanalın adresi başka bir lisans tarafından bağlanabilir. Gerekçe: disconnect satırı silmiyor (geçmiş korunuyor), aksi halde adres kalıcı olarak kilitlenirdi. · Bu kalem yalnız Instagram kartını canlıya alır. messenger/twilio/whatsapp kartları — adaptörleri v1'de teslim olmasına rağmen — Settings → Channels'ta 'Coming soon' kalır; kardeş kartların canlıya alınması 08.5.4/.5/.6'nın UI payıdır, ayrı denetim kalemi. · Telegram bu kırılımın tamamen dışındadır (orkestratör kararı: Instagram = v2, Telegram = Enterprise); telegram kartı coming_soon kalır ve 08.5.7-f'in kalıcı 'Get notified' kaydının tek tüketicisi olur. · apps/api'deki adapter-scoped CHANNEL_TYPES (3→4 değer) ile packages/types/src/domain.ts'teki domain-scoped CHANNEL_TYPES (8 değer) AYRI listeler olarak kalır; birleştirilmez. Gerekçe: ikisi farklı kapsam (adaptörü olan kanallar vs. tüm kanal tipleri) ve birleşt

AÇIK SORULAR (ürün kararı): 08.5.7-d (kanal adresinin lisanslar arası tekilliği) 08.5.7 altında mı kalmalı, yoksa ayrı bir güvenlik tm görevi mi açılmalı? Bulgu Instagram'a özgü değil — mevcut messenger/twilio/whatsapp yolunu da kapsıyor (channel_resolve_license çoklu satır + rows[0]). Instagram bunu somutlaştırdığı için buraya yerleştirildi; orkestratör ayırmayı tercih ederse -c'nin bağımlısı olarak bağımsız bir görev olur. · Messenger/WhatsApp/SMS adaptörleri v1'de teslim (tm 35) olmasına rağmen Settings → Channels'ta hâlâ statik 'Coming soon' görünüyor (Channels.tsx:92-94). Bu bilinçli bir daraltma mı, yoksa 08.5.4/.5/.6'nın kapatılmamış UI payı mı? Instagram canlı karta geçince tutarsızlık kullanıcıya görünür hale gelir — ayrı bir denetim kalemi açılmalı mı? · 'Get notified' PRD'de "lansman bildirimi için kayıt" olarak geçiyor ama kaydın nereye yazılacağı yazmıyor. İstemci-tarafı kalıcılık (localStorage) yeterli sayılsın mı, yoksa v2'de gerçek bir kayıt (tablo + 13.8 e-posta bildirimi) mi beklenmeli? · Instagram inbound gövde şekli: depodaki düzleştirilmiş {recipient, sender, message} kalıbı mı korunsun, yoksa Meta'nın gerçek IG webhook sarmalayıcısı (entry[].messaging[]) mock'ta da taklit mi edilsin? İkincisi ileride gerçek entegrasyona geçişi kolaylaştırır ama mevcut üç adaptörün deseninden sapar.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 65.1. 08.5.7-a [SONNET-XHIGH] Instagram kanal tipinin kontrata eklenmesi (ChannelType enum + connect/webhook gövde tanımı)

**Status:** done  
**Dependencies:** None  

Contract-first ilk adım (ADR-05). (i) openapi.yaml components/schemas/ChannelType enum'ına 'instagram' eklenir ve açıklaması güncellenir. (ii) paths/channels.yaml channelConnect description'ına Instagram'ın mock connect alan seti yazılır (Messenger'a paralel: OAuth `code` + `ig_user_id`; adres = ig_user_id). (iii) channelWebhook description'ına IG inbound gövde şekli eklenir (recipient.id = ig_use

**Details:**

08.5.7-a — Instagram kanal tipinin kontrata eklenmesi (ChannelType enum + connect/webhook gövde tanımı)  [SONNET-XHIGH]

PRD: FR-MOD-08.5.7 (+ NFR-S3)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 kaynak dosya + 2 üretilmiş çıktı. (2) Güvenlik sınırı yok — enum yalnız dokümantasyon/tip; çalışma zamanı guard'ı apps/api'deki ayrı CHANNEL_TYPES listesi (bu alt-görevde dokunulmuyor). (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: aynı dosyanın 1361. satırındaki AppListItem.channel enum'ı 8 değerli listeyi zaten taşıyor. (5) Değişiklik katkısal (additive) ve mekanik — yeni path yok. (6) Doğrulama mekanik: bundle çıktısında enum + typecheck.
NEDEN AÇIK: packages/contract/openapi/openapi.yaml:745-751 ChannelType enum'ı = [messenger, twilio, whatsapp] — instagram YOK. Aynı dosyanın 1361. satırındaki AppListItem.channel enum'ı [website_widget, email, messenger, twilio, whatsapp, instagram, telegram, chat_page] — instagram VAR. Yani tek dosya içinde iki enum çelişiyor. packages/types/src/domain.ts:97-107 CHANNEL_TYPES da instagram'ı içeriyor. ConnectedChannel şeması (openapi.yaml:753-771) dar ChannelType'ı $ref ediyor, ChannelTypePath parametresi (openapi.yaml:2266-2271) da aynı şemayı kullanıyor → instagram kontrata girmeden hiçbir /channels/{type} çağrısı belgelenemez.
KAPSAM: Contract-first ilk adım (ADR-05). (i) openapi.yaml components/schemas/ChannelType enum'ına 'instagram' eklenir ve açıklaması güncellenir. (ii) paths/channels.yaml channelConnect description'ına Instagram'ın mock connect alan seti yazılır (Messenger'a paralel: OAuth `code` + `ig_user_id`; adres = ig_user_id). (iii) channelWebhook description'ına IG inbound gövde şekli eklenir (recipient.id = ig_user_id, sender.id = IGSID, message.text). (iv) Bundle yeniden üretilir (packages/contract/openapi.json) ve @siyahtus/types client'ı regen edilir. YENİ PATH EKLENMEZ — mevcut generic path'ler tasarım gereği type=instagram'ı kapsar.
DOSYALAR: packages/contract/openapi/openapi.yaml · packages/contract/openapi/paths/channels.yaml · packages/contract/openapi.json · packages/contract/src/generated/api.ts
REFERANS DESEN (kopyalanacak): packages/contract/openapi/openapi.yaml:1361 (AppListItem.channel — 8 değerli kanal enum'ı, birebir kopyalanacak değer listesi) · packages/contract/openapi/paths/channels.yaml channelConnect description (Messenger/Twilio/WhatsApp alan setlerinin anlatım deseni) · packages/types/src/domain.ts:97-107 (CHANNEL_TYPES domain listesi)
KK (birebir): ""Coming soon → Get notified → tam entegrasyon"" | "KK-türetilmiş: kontrat payı — PRD KK yalnız UI durum akışını tanımlıyor, kanal tipinin sözleşmede tanımlı olması gerektiğini söylemiyor. Türetme gerekçesi: ADR-05 contract-first (OpenAPI önce, sonra backend, sonra frontend); kanal tipi kontrata girmeden -b/-c yazılamaz."
KK DOĞRULAMA: `pnpm --filter @siyahtus/contract build` sonrası bundle'da ChannelType.enum içinde 'instagram' var (grep ile doğrulanır). apps/api/test/integration/contract-parity.test.ts yeşil kalır (path kümesi değişmediği için regresyon kanıtı). packages/contract/src/generated/api.ts'te ConnectedChannel.type union'ı 'instagram' içerir → apps/web + apps/api typecheck yeşil.
KAPSAM DIŞI: apps/api/src/services/channels/channel-adapter.ts'deki adapter-scoped CHANNEL_TYPES runtime guard'ı (08.5.7-c) · InstagramAdapter kodu (08.5.7-b) · UI (08.5.7-e/-f/-g) · packages/types/src/domain.ts (instagram zaten var, dokunulmaz)
SÖZLEŞME: openapi.yaml components/schemas/ChannelType enum += 'instagram'; paths/channels.yaml channelConnect + channelWebhook description güncellemesi. YENİ ROUTE YOK — bu yüzden contract-parity.test.ts bu değişiklikle kırılmaz. Buna rağmen bundle (openapi.json) yeniden üretilmez ve @siyahtus/types regen edilmezse generated client ile elle yazılan kod arasında drift oluşur; re-bundle + regen ZORUNLUDUR.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 65.2. 08.5.7-b [SONNET-XHIGH] InstagramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri

**Status:** done  
**Dependencies:** 65.1  

`export class InstagramAdapter implements ChannelAdapter` (type = 'instagram'). parseConnect: zod şeması { code (mock OAuth kodu), ig_user_id (kanal adresi), username? } → { address: ig_user_id, config: { ig_user_id, username?, ig_access_token: mock } }; `code` ASLA config'e yazılmaz (Twilio'nun auth_token'ı saklamama deseniyle aynı ilke). parseInbound: { recipient:{id}, sender:{id, username?}, me

**Details:**

08.5.7-b — InstagramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri  [SONNET-XHIGH]

PRD: FR-MOD-08.5.7 (+ NFR-S9 girdi doğrulama)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya (yeni instagram.ts + mevcut adapters.test.ts'e describe bloğu). (2) Güvenlik sınırı yok — dosya saf zod parse + mock id üretimi; tenant çözümü/RLS channel-service.ts'te, bu dosyada değil; adaptör hiçbir DB'ye ve principal'a dokunmuyor. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen verilebiliyor: messenger.ts (Instagram DM aynı Meta Graph ailesinde — OAuth code + hesap id + scoped sender id modeli birebir aynı). (5) Kontrat değişikliği -a'da yapıldı, burada yok. (6) KK mekanik: alan eşlemesi + 400 reddi.
NEDEN AÇIK: apps/api/src/services/channels/ dizin listesi: adapters.test.ts, channel-adapter.ts, channel-service.ts, email-inbound.ts, messenger.ts, registry.ts, twilio.ts, whatsapp.ts — instagram.ts YOK. Depo genelinde 'instagram' grep'i yalnız 5 yerde geçiyor (Channels.tsx:95 statik kart, migration.sql:826 CHECK listesi, domain.ts:104, openapi.yaml:1361, apps.ts:330-337 marketplace kartı) — hiçbiri adaptör değil. Yani InstagramAdapter grep 0.
KAPSAM: `export class InstagramAdapter implements ChannelAdapter` (type = 'instagram'). parseConnect: zod şeması { code (mock OAuth kodu), ig_user_id (kanal adresi), username? } → { address: ig_user_id, config: { ig_user_id, username?, ig_access_token: mock } }; `code` ASLA config'e yazılmaz (Twilio'nun auth_token'ı saklamama deseniyle aynı ilke). parseInbound: { recipient:{id}, sender:{id, username?}, message:{text} } → NormalizedInbound (address=recipient.id, externalId=sender.id (IGSID), senderName=username ?? null, text). send: mock providerMessageId `aigid.<token>`. Kayıt (registry/CHANNEL_TYPES) BU ALT-GÖREVDE YAPILMAZ.
DOSYALAR: apps/api/src/services/channels/instagram.ts · apps/api/src/services/channels/adapters.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/channels/messenger.ts (parseConnect/parseInbound/send iskeleti — birebir kopyalanacak ana örnek) · apps/api/src/services/channels/whatsapp.ts (ikinci örnek: profile_name → senderName eşlemesi) · apps/api/src/services/channels/channel-adapter.ts (parseWith + ChannelAdapter arayüzü + phoneNumber deseni) · apps/api/src/services/channels/adapters.test.ts 'Messenger adapter (08.5.4)' describe bloğu (test şekli birebir)
KK (birebir): ""Coming soon → Get notified → tam entegrasyon"" | "KK-türetilmiş: "tam entegrasyon" payının provider-özel yüzeyi. PRD 08.5.7 satırı davranışsal kriter taşımıyor (kardeş satırlar 08.5.4 'OAuth; mesaj → inbox chat', 08.5.6 'WhatsApp bağlama; mesaj → chat' taşırken). Türetme gerekçesi: mock adaptörün inbound/outbound sözleşmesi PRD'den çıkarılamıyor; en yakın kardeş 08.5.4 Messenger deseni (aynı Meta ailesi) esas alındı."
KK DOĞRULAMA: adapters.test.ts yeni 'Instagram adapter (08.5.7)' describe'ı: (i) connect → address === ig_user_id, config'te ig_user_id var, `code` YOK, token mock önekli; (ii) ig_user_id eksik connect → ApiError status 400; (iii) inbound normalize → {address, externalId=IGSID, senderName, text}; (iv) message.text yoksa throw; (v) send → providerMessageId `aigid.` öneki.
KAPSAM DIŞI: registry.ts / CHANNEL_TYPES kaydı ve route yüzeyinin açılması (08.5.7-c) · adres sahiplenme çakışması guard'ı (08.5.7-d) · gerçek Meta imza doğrulaması (NFR-S7 — MASTER-PROMPT §9 gereği kapsam dışı) · UI (08.5.7-e/-f/-g)
SÖZLEŞME: yok (08.5.7-a'da tamamlandı; bu alt-görev yeni path/şema eklemez)
MIGRATION: yok — channels_type_check CHECK constraint'i (apps/api/prisma/migrations/20260722154008_domain_model/migration.sql:822-826) 'instagram' değerini zaten kabul ediyor; channel_identities.channel_type ve channel_messages.channel_type serbest string
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 65.3. 08.5.7-c [OPUS-XHIGH] instagram'ın adapter kanalı olarak devreye alınması (CHANNEL_TYPES + registry) + inbound→chat / outbound uçtan uca kanıtı

**Status:** done  
**Dependencies:** 65.1, 65.2  

(i) channel-adapter.ts CHANNEL_TYPES'a 'instagram' eklenir ve yorum bloğu güncellenir (v1 adaptör kanalları + v2 Instagram). (ii) registry.ts ADAPTERS'a `instagram: new InstagramAdapter()`. (iii) adapters.test.ts'teki `toEqual([...])` sabiti ve isChannelType negatif vakaları güncellenir. (iv) channels-adapters.test.ts CASES dizisine instagram case'i eklenir (connect/inbound gövde üreticileriyle) —

**Details:**

08.5.7-c — instagram'ın adapter kanalı olarak devreye alınması (CHANNEL_TYPES + registry) + inbound→chat / outbound uçtan uca kanıtı  [OPUS-XHIGH]

PRD: FR-MOD-08.5.7 (+ NFR-S3, NFR-S4, NFR-S5)
ETİKET GEREKÇESİ: OPUS-XHIGH: CHANNEL_TYPES guard'ını genişletmek routes/channels.ts'te DÖRT endpoint'i instagram'a açar — /connect, /disconnect, /messages (channels--all:rw scope'lu) ve /webhook (config:{public:true}, imzasız). Kullanıcı kuralı: 'güvenlik hassasiyeti olan ama çekirdek güvenlik sınırı OLMAYAN işler (ör. yeni bir yetkili endpoint eklemek, mevcut scope'u genişletmek) EN AZ OPUS-XHIGH olur; güvenlik işi asla sonnet'e verilmez.' Çekirdek izolasyon kararı -d'de olduğu için MAX değil; ama public webhook yüzeyinin genişlemesi + iki mevcut testin (adapters.test.ts sabit eşitliği, channels-adapters.test.ts '404s an unknown channel type') geçerliliğinin birlikte değerlendirilmesi yorum gerektiriyor.
NEDEN AÇIK: apps/api/src/services/channels/channel-adapter.ts:29 `CHANNEL_TYPES = ['messenger','twilio','whatsapp'] as const` — instagram yok; registry.ts ADAPTERS Record'unda instagram anahtarı yok (Record<ChannelType, ChannelAdapter> olduğu için tip eklenince derleme hatası verir, sessiz 500 değil). routes/channels.ts:44-48 channelTypeParam() yalnız isChannelType() ile 404 filtreliyor → liste genişleyince route kodunda değişiklik GEREKMEZ. Kanıt bloğu tarafında: apps/api/test/integration/channels-adapters.test.ts CASES dizisi 3 elemanlı (messenger/twilio/whatsapp), instagram case'i yok. Ayrıca adapters.test.ts satır ~21 `expect(CHANNEL_TYPES).toEqual(['messenger','twilio','whatsapp'])` — bu sabit güncellenmezse süit kırılır (bilinen regresyon).
KAPSAM: (i) channel-adapter.ts CHANNEL_TYPES'a 'instagram' eklenir ve yorum bloğu güncellenir (v1 adaptör kanalları + v2 Instagram). (ii) registry.ts ADAPTERS'a `instagram: new InstagramAdapter()`. (iii) adapters.test.ts'teki `toEqual([...])` sabiti ve isChannelType negatif vakaları güncellenir. (iv) channels-adapters.test.ts CASES dizisine instagram case'i eklenir (connect/inbound gövde üreticileriyle) — describe.each ile mevcut altı senaryo (inbound→routed chat, dönen gönderici tek müşteri+tek chat, bilinmeyen adres 404, disconnect sonrası 404, outbound chat_id/external_id, scope+adresleme reddi) instagram için de koşar. (v) cross-tenant describe'ına instagram özelinde bir vaka eklenir. Route/servis katmanında kod değişikliği beklenmiyor — beklenirse bu bir bulgu olarak HANDOFF'a yazılır.
DOSYALAR: apps/api/src/services/channels/channel-adapter.ts · apps/api/src/services/channels/registry.ts · apps/api/src/services/channels/adapters.test.ts · apps/api/test/integration/channels-adapters.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/channels/registry.ts (Record<ChannelType, ChannelAdapter> genişletme — tek satırlık mekanik desen) · apps/api/test/integration/channels-adapters.test.ts CASES dizisi + describe.each($type adapter) bloğu (instagram case'i aynı şekilde eklenir) · apps/api/test/integration/channels-adapters.test.ts 'cross-tenant isolation' describe'ı (NFR-S5 kanıt deseni)
KK (birebir): ""Coming soon → Get notified → tam entegrasyon"" | "KK-türetilmiş: "tam entegrasyon"ın backend payı = kardeş kalemlerin birebir KK'sı olan "mesaj → chat" (PRD 08.5.6) davranışının Instagram için de sağlanması. Türetme gerekçesi: PRD 08.5.7 satırında davranışsal kriter yok; en yakın kardeş satırın KK'sı taşındı."
KK DOĞRULAMA: channels-adapters.test.ts (integration, gerçek Postgres+Redis+Fastify): instagram webhook'u → status 'accepted', chats tablosunda 1 routed chat, event.authorType='customer', channel_identities'te (license, 'instagram', IGSID) satırı, channel_messages'te direction='inbound' log; outbound chat_id ve external_id ile iki kayıt. Negatif: bilinmeyen adres → 404 ve chat oluşmaz; disconnect sonrası inbound → 404; channels--all:ro ile connect/messages → 403. Cross-tenant: B lisansı A'nın instagram chat'ine yanıt yazamaz (404) ve GET /channels'ta A'nın kanalını görmez.
KAPSAM DIŞI: kanal adresinin lisanslar arası tekilliği (08.5.7-d — bu alt-görevde adresler test içinde bilinçli ayrık tutulur) · UI (08.5.7-e/-f/-g) · e2e (08.5.7-h) · gerçek Meta webhook imzası / entry[].messaging[] sarmalayıcısı (§9 mock sınırı)
SÖZLEŞME: yok (08.5.7-a'da). Yeni path eklenmediği için contract-parity.test.ts etkilenmez; yine de DoD kapısında integration süiti tam koşulur.
MIGRATION: yok — channels_type_check zaten instagram'ı kabul ediyor (migration.sql:822-826), channel_identities/channel_messages channel_type kolonlarında kısıt yok
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 65.4. 08.5.7-d [OPUS-MAX] Kanal adresinin lisanslar arası tekilliği — çakışan adres bağlamanın reddi (bölünmez izolasyon çekirdeği)

**Status:** done  
**Dependencies:** 65.3  

Contract-first sırayla: (i) [migration] channels tablosuna kısmi fonksiyonel benzersiz index — (type, (config->>'address')) WHERE status='connected' AND config->>'address' IS NOT NULL. Kısmi olması şart: seed.ts:221 website_widget satırı config={} ile açılıyor (address NULL) ve disconnect satırı silmeden status='off' yapıyor, ikisi de index dışında kalmalı. (ii) [servis] ChannelService.connect: up

**Details:**

08.5.7-d — Kanal adresinin lisanslar arası tekilliği — çakışan adres bağlamanın reddi (bölünmez izolasyon çekirdeği)  [OPUS-MAX]

PRD: FR-MOD-08.5.7 (+ NFR-S4, NFR-S5)
ETİKET GEREKÇESİ: OPUS-MAX: tenant izolasyon sınırı — koşul 2 ihlali, çekirdek bölünmez. Kanal adresi → license_id eşlemesi tek tenant garantisi olmadan çalışıyor: `channel_resolve_license` çoklu satır dönebiliyor ve servis `rows[0]`'ı alıyor, yani iki lisans aynı adresi bağlarsa gelen mesaj tanımsız sırayla YANLIŞ tenant'a düşebilir (NFR-S4/S5). Instagram bu riski somutlaştırıyor: IG business hesabı Meta'da bir FB Page ile eşlenir, ig_user_id/page_id herkese açık ve tahmin edilebilir. Düzeltme DB kısıtı + yazma yolu + okuma yolu + yarış dalını tek akıl yürütmede tutmayı gerektiriyor; parçalanırsa invaryant yarım kalır.
NEDEN AÇIK: apps/api/prisma/migrations/20260722154008_domain_model/migration.sql:523 — channels üzerindeki TEK benzersizlik `channels_license_id_type_key (license_id, type)`; adres üzerinde hiçbir benzersizlik YOK. apps/api/prisma/migrations/20260726120000_omnichannel_adapters/migration.sql:92-103 channel_resolve_license, `WHERE ch.type=p_type AND ch.status='connected' AND ch.config->>'address'=p_address` ile RETURNS TABLE döndürüyor — tekil satır garantisi yok. apps/api/src/services/channels/channel-service.ts resolveLicense: `const match = rows[0]` — çoklu eşleşmede sıralama tanımsız, sessizce ilkini seçiyor. channel-adapter.ts:41-45 yorumu 'so it is unique per channel type across the platform' diyor ama bu YALNIZ YORUM. channels-adapters.test.ts cross-tenant testi de 'Distinct addresses (a page/number belongs to one workspace)' yorumuyla adresleri bilinçli ayrık tutuyor → adres tekilliğini iddia eden test grep 0.
KAPSAM: Contract-first sırayla: (i) [migration] channels tablosuna kısmi fonksiyonel benzersiz index — (type, (config->>'address')) WHERE status='connected' AND config->>'address' IS NOT NULL. Kısmi olması şart: seed.ts:221 website_widget satırı config={} ile açılıyor (address NULL) ve disconnect satırı silmeden status='off' yapıyor, ikisi de index dışında kalmalı. (ii) [servis] ChannelService.connect: upsert öncesi başka lisansın aynı (type, address) ile bağlı olup olmadığı SECURITY DEFINER yolla kontrol edilir; varsa net bir 4xx (mesajda hedef lisans sızdırılmaz — NFR-S5 numaralandırma karşıtı). (iii) [yarış] eşzamanlı iki connect'te Prisma P2002 unique-violation yakalanıp aynı 4xx'e çevrilir (kontrol-sonra-yaz yarışı kapanır). (iv) [okuma] resolveLicense: rows.length > 1 ise tarihsel veri anomalisi olarak REDDEDİLİR ve loglanır — sessizce rows[0] alınmaz.
DOSYALAR: apps/api/prisma/migrations/<yeni_timestamp>_channel_address_uniqueness/migration.sql · apps/api/prisma/schema.prisma · apps/api/src/services/channels/channel-service.ts · apps/api/test/integration/channels-adapters.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260726120000_omnichannel_adapters/migration.sql (SECURITY DEFINER fonksiyon + REVOKE/GRANT deseni — yeni yardımcı gerekirse aynı kalıp) · apps/api/src/services/channels/channel-service.ts connect() / resolveLicense() (dokunulacak iki yol) · apps/api/test/integration/channels-adapters.test.ts 'cross-tenant isolation' describe'ı (negatif-önce kanıt deseni) · apps/api/test/integration/tenant-isolation.test.ts (çapraz-tenant iddia deseni)
KK (birebir): "KK-türetilmiş: PRD FR-MOD-08.5.7 KK'sı ("Coming soon → Get notified → tam entegrasyon") bu sınırı hiç yazmıyor. Türetme gerekçesi: NFR-S4/S5 (tenant izolasyonu, IDOR) + rapor-2 §5.3 kanal modeli; "tam entegrasyon" bir kanalın adresinin tek bir çalışma alanına ait olmasını gerektirir, aksi halde inbound mesaj yanlış tenant'a düşer."
KK DOĞRULAMA: channels-adapters.test.ts'e eklenen 'channel address ownership' describe'ı: NEGATİF ÖNCE — (n1) A instagram'ı addressA ile bağlar; B aynı addressA'yı bağlamaya çalışır → 4xx, B'nin channels satırı connected olmaz; (n2) çakışma sonrası addressA'ya gelen inbound HÂLÂ A'nın chat'ini açar (yanlış yönlendirme yok); (n3) hata gövdesi A'nın kimliğini/lisansını sızdırmaz. POZİTİF — (p1) A disconnect eder → B aynı adresi bağlayabilir ve inbound artık B'ye düşer; (p2) aynı lisansın kendi kanalını yeniden bağlaması (upsert) hâlâ çalışır. YARIŞ — (r1) unique-violation dalı doğrudan tetiklenip 4xx'e döndüğü doğrulanır. REGRESYON — mevcut messenger/twilio/whatsapp senaryolarının tamamı yeşil.
KAPSAM DIŞI: adres sahipliğinin sağlayıcı tarafında (Meta) doğrulanması — MOCK, kapsam dışı (§9) · webhook imza doğrulaması (NFR-S7, §9) · channel_identities / channel_messages şema değişikliği (gerekmiyor) · UI'da çakışma hatasının özel gösterimi (08.5.7-e'de jenerik hata gösterimi yeterli)
SÖZLEŞME: Yeni path YOK. connectChannel yanıt kodlarına 409 eklenirse packages/contract/openapi/paths/channels.yaml güncellenip re-bundle + @siyahtus/types regen ZORUNLU (aksi halde contract drift). Mevcut 400 ile yetinilirse sözleşme değişikliği gerekmez — tercih edilen yol budur. UYARI: yeni bir ApiError tipi eklenirse bu depodaki bilinen tuzak: errors.ts (2 ayrı yer) + scopes.test.ts sayacı + openapi error type enum + regen.
MIGRATION: EVET — channels tablosunda yeni kısmi fonksiyonel benzersiz index: UNIQUE (type, (config->>'address')) WHERE status='connected' AND config->>'address' IS NOT NULL. Yeni tablo/kolon YOK. Prisma expression index'i doğrudan modelleyemediği için migration.sql elle yazılır ve schema.prisma'ya yorum/@@index notu düşülür; `prisma migrate diff` ile drift kontrolü yapılır.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 65.5. 08.5.7-e [SONNET-XHIGH] Settings → Channels: Instagram kartının statik 'Coming soon'dan canlı connect/disconnect kartına dönüşü

**Status:** done  
**Dependencies:** 65.3  

(i) ChannelsGrid, /websites'ın yanında GET /channels verisini de okur (owner/admin scope'u yoksa istek atılmaz — views.ts canReadChannels deseni). (ii) channelsFor imzası bağlı kanal listesini de alır; instagram kartı comingSoon()'dan çıkarılıp durum türetir: bağlı → 'connected' + adres gösterimi + Disconnect; bağlı değil → 'not_connected' + Connect. (iii) Connect → Modal içinde lib/form.tsx useFo

**Details:**

08.5.7-e — Settings → Channels: Instagram kartının statik 'Coming soon'dan canlı connect/disconnect kartına dönüşü  [SONNET-XHIGH]

PRD: FR-MOD-08.5.7 (+ FR-MOD-08.5.1, FR-EK-A.1 form primitifi)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya (Channels.tsx + channels.test.ts). (2) Güvenlik sınırı yok — mevcut channels--all:rw scope'lu endpoint'ler çağrılır, yeni yetki/scope tanımlanmaz, izolasyon kararı sunucuda (-c/-d). (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: Website kartının veri-güdümlü status türetimi (channelsFor), useConnectedChannels hook'u ve lib/form.tsx useForm primitifi. (5) Kontrat değişikliği yok. (6) KK mekanik: kart durumu = /channels verisi, testle doğrudan kanıtlanır.
NEDEN AÇIK: apps/web/src/features/settings/Channels.tsx:95 `comingSoon('instagram', 'Instagram', '📷', 'Answer Instagram direct messages.')` — sabit statik kart; connect/manage akışı yok. Channels.tsx GET /channels'ı HİÇ çağırmıyor (yalnız useQuery ile '/websites'); apps/web genelinde '/channels' çağrısı yalnız useInbox.ts:329'da. channels.test.ts'teki 'shows every unbuilt channel as Coming soon with Get notified' testi built = {website, chat-page, email} kümesi dışındaki HER kartın coming_soon olmasını iddia ediyor → instagram canlıya alınınca bu test güncellenmezse kırılır (bilinen regresyon).
KAPSAM: (i) ChannelsGrid, /websites'ın yanında GET /channels verisini de okur (owner/admin scope'u yoksa istek atılmaz — views.ts canReadChannels deseni). (ii) channelsFor imzası bağlı kanal listesini de alır; instagram kartı comingSoon()'dan çıkarılıp durum türetir: bağlı → 'connected' + adres gösterimi + Disconnect; bağlı değil → 'not_connected' + Connect. (iii) Connect → Modal içinde lib/form.tsx useForm ile mock connect formu (code + ig_user_id; alan-altı hata + geçersizken submit pasif) → POST /channels/instagram/connect; başarıda query invalidate. (iv) Disconnect → POST /channels/instagram/disconnect + onay (dirty-guard/Modal deseni). (v) Loading/Error/Empty durumları mevcut Card/StatusDot/ErrorNotice ile. (vi) channels.test.ts'te built kümesine 'instagram' eklenir ve instagram için üç durum testi yazılır.
DOSYALAR: apps/web/src/features/settings/Channels.tsx · apps/web/src/features/settings/channels.test.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/Channels.tsx channelsFor() (Website kartının veri-güdümlü status/cta türetimi — birebir taklit edilecek desen) · apps/web/src/features/inbox/useInbox.ts:325-330 useConnectedChannels (GET /channels okuma deseni) · apps/web/src/features/inbox/views.ts canReadChannels() (scope kapısı — ajan /channels çağırmaz) · apps/web/src/lib/form.tsx useForm/required (alan-altı hata + submit-disabled primitifi, T4-a) · apps/web/src/components/ui/Modal.tsx (form modalı deseni) · apps/web/src/features/team/InviteTeammates.tsx (useForm + Modal + mutation birleşimi örneği)
KK (birebir): ""Coming soon → Get notified → tam entegrasyon"" | "rapor-1-fonksiyonel.md:1534-1541 — "[MOD-08.5.7] Instagram (SOON) ... Mevcut Durumlar: Coming soon. Tetiklenen Eylem ve Sayfa Mantığı: [Get notified] lansman bildirimi için kayıt."" | "KK-türetilmiş: bu alt-görev KK'nın ÜÇÜNCÜ aşamasını ("tam entegrasyon") UI'da karşılar; 'Get notified' aşaması 08.5.7-f'te."
KK DOĞRULAMA: channels.test.ts: (i) bağlı kanal listesi boşken instagram kartı status='not_connected', cta='Connect'; (ii) /channels'ta connected instagram varken status='connected', cta='Manage'/'Disconnect' ve adres görünür; (iii) 'shows every unbuilt channel as Coming soon' testi instagram'ı built kabul eder ve telegram için hâlâ geçer; (iv) render testi: geçersiz/eksik ig_user_id → alan-altı hata + submit pasif.
KAPSAM DIŞI: 'Get notified' kalıcılığı (08.5.7-f) · messenger/whatsapp/sms kartlarının canlıya alınması — adaptörleri v1'de teslim olmasına rağmen bu kalem 08.5.7'dir; kardeş kartlar ayrı denetim kalemi · Inbox Views entegrasyonu (08.5.7-g) · e2e (08.5.7-h) · Apps Marketplace instagram kartı (packages/types/src/apps.ts:330-337 — zaten var, requireConnectableApp kapısı bilinçli 400 döndürüyor, DOKUNULMAZ)
SÖZLEŞME: yok — yalnız mevcut /channels, /channels/instagram/connect, /channels/instagram/disconnect uçları tüketilir
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 65.6. 08.5.7-f [SONNET-XHIGH] 'Get notified' kaydının kalıcılaştırılması (kalan coming-soon kanalları)

**Status:** done  
**Dependencies:** 65.5  

'Get notified' tıklaması kanal başına kalıcı kaydedilir (localStorage, Banner'ın kalıcı dismiss deseniyle aynı anahtar şeması: `siyahtus.channels.notified.<channelId>`); yeniden mount/reload sonrası kart 'We'll let you know.' göstermeye devam eder. Backend kaydı YOK — yeni route/tablo açılmaz (MASTER-PROMPT sınırları; gerçek bildirim gönderimi kapsam dışı). Bu alt-görev 08.5.7-e sonrası kalan coming-s

**Details:**

08.5.7-f — 'Get notified' kaydının kalıcılaştırılması (kalan coming-soon kanalları)  [SONNET-XHIGH]

PRD: FR-MOD-08.5.7 (+ FR-MOD-08.5.1)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 1-2 dosya. (2) Güvenlik sınırı yok — istemci tarafı tercih kaydı, PII yok, yetki kararı yok. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: components/ui/Banner.tsx'in localStorage ile kalıcı dismiss'i (bannerDismissKey + getItem/setItem, satır 73-90) ve views.ts useSavedViews. (5) Kontrat değişikliği yok. (6) KK mekanik: tıkla → yeniden mount'ta durum korunur.
NEDEN AÇIK: apps/web/src/features/settings/Channels.tsx ChannelCardView içinde `const [notified, setNotified] = useState(false)` — yalnız bileşen state'i. Channels.tsx'te localStorage grep 0, herhangi bir notify API çağrısı grep 0 → sayfa yenilenince 'We'll let you know.' kayboluyor ve PRD'nin ikinci aşaması ("[Get notified] lansman bildirimi için kayıt") gerçek bir kayıt DEĞİL. e2e settings.spec.ts:121-123 yalnız aynı oturum içindeki görünürlüğü iddia ediyor, kalıcılığı değil.
KAPSAM: 'Get notified' tıklaması kanal başına kalıcı kaydedilir (localStorage, Banner'ın kalıcı dismiss deseniyle aynı anahtar şeması: `siyahtus.channels.notified.<channelId>`); yeniden mount/reload sonrası kart 'We'll let you know.' göstermeye devam eder. Backend kaydı YOK — yeni route/tablo açılmaz (MASTER-PROMPT sınırları; gerçek bildirim gönderimi kapsam dışı). Bu alt-görev 08.5.7-e sonrası kalan coming-soon kartlarını (telegram) ve genel deseni kapsar.
DOSYALAR: apps/web/src/features/settings/Channels.tsx · apps/web/src/features/settings/channels.test.ts
REFERANS DESEN (kopyalanacak): apps/web/src/components/ui/Banner.tsx:73-90 (bannerDismissKey + localStorage kalıcı dismiss — birebir taklit edilecek desen) · apps/web/src/features/inbox/views.ts useSavedViews (localStorage destekli hook deseni, STORAGE_KEY sabiti) · apps/web/src/components/ui/Banner.test.tsx (kalıcılık testi şekli)
KK (birebir): ""Coming soon → Get notified → tam entegrasyon"" | "rapor-1-fonksiyonel.md:1467 — "Instagram — Coming soon — [Get notified]."" | "rapor-1-fonksiyonel.md:1534-1541 — "[Get notified] lansman bildirimi için kayıt. Validasyon ve Hata Senaryoları: Yok.""
KK DOĞRULAMA: channels.test.ts / yeni render testi: (i) 'Get notified' tıklanır → 'We'll let you know.' görünür; (ii) bileşen yeniden mount edilir (yeni render) → hâlâ 'We'll let you know.' (kalıcı kayıt kanıtı); (iii) farklı kanal kartı etkilenmez (anahtar kanal başına); (iv) localStorage erişilemezse (SSR/erişim hatası) bileşen patlamaz, eski davranışa düşer.
KAPSAM DIŞI: backend 'notify' kaydı / tablo / route (bilinçli olarak yapılmaz) · gerçek lansman e-postası gönderimi (13.8 bildirim kanalı işi) · instagram kartı — 08.5.7-e'den sonra artık coming_soon değildir
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 65.7. 08.5.7-g [SONNET-XHIGH] Inbox Views grubunda Instagram kanal görünümü

**Status:** done  
**Dependencies:** 65.3  

ChannelViewType birleşimine 'instagram' eklenir; CHANNEL_VIEW_META'ya { label: 'Instagram', icon: '📷' } girdisi Settings → Channels kartıyla aynı etiket/ikonla eklenir; isChannelViewType() güncellenir; sabit rail sırası (Messenger → WhatsApp → SMS → Instagram) korunacak şekilde anahtar sırası belirlenir. views.test.ts'e: bağlı instagram → satır görünür; yalnız instagram bağlıyken promo GÖSTERİLMEZ

**Details:**

08.5.7-g — Inbox Views grubunda Instagram kanal görünümü  [SONNET-XHIGH]

PRD: FR-MOD-08.5.7 (+ FR-MOD-02.1.4)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya (views.ts + views.test.ts), saf fonksiyon katmanı. (2) Güvenlik sınırı yok — scope kapısı canReadChannels zaten var ve değişmiyor. (3) Eşzamanlılık yok. (4) Kopyalanacak desen aynı dosyada: CHANNEL_VIEW_META'nın üç mevcut girdisi. (5) Kontrat değişikliği yok. (6) KK mekanik: bağlı kanal → görünen satır.
NEDEN AÇIK: apps/web/src/features/inbox/views.ts:31 `export type ChannelViewType = 'messenger' | 'twilio' | 'whatsapp'`; isChannelViewType() (satır ~58) üç değeri sabit karşılaştırıyor; CHANNEL_VIEW_META (satır ~46-50) üç girdili. connectedChannelViews() bilinmeyen tipi sessizce eliyor → instagram bağlansa bile Inbox Views'da HİÇ görünmez ve tek kanal instagram ise showChannelPromo() yanlışlıkla true döner (kanal bağlıyken promo gösterilir).
KAPSAM: ChannelViewType birleşimine 'instagram' eklenir; CHANNEL_VIEW_META'ya { label: 'Instagram', icon: '📷' } girdisi Settings → Channels kartıyla aynı etiket/ikonla eklenir; isChannelViewType() güncellenir; sabit rail sırası (Messenger → WhatsApp → SMS → Instagram) korunacak şekilde anahtar sırası belirlenir. views.test.ts'e: bağlı instagram → satır görünür; yalnız instagram bağlıyken promo GÖSTERİLMEZ; bağlı değilken satır yok.
DOSYALAR: apps/web/src/features/inbox/views.ts · apps/web/src/features/inbox/views.test.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/inbox/views.ts CHANNEL_VIEW_META + isChannelViewType + connectedChannelViews (aynı dosyadaki üç mevcut kanal girdisi) · apps/web/src/features/inbox/views.test.ts mevcut kanal görünümü vakaları (19 test) · apps/web/src/features/settings/Channels.tsx (etiket/ikon eşleşmesi için tek doğruluk referansı: '📷' Instagram)
KK (birebir): ""Coming soon → Get notified → tam entegrasyon"" | "KK-türetilmiş: "tam entegrasyon"ın inbox payı. Destek KK (PRD 02.1.4, birebir): "Kanal bağlı değilse channel-promo; custom saved views eklenebilir" — bağlı kanalın görünmesi bu kriterin karşıtı-doğrusu; instagram eklenmezse bağlı kanal varken promo gösterilir (kriter ihlali)."
KK DOĞRULAMA: views.test.ts: (i) connectedChannelViews([{type:'instagram',connected:true}]) → tek satır, label 'Instagram'; (ii) showChannelPromo(aynı girdi) === false (bağlı kanal varken promo yok — 02.1.4 KK'sının doğrudan ihlali önlenir); (iii) connected:false instagram → satır yok; (iv) sıra sabit: messenger, whatsapp, twilio, instagram.
KAPSAM DIŞI: telegram kanal görünümü (Enterprise, kapsam dışı) · yeni saved-view davranışı · kanal bazlı sohbet filtreleme sorgusunun backend tarafı (mevcut davranış korunur)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 65.8. 08.5.7-h [OPUS-XHIGH] Uçtan uca doğrulama: Instagram bağla → DM gelsin → inbox'ta chat (e2e)

**Status:** done  
**Dependencies:** 65.5, 65.7  

Yeni e2e spec: (i) Settings → Channels'ta Instagram kartı Connect → mock form (code + ig_user_id) → kart 'Connected' ve adres görünür; (ii) mock provider webhook'u POST edilir (test içinden API'ye doğrudan istek — public uç) → (iii) Inbox'ta yeni chat görünür ve mesaj metni okunur; (iv) Inbox Views'da 'Instagram' satırı görünür (promo değil); (v) Disconnect → kart 'Not connected'. Kanıt ekran görü

**Details:**

08.5.7-h — Uçtan uca doğrulama: Instagram bağla → DM gelsin → inbox'ta chat (e2e)  [OPUS-XHIGH]

PRD: FR-MOD-08.5.7 (+ FR-MOD-08.5.1, FR-MOD-02.1.4)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama — kontrat + API (public webhook) + web Settings + Inbox Views + e2e altyapısı tek senaryoda buluşuyor; senaryonun hangi fixture/seed ile deterministik kurulacağı (webhook'un test içinden nasıl POST edileceği, hangi adresin kullanılacağı, ekran kanıtı) KK'da yazmıyor → yorum gerektiren belirsizlik. Güvenlik ÇEKİRDEĞİ yok (izolasyon -d'de kanıtlandı), o yüzden MAX değil. SONNET olamaz: e2e altyapısında kopyalanacak birebir 'kanal bağlama' deseni yok (mevcut spec'ler yalnız coming-soon kartını doğruluyor).
NEDEN AÇIK: apps/e2e/tests dizini: ai-agent, billing, campaigns, command-palette, copilot, customers, demo-flow, fixtures, global-setup, inbox-panel, inbox-tabs, notifications, onboarding, playbook, reports, settings, team, tickets, traffic, widget — Instagram'a özel senaryo YOK (grep 0). settings.spec.ts:91-124 'channels' describe'ı yalnız 'channel-whatsapp' üzerinden coming-soon + Get notified iddiası yapıyor; hiçbir e2e bir kanalı bağlayıp inbound mesajı inbox'ta görmüyor.
KAPSAM: Yeni e2e spec: (i) Settings → Channels'ta Instagram kartı Connect → mock form (code + ig_user_id) → kart 'Connected' ve adres görünür; (ii) mock provider webhook'u POST edilir (test içinden API'ye doğrudan istek — public uç) → (iii) Inbox'ta yeni chat görünür ve mesaj metni okunur; (iv) Inbox Views'da 'Instagram' satırı görünür (promo değil); (v) Disconnect → kart 'Not connected'. Kanıt ekran görüntüsü kanit/ dizinine (mevcut desen). Gerekirse fixtures.ts'e webhook POST yardımcısı eklenir. Mevcut settings.spec.ts 'channels' testi coming-soon iddiasını telegram/whatsapp üzerinden sürdürecek şekilde gözden geçirilir.
DOSYALAR: apps/e2e/tests/instagram.spec.ts · apps/e2e/tests/fixtures.ts · apps/e2e/tests/settings.spec.ts
REFERANS DESEN (kopyalanacak): apps/e2e/tests/settings.spec.ts 'channels' describe'ı (region/getByTestId + kanit/ ekran görüntüsü deseni) · apps/e2e/tests/demo-flow.spec.ts (uçtan uca akış + inbox doğrulaması deseni) · apps/e2e/tests/widget.spec.ts (dışarıdan gelen mesajın inbox'ta görünmesi deseni) · apps/e2e/tests/fixtures.ts (agentPage fixture'ı ve API çağrısı yardımcıları)
KK (birebir): ""Coming soon → Get notified → tam entegrasyon"" | "KK-türetilmiş: bu alt-görev KK'nın üç aşamasının UI'da gerçekten tamamlandığını kanıtlar. Türetme gerekçesi: PRD 08.5.7 davranışsal kriter taşımadığı için kanıt kriteri kardeş 08.5.6'nın birebir KK'sından ("mesaj → chat") alındı."
KK DOĞRULAMA: apps/e2e/tests/instagram.spec.ts: bağla → kart Connected (locator 'channel-instagram' içinde 'Connected'); webhook POST → Inbox listesinde yeni chat ve gönderilen metin görünür; sol railde 'Instagram' view satırı görünür ve channel-promo görünmez; disconnect → kart 'Not connected'. Ekran görüntüsü kanit/ altına yazılır.
KAPSAM DIŞI: performans/yük testi · gerçek Meta sağlayıcısına bağlanma (§9) · telegram senaryosu · 08.5.7-d'nin çakışma senaryosunun e2e'de tekrarlanması (integration'da kanıtlanıyor)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
