# Task ID: 107

**Title:** 07.9-sched-f — test-fix — scheduled-reports:run "licence sızıntısı" testi TARİHE BAĞLI: sabit fixture tarihi vs script'in gerçek saati

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** `scheduled-reports-sweep.test.ts`'teki "the client the script itself constructs does not leak one licence into another" testi yalnız gerçek tarih 2026-08-08 iken geçebilir: fixture sabit `IN_PERIOD`e yazıyor, spawn edilen script ise gerçek saati kullanıyor.

**Details:**

BULUNDUĞU TUR: tm 97.8 (06.3.2-bulk-h). Bu tur `execFile('pnpm', …)` çağrılarına `shell: true` ekleyerek bu dosyadaki `scheduled-reports:run script` bloğunu bu makinede İLK KEZ gerçekten koşulur hale getirdi (önceden 5 test `spawn pnpm ENOENT` ile düşüyordu, yani ASLA çalışmamışlardı). Beş testin dördü yeşile döndü; bu biri gerçek bir kusuru ortaya çıkardı.

KÖK NEDEN:
  - `apps/api/test/integration/scheduled-reports-sweep.test.ts:53-54` — `NOW = 2026-08-08T09:00Z`, `IN_PERIOD = 2026-08-07T12:00Z`. `seedAssignedThread()` chat/thread'i `IN_PERIOD`e yazıyor.
  - Süreç-içi `sweep()` (aynı dosya:73) sweeper'a `{ now: NOW }` VERİYOR → önceki tam gün = 2026-08-07 = `IN_PERIOD`. Bu yüzden süreç-içi testler geçiyor.
  - `runScript()` ise gerçek CLI'ı spawn ediyor ve `apps/api/src/services/reports/scheduled-reports-run.ts:158` `const now = new Date()` — yani GERÇEK saat. 2026-08-09'da önceki tam gün 2026-08-08, `IN_PERIOD` (08-07) o pencerenin DIŞINDA kalıyor.
  - Sonuç: rapor "No rows for this period" ile geliyor, `expect(toA?.body).toContain('Agent a')` düşüyor.
  - Kardeş script testleri (`--apply delivers`, `dry-run`, üç tetikleme, vb.) yalnız `delivered/skipped/failed` sayılarına baktığı için VACUOUS geçiyor — "veri olmayan dönem yine de gönderilir" davranışı sayesinde. Yani sızıntı testi bu blokta gövde içeriğine bakan TEK test ve tarihe bağlı olan da o.

OLASI ÇÖZÜMLER (biri seçilecek):
  (a) `runScript` kullanan testler için fixture'ı GERÇEK saatin seçeceği döneme yaz (ör. `seedAssignedThread`'e opsiyonel zaman damgası; script blokları "dün 12:00 UTC" kullanır). En küçük değişiklik.
  (b) CLI'a test edilebilir bir saat girişi ekle (`--now` argümanı veya `SCHEDULED_REPORTS_NOW` env) ve testler onu pinlesin — süreç-içi testlerle aynı determinizm, ama ÜRÜN kodu değişir.
  DİKKAT: (a) seçilirse dönem sınırı UTC'dir; yerel saat (bu makinede UTC+3) ile hesaplamak gece yarısı civarı yeniden kırılganlık üretir.

KAPSAM NOTU: tm 97.8 bunu bilerek DÜZELTMEDİ (CONVENTIONS §5 — 07.9-sched-f alanına ait ayrı bir kusur, farklı kök neden). O tur yalnız `shell: true` onarımını yaptı; 6 kırmızıdan 5'i böylece kapandı.

--- İZLENEBİLİRLİK DENETİMİ (tm 119 · 2026-08-11) — KARAR: PLAN/PRD KARŞILIĞI BULUNDU ---
KALEM KİMLİĞİ: `07.9-sched-f` — "`scheduled-reports:run` operatör betiği + npm script (dry-run varsayılanı)"
(PLAN.md v2 atomik kırılım satırı + §G düz tablo satırı). Üst kalem: `07.9` **Zamanlanmış (scheduled)
rapor export** — PLAN §5.0 v2 kalem envanteri, damga `✅ → K07.9`.
PRD KARŞILIĞI: **PRD §5.3 (v2 kapsamı)** — "Reports (gelişmiş) … Team performance, **zamanlanmış export**,
Goals hunisi". FR-MOD tablosunda ayrı satır YOKTUR ve bu bilinçlidir: FR-MOD-07.7 yalnız "Export (CSV/PDF)"
diyor; `#### K07.9` bloğunun ilk cümlesi bunu zaten yazıyor — "Yalnız PRD §5.3'te; `zamanlanmış` ifadesi
FR-MOD tablosunda YOK → ayrı kalem. KK-türetilmiş." Yani kalem PRD'ye bağlıdır, ama bir FR-MOD kodu üzerinden değil.
KANIT ZATEN YAZILI: `#### K07.9` bloğunun son maddesi "**tm 107 düzeltmesi**" — betik bloğunun fixture'ı
artık gerçek saatten türetiliyor (`scriptPeriodAnchors`), `apps/api/test/integration/scheduled-reports-sweep.test.ts` (+2, 20).
SONUÇ: kapsam sapması YOK. Kusur yalnız BAŞLIKTAYDI — kalem kimliği taşımadığı için panelin PLAN taraması
eşleştiremedi. Başlığa `07.9-sched-f` eklendi. PLAN damgası/satırı DEĞİŞMEDİ (07.9 zaten `✅ → K07.9`).

**Test Strategy:**

`npx vitest run test/integration/scheduled-reports-sweep.test.ts` (apps/api, sourced .env, izole DB önerilir) → 19/19 yeşil. Ek regresyon: testin farklı bir takvim gününde de geçtiğini göster (ör. fixture'ı gerçek `now`'dan türeterek), yoksa kusur yalnız yer değiştirmiş olur.
