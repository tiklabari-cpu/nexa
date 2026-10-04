# Task ID: 108

**Title:** §D82 (NFR-M4) — web-locale — @siyahtus/web'in 7 kırmızısı makine locale'ine bağlı: Intl varsayılan locale'i kullanıyor, testler en-US bekliyor

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** `apps/web/src/lib/format.ts` `Intl.NumberFormat(undefined)` ile ÇALIŞMA ORTAMININ varsayılan locale'ini kullanıyor; tr-TR bir makinede `$123,45` üretiyor, testler `$123.45` bekliyor. `pnpm -w test` bu yüzden bu makinede asla exit 0 vermiyor.

**Details:**

BULUNDUĞU TUR: tm 97.8 doğrulaması (ve daha önce 97.4/97.5/97.6 turlarında da "bilinen kırmızı" olarak not edilmişti — ama kök nedeni ilk kez burada yazılıyor).

KÖK NEDEN: `apps/web/src/lib/format.ts`
  - satır 22: `let activeLocale: string | undefined;` — i18n store `setFormatLocale()` çağırana kadar `undefined`.
  - satır 35: `new Intl.NumberFormat(locale).format(value)` ve satır 80: `new Intl.NumberFormat(locale, { style:'currency', currency }).format(cents/100)`.
  - `locale === undefined` → Intl **runtime'ın varsayılan locale'ini** kullanır = işletim sisteminin locale'i. Bu makine tr-TR → ondalık ayırıcı virgül → `$123,45`.
  - Testler (`ReportsPage.test.tsx:1284`, `BillingPage.test.tsx`) en-US biçimi bekliyor → 2 dosya / 7 test kırmızı.

SAYIM: `@siyahtus/web` 751 geçti / 7 kırmızı (2 dosya). Sayı turdan tura sabit; hiçbir ürün turu bunu değiştirmedi.

KARAR GEREKTİREN NOKTA (ikisinden biri, ürün kararı):
  (a) TESTLER pinlensin — test kurulumunda `setFormatLocale('en-US')` (veya vitest `environmentOptions`/`TZ`+`LANG` gibi) ile locale sabitlensin. En küçük değişiklik; ürün davranışı aynı kalır (kullanıcı locale'ine uyum KORUNUR).
  (b) ÜRÜN pinlensin — `format.ts` varsayılanı açıkça bir locale'e (ör. 'en-US') sabitlesin. Bu, i18n'in "kullanıcının locale'ine uy" davranışını değiştirir → PRD/i18n kararına aykırı olabilir, dikkatli düşünülmeli.
  ÖNERİ: (a). Testin amacı biçimlendirme mantığını doğrulamak, koşan makinenin locale'ini değil.

NEDEN ÖNEMLİ: CONVENTIONS §1 DoD kapısı `pnpm -w test` exit 0 istiyor. Bu 7 kırmızı durdukça HİÇBİR pencere o kutuyu dürüstçe işaretleyemez ve kapı gerçek regresyonları saklayan bir gürültüye dönüşür.

--- İZLENEBİLİRLİK DENETİMİ (tm 119 · 2026-08-11) — KARAR: PLAN KAYDI VAR, FR-MOD KARŞILIĞI YOK (kapsam sapması DEĞİL) ---
FR-MOD KARŞILIĞI: **YOK** ve olmamalı — bu görev ürün davranışı eklemedi. §D82'nin kaydettiği gibi seçenek (b)
(ürün varsayılanını `en-US`e sabitlemek) REDDEDİLDİ; `format.ts` DEĞİŞMEDİ. Değişen tek şey test kurulumu
(`vitest.setup.ts` → `setFormatLocale('en-US')` + `SIYAHTUS_TEST_RUNTIME_LOCALE` guard'ı + `format.locale-pin.test.ts`).
Bu yüzden NFR-I18N5 (Yerelleştirme — tarih/saat/para/sayı biçimleri) veya NFR-I18N2 (panel i18n) altına damga
yazmak YANLIŞ olurdu: o gereksinimleri karşılayan kod bu turda yazılmadı, zaten karşılanmışlardı (I18N1/2 → KI18N1-2).
GERÇEK KARŞILIK — NFR seviyesinde: **PRD §7.8 NFR-M4 (Test: unit + integration + contract + E2E)** ve onun
PLAN §7.2 kapısı `M4` satırı. İşin tamamı o kapının OBJEKTİFLİĞİNİ onarmakla ilgiliydi: `@siyahtus/web` 767/774 →
**779/779**, `pnpm -w test` bu makinede **ilk kez exit 0**. CONVENTIONS §1 "unit testler geçiyor (exit 0)"
kutusunun dürüstçe işaretlenebilmesi bu düzeltmeye bağlıydı.
PLAN KAYDI ZATEN VAR: **§D82** — kök neden, seçim gerekçesi, mutasyon doğrulaması ve "PLAN gereksinim satırı YOK"
kararı orada yazılı (§D80/§D81 emsali: sağlık taramasından doğan altyapı düzeltmeleri damga çevirmez, §D'ye yazılır).
NEDEN YENİ GEREKSİNİM SATIRI AÇILMADI: §D82 bu kararı gerekçesiyle birlikte zaten vermiş; şimdi bir damga satırı
açmak (i) o kaydı sessizce ters çevirir, (ii) ürün kodu değişmemişken bir gereksinimi "teslim edildi" gösterir —
CONVENTIONS §1.2'nin "✅ uydurma" yasağının tam da yasakladığı şey. Bkz. §D90.
SONUÇ: kapsam sapması DEĞİL, kayıtlı ve gerekçeli bir altyapı düzeltmesi. Kusur yalnız BAŞLIKTAYDI —
kimlik taşımadığı için tarama eşleştiremedi. Başlığa `§D82 (NFR-M4)` eklendi. Hiçbir damga değişmedi.

**Test Strategy:**

`pnpm --filter @siyahtus/web test` → 758/758 yeşil. Ek regresyon: locale'i değiştirerek (ör. `LANG`/`LC_ALL` veya store üzerinden `setFormatLocale('tr-TR')`) testin hâlâ geçtiğini göster — yoksa kusur yalnız bu makineden başka bir makineye taşınmış olur.
