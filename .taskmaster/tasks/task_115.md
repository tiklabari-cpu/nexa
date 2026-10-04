# Task ID: 115

**Title:** NFR-A11Y1–6 — A11Y-OLC — WCAG 2.1 AA iddiasını otomatik taramayla ölç (axe) [XHIGH]

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** §7.2'nin A11Y1–6 satırı `✅` damgalı ama dayanağı yalnız klavye/⌘K kanıtı (Dilim 14, tm 18). GL-8 kapanış turunda (tm 114 · §F.1/3) ölçüldü: kod tabanında `axe` / `toHaveNoViolations` / `AxeBuilder` için **0 eşleşme**. Yani WCAG 2.1 AA iddiası otomatik olarak hiç doğrulanmadı — §F.1/3'ün "ölçülür, tahmin edilmez" kuralını bu NFR karşılamıyor.

**Details:**

GL-8 (tm 114) Faz-2 kapanış turunun §F.1/3 maddesinde bulundu; kapanışı bloklamadı çünkü A11Y bir `Should`/çapraz-kesit NFR'dir ve v2 kalem envanterinde satırı yoktur — §D89'a "kabul edilen borç" olarak yazıldı.

DOKUNULACAK: `apps/web` test kurulumu (`@axe-core/react` veya `vitest-axe`) ve/veya `apps/e2e` (`@axe-core/playwright`). Ürün kodu yalnız bulgu çıkarsa değişir.

ÖNERİLEN SIRA:
1. Bir tarayıcı seç: e2e tarafında `@axe-core/playwright` en yüksek getiriyi verir (gerçek DOM + gerçek stiller).
2. Kritik ekranları kapsa: SignIn · Inbox (3-pane) · Customers · Reports · Settings · Apps marketplace · Public KB.
3. Serious/critical ihlalleri **kapı** yap (exit != 0), moderate/minor'ı raporla.
4. Çıkan ihlalleri düzelt VEYA gerekçeli istisna listesine al (adlandırılmış, dar — `check-drift.ts`'in KNOWN_UNMODELLABLE deseni gibi).
5. §7.2 A11Y1–6 satırını ölçüme dayalı kanıtla tazele → `#### KA11Y` bloğu (CONVENTIONS §1.2: hücrede yalnız damga + `→ K…`).

TUZAK: `apps/e2e` sabit portlarda koşar, iki pencere aynı anda e2e koşamaz. e2e çıplak kabukta düşer — `set -a; . ./.env; set +a; pnpm -w test:e2e`.

NOT: bu görev A11Y damgasını `✅`'ten düşürmez; ölçüm gelene kadar damga elle kanıta dayanır ve bu durum §D89'da açıkça yazılıdır.

--- İZLENEBİLİRLİK DENETİMİ (tm 119 · 2026-08-11) — KARAR: PRD KARŞILIĞI BULUNDU ---
PRD KARŞILIĞI: **PRD §7.5 Erişilebilirlik (NFR-A11Y)** — `NFR-A11Y1` Standart: **WCAG 2.1 AA** (widget + panel),
2.2 hedefi · `NFR-A11Y2` renk bağımsız durum (1.4.1) · `NFR-A11Y3` **kontrast** (1.4.3) · `NFR-A11Y4` klavye (2.1.1)
· `NFR-A11Y5` odak & erişilebilir isim (2.4.7 / 4.1.2 / 2.5.8) · `NFR-A11Y6` ⌘K & liste (`role`/`aria-current`).
Görevin teslim ettiği iş bunların ÖLÇÜMÜDÜR ve bulduğu 62 ihlalin hepsi `color-contrast` = **NFR-A11Y3**.
PLAN KARŞILIĞI: **§7.2 NFR kapıları** tablosundaki `A11Y1–6 | WCAG 2.1 AA · klavye · ⌘K` satırı, damga `✅ → KA11Y`.
KANIT ZATEN YAZILI: `#### KA11Y` bloğu — 9 yüzeyde axe taraması (`apps/e2e/tests/a11y.ts` + `a11y.spec.ts`, 10 test),
ilk ölçüm 7/8 ekran KIRMIZI (62 düğüm), token düzeltmesi, ikinci ölçüm 9/9 blocking 0, `tokens.test.ts` (40) birim kilidi,
ve `⬜ Ölçülmeyen kalan` maddesi (yalnız chromium · axe AA'nın ~%57'si · moderate/minor kapı değil) — hepsi `tm 115` etiketli.
SONUÇ: kapsam sapması YOK. Kusur yalnız BAŞLIKTAYDI — `A11Y-OLC` bu depoda uydurulmuş bir kısaltma, PLAN'da geçmiyor;
PRD kodu `NFR-A11Y1–6` başlığa eklendi. PLAN damgası/satırı DEĞİŞMEDİ.

**Test Strategy:**

Kapı: `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w test` · `set -a; . ./.env; set +a; pnpm -w test:e2e` (hepsi exit 0).

KABUL KRİTERİ: (i) en az 7 kritik ekranda axe taraması koşuyor ve serious/critical ihlalde süit KIRMIZI oluyor (bilerek bozup doğrula); (ii) tarama çıktısı sayıyla HANDOFF'a yazıldı (ekran başına ihlal sayısı); (iii) §7.2 A11Y1–6 satırı `✅ → KA11Y` biçiminde ve `#### KA11Y` bloğu ölçümü içeriyor; (iv) istisnaya alınan her kural adıyla + gerekçesiyle listeli.
