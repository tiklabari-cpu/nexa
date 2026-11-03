# Üye tanıma — imzalı üye tokenı, iptal listesi, olası eşleşme ve ajan onaylı bağlama (ID-03 · K4)

- **Görev:** tm 287 (MEMBER-TOKEN). Bu kayıt tm 287.1 (şema + sözleşme) ile açıldı · PLAN.md §D240; tm 287.2 (token üretimi/doğrulaması, geçiş, rotasyon, iptal) §8'de · PLAN.md §D241; tm 287.3 (widget saklama, kuruluş başına çerez, çıkış) §9'da · PLAN.md §D242; tm 287.4 (olası eşleşmeler, ajan onaylı bağlama, tarayıcıları unut düğmesi) §10'da · PLAN.md §D243
- **Tarih:** 2026-10-15
- **Durum:** Kabul edildi — sahip kararı **K4** ("Token'ı bizim widget'ımız üretir (imzalı, çerez/localStorage'da saklanır); widget geri gelişte okuyup sunucuda doğrular … Başka cihazdan gelişte ajan onayı yolu geçerli", `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` Karar kaydı K4 ve "Kararların maddelere etkisi"). Varsayımlar: **K5** (AI yalnız konu düzeyinde hatırlatır), **ID-03-S4** (ajan onaylı bağlama Ekip Lideri ve üstü; RL-01 gelene kadar admin ve üstü).
- **Değiştirdiği karar:** `05-uygulama-rehberi.md` ID-03'ün "operatörün imzaladığı `user_hash`" yolu. K4 ile token'ı operatör değil SiyahTuş widget'ı üretir; operatör imzası F2'ye kaldı (tm 388, deferred) ve geldiğinde aynı doğrulama altyapısına ikinci giriş olur. **Sahip kararı K28 (2026-11-03) ile tm 388 şimdi yapıldı — §11** (PLAN.md §D446): kiracı açmadıkça kapalı, K4 akışı bit bit aynı.
- **Bağlı görevler:** tm 287.2 (token üretimi/doğrulaması, geçiş, rotasyon), tm 287.3 (widget saklama), tm 287.4 (olası eşleşmeler + bağlama), tm 287.5 (ayar ekranı); tm 286 (ID-02 günlük thread — "aynı müşteri" kararını bundan alır), tm 292 (AI-02 gün içi hafıza), tm 388 (F2).

## 1. Sorun

Widget dönen ziyaretçiyi localStorage'daki `siyahtus.customer_id` ile tanır (`apps/widget/src/api.ts:210-221`) ve `POST /customer/token` kendisine verilen her numara için token basar (`apps/api/src/routes/auth.ts:1682-1697`: müşteri bulunursa o müşteri). Uç herkese açıktır ve `host_origin` istemcinin beyanıdır (`auth.ts:195-209`). Sonuç: bir üyenin numarasını öğrenen biri onun adına token alıp açık konuşmasını okuyabilir. Numara webhook yüklerinde, ajan ekranında ve tarayıcıda durur; ID-02 (günlük thread) ve AI-02 (gün içi hafıza) ile o numaranın arkasındaki bilgi büyür.

## 2. Karar (K4)

1. **İlk ziyaret:** sunucu imzalı bir **üye tokenı** üretir (müşteri, lisans, cihaz/tarayıcı numarası, düzenlenme ve bitiş zamanı, sürüm, imzalayan anahtarın sürümü).
2. **Saklama:** token önce `siyahtus_member` adlı `Secure; HttpOnly; SameSite=None; Partitioned` (CHIPS) çerezde durur — sayfa betikleri okuyamaz, başka site göremez; tarayıcı çerezi tutmazsa widget'ın localStorage'ı yedektir.
3. **Geri geliş:** sırayla **imza → süre → lisans → iptal listesi**. Geçerliyse aynı müşteri (dolayısıyla ID-02'nin aynı günü) ve token kayan süreyle yeniden imzalanır. Değilse yeni anonim müşteri; yanıtın durumu ve biçimi ilk ziyaretle aynıdır (kahin olmasın), sunucu `warn` log yazar.
4. **İptal ve rotasyon:** bir üyenin ya da bütün üyelerin tokenları iptal edilebilir; imza anahtarı yenilenebilir, eski anahtar geçiş süresince kabul edilir.
5. **Yalnız `customer_id` kimseyi tanıtmaz.** Kullanıcı adı ve e-posta da asla: aynı kuruluşta aynı kullanıcı adını ya da e-postayı yazmış başka müşteri ajana "olası eşleşme (doğrulanmamış)" olarak gösterilir; iki kaydı yalnız ajanın onayı bağlar ve bağlama **yalnız ajanın geçmiş görünümünü** birleştirir — günün sohbeti (ID-02) ve AI hafızası müşteri numarasına bağlı kalır.

## 3. Veri modeli (tm 287.1)

Migration `apps/api/prisma/migrations/20261015180000_member_recognition` — yalnız genişletme (CONVENTIONS §6.3): dört yeni tablo, mevcut hiçbir tablo/kolon/kısıt değişmedi. Bu adımda yazan yok.

| Tablo                         | Kapsam (RLS)                                                 | Uygulama rolüne izin                     | Ne tutar                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `member_token_keys`           | lisans                                                       | `SELECT, INSERT, UPDATE` (silme yok)     | Lisans başına imza anahtarı: `key_version` + `key_ciphertext`, rotasyonda eskisi `previous_key_version` + `previous_key_ciphertext` + `previous_key_valid_until` |
| `member_token_revocations`    | lisans; yazarken `customer_id` bu kuruluşun müşterisi olmalı | `SELECT, INSERT` (eklenir, geri alınmaz) | İptal listesi: `customer_id` için ya da (NULL) bütün üyeler için, `revoked_at`'ten önce basılmış tokenlar reddedilir; `revoked_by`                               |
| `member_recognition_settings` | lisans                                                       | `SELECT, INSERT, UPDATE`                 | `token_ttl_seconds` (varsayılan 30 gün, 1–365 gün), `possible_matches_enabled` (varsayılan açık)                                                                 |
| `customer_identity_links`     | kuruluş; yazarken iki müşteri de bu kuruluşun olmalı         | `SELECT, INSERT, UPDATE` (silme yok)     | Ajan onaylı bağ: `customer_a_id < customer_b_id` (sıralı çift, kendine bağ yok), `linked_by/at`, `unlinked_by/at` (ikisi ya da hiçbiri)                          |

- **Anahtar düz saklanmaz.** `key_ciphertext` `lib/credential-cipher.ts` biçimindedir (AES-256-GCM, `v1:<iv>:<tag>:<ciphertext>`); CHECK `member_token_keys_sealed_check` `v<n>:` öneki ister — base64url bir ham anahtarda iki nokta olmadığı için yanlışlıkla düz anahtar yazılamaz. Ek veri (AAD) şifreli metni lisansa ve sürüme bağlar: başka lisansın satırına taşınan ya da iki yuva arasında yer değiştiren şifreli metin açılmaz. Şifreleme anahtarı (KEK) veritabanında değil dağıtımın ortamındadır: veritabanı dökümü tek başına imza atamaz.
- **Tek "önceki" yuva.** Rotasyon güncel anahtarı geçerlilik süresiyle önceki yuvaya taşır; süre içinde gelen üye yeni anahtarla yeniden imzalanır. Süre içinde ikinci rotasyon en eski anahtarı hemen düşürür (acil rotasyonun anlamı bu). CHECK'ler: üçlü ya hep ya hiç (`member_token_keys_previous_check`), önceki sürüm güncelden küçük (`…_previous_older_check`), sürüm 1'den başlar (`…_version_check`).
- **İptal "zaman damgasıyla".** Tokenlar saklanmaz (her anonim tarayıcı için satır konuşmaların kendisini geçerdi), bu yüzden numarayla değil düzenlenme zamanıyla iptal edilir: eşleşen en son satırdan önce basılmış token reddedilir. `(license_id, customer_id, revoked_at)` indeksi hem üye hem toplu (NULL) aramayı önden karşılar.
- **Lisans başına ayar, marka başına değil.** Token ve anahtarı lisansındır; üye (kuruluş düzeyindeki müşteri) her markanın sitesinde aynı kişidir. Ayar satırı ilk kayda kadar yoktur, okuma varsayılanı döner (`inbox_settings` kalıbı).
- **Kim yaptı kolonları yabancı anahtarsız** (`revoked_by`, `linked_by`, `unlinked_by`): kim-ne-yaptı kaydı denetim izidir ve hesaptan uzun yaşar (`canned_responses.updated_by` emsali).
- **Silinme yolu yalnız zincirleme:** lisans silinince anahtar/ayar/iptal, müşteri silinince (GDPR silme, sandbox sıfırlama) o müşterinin bağları ve iptalleri gider (FK `ON DELETE CASCADE`; zincirleme eylem RLS'yi ve izinleri tablo sahibi olarak aşar).
- **Ortak sabitler:** `@siyahtus/types` `MEMBER_TOKEN_COOKIE`, `MEMBER_TOKEN_TTL`, `MEMBER_KEY_ROTATION_GRACE`, `POSSIBLE_MATCH_LIMIT`, `POSSIBLE_MATCH_FIELDS`. Kolon varsayılanı, CHECK sınırları ve kontratın min/max/default değerleri `apps/api/test/integration/member-recognition-schema.test.ts` ile bu sabitlere karşı okunur.

## 4. Sözleşme (tm 287.1)

- **`POST /customer/token` (sunulan uç):** `siyahtus_member` çerez parametresi; gövdede `member_token` (localStorage yedeği); yanıtta `member_token` (yalnız istek geçerli çerezle gelmediyse — çerez taşıdıysa widget kendi kopyasını siler, token yalnız betiklerin okuyamadığı yerde kalır) ve `member_token_expires_at`; her 200'de `Set-Cookie`. `customer_id`'nin açıklaması K4'e göre: tanıtır, doğrulamaz. **Davranış tm 287.2'dedir** — o güne kadar sunucu yeni alanları okumaz, eski davranış sürer.
- **Bileşen şemaları (`components.schemas`):** `MemberRecognitionSettings`, `MemberRecognitionSettingsInput`, `MemberTokenKeyInfo` (anahtarın kendisi hiçbir yanıtta yok), `MemberKeyRotationInput`, `MemberTokenRevocation`, `PossibleMatchField`, `CustomerMatchSummary`, `PossibleMatch`, `PossibleMatchList`, `CustomerIdentityLink`, `CustomerIdentityLinkInput`, `CustomerIdentityLinkList`.
- **Yollar yazıldı ama bağlanmadı.** `apps/api/test/integration/contract-parity.test.ts` belgede olup sunulmayan her işlemi kırmızı yapar ("A contract that promises endpoints which 404 is worse than no contract"). Bu yüzden yol nesneleri `paths/settings.yaml` ve `paths/customers.yaml` sonunda "NOT MOUNTED YET" başlığıyla durur; `openapi.yaml` `paths:` altına **onları sunan alt görev route ile birlikte** ekler. tm 287.1'de bu yedi yol geçici olarak bağlanıp aynı Redocly kurallarıyla paketlendi (234 yol, 0 sorun) ve tipleri üretildi, sonra geri alındı.

| Yol                                                | İşlem (`operationId`)                                                        | Yetki                                                                | Bağlayacak |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------- |
| `/settings/member-recognition`                     | `GET getMemberRecognitionSettings` · `PATCH updateMemberRecognitionSettings` | `access_rules:ro`/`:rw` + `minimumRole: admin`                       | tm 287.2   |
| `/settings/member-recognition/rotate-key`          | `POST rotateMemberTokenKey`                                                  | `access_rules:rw` + admin                                            | tm 287.2   |
| `/settings/member-recognition/revoke-all`          | `POST revokeAllMemberTokens`                                                 | `access_rules:rw` + admin                                            | tm 287.2   |
| `/customers/{customerId}/revoke-member-tokens`     | `POST revokeCustomerMemberTokens`                                            | `customers:rw` (bugün admin ve üstü; Ajan rolü RL-02 matrisiyle)     | tm 287.2   |
| `/customers/{customerId}/possible-matches`         | `GET listCustomerPossibleMatches`                                            | `customers:ro` (her ajan görür)                                      | tm 287.4   |
| `/customers/{customerId}/links`                    | `GET listCustomerIdentityLinks` · `POST linkCustomerIdentity`                | okuma `customers:ro`; bağlama `customers:rw` + admin (RL-01'e kadar) | tm 287.4   |
| `/customers/{customerId}/links/{linkedCustomerId}` | `DELETE unlinkCustomerIdentity`                                              | bağlamayla aynı                                                      | tm 287.4   |

Bir yolu bağlayan alt görev aynı commit'te: `apps/mobile/src/__tests__/parity.test.ts` `contractEndpoints` sayısını yorumla artırır (227 → …), arayüzü henüz yoksa `scripts/audit/endpoint-ui.cjs` `TRACKED` listesine sahibiyle (`tm 287.4` / `tm 287.5`) ekler.

## 5. Sonraki alt görevlere kararlar ve öneriler

- **tm 287.2 (MT-MINT-VERIFY):** _Uygulandı — alınan kararlar ve öneriden sapmalar §8'de; aşağıdaki maddeler 287.1'in önerisi olarak kalır._
  - Token biçimi önerisi: müşteri tokenının (`nxc1.<body>.<sig>`) kardeşi `nxm1.<body>.<sig>`, gövdede `sub` (müşteri), `lic`, `did` (cihaz numarası, ilk basımda rastgele), `iat`/`exp` (milisaniye — saniye hassasiyeti aynı saniyedeki toplu iptalden sonra basılan tokenı da reddeder), `ver`, `kid` (= `key_version`). İmza HMAC-SHA256, sabit zamanlı karşılaştırma (`constantTimeEqual`).
  - KEK önerisi: `CUSTOMER_TOKEN_SECRET`'tan HKDF-SHA256 ile türetilmiş 32 bayt (ayrı `info` dizesiyle) — yeni zorunlu ortam değişkeni ve açılışı engelleyen kural yok. `CUSTOMER_TOKEN_SECRET` değişirse saklı anahtarlar açılmaz: açılmayan anahtar "yeniden anahtarla" sayılmalı (yeni sürüm), üyeler bir kez yeni ziyaretçi olur. AAD önerisi: `member-token:<license_id>:<key_version>`.
  - Anahtar ilk basımda tembel oluşur (`INSERT … ON CONFLICT (license_id) DO NOTHING`, sonra oku).
  - İptal denetimi: `max(revoked_at)` üzerinden `license_id = $lic AND (customer_id = $sub OR customer_id IS NULL)`.
  - **Geçiş (bare `customer_id`):** token'ı olmayan eski ziyaretçi bir kez benimsenir (TOFU), sonra yalnız token. Bunun için müşteri başına bir işaret gerekir; tm 287.1 eklemedi (alt görev başlığında yok, karar 287.2'nin). Öneri: `customers.member_adoptable_until TIMESTAMPTZ`, migration anındaki bir varsayılanla eklenip hemen bırakılır (`ADD COLUMN … DEFAULT (now() + interval '30 days')` → `ALTER COLUMN … DROP DEFAULT`): Postgres 11+ değişken olmayan varsayılanı bir kez hesaplar ve tabloyu yeniden yazmaz, böylece yalnız eski müşteriler süreli olarak benimsenebilir, yeniler ve kanal müşterileri asla. Benimseme ya da ilk token basımı işareti NULL yapar.
  - Yolları bağlama: ayarlar (dört işlem) + `revoke-member-tokens`; arayüz yoksa `TRACKED` sahibi ayarlar için `tm 287.5`, üye iptali düğmesi için `tm 287.4`. Denetim eylemleri (ör. `settings.member_recognition_updated`, `member_tokens.revoked`, `member_token_key.rotated`) web denetim kataloğuna en+tr.
- **tm 287.3 (MT-WIDGET-STORAGE):** _Uygulandı — kararlar ve öneriden sapma (çerez adı kuruluş başına) §9'da._ API widget'tan başka origin'dedir (`apps/widget/src/widget.ts:3568-3573`): çerezin gidip gelmesi için token isteği `credentials: 'include'` ile atılmalı ve API bu uçta widget origin'ine `Access-Control-Allow-Credentials: true` + tam origin ile yanıt vermeli. `Partitioned` çerez desteği tarayıcıya göre değişir (iOS Safari gerçek cihaz notu HANDOFF'a); localStorage yedeği her zaman çalışır. Çerez adı için `__Host-` öneki `Path=/` ister — uca sınırlı yol ile çelişir; seçilirse `MEMBER_TOKEN_COOKIE` ve kontrat birlikte değişir.
- **tm 287.4 (MT-MATCH-LINK):** çifti SQL'de sırala (`LEAST`/`GREATEST` uuid üzerinde — `customer_identity_links_order_check` aynı sırayı ister); olası eşleşme `username_normalized` (kısmi indeks `customers_organization_id_username_normalized_idx`) ya da `email` (`customers_organization_id_email_idx`) eşitliği, en çok `POSSIBLE_MATCH_LIMIT`, `possible_matches_enabled` kapalıysa boş + `enabled: false`; bağlanmış kaydın konuşmaları AI bağlamına girmez; denetim `customer.identity_linked` / `customer.identity_unlinked`.
- **tm 287.5 (MT-SETTINGS-UI):** `settings-sections.ts` kaydı (scope `access_rules`), anahtar bilgisi yalnız sürüm/tarih.

## 6. Varsayımlar

- **Token ömrü** varsayılan 30 gün, 1–365 gün (kaynakta değer yok). Alt sınır bir gün: üye günün geri kalanında aynı üye kalmalı (ID-02).
- **Rotasyon geçiş süresi** varsayılan 7 gün, 0–30 gün; `0` = acil rotasyon.
- **Olası eşleşme anahtarı** K4 panelindeki "kullanıcı adına göre olası eşleşmeyi ajana göster" seçeneğidir ve listenin tamamını (kullanıcı adı ya da e-posta) açıp kapatır.
- **İptal ve anahtar lisans kapsamlı;** bağlar kuruluş kapsamlı (müşteri kuruluş düzeyinde).
- **Geçiş penceresi (tm 287.2)** dağıtımdan itibaren 30 gün (varsayılan token ömrü kadar; kaynakta değer yok) ve yalnız dağıtım anında var olan, kanal kimliği olmayan müşteriler için. Kanaldan gelen (e-posta, WhatsApp, SMS, Telegram, Messenger) müşterinin takas edeceği bir widget numarası hiç olmadı; pencere onlara yalnız açık bir kapı bırakırdı.
- **Toplu iptal kuruluşun geçiş penceresini de kapatır.** Müşteri kuruluş düzeyinde, iptal lisans düzeyindedir: birden çok lisanslı bir kuruluşta bir lisansın toplu iptali öteki lisansın henüz takas etmemiş eski ziyaretçilerini de yeni ziyaretçi yapar (bugünkü kayıt akışı kuruluş başına tek lisans açar; sandbox da kendi kuruluşudur).

## 7. Değişen dosyalar (tm 287.1)

- `apps/api/prisma/migrations/20261015180000_member_recognition/migration.sql`, `apps/api/prisma/schema.prisma` (`MemberTokenKey`, `MemberTokenRevocation`, `MemberRecognitionSettings`, `CustomerIdentityLink` + geri ilişkiler).
- `packages/types/src/member-recognition.ts` (+ test).
- `packages/contract/openapi/openapi.yaml` (bileşen şemaları), `paths/auth.yaml` (`/customer/token`), `paths/settings.yaml` + `paths/customers.yaml` (bağlanmamış yollar), `packages/contract/src/generated/api.ts`.
- `apps/api/test/integration/member-recognition-schema.test.ts` (17 test; 10 mutasyonun 10'u kırmızı).

## 8. Token üretimi ve doğrulaması (tm 287.2)

`POST /customer/token` artık kimseyi çıplak `customer_id` ile tanımaz. Kod: `services/auth/member-token.ts` (biçim, imza, anahtar mühürleme), `services/auth/member-recognition.ts` (hangi müşteri, anahtar, rotasyon, iptal, ayar görünümü), `routes/auth.ts` (uç), `routes/member-recognition.ts` (beş yönetim işlemi), migration `20261016090000_member_adoption`.

### 8.1 Biçim ve anahtar

- **Biçim `nxm1.<kid>.<body>.<sig>`** — §5'in önerisinden bir sapma: `kid` gövdenin içinde değil, açıkta ve imzanın kapsadığı kısımda. Doğrulayıcı anahtarı gövdeyi okumadan seçer; imzası doğrulanmamış gövde hiç ayrıştırılmaz (`customer-token.ts`'in kuralı), `kid`'i değiştirmek imzayı bozar. İmza HMAC-SHA256, `constantTimeEqual`.
- **Gövde:** `sub` (müşteri), `lic`, `did` (tarayıcı numarası, 128 bit, ilk tanınmada çekilir ve her yeniden imzalamada taşınır), `oat` (bu tarayıcının token zincirinin başladığı an), `iat`, `exp` (milisaniye), `ver` = 1. **`oat` öneride yoktu:** iptal `iat`'e değil zincirin başına karşı karşılaştırılır. Aksi halde iptal işlemi commit olmadan hemen önce tokenı okuyup hemen sonra yeniden imzalayan bir basım, iptalin hiç reddetmediği bir token verirdi — çalınmış bir tokenla basım ucunu sürekli çağıran biri iptali böyle atlatabilirdi.
- **Tek saat:** karşılaştırılan her zaman veritabanından gelir (basımın başında `clock_timestamp()`, iptalde `revoked_at = clock_timestamp()`, rotasyonun bitişi SQL'de). API ile veritabanı saati kayabilir (uykudan dönen Docker Desktop VM'i, kendi NTP'si olan iki kopya); iki saat arasında karşılaştırılan bir iptal, kendinden önce basılmış tokenı geçirebilir.
- **KEK** önerildiği gibi: `CUSTOMER_TOKEN_SECRET`'tan HKDF-SHA256, `info` = `siyahtus/member-token/key-encryption/v1`; yeni ortam değişkeni ya da açılışı engelleyen kural yok. AAD `member-token:<license_id>:<key_version>`.
- **Anahtar ilk basımda tembel oluşur** (`INSERT … ON CONFLICT DO NOTHING`, sonra oku — yarışan iki ilk basım aynı anahtarı kullanır). Okuma hiçbir şey oluşturmaz.
- **Açılmayan anahtar** (`CUSTOMER_TOKEN_SECRET` değişti, satır elle değişti) bir sonraki basımda yeni sürümle değiştirilir, önceki yuva boşalır, `warn` yazılır; o lisansın üyeleri bir kez yeni ziyaretçi olur. Anahtarı kimse okuyamıyorsa tek dürüst sonuç budur.

### 8.2 Doğrulama sırası ve cevap

1. Token: önce `siyahtus_member` çerezi, yoksa gövdedeki `member_token`; ikisi gelirse çerez kazanır (kontrat).
2. `kid` → anahtar: güncel sürüm, geçiş süresi süren önceki sürüm; süresi dolmuş önceki sürüm `key_retired`, başka her sürüm `unknown_key`.
3. İmza (`bad_signature`) → gövde biçimi (`malformed`) → süre (`expired`) → lisans (`license_mismatch`, gömülü lisans uç adının çözdüğü lisans değilse — anahtar zaten lisansa ait, bu ikinci kilit) → iptal listesi (`revoked`) → müşteri hâlâ bu kuruluşta mı (`customer_gone`).
4. Geçerliyse o müşteri; yasaklıysa 403 `customer_banned` (yalnız kim olduğunu kanıtlamış üye yasağını öğrenir). Token aynı `did` ve `oat` ile, lisansın güncel ömrüyle yeniden imzalanır (kayan süre).
5. Geçersizse ve gövdede `customer_id` varsa geçiş (§8.3); o da tutmazsa yeni anonim müşteri.

Reddedilen her kimlik bilgisi ilk ziyaretle **aynı durum ve aynı alan kümesiyle** cevaplanır (testte anahtar kümesi karşılaştırılır) ve `warn` yazılır: `member credential refused; answered as a new visitor` + `license_id`, `reason`, `source` (`cookie` | `body` | `customer_id`); token ya da müşteri numarası log'a girmez. `req.body.member_token` log redaksiyonuna eklendi (çerez ve `Set-Cookie` zaten redakte).

Her 200'de `Set-Cookie: siyahtus_member=…; Max-Age=<ömür>; Path=<uç yolu>; Secure; HttpOnly; SameSite=None; Partitioned`. Gövdede `member_token` yalnız çerez geçerli bir tokenı taşıyıp tanındığında yoktur; `member_token_expires_at` her zaman vardır.

### 8.3 Geçiş: çıplak `customer_id` bir kez takas edilir

- Önerildiği gibi `customers.member_adoptable_until`: migration'da `DEFAULT (now() + interval '30 days')` ile eklenip varsayılan hemen bırakılır — Postgres 11+ değişken olmayan varsayılanı bir kez hesaplar, tablo yeniden yazılmaz; yalnız dağıtım anında var olan müşteriler 30 gün takas edebilir. **Ek:** kanal kimliği olan müşteriler aynı migration'da pencereden çıkarılır (yalnız o satırlar güncellenir).
- Takas `UPDATE customers SET member_adoptable_until = NULL WHERE id = $1 AND member_adoptable_until > clock_timestamp() RETURNING …` ile hak talep eder: aynı numara için yarışan iki istekten yalnız biri kazanır, kaybeden yeni anonim müşteri olur. Takas edilen müşteri yasaklıysa 403 ve takas geri alınır.
- Bir üyenin iptali o üyenin, toplu iptal kuruluşun bütün geçiş pencerelerini kapatır. İptal zamanını müşteri satır(lar)ını kilitledikten **sonra** alır; takas zamanını talep güncellemesinden **önce** okur — yarışan bir takas ya iptalden önce commit olup iptalce reddedilir ya da pencereyi kapalı bulur.
- `auth_find_customer` artık çağrılmıyor; veritabanında kaldı (düşürmek daraltma adımıdır, ayrı iş).

### 8.4 Yönetim uçları

| İşlem                                       | Yetki                           | Davranış                                                                                                                                          | Denetim                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /settings/member-recognition`          | `access_rules:ro`/`:rw` + admin | Varsayılanları okur, satır/anahtar oluşturmaz; önceki anahtar yalnız hâlâ kabul edilirken görünür                                                 | —                                                                                                                                                                                         |
| `PATCH /settings/member-recognition`        | `access_rules:rw` + admin       | Upsert; yeni ömür bir sonraki imzalamadan itibaren                                                                                                | `settings.security_updated` (`resource: member_recognition`, alanlar, `ttl_seconds_before/after`, `possible_matches_before/after` — metadata anahtarında "token" sözcüğü sanitize edilir) |
| `POST …/rotate-key`                         | `access_rules:rw` + admin       | Satırı kilitler; geçiş > 0: güncel anahtar önceki yuvaya, bitiş `clock_timestamp() + geçiş`; 0: önceki yuva boşalır (acil); anahtar yoksa sürüm 1 | `member_token_key.rotated` (`version`, `previous_version`, `grace_period_seconds`)                                                                                                        |
| `POST …/revoke-all`                         | `access_rules:rw` + admin       | Kuruluşun geçiş pencerelerini kapatır, `customer_id` NULL iptal satırı                                                                            | `member_tokens.revoked` (`scope: all`)                                                                                                                                                    |
| `POST /customers/{id}/revoke-member-tokens` | `customers:rw`                  | Müşteri satırını kilitler (başka kuruluşun müşterisi 404), penceresini kapatır, iptal satırı; `revoked_by` hesap                                  | `member_tokens.revoked` (`scope: customer`)                                                                                                                                               |

Denetim eylemleri web kataloğunda (en + tr, "Credentials" grubu), hedef türü `member_recognition`.

### 8.5 Widget'ta en küçük gönderim (tm 287.3'ten öne alınan pay)

Çıplak numara kapanınca bugünkü widget her yüklemede yeni müşteri olurdu (e2e "sends a message and keeps it after a reload" kırmızı). Bu yüzden `apps/widget/src/api.ts` cevaptaki `member_token`'ı `siyahtus.member_token` localStorage anahtarına yazar ve sonraki basımda gönderir; `customer_id`'yi yalnız token yokken (geçiş için) gönderir. **tm 287.3'e kalan:** `credentials: 'include'` + CORS ile partitioned çerez, çerez taşıdığında yerel kopyanın silinmesi, logout, iOS Safari notu. Önbellekte eski widget paketi kalan bir tarayıcı geçişte bir kez benimsenir, sonraki yüklemede (tokenı saklamadığı için) yeni ziyaretçi olur — geçiş süresince kabul edilen bir sınır.

### 8.6 Değişen dosyalar (tm 287.2)

- `apps/api/prisma/migrations/20261016090000_member_adoption/migration.sql`, `schema.prisma` (`Customer.memberAdoptableUntil`).
- `apps/api/src/services/auth/member-token.ts`, `member-recognition.ts`, `src/lib/cookie.ts`, `src/plugins/auth.ts` (`app.memberRecognition`), `src/routes/auth.ts`, `src/routes/member-recognition.ts`, `src/server.ts` (kayıt + redaksiyon), `src/services/audit/audit-log.ts`.
- Kontrat: `openapi.yaml` dört yol bağlandı, `paths/settings.yaml` + `paths/customers.yaml` başlık/açıklama, `src/generated/api.ts`; mobil parity 227 → 231; `scripts/audit/endpoint-ui.cjs` `TRACKED` (ayarlar → tm 287.5, üye iptali → tm 287.4).
- Web: `AuditLogPage.tsx` grubu, `locales/{en,tr}/audit-labels.ts`. Widget: `src/api.ts` (+ `api.member.test.ts`).
- Testler: `apps/api/test/integration/member-token.test.ts`, birim `member-token.test.ts`, `cookie.test.ts`, yardımcı `test/helpers/member-token.ts`; çıplak numarayla mevcut müşteriye basım yapan 9 entegrasyon dosyası geçiş yoluna ya da üye tokenına çevrildi.

## 9. Widget saklama, kuruluş başına çerez ve çıkış (tm 287.3)

### 9.1 Token tarayıcıda nerede durur

- **Basım isteği kimlik bilgisiyle gider** (`credentials: 'include'`, `apps/widget/src/api.ts`). Çerez yalnız böyle bir istekte gönderilir ve yanıttaki `Set-Cookie` yalnız böyle bir istekte saklanır; tm 287.2'nin widget'ı bunu yapmadığı için çerez hiçbir tarayıcıda oluşmamıştı (API ile widget ayrı origin: `api.<alan>` / `widget.<alan>`). Diğer istekler bearer token taşır, çerez göndermez.
- **CORS sunucuda zaten hazırdı:** `@fastify/cors` `credentials: true`; üretimde izin listesi `WEB_ORIGIN`, ve `productionProblems` widget origin'i listede değilse açılışı reddeder (tm 243). Yeni: `production-boot.test.ts` kimlik bilgili basımın ve `DELETE` ön-uçuşunun widget origin'ine adıyla + `Access-Control-Allow-Credentials: true` ile cevaplandığını sabitler.
- **Yerel kopya yalnız çerez tutulmadığında:** sunucu tokenı gövdeden yalnız çerez taşıdığında çıkarır (§8.2); widget o zaman kendi kopyasını siler. Çerezi tutan tarayıcıda token yalnız hiçbir betiğin (widget'ınki dahil) okuyamadığı yerde kalır; tutmayan tarayıcıda localStorage yedektir.
- **Her şey kuruluş başına:** localStorage `siyahtus.member_token.<kuruluş>` ve `siyahtus.customer_id.<kuruluş>` (küçük harf). Müşteri numarası kimlik doğrulamaz; yalnız "bu tarayıcı bu çalışma alanını daha önce gördü" der (`isReturningVisitor`: kapalı panelde bağlanıp okunmamış rozeti göstermek için).

### 9.2 Öneriden sapma: çerez adı kuruluş başına (`siyahtus_member_<kuruluş>`)

Bölüm (partition) kuruluş başına değil, **gömülen site** başınadır. Bütün çalışma alanlarının barındırılan sohbet sayfası (`chat.html`) widget'ın kendi sitesindedir, yani aynı bölümü paylaşır; aynı sitede iki çalışma alanının widget'ı da öyle. Tek adlı çerezde ikinci çalışma alanının basımı birincinin tokenını ezerdi — ve çerez taşıdığında widget kendi kopyasını sildiği için o üye birinci çalışma alanında yabancı olurdu (sırayla birbirini unutan iki çalışma alanı). Bu yüzden:

- `@siyahtus/types` `memberTokenCookieName(organizationId)` = `siyahtus_member_<kuruluş, küçük harf>`; `MEMBER_TOKEN_COOKIE` önek olarak kaldı. Sunucu yalnız istenen kuruluşun çerezini okur ve yeniler; tarayıcının yanında gönderdiği öteki kuruluşların çerezleri okunmaz, ezilmez, red log'u da üretmez.
- Kontrat: OpenAPI'de çerez parametresinin adı desen olamaz; `/customer/token` `in: cookie` parametresi kaldırıldı, ad işlem açıklamasında ve iki `Set-Cookie` başlığında yazılı (`member-recognition-schema.test.ts` okur).
- Eski tek adlı çerez hiçbir tarayıcıda yok (§9.1, ilk madde); okunmaz. tm 287.2 widget'ının localStorage'da bıraktığı paylaşılan yuva (`siyahtus.member_token` / `siyahtus.customer_id`) bir kez taşınır: kendi anahtarı olmayan kuruluş paylaşılan yuvayı gönderir; sunucu o müşteriyi tanırsa (yanıttaki `customer_id` yuvadakiyle aynı) yuva silinir, tanımazsa başka kuruluşundur ve yerinde kalır. Kuruluş kendi anahtarına kavuştuktan sonra paylaşılan yuvayı bir daha okumaz.

### 9.3 Çıkış: `siyahtus('logout')`

05 ID-03'ün öngördüğü komut: gömen sayfa kendi kullanıcısının oturumunu kapatınca widget o ziyaretçiyi unutur — ortak bilgisayardaki bir sonraki kişi önceki üyenin konuşmasına düşmemeli.

1. **Yükleyici** (`loader.ts`) komutu çerçeveye aktarır ve bir **Promise** döner; widget "unuttum" (`siyahtus:logged-out`) dediğinde ya da `LOGOUT_TIMEOUT_MS` (5 sn) dolunca çözülür, hiç reddetmez. Gömen sayfa `await siyahtus('logout')` ile sonra yönlendirebilir — yoksa sayfa değişimi çerçeveyi unutma işinin ortasında kapatabilirdi.
2. **Widget** (`widget.ts`) komutu yalnız gömen sayfadan kabul eder (`event.source === parent`; aynı sayfadaki başka bir çerçeve ziyaretçiyi çıkaramaz) ve barındırılan sohbet sayfasında yok sayar. Yoldaki basımın bitmesini bekler (yoksa başlattığı yoklama/soket ve getirdiği çerez çıkıştan sağ çıkardı), yoklamayı ve soketi durdurur, `WidgetApi#forget` ile bu sitedeki **bütün çalışma alanlarının** localStorage kimliklerini (paylaşılan eski yuva dahil) siler ve `DELETE /customer/token`'ı kimlik bilgisiyle çağırır; okunmamış işaretini de siler. Bu andan sonra aynı belge kimse adına basım yapmaz (`#forgotten`; 401 yolu dahil).
3. **`DELETE /customer/token`** (`forgetCustomerMemberTokens`, herkese açık, veritabanına dokunmaz, hep 204): tarayıcının gönderdiği her `siyahtus_member_<uuid>` çerezini aynı özniteliklerle `Max-Age=0` yazarak düşürür (tarayıcı adı, yolu ve bölümü eşleşen çerezi siler). Bölümlü olduğu için bir sayfa yalnız kendi bölümünü unutturabilir; köken denetimi gerekmez. **Hiçbir şey iptal etmez:** tarayıcıdan kopyalanmış bir token süresi dolana ya da üye iptal edilene kadar geçerlidir (iptal ajanın işidir, §8.4) — çıkış tarayıcının unutmasıdır.
4. **Yükleyici** onayı alınca çerçeveyi yeniden açar (aynı adres, yeni belge): eski belgenin bellekte tuttuğu transkript, form ve token yeni ziyaretçiye hiçbir alan unutulmadan sıfırlanmış olur; çerçeve kapalı başlatıcı boyutuna döner, arada gelen komutlar yeni belgenin `siyahtus:ready`'sine kadar sıraya girer. Yeni ziyaretçi ilk kez gelen biridir; paneli açana kadar basım yapılmaz.

Çerez isteği başarısız olursa (ağ) çerez kalır ve sonraki yükleme eski üye olarak tanınır; widget bunu `console.warn` ile yazar, gizlemez.

### 9.4 Tarayıcı kısıtları — iOS Safari gerçek cihaz notu

- **Chrome / Edge (114+)** bölümlü çerezi tutar: üye çerezde kalır, yerel kopya silinir.
- **Firefox** üçüncü taraf çerezleri zaten site başına böler (Total Cookie Protection); `Partitioned` özniteliği aynı sonucu verir.
- **Safari (macOS ve iOS — iOS'ta her tarayıcı WebKit'tir)** üçüncü taraf çerezlerini varsayılan olarak engeller; bölümlü çerez desteği sürüme göre değişir. Engellendiğinde sunucu tokenı gövdede vermeye devam eder ve widget localStorage yedeğiyle çalışır. Ancak WebKit üçüncü taraf iframe depolamasını da site başına böler ve ITP, kullanıcının etkileşmediği siteler için betikle yazılmış depolamayı **7 gün** sonra silebilir: iOS'ta bir haftadan uzun aradan sonra dönen üye yeni ziyaretçi olabilir. Gizli sekmede depolama oturumla biter. **Bu, gerçek iPhone/iPad'de doğrulanmadı** (bu ortamda cihaz yok; e2e yalnız Chromium koşar) — pilotta bir iOS cihazda "aynı sekmede ikinci gün dönüş" ve "8 gün sonra dönüş" elle denenmeli. Barındırılan sohbet sayfası (`chat.html`) birinci taraf olduğundan bu kısıtlardan etkilenmez.

### 9.5 Değişen dosyalar (tm 287.3)

- `packages/types/src/member-recognition.ts` (`memberTokenCookieName`, `isMemberTokenCookieName`, + test).
- Kontrat: `paths/auth.yaml` (`/customer/token` çerez adı, `delete: forgetCustomerMemberTokens`), `src/generated/api.ts`. Yol sayısı değişmedi (231; mobil parity aynı).
- API: `src/routes/auth.ts` (kuruluş başına çerez, `DELETE`), `src/lib/cookie.ts` (`cookieNames`).
- Widget: `src/api.ts` (`credentials: 'include'`, kuruluş başına anahtarlar, kopya silme, paylaşılan yuvanın taşınması, `forget`), `src/widget.ts` (`logout`, kuruluş başına dönen ziyaretçi), `src/loader.ts` (Promise, onay, çerçeveyi yeniden açma).
- Testler: `member-token.test.ts` (+4: kuruluş başına çerez ×2, `DELETE` ×2), `production-boot.test.ts` (+1 CORS), `member-recognition-schema.test.ts` (kontrat), birim `cookie.test.ts` (+2), types (+3), widget `api.member.test.ts` (14), `widget.logout.test.ts` (4), `loader.test.ts` (+5), e2e `widget.spec.ts` (+2).

## 10. Olası eşleşmeler ve ajan onaylı bağlama (tm 287.4)

### 10.1 Uçlar

`routes/member-recognition.ts` + `services/customers/customer-identity.ts`; §4'teki üç yol `openapi.yaml` `paths:` altına bağlandı (231 → 234 yol, mobil parity yorumla).

- **`GET /customers/{id}/possible-matches`** (`customers:ro` — her ajan): aynı kuruluşta katlanmış kullanıcı adı (`username_normalized`) ya da e-postası (`citext`, büyük/küçük harf duyarsız) eşit başka müşteriler; kaydın kendisi hariç, en son aktif önce, en çok `POSSIBLE_MATCH_LIMIT` (10). Boş kullanıcı adı (`'   '` → `''`) ve boş e-posta kimseyle eşleşmez. Her satırda `matched_on` (`username` / `email`) ve `linked`. Lisansın anahtarı kapalıysa `{items: [], enabled: false}` — sorgu hiç koşmaz.
- **`GET /customers/{id}/links`** (`customers:ro`): canlı bağlar, en son bağlanan önce; geri alınmış bağ listelenmez.
- **`POST /customers/{id}/links`** (`customers:rw` + `minimumRole: admin`): yeni bağ 201 + `customer.identity_linked`; zaten canlı bağ (hangi sırayla adlandırılırsa) 200, hiçbir şey yazılmaz; geri alınmış çift yeniden bağlanınca yeni karar sayılır (201, yeni bağlayan, yeni denetim kaydı — satır güncellenir, uygulama rolü silemez). Kendine bağ (büyük/küçük harf farkıyla da) 400.
- **`DELETE /customers/{id}/links/{linkedId}`** (bağlamayla aynı yetki): 204 + `customer.identity_unlinked`; satır kalır, `unlinked_by/at` dolar; bağlı değilse 404.
- **Kiracı:** iki numaradan hangisi başka kuruluşunsa aynı 404 (hangisinin var olduğu söylenmez); RLS `WITH CHECK` zaten kuruluş dışı bağı yazdırmaz. Denetim kaydı yalnız öteki kaydın numarasını taşır (`linked_customer_id`) — ajanın dayandığı kullanıcı adı / e-posta asla.

### 10.2 Bağ yalnız ajan görünümünü birleştirir — AI dışı

Günün sohbeti (ID-02) ve AI hafızası (AI-02, K5) müşteri numarasıyla okunur; hiçbiri `customer_identity_links`'i okumaz. İki koruma: entegrasyon testi bağlı kaydın konuşmasındaki gizli metnin öteki kaydın ziyaretçisine yanıt veren modelin istemine girmediğini gösterir (`customer-identity-links.test.ts`); birim testi `services/ai`, `services/chat`, `services/bots`, `routes/customer.ts`, `routes/copilot.ts` kaynaklarında bağ tablosuna/servisine hiçbir başvuru olmadığını tarar (`customer-identity.test.ts`). **tm 292 (AI-02)** gün içi hafızayı `listDayConnections` ile müşteri numarasından kurar; bağlı kayıtları katmak isteyen bir değişiklik önce bu testi ve bu ADR'yi değiştirmek zorunda.

### 10.3 Ölçüm: e-posta yarısı RLS altında indeks koşulu olamaz

Arama iki yarının `UNION`'ıdır (tek `OR`, iki yarısı da indeks koşulu olamayınca kuruluşun bütün müşterilerine filtre olurdu). Kullanıcı adı yarısı `texteq` (leakproof) — `customers_organization_id_username_normalized_idx` indeks koşulunda (`siyahtus_app` olarak EXPLAIN, testte sabit). **E-posta yarısı `citext_eq` — leakproof değil** (`pg_proc.proleakproof = false`): RLS güvenlik bariyeri onu indeks koşuluna indirmez; `(organization_id, email)` indeksi yalnız kuruluşu daraltır, e-posta filtre olur ve kuruluşun her müşterisi okunur. Bugün `email-inbound.ts`'in müşteri araması da aynı bedeli öder; pilot ölçeğinde önemsiz. Bir kiracı büyüdüğünde çare kullanıcı adının emsali: üretilmiş, katlanmış bir `text` kolonu (`lower(email::text)`, `GENERATED ALWAYS … STORED`) + kısmi indeks (ayrı genişletme göçü; tabloyu yeniden yazar). Bu görevde yapılmadı — kapsam dışı bir şema değişikliği olurdu.

### 10.4 Panel

- **Müşteriler › profil** (`MemberIdentity.tsx`): "Olası eşleşmeler (doğrulanmamış)" kartı — eşleşme yoksa ya da anahtar kapalıysa çizilmez; her satırda paylaşılan alan çipleri, "Kaydı aç", yetkiliye "Aynı kişi olarak bağla" (onay penceresi AI'ın birleştirmediğini söyler). "Aynı kişi — bağlı kayıtlar" kartı her bağlı kaydı **kendi sohbetleriyle** gösterir (birleşik geçmiş görünümü; ayrıntı sorgusu profilin kendi önbellek anahtarıyla), yetkiliye "Bağı kaldır". Ana kartta `customers:rw` sahibine "Bu kişinin tarayıcılarını unut" (`revoke-member-tokens`, onaylı) — `endpoint-ui` `TRACKED` girişi kalktı.
- **Gelen kutusu › Ayrıntılar**: aynı sorgu, eşleşme varsa "Olası eşleşmeler (doğrulanmamış)" bölümü — her kayıt profiline bağlantı; bağlama orada yapılmaz (onay ve geri alma profilde).
- **Yetki arayüzde de aynı:** `canLink` = `customers:rw` **ve** admin rütbesi; Ajan rolü eşleşmeyi görür, düğmeyi görmez.

### 10.5 Varsayımlar

- Eşleşme listesi bağlamanın tek giriş kapısı (ID-03 madde 6); kullanıcı adı/e-posta yazmamış bir üyeyi elle aranıp bağlama arayüzü yok (uç herhangi bir numarayı kabul eder; arayüz ayrı iş).
- Bağ simetriktir ve zincirlenmez: A–B ve B–C bağlıysa A'nın profili yalnız B'yi gösterir (geçişli kapanış yok — her bağ bir ajanın tek bir kararıdır).
- Bağlanmış kayıtlar sohbet listelerinde ve raporlarda ayrı müşteri olarak kalır (raporlar müşteri numarasıyla sayar).

### 10.6 Değişen dosyalar (tm 287.4)

- Kontrat: `openapi.yaml` (üç yol bağlandı), `paths/customers.yaml` (başlık), `src/generated/api.ts`; mobil `parity.test.ts` 231 → 234.
- API: `src/services/customers/customer-identity.ts` (yeni), `src/routes/member-recognition.ts` (dört uç), `src/services/audit/audit-log.ts` (`customer.identity_linked`, `customer.identity_unlinked`).
- Web: `features/customers/MemberIdentity.tsx` (yeni), `CustomerDetailPanel.tsx`, `CustomersPage.tsx` (`canLink`, kaydı aç), `features/inbox/DetailsPanel.tsx` (bölüm), `features/audit/AuditLogPage.tsx` ("Müşteri kayıtları" grubu), `locales/{en,tr}/{customers,inbox,audit,audit-labels}.ts`, `lib/i18n-coverage.test.ts`.
- `scripts/audit/endpoint-ui.cjs` (`revoke-member-tokens` `TRACKED`'ten çıktı).
- Testler: `customer-identity-links.test.ts` (16, entegrasyon), birim `customer-identity.test.ts` (2), web `MemberIdentity.test.tsx` (11), `CustomersPage.test.tsx` (+4), `DetailsPanel.possibleMatches.test.tsx` (4), e2e `customers.spec.ts` (+1); profili açan iki testin sahte `fetch`'i iki yeni okumayı açıkça yönlendirir (`CustomersPage.test.tsx`, `ConfirmTeamCustomer.test.tsx`).

## 11. Operatör imzalı kimlik (tm 388 · sahip kararı K28)

K4'ün "ileride ikinci giriş yolu" notu: operatörün sitesi hangi üyenin giriş yaptığını bilir; sunucusu o üyenin numarasını çalışma alanının **kimlik gizli anahtarıyla** imzalar, sayfa imzayı `siyahtus('identify', {user_id, username?, email?, ts, user_hash})` ile widget'a verir, widget `POST /customer/token`'a `identity` olarak gönderir. Geçerli imza ziyaretçiyi o üyenin müşteri kaydı yapar — hangi cihazdan gelirse gelsin. Kod: `services/auth/member-identity.ts` (sır, imza, yaş, tekrar kaydı, sayaçlar), `member-recognition.ts` (`verifyIdentity`, `resolve`'un 0. adımı, `rotateIdentitySecret`, görünüm), `routes/auth.ts` (mint), `routes/member-recognition.ts` (ayar + sır), migration `20261224090000_member_signed_identity` + `20261224090100_customers_platform_user_id_index`.

### 11.1 İmzalanan mesaj

- `user_hash = hex(HMAC-SHA256(anahtar = gizli anahtar dizgesi, mesaj))`, mesaj **sabit sıralı ve sürümlü**: `siyahtus-identify-v1\n<user_id>\n<username>\n<email>\n<ts>` (`@siyahtus/types` `signedIdentityMessage`). Olmayan kullanıcı adı / e-posta **boş satırdır**. Hiçbir alan denetim karakteri (U+0000–001F, U+007F) taşıyamaz: bir değer satır sonuyla bir sonraki alanın yerine geçemez, dolayısıyla sıra tek başına mesajı belirsizlikten çıkarır (`"a\nb"` + boş kullanıcı adı ile `"a"` + `"b"` aynı mesaj olurdu — ilki reddedilir). JSON değil: PHP'nin `json_encode` kaçışları ile Node'unki farklıdır, satır birleştirme her dilde aynıdır.
- Bilinen-cevap testi (`member-identity.test.ts` types + api): rehberdeki örnek gizli anahtarla örnek üyenin imzası sabittir — operatörün geliştiricisi kendi kodunu buna karşı sınayabilir.
- `ts` Unix saniyesi; **en çok 300 sn eski, en çok 60 sn ileri** (`SIGNED_IDENTITY_LIMITS`), veritabanının saatine karşı (üye tanımadaki her zaman ölçümü gibi tek saat). İleri payı operatör sunucusunun saati hızlı çalışırsa diye.

### 11.2 Doğrulama sırası ve tekrar koruması

Mintten önce kendi kısa kiracı işleminde (`verifyIdentity`): **anahtar açık mı → gizli anahtar var mı → biçim → imza (güncel + geçiş süresi süren önceki, ikisi de sabit zamanlı, hangisinin tuttuğu süreden okunmaz) → yaş → tekrar kaydı**. Tekrar kaydı Redis `SET NX PX` (`member-identity:seen:<lisans>:<hash>`), yalnız her bakımdan geçerli bir imzaya harcanır (sahte imza akını yoldaki gerçek bir imzanın kaydını yakamaz) ve imzanın son kabul anı + 60 sn yaşar (Redis saati veritabanınınkinden biraz hızlıysa da kayıt imzadan önce düşmez). **Redis'e ulaşılamazsa kapalı kalır** (`replay_unchecked`) — `lib/saml.ts` gerekçesi: kesinti boyunca tekrarı kabul etmek başlangıcı belli bir kimlik doğrulama atlatması olurdu. Tekrar `(lisans, hash)` tekilliğidir; hash `user_id` + `ts`'i kapsadığı için görev metnindeki `(license, user_id, ts, hash)` ile aynı şeydir.

**Aynı tarayıcının aynı imzayı yeniden göndermesi tekrar sayılmaz:** imzayı harcayan belgedeki sonraki bir mint (müşteri tokenı süresi dolunca) onu yine taşır; tarayıcının üye tokenı zaten o `user_id`'yi taşıyan müşteriyi adlandırıyorsa ret yazılmaz, sayılmaz.

### 11.3 Hangi müşteri (`resolve` 0. adım)

1. Kuruluşta `platform_user_id = user_id` taşıyan müşteri (kısmi tekil indeks `(organization_id, platform_user_id) WHERE platform_user_id IS NOT NULL`, RLS kuruluşu daraltır; `texteq` sızdırmaz, indeks koşulu olur).
2. Yoksa tarayıcının kendi kaydı (geçerli üye tokenının müşterisi) — **başka bir üyenin numarasını taşımıyorsa**. Tek koşullu `UPDATE … WHERE platform_user_id IS NULL OR = $uid`: aynı tarayıcıda iki sekme iki farklı üyeyle aynı anda girerse ikinci güncelleme satırı yeniden okur, ilk üyenin numarasını görür ve kendi kaydını açar — iki üye asla birleşmez.
3. Yoksa yeni müşteri.

Üye numarası başına `pg_advisory_xact_lock(hashtext('siyahtus.member-identity'), hashtext(<kuruluş>:<user_id>))`: aynı anda giren iki cihaz ikinci kaydı açmaz (tekil indeks ikinci mint'i hata ile düşürürdü). Seçilen kayda `platform_user_id`, `identity_verified_at` (veritabanı saati) ve imzalı geldiyse kullanıcı adı (`username_verified = true`) ile e-posta yazılır; imzasız gelen alan dokunulmaz. Çıplak `customer_id` geçişi (§8.3) imzalı kimlik varken denenmez. Üye tokenı yeni kayda yeniden imzalanır; kayıt tarayıcının kendi kaydı değilse **yeni koşu** (`did`/`oat`) başlar — o üyenin eski iptalleri operatörün yeni kefaletini reddetmez. `via = 'identity'` → yapay zekâ güveni `verified` (`MEMBER_IDENTITY_TRUST`), insan doğrulaması **hiç sorulmaz** (GV-01 · mint'te `via` denetimi, sohbet açılışında token `identity` = `verified`), yeni müşteri sayacına (`recordNewCustomer`) girmez. Yasaklı doğrulanmış üye 403 `customer_banned` alır (kim olduğunu kanıtladı).

Kuruluşlar arası eşleşme yoktur: aynı `user_id` başka çalışma alanında başka kişidir; bir alanın imzası ötekinin anahtarıyla doğrulanmaz (`bad_signature`).

### 11.4 Varsayılan kapalı, yok sayma, sayaç

- `member_recognition_settings.signed_identity_enabled` varsayılan `false`; anahtar açık **ve** gizli anahtar varsa `active`. Öncesinde her `identity` yok sayılır (`disabled`), K4 akışı bit bit aynıdır — entegrasyon testi aynı tarayıcının kimlikli ve kimliksiz mint'inin aynı müşteriyi, aynı alan kümesini ve aynı ön-sohbet formunu aldığını sabitler.
- Reddedilen her kimlik **yok sayılır, cevaplanmaz**: 200, kimliksiz istekle aynı alan kümesi; `identity_verified` müşterinin özelliğidir (bu istekte ya da daha önce doğrulanmış mı), isteğin değil — reddedilmiş kimlik ile hiç kimlik aynı okunur. `warn` satırı yalnız `license_id` + `reason` taşır (`signed identity refused; ignored`); üye numarası, imza, gizli anahtar log'a girmez (ayrıca `req.body.identity` ve `identity_secret` redaksiyonda, `MEMBER_IDENTITY_LOG_PATHS`).
- Sayaç: Redis'te lisans × UTC günü başına `HINCRBY` (`verified` + her ret nedeni), 8 gün yaşar; ayar ekranı son 7 günü okur (`signed_identity.recent`, okunamazsa `null` — sıfır yazılmaz). Yanlış imza oyuncuya hiç hata olarak görünmediği için entegrasyonu denetlemenin tek yeri burasıdır.

### 11.5 Gizli anahtar

- `sti_` + 256 bit base64url (`MEMBER_IDENTITY_SECRET_PREFIX`; sızan bir anahtarı tarayıcılar tanısın). HMAC anahtarı bu dizginin kendisidir.
- `member_identity_secrets` (lisans başına satır; `member_token_keys` kalıbı, **ayrı tablo, ayrı KEK etiketi** `siyahtus/member-identity/secret-encryption/v1`, ayrı AAD `member-identity:<lisans>:<sürüm>` — üye tokenı anahtarı ile asla aynı anahtar değildir, birlikte dönmez). Mühürlü, CHECK'ler, RLS lisans, uygulama rolü silemez.
- Üye tokenı anahtarından farkı: açılamayan gizli anahtar **sessizce değiştirilemez** (diğer kopyası operatörün sunucusundadır) — atlanır, `warn` yazılır, imzalar `disabled` sayılır; yönetici yenisini üretir.
- `POST /settings/member-recognition/identity-secret` (`access_rules:rw` + admin, `credentials` impersonation sınıfı): ilk sır ya da rotasyon; **sırrı taşıyan tek yanıt** (`Cache-Control: no-store`), denetim `member_identity_secret.rotated` yalnız sürümlerle. Geçiş süresi 0–30 gün, varsayılan **1 gün** (`MEMBER_IDENTITY_SECRET_ROTATION_GRACE` — üye anahtarının 7 günü ziyaretçinin dönüş aralığıdır, bu ise operatörün dağıtım süresi); 0 = sızan anahtar için acil rotasyon. Tek önceki yuva.

### 11.6 Widget

- **Yükleyici değişmedi:** her komutu zaten sıraya alıp aktarıyordu; `identify` için tek bayt eklenmedi (yorum hariç).
- `widget.ts` `identify`: komut yalnız gömen sayfadan ve barındırılan sohbet sayfası dışında kabul edilir; yük **sayfanın verdiği gibi** `api.pageHints.identity`'ye yazılır (sunucu denetler; widget'ta ayrıştırma yok — bütçe) ve **hemen** mint edilir (ilk kez gelen ziyaretçi de: imza 5 dk yaşar ve ilk kullanımda harcanır, sayfada bekleyen imza hem bayatlar hem de ilk okuyanın işine yarar). Uçuştaki mint (dönen ziyaretçinin yükleme mint'i) önce iner, sonra ikinci mint kimliği taşır; eski müşteri olarak oturum açmış soket kapanır, `mint()` dökümü artık baştan çizer (`rerenderTranscript` — ilk mint'te sonuç aynı, sonrakinde eski müşterinin balonları kalmaz), `refresh()` eski tokenla getirilmiş anlık görüntüyü çizmez.
- Bütçe (`test/bundle-size.test.ts` 64,75 KB, **büyütülmedi**): ana parça +49 B, toplam 66.300 / 66.304 B — **4 B kaldı**. Bir sonraki widget özelliği yer açmadan sığmaz.
- Bilinçli maliyet: dönen ve giriş yapmış bir üye sayfa başına iki mint yapar (yükleme mint'i + kimlikli mint). Önlemi (yükleyicinin çerçeve adresine "kimlik geliyor" bayrağı, widget'ın yükleme mint'ini beklemesi) ~65 B tutuyordu; bütçede yer yok.

### 11.7 Panel

- Ayarlar › Güvenlik › Üye tanıma: anahtar, ömür ve olası eşleşmeyle **aynı formda**, taslak + Kaydet (GV-06 — çalışma alanının güvenlik ayarı anlık yazılmaz; `save-pattern.test.tsx` bunu sabitler). "Operatör imzalı kimlik" kartı: durum satırı (kapalı / açık ama anahtar yok / doğrulanıyor), sır bilgisi (kendi etiketleriyle — imza anahtarı kartıyla karışmasın; sürüm, üretim tarihi, önceki sürümün son günü — sırrın kendisi değil), "Gizli anahtar üret" / "Yeni gizli anahtar" (geçiş günü + onay; 0 acil), sır **bir kez** pencerede (kapatınca ekranın durumundan silinir), "asla tarayıcıya konmaz" uyarısı, son 7 günün sayıları nedenlere göre, geliştirici notları (mesaj, saat kuralı, Node + PHP + sayfa örneği, çıkışta `logout`).
- Gelen kutusu oyuncu kartı: "Doğrulanmış üye" rozeti (her ajan görür — bir durum, iletişim bilgisi değil), imzalı kullanıcı adında "Sitenizce imzalandı" (beyan rozeti yerine), "Üye numarası" (`customers.contact.view` kapalıysa gizli). Özel panel tokenının `player.username_verified`'ı artık kayıttan okunur (tm 379'un bıraktığı `false`).
- Ön-sohbet formu: imzalı kullanıcı adı olan üyeye kullanıcı adı alanı sorulmaz (mint `prechat.fields.username` gizler — WG-01-S3); sohbet açılışındaki yazılmış kullanıcı adı doğrulanmış olanın üstüne yazılmaz; ajanın kullanıcı adı düzenlemesi `username_verified`'ı düşürür.
- Kurulum rehberi §6 (tr + en): adımlar, mesaj, Node/PHP/sayfa örneği, uyarı.

### 11.8 Varsayımlar ve sapmalar

- **Ön-giriş anonim kaydı otomatik bağlanmaz.** Tarayıcı anonim A iken üye başka cihazdan doğrulanmış B'ye sahipse imza B'ye çözülür; A'nın konuşması B'ye `customer_identity_links` ile otomatik bağlanmaz — imza tarayıcının _şimdi_ üye olduğunu kanıtlar, _önceki_ anonim konuşmanın ona ait olduğunu değil (ortak bilgisayar). Doğrulanmış kimlik bağı ajan onaylı bağdan **ayrı işaretlenir**: müşteri satırındaki `platform_user_id`. A'yı B'ye ajan, olası eşleşmeden bağlayabilir. Tarayıcının kendi kaydı ise (başka üyeye ait değilse) ilk imzada üyenin kaydı olur — rehberin kuralı.
- `external_id` adı yerine `platform_user_id` (görev metni); `customers` kuruluş düzeyinde olduğu için birden çok lisanslı bir kuruluşta ad alanı ortaktır (rehber notu); bugünkü kayıt akışı kuruluş başına tek lisans açar.
- `mode = required` (rehber) yapılmadı: K28 "kiracı açmadıkça kapalı, K4 yolu sürer" der; imzasız ziyaretçiyi reddetmek ayrı karar.
- İmzalı e-posta müşteriye yazılır ama `is_lead`'i değiştirmez (ziyaretçinin iletişim bırakması değil) ve "doğrulandı" işareti taşımaz (yalnız kullanıcı adı işaretlenir).
- Yapay zekâ devir kartının `basis`'i hâlâ `declared`; kartı doğrulanmış kimliğe bağlamak ayrı iş (kart oyuncuyu kayıttan değil, mesajdan kurar).
- iOS/Safari: `identify` akışı tarayıcı depolamasına bağlı değildir (imza her sayfada yeniden gelir); §9.4'teki 7 günlük ITP sınırı imzalı üyeyi yeni ziyaretçi yapmaz.
- **Bağımsız güvenlik incelemesi** (salt okunur, kapanıştan önce): kritik / yüksek / orta bulgu yok. İki düşük bulgu düzeltildi — biçimsiz kimlik artık gizli anahtar okunup açılmadan reddedilir (açık bir çalışma alanında boşuna şifre çözme ve açık/kapalı zamanlama farkı kalmadı); günlük sayaçlar API'nin değil veritabanının saatine göre güne yazılır (`IdentityCheck.checkedAt`). Bilinçli kalanlar: imzalı kullanıcı adı / e-posta ön-sohbet serbest metninin hassas veri maskesinden geçmez (operatör kendi üyesinin verisine kefil); imza 5 dakikalık tek kullanımlık bir **taşıyıcı** beyandır, cihaza bağlı değildir — rehber ve ayar ekranı imzalı sonucun önbelleğe alınabilen bir yanıta konmamasını açıkça söyler.

### 11.9 Değişen dosyalar (tm 388)

- Migration: `20261224090000_member_signed_identity` (anahtar kolonu, `member_identity_secrets`, `customers.platform_user_id|identity_verified_at|username_verified` + CHECK'ler), `20261224090100_customers_platform_user_id_index` (CONCURRENTLY, tek ifade); `schema.prisma`; `scripts/check-drift.ts` (kısmi indeks adıyla).
- Types: `member-identity.ts` (+ test), `customer-context.ts` (üç alan), `platform.ts` (impersonation `identity-secret`).
- Kontrat: `openapi.yaml` (`MemberSignedIdentitySettings`, `MemberIdentitySecretInfo`, `MemberIdentityStats`, `MemberIdentitySecretRotationInput`, `MemberIdentitySecretIssued`, `SignedIdentityInput`, `CustomerContext.customer` +3), `paths/auth.yaml` (`identity`, `identity_verified`), `paths/settings.yaml` (yeni yol); 400 → 401 yol, mobil parity +1.
- API: `services/auth/member-identity.ts` (yeni), `member-recognition.ts`, `plugins/auth.ts`, `routes/auth.ts`, `routes/member-recognition.ts`, `routes/customer.ts`, `routes/customers.ts`, `routes/custom-panels.ts`, `services/customers/customer-context.ts`, `services/audit/audit-log.ts`, `lib/log-redact.ts`, `lib/fastify-options.ts`.
- Web: `settings/MemberRecognition.tsx`, `inbox/PlayerCard.tsx`, `audit/AuditLogPage.tsx`, `locales/{en,tr}/{settings,inbox,audit-labels}.ts`, `public/help/install-guide.html`.
- Widget: `src/widget.ts` (`identify`, `rerenderTranscript` mint'te, `refresh` token koruması), `src/api.ts` (tip), `src/loader.ts` (yalnız yorum).
- Testler: entegrasyon `member-identity.test.ts` (17), `member-recognition-schema.test.ts` (+1), `customer-context.test.ts` (+1, bir şekil), `captcha-challenge.test.ts` (+1 GV-01), `member-token.test.ts` (varsayılan görünüm); birim `member-identity.test.ts` (22), `log-redact.test.ts` (+1), types `member-identity.test.ts` (9); web `MemberRecognition.test.tsx` (+7), `PlayerCard.test.tsx` (+2); widget `widget.identify.test.ts` (5), `loader.test.ts` (+1); e2e `signed-identity.spec.ts` (1).
