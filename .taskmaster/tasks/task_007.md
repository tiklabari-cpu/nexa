# Task ID: 7

**Title:** 08.5.2-b — Website widgets ekrani + dogrulama sinyali

**Status:** done

**Dependencies:** 5 ✓

**Priority:** high

**Description:** PRD: + Add website / Install code manually / Invite developer; site tablosu (per-row get code / remove); Customize widget girisi; platform ikonlari. PRD KK2 ayrica kod yerlestikten sonra 'test message received' dogrulama sinyali istiyor — bu Nexa iyilestirmesi, taklit degil.

**Details:**

apps/web/src/features/settings altina. Snippet </body> oncesine yerlesir ve mevcut widget loader'i ile uyumlu olmali (apps/widget/src/loader.ts, window.__lc). Trusted domains (08.9.1, Dilim 2'de teslim) ile ayni domain listesini gostermeye dikkat — iki ayri kaynak olmasin.

PRD: FR-MOD-08.5.2 (KK1, KK2) · PLAN.md §3.7 · Dilim 13

[günlük 2026-07-24 12:49 UTC] plan: Website widgets ekrani (08.5.2-b). Yer: apps/web/src/features/settings, yeni WebsiteWidgets.tsx bolumu SettingsPage'in EN USTUNE. (1) useQuery /websites refetchInterval~5sn (Connected gecisini canli yakala). (2) Add website formu: domain + platform(manual/platform) -> POST /websites SONRA POST /settings/trusted-domains (idempotent, already-exists yut) -> iki query invalidate. KARAR: 'iki ayri kaynak olmasin' -> API primitifleri tek amacli kalir (tm6 degismez), UI is akisini birlestirir: site ekleyince trusted domain de eklenir, widget hemen calisir, tek ekleme yolu. (3) Site tablosu: domain, platform ikon (manual=kod / platform=fis; setup manual|platform oldugu icin Shopify/WP/GTM ayrimi yok - tm6 notu), status Pending(gri)/Connected(yesil ✓ 'test message received' = KK2 dogrulama sinyali), per-row Get code (snippet reveal+copy) / Remove (DELETE /websites/:id). (4) Install code manually: website.snippet (API'den, window.__nexa+loader.js) kod blogu + copy. (5) Invite developer: mailto snippet (ben gondermem, kullanici). (6) Customize widget: giris (placeholder/disabled - ekran yok). E2E settings.spec.ts: acme-bikes.localhost icin site ekle -> demo.html yukle (handshake, tm6 markWebsiteConnected) -> ekranda Connected + sinyal; trusted domains ile ikili kaynak yok dogrula. kanit/7-*.png. Owner access_rules:rw var.

[günlük 2026-07-24 13:07 UTC] bitti: Website widgets ekrani (08.5.2-b). apps/web/src/features/settings/WebsiteWidgets.tsx + SettingsPage'e en uste eklendi. Ozellikler: Add website formu (domain + install method manual/platform), site tablosu (platform ikon, status, Get code/Remove), snippet paneli (Copy code + Invite developer=mailto), Customize widget girisi (disabled placeholder). KARAR (iki ayri kaynak olmasin): Add website -> POST /websites + POST /settings/trusted-domains (idempotent), API primitifleri tek amacli kalir, UI birlestirir; TrustedDomains aciklamasi guncellendi. KK2 dogrulama sinyali: status connected olunca yesil 'Connected' + 'Test message received'; liste 5sn poll + reload ile canli. E2E settings.spec.ts: unique widget-check-<ts>.localhost site ekle -> demo.html'de mesaj gonder (handshake, tm6 markWebsiteConnected) -> reload -> Connected+sinyal; trusted domains'te de gorunur (ikili kaynak yok). Cleanup: website+trusted domain ikisi de silinir. BUG (test): StatusDot glyph+label ayni elemanda -> getByText exact:true match etmez; exact kaldirildi. Seed her tenant icin connected website olusturuyor (seed.ts:211) -> mevcut 'shows acme-bikes' testi Trusted domains region'a scope edildi. Testler: web 33+typecheck+lint, e2e 27 (tum suite), demo login OK. Kanit: kanit/7-website-pending.png (snippet+Waiting), 7-website-connected.png (Connected+sinyal).

**Test Strategy:**

Kabul: snippet </body> oncesine yerlesir; kod calisinca status Connected'a doner VE 'test message received' dogrulama sinyali gorunur (KK2). Playwright: sahte sayfaya snippet enjekte -> handshake -> UI'da Connected. Trusted domains ile ikili domain kaynagi olusmadigi dogrulanir.
