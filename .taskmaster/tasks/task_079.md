# Task ID: 79

**Title:** 08.5.8 — Telegram kanalı (MOCK adaptör, uçtan uca) · dilim V3-4

**Status:** done

**Dependencies:** 35 ✓, 82 ✓

**Priority:** medium

**Description:** FR-MOD-08.5.8 · Should (Ent.). Adres sahiplenme çekirdeği ZATEN GENEL (tm 65 08.5.7-d) — Telegram için OPUS-MAX gerekmez.

**Details:**

Faz 3 (Enterprise) · PLAN §6.1 · kalem `08.5.8` · dilim V3-4

6 atomik alt-görev · ~7 pencere · etiket dağılımı: SONNET-XHIGH x4 · OPUS-XHIGH x2

KK: "Get notified → tam entegrasyon (TR pazarında öncelik)" — FR-MOD-08.5.8 birebir.

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  08.5.8-a [SONNET-XHIGH] Telegram connect/webhook kontratı + generated tip yenilemesi  (bağ: —)
  08.5.8-b [SONNET-XHIGH] TelegramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri  (bağ: 08.5.8-a)
  08.5.8-c [OPUS-XHIGH] Telegram'ın adapter kanalı olarak devreye alınması — CHANNEL_TYPES + registry + pinlenmiş test  (bağ: 08.5.8-a, 08.5.8-b)
  08.5.8-d [SONNET-XHIGH] Settings → Channels: Telegram kartı "Coming soon"dan canlı connect/disconnect'e  (bağ: 08.5.8-c)
  08.5.8-e [SONNET-XHIGH] Inbox Views grubunda Telegram kanal görünümü  (bağ: 08.5.8-c)
  08.5.8-f [OPUS-XHIGH] Uçtan uca doğrulama — bağla→mesaj→inbox→yanıt + cross-tenant + adres sahiplenme regresyonu  (bağ: 08.5.8-d, 08.5.8-e)

BAĞLAM KURULUMU (bu görev KOD YAZMAZ — alt-görevleri koşulur):
- PLAN §6.1.1 kalem kırılımı + bölünmeyen çekirdek gerekçeleri + varsayımlar + açık sorular
- PLAN §6.2 dilim sırası ve sıralamanın gerekçesi · PLAN §G Faz-3 düz tablosu
- CONVENTIONS DoD kapısı · TASK-RUNNER-PROMPT pencere protokolü
- Tam alan detayı her alt-görevin kendi `details` alanındadır (Faz-3'ün companion dosyası YOK — PLAN §D98)

SINIRLAR (CLAUDE.md): dış servisler MOCK · production deploy/DNS/TLS/gerçek secret/ödeme YOK ·
force-push/DB drop/history rewrite YOK · başka repoya dokunma YOK.

**Test Strategy:**

Her alt-görev KENDİ tam DoD kapısından geçer (CONVENTIONS §1): pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && ilgili test:integration/test:e2e — hepsi exit 0. Kalem ancak son doğrulama alt-görevi (08.5.8-f) yeşil olduğunda ✅ sayılır. Her alt-görevin kendi testStrategy alanı o pencerenin kapı komutlarını verir.

## Subtasks

### 79.1. 08.5.8-a [SONNET-XHIGH] Telegram connect/webhook kontratı + generated tip yenilemesi

**Status:** done  
**Dependencies:** None  

Telegram connect/webhook kontratı + generated tip yenilemesi

**Details:**

08.5.8-a — Telegram connect/webhook kontratı + generated tip yenilemesi  [SONNET-XHIGH]

PRD: 08.5.8 (PLAN §6.1 · dilim V3-4 · tm 79)
TAHMİN: ~1 pencere

NEDEN AÇIK: `telegram` domain kanal listesinde VAR (`packages/types/src/domain.ts:98-106`) ama ADAPTER listesinde YOK (`apps/api/src/services/channels/channel-adapter.ts:40` → `['messenger','twilio','whatsapp','instagram']`). Settings'te statik "Coming soon" kartı duruyor (`apps/web/src/features/settings/Channels.tsx:133`).

KAPSAM: `packages/contract/openapi/paths/channels.yaml` — telegram connect gövdesi (`bot_token` mock + `bot_username` = kanal adresi) ve webhook gövdesi. Sonra `pnpm contract:generate`.

KRİTİK: bu adımda `channel-adapter.ts`'deki `CHANNEL_TYPES` DEĞİŞMEZ. Sözleşme önce, devreye alma `08.5.8-c`'de. Aksi hâlde adaptörü olmayan bir tip route yüzeyine girer ve aradaki sürümde 500 üretir.

DOSYALAR: `packages/contract/openapi/paths/channels.yaml` · `packages/contract/src/generated/api.ts` (üretilir, commit'lenir)

REFERANS DESEN (birebir): tm 65 `08.5.7-a` (Instagram kontratı) — aynı dosya, aynı kalıp.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**`bot_token` `config`'e YAZILMAZ (denetim bulgusu — PLAN §6.1.1'in açık sorusu BU KARARLA KAPANDI):** `apps/api/src/services/channels/channel-adapter.ts` `ConnectResult.config` dokümanı birebir _"Never contains a raw secret"_ diyor. Instagram emsali (`ig_access_token`) sunucunun kendi bastığı bir mock değerdir; Telegram'da `bot_token` İSTEMCİDEN gelir, yani emsali körü körüne kopyalamak bu invaryantı kullanıcı-sağlamalı bir sırla ihlal eder. `parseConnect` yalnız `{address: bot_username, config: {address, bot_username}}` döner. Token gerekiyorsa mock bir türev saklanır. Ayrıca `bot_token` pino redaction listesine ve `sanitizeAuditMetadata`'ya eklenir. (Hafifletici: `channel-service.ts` `serialise()` zaten yalnız `address` döner, yani `config` `GET /channels` yanıtına girmiyor — ama DB'de düz metin ve loglar açık yüzey kalırdı.)

### 79.2. 08.5.8-b [SONNET-XHIGH] TelegramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri

**Status:** done  
**Dependencies:** 79.1  

TelegramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri

**Details:**

08.5.8-b — TelegramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri  [SONNET-XHIGH]

PRD: 08.5.8 (PLAN §6.1 · dilim V3-4 · tm 79)
TAHMİN: ~1 pencere

KAPSAM: `apps/api/src/services/channels/telegram.ts` — `ChannelAdapter` arayüzünü uygular: `parseConnect` (bot_token + bot_username → {address, config}), `parseInbound` (düzleştirilmiş {recipient, sender, message}), `send` (mock outbound, provider message id öneki `tg.`).

DOSYALAR: `apps/api/src/services/channels/telegram.ts` (yeni) · `apps/api/src/services/channels/adapters.test.ts`

REFERANS DESEN (birebir): `apps/api/src/services/channels/instagram.ts` (80 satır) — yapı, isimlendirme, hata davranışı bire bir kopyalanır.

VARSAYIM: Telegram'ın gerçek `update` sarmalayıcısı TAKLİT EDİLMEZ; depodaki düzleştirilmiş gövde kalıbı korunur (mevcut dört adaptörle tutarlılık).

KAPSAM DIŞI: registry kaydı ve CHANNEL_TYPES (08.5.8-c).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**`bot_token` `config`'e YAZILMAZ (denetim bulgusu — PLAN §6.1.1'in açık sorusu BU KARARLA KAPANDI):** `apps/api/src/services/channels/channel-adapter.ts` `ConnectResult.config` dokümanı birebir _"Never contains a raw secret"_ diyor. Instagram emsali (`ig_access_token`) sunucunun kendi bastığı bir mock değerdir; Telegram'da `bot_token` İSTEMCİDEN gelir, yani emsali körü körüne kopyalamak bu invaryantı kullanıcı-sağlamalı bir sırla ihlal eder. `parseConnect` yalnız `{address: bot_username, config: {address, bot_username}}` döner. Token gerekiyorsa mock bir türev saklanır. Ayrıca `bot_token` pino redaction listesine ve `sanitizeAuditMetadata`'ya eklenir. (Hafifletici: `channel-service.ts` `serialise()` zaten yalnız `address` döner, yani `config` `GET /channels` yanıtına girmiyor — ama DB'de düz metin ve loglar açık yüzey kalırdı.)

### 79.3. 08.5.8-c [OPUS-XHIGH] Telegram'ın adapter kanalı olarak devreye alınması — CHANNEL_TYPES + registry + pinlenmiş test

**Status:** done  
**Dependencies:** 79.1, 79.2  

Telegram'ın adapter kanalı olarak devreye alınması — CHANNEL_TYPES + registry + pinlenmiş test

**Details:**

08.5.8-c — Telegram'ın adapter kanalı olarak devreye alınması — CHANNEL_TYPES + registry + pinlenmiş test  [OPUS-XHIGH]

PRD: 08.5.8 (PLAN §6.1 · dilim V3-4 · tm 79)
TAHMİN: ~1 pencere

KAPSAM: `channel-adapter.ts:40` `CHANNEL_TYPES`'a `'telegram'` + `registry.ts` `ADAPTERS` kaydı. `registry.ts` `Record<ChannelType, ChannelAdapter>` olduğu için tip eklemek kaydı zorunlu kılar (derleme hatası — dosya yorumunun kendi ifadesiyle "adding a channel type without an adapter here is a compile error, not a 500 at runtime").

DİKKAT — PİNLENMİŞ TEST GÜNCELLENECEK: `apps/api/src/services/channels/adapters.test.ts:24-32` listeyi BİLEREK pinliyor ve `:31`'de `expect(isChannelType('telegram')).toBe(false)` diyor ("Telegram is Enterprise, out of scope"). Bu satır bu turda değişir; testin başındaki yorum da güncellenir — pin bir hata değil, route yüzeyi kararının bilinçli kaydıdır.

Ayrıca: inbound→chat ve outbound uçtan uca kanıtı (adapter kanalı olarak ilk gerçek akış).

DOSYALAR: `apps/api/src/services/channels/channel-adapter.ts:40` · `apps/api/src/services/channels/registry.ts` · `apps/api/src/services/channels/adapters.test.ts:24-32`

REFERANS DESEN (birebir): tm 65 `08.5.7-c`.

KAPSAM DIŞI: UI (08.5.8-d/-e), e2e (08.5.8-f).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**MIGRATION GEREKMEZ (denetim doğrulaması):** `channels_type_check CHECK (type IN (… 'telegram', 'chat_page'))` kısıtı `20260722154008_domain_model/migration.sql:824-826`'da telegram'ı ZATEN kabul ediyor. Bu kalemin hiçbir alt-görevinde migration olmaması doğrudur.

### 79.4. 08.5.8-d [SONNET-XHIGH] Settings → Channels: Telegram kartı "Coming soon"dan canlı connect/disconnect'e

**Status:** done  
**Dependencies:** 79.3  

Settings → Channels: Telegram kartı "Coming soon"dan canlı connect/disconnect'e

**Details:**

08.5.8-d — Settings → Channels: Telegram kartı "Coming soon"dan canlı connect/disconnect'e  [SONNET-XHIGH]

PRD: 08.5.8 (PLAN §6.1 · dilim V3-4 · tm 79)
TAHMİN: ~1 pencere

KAPSAM: `Channels.tsx:133` → `comingSoon('telegram', 'Telegram', '✈️', ...)` satırı canlı karta çevrilir; durum bağlı kanallardan türetilir.

DOSYALAR: `apps/web/src/features/settings/Channels.tsx:129-160` · `apps/web/src/features/settings/Channels.test.tsx` · `apps/web/src/features/settings/channels.test.ts`

REFERANS DESEN (BİREBİR, aynı dosyada): `instagramChannel(connectedChannels)` (`Channels.tsx:147-160`) — durum türetme, adres gösterimi, yükleme durumu (`:308-314`). Telegram için aynı fonksiyon kalıbı yazılır.

**'GET NOTIFIED' PAYININ AKIBETİ BU ALT-GÖREVE AİTTİR (denetim bulgusu K1-11):** KK "Get notified → tam entegrasyon" iki adımlıdır. Instagram turunda (tm 65 · `08.5.7-f`) 'Get notified' kaydı localStorage'a yazılmıştı. Telegram kartı canlıya geçince o kayıt **sessizce düşer** (kart artık connect/disconnect gösterdiği için 'Get notified' CTA'sı yoktur) ve localStorage anahtarı bir sonraki okumada temizlenir. Bu karar burada verilmiştir; açık soru olarak BIRAKILMAZ.

KAPSAM DIŞI: Views (08.5.8-e), e2e (08.5.8-f).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 79.5. 08.5.8-e [SONNET-XHIGH] Inbox Views grubunda Telegram kanal görünümü

**Status:** done  
**Dependencies:** 79.3  

Inbox Views grubunda Telegram kanal görünümü

**Details:**

08.5.8-e — Inbox Views grubunda Telegram kanal görünümü  [SONNET-XHIGH]

PRD: 08.5.8 (PLAN §6.1.1 · dilim V3-4 · tm 79)
TAHMİN: ~1 pencere

NEDEN AÇIK: Inbox sol kolonundaki "Views" grubu kanal bazlı görünümler taşır. Instagram v2 turunda (tm 65 `08.5.7-g`) kendi görünümünü aldı; Telegram adapter kanalı olduğu anda (`08.5.8-c`) aynı grupta yerini almalı, yoksa bağlanmış bir kanalın sohbetleri filtrelenemez ve kanal ajan için görünmez kalır.

KAPSAM (denetim sonrası GERÇEK YÜZEYE İNDİRİLDİ — ilk hâli var olmayan bir filtre/sayaç kalıbı tarif ediyordu): `apps/web/src/features/inbox/views.ts` üç noktada genişler —
- `:33` `ChannelViewType` birliği (`'messenger'|'twilio'|'whatsapp'|'instagram'`) → `'telegram'` eklenir
- `:46` `CHANNEL_VIEW_META` kaydı (yalnız `label` + `icon` — başka alan YOK)
- `:59` `isChannelViewType` tip guard'ı otomatik olarak genişler (birlikten türüyor)
Modülün yüzeyi bundan ibarettir: `connectedChannelViews()` (`:71`) bağlı kanallardan görünüm listesi üretir, `showChannelPromo()` (`:85`) liste boşsa `true` döner. **Filtre parametresi, sayaç/badge kaynağı ve "boş durum metni" bu modülde YOKTUR** — ilk kırılım bunları "kopyalanacak desen" diye saymıştı, denetimde çürütüldü.

**DİKKAT — PİNLENMİŞ TEST GÜNCELLENECEK (denetim bulgusu — ilk hâli "kırma" diyordu, bu İMKÂNSIZ bir kısıttı):** `apps/web/src/features/inbox/views.test.ts:68-72` `it('ignores an unknown channel type')` testi telegram'ı **bilinmeyen tipin temsilcisi** olarak kullanıyor (`connectedChannelViews([{type:'telegram',connected:true}])` → `[]` ve `showChannelPromo` → `true`). Bu alt-görevin işi tam olarak o davranışı değiştirmektir. Test **bilinmeyen bir başka tiple** (`'chat_page'` veya `'email'`) yeniden yazılır; Telegram için yeni beklenti eklenir: bağlıyken görünüm üretilir ve `showChannelPromo` `false` döner. `08.5.8-c`'nin `adapters.test.ts` pini için yazdığı gerekçe burada da geçerlidir — pin bir hata değil, bilinçli bir kararın kaydıdır; kararı değiştirirken pini de güncellersin.

DOSYALAR: `apps/web/src/features/inbox/views.ts:33,46,59` · `apps/web/src/features/inbox/views.test.ts:68-72`

REFERANS DESEN (BİREBİR, aynı dosyada): Instagram görünümü (tm 65 `08.5.7-g`) — birliğe eklenen değer + `CHANNEL_VIEW_META` girdisi.

KAPSAM DIŞI: kanal kartı (`08.5.8-d`), e2e (`08.5.8-f`).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir; HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 79.6. 08.5.8-f [OPUS-XHIGH] Uçtan uca doğrulama — bağla→mesaj→inbox→yanıt + cross-tenant + adres sahiplenme regresyonu

**Status:** done  
**Dependencies:** 79.4, 79.5  

Uçtan uca doğrulama — bağla→mesaj→inbox→yanıt + cross-tenant + adres sahiplenme regresyonu

**Details:**

08.5.8-f — Uçtan uca doğrulama — bağla→mesaj→inbox→yanıt + cross-tenant + adres sahiplenme regresyonu  [OPUS-XHIGH]

PRD: 08.5.8 (PLAN §6.1 · dilim V3-4 · tm 79)
TAHMİN: ~2 pencere

KAPSAM: (1) e2e: Telegram bağla → mock inbound mesaj → inbox'ta chat → yanıt (kanıt PNG `apps/e2e/kanit/08.5.8-telegram.png`). (2) cross-tenant negatifi. (3) ADRES SAHİPLENME REGRESYONU — bu kalemin en önemli testi: iki lisans AYNI Telegram adresini bağlamayı denediğinde İKİNCİSİ REDDEDİLİR.

NEDEN (3) kritik: bu kırılım Instagram'ın `08.5.7-d` OPUS-MAX çekirdeğini Telegram için TEKRARLAMADI, çünkü koruma kanal-agnostik: `20260809090000_channel_address_uniqueness` migration'ı `channel_address_owner(p_type, p_address)` SECURITY DEFINER fonksiyonunu tip PARAMETRESİYLE kurar ve `channel-service.ts:94-163` (`assertAddressFree` + P2002 yarış dalı) kanal tipini hiçbir yerde özel-durumlamaz. Bu alt-görev o iddiayı VARSAYMAZ, TESTLE KANITLAR. Test kırmızı gelirse iddia yanlıştır ve kalem OPUS-MAX bir çekirdek alt-görevle genişletilmelidir (§D kaydı ile).

DOSYALAR: `apps/e2e/tests/telegram.spec.ts` (yeni) · `apps/api/test/integration/channels-adapters.test.ts` (denetim düzeltmesi: `channels.test.ts` YOKTUR) · `apps/e2e/kanit/`

REFERANS DESEN: `apps/e2e/tests/instagram.spec.ts` birebir.

KAPI: bu alt-görev yeşile dönmeden kalem ✅ olmaz.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.
