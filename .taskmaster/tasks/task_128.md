# Task ID: 128

**Title:** 13.7 — Mobil uygulama gerçekten kullanılabilir: giriş ekranı + SSO tarayıcı bacağı + çıkış + bildirim tepkisi + çalıştırılabilirlik (§D111 · Faz-4)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** 2026-08-17 kod denetimi (§D111): apps/mobile'da dört yüzey + push + parite teslim edilmiş ama uygulamaya GİRİŞ YOLU YOK — MobileSession.signIn/signInWithSso/signOut'un üretimde sıfır çağıranı var, RootNavigator oturum-yok durumunda da dört sekmeyi açıyor, systemBrowser bağlanmamış, app.json API portu 3000 (gerçek 4000), deep-link/bildirim tıklaması/hata sınırı/ikon/README yok. Bu görev telefonu ilk açılıştan çıkışa kadar gerçek bir kullanıcının yürüyebileceği hâle getirir; bitince 13.7 satırı ◐ → ✅.

**Details:**

BULGU (2026-08-17 kod denetimi · §D111 · PLAN.md K13.7 üst kutusu):
Üç çelişki denetimi (§D108/§D109/§D110) 13.7'yi PRD KK metnine karşı ölçtü ve KK'nın üç payını
(dört yüzey · push · tam modül paritesi) yerinde buldu — bu doğru. Hiçbiri şunu sormadı: **bir insan
bu uygulamaya girebiliyor mu?** Cevap HAYIR:
- `apps/mobile/src/app/RootNavigator.tsx:24-29` oturum durumuna bakmadan dört sekmeyi mount eder;
  `sessionState.status === 'signed-out'` için hiçbir dal yok. Soğuk açılışta `services.tsx:64`
  `session.restore()` boş depoyla `signed-out` döner, `ChatListScreen.tsx:28-30` `loadChats()` 401 alır,
  kullanıcı sonsuza kadar kırmızı hata metni görür; kaçış yolu yok.
- `apps/mobile/src/auth/session.ts:212` `signIn`, `:254` `signInWithSso`, `:330` `signOut`,
  `:353` `switchAccount` — ÜRETİMDE SIFIR ÇAĞIRAN (yalnız `session.test.ts`).
- `apps/mobile/src/auth/browser.ts:21` `systemBrowser` hiçbir yerden import edilmiyor;
  `app/services.tsx:47-51` oturumu `browser` olmadan kurar → `signInWithSso` çağrılsa
  `'No browser is available for single sign-on.'` fırlatır.
- `apps/mobile/app.json:14` `apiBaseUrl: http://localhost:3000/api/v1` — API 4000'de (kök README).
  `localhost` cihazdan/Android emülatöründen zaten erişilemez; `app.config.*` yok, env ile ezilemez.
- `NavigationContainer`'a `linking` verilmemiş; `Linking` importu yok → `siyahtus://` şeması (app.json:8,
  `MOBILE_REDIRECT_URI`) hiçbir yere yönlenmiyor.
- `expo-notifications` yalnız izin + `getDevicePushTokenAsync` için (`auth/push-tokens.ts:99-119`);
  `setNotificationHandler` / `addNotificationResponseReceivedListener` / `getLastNotificationResponseAsync`
  YOK → bildirime dokunmak sohbete götürmez, ön planda bildirim görünmez; `app.json`'da plugin bloğu yok.
- Hata sınırı yok (`App.tsx:22-25` yalnız `MobileConfigError` yakalar) · `assets/` yok (ikon/splash) ·
  `apps/mobile/README` yok · `InboxProvider.tsx:61` `organizationId === null` iken RTM hiç kurulmaz ·
  `rtm/client.ts:177-180` token `null` iken `#open()` sessizce döner ve yeniden deneme planlamaz.
Kanıt bu turda ölçüldü: mobil jest 389/389 (33 dosya) — yani anlatılan iş yerinde; eksik olan
gizlenmiş iş değil, **dikişin sahibinin olmaması**: 13.7-f'nin (tm 90.6) kanıt maddesi giriş
ekranı borcunu 2026-08-16'da yazmış ve "13.7-k kapsamalı" demişti; 13.7-k kapsamadı, üç denetim
de sormadı. Ders §D111'de.

BU GÖREVİN PAYI: telefonu ilk açılıştan çıkışa kadar gerçek bir kişinin yürüyebileceği hâle
getirmek. Sekiz alt-görev (13.7-p … 13.7-w). Bitince `13.7` satırı `◐` → `✅` (13.7-w yapar).

DEĞİŞMEZLER (13.7-b'nin kararları — üst görev tm 90'ın details'i emsaldir):
- İKİNCİ BİR TOKEN VERME YOLU AÇILMAZ. Telefon konsolun `/auth/login` (workspace listesi) →
  `/auth/authorize` (JSON POST, S256 PKCE, `redirect_uri = MOBILE_REDIRECT_URI`) → `/auth/token`
  zincirini kullanır; `session.ts` bunu ZATEN uygular (`listWorkspaces` · `signIn` · `signInWithSso`).
  Bu görev EKRAN + BAĞLAMA işidir; sunucu, şema, sözleşme DEĞİŞMEZ.
- `client_id` `/auth/login` yanıtındaki üyelik satırından gelir (`memberships[].client_id`; web'in
  `apps/web/src/lib/auth-store.ts:289` yaptığı gibi) — app.json'a sabit client id YAZILMAZ.
- SSO sistem tarayıcısıyla (§C-A29), verifier diske yazılmaz — `session.ts:254-` zaten öyle.
- Refresh token yalnız `expo-secure-store`; eslint kuralları (`no-restricted-imports` AsyncStorage/
  `expo-file-system`) DEĞİŞMEZ.
- `parity.test.ts` iki yönlü tam eşitlik ister: telefonun çağırdığı her yol ya bir yüzeye ya
  `SUPPORTING`'e sınıflanır. Giriş yolu `/auth/login` zaten `SUPPORTING` (oturum satırı) olmalı — kontrol
  et; yeni istek literali eklersen matris aynı alt-görevde güncellenir (tm 127 tuzak 1-4 aynen geçerli).
- Mobil üretim kaynağı `node:*` import EDEMEZ; `jest.mock` fabrikası yerel const'u kapatamaz.
- Expo managed workflow; custom native modül YOK; her yeni bağımlılık `expo export`'u (ios+android) yeşil
  bırakmalı — build kapısı budur, Playwright mobile'a girmez.
- Mağaza payı (.ipa/.apk + store) `⛔-süreç` (§D110) — bu görevin DIŞINDA; `parity.test.ts`
  `SCOPE_BOUNDARIES` maddesi AYNEN kalır.

BİLİNEN TUZAKLAR:
1) RNTL altında navigator testleri: `getBy*` yerine `findBy*`/`waitFor`; "Unable to locate attached
   view" mesajı çoğu zaman render tamamlanmadan sorgulamaktır (tm 129 / §D112).
2) Jest'te `expo-web-browser`/`expo-notifications`/`expo-linking` mock'lanır; App.test.tsx'in mevcut
   `expo-secure-store`/`expo-constants` mock deseni izlenir (jest.mock hoisting: fabrika üstte, sabitler
   fabrikanın içinde).
3) `RootNavigator` oturuma göre dallanınca `App.test.tsx`'in dört-tab senaryoları ÖNCE oturum
   kurmalıdır (sahte `MobileSession` `signed-in` durumu) — testleri susturma, kurulumunu değiştir.
4) `navigation.ts` tipleri: yeni rotalar (`SignIn`, `WorkspacePicker`, `Account`) TİPLİ ve bir
   `Stack.Screen`'e FİİLEN verilmiş olmalı; parity.test yalnız tipte var olan rotayı reddeder.

KAPSAM SINIRI: apps/api · apps/web · apps/e2e · packages/contract'a DOKUNULMAZ (istisna 13.7-s: push
yükü tipini `@siyahtus/types`'a çıkarmak GEREKİRSE yalnız tip, sunucu davranışı değişmeden — bkz. alt-görev).
Kapalı görevler (tm 90.x · 125 · 127.x) GERİ AÇILMAZ.

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Sekiz alt-görevin sekizi `done` olduğunda bitmiştir; üst görev ayrıca şunları ister (hepsi exit 0):
- `pnpm --filter @siyahtus/mobile test` — tam süit yeşil (taban 389/389 · 33 dosya; sonunda 13.7-w'nin
  soğuk-açılış yolculuğu testi dahil).
- `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` (mobil `expo export` ios+android iki bundle).
- `pnpm -w test` · `pnpm -w test:integration` regresyonsuz.
- ÖLÇÜLEBİLİR KABUL: (1) `grep -rn "signIn\|signInWithSso\|signOut" apps/mobile/src --include=*.tsx | grep -v test`
  ≥ 3 üretim çağıranı; (2) `RootNavigator` `signed-out` → giriş yığını, `signed-in` → dört sekme;
  (3) `app.json`/`app.config.ts` API tabanı 4000; (4) `parity.test.ts` AUTH/SUPPORTING satırları
  yeni yolları sınıflar; (5) PLAN.md:572 `◐ → K13.7` → `✅ → K13.7` (13.7-w), K13.7 üst kutusu "GÜNCEL
  DURUM: ✅" olarak güncellenir, §1 faz tablosu Faz-3 sayacı `6 ✅ + 0 ◐`'ye döner, §2 matrisi `Mobil app`,
  §6 tablosu 13.7 satırı, §6.2 dilim 5, §F.00 13.7 paragrafı — hepsi 13.7-w'nin işi.

## Subtasks

### 128.1. 13.7-p [OPUS-XHIGH] Oturum kapısı + giriş ekranı — e-posta/parola → workspace seçimi → PKCE; RootNavigator oturuma göre dallanır

**Status:** done  
**Dependencies:** None  

Telefonun giriş yolu: oturum yoksa giriş yığını; e-posta/parola → workspace seçimi → PKCE ile oturum.

**Details:**

NE YAPILACAK: Telefonun GİRİŞ yolu. İki parça: (a) oturum kapısı — `RootNavigator` `useSession()`
durumuna göre dallanır: `restoring` → yükleniyor ekranı (splash benzeri, `ThemeProvider` altında);
`signed-out` → `AuthStack` (`SignIn` + `WorkspacePicker`); `signed-in` → mevcut dört-tab navigator
(değişmez). (b) `SignInScreen`: e-posta + parola → `session.listWorkspaces(email,password)`
(`POST /auth/login`, token vermez) → tek üyelik varsa doğrudan `session.signIn({email,password,
licenseId, clientId: membership.client_id})`; birden çoksa `WorkspacePickerScreen` (ad + rol satırları);
`SsoRequiredError` yakalanınca "Bu workspace SSO ile giriş ister" + "Continue with SSO" düğmesi —
düğmenin FİİLİ bağlaması 13.7-q'da (bu alt-görevde `signInWithSso` çağrısı yapılır ama browser
sağlayıcı yoksa dürüst hata metni gösterilir; test bunu doğrular).

NEDEN: `RootNavigator.tsx:24-29` oturum durumuna bakmıyor; `session.ts:212 signIn` üretimde sıfır
çağıranlı; soğuk açılışta kullanıcı 401 hata metnine hapsoluyor (§D111).

DOSYALAR: yeni `apps/mobile/src/features/auth/{SignInScreen,WorkspacePickerScreen,LoadingScreen}.tsx`
+ `features/auth/AuthStack.tsx` (+ context: `AuthProvider` YOK — oturum zaten `app/services.tsx`'in
`useServices()`/`useSession()` context'i; ekranlar onu tüketir) · `app/RootNavigator.tsx` (dallanma) ·
`app/navigation.ts` (`AuthStackParamList: { SignIn: undefined; WorkspacePicker: { email; password;
memberships } }` — parolayı route param'ında TAŞIMA: picker'a callback/ref ile ver ya da ekran-içi
state; parola navigasyon durumuna yazılmaz — bu bir güvenlik kararıdır, alt-görev OPUS bu yüzden) ·
`App.test.tsx` (dört-tab senaryoları artık sahte signed-in oturumla kurulur).
REFERANS DESEN: web `apps/web/src/features/auth/SignInPage.tsx` (285 satır: e-posta/parola →
üyelik listesi → `client_id` üyelikten; SSO dalı) · mobil oturum modeli `apps/mobile/src/auth/
session.ts:196-252` (`listWorkspaces`, `signIn`, `SsoRequiredError`) · Provider/context ayrımı
`features/inbox/InboxProvider.tsx` · form/hata üç ayrı cümle deseni `features/inbox/ChatListScreen.tsx`.
KK (bu payın kabulü): soğuk açılışta oturum yoksa GİRİŞ EKRANI görünür; doğru parola → dört sekme;
yanlış parola → alan-altı hata (sunucu mesajı sızdırılmadan, ADR-06 zarfının `type`'ından
türetilmiş dürüst cümle); ağ hatası → "tekrar dene"; birden çok workspace → seçim; giriş sırasında
düğme pasif (çift gönderim yok); `secureTextEntry` + `autoComplete`/`textContentType` doğru.
TESTLER: `SignInScreen.test.tsx` (boş alan → düğme pasif · yanlış parola · ağ hatası · tek üyelik →
signIn çağrısı doğru argümanlarla · çok üyelik → picker · SsoRequired → SSO metni) ·
`WorkspacePickerScreen.test.tsx` · `RootNavigator`/`App.test.tsx` (restoring/signed-out/signed-in
üç dal) — sahte `MobileSession` (mevcut `session.test.ts` fixture deseni).
KAPSAM DIŞI: SSO tarayıcı bağlaması (13.7-q) · çıkış (13.7-r) · "parolamı unuttum" (web'e link
vermek yeter — `WEB_APP_URL` telefonun config'inde yok, bu turda eklenmez; sabit metin de yazma —
düğme koyma). Sunucu/sözleşme DEĞİŞMEZ.
TUZAKLAR: (1) parola route param'ında taşınmaz (yukarıda); (2) `App.test.tsx`'in mevcut 4 senaryosu
kırılacak — kurulumunu değiştir, senaryoyu silme; (3) parity.test: `/auth/login` ve `/auth/authorize`
`SUPPORTING` sınıfında olmalı — `api.ts` istek literali `session.ts` içinde olduğu için matris regex'inin
gördüğü dosya listesini kontrol et (tm 127 tuzak 4).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 128.2. 13.7-q [OPUS-XHIGH] SSO tarayıcı bacağı bağlanır + siyahtus:// deep-link (linking) — SsoRequiredError → sistem tarayıcısı → callback → oturum

**Status:** done  
**Dependencies:** 128.1  

SSO düğmesi sistem tarayıcısını açar; siyahtus:// deep-link (linking) config bağlanır.

**Details:**

NE YAPILACAK: (a) `app/services.tsx` `MobileSession`'ı `browser: systemBrowser` ile kurar
(`auth/browser.ts:21` bugün hiç import edilmiyor); (b) 13.7-p'nin "Continue with SSO" düğmesi
`session.signInWithSso({connectionId, clientId})` çağırır → `expo-web-browser`
`openAuthSessionAsync(loginUrl, MOBILE_REDIRECT_URI)` → dönen URL'deki `code`+`state` → `#redeem`
(hepsi `session.ts:254-`'te ZATEN var; bu alt-görev bağlar ve ekranda hata/iptal durumlarını gösterir:
kullanıcı sheet'i kapattı → "İptal edildi", state uyuşmadı → dürüst hata, başarı → dört sekme);
(c) `NavigationContainer`'a `linking` config: `prefixes: ['siyahtus://']`, `config.screens`:
`auth/callback` (openAuthSessionAsync onu tüketir; yine de soğuk açılışta gelen callback'in bir
ekrana düşmesi için AuthStack'e yönlenir ve "tarayıcıdan dön" mesajı gösterir — kod tekrar
kullanılmaz, çünkü verifier bellekteydi ve süreç yeniden başladıysa yoktur; bu DÜRÜSTÇE yazılır),
`chats/:chatId` → Inbox/ChatDetail (13.7-s'nin bildirim tıklaması da aynı yolu kullanır).
NEDEN: `services.tsx:47-51` browser'sız kurulum → `signInWithSso` 'No browser is available' fırlatır;
`Linking` importu yok, `app.json:8` `scheme: siyahtus` boşa duruyor (§D111).
DOSYALAR: `app/services.tsx` · `app/RootNavigator.tsx` (`linking`) · `app/linking.ts` (yeni; config +
`getStateFromPath` gerekmez, düz config yeter) · `features/auth/SignInScreen.tsx` (SSO düğmesi) ·
testler.
REFERANS DESEN: web SSO akışı `apps/web/src/lib/auth-store.ts:startSsoLogin` + `features/auth/
AuthCallbackPage.tsx`; mobil `session.ts:254-` + `auth/browser.ts`; mock IdP `apps/api/scripts/
mock-idp-server.ts` (jest'te KULLANILMAZ — `AuthBrowser` arayüzü sahte ile enjekte edilir).
KK: SSO isteyen workspace'te düğme sistem tarayıcısını açar; başarılı dönüşte oturum kurulur;
iptal/uyumsuz state/timeout üç ayrı dürüst cümle; `siyahtus://chats/<id>` uygulamayı ilgili sohbette açar.
TESTLER: `SignInScreen.sso.test.tsx` (sahte browser: success/cancel/mismatch) · `linking.test.ts`
(config → rota eşlemesi) · `session.test.ts`'e browser'lı senaryo zaten var mı kontrol et, yoksa +1.
KAPSAM DIŞI: universal links (https) — özel şema yeter (RFC 8252 §7.1, 13.7-b kararı); sunucu değişmez.
TUZAKLAR: (1) `expo-web-browser` jest'te mock'lanır (jest.mock hoisting); (2) `linking` verilince
`App.test.tsx` NavigationContainer'ı `initialState`/`linking` ile çalışıyor mu bak — testte
`linking` prop'u `enabled: false` verilebilir; (3) verifier süreç ölünce kaybolur — bunu belgele, "code'u
saklayalım" DEME.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 128.3. 13.7-r [SONNET-XHIGH] Settings → Hesap kartı: kim/hangi workspace/rol + Sign out + Switch account

**Status:** done  
**Dependencies:** 128.1  

Settings altında hesap kartı + çıkış + hesap değiştirme.

**Details:**

NE YAPILACAK: `SettingsStack` köküne (bugün `NotificationsScreen`, başlık bağlantıları Team/Playbook/
Billing) bir **Account** bölümü: ad · e-posta · workspace adı · rol (`sessionState.principal`'dan —
ikinci istek YOK; principal'da yoksa `/auth/me` zaten çağrılıyor mu kontrol et; çağrılmıyorsa
`SUPPORTING` olarak ekle ve parity matrisini güncelle) + **Sign out** (onay → `session.signOut()` —
cihaz token'ı iptali + secure-store temizliği `session.ts:330`'da ZATEN sıralı; ekran yalnız çağırır ve
`signed-out` olunca 13.7-p'nin kapısı AuthStack'e döner) + **Switch account** (13.7-p'nin giriş
ekranına "başka hesap" modunda gider; `session.switchAccount` sırası önce iptal sonra kayıt — ekran
bunu doğrudan çağırmaz, giriş ekranı çağırır; karar 13.7-b §C-A31).
NEDEN: `session.ts:330 signOut` / `:353 switchAccount` üretimde çağrılmıyor; telefondan çıkış yolu yok (§D111).
DOSYALAR: `features/account/{AccountScreen.tsx,AccountScreen.test.tsx}` (yeni) · `app/stacks/SettingsStack.tsx`
(kök ekranın üstüne Account satırı ya da ayrı rota `Account` — tipli, monteli) · `app/navigation.ts`.
REFERANS DESEN: `features/billing/BillingScreen.tsx` (salt-okunur kart) · `features/notifications/
NotificationsScreen.tsx` (aynı stack'te ekran) · web `AppShell.tsx` hesap menüsü.
KK: kim olduğum + workspace görünür; Sign out onay ister, sonra giriş ekranı; Switch account giriş
ekranına götürür ve eski oturum kapanır.
TESTLER: `AccountScreen.test.tsx` (alanlar · sign out onayı → signOut çağrısı · switch → navigasyon).
KAPSAM DIŞI: profil düzenleme/parola değiştirme (masa işi §C-A28); sunucu değişmez.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 128.4. 13.7-s [OPUS-XHIGH] Push alımı: ön planda gösterim + bildirime dokununca ilgili sohbete gitme (soğuk açılış dahil) + app.json expo-notifications plugin

**Status:** done  
**Dependencies:** 128.1, 128.2  

Bildirim ön planda görünür, dokununca ilgili sohbet açılır (soğuk açılış dahil).

**Details:**

NE YAPILACAK: (a) `Notifications.setNotificationHandler` (ön planda göster: alert+sound; `kind`
`message`/`new_chat`/`assignment` için — 13.7-d'nin ürettiği yük `{kind, chat_id}`; içerik APNs/FCM'e
GİTMEZ, uygulama sonra API'den çeker — bu karar 13.7-d, değişmez); (b)
`addNotificationResponseReceivedListener` (uygulama açıkken dokunma) + `getLastNotificationResponseAsync`
(soğuk açılış: uygulama bildirimden açıldıysa) → `chat_id` varsa `Inbox → ChatDetail` (13.7-q'nun
`siyahtus://chats/:chatId` linking yolu ya da navigation ref — ikisi de kabul, seçim gerekçelenir);
oturum yoksa (signed-out) hedef SAKLANIR, giriş sonrası açılır; (c) `app.json` `plugins: [["expo-notifications",
{ icon, color }]]` (ikon 13.7-u'dan gelir; o bitmediyse plugin bloğu ikon olmadan eklenir ve 13.7-u
tamamlar) + `android.permission`'lar gerekiyorsa; (d) yük tipi: `apps/api/src/services/notifications/
push.ts`'in yazdığı yük şeklini telefon tarafında **tipli** oku — tip `@siyahtus/types`'ta yoksa
`PushPayload` olarak oraya çıkar (yalnız tip; sunucu davranışı değişmez; `push.ts` o tipi kullanacak
şekilde import edebilir — bu tek satırlık değişiklik apps/api'ye izinli istisnadır, testleri koş).
NEDEN: telefon push'u yazıyor (13.7-d/-l) ama OKUMUYOR: dokunmak son sekmeye götürür, ön planda
bildirim görünmez (§D111).
DOSYALAR: `apps/mobile/src/notifications/{handler.ts,response.ts}` (yeni) · `app/services.tsx` ya da
`App.tsx` (dinleyici mount/unmount) · `app.json` · `packages/types/src/push.ts` (yalnız tip, gerekiyorsa) ·
testler.
REFERANS DESEN: 13.7-l `auth/push-tokens.ts` (expo-notifications'ı try/catch içinde, HİÇ fırlatmadan
kullanma disiplini — aynı disiplin burada da: dinleyici kurulamazsa uygulama açılmaya devam eder) ·
`services/notifications/push.ts` yük şekli.
KK: uygulama açıkken bildirim görünür; dokunma → ilgili sohbet; soğuk açılışta bildirimden açılınca →
giriş (gerekirse) → ilgili sohbet; oturum yokken hedef kaybolmaz.
TESTLER: `handler.test.ts` (yük → handler kararı) · `response.test.ts` (yanıt → navigasyon hedefi;
signed-out iken bekletme) · `App.test.tsx` dinleyici mount (mock).
KAPSAM DIŞI: rozet sayısı (badge count) · bildirim kanalları/kategori ayarları · gerçek APNs/FCM (mock
sağlayıcı `.data/push` dosyaya yazar, cihazda gerçek push gelmez — bu, testte simüle edilir; belgele).
TUZAKLAR: `expo-notifications` jest'te modül-seviyesi mock; `getLastNotificationResponseAsync` yalnız
bir kez tüketilir (aynı yanıtı iki kez işleme).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 128.5. 13.7-t [SONNET-XHIGH] Çalıştırılabilirlik: app.config.ts (env ile API/RTM tabanı, doğru port 4000, emülatör notu) + apps/mobile/README.md + kök README mobil bölümü + start scriptleri

**Status:** done  
**Dependencies:** None  

app.config.ts + doğru port (4000) + mobil README + start scriptleri.

**Details:**

NE YAPILACAK: (a) `app.json` → `app.config.ts` (Expo config-as-code): `extra.apiBaseUrl` =
`process.env.SIYAHTUS_API_BASE_URL ?? 'http://localhost:4000/api/v1'`, `extra.rtmBaseUrl` =
`process.env.SIYAHTUS_RTM_BASE_URL ?? 'ws://localhost:4001'` — 3000 portu HATA (kök README:4000);
`config.ts`'in doğrulaması DEĞİŞMEZ (hâlâ mutlak URL ister); (b) `apps/mobile/README.md`: önkoşullar
(Node 24, pnpm 11, Expo Go / dev build), `make dev` sonrası `pnpm --filter @siyahtus/mobile start`,
Android emülatörde `10.0.2.2`, iOS simülatörde `localhost`, fiziksel cihazda LAN IP (`SIYAHTUS_API_BASE_URL`
ile), giriş için seed kimlikleri (`owner@acme.localhost` / `siyahtus-demo-password` — kaynak
`apps/api/prisma/seed.ts:25,328`), push'un mock olduğu (`.data/push`), test/typecheck/lint/build komutları;
(c) kök `README.md`'ye "Mobile app" bölümü (kısa, apps/mobile/README'ye link); (d) `package.json`
scriptleri: `android` (`expo start --android`), `ios` (`expo start --ios`) — `dev` script'i EKLENMEZ
(turbo `dev` Expo'yu başlatıp `make dev`'i bloklamasın; §D113 bulgusu: mobil kasıtlı olarak `dev`
tanımlamıyor — bunu README'de söyle).
NEDEN: `app.json:14` 3000; cihazdan `localhost` erişilemez; `app.config.*` yok; mobil README yok (§D111).
DOSYALAR: `apps/mobile/app.config.ts` (app.json silinir ya da yalnız statik alanlar kalır — Expo ikisini
birleştirir; tek kaynak tercih et) · `apps/mobile/README.md` (yeni) · kök `README.md` · `apps/mobile/
package.json` · `config.test.ts` (varsayılan taban 4000'i doğrulayan +1 test).
REFERANS DESEN: kök README "Quick start" tablosu (portlar) · `apps/mobile/src/config.ts` doğrulama.
KK: `pnpm --filter @siyahtus/mobile start` + Expo Go ile telefon `make dev`'in API'sine bağlanır (README
adımlarıyla); `expo export` hâlâ yeşil; `config.test.ts` varsayılanı doğrular.
KAPSAM DIŞI: EAS/prebuild/store (⛔-süreç §D110) · `dev` script'i.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 128.6. 13.7-u [SONNET-XHIGH] Uygulama varlıkları: icon / adaptive-icon / splash / notification-icon — bağımlılıksız script ile üretilen PNG'ler + app.json bağlama

**Status:** done  
**Dependencies:** None  

İkon/splash/adaptive/notification PNG dosyaları bağımlılıksız script ile üretilir ve bağlanır.

**Details:**

NE YAPILACAK: `apps/mobile/assets/{icon.png (1024²), adaptive-icon.png (1024², ön plan), splash.png,
notification-icon.png (96², beyaz-transparan)}` — kaynak marka rengi `apps/mobile/src/theme/tokens.ts`
(brand-500) ve düz bir "N" harfi/monogram; dış görsel KOPYALANMAZ (PLAN §9/2). PNG'ler
`apps/mobile/scripts/gen-assets.mjs` ile üretilir: sıfır bağımlılık (Node `zlib` deflate + CRC ile
ham PNG yazıcı — küçük, ~80 satır) ki depo yeni devDependency almasın; script + üretilen PNG'ler
BİRLİKTE commit'lenir (script kanıttır, PNG artefakttır); `app.config.ts`'e `icon`, `splash`
(`backgroundColor` token'dan), `android.adaptiveIcon`, `notification.icon` bağlanır (13.7-s plugin
bloğu ikonu bekliyorsa oraya da).
NEDEN: `assets/` yok; build Expo'nun stok görselini taşır (§D111) — "hazır" bir uygulama kendi
ikonuyla gelir.
DOSYALAR: `apps/mobile/assets/*` · `apps/mobile/scripts/gen-assets.mjs` · `app.config.ts` ·
`scripts/gen-assets.test.ts`? (jest testMatch `src/**` — script testi `src/__tests__/assets.test.ts`
olarak: dosyalar var, boyutlar doğru — `node:fs` testte serbest).
REFERANS DESEN: `src/theme/tokens.ts` renkleri; `__tests__/parity.test.ts`'in artefaktı diskten okuma tekniği.
KK: dört PNG diskte, boyutları doğru, `expo export` yeşil, script yeniden koşunca aynı byte'ları üretir
(deterministik).
KAPSAM DIŞI: tasarımcı kalitesinde ikon; mağaza ekran görüntüleri.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 128.7. 13.7-v [OPUS-XHIGH] Dayanıklılık: ErrorBoundary + RTM #open() token yokken yeniden deneme + çevrimdışı/ağ-yok bandı

**Status:** done  
**Dependencies:** 128.1  

ErrorBoundary + RTM token-yok yeniden deneme + ağ-yok bandı.

**Details:**

NE YAPILACAK: (a) `app/ErrorBoundary.tsx` (class component, `componentDidCatch` → log + "Bir şeyler
ters gitti / Yeniden dene" ekranı, `ThemeProvider` altında; `App.tsx` navigator'ı sarar; config hatası
ekranı (`ConfigErrorScreen`) ondan ÖNCE kalır); (b) `rtm/client.ts:177-180`: `getToken()` null iken
`#open()` sessizce dönüyor ve yeniden deneme planlamıyor — yenileme uçuştayken açılan soket
AppState değişene kadar geri gelmez; düzeltme: token yoksa mevcut backoff zamanlayıcısıyla yeniden
dene (jitter'lı; `13.7-f`'nin reconnect testleri emsal), oturum `signed-out` olduysa denemeyi durdur;
(c) ağ-yok bandı: `ConnectionBanner` bugün yalnız RTM durumu; REST hataları için `api/client.ts`'in
`network` kategorisi (13.7-a) tek bir "çevrimdışı" sinyaline bağlanır (küçük `useSyncExternalStore`
deposu — copilotDraft.ts deseni; NetInfo bağımlılığı EKLENMEZ — fetch/soket hatasından türetmek yeter,
gerekçe: yeni native modül `expo export`/Expo Go riskidir) ve tek bir band gösterir ("Ağ yok — son
görülen …"), band kalkınca liste yenilenir.
NEDEN: hata sınırı yok (render hatası beyaz ekran) · RTM latent boşluk · çevrimdışı hâl yalnız metin (§D111).
DOSYALAR: `app/ErrorBoundary.tsx` (+test) · `rtm/client.ts` (+`client.test.ts` +2: token yokken retry;
signed-out iken durur) · `lib/connectivity.ts` (+test) · `features/inbox/ConnectionBanner.tsx` (band
kaynağı genişler) · `App.tsx`.
REFERANS DESEN: `rtm/client.test.ts` reconnect/backoff testleri · `features/copilot/copilotDraft.ts`
(useSyncExternalStore) · `features/inbox/ChatListScreen.tsx` "sessiz sabah ≠ ağ yok" ayrımı.
KK: fırlatan bir ekran uygulamayı düşürmez, "yeniden dene" çalışır; token null → soket kendiliğinden
yeniden denenir; ağ gidip gelince band görünür/kaybolur ve liste yenilenir.
KAPSAM DIŞI: çevrimdışı önbellek/persist (veri saklamak secure-store dışı depoyu gerektirir — eslint
kuralı bilerek kapalı, açma).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 128.8. 13.7-w [OPUS-XHIGH] Uçtan uca "soğuk açılış yolculuğu" testi (giriş → Inbox → sohbet → yanıt → çıkış) + parite matrisi AUTH satırları + bayat yorum/test adları + PLAN damgası ◐→✅

**Status:** done  
**Dependencies:** 128.1, 128.2, 128.3, 128.4, 128.5, 128.6, 128.7  

Soğuk açılış yolculuğu testi + parite AUTH satırları + PLAN damgası ◐→✅.

**Details:**

NE YAPILACAK: (a) `apps/mobile/src/__tests__/journey.test.tsx`: GERÇEK `App` (mock'lanan yalnız
`expo-*` native modüller + `fetch`/WebSocket) — soğuk açılış → giriş ekranı → e-posta/parola →
(çok workspace) seçim → Inbox listesi (sahte `/chats`) → sohbet aç (sahte events) → yanıt gönder
(iyimser balon → echo) → Settings → Sign out → giriş ekranı. Bu, mobilin Playwright'a girmemesinin
(§C-A28) karşılığıdır: bir kullanıcının yürüdüğü yolun tamamını TEK testte kanıtlar; 13.7-k'nın parite
matrisi "ekran var" derken bu "ekrana ULAŞILIYOR" der. (b) `parity.test.ts`: AUTH yüzeyi
(SignIn/WorkspacePicker/Account) `SUPPORTING` ya da yeni bir `SHELL` sınıfına; `/auth/login`,
`/auth/authorize`, `/auth/token`, `/auth/me`? sınıflı; iki yönlü eşitlik korunur;
`SCOPE_BOUNDARIES` (mağaza) aynen; sayım güncellenir. (c) Bayatlar: `app/navigation.ts:5` "her
stack'te tek placeholder ekran" yorumu · `App.test.tsx:136` "each showing its own placeholder"
adı → gerçek. (d) PLAN.md: satır 572 `◐ → K13.7` → `✅ → K13.7`; K13.7 üst kutusu "GÜNCEL DURUM: ✅"
(giriş yolu §D111 kapandı — tm 128.1–128.8, sayılarla) — kutu SİLİNMEZ, güncellenir; §1 faz tablosu
Faz-3 satırının sayacı `6 ✅ + 0 ◐`; §2 matrisi `Mobil app` satırı; §6 kapsam tablosu 13.7 satırı;
§6.2 dilim 5 hücresi; §F.00 13.7 paragrafına "§D111 kapandı" cümlesi; §6A tablosunda 13.7 kalemi ✅.
Faz-4'ün ilk ✅ kalemi bu olur.
NEDEN: 12+3 alt-görev "kendi payını" teslim etti, kimse zinciri baştan sona yürümedi (§D111'in dersi:
istemci yüzeyinin ✅'i "soğuk açılış yolculuğu" testi ister — bu alt-görev o kuralı bu kaleme uygular).
DOSYALAR: `__tests__/journey.test.tsx` · `__tests__/parity.test.ts` · `lib/contract.test.ts`
(MOBILE_ENDPOINTS beklentisi) · `app/navigation.ts` · `App.test.tsx` · PLAN.md.
REFERANS DESEN: `App.test.tsx`'in fetch mock kurulumu (13.7-h/-j genişletmişti) · `ChatScreen.test.tsx`
composer akışı · `parity.test.ts:184-330`.
KK: journey testi yeşil ve ≥ 8 adım assert eder; parity matrisi iki yönlü eşit; PLAN damgası ✅.
TUZAKLAR: RNTL zaman aşımı — jest.config `testTimeout`'u tm 129 belirler; bu test 20 s'yi aşmamalı
(fake timers KULLANMA — soket/backoff gerçek zamanlayıcı ister; `waitFor` `timeout` ver).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-13.7 (mobil)**. Gereksinim satırı: `grep -n '| 13\.7 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K13.7' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
