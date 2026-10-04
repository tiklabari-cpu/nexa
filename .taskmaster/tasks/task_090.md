# Task ID: 90

**Title:** 13.7 — Mobil uygulamalar (iOS/Android + push) · dilim V3-5

**Status:** done

**Dependencies:** 81 ✓, 82 ✓, 84 ✓

**Priority:** medium

**Description:** FR-MOD-13.7 · Should · v1'den taşındı (§D60). Barındırma kararı §D96: bu monorepo'da apps/mobile (Expo/RN), store payı kapsam dışı.

**Details:**

Faz 3 (Enterprise) · PLAN §6.1 · kalem `13.7` · dilim V3-5

11 atomik alt-görev · ~15 pencere · etiket dağılımı: OPUS-XHIGH x4 · OPUS-MAX x2 · SONNET-XHIGH x5

KK: "Inbox/AI/CRM/Reports mobilde; push; tam modül paritesi (SiyahTuş farklılaşması)" (FR-MOD-13.7 birebir) + "Bkz. FR-MOD-08.2; kanallar arası tutarlı" (FR-MOD-13.8 birebir).

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  13.7-a [OPUS-XHIGH] apps/mobile Expo/RN workspace bootstrap + paylaşılan kontrat tipleri + kapı komutları  (bağ: —)
  13.7-b [OPUS-MAX] Mobil oturum/token modeli (BÖLÜNMEZ) — güvenli saklama + PKCE native yönlendirme + yenileme/iptal  (bağ: 13.7-a)
  13.7-c [OPUS-XHIGH] device_tokens tablosu + RLS + kayıt/yenileme/iptal uçları  (bağ: 13.7-a)
  13.7-d [OPUS-MAX] Push gönderim çekirdeği (BÖLÜNMEZ) — 08.2 tercihi + hedef seçimi + cross-tenant reddi (APNs/FCM MOCK)  (bağ: 13.7-c)
  13.7-e [SONNET-XHIGH] Mobil kabuk + navigasyon + tasarım token'larının RN karşılığı  (bağ: 13.7-b)
  13.7-f [OPUS-XHIGH] Mobil Inbox — sohbet listesi + transcript + composer + RTM (reconnect/missed-event)  (bağ: 13.7-e)
  13.7-g [SONNET-XHIGH] Mobil Customers (CRM) — liste + kişi detayı  (bağ: 13.7-e)
  13.7-h [SONNET-XHIGH] Mobil Reports — salt-okunur KPI kartları  (bağ: 13.7-e)
  13.7-i [SONNET-XHIGH] Mobil AI/Copilot yüzeyi — özet + yanıt önerisi (salt-tüketici)  (bağ: 13.7-f)
  13.7-j [SONNET-XHIGH] Mobil bildirim tercihleri ekranı + cihaz kaydının bağlanması  (bağ: 13.7-c, 13.7-e)
  13.7-k [OPUS-XHIGH] Uçtan uca doğrulama — modül paritesi matrisi + push yaşam döngüsü + cross-tenant + bundle kapısı  (bağ: 13.7-f, 13.7-g, 13.7-h, 13.7-i, 13.7-j)

BAĞLAM KURULUMU (bu görev KOD YAZMAZ — alt-görevleri koşulur):
- PLAN §6.1.6 kalem kırılımı + bölünmeyen çekirdek gerekçeleri + varsayımlar + açık sorular
- PLAN §6.2 dilim sırası ve sıralamanın gerekçesi · PLAN §G Faz-3 düz tablosu
- CONVENTIONS DoD kapısı · TASK-RUNNER-PROMPT pencere protokolü
- Tam alan detayı her alt-görevin kendi `details` alanındadır (Faz-3'ün companion dosyası YOK — PLAN §D98)

SINIRLAR (CLAUDE.md): dış servisler MOCK · production deploy/DNS/TLS/gerçek secret/ödeme YOK ·
force-push/DB drop/history rewrite YOK · başka repoya dokunma YOK.

**Test Strategy:**

Her alt-görev KENDİ tam DoD kapısından geçer (CONVENTIONS §1): pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && ilgili test:integration/test:e2e — hepsi exit 0. Kalem ancak son doğrulama alt-görevi (13.7-k) yeşil olduğunda ✅ sayılır. Her alt-görevin kendi testStrategy alanı o pencerenin kapı komutlarını verir.

## Subtasks

### 90.1. 13.7-a [OPUS-XHIGH] apps/mobile Expo/RN workspace bootstrap + paylaşılan kontrat tipleri + kapı komutları

**Status:** done  
**Dependencies:** None  

apps/mobile Expo/RN workspace bootstrap + paylaşılan kontrat tipleri + kapı komutları

**Details:**

13.7-a — apps/mobile Expo/RN workspace bootstrap + paylaşılan kontrat tipleri + kapı komutları  [OPUS-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~2 pencere

BARINDIRMA KARARI (§D96 — bu turda verildi): mobil bu monorepo'da `apps/mobile` olarak yaşar (Expo + React Native + TypeScript). Ayrı repo ELENDİ (CLAUDE.md "başka repoya dokunma YOK" sınırı; kontrat tipleri kopyalanır → drift; DoD kapısı buradan koşamaz). Erteleme ELENDİ (§F.00: gerekçesiz erteleme gizlenmiş ⬜'dir; §D60 bu tuzağı bir kez düzeltti).

KAPSAM DARALTMASI (kararın ayrılmaz parçası): DoD kapısı `expo export` (JS bundle) + RN test süiti + paylaşılan kontrat tipleri üzerinden koşar. `.ipa`/`.apk` üretimi ve store yüklemesi KAPSAM DIŞI (CLAUDE.md "production deploy yok" + bu makinede native araç zinciri yok). Sonuç: 13.7 satırı `◐` kalır, eksik §D96'ya kabul edilen borç olarak yazılır. Mobil `Should`'dur; §F.00 kapısını bloklamaz.

KAPSAM: `apps/mobile` workspace'i (`pnpm-workspace.yaml`), `@siyahtus/types` + `@siyahtus/contract` generated tiplerinin tüketimi, `turbo.json` task'larına bağlanma (typecheck/lint/test/build), `expo export` bundle kapısı.

DOSYALAR: `pnpm-workspace.yaml` · `turbo.json` · `apps/mobile/package.json` · `apps/mobile/tsconfig.json` · `apps/mobile/app.json` · `tsconfig.base.json`

REFERANS DESEN: `apps/widget` — framework'süz, kendi build'i olan, `@siyahtus/types` tüketen workspace; `turbo.json` task bağlanma kalıbı.

VARSAYIM: Expo MANAGED workflow; custom native modül YAZILMAZ (araç zinciri kısıtı).

KAPSAM DIŞI: oturum (13.7-b), ekranlar (13.7-e…-j).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 90.2. 13.7-b [OPUS-MAX] Mobil oturum/token modeli (BÖLÜNMEZ) — güvenli saklama + PKCE native yönlendirme + yenileme/iptal

**Status:** done  
**Dependencies:** 90.1  

Mobil oturum/token modeli (BÖLÜNMEZ) — güvenli saklama + PKCE native yönlendirme + yenileme/iptal

**Details:**

13.7-b — Mobil oturum/token modeli (BÖLÜNMEZ) — güvenli saklama + PKCE native yönlendirme + yenileme/iptal  [OPUS-MAX]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~2 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: oturumun NEREDE saklandığı, NASIL yenilendiği ve KAYBOLDUĞUNDA ne olduğu tek bir kimlik akıl yürütmesidir. Saklama yeri (secure enclave / keystore) ile yenileme politikası ayrı pencerelere bölünürse "token güvenli yerde ama süresiz" ya da "yenileniyor ama düz metinde" gibi yarım bir sonuç kalır; ikisi de kimlik sınırının ihlalidir.

KAPSAM: OAuth 2.1 + PKCE akışının native yönlendirmeye uyarlanması (SİSTEM TARAYICISI — gömülü webview DEĞİL, §C-A29: gömülü webview kimlik bilgisi toplayabilir), token'ın cihazda güvenli saklanması (expo-secure-store), yenileme, iptal, oturum kaybında davranış.

SSO ETKİLEŞİMİ: `S11-h` ile SSO zorunlu kılınmış bir lisansta mobil giriş de SSO'ya düşer — sistem tarayıcısı bunu doğal olarak destekler. Bu, V3-1'in V3-5'ten önce gelmesinin gerekçelerinden biridir.

**MOBİL HTTP İSTEMCİSİ DE BU ALT-GÖREVE AİTTİR (denetim bulgusu — sahipsizdi):** `apps/mobile/src/api/client.ts` — `Authorization` başlığını iliştiren, `baseURL`'i çözen, **401'de yenilemeyi tetikleyen**, yenileme başarısızsa oturumu düşüren ve ADR-06 hata zarfını (`{error:{type,message,request_id}}`) çözen tek istemci. Token iliştiren + 401'de yenileyen kod oturum güvenliğinin parçasıdır; ilk kırılımda ilk ekran alt-görevine (`13.7-g`, SONNET) düşüyordu.

**CİHAZ TOKEN'I YAŞAM DÖNGÜSÜ DE BURAYA TAŞINDI (denetim bulgusu):** kayıt/yenileme/**iptal** tetikleyicileri (açılış, çıkış, hesap değiştirme) oturum çekirdeğinin parçasıdır — `13.7-j` yalnız tercih ekranını gösterir. Zorunlu kural: **iptal çağrısı başarısız olsa bile yerel token SİLİNİR ve bir daha kullanılmaz; yeni oturum YENİ kayıt yapar. Hesap değiştirmede önceki hesabın token'ı iptal edilmeden yeni kayıt YAPILMAZ.** Aksi hâlde aynı fiziksel cihaz A kiracısının push'unu alırken B kiracısının kullanıcısının elinde olur ve `13.7-d`'nin sunucu tarafı savunması devreye giremez (sunucu açısından token hâlâ geçerlidir).

DOSYALAR: `apps/mobile/src/auth/` · `apps/mobile/src/api/client.ts` · `apps/api/src/services/auth/oauth-service.ts:147,193` (redirect_uri kaydı — yeni istemci tipi) · `apps/api/src/services/auth/token-service.ts`

REFERANS DESEN: `oauth-service.ts:147` `createAuthorizationCode` + `:193` `exchangeAuthorizationCode` — mevcut PKCE akışı DEĞİŞTİRİLMEZ, mobil ona bağlanır. İkinci bir token verme yolu AÇILMAZ.

KAPSAM DIŞI: push (13.7-c/-d), ekranlar.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 90.3. 13.7-c [OPUS-XHIGH] device_tokens tablosu + RLS + kayıt/yenileme/iptal uçları

**Status:** done  
**Dependencies:** 90.1  

device_tokens tablosu + RLS + kayıt/yenileme/iptal uçları

**Details:**

13.7-c — device_tokens tablosu + RLS + kayıt/yenileme/iptal uçları  [OPUS-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~1 pencere

NEDEN AÇIK: depoda cihaz token'ı / push altyapısı YOK (grep `device_token|APNs|FCM` → 0 eşleşme). Bildirim tercihleri bugün yalnız istemci tarafında ve üç alan: `{enabled, sound, desktop}` (`apps/web/src/features/notifications/notifications.ts:12-21`); e-posta tercihi sunucuda ayrı (`apps/api/src/routes/agents.ts:43`).

KAPSAM: `device_tokens` tablosu (licenseId, accountId, platform ios|android, token, createdAt, lastSeenAt, revokedAt) + RLS + `POST /notifications/devices` (kayıt/yenileme) + `DELETE /notifications/devices/{id}` (iptal) + kontrat.

DOSYALAR: `apps/api/prisma/schema.prisma` + migration · `apps/api/src/routes/agents.ts` veya yeni `routes/notifications.ts` · `packages/contract/openapi/paths/`

REFERANS DESEN: `api_tokens` yaşam döngüsü (oluştur/son kullanım/iptal) · RLS policy kalıbı tm 80 `08.9.6-b`.

KAPSAM DIŞI: gönderim (13.7-d), ekran (13.7-j).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**DÜZ METİN SIR NOTU (denetim bulgusu · §C'ye yazılacak):** `device_tokens.token` bir TESLİM KİMLİK BİLGİSİDİR ve push göndermek için düz metin gerektiğinden `api_tokens` gibi hash'lenemez. Bu yüzden: kolon hiçbir okuma yanıtında dönmez (yalnız id + platform + son görülme), pino redaction listesine eklenir, audit metadata'sına yazılmaz ve RLS politikası `api_tokens` kadar sıkı yazılır. Karar ve gerekçesi §C'ye assumption olarak eklenir.

**BİLDİRİM TERCİHİNİN SUNUCUYA TAŞINMASI BU ALT-GÖREVE AİTTİR (denetim bulgusu K5-5):** bugün tercihler istemcide (`apps/web/src/features/notifications/notifications.ts:12-21` → `{enabled,sound,desktop}`, localStorage) ve sunucuda yalnız `notify_email` kolonu var (migration `20260725110000_notify_email_preference`). `13.7-d` push hedefini seçerken tercihi SUNUCUDAN okumak zorundadır. Şema + migration + kontrat + panelin mevcut yüzeyinin taşınması bu alt-görevin kapsamındadır (`13.7-d`'nin bölünmez çekirdeği bunu YUTMAZ). **DİKKAT:** bu değişiklik PLAN §3'teki `13.8` (`✅ → K13.8`) satırının kanıtını genişletir — damga yeniden mühürlenir ve `## K.` bloğuna madde eklenir.

### 90.4. 13.7-d [OPUS-MAX] Push gönderim çekirdeği (BÖLÜNMEZ) — 08.2 tercihi + hedef seçimi + cross-tenant reddi (APNs/FCM MOCK)

**Status:** done  
**Dependencies:** 90.3  

Push gönderim çekirdeği (BÖLÜNMEZ) — 08.2 tercihi + hedef seçimi + cross-tenant reddi (APNs/FCM MOCK)

**Details:**

13.7-d — Push gönderim çekirdeği (BÖLÜNMEZ) — 08.2 tercihi + hedef seçimi + cross-tenant reddi (APNs/FCM MOCK)  [OPUS-MAX]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~2 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: push HEDEFİNİ seçen kod KİRACI SINIRINI GEÇEN koddur — yanlış seçim başka bir çalışma alanının müşteri mesajını yabancı bir cihaza gönderir. Tercih kontrolü (FR-MOD-08.2), hedef seçimi ve iptal edilmiş token reddi AYNI pencerede olmalı; ayrılırsa aradaki sürümde "tercihi kapalı kullanıcıya gönderim" veya daha kötüsü çapraz-kiracı teslim mümkün olur.

KAPSAM: yeni sohbet / atama / mention olayında ilgili ajanların CİHAZLARINA push. FR-MOD-13.8 KK'sı "kanallar arası tutarlı" diyor: aynı tercih kümesi (08.2) mobil kanatta da geçerli olmalı — ses/masaüstü/e-posta/tarayıcı yanına `mobile` eklenir ve tercih SUNUCUDA okunur (bugün istemci tarafında duruyor).

SAĞLAYICI MOCK: gönderim `.data/push/<licenseId>/<timestamp>.json` altına yazılır; testler oradan okur. Gerçek APNs/FCM anahtarı YOKTUR (CLAUDE.md: gerçek secret yok).

DOSYALAR: `apps/api/src/services/notifications/push.ts` (yeni) · **tetik noktası: `apps/api/src/routes/customer.ts:199,493,516` (`notifyAssignee` kalıbı) ve chat yazma yolları** — denetim düzeltmesi: `services/realtime/publisher.ts` bir bildirim kancası DEĞİL, RTM fan-out yayıncısıdır ("Publishing never fails a request … after the transaction commits"); emsalin (`assignee-email.ts`) tetiği route'tur · `apps/api/src/routes/agents.ts:43` (tercih gövdesi — model `13.7-c`'de sunucuya taşındı)

REFERANS DESEN (birebir): `apps/api/src/services/notifications/assignee-email.ts` (tm 31 · 13.8) — tercih okuma + mock sink'e yazma zinciri; tetiği `routes/customer.ts:39,199` (`shouldEmailAssignee` → `notifyAssignee`). Mock sink kalıbı: `services/mail/mailer.ts` FileMailer.

KAPSAM DIŞI: ekran (13.7-j), e2e (13.7-k).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 90.5. 13.7-e [SONNET-XHIGH] Mobil kabuk + navigasyon + tasarım token'larının RN karşılığı

**Status:** done  
**Dependencies:** 90.2  

Mobil kabuk + navigasyon + tasarım token'larının RN karşılığı

**Details:**

13.7-e — Mobil kabuk + navigasyon + tasarım token'larının RN karşılığı  [SONNET-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~1 pencere

KAPSAM: uygulama kabuğu, sekme/yığın navigasyonu (Inbox / Customers / Reports / Ayarlar), `apps/web/src/styles/tokens.css` token'larının RN karşılığı (renk, tipografi, spacing, radius, açık/koyu tema).

DOSYALAR: `apps/mobile/src/app/` · `apps/mobile/src/theme/tokens.ts` (yeni) + test

REFERANS DESEN: `apps/web/src/styles/tokens.css` + mevcut token testi. **MEKANİZMA (denetim sonrası SEÇİLDİ — ilk hâli "tek kaynaktan türetilir" deyip nasılını söylemiyordu):** `apps/mobile/src/theme/tokens.ts` elle yazılır AMA bir test `tokens.css`'i ayrıştırıp değerleri karşılaştırır (sapma testi). **Yeni bir workspace paketi (`packages/tokens`) AÇILMAZ** — `13.7-a`'nın kapsamında yok ve tek tüketici için paket açmak bu depoda emsalsiz. `design-brief.md` token sözlüğü referans.

KAPSAM DIŞI: ekran içerikleri (13.7-f…-j).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 90.6. 13.7-f [OPUS-XHIGH] Mobil Inbox — sohbet listesi + transcript + composer + RTM (reconnect/missed-event)

**Status:** done  
**Dependencies:** 90.5  

Mobil Inbox — sohbet listesi + transcript + composer + RTM (reconnect/missed-event)

**Details:**

13.7-f — Mobil Inbox — sohbet listesi + transcript + composer + RTM (reconnect/missed-event)  [OPUS-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~2 pencere

KAPSAM: FR-MOD-13.7 KK'sının en ağır payı. Sohbet listesi, transcript (ters sonsuz kaydırma), composer (yanıt + internal note), RTM bağlantısı — reconnect ve missed-event sync DAHİL.

KRİTİK: RTM protokolü ADR-15'te kilitli (`{request_id, action, payload}` → `{request_id, action, type, success, payload}`); mobil AYNI protokolü konuşur, ikinci bir protokol açılmaz. Missed-event sync event id'nin thread+sıra kodlamasına dayanır (`TJ1H8CFKRV_7`) — README'nin "Notable engineering choices" bölümü.

DOSYALAR: `apps/mobile/src/features/inbox/` · `apps/mobile/src/rtm/` (istemci)

REFERANS DESEN: `apps/web/src/features/inbox/` (46 dosya — en ağır feature) ve `apps/web/src/lib/realtime.ts`; iş mantığı KOPYALANMAZ, paylaşılabilen kısım `@siyahtus/types` üzerinden gelir, RN yalnız sunum katmanını yazar.

KAPSAM DIŞI: AI yüzeyi (13.7-i), e2e (13.7-k).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 90.7. 13.7-g [SONNET-XHIGH] Mobil Customers (CRM) — liste + kişi detayı

**Status:** done  
**Dependencies:** 90.5  

Mobil Customers (CRM) — liste + kişi detayı

**Details:**

13.7-g — Mobil Customers (CRM) — liste + kişi detayı  [SONNET-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~1 pencere

KAPSAM: FR-MOD-13.7 KK'sındaki "CRM" payı — kişi listesi (arama + sayfalama) ve kişi detayı (salt-okunur + temel alanlar).

DOSYALAR: `apps/mobile/src/features/customers/`

REFERANS DESEN: `apps/web/src/features/customers/` — aynı API uçları, aynı sorgu anahtarları; sunum RN.

KAPSAM DIŞI: kampanyalar, traffic (mobil kapsam dışı — §C-A28).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**HTTP İSTEMCİSİ (denetim bulgusu):** `13.7-b`'nin `apps/mobile/src/api/client.ts`'i kullanılır. **İkinci bir istemci veya elle `fetch` YAZILMAZ** — token iliştirme ve 401 yenileme oturum çekirdeğinin parçasıdır.

### 90.8. 13.7-h [SONNET-XHIGH] Mobil Reports — salt-okunur KPI kartları

**Status:** done  
**Dependencies:** 90.5  

Mobil Reports — salt-okunur KPI kartları

**Details:**

13.7-h — Mobil Reports — salt-okunur KPI kartları  [SONNET-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~1 pencere

KAPSAM: FR-MOD-13.7 KK'sındaki "Reports" payı — Overview KPI kartları, salt-okunur. Düşük-baz (low-N) uyarısı KORUNUR (FR-MOD-07.3.2 zorunlu).

DOSYALAR: `apps/mobile/src/features/reports/`

REFERANS DESEN: `apps/web/src/features/reports/ReportsPage.tsx` KPI kartı kalıbı; aynı uç, aynı ADR-09 sayıları (Manual/Assisted/Automated tutarlılığı bozulmaz).

KAPSAM DIŞI: rapor grupları, export, zamanlanmış raporlar (mobil kapsam dışı).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**HTTP İSTEMCİSİ (denetim bulgusu):** `13.7-b`'nin `apps/mobile/src/api/client.ts`'i kullanılır. **İkinci bir istemci veya elle `fetch` YAZILMAZ** — token iliştirme ve 401 yenileme oturum çekirdeğinin parçasıdır.

### 90.9. 13.7-i [SONNET-XHIGH] Mobil AI/Copilot yüzeyi — özet + yanıt önerisi (salt-tüketici)

**Status:** done  
**Dependencies:** 90.6  

Mobil AI/Copilot yüzeyi — özet + yanıt önerisi (salt-tüketici)

**Details:**

13.7-i — Mobil AI/Copilot yüzeyi — özet + yanıt önerisi (salt-tüketici)  [SONNET-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~1 pencere

KAPSAM: FR-MOD-13.7 KK'sındaki "AI" payı — sohbet özeti ve yanıt önerileri. SALT TÜKETİCİ: yeni AI ucu AÇILMAZ, mevcut Copilot uçları çağrılır.

DOSYALAR: `apps/mobile/src/features/copilot/`

REFERANS DESEN: `apps/web/src/features/inbox/CopilotPanel.tsx` + reply suggestions bileşenleri (tm 12.x). LLM MOCK'tur (`packages/ai-mock`), deterministik — testler flake olmaz.

KAPSAM DIŞI: skill/knowledge yönetimi (mobil kapsam dışı).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**HTTP İSTEMCİSİ (denetim bulgusu):** `13.7-b`'nin `apps/mobile/src/api/client.ts`'i kullanılır. **İkinci bir istemci veya elle `fetch` YAZILMAZ** — token iliştirme ve 401 yenileme oturum çekirdeğinin parçasıdır.

### 90.10. 13.7-j [SONNET-XHIGH] Mobil bildirim tercihleri ekranı + cihaz kaydının bağlanması

**Status:** done  
**Dependencies:** 90.3, 90.5  

Mobil bildirim tercihleri ekranı + cihaz kaydının bağlanması

**Details:**

13.7-j — Mobil bildirim tercihleri ekranı + cihaz kaydının bağlanması  [SONNET-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~1 pencere

KAPSAM (denetim sonrası DARALTILDI): bildirim tercihleri **ekranı** (FR-MOD-08.2 kümesi: yeni sohbet / atama / mention) — tercihleri okur, yazar, izin durumunu gösterir.

**CİHAZ TOKEN'I KAYIT/İPTAL TETİKLEYİCİLERİ BU ALT-GÖREVDE DEĞİLDİR** — onlar `13.7-b`'nin (OPUS-MAX oturum çekirdeği) parçasıdır. Gerekçe: çıkışta/hesap değiştirmede iptalin başarısız olması çapraz-kiracı push teslimine kapı açar; bu bir izolasyon kararıdır, ekran işi değil. Bu ekran yalnız **tercihi** yönetir.

DOSYALAR: `apps/mobile/src/features/notifications/`

REFERANS DESEN: `apps/web/src/features/notifications/notifications.ts` tercih modeli · `apps/api/src/routes/agents.ts:43` sunucu tercih gövdesi. FR-MOD-13.8 KK'sı "kanallar arası tutarlı" — mobil tercihleri diğer kanallarla AYNI sözlüğü kullanır, paralel bir model açılmaz.

KAPSAM DIŞI: gönderim mantığı (13.7-d), e2e (13.7-k).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**HTTP İSTEMCİSİ (denetim bulgusu):** `13.7-b`'nin `apps/mobile/src/api/client.ts`'i kullanılır. **İkinci bir istemci veya elle `fetch` YAZILMAZ** — token iliştirme ve 401 yenileme oturum çekirdeğinin parçasıdır.

### 90.11. 13.7-k [OPUS-XHIGH] Uçtan uca doğrulama — modül paritesi matrisi + push yaşam döngüsü + cross-tenant + bundle kapısı

**Status:** done  
**Dependencies:** 90.6, 90.7, 90.8, 90.9, 90.10  

Uçtan uca doğrulama — modül paritesi matrisi + push yaşam döngüsü + cross-tenant + bundle kapısı

**Details:**

13.7-k — Uçtan uca doğrulama — modül paritesi matrisi + push yaşam döngüsü + cross-tenant + bundle kapısı  [OPUS-XHIGH]

PRD: 13.7 (PLAN §6.1 · dilim V3-5 · tm 90)
TAHMİN: ~1 pencere

KAPSAM: (1) MODÜL PARİTESİ MATRİSİ — FR-MOD-13.7 KK'sının dört yüzeyinin (Inbox/AI/CRM/Reports) mobilde çalıştığının tek yerde kanıtı; matris testi hangi yüzeyin karşılandığını ve neyin kapsam dışı olduğunu (Settings/Billing/Playbook/Team — §C-A28) açıkça sayar. (2) push yaşam döngüsü integration: kayıt → gönderim → yenileme → iptal → gönderim reddi. (3) cross-tenant negatifi. (4) `expo export` bundle kapısı.

DÜRÜSTLÜK KAYDI (§D96): bu alt-görev yeşile döndüğünde 13.7 satırı `✅` DEĞİL `◐` olur — "mağazada yayınlanmış uygulama" payı karşılanmaz. Bu kapanış uğruna `✅` UYDURULMAZ (TASK-RUNNER-PROMPT §3: "Gereksinimi yalnız kısmen karşıladıysan ◐ bırak").

DOSYALAR: `apps/mobile/src/__tests__/parity.test.ts` (yeni) · `apps/api/test/integration/push.test.ts` · `PLAN.md` (13.7 satırı → `◐ → K13.7`) + `## K.` bölümünde `#### K13.7` bloğu

KAPI: bu alt-görev yeşile dönmeden kalem kapanmaz.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.
