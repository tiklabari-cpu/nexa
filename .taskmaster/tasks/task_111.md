# Task ID: 111

**Title:** 13.2-l [OPUS-XHIGH] `visits.came_from` yazma yolu: referrer'ı widget'tan servise kadar bağla (13.2 satırını ✅'ya taşır)

**Status:** done

**Dependencies:** 73 ✓

**Priority:** medium

**Description:** `CustomerService.recordPageView` bir `referrer` parametresi kabul ediyor ama tek çağıranı (`POST /customer/chat`, apps/api/src/routes/customer.ts) onu hiç geçirmiyor; widget da göndermiyor ve kontratta alan yok. Sonuç: `visits.came_from` ürünün üretebildiği HER ziyaret için null — 13.2-j'nin "Came from …" panel satırı ve 13.2-f'nin `came_from_contains` filtresi (altı filtreden biri) ÖLÜ. Bu boşluk 13.2-k'nin uçtan uca doğrulamasında bulundu (tm 73.11).

**Details:**

13.2-l — `visits.came_from` yazma yolu  [OPUS-XHIGH]

PRD: FR-MOD-13.2 (+ NFR-S9 · NFR-S6)
NEDEN AÇIK: tm 73.11 (13.2-k) uçtan uca doğrulamasında ölçüldü. `apps/api/src/services/customers/customer-service.ts` `recordPageView(input.referrer)` → `cameFrom` yazıyor; `apps/api/src/routes/customer.ts` (satır ~336-349) yalnız `{customerId, url, userAgent, ip}` geçiyor. Repo genelinde `cameFrom`'a yazan tek yer test fixture'ları (`apps/api/test/integration/traffic.test.ts` seedVisit). Yani hem `CustomerDetailPanel`'in "Came from …" satırı hem `GET /traffic?came_from_contains=` hiçbir gerçek ziyaretçide çalışmıyor.

KAPSAM: referrer'ı uçtan uca bağla — (1) loader (`apps/widget/src/loader.ts`) host sayfanın `document.referrer`'ını frame parametresi olarak geçirir (host sayfada çalışan tek kod odur; cross-origin frame içinde `document.referrer` origin'e kırpılır, bkz. `hostPageUrl` notu); (2) widget (`apps/widget/src/widget.ts`) `POST /customer/chat` gövdesine katkısal `referrer` alanı ekler; (3) OpenAPI + `@siyahtus/types` sözleşmesi (contract-first: önce kontrat, `.strict()` şema, ≤2048); (4) rota `recordPageView`'a geçirir. PII/uyum kararı BURADA verilir ve PLAN §C'ye yazılır: referrer bir dış URL'dir, query string'i token/e-posta taşıyabilir — `hostPageUrl`'ün "query+fragment düşürülür" kararıyla tutarlı olarak yalnız origin+path saklanmalı mı, yoksa tamamı mı (NFR-S9). Panelde zaten link olarak değil düz metin render ediliyor, o karar korunur.

KAPSAM DIŞI: yeni analitik/attribution özelliği (kampanya UTM ayrıştırma vb.) · `visits` şemasında değişiklik (alan zaten var) · panelin/filtrenin UI'ını değiştirmek (ikisi de teslim, yalnız veri yok).

KK DOĞRULAMA: e2e — bir sayfadan demo host sayfasına gelen ziyaretçi mesaj gönderdiğinde 360° panelde "Came from <referrer>" görünür (link DEĞİL, düz metin) · e2e/integration — `GET /traffic?came_from_contains=<parça>` o ziyaretçiyi döndürür, eşleşmeyen parça döndürmez · referrer yoksa (doğrudan giriş) `came_from` null kalır ve panel satırı sessizce yok · cross-tenant negatif korunur. Kapandığında `PLAN.md` 13.2 satırı `◐ → ✅` yapılır ve K13.2'ye madde eklenir.

BAĞLAM: PLAN.md §K K13.2 son iki maddesi (13.2-k teslim + AÇIK KALAN). DoD kapısı CONVENTIONS.md.

**Test Strategy:**

integration: `POST /customer/chat` gövdesindeki `referrer` `visits.came_from`'a yazılıyor · referrer yokken null kalıyor · 2048 sınırı kırpıyor · `.strict()` şema bilinmeyen anahtarı 400 · cross-tenant sızıntı yok · unit (widget): loader host `document.referrer`'ı frame parametresine koyuyor, widget onu gövdeye taşıyor · e2e: 360° panelde "Came from …" düz metin görünür + `came_from_contains` filtresi o ziyaretçiyi bulur · DoD tam sürüm: typecheck + lint + unit + integration + build + e2e
