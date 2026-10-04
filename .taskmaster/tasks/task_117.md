# Task ID: 117

**Title:** NFR-I18N2 — Panel tema sağlayıcısı: açık tema hiçbir kullanıcıya ulaşmıyor [XHIGH]

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** PRD NFR-I18N2 'tema+i18n provider' istiyor; i18n yarısı teslim (tm 26), tema yarısı YOK. `apps/web/index.html:2` `data-theme="dark"`'ı sabit yazıyor ve çalışma zamanında bu özniteliği okuyan/yazan hiçbir kod yok — `tokens.css`'in tam açık tema rampası ile tm 115'in 40 açık-tema kontrast testi erişilemez bir yüzeyi koruyor.

**Details:**

(a) GEREKÇE VE KANIT (bu pencerede koda karşı ÖLÇÜLDÜ, 2026-08-11 · GRAF-ONARIM):
- `apps/web/index.html:2` → `<html lang="en" data-theme="dark">`. Öznitelik **sabit**.
- `apps/web/src/styles/tokens.css`: `:root` (satır 9) **tam açık tema** token seti · `[data-theme='dark']` (84) koyu override · `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }` (125-126). Yani CSS katmanı üç yolu da (açık varsayılan · açık zorlama · sistem tercihi) destekliyor; HTML'deki sabit öznitelik **üçünü de eziyor**.
- `apps/web/src` içinde `data-theme` geçen TEK dosya `styles/tokens.css`'i metin olarak parse eden `styles/tokens.test.ts`. Çalışma zamanında tema değiştiren kod **yok** — sağlayıcı, store, anahtar, düğme hiçbiri yok.
- Sonuç: (i) hiçbir kullanıcı açık temaya ulaşamıyor; (ii) tm 115'in `tokens.test.ts` içindeki **40 testinin açık tema yarısı** ve `:root` rampasının tamamı ölü yüzeyi koruyor; (iii) axe yalnız koyuyu tarıyor — HANDOFF tm 115 notu (3) ve `#### KA11Y`'nin `⬜` maddesi bunu ismen yazıyor.
- PRD kimliği: `urun-gereksinim-dokumani-PRD.md:804` → NFR-I18N2 "Panel i18n | En az TR/EN (genişletilebilir); **tema**+i18n provider (Emotion benzeri)". PLAN §7.2'nin I18N1/2 satırı `✅ → KI18N1-2` damgalı ama `#### KI18N1-2` kanıt bloğu **yalnız i18n** anlatıyor (katalog, t() fallback, dil değiştirici, format.ts) — tema payı için tek kelime yok. Damga, gereksinimin yarısını **fazla iddia ediyor** (§F.1/8 "bayat damga" deseni, §D55/§D89 emsali).

(b) DOKUNULACAK DOSYALAR:
- `apps/web/index.html` (sabit öznitelik) · YENİ `apps/web/src/lib/theme.ts` (sağlayıcı) · `apps/web/src/components/AppShell.tsx` (dil değiştirici **satır 253 + 288**'de; tema değiştirici onun yanına) · `apps/web/src/styles/tokens.css` (muhtemelen DEĞİŞMEZ — kontrol et, tm 115 değerleri AA'da kilitli) · `apps/web/src/styles/tokens.test.ts` (açık tema artık erişilebilir → testin iddiası güçlenir) · `apps/e2e/tests/a11y.spec.ts` + `a11y.ts` (taramayı iki temaya genişlet) · PLAN §7.2 I18N1/2 satırı + `#### KI18N1-2` bloğu + `#### KA11Y` (tek-tema notu) · HANDOFF.md.

(c) SIRA (contract-first):
Tercih **istemci-yerel** ise (ÖNERİLEN) kontrat/migration payı YOKTUR — `apps/web/src/lib/i18n.ts`'in birebir emsalini izle: zustand store + `localStorage` (`siyahtus.locale` → `siyahtus.theme`) + `LOCALES`/`LOCALE_NAMES` karşılığı `THEMES`/`THEME_NAMES` + `AppShell` hesap menüsünde `<select>`. Sıra: theme.ts + unit → AppShell düğmesi + unit → index.html boot yazımı → e2e + a11y iki tema → PLAN/HANDOFF.
Sunucuda kalıcı olmasına karar verilirse tam sıra zorunlu: openapi.yaml sözleşmesi → migration → backend + unit → typed client + frontend → E2E. Bu daha pahalıdır ve dil tercihi bile sunucuda tutulmuyor — **gerekçesiz seçme**; seçersen gerekçeyi HANDOFF'a yaz.

(d) BİLİNEN TUZAKLAR:
- **Varsayılan KOYU kalmalı.** `apps/e2e/kanit/*.png`'lerin tamamı koyu temada çekildi; varsayılanı "sistem tercihi"ne çevirmek Playwright/jsdom'un `prefers-color-scheme: light` varsayılanı yüzünden **bütün kanıt setini** açık temaya çevirir. Kullanıcı açıkça seçmedikçe koyu; `prefers-color-scheme`'e uymak istiyorsan bunu üçüncü bir "system" seçeneği yap, varsayılan yapma.
- Bu, §D82'nin (tm 108) makine-bağımlı test kırmızısıyla **aynı sınıf** kusurdur: koşan ortamın tercihi ürün davranışına sızarsa kapı, kodu değil dizüstünü ölçer. Tema testleri ortam tercihini **pinlemeli** (bkz. `vitest.setup.ts`'teki `SIYAHTUS_TEST_RUNTIME_LOCALE` deseni).
- **FOUC:** öznitelik ilk boyamadan ÖNCE yazılmalı (React mount'unda değil, `index.html` içinde satır-içi boot betiği veya `main.tsx`'in en tepesinde). Aksi halde koyu panelde bir kare beyaz çakar.
- `tokens.css` seçicisi `:root:not([data-theme='light'])` — açık temayı zorlamanın yolu özniteliği **`light` yazmaktır**, silmek değil (silmek sistem tercihine düşürür).
- `WidgetCustomization.tsx`'teki "theme" **müşteri widget'ının** `data-nx-theme`'i; **başka bir eksen**, tm 57'de teslim edildi. Karıştırma.
- axe'ı iki temada koşturmak a11y süresini ~iki katına çıkarır; `serious`/`critical` = KAPI kuralı **iki temada da** geçerli, `A11Y_EXCEPTIONS` **boş** kalmalı.
- Kanıt PNG churn'ü: tam e2e koşusu kanıtları tazeler → ayrı `chore(e2e)` commit'i (AGAC-TEMIZ dersi), kapanış commit'ine karıştırma; commit öncesi `apps/e2e/test-results/.last-run.json` `passed` olmalı.

(e) KAPSAM SINIRI — DOKUNMA:
Marka/kontrast token DEĞERLERİ (tm 115 bunları AA'da kilitledi; yeniden ayarlamak ihlal geri getirir) · müşteri widget'ının tema ekseni (`data-nx-theme`, `WidgetCustomization`, `@siyahtus/widget`) · Faz-3 görevleri (tm 79/81/82/83/84/90 — `deferred`, §D64 kullanıcı kararı) · tm 1-26 (K1) · i18n katalog içeriği · PLAN §D bloklarının geçmişi (append-only, yeni §D yaz).

**Test Strategy:**

Kapı (hepsi exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · `set -a; . ./.env; set +a; pnpm -w test:e2e`. Test sayısı DÜŞMEZ (taban: unit 3802 · integration 1906 · e2e 113 = 5821).

KABUL KRİTERİ (ölçülebilir, beşi de):
(i) unit — tema store'u kayıtlı tercihi `document.documentElement.dataset.theme`'e uyguluyor, tercih yokken varsayılan `dark`, `light` seçilince `light` yazılıyor ve `localStorage`'da kalıcı (`i18n.smoke.test.tsx` deseni);
(ii) e2e — panelde temayı değiştir → `dataset.theme` değişiyor VE sayfa yenilendikten sonra seçim korunuyor;
(iii) a11y — `a11y.spec.ts` her iki temada koşuyor, dokuz yüzeyin hepsinde `blocking 0`, `A11Y_EXCEPTIONS` boş; kapının kendisi hâlâ bilerek-bozma testiyle doğrulanıyor;
(iv) `apps/web/index.html` artık erişilemez bir tema dayatmıyor — ya öznitelik boot betiğince yazılıyor ya da tercihe göre üzerine yazılıyor (grep ile kanıtla: `data-theme` yazan çalışma-zamanı kodu artık VAR);
(v) PLAN §7.2 I18N1/2 damgası ile `#### KI18N1-2` bloğu tema yarısını **ismen** anlatıyor; `#### KA11Y`'nin "yalnız chromium/tek tema" notu güncelleniyor.
