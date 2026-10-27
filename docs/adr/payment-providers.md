# ADR-13a — Ödeme yolları: SWIFT (elle) + kripto "Adres isteyin" (elle, TXID) + Stripe adaptörü yalnız mock/sandbox

- **Görev:** tm 276 (ADR-PAYMENT-PROVIDERS) · PLAN.md §0 (ADR-13a eki) · §D366
- **Tarih:** 2026-10-27 (sahip kararları 2026-10-14)
- **Durum:** Kabul edildi. Sahip kararları: **K16** ("Şimdilik SWIFT + kripto + Stripe": SWIFT/banka havalesi; kripto seçilince müşteri "Adres isteyin" bölümüne yönlendirilir, cüzdan adresi talep üzerine verilir; Stripe da bağlanabilir), **K19** (ADR-13a eki; gerçek anahtar ve canlı ödeme yine insan kararı → "Evet") ve **K27** (ADR başına bir görev) (`SiyahTus-Analiz/04-gerekceler-ve-sorular.md`, Karar kaydı + "K16: Ödeme yöntemleri"). Para birimi için BL-01 soru 3'ün varsayılanı (**USD**, bugünkü $99).
- **Değiştirdiği karar:** ADR-13 (PLAN.md §0). Lafzı aynen kalır, bu ek "Stripe MOCK" ifadesinin kapsamını belgeli olarak genişletir. ADR tablosunun satırı değişmedi.
- **Bağlı görevler:** tm 382 BILLING-PAYMENT-METHODS (BL-01, bu göreve doğrudan bağlı) · tm 383 INVOICE-PDF-PROFILE (BL-02, 382 üzerinden) · tm 384 SUBSCRIPTION-CANCEL (BL-03, 382 + 383 üzerinden) · tm 389.18 PLATFORM-PAYMENT-OPS (root panelin ödeme yüzü) · tm 389.20 (operatör uyarıları; bekleyen ödeme talebini sayar).
- **Kod değişikliği:** bu dosyanın yazıldığı turda yok. Uygulama tm 382'de (kiracı yüzü + sağlayıcılar) ve tm 389.18'de (root yüzü).

## 1. Bağlam

ADR-13: _"`unit_price_cents=9900`, `ai_resolutions_included=200`, aşım `AI_OVERAGE_CENTS` (varsayılan 50). Stripe MOCK"_.

Bugünkü uygulama (2026-10-27 HEAD'de yeniden doğrulandı):

- Ödeme işlemcisi dikişi tek bir taklittir: `apps/api/src/services/billing/payment-provider.ts`. Arayüzün tek yöntemi `registerPaymentMethod` (kart kaydı, son kullanma kontrolü). Tahsilat, iade ve webhook yok. `PAYMENT_PROVIDERS = ['mock']`, seçim `STRIPE_PROVIDER` ile yapılır (`apps/api/src/config/env.ts:1136`, varsayılan `mock`; `.env.example:394`). 05'in verdiği `env.ts:973` satırı kaymış, doğrusu 1136.
- Kiracı tarafı: checkout planı ve (taklit) kartı yazar, `activateIfPaid` lisansı `active` yapar (`apps/api/src/services/billing/license-activation.ts:42`, çağrı `apps/api/src/routes/reports.ts:414`).
- Elle aktivasyon yolu: root panelin `activate` eylemi (`apps/api/src/routes/platform/workspaces.ts:407`, denetim `workspace.activated`, tm 389.10). Pilot bugün bu yolla çalışıyor.
- Root panelin tasarımı ödeme yüzünü şimdiden adlandırıyor: platform ayarları `billing.swift_bank_details`, `billing.providers {swift_manual, crypto_manual, stripe}`, `billing.issuer_profile` (`docs/platform-admin/design.md:87-88`); FR-ADMIN-14 ödeme operasyonu (`docs/platform-admin/requirements.md:103-107`). Kripto kuyruğu için tablo henüz yok. Root panelin özet sayfası ve uyarı taraması `crypto_payment_requests` tablosunu `to_regclass` korumasıyla okuyor (`apps/api/src/services/platform/dashboard.ts:170`, `apps/api/src/services/platform/alerts.ts:342-352`).
- Sınır: MASTER-PROMPT.md:115 ve CLAUDE.md:30, _"Production deploy / DNS / TLS / gerçek secret / kart / ödeme YOK"_.

K16 üç ödeme yolu istiyor. ADR-13'ün "Stripe MOCK" ifadesi ise sağlayıcı kodunu yasaklıyor gibi okunabilir. `SiyahTus-Analiz/05-uygulama-rehberi.md` "Uygulayıcı için kurallar" madde 4'e göre kilitli bir karar sessizce delinmez, ilgili ADR'ye ek not yazılır. Bu dosya o ek nottur.

## 2. Karar

1. **Üç sağlayıcı kaydı.** Ödeme yöntemi kapalı bir küme: `swift_manual`, `crypto_manual`, `stripe`. Hangilerinin kiracıya görüneceğini platform yöneticisi açar ve kapatır. Ayar `billing.providers`'tadır, sağlayıcı başına bir aç/kapa. Kapalı bir sağlayıcı kiracı panelinde listelenmez ve onunla yeni ödeme başlatılamaz. O sağlayıcıyla açılmış talep ya da ödeme ise sonuna kadar işlenir: kapatmak yeni girişi durdurur, verilmiş sözü geri almaz.
   - **Varsayım:** Varsayılan görünürlük `swift_manual` açık, `crypto_manual` açık, `stripe` kapalı. Stripe bu yapımda yalnız sandbox'ta çalışır (madde 4), kapalı başlaması canlı bir kart yolunun kendiliğinden açılmasını önler.
   - Görünürlük (`billing.providers`) ile kart işlemcisinin uygulama seçimi (`STRIPE_PROVIDER`: `mock` | `stripe`) iki ayrı eksendir. Birincisi kiracı ne görür sorusunu, ikincisi `stripe` yolu hangi kodla koşar sorusunu cevaplar.

2. **SWIFT / banka havalesi (`swift_manual`).** Kiracı banka bilgisini ve ödeme referans kodunu görür. Banka bilgisi platform ayarıdır (`billing.swift_bank_details`); repoda, seed'de ve testlerde gerçek IBAN yoktur, yalnız sahte değer kullanılır. Referans kodu ödenecek fatura ya da dönem başına tektir ve havale açıklamasına yazılmak içindir. Platform yöneticisi havaleyi referansla eşleyip "ödendi" işaretler, abonelik ondan sonra aktifleşir. Bugünkü elle aktivasyon yolu (`activate`) sürer: "ödendi" işareti aynı aktivasyona varır, onun yerine geçmez. Otomatik banka mutabakatı ve kısmi ödeme yoktur.

3. **Kripto (`crypto_manual`) — "Adres isteyin".** Kiracı kriptoyu seçince bir talep formuna yönlendirilir: ağ (`USDT TRC20` | `USDT ERC20`), tutar ve fatura bilgisi.
   - **Cüzdan adresi otomatik gösterilmez.** Repoda, env'de ya da platform ayarında sabit bir cüzdan adresi yoktur. Adresi talep başına SiyahTuş ekibi root panelden verir, kiracı onu talebinin üzerinde görür.
   - Ödeme **TXID ile elle onaylanır.** Kiracı TXID'yi talebe yazar, ekip zincirde elle doğrulayıp onaylar ve abonelik aktifleşir. Zincir okuyan otomatik doğrulama yoktur (dış servis olurdu). Aynı TXID ikinci kez kabul edilmez.
   - Talepler Billing yönetiminde bir kuyruk oluşturur: `requested → address_sent → paid`, ayrıca `rejected` ve `canceled` (FR-ADMIN-14). Tablo adı ve durum kümesi tm 382'nindir. 389.20'nin taraması bugün `crypto_payment_requests` ve `status IN ('pending','requested')` bekliyor, ad farklı çıkarsa tm 382 o taramayı aynı commit'te uydurur.
   - Tutar faturanın tutarıdır (madde 5), kiracı formda indirim ya da kur farkı yaratamaz. USDT seçildiği için tutar USD cent'ten 1:1 okunur. Kur dönüşümü yoktur.

4. **Stripe (`stripe`) — adaptör kodlanır, yalnız mock/sandbox ile koşar.**
   - `payment-provider` arayüzüne bir `stripe` adaptörü gelir (`PAYMENT_PROVIDERS`'a `stripe`). Arayüz, yalnız gerçek bir işlemcinin dürüst bir karşılığı olan yöntemlerle genişler (barındırılan ödeme/kurulum oturumu, tahsilat, iade): kart verisi bize hiç değmez ve PCI SAQ A korunur. Hangi yöntemlerin ekleneceği tm 382'nindir.
   - **Anahtarlar env'den okunur** (adları tm 382 koyar). Anahtar yoksa ya da `STRIPE_PROVIDER=mock` ise `stripe` sağlayıcısı kiracıya görünmez ve açılışta uyarı loglanır. Açılış engellenmez: elle iki yol Stripe'sız tam çalışır.
   - **Webhook imzası doğrulanır.** Doğrulama ham gövde ve imza başlığı üzerinden yapılır, imzasız ya da geçersiz imzalı istek reddedilir. Olaylar sağlayıcının olay kimliğiyle tekilleştirilir, aynı olay iki kez işlenmez. Abonelik durumu webhook'la güncellenir.
   - **Otonom döngü ve CI yalnız mock/sandbox kullanır.** Testler sahte HTTP yanıtlarıyla ve test içinde üretilen imza sırrıyla koşar, CI'da Stripe'a ağ çağrısı yoktur. Sandbox anahtarı da commit'lenmez.
   - **Canlı anahtar asla commit'lenmez ve canlıya alma insan kararıdır:** Stripe hesabını açmak, canlı anahtarı girmek ve üretimde `stripe`'ı görünür yapmak. Otonom yapım bunların hiçbirini yapmaz.
   - **Stripe iGaming tedarikçisini reddedebilir** ya da hesabı sonradan kapatabilir (K16 notu, BL-01). Bu yüzden SWIFT ve kripto Stripe'a bağımlı değildir: Stripe kodu, SDK'sı, anahtarı ya da webhook'u olmadan çalışırlar. Stripe kapalıyken ve `STRIPE_PROVIDER=mock` iken iki elle yolun uçtan uca çalıştığı tm 382'de bir testle sabitlenir.

5. **Fiyat değişmez.** ADR-13'ün rakamları aynen geçerli: `unit_price_cents = 9900`, `ai_resolutions_included = 200`, `AI_OVERAGE_CENTS` (varsayılan 50). Para birimi USD (varsayım, BL-01 soru 3). Üç yol aynı faturayı aynı tutarla tahsil eder. Yöntem fiyatı değiştirmez: kripto indirimi ya da kart komisyonu yoktur.

6. **İki yüz.** Hangi sağlayıcının kiracıya görüneceği, SWIFT "ödendi" işareti ve kripto adres kuyruğu **root paneldedir** (`apps/admin`, tm 389.18): sağlayıcı aç/kapa, banka bilgisi, havaleyi "ödendi" işaretleme, adres verme, TXID onayı. **Kiracı paneli** (`/app/billing`, tm 382) yalnız açık yöntemlerden birini seçer, banka bilgisini ve referansı görür, kripto adres talebini açar ve talebin durumunu izler. Kiracı kendi ödemesini onaylayamaz.

7. **Faturaya ve iptale etkisi.** Faturada ödeme yöntemi ve referansı yer alır: SWIFT referansı, TXID ya da Stripe ödeme kimliği (BL-02, tm 383). İptal (BL-03, tm 384) sağlayıcı tarafında yalnız `stripe`'ta bir çağrı gerektirir. Elle yollarda iptal yalnız bizim taraftadır. İade yapılmaz (BL-03 karar 2).

## 3. Sonuçlar

- **Uyumlu kalan:** ADR-13'ün fiyat rakamları ve "gerçek ödeme yok" sınırı. **CLAUDE.md sınırı aynen tekrar edilir:** _Production deploy / DNS / TLS / gerçek secret / kart / ödeme YOK._ Bu yapımda gerçek para tahsil edilmez. Gerçek banka bilgisi, cüzdan adresi ya da Stripe anahtarı (canlı ya da sandbox) repoya girmez.
- **Değişen:** "Stripe MOCK" artık şu anlama geliyor: Stripe adaptörü kodlanır, ama otonom yapım ve CI onu yalnız mock/sandbox ile koşar. Mock kart yolu (`MockPaymentProvider`) varsayılan olarak kalır.
- **Varsayım:** `stripe` görünürlüğü varsayılan kapalı (madde 1), USDT tutarı USD cent'ten 1:1 (madde 3), anahtarı olmayan Stripe açılışı engellemez (madde 4).
- **Açık kalan (bu ekin kapsamı dışında, sahip kararı ister):** faturalandıran şirketin ülkesi ve buna bağlı vergi/e-belge metni (BL-01 soru 2, BL-02, K24'ün bilgi amaçlı PDF'i), USDT dışında bir varlık ya da ağ, otomatik zincir doğrulaması, başarısız ödemede yeniden deneme planının elle yollara nasıl uygulanacağı (tm 382).
- **Bu eki delen bir değişiklik** yeni bir ADR eki ve sahip kararı ister. Örnekler: canlı ödeme alınması, SWIFT/kriptonun Stripe'a bağlanması, fiyatın yönteme göre değişmesi, cüzdan adresinin otomatik gösterilmesi.

## 4. Kaynaklar

- `SiyahTus-Analiz/03-eklenebilecekler.md`: BL-01, BL-02, BL-03 satırları.
- `SiyahTus-Analiz/04-gerekceler-ve-sorular.md`: Karar kaydı K16, K19, K24, K27; "K16: Ödeme yöntemleri (SWIFT + kripto + Stripe)"; BL-01 netleştirilecek sorular 1–4 (K16, soru 4'ün "hayır" varsayılanını kripto lehine değiştirdi).
- `SiyahTus-Analiz/05-uygulama-rehberi.md`: BL-01, BL-02, BL-03 bölümleri; "Uygulayıcı için kurallar" madde 4.
- `docs/platform-admin/requirements.md` FR-ADMIN-14, `docs/platform-admin/design.md` (platform ayarları), `docs/platform-admin/gorev-yerlesimi.md` (276 ve 382–384 satırları).
