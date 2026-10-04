# Task ID: 119

**Title:** IZLENEBILIRLIK — PLAN karşılığı bulunamayan 4 görevin (107/108/115/118) plan bağı denetlendi ve kuruldu

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Panelin sağlık taraması 4 Task Master görevinin PLAN.md tam metninde hiçbir karşılığını bulamadı (tm 107 · 108 · 115 · 118). PLAN §1.1 "PRD kimliği olmayan iş yapılmaz" der; izlenemeyen görev ne faz kapanışında sayılır ne kapsam denetiminden geçer. Bu görev dördünü tek tek PRD/PLAN'a karşı denetler ve kararını kaydeder. KOD YAZILMAZ.

**Details:**

BULGU KAYNAĞI: panel sağlık taraması (izlenemeyen görev). Yalnız izlenebilirlik denetimi — ürün kodu değişmez.

KARARLAR (her biri ayrı gerekçelendirildi, "hepsi geçerli" denmedi):
- **tm 107 → BULUNDU** — kalem `07.9-sched-f` (üst kalem `07.9`, PLAN §5.0, `✅ → K07.9`); PRD §5.3 v2 kapsamı
  ("zamanlanmış export"), FR-MOD tablosunda bilinçli olarak satırı yok (KK-türetilmiş, K07.9 ilk cümlesi).
  Kanıt zaten `#### K07.9` sonunda ("tm 107 düzeltmesi"). Başlığa kimlik eklendi; damga değişmedi.
- **tm 108 → FR-MOD YOK, PLAN KAYDI VAR (§D82)** — ürün kodu değişmedi, yalnız test kurulumu pinlendi;
  NFR karşılığı PRD §7.8 **NFR-M4** ve PLAN §7.2 `M4` kapısı (kapı objektifliği: `pnpm -w test` ilk kez exit 0).
  Yeni gereksinim satırı AÇILMADI — §D82 bu kararı gerekçesiyle vermiş; ürün kodu değişmemişken damga çevirmek
  CONVENTIONS §1.2'nin yasakladığı "✅ uydurma" olurdu. Başlığa `§D82 (NFR-M4)` eklendi.
- **tm 115 → BULUNDU** — PRD §7.5 `NFR-A11Y1–6` (bulunan 62 ihlalin hepsi `color-contrast` = NFR-A11Y3);
  PLAN §7.2 `A11Y1–6` satırı `✅ → KA11Y`, kanıt `#### KA11Y` bloğunda tm 115 etiketli. Başlığa PRD kodu eklendi.
- **tm 118 → BULUNAMADI, GERÇEK SAPMA** — PRD ve PLAN tam metninde `prettier`/`format:check`/`kod stili` için
  0 eşleşme. İş gerekli (üç pencere borcu adlandırdı, hiçbiri kapatmadı; hep-kırmızı script sinyal değil gürültü)
  → PLAN §7.2'ye türetilmiş `M-FMT` gereksinim satırı `⬜` eklendi + sapma kaydı §D90. İptal EDİLMEDİ.

DOKUNULAN: `.taskmaster/tasks/tasks.json` (4 başlık + 4 details + bu görev) · `PLAN.md` (§7.2 `M-FMT` satırı,
§D90 sapma kaydı) · `HANDOFF.md`. Ürün kodu, damga, sayaç DEĞİŞMEDİ.

**Test Strategy:**

Kabul kriteri (izlenebilirlik denetimi — kod kapısı değil):
1. Dört görevin başlığındaki kimlik PLAN.md tam metninde eşleşiyor:
   `grep -c "07.9-sched-f" PLAN.md` > 0 · `grep -c "D82" PLAN.md` > 0 · `grep -c "A11Y1–6" PLAN.md` > 0 ·
   `grep -c "M-FMT" PLAN.md` > 0.
2. `node -e "JSON.parse(require('fs').readFileSync('.taskmaster/tasks/tasks.json','utf8'))"` hatasız.
3. Yeni/değişen PLAN tablo satırı CONVENTIONS §1.2 biçiminde (hücrede yalnız damga + referans) ve
   plan-row-length eşiğinin altında.
4. `git diff --stat` yalnız `.taskmaster/tasks/tasks.json` · `PLAN.md` · `HANDOFF.md` gösterir — ürün kodu 0 dosya.
NOT: ürün kodu değişmediği için `pnpm -w test` / `test:integration` / `test:e2e` yeniden koşulmadı; koşulanlar
HANDOFF'ta adıyla yazılıdır.
