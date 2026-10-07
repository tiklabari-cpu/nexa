# ADR — Panelde oturum içi access token yenileme ve sekmeler arası refresh token kilidi

- **Görev:** tm 259.1 (SESSION-REFRESH-MIDSESSION) · PLAN.md §D208 · bulgu K1 (`docs/ux-audit-2026-10-07.md`)
- **Tarih:** 2026-10-07
- **Durum:** Kabul edildi ve uygulandı (bu görevde). Geçici hata dalı (429 / 5xx / ağ) bilinçli olarak dar bırakıldı; tm 259.2 genişletti — bkz. §5.
- **Yöntem:** Kod HEAD `2050db2b` üzerinde okundu; davranış vitest (sahte sunucu + iki sekme), API entegrasyon testi ve Playwright (ana süit + `ACCESS_TOKEN_TTL=60` ile özel yığın) ile ölçüldü.
- **PRD:** NFR-S2 (token yönetimi: TTL ≤ 1 sa, refresh, iptal). Damga değişmedi; kanıt `#### KS1-S5`.

## 0. Karar — tek tabloda

| #   | Konu                 | Karar                                                                                                                                                                                                         |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | Proaktif yenileme    | Token ömrünün kalanının %70–80'inde (`RENEW_AT` 0,8 − rastgele ≤ 0,1) `setTimeout`. `visibilitychange` → görünür olunca duvar saatine bakılır, vakit geçmişse hemen yenilenir.                                |
| K2  | Reaktif yenileme     | `ApiClient` yalnız **`details.oauth_error: 'invalid_token'`** taşıyan 401'de bir kez yeniler ve isteği bir kez tekrarlar. Aynı anda gelen 401'ler tek yenilemeyi bekler. Tekrar da reddedilirse oturum biter. |
| K3  | Sunucu işareti       | Auth eklentisi taşıyıcı token'ı reddettiğinde 401 gövdesine `details.oauth_error: 'invalid_token'` koyar (RFC 6750 §3.1). Süresi dolmuş / iptal / hiç verilmemiş ayrımı yine yalnız logda.                    |
| K4  | Sekmeler arası       | **Seçenek (a):** refresh token'ı harcayan her çağrı Web Lock `siyahtus.refresh` altında; kazanan sekme yeni access token'ı `BroadcastChannel('siyahtus.session')` ile yayınlar, kardeşler benimser.           |
| K5  | Reddedilen yenileme  | Sunucu yenilemeyi açıkça reddederse (401 `invalid_grant` / `invalid_client`, kısaca yeniden denenemeyen her cevap) saklı token silinir, oturum biter, giriş sayfası "Oturumunuz sona erdi" der (en + tr).     |
| K6  | Gerçek zamanlı soket | Yenilemede soket **yeniden kurulmaz**; yeniden bağlanırken güncel token okunur, `login` token yüzünden reddedilirse bir kez yenileyip yeniden bağlanır.                                                       |

## 1. Bugünkü kod (HEAD `2050db2b`, okundu)

- **Yenileme yalnız sayfa açılışında.** `restore()` tek `/auth/token` (`refresh_token`) çağrısı; `App.tsx:51` `status === 'unknown'` iken çağırıyor. `ApiClient`'ta 401 işleyicisi yok, `useApiClient` render anındaki token'ı yakalıyor (`auth-store.ts:592-596`).
- **Refresh token tek kullanımlık, tolerans penceresi yok.** `oauth-service.ts:424-440`: dönmüş (`replaced_by_id`) ya da iptal edilmiş bir token yeniden gelirse `auth_revoke_refresh_family` çağrılır. O fonksiyon aileye ait **access token'ları da** iptal eder (`migrations/20260722151255_auth_and_tenancy/migration.sql:572-589`) — başarılı yenilemenin az önce verdiği token dahil.
- **401 aşırı yüklü.** Kimliği doğrulanmış rotalarda yanlış parola (`routes/auth.ts:1186`, `:1532`) ve yanlış 2FA kodu (`two-factor-service.ts:425` `badCode`) da 401 `authentication` döner. Gövdeye bakmadan "401 → yenile → tekrarla → yine 401 → çıkış" kuralı, "Bu siz misiniz" diyaloğuna yanlış parola yazanı oturumdan atardı.
- **Soket token'ı yalnız `login`'de doğrular.** `apps/rtm/src/dispatcher.ts:99-129`; bağlantı ömrü boyunca yeniden bakılmıyor. Panelde `useRealtime` etkisi `accessToken`'a bağlıydı (`useInbox.ts:870-923`): her token değişimi soketi kapatıp yenisini açar, yeni istemcinin imleci yoktur.
- **Oturum tavanı access token sayar.** `token-service.ts:456-505` sahip başına canlı `oauth` token'larını sayar (varsayılan 25, lisans `max_concurrent_sessions` ile daha az).

## 2. Kararlar — gerekçe

### 2.1 K1 — ne zaman

%80, task tanımının önerisi; üst sınır 3600 sn iken 48. dakika. %10'luk rastgele öne çekme kardeş sekmeler içindir: (a) seçeneğinde sekmeler aynı token'ı, dolayısıyla aynı bitiş anını taşır; yayılma olmasa hepsi aynı anda uyanıp kilit kuyruğuna girer. Yayılmayla ilk uyanan yeniler, yayınlar; diğerleri yeni token'ı benimseyip zamanlayıcılarını yeniden kurar ve hiçbir şey harcamaz.

Uyku: kapak kapalıyken zamanlayıcı çalışmaz, bazı tarayıcılar kapalı saatleri bekleyen zamanlayıcıya saymaz bile. Duvar saati ise ilerler; `visibilitychange` o yüzden `Date.now() >= renewDueAt` kontrolü yapar. Bu da kaçarsa K2 güvenlik ağıdır.

Zamanlayıcı React etkisinde değil, store'da: StrictMode etkileri iki kez başlatır, bir etkinin ömrü bileşeninkidir, oturumunki değil.

### 2.2 K2 + K3 — hangi 401'de

Yenileme yalnız taşıyıcının kendisi reddedildiğinde anlamlıdır. Mobil istemci (`apps/mobile/src/api/client.ts:142-144`) her 401 `authentication`'da yeniliyor; bu panelde yanlış parolayı iki kez göndermek ve ikinci retle oturumu bitirmek demekti. Sunucuda tek ayrım noktası auth eklentisinin `resolvePrincipal` reddi (`plugins/auth.ts:211-223`); orası artık `ApiError.invalidToken()` atar. RFC 6750'nin adı ve depodaki `details.oauth_error` sözleşmesi (`oauth-service.ts:105-107`) korunur; sızıntı yok, çünkü süresi dolmuş, iptal edilmiş ve hiç verilmemiş token'ın gövdesi bayt bayt aynı (entegrasyon testi `request_id` dışındaki her alanı karşılaştırır). Kimlik bilgisi hiç gönderilmeyen 401 işaretsiz kalır (RFC 6750 §3.1).

Tekrar güvenli: işaretli 401 hiçbir handler çalışmadan eklentide döner, tekrar isteğin ilk gerçek denemesidir — POST dahil. Yeni token'la tekrar da işaretli 401 alırsa (üyelik askıya alındı, çalışma alanı iptal) bu bayatlık değildir; `onSessionRejected` oturumu bitirir, döngü olmaz.

### 2.3 K4 — iki sekme, tek token

Sekmeler `localStorage`'daki tek refresh token'ı paylaşır; her sekmenin kendi modül kopyası vardır, sekme içi single-flight birbirini görmez. İkisi aynı token'ı aynı anda harcarsa sunucu bunu çalıntı sayar, aileyi iptal eder, iki sekme birden düşer. Kilit şart; soru, öbür sekmenin yeni access token'ı nasıl alacağıydı.

- **(b) her sekme kilit altında kendi yenilemesini yapar:** basit ama N sekme → N döndürme ve N access token. `max_concurrent_sessions` küçük bir lisansta sekmeler birbirinin token'ını budar (`#pruneOldest`), her 401 öbürünü düşüren bir yenilemeye dönüşür.
- **(a) kazanan yayınlar, kardeşler benimser — seçildi.** Tarayıcı başına dönem başına bir döndürme, bütün sekmeler tek access token → oturum tavanında tek yer. Benimseme yalnız aynı `account_id` + `license_id` ve daha geç bitiş anı için. Güvenlik: kanal aynı köken + aynı tarayıcı profili; mesajı okuyabilen bir betik `localStorage`'daki refresh token'ı da okur, o daha değerlidir — yeni açık yok.
- Kilit sırası mesajdan önce gelebilir (ikisi de ayrı görev). O zaman ikinci sekme bir kez daha döndürür — güvenli, yalnız gereksiz. Kilit altında yeniden kontrol (`stale` token artık güncel değilse harcama yok) ve %10 yayılma bunu seyrek tutar.
- Web Locks yoksa (güvensiz köken, 2022 öncesi tarayıcı) sekmeler koordine edilmez; sekme kendi içinde yine tek uçuşta. Pilot HTTPS arkasında, e2e `localhost` üzerinde: ikisi de güvenli bağlam.

### 2.4 Kimlik koruması

Tarayıcı tek refresh token tutar. B sekmesi başka biri olarak giriş yaparsa, A'nın sonraki yenilemesi B'nin token'ını harcar. Bu, B'nin zincirini sürdürür (halef yazılır), ama A'nın o token'la iş yapması başkasının çalışma alanına yazmak olurdu. Cevaptaki `account_id` / `license_id` A'nın ajanıyla eşleşmezse A'nın oturumu biter. Bir yenileme uçarken oturum bittiyse (`generation`), sonucu ne kabul edilir ne saklanır — çıkışın sildiği token geri gelmez.

### 2.5 K6 — soket

Ağ geçidi token'a yalnız `login`'de baktığı için açık soket yenilemeden sonra da geçerli. Etki artık `accessToken`'a değil "oturum var mı"ya bağlı; `getToken` her bağlantıda store'dan okur. Uykudan dönen sayfanın düşmüş soketi bayat token'la yeniden bağlanır: `login` `authentication` ile reddedilirse bir kez `refreshSession(stale)`, sonra yeni soket. Yeni token da reddedilirse eskisi gibi `offline` (döngü yok); yenilemenin kendisi geçici hatayla düşerse olağan geri çekilmeli yeniden bağlanma. Değiştirilen soketin `close` olayı artık yeni bağlantının zamanlayıcılarını silmez.

## 3. Kapsam dışı ve bilinen sınırlar

- **Geçici hata (tm 259.2).** `refreshSession` 429 / 5xx / ağ hatasında token'a ve oturuma dokunmadan hatayı fırlatır; proaktif yol sessizce bırakır, sonraki işaretli 401 yeniden dener. Sayfa açılışındaki `restore` hâlâ her hatada token'ı siler — 259.2'nin konusu; bu artık **bütün sekmeleri** etkiler (paylaşılan token), not edildi. → 259.2'de kapandı, §5.
- **Boşta kalma süresi politikası.** `sessionIdleTimeoutSeconds` yalnız access token'ı iptal ediyor (`token-service.ts:237-263`), refresh ailesi yaşıyor. Panel bunu artık sayfa yenilemeden aşıyor (mobil 13.7-b'den beri aynı; panel öncesinde sayfa yenilenince aşıyordu). Politikanın oturumu gerçekten bitirmesi için sunucu boşta kalma anında aileyi de iptal etmeli ve yenilemede aynı pencereyi uygulamalı — ayrı görev.
- **Başarısız kimlik doğrulama kovası.** Süresi dolmuş token'la giden her istek IP başına `RATE_LIMIT_AUTH_FAILURES_PER_MIN` (60) kovasına yazılır; kova dolunca o IP'den gelen **her** token reddedilir. Proaktif yenileme bunu seyrekleştirir; bir ofisin bütün panelleri uzun bir kesintiden aynı anda dönerse kova dolabilir — tm 259.3'e not.
- **Kilit sahibinin asılı kalması.** Web Lock sekme kapanınca ya da çökünce bırakılır; asılı bir `/auth/token` isteği yalnız tarayıcının ağ zaman aşımıyla biter. O süre içinde diğer sekmeler bekler, mevcut access token'larıyla çalışmaya devam eder.
- **Mobil.** Reaktif yenilemesi var (13.7-b), proaktif yok; her 401 `authentication`'da yeniliyor (yanlış parola dahil) — işarete geçmesi ayrı görev.

## 4. Kanıt

- vitest: `apps/web/src/lib/api-client.test.ts` (yalnız işaretli 401'de bir yenileme, POST gövdesiyle tekrar, yanlış parolada yenileme yok, ikinci retle oturum bitişi, ek/dışa aktarma), `auth-store.test.ts` (tek yenileme + tekrar, eşzamanlı beş istek tek yenileme, `invalid_grant` → `sessionEnded`, %80 / %70 zamanlayıcı, uyku sonrası `visibilitychange`, iki sekme kilit + benimseme + kimlik), `realtime.test.ts` (reddedilen `login` → bir yenileme), `AppShell.realtime.test.tsx` (yenilemede soket aynı), `SignInPage.test.tsx` (en + tr bildirim).
- API: `test/integration/auth.test.ts` (üç ret türü aynı işaretli gövde; kimlik bilgisiz 401 işaretsiz), `two-factor-enrollment.test.ts` (yanlış parola işaretsiz).
- Playwright: `session-restore.spec.ts` (iki sekme aynı anda yeniden yükleme ve aynı anda vadesi gelen yenileme — sıralanmış token istekleriyle; reddedilen yenileme → bildirimli giriş sayfası), `session-refresh.spec.ts` (`pnpm test:e2e:session`, `ACCESS_TOKEN_TTL=60`: 75 sn sonra 401 yok; uykudan dönen sayfa ilk ret sonrası toparlanır, soket yeniden `Live`).

## 5. tm 259.2 — geçici hata oturumu düşürmez (bulgu Y1)

| #   | Konu                      | Karar                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K7  | Oturumu düşüren tek cevap | `isRefusal`: 401 (token uç noktasının `invalid_grant` / `invalid_client` reddi, ya da az önce verilmiş token'la `/auth/me`) veya RFC 6749'un 400 `invalid_grant` / `invalid_client`'ı. Saklı token yalnız burada silinir.                                                                                                   |
| K8  | Geçici hata               | Geri kalan her şey (429, 5xx, ağ, proxy hata sayfası, 400 `validation`): token saklanır. Bekleme: `Retry-After` (en çok 60 sn), yoksa 1, 2, 4, 8, 16, 30, 30, 30 sn — dokuz deneme, ~2 dk.                                                                                                                                  |
| K9  | `reconnecting` durumu     | Elde çalışan access token yokken (sayfa açılışı; reddedilen ya da süresi biten token) `status: 'reconnecting'`, `reconnect: waiting / trying / paused`. Denemeler bitince token yine silinmez; "Şimdi dene" yeni bir tur başlatır, "Çıkış yap" oturumu kapatır.                                                             |
| K10 | Oturum içi                | Proaktif yenileme geçici hataya düşerse panel eldeki token'la çalışmaya devam eder ve aynı takvimle, en geç token'ın bittiği anda yeniden dener; o deneme de düşerse `reconnecting`. Reddedilen bir istek yenilemesi geçici hataya düşerse doğrudan `reconnecting`; istek bekler, oturum dönünce yeni token'la tekrarlanır. |
| K11 | Ekran                     | Sayfa açılışında tam sayfa `ReconnectingPage`; oturum içinde aynı ekran kabuğun üstünde, kabuk takılı ve `inert` kalır (composer taslağı bileşen durumunda yaşar, iki dakikalık kesinti onu silmemeli). en + tr.                                                                                                            |

**Aynı token'la yeniden denemek neden güvenli (kodla doğrulandı, HEAD `7e00e701`).** 429: hız sınırı `onRequest` kancasında, handler'dan önce döner (`plugins/rate-limit.ts` `meter` → `ApiError.tooManyRequests`, her 429'da `Retry-After`); token hiç okunmaz. 5xx: döndürme `oauth-service.ts` `#issueGrant` içinde — halef refresh token'ın yaratılması ile eskisinin `replacedById` + `revokedAt` işareti **aynı** `withTenant` transaction'ında; bu transaction commit etmeden düşen her hata eski token'ı kullanılabilir bırakır. Tek dar pencere: commit olmuş ama cevap yolda kaybolmuş (proxy 502/504). O zaman aynı token'la ikinci deneme yeniden kullanım sayılır, aile iptal edilir, sunucu 401 `invalid_grant` döner ve oturum K7 ile biter — döngü yok, sonuç 259.2 öncesiyle aynı. Ayrıca access token `#tokens.issue` ile transaction'dan **önce** basılır: düşen bir döndürme sahipsiz bir access token bırakabilir (TTL sonunda ölür, o süre oturum tavanında bir yer tutar).

**Bilinen sınırlar.** Proaktif yol denemeleri saymaz, token'ın ömrüyle sınırlı (kalan 12–18 dk'da en çok ~40 istek); `reconnecting` turları dokuz denemeyle sınırlı. Aynı ofisin bütün panelleri aynı anda `reconnecting`'e düşerse istekleri `rl:anon` kovasında toplanır — 259.3 kovayı ayırınca yük azalır. Mobil kapsam dışı.
