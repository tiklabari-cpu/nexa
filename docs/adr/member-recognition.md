# Üye tanıma — imzalı üye tokenı, iptal listesi, olası eşleşme ve ajan onaylı bağlama (ID-03 · K4)

- **Görev:** tm 287 (MEMBER-TOKEN). Bu kayıt tm 287.1 (şema + sözleşme) ile açıldı · PLAN.md §D240
- **Tarih:** 2026-10-15
- **Durum:** Kabul edildi — sahip kararı **K4** ("Token'ı bizim widget'ımız üretir (imzalı, çerez/localStorage'da saklanır); widget geri gelişte okuyup sunucuda doğrular … Başka cihazdan gelişte ajan onayı yolu geçerli", `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` Karar kaydı K4 ve "Kararların maddelere etkisi"). Varsayımlar: **K5** (AI yalnız konu düzeyinde hatırlatır), **ID-03-S4** (ajan onaylı bağlama Ekip Lideri ve üstü; RL-01 gelene kadar admin ve üstü).
- **Değiştirdiği karar:** `05-uygulama-rehberi.md` ID-03'ün "operatörün imzaladığı `user_hash`" yolu. K4 ile token'ı operatör değil SiyahTuş widget'ı üretir; operatör imzası F2'ye kaldı (tm 388, deferred) ve geldiğinde aynı doğrulama altyapısına ikinci giriş olur.
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

- **tm 287.2 (MT-MINT-VERIFY):**
  - Token biçimi önerisi: müşteri tokenının (`nxc1.<body>.<sig>`) kardeşi `nxm1.<body>.<sig>`, gövdede `sub` (müşteri), `lic`, `did` (cihaz numarası, ilk basımda rastgele), `iat`/`exp` (milisaniye — saniye hassasiyeti aynı saniyedeki toplu iptalden sonra basılan tokenı da reddeder), `ver`, `kid` (= `key_version`). İmza HMAC-SHA256, sabit zamanlı karşılaştırma (`constantTimeEqual`).
  - KEK önerisi: `CUSTOMER_TOKEN_SECRET`'tan HKDF-SHA256 ile türetilmiş 32 bayt (ayrı `info` dizesiyle) — yeni zorunlu ortam değişkeni ve açılışı engelleyen kural yok. `CUSTOMER_TOKEN_SECRET` değişirse saklı anahtarlar açılmaz: açılmayan anahtar "yeniden anahtarla" sayılmalı (yeni sürüm), üyeler bir kez yeni ziyaretçi olur. AAD önerisi: `member-token:<license_id>:<key_version>`.
  - Anahtar ilk basımda tembel oluşur (`INSERT … ON CONFLICT (license_id) DO NOTHING`, sonra oku).
  - İptal denetimi: `max(revoked_at)` üzerinden `license_id = $lic AND (customer_id = $sub OR customer_id IS NULL)`.
  - **Geçiş (bare `customer_id`):** token'ı olmayan eski ziyaretçi bir kez benimsenir (TOFU), sonra yalnız token. Bunun için müşteri başına bir işaret gerekir; tm 287.1 eklemedi (alt görev başlığında yok, karar 287.2'nin). Öneri: `customers.member_adoptable_until TIMESTAMPTZ`, migration anındaki bir varsayılanla eklenip hemen bırakılır (`ADD COLUMN … DEFAULT (now() + interval '30 days')` → `ALTER COLUMN … DROP DEFAULT`): Postgres 11+ değişken olmayan varsayılanı bir kez hesaplar ve tabloyu yeniden yazmaz, böylece yalnız eski müşteriler süreli olarak benimsenebilir, yeniler ve kanal müşterileri asla. Benimseme ya da ilk token basımı işareti NULL yapar.
  - Yolları bağlama: ayarlar (dört işlem) + `revoke-member-tokens`; arayüz yoksa `TRACKED` sahibi ayarlar için `tm 287.5`, üye iptali düğmesi için `tm 287.4`. Denetim eylemleri (ör. `settings.member_recognition_updated`, `member_tokens.revoked`, `member_token_key.rotated`) web denetim kataloğuna en+tr.
- **tm 287.3 (MT-WIDGET-STORAGE):** API widget'tan başka origin'dedir (`apps/widget/src/widget.ts:3568-3573`): çerezin gidip gelmesi için token isteği `credentials: 'include'` ile atılmalı ve API bu uçta widget origin'ine `Access-Control-Allow-Credentials: true` + tam origin ile yanıt vermeli. `Partitioned` çerez desteği tarayıcıya göre değişir (iOS Safari gerçek cihaz notu HANDOFF'a); localStorage yedeği her zaman çalışır. Çerez adı için `__Host-` öneki `Path=/` ister — uca sınırlı yol ile çelişir; seçilirse `MEMBER_TOKEN_COOKIE` ve kontrat birlikte değişir.
- **tm 287.4 (MT-MATCH-LINK):** çifti SQL'de sırala (`LEAST`/`GREATEST` uuid üzerinde — `customer_identity_links_order_check` aynı sırayı ister); olası eşleşme `username_normalized` (kısmi indeks `customers_organization_id_username_normalized_idx`) ya da `email` (`customers_organization_id_email_idx`) eşitliği, en çok `POSSIBLE_MATCH_LIMIT`, `possible_matches_enabled` kapalıysa boş + `enabled: false`; bağlanmış kaydın konuşmaları AI bağlamına girmez; denetim `customer.identity_linked` / `customer.identity_unlinked`.
- **tm 287.5 (MT-SETTINGS-UI):** `settings-sections.ts` kaydı (scope `access_rules`), anahtar bilgisi yalnız sürüm/tarih.

## 6. Varsayımlar

- **Token ömrü** varsayılan 30 gün, 1–365 gün (kaynakta değer yok). Alt sınır bir gün: üye günün geri kalanında aynı üye kalmalı (ID-02).
- **Rotasyon geçiş süresi** varsayılan 7 gün, 0–30 gün; `0` = acil rotasyon.
- **Olası eşleşme anahtarı** K4 panelindeki "kullanıcı adına göre olası eşleşmeyi ajana göster" seçeneğidir ve listenin tamamını (kullanıcı adı ya da e-posta) açıp kapatır.
- **İptal ve anahtar lisans kapsamlı;** bağlar kuruluş kapsamlı (müşteri kuruluş düzeyinde).

## 7. Değişen dosyalar (tm 287.1)

- `apps/api/prisma/migrations/20261015180000_member_recognition/migration.sql`, `apps/api/prisma/schema.prisma` (`MemberTokenKey`, `MemberTokenRevocation`, `MemberRecognitionSettings`, `CustomerIdentityLink` + geri ilişkiler).
- `packages/types/src/member-recognition.ts` (+ test).
- `packages/contract/openapi/openapi.yaml` (bileşen şemaları), `paths/auth.yaml` (`/customer/token`), `paths/settings.yaml` + `paths/customers.yaml` (bağlanmamış yollar), `packages/contract/src/generated/api.ts`.
- `apps/api/test/integration/member-recognition-schema.test.ts` (17 test; 10 mutasyonun 10'u kırmızı).
