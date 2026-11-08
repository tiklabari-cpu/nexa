# Runbook: root panel (platform-admin) operasyonları (tm 389.21)

Bu belge, SiyahTuş ekibinin root panelde (`admin.<alan>`, `apps/admin` + `platform-api`) yapacağı her
operasyonun adım listesidir. Her bölüm aynı beş soruyu yanıtlar: **panelde nerede**, **hangi rol**,
**TOTP gerekli mi**, **hangi audit eylemi**, **nasıl geri alınır**. Eski `psql` yolları silinmedi; yalnız
panelin kurulu olmadığı ya da kilitlendiği durumlar için [Ek A](#ek-a--acil-durum-psql-ve-cli-yolları)'ya
taşındı. Gereksinimler: `docs/platform-admin/requirements.md`; tasarım: `docs/platform-admin/design.md`;
kararlar: [ADR-16](../adr/platform-admin-panel.md).

**Bu belgedeki her iş panelden yapılır** (tm 391'den beri): operatör dizini (Yöneticiler: davet, rol, devre
dışı/etkin, operatör 2FA sıfırlama, operatör oturumu iptali), **Denetim** sayfası (liste, zincir doğrulama,
imzalı dışa aktarma) ve üst şeritteki **Hesabım** menüsü (kurtarma kodlarını yenile, oturumlarım). API yolu
(§0.4) otomasyon ve panelin açılamadığı durumlar içindir.

## 0. Ortak kurallar

### 0.1 Roller

Dört operatör rolü vardır (`packages/types/src/platform.ts` `PLATFORM_PERMISSIONS`, tek matris). Bu belgede
harfle anılır:

| Rol          | Kısa | Yapar                                                                                                             |
| ------------ | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `superadmin` | S    | her şey: askı, silme, devir, ayarlar, AI ayarları, operatör yönetimi, `full` impersonation                        |
| `support`    | D    | not, deneme uzatma, doğrulama e-postası, hesap oturum/anahtar iptali, "şimdi çalıştır", salt-okunur impersonation |
| `billing`    | B    | aktive et, plan, override, kota, ödeme kuyrukları, kredi/iade, elle abonelik, ödeme ayarları                      |
| `readonly`   | R    | okur (kiracı içeriği hiçbir rolde yoktur), hiçbir mutasyon yapmaz                                                 |

`billing` hesapları, ayarları, AI'yı, operasyonu, denetimi ve güvenliği **okuyamaz** (yalnız çalışma alanı,
faturalama, kullanım, panel). Menü, rolün açabildiği sayfaları gösterir.

### 0.2 Gerekçe, audit, çift kayıt

Her mutasyon gerekçe ister: panelde bir "Gerekçe" penceresi (3–500 karakter); API'de gövdede `reason`
yoksa istek işlenmeden 400 `platform_reason_required` döner. Gerekçe `platform_audit_log` zincirine yazılır
([`platform-audit.md`](platform-audit.md)). Kiracıya dokunan eylem **ayrıca** kiracının kendi `audit_log`'una
`SiyahTuş support` aktörüyle (`actor_type='platform'`, `platform.<modül>_<fiil>`) aynı işlemde yazılır;
ikisinden biri yazılamazsa eylem olmaz. Kiracının kaydı operatörün gerekçesini taşımaz.

### 0.3 TOTP ve "yeni kod" kuralı

Her oturum zorunlu TOTP'lidir (parola → kod). Aşağıda "TOTP gerekli" denen yıkıcı eylemler ayrıca **son 5
dakika içinde** girilmiş bir kod ister (`recentTotp`); süre dolduysa 403 döner, panel kodu yeniden sorar,
API'de `POST /auth/totp/reverify`. Oturum mutlak 8 saat, boşta 15 dakika. Giriş denemeleri IP başına 15
dakikada 10 başarısızla kilitlenir (doğru parola dahil, pencere dolana dek).

### 0.4 API ile çalışmak (otomasyon ve panelin kapalı olduğu durumlar)

```sh
BASE=https://admin.example.com/platform/v1
read -rsp 'parola: ' PW; echo
# 1) parola aşaması — dönen token YALNIZ authenticator kodunu göstermeye yarar
T1=$(curl -sS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"ops@example.com\",\"password\":\"$PW\"}" | jq -r .token)
# 2) kod → aktif oturum; yanıt YENİ bir token taşır (T1 artık işe yaramaz)
read -rp 'kod: ' CODE
TOKEN=$(curl -sS -X POST "$BASE/auth/totp/verify" -H "Authorization: Bearer $T1" \
  -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" | jq -r .token)
# kurtarma koduyla: -d '{"recovery_code":"…"}'
# 3) "TOTP gerekli" eylemden önce taze kod:
curl -sS -X POST "$BASE/auth/totp/reverify" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"code\":\"$CODE2\"}"
```

`Authorization` başlığı hiçbir log'a yazılmaz; parola komut satırına yazılmasın diye `read -s` kullanın. Her
mutasyon gövdesinde `"reason": "…"` bulunur.

### 0.5 Geri alma kuralı

Eylem zaten istenen durumdaysa `unchanged: true` döner ve hiçbir şey yazılmaz; başlangıç durumu uygun değilse
409 `platform_workspace_state` / `platform_payment_state`. Silme dışında hiçbir eylem veri yok etmez; ters
eylemler her bölümde yazılıdır. Audit kayıtları geri alınmaz — ters eylem yeni kayıttır.

### 0.6 Erişim

`admin.<alan>` yalnız Cloudflare Access + `PLATFORM_IP_ALLOWLIST` + parola + TOTP arkasından açılır
([production-checklist §9 Back office](../production-checklist.md)).

## 1. İlk operatörü oluşturma (bootstrap) — FR-ADMIN-03

- **Nerede:** sunucu kabuğu (panel yok — henüz kimse yok). **Rol / TOTP:** yok; kabuk erişimi yetkidir.
- **Audit:** `admin.bootstrapped` — zincirin ilk kaydı.
- **Adımlar** (komut aşağıdaki kutudadır):
  1. `.env`: `PLATFORM_SETTINGS_KEY`, `ADMIN_APP_URL`, `SIYAHTUS_PLATFORM_DB_PASSWORD`
     (production-checklist §9 Back office); yığın `--profile platform` ile ayakta.
  2. Aşağıdaki komutu çalıştırın; parola yankısız sorulur ya da kabukta `PLATFORM_BOOTSTRAP_PASSWORD`
     verilir (argümanla asla).
  3. `https://admin.<alan>` → e-posta + parola → panel authenticator'ı kaydettirir; 10 kurtarma kodu **bir
     kez** gösterilir, güvenli yere yazılır.
- **Geri alma:** komut herhangi bir operatör (devre dışı olan dahil) varsa reddeder; ikinci kapı değildir.
  Yanlış e-postayla oluşturulduysa Ek A.1.

```sh
docker compose -f docker-compose.pilot.yml --profile platform exec platform-api \
  node dist/src/services/platform/bootstrap-admin-run.js --email ops@example.com
# make olan makinede: make platform-bootstrap-admin EMAIL=ops@example.com
# geliştirme: pnpm --filter @siyahtus/api platform:bootstrap-admin --email ops@example.com
```

## 2. Operatör daveti ve operatör yönetimi — FR-ADMIN-04

- **Panelde:** Yöneticiler → **Operatörler** tablosu (e-posta, rol, durum, authenticator, açık oturum, son
  görülme) ve **Bekleyen davetler**; her operatör satırının **İşlemler** menüsü rolün izin verdiğini ve satırın
  durumunun uygun bulduğunu sunar (devre dışı operatörde yalnız Rolü değiştir / Etkinleştir). Her işlem gerekçe
  sorar; "TOTP gerekli" olanlar taze kod alanını baştan açar. Operatör **silinemez** — menüde silme yoktur.
- **Rol:** liste S/D/R; davet, rol, devre dışı/etkin, 2FA sıfırlama, oturum iptali yalnız **S**.
- **TOTP:** davet, rol, devre dışı/etkin ve 2FA sıfırlama için **gerekli** (§0.3); oturum iptali için değil.
- **Audit:** `admin.invited`, `admin.invite_revoked`, `admin.invite_accepted`, `admin.role_changed`,
  `admin.disabled`, `admin.enabled`, `admin.two_factor_reset`, `admin.sessions_revoked`.
- **Ele geçirilmiş operatör (tm 430):** **Devre dışı bırak** operatörün açık impersonation oturumlarını da
  aynı işlemde bitirir (`end_reason: operator_disabled`) ve takas edilen kiracı token'larını iptal eder; açık
  soketleri 4401 ile kapanır. **Oturumları iptal et** aynısını yapar (`operator_sessions_revoked`, operatör
  yeniden girebilir). **Rol değiştir** yalnız yeni rolün tutamayacağı oturumları bitirir (S → D: `full` biter,
  salt-okunur kalır; D/S → B/R: hepsi; `operator_role_changed`). Her biten oturum için platform zincirine
  gerekçeyle, kiracının audit'ine gerekçesiz `impersonation.ended` yazılır. Panel dışından (psql) devre dışı
  bırakılan operatörün token'ları da `auth_resolve_token` tarafından reddedilir; oturum satırını kapatmak
  için panelden yeniden **Devre dışı bırak**.

| İş (panelde aynı ad)     | API karşılığı (`$BASE`, `Authorization: Bearer $TOKEN`, hepsi `reason` ile)                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Operatör listesi         | `GET /admins` · `GET /admins/{adminId}` · bekleyen davetler `/admins/invites`                   |
| Davet                    | `POST /admins/invites` `{email, role}` — e-postayla gider, **72 saat** geçerli, tek kullanımlık |
| Daveti geri çek          | `POST /admins/invites/{inviteId}/revoke`                                                        |
| Rol değiştir             | `POST /admins/{adminId}/role` `{role}`                                                          |
| Devre dışı / etkinleştir | `POST /admins/{adminId}/disable` · `…/enable`                                                   |
| Oturumları iptal et      | `POST /admins/{adminId}/revoke-sessions`                                                        |

**Davet adımları (panel):** **Operatör davet et** → e-posta + rol → gerekçe + taze kod → **Daveti gönder**.
E-posta gitmezse panel kabul bağlantısını **yalnız o an** gösterir; kopyalayıp başka kanaldan iletin (bağlantı
kimlik bilgisidir). Bekleyen davet **Geri çek** ile iptal edilir (kod gerekmez).
**Doğrulayıcıyı sıfırla** menü öğesi, "kimliğini başka bir kanaldan doğruladım" kutusu işaretlenmeden
onaylanamaz (§3.4).
Davetli e-postadaki bağlantıdan parola belirler (`/invite`) ve ilk girişte authenticator kaydeder.
Devre dışı bırakılan operatör **silinmez** (audit atfı bozulmasın); oturumları biter. **Son aktif `superadmin`
devre dışı bırakılamaz ya da rolü düşürülemez** (409 `platform_last_superadmin`; panel "önce başka bir
operatörü süper yönetici yapın" der; sayım kilit altındadır).
**Geri alma:** devre dışı → `enable`; rol → yeniden `role`; davet → yeni davet.

## 3. Kayıp TOTP / kurtarma kodu — FR-ADMIN-01/04

Operatör authenticator'ını kaybetti.

1. **Kurtarma kodu elinde:** giriş ekranındaki kurtarma kodu alanına girilir (API: `{"recovery_code":"…"}`);
   her kod tek kullanımlıktır, yanıt `recovery_codes_remaining` döner. Girişten sonra yeni sayfa üretin:
   panelde üst şeritte **Hesabım → Kurtarma kodlarını yenile** (taze kod ister; yeni liste bir kez gösterilir,
   indirilebilir ve "Kodları kaydettim" işaretlenene dek panel açılmaz; eski kodlar çalışmaz). API karşılığı
   `POST $BASE/auth/recovery/regenerate`; audit `admin.recovery_codes_regenerated`. Kodlar azalınca beklemeyin.
2. **Kurtarma kodu da yok, başka bir `superadmin` var:** o kişi Yöneticiler → operatör satırı → **İşlemler → Doğrulayıcıyı sıfırla**
   yapar (API: `POST /admins/{adminId}/reset-two-factor`; S, TOTP gerekli, gerekçe; audit `admin.two_factor_reset`). Sıfırlama authenticator'ı, kurtarma
   sayfasını ve operatörün tüm oturumlarını siler; sonraki giriş yalnız yeni authenticator kaydettirebilir.
3. **Tek superadmin ve ikisi de yok:** API kendi 2FA'sını sıfırlatmaz; sunucu kabuğundan Ek A.2.
4. **Kimlik doğrulaması şart:** sıfırlamayı isteyenin gerçekten o kişi olduğunu (görüntülü görüşme, bilinen
   ikinci kanal) doğrulayın; gerekçeye yöntemi yazın. Panel bu yüzden **"kimliğini doğruladım"** kutusu
   işaretlenmeden **Doğrulayıcıyı sıfırla** düğmesini açmaz.
5. **Açık oturumlarınızı görmek / kapatmak:** **Hesabım → Oturumlarım** (başlangıç, son kullanım, adres,
   tarayıcı; geçerli oturum işaretli) ve **Diğer tüm oturumları kapat** (API: `GET/DELETE $BASE/auth/sessions`;
   audit `admin.other_sessions_ended`). Cihaz kaybında önce bunu, sonra parolayı değiştirin.

## 4. Askıya alma — FR-ADMIN-09, FR-ADMIN-11

### 4.1 Çalışma alanını askıya alma

- **Panelde:** Çalışma alanları → alan → **Eylemler** → **Askıya al** / **Askıyı kaldır**.
- **Rol:** **S**. **TOTP:** gerekli. **Audit:** `workspace.suspended`, `workspace.unsuspended`
  (+ kiracıda `platform.workspace_suspended` …).
- **Etki:** lisans `suspended`; üyeler 403 `workspace_suspended`, müşteri token'ı basılmaz, RTM bağlantısı
  reddedilir. Veri silinmez.
- **Adımlar:** doğru alanda olduğunuzu doğrulayın → gerekçe (neden, bilet/şikâyet no) → kod.
- **Geri alma:** **Askıyı kaldır** (aynı rol/kod) — alan **askıdan önceki durumuna** döner
  (`suspended_from_status`); üyeler ve RTM anında geri gelir. Planlı bir silme varsa önce silme iptal
  edilmelidir (409 `purge_scheduled`, §6.1).
- **Hafif alternatifler (S, TOTP gerekmez):** yalnız yazmayı kesmek için **Salt okunur yap**
  (`workspace.read_only_set`) / **Etkin yap** (`workspace.active_set`).

### 4.2 Hesap eylemleri (kişi düzeyi)

- **Panelde:** Hesaplar → hesap → eylem listesi. Rol: **D/S**: doğrulama e-postasını yeniden gönder
  (`account.verification_resent`), parola sıfırlamayı zorla (`account.password_reset_forced`),
  her yerden çıkış yaptır (`account.sessions_revoked`), tüm anahtarları iptal et (`account.tokens_revoked`);
  **S**: hesabı askıya al / askıyı kaldır (`account.suspended` / `account.unsuspended`), iki adımlı
  doğrulamayı sıfırla (TOTP gerekli, `account.two_factor_reset`), veri dışa aktar (`account.exported`, JSON).
- **Askı etkisi:** hesabın **her** çalışma alanındaki oturumları biter, yeni giriş reddedilir (kiracı +
  RTM); çalışma alanı etkilenmez. **Geri alma:** **Askıyı kaldır**.
- Kimliği doğrulanmamış kişi için 2FA sıfırlamayın (§3.4'teki ilke).

## 5. Zorlamalı sahiplik devri — FR-ADMIN-09

Kurucu erişimini kaybetti (ayrıldı, hesabı çalındı) ve alanı başka biri yönetmeli.

> **Önce kiracının kendi yolu (RL-05 · tm 328).** Kurucuya ulaşılabiliyorsa devri kendisi yapar:
> Ayarlar › Şirket › Tehlikeli bölge → şifre (+2FA) → hedef üye 72 saat içinde e-postadaki bağlantıyla,
> kendi oturumuyla kabul eder (`POST /ownership-transfers`, `…/{id}/accept`; audit
> `ownership.transfer_requested|accepted|cancelled|expired`). Bu bölümdeki zorlamalı devir **yalnız**
> Kurucuya ulaşılamadığında, yukarıdaki kimlik doğrulamalı manuel süreçle yapılır (RL-05-S3) —
> kiracı panelinde bunun bir yolu yoktur. Zorlamalı devirden önce bekleyen bir kiracı devri varsa
> kabul edilemez: kabul anında Kurucunun değiştiği görülür, devir `cancelled` olur
> (`cause: owner_changed`) ve hedefe 409 `owner_changed` döner.

- **Panelde:** Çalışma alanları → alan → Eylemler → **Sahipliği devret**.
- **Rol:** **S**. **TOTP:** gerekli. **Audit:** `workspace.ownership_transferred`
  (+ kiracıda `platform.workspace_ownership_transferred`).
- **Ön koşul (panelde işaretlenen kontrol listesi):** talep edenin kimliği kurumsal kanaldan (alan adı
  e-postası, vergi no, imza) doğrulandı; mevcut Kurucuya ulaşılamıyor ya da devri onaylıyor; hedef alanın
  mevcut, **askıda olmayan** üyesi (askıdaki üye Kurucu yapılamaz).
- **Etki:** hedef **Kurucu** olur, eski Kurucu **Yönetici**ye düşer (tek-Kurucu değişmezi korunur); devir
  e-postası gider.
- **Geri alma:** aynı eylem ters yönde (yeniden devir); iki kayıt da zincirde kalır.

## 6. Silme ve purge — FR-ADMIN-09, FR-ADMIN-11, FR-ADMIN-20

### 6.1 Çalışma alanı silme (14 gün soğuma)

- **Panelde:** Çalışma alanları → alan → Eylemler → **Çalışma alanını sil** (gerekçe + alanın **adı yazılarak**
  onay → **Silmeyi planla**). Bekleyenler Çalışma alanları listesindeki **Planlanan silmeler** tablosunda
  (silinme tarihi, kalan gün).
- **Rol:** **S**. **TOTP:** gerekli. **Audit:** `workspace.deletion_scheduled`, `workspace.deletion_cancelled`,
  `workspace.purged`.
- **Süreç:** silme **hemen silmez**: `purge_scheduled_at` = +14 gün; alan o anda **askıya alınır** (zaten
  askıdaysa öyle kalır) ve alan sahibine e-posta gider. Platform sürecinin saatlik purge işi vadesi
  gelenleri siler (`workspace.purged`; bir seferde en fazla 20; kullanımda olan satır sonraki geçişe kalır).
- **Geri alma:** vade dolmadan Eylemler → **Silmeyi iptal et** (`workspace.deletion_cancelled`). **Askı
  kendiliğinden kalkmaz**: alan açılsın isteniyorsa ayrıca **Askıyı kaldır** (S, taze kod). Purge sonrası
  geri dönüş yoktur; yedekten dönüş için production-checklist §9 "Data and backups".
- Vadeden bir gün önce, silme uyarısını açan operatörlere `purge_tomorrow` e-postası gider (§15).

### 6.2 Hesap silme

- **Panelde:** Hesaplar → hesap → **Hesabı sil** (e-posta yazılarak onay). **Rol:** **S**. **TOTP:** gerekli.
  **Audit:** `account.erased`.
- Hesap, **Kurucu olduğu** bir çalışma alanı varsa reddedilir (`account_is_sole_owner`): önce §5 ile devredin
  ya da §6.1 ile alanı silin. Silmeden önce **Hesap verisini dışa aktar** (`account.exported`) gerekiyorsa verin.
- **Geri alma:** yok (kişisel veri silinir).

### 6.3 Doğrulanmamış kayıtları temizleme

- **Panelde:** Operasyonlar → doğrulanmamış kayıtlar → **Temizle**. **Rol:** **S**. **TOTP:** gerekli.
  **Audit:** `security.unverified_signups_purged`.
- E-postasını doğrulamamış ve en az `max(UNVERIFIED_SIGNUP_TTL_HOURS, 7×24 saat)` yaşında kayıtları siler; panel
  önce kaç satıra bakılacağını gösterir. **Geri alma:** yok; kişi yeniden kaydolur.

## 7. Ödeme kuyruğu — FR-ADMIN-14 (tm 389.18; #382/#383/#384)

- **Panelde:** Faturalama → **Ödeme kuyruğu** (kripto istekleri + SWIFT) ve **Ödeme ayarları** (sağlayıcılar,
  banka bilgisi, fatura ihraççısı); **Genel bakış** döküm satırları, krediler, elle abonelik.
- **Rol:** okuma S/D/B/R; yazma **B/S**. **TOTP:** gerekmez (gerekçe gerekir).

### 7.1 Kripto: adres → TXID → onay

1. Kiracı kripto ile öder demiştir → istek kuyrukta `requested`.
2. **Adresi gönder** (`billing.payment_address_sent`): cüzdan adresi (USDT TRC20/ERC20 biçim denetimli).
   Kiracı adresi kendi Faturalama ekranında görür; **e-posta adres taşımaz**, audit'te adres maskelidir.
3. Kiracının Kurucusu ödemeyi yapar ve TXID'ini girer (`address_sent`). Operatör TXID'i **zincirde kontrol eder**.
4. **Ödemeyi onayla** (`billing.payment_confirmed`): abonelik `active`, döküm `paid`, kiracı "ödendi" görür.
   Kurucu TXID yazdıysa operatörün girdiği aynı olmalıdır; yazmadıysa operatör girer. **Aynı TXID** (herhangi
   bir çalışma alanında) ikinci kez 409 alır — tekildir.
5. Ödeme gelmediyse/yanlışsa **Talebi reddet** (`billing.payment_request_cancelled`): talep kapanır, gerekçe
   Kurucuya `closed_reason` olarak döner ve yeniden talep açabilir. Kiracı paneli (Faturalama > Kripto)
   gerekçeyi «SiyahTuş ekibinin gerekçesi» başlığıyla, yazdığınız haliyle gösterir (tm 393).

### 7.2 SWIFT: eşleştirme

1. Banka ekstresinde dökümün **referans koduyla** eşleşen havaleyi bulun.
2. **Ödendi işaretle** (`billing.swift_marked_paid`): sonuç kripto onayıyla aynıdır. Sağlayıcı sonradan
   kapatılmış olsa da açık referans yine ödenebilir.

### 7.3 Ödeme ayarları (Ödeme ayarları sekmesi)

- **Sağlayıcılar:** `swift_manual` / `crypto_manual` / `stripe` aç-kapa (`billing.providers_updated`). Kapalı
  sağlayıcı kiracıda seçenekten kalkar; zorla seçilirse 400 `method_unavailable`.
- **Banka bilgisi:** kiracının SWIFT ekranında görünen alıcı bilgisi (`billing.bank_details_updated`; audit'te
  değer yok). **Repoda gerçek IBAN yoktur**; gerçeği yalnız panelde girersiniz.
- **Fatura ihraççısı:** SiyahTuş'un ünvanı/adresi/vergi no (`billing.issuer_profile_updated`). Değişiklik
  **yalnız yeni dökümleri** etkiler (`seller_snapshot` kesimde donar); eski PDF bayt-eşit kalır.
- Ayarlar önbelleksizdir: kaydedince hemen görünür.

### 7.4 İade = kredi, elle abonelik, PDF

- **İade:** döküm satırı → **Kredi olarak onayla** (`billing.credit_granted`). Gerçek para iadesi yoktur
  (mock/sandbox, ADR-13a): kredi, **bir sonraki döküm kapanışında negatif satır** olur; tutar dökümün toplamını
  aşamaz.
- **Kredi (iadeden bağımsız):** Genel bakış → Krediler → **Kredi tanımla** (`billing.credit_granted`).
- **Elle abonelik** (kuruma özel anlaşma): **Elle abone yap** (`billing.manual_subscription_created`).
- **PDF:** döküm satırında PDF (bilgi amaçlı fatura, #383); yoksa indirilemez.
- **Geri alma:** onay/işaretleme geri alınamaz. Yanlış onayı düzeltmek: gerekçede açıklayan bir kredi ya da plan
  değişikliği. Kayıt silinemez.

## 8. Deneme, aktivasyon, plan, override, kota — FR-ADMIN-09/12/13

- **Panelde:** Çalışma alanları → alan → **Eylemler**; AI kotası için Kullanım → alan.
- **Rol:** denemeyi uzat, doğrulama e-postası, sandbox sıfırla → **D/S**; etkinleştir, plan, geçersiz kılma,
  AI kotası → **B/S**; abonelik iptal/sürdür → **S**. Hiçbiri TOTP istemez.
- **Audit:** `workspace.trial_extended`, `workspace.owner_verification_resent`, `workspace.sandbox_reset`,
  `workspace.activated`, `workspace.plan_changed`, `workspace.overrides_changed`, `workspace.ai_caps_changed`,
  `workspace.cancelled`, `workspace.resumed`.

| İş                           | Adım                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Denemeyi uzatmak             | **Denemeyi uzat** → gün + gerekçe. Bitmişse bugünden sayar ve salt-okumayı kaldırır.                                                                                                                 |
| Ödeme gelmeden etkinleştirme | **Lisansı etkinleştir** (`trialing`/`read_only`/`past_due` → `active`, deneme biter). Pilotta ödeme yok; bu yol sahibe erişimi açar.                                                                 |
| Plan değiştirmek             | **Planı değiştir** → plan + gerekçe.                                                                                                                                                                 |
| Koltuk tavanı / entitlement  | **Geçersiz kılmalar** (tüm satır kaydedilir): koltuk tavanı, entitlement'lar, günlük posta tavanı. Kiracı yalnız okur.                                                                               |
| AI günlük token tavanı       | Kullanım → alan → **AI tavanlarını değiştir** (isteğe bağlı bitiş günü): `override ?? plan ?? env`, 60 sn içinde etkin. Plan varsayılanları Kullanım sayfasının "Günlük AI tavanları" tablosundadır. |
| Sahibin doğrulama e-postası  | **Kurucu doğrulamasını yeniden gönder**; e-posta commit'ten sonra gider, hata eylemi geri almaz (`mail: failed`).                                                                                    |
| Sandbox                      | **Sandbox'ı sıfırla** — yalnız sandbox verisi.                                                                                                                                                       |
| Abonelik iptal / sürdür      | **Aboneliği iptal et** / **Aboneliği sürdür** (S).                                                                                                                                                   |

**Geri alma:** denemeyi uzatmanın tersi **Salt okunur yap**; plan → eski plan; geçersiz kılma → eski değerleri
kaydet; kota → özel değeri kaldır (ya da bitiş günü); iptal → sürdür.

## 9. AI sağlayıcı ve API anahtarı değişimi — FR-ADMIN-17/18/19

- **Panelde:** Ayarlar → **AI sağlayıcıları** (anahtar, model, bölge, tavanlar, fiyat, bağlantı testi, yeniden
  gömme). Panelde saklanan **tek sır** AI anahtarlarıdır. Kriz metni taslakları ve katalog sürümleri
  Yapay zekâ sayfasındadır (§14).
- **Rol:** okuma S/D/R; yazma **S**. **TOTP:** kaydetmek için gerekli; **bağlantı testi** için gerekmez;
  **yeniden gömme** S.
- **Audit:** `ai_settings.updated` (yalnız `changed: [...]` alan adları — anahtar değil),
  `ai_settings.connection_tested`, `ai_settings.reembed_started`, `ai_settings.crisis_drafts_updated`.

**Anahtar değiştirme (rotasyon):**

1. Yeni anahtarı sağlayıcının konsolunda üretin; **eskiyi henüz iptal etmeyin**.
2. Ayarlar → AI sağlayıcıları → anahtar alanına yeni anahtarı yapıştırın. Alan yazma-yalnızdır: mevcut değeri
   göstermez, yalnız `•••• last4`. Kaydet (kod + gerekçe).
3. **Modeli test et** / **Embedding sağlayıcısını test et** (dakikada 3): küçük bir tamamlama yapar; hata
   sınıfı (`auth`, `misconfigured`) görünür. Başarısızsa kaydı eski anahtarla yeniden yapın.
4. Kiracı API **süreç yeniden başlamadan** yeni anahtara geçer: `ai.settings_changed` ile hot-swap, en geç 5 sn;
   olay kaçsa 60 sn'lik emniyet okumasıyla.
5. Yeni anahtarın kullanıldığını sağlayıcı konsolundan doğrulayın, sonra **eski anahtarı sağlayıcıda iptal edin**.

**Anahtar silmek:** alandaki **Sil**; kayıt kalkar ve kiracı API `LLM_*` / `EMBEDDING_*` ortam değerlerine döner
(uyarı log'u; boot durmaz).

**Dikkat:**

- `PLATFORM_SETTINGS_KEY` değişirse kayıtlı AI anahtarları ve operatörlerin authenticator'ları açılamaz: kiracı
  API env'e döner (uyarıyla), anahtarlar yeniden yapıştırılır, operatörler 2FA'yı yeniden kaydeder. İlk operatör
  kaydolduktan sonra **asla değiştirmeyin**.
- Kayıtta doğrulanır: üretim + `PILOT_MODE`'da `mock` ve `SIYAHTUS_REGION` dışı bölge reddedilir; uzak sağlayıcı
  için base URL/model/bölge zorunludur.
- Embedding modeli değişirse panel `reembed_required` uyarır: **Yeniden gömme** (S) bilgi tabanını arka planda
  yeniden gömer; ilerleme aynı bölümde, çalışırken ikinci başlatma 409 `platform_operation_running`.
- Fiyat tablosu ve global günlük tavanlar aynı bölümdedir; çalışma alanı/plan tavanları için §8.
- **Geri alma:** eski değerlerle yeniden kaydet; hot-swap aynı yolla döner.

## 10. Bakım modu, duyuru, kayıt — FR-ADMIN-15/16

- **Panelde:** Ayarlar → **Bakım modu** (S, TOTP gerekli); Ayarlar → kayıt, deneme günü, duyuru (S, TOTP
  gerekmez); Ayarlar → etkin yapılandırma (S/D/R okur).
- **Audit:** `settings.maintenance_changed`, `settings.updated` (anahtarlar + önce/sonra; bu değerler sır
  değildir).
- **Bakımı açmak:** mod seç — **Salt okunur** (okuma ve oturum açma çalışır; diğer yazmalar 503 `maintenance`) ya
  da **Tam** (sağlık, `/deployment`, `/deployment/notice` ve `/auth/revoke` dışında her şey 503; RTM de) — en/tr
  mesajı gir, kod + gerekçe. Kiracı panelinde bantta görünür. Yayılım Redis `settings.changed` ile anında;
  yeni örnekler 30 sn'lik önbellekle okur. Önce **duyuru** ile haber verin.
- **Geri alma:** aynı ekranda kapatın. Platform ayarı okunamazsa kiracı API "bakımda değil" sayıp env ile devam
  eder (boot'u durduran kural yoktur).
- **Kayıt:** `signup_enabled` panelden kapatılırsa yeni kayıt kapanır; env `SIGNUP_ENABLED` yedektir ve **sıkı
  olan kazanır** (env kapalıysa panel açamaz). `trial_days` yalnız yeni kayıtlara uygulanır.
- **Etkin yapılandırma:** kiracı API'nin o an kullandığı değerler, `SECRET|KEY|PASSWORD|TOKEN` redaksiyonlu ve
  her anahtarın **kaynağı** (DB / env / varsayılan) ile. Panelden değişmeyenler (`APPS_LIVE_PROVIDERS`,
  Turnstile varlığı, ticket e-posta kapısı, `PILOT_MODE`) burada yalnız görünür.

## 11. Destek: arama ve "müşteri olarak gir" — FR-ADMIN-10/21

### 11.1 Kimlikten çalışma alanı bulma

- **Panelde:** Destek → arama. **Rol:** D/S. Thread ID / Chat ID / ticket / müşteri e-postası → **yalnız**
  çalışma alanı kimliği ve adı; bulunamadığında varlık sızdırmaz; **içerik yoktur**.

### 11.2 Impersonation

- **Panelde:** Destek (ya da Çalışma alanı detayı → **Müşteri olarak gir**). **Rol:** **D/S** salt-okunur;
  **`full` mod yalnız S** ve TOTP gerekli.
- **Audit:** `impersonation.started`, `impersonation.ended` (+ kiracıda `actor_type='platform'`, `on_behalf_of`).
- **Adımlar:** alan + hesap → mod (varsayılan **salt-okunur**) → gerekçe (bilet no) → **Bağlantıyı oluştur**.
  Panel 60 sn geçerli, tek kullanımlık kodla kiracı panelini `/auth/impersonate#code=…` ile açar. Kiracı
  panelinde **kırmızı şerit** + geri sayım + **Oturumu bitir** vardır; oturum **30 dk**. Alan sahibine
  başlangıçta e-posta gider.
- **Sınırlar:** salt-okunur modda yazım 403 `impersonation_read_only`; her modda yasak: parola/2FA/PAT/SCIM/
  güvenlik/ödeme/abonelik/BAA/müşteri silme/sandbox (403 `impersonation_forbidden_path`). Maskeleme (#300) ve
  yetki matrisi (#325) aynen geçerlidir.
- **Geri alma / bitirme:** kiracı panelinde **Oturumu bitir** ya da platformda aktif oturum listesinden
  (Destek) **Oturumu bitir** (`impersonation.ended`); 30 dk dolunca kendiliğinden. Operatör devre dışı
  bırakılınca, oturumları iptal edilince ya da rolü oturumun modunu tutamaz olunca da biter (§2, tm 430). Açık
  oturumlar Güvenlik → Impersonation listesinde ve alan detayının Impersonation sekmesinde görünür.

## 12. Güvenlik: blocklist ve kötüye kullanım — FR-ADMIN-22

- **Panelde:** Güvenlik. **Rol:** okuma S/D/R; yazma **S**. TOTP gerekmez.
- **Audit:** `security.blocklist_added`, `security.blocklist_removed`.
- **Ekleme:** **Engelle…** → tür (e-posta / alan adı / IP-CIDR) + değer + gerekçe. Kayıt ve davet akışı
  `platform_signup_blocked()` ile reddeder. Mevcut hesaplar etkilenmez; onlar için §4.2.
- **Kaldırma:** satırda kaldır + gerekçe. **Geri alma:** yeniden ekle/kaldır.
- Sayfa ayrıca başarısız girişler (son 1–168 sa), kötüye kullanım sayaçları (davet sınırı #282, widget
  doğrulama/kota #339), adrese göre kayıtlar (veri yoksa `not_available`) ve impersonation listesini gösterir.

## 13. Operasyon, audit doğrulama ve dışa aktarma — FR-ADMIN-05/06/20

### 13.1 Operasyon

- **Panelde:** Operasyonlar. **Rol:** okuma S/D/R; **Şimdi çalıştır** ve olay bölümü açma → D/S; doğrulanmamış
  kayıt temizliği → S (§6.3).
- **Audit:** `operations.job_run_requested`, `operations.partition_ensured`.
- Bölümler: zamanlayıcı işleri (son koşu/süre/hata), webhook birikimi, SIEM durumu, olay bölümleri, iş
  kuyrukları, bileşen durumları. Kurulu olmayan bileşen "kurulu değil" yazar.
- **Şimdi çalıştır:** istek Redis `siyahtus:platform:ops` kanalına gider, yalnız lider dinler. **Bölüm aç:**
  eksik `events` ayı için ([`event-partitions.md`](event-partitions.md)). Webhook birikimi için
  [`webhook-backlog.md`](webhook-backlog.md).
- **Geri alma:** başlatılmış iş geri alınmaz; işin kendi runbook'una (yukarıdaki bağlantılar) bakın.

### 13.2 Audit zincirini doğrulama ve dışa aktarma

- **Panelde:** Denetim. **Rol:** S/D/R okur; yazma yok. Sayfa: **Zincir** (doğrula + dışa aktar) ve
  **Kayıtlar** (yeni → eski; operatör, eylem, çalışma alanı numarası ve UTC tarih aralığı süzgeçleri).
- **Doğrulama:** **Zinciri doğrula** (API: `POST $BASE/audit/verify`). Temiz yanıt "zincir sağlam: N kayıt
  denetlendi" der; bulgu varsa tür (`hash_mismatch`, `sequence_gap`, `start_mismatch`, `broken_link`,
  `unchained_entry`, `head_mismatch`) ve konumla listelenir. Bulgu incident'tir; tabloyu "onarmaya" çalışmayın.
- **Dışa aktarma:** **Baştan dışa aktar** bir imzalı NDJSON sayfasını indirir (API: `GET $BASE/audit/export?limit=5000`)
  ve sayfanın imzasını (`X-Siyahtus-Signature`), konum aralığını, devam imlecini ve zincir denetimini gösterir;
  sayfa sürüyorsa **Sonraki sayfayı dışa aktar** imleçten devam eder. Süzgeç dışa aktarmaya uygulanmaz.
  Çevrimdışı kontrol `pnpm --filter @siyahtus/api platform:audit-check --file … --signature …`.
- **Bir alanın izi:** Çalışma alanları → alan → **Denetim** sekmesi (API: `GET $BASE/audit/workspaces/{licenseId}`) — üyelerin gördüğüyle aynı, `platform.*` kayıtları dahil.
- Ayrıntı, bulgu türleri ve anahtar yönetimi: **[`platform-audit.md`](platform-audit.md)**; bulgu çıkarsa
  [`tenant-isolation-suspicion.md`](tenant-isolation-suspicion.md) "Platform rolü ve impersonation izleri".
- **Sıklık:** haftalık doğrulama + her şüpheli olayda; aylık dışa aktarmayı hesap dışı bir yere kopyalayın.
  Zincir kırılırsa `audit_chain_broken` uyarısı da gelir (§15).
- **Yedekten dönüşte (NFR-ADMIN-B):** `make restore-drill` ve `make pilot-restore-drill`, geçici veritabanına
  geri yüklenen her `platform_*` tablosunun satır sayısını kaynakla karşılaştırır ve `platform_audit_log`
  zincirini 1. konumdan başa kadar doğrular (panelin "Zinciri doğrula" kodu, geri yüklenen satırlarla).
  `platform chain verified: N entries` satırı zincirin geri geldiğinin kanıtıdır. `skipped` (drill ortamında
  `PLATFORM_SETTINGS_KEY` yok) ve `not exercised` (iz boş) kanıt **değildir**; kök panelin çalıştığı sunucuda
  `RESTORE_DRILL_REQUIRE_PLATFORM=1` verin, ikisi de kırmızı olsun. Host'ta pnpm yoksa denetçi komutu
  `PLATFORM_CHAIN_CHECK_CMD` ile değiştirilir; geri yüklenen satırlar stdin'den gelir, veritabanı erişimi gerekmez.

## 14. Panel, sağlık, AI katalogları — FR-ADMIN-07/23

- **Panel:** kiracı sayıları, deneme bitişleri (7 gün), aktif oturum, günlük sohbet/AI turu, ödeme kuyruğu,
  kayıt zaman çizelgesi. Sağlık anlık görüntüsü kiracı API liderinden 30 sn'de bir gelir; **`stale`** = lider
  yayınlamıyor (kiracı API düşmüş olabilir → [`postgres-down.md`](postgres-down.md),
  [`redis-down.md`](redis-down.md)). Bileşen kaydı (ai_jobs, knowledge_jobs, captcha, geoip, kanallar, posta) burada.
- **Yapay zekâ sayfası:** Uyum korumaları (G1–G19 + `PLATFORM_GUARDRAILS_VERSION`), Şablonlar (paket sürümü +
  çalışma alanı başına kurulum), Uyum paketi, Kalite rubriği, Araçlar salt okunurdur. **Kriz metinleri**
  ülkeye göre düzenlenir (S, `ai_settings.crisis_drafts_updated`); kiracı onaylamadan yayın yoktur.
  Çalışma alanı detayındaki AI sekmesi yalnız sayı/durum gösterir, içerik değil.

## 15. Operatör uyarıları — FR-ADMIN-24

- **Panelde:** Yöneticiler → **Uyarı e-postaları** (operatör yalnız kendi tercihini açar/kapar; audit
  `admin.alert_prefs_changed`). API: `GET/PUT /auth/me/alert-prefs`.
- Platform-api her 5 dk tarar (Redis kilidi, tek örnek). Altı tür: `trial_ending` (3 gün), `payment_request_waiting`
  (24 sa+), `ai_cap_reached`, `health_red`, `audit_chain_broken`, `purge_tomorrow`. Her uyarı günde bir kez,
  `health_red` ve `audit_chain_broken` saatte bir gelir; tercih kaydetmeyen **superadmin** hepsini, diğerleri
  hiçbirini alır; devre dışı operatör almaz.
- **Geri alma:** tercihi kapatın.

## Ek A — acil durum: psql ve CLI yolları

Bu yollar **platform zincirine yazmaz**. Yalnız panel kurulu değilken ya da kilitliyken kullanın ve
kim/ne zaman/neden'i elle bir incident notuna yazın. Hepsi veritabanı sahibi rolüyle,
`docker compose -f docker-compose.pilot.yml exec db psql -U siyahtus -d siyahtus` içinde.

**A.1 Yanlış e-postayla oluşturulmuş ilk operatör.** Operatör hiç giriş yapmadıysa:
`DELETE FROM platform_admins WHERE email = '<yanlış>'` (oturum ve kurtarma kodları birlikte silinir; notu/kredisi/
impersonation kaydı olan operatör silinemez — `RESTRICT`), ardından §1'deki komutu doğru e-postayla yeniden çalıştırın.

**A.2 Tek superadmin 2FA'sını kaybetti** (§3.3). Panelin `reset-two-factor` işlemiyle aynı etki:

```sql
BEGIN;
UPDATE platform_admins
   SET totp_secret_ciphertext = NULL, totp_enrolled_at = NULL, totp_last_used_step = NULL
 WHERE email = 'ops@example.com';
DELETE FROM platform_admin_recovery_codes
 WHERE admin_id = (SELECT id FROM platform_admins WHERE email = 'ops@example.com');
DELETE FROM platform_sessions
 WHERE admin_id = (SELECT id FROM platform_admins WHERE email = 'ops@example.com');
COMMIT;
```

Operatör parolayla girer, yeni authenticator kaydeder. Kimlik doğrulamasını §3.4'teki gibi yapın.

**A.3 Panel olmadan aktivasyon** (yalnız root panel kurulu değilse):

```sql
UPDATE licenses SET status = 'active', trial_ends_at = NULL
 WHERE organization_id = (SELECT id FROM organizations WHERE name = '<çalışma alanı adı>')
   AND status IN ('trialing', 'read_only');
```

`UPDATE 1` beklenir; yinelenen ad hata verir (kuruluş kimliğiyle yapın). `past_due`'yu kaldırmaz; audit yazmaz.

**A.4 Panel erişimini kapatmak.** Tünelden/Caddy'den `admin.` kurallarını silin ya da `--profile platform`
olmadan `up -d` yapın: 4002/5175 dinlemez, kiracı akışları etkilenmez. Rolü kilitlemek için
`ALTER ROLE siyahtus_platform NOLOGIN PASSWORD NULL`; açmak için `ALTER ROLE siyahtus_platform LOGIN PASSWORD '<yeni>'`.

**A.5 Audit tablosu.** `platform_audit_log` hiçbir role UPDATE/DELETE vermez (sahip dahil); satıra dokunmaya
çalışmayın. Zincir bozulduysa §13.2.

## Ek B — FR-ADMIN → bölüm

| FR-ADMIN | Konu                               | Bölüm     |
| -------- | ---------------------------------- | --------- |
| 01–02    | Kimlik, TOTP, oturum               | 0, 3      |
| 03       | Bootstrap, IP izin listesi         | 0, 1      |
| 04       | Operatör yönetimi                  | 2, 3      |
| 05–06    | Audit zinciri, dışa aktarma        | 13.2      |
| 07       | Panel, sağlık                      | 14        |
| 08–09    | Çalışma alanı okuma ve eylemleri   | 4–6, 8    |
| 10       | Destek araması                     | 11.1      |
| 11       | Hesaplar                           | 4.2, 6.2  |
| 12–13    | Faturalama, kullanım, AI kotası    | 7, 8      |
| 14       | Ödeme operasyonu                   | 7         |
| 15–16    | Ayarlar, bakım, etkin yapılandırma | 10        |
| 17–19    | AI ayarları                        | 9         |
| 20       | Operasyon                          | 6.3, 13.1 |
| 21       | Impersonation                      | 11.2      |
| 22       | Güvenlik                           | 12        |
| 23       | AI katalogları                     | 14        |
| 24       | Uyarılar                           | 15        |
