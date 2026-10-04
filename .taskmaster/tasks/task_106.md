# Task ID: 106

**Title:** e2e-widget-send — Widget'tan müşteri mesajı gönderimi TARAYICIDA kırık: 15 e2e testi düşüyor (API sağlam)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Widget iframe'inden mesaj gönderimi tarayıcıda başarısız: transkript boş kalıyor, optimistic mesaj geri alınıyor. Aynı akış doğrudan HTTP ile ÇALIŞIYOR (201), yani hata istemci tarafında. `visitorSends()` kullanan HER e2e testi düşüyor.

**Details:**

BULUNDUĞU TUR: tm 97.8 (06.3.2-bulk-h). Bu tur `apps/e2e/tests/global-setup.ts`'e `shell: true` ekleyerek e2e süitini bu makinede İLK KEZ koşulur hale getirdi; bu regresyon o anda görünür oldu. **tm 97.8'in kendi değişikliği ürün koduna DOKUNMUYOR** (`git diff` yalnız 2 api test dosyası + e2e harness + yeni spec), dolayısıyla bu regresyon ÖNCEDEN vardı ve e2e koşulamadığı için görülmemişti.

SEMPTOM: `apps/e2e/tests/fixtures.ts` `visitorSends()` → widget iframe'inde mesaj yazılıp Send'e basılıyor, ardından `role=log[name="Conversation"]` BOŞ kalıyor. `apps/widget/src/widget.ts:546-569` optimistic olarak mesajı hemen basıyor ve `api.send()` throw ederse geri alıyor (`state.events.filter(...)` + `transcript.replaceChildren()`), tam olarak gözlenen davranış bu → **`api.send()` tarayıcıda throw ediyor.** Widget `console.warn('siyahtus widget: send failed', error)` yazıyor (widget.ts:569) — İLK ADIM bu konsol çıktısını yakalamak olmalı.

API TARAFININ SAĞLAM OLDUĞU KANITLANDI (bu turda doğrudan HTTP ile, paylaşılan `siyahtus` DB'sine karşı):
  - `POST /api/v1/customer/token` → 200, `nxc1.…` token (hem `origin: http://localhost:5174` hem `http://acme-bikes.localhost:5174` ile)
  - `GET /api/v1/customer/chat` → 200 (geçerli token ile)
  - `POST /api/v1/customer/chat/events` → **201**, chat + event gerçekten yazıldı
  - CORS preflight `OPTIONS /api/v1/customer/chat/events` → 204, `access-control-allow-headers: authorization,content-type`, `allow-origin` doğru
  → Yani SSRF/CORS/token/route DEĞİL. Hata widget istemcisinde ya da widget dev sunucusunun servis ettiği bundle'da.

DÜŞEN TESTLER (2026-08-09, temiz kurulmuş izole DB + sourced .env; ayrıca paylaşılan DB'de birebir aynı):
  demo-flow.spec.ts:14 · customers.spec.ts:93 · widget.spec.ts:118 · widget.spec.ts:134 ·
  inbox-panel.spec.ts:58 · inbox-panel.spec.ts:114 · settings.spec.ts (composer shortcut + website widgets) ·
  skills-routing.spec.ts (2) · traffic.spec.ts · ve paylaşılan DB'de state kirliliğiyle birlikte customers.spec.ts:12/51/68
  Toplam: temiz DB'de 4/23 düşüyor (widget yolu), tam süitte 15/87.

ELENEN HİPOTEZLER (bu turda tek tek denendi): em-dash/çok baytlı karakter (ASCII metin gönderen `traffic.spec` de düşüyor) · CORS · customer token doğrulaması · SSRF guard · paylaşılan DB state kirliliği (sıfırdan migrate+seed edilmiş DB'de de düşüyor).

DİKKAT — ORTAM TUZAKLARI (bu turda pahalıya öğrenildi):
  1. `apps/rtm` kendi `.env`'ini YÜKLEMİYOR (apps/api'deki `loadEnvFile()` karşılığı yok). e2e'yi `set -a && . ./.env && set +a` ile koş, yoksa RTM ayağa kalkmaz ve Playwright 60 sn sonra webServer timeout verir.
  2. `reuseExistingServer: !CI` → portta KALAN bir dev sunucu varsa Playwright onu YENİDEN KULLANIR, env'i uyuşmasa bile. Bu, API'nin bir DB'ye, RTM'in BAŞKA bir DB'ye bakmasına yol açar ve gerçek olmayan hatalar üretir. Koşmadan önce 4000/4001/5173/5174'ü boşalt.
  3. Tam süit 10 dk'lık araç timeout'unu aşıyor → iki parçada koş.

**Test Strategy:**

İlk adım: Playwright ile widget iframe'inin `console` ve `requestfailed`/`response` olaylarını dinleyip `siyahtus widget: send failed` uyarısının taşıdığı hatayı ve varsa başarısız isteği yakala (tek atılık tanı scripti, sonra silinir). Ardından: `apps/widget/src/api.ts` `#request`/`send` yolunda hatanın nerede doğduğunu bul (401 → re-mint → sonsuz özyineleme riski widget.ts/api.ts:196-202'de ayrıca incelenmeli). Kapı: `demo-flow.spec.ts`, `widget.spec.ts`, `customers.spec.ts:93`, `inbox-panel.spec.ts`, `traffic.spec.ts`, `settings.spec.ts`, `skills-routing.spec.ts` yeşile döner; tam e2e süiti 87/87.
