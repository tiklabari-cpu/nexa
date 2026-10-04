# Task ID: 192

**Title:** F0-RPTLOW [SONNET-XHIGH] Rapor KPI kartlarinda dusuk-baz uyarisi (FR-MOD-07.3.2)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** PRD KK uc madde: "AI katilim kirilimi; billing AI resolution ile hizali; **dusuk-baz uyarisi**". Ilk ikisi karsilanmis; ucuncusu yok. `low_confidence` bayragi yalnizca SLA blogu icin uretiliyor ve UI`da yalnizca SLA kartinda gosteriliyor — Manual/Assisted/Automated ve Total cases kartlarinda ornek sayisi kac olursa olsun hicbir uyari cikmiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## (a) Bu isi doguran gerekce

tm 184.4 (M-TRACE-d · `cf9ad43`) PLAN.md damgalarini `prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci +
12 curutucu ajan) karsi yeniden okudu ve Faz-0`in 28 `Must` satirini `✅`ten `◐`ye indirdi; §F.00`in
mekanik kurali geregi ("bir faz ancak `Must` kapsaminda 0 ◐ ve 0 ⬜ kaldiginda kapanir") Faz-0 kapisi
`❌ ACIK`a dondu. tm 185 o 28 kalemi tek tek triyaj etti: 3 kalem denetimden SONRA kapanmisti (damga `✅`e
geri alindi), kalan 25 kalem is gorevine donusturuldu. Bu gorev o gorevlerden biridir.

Kapanis kosulu tek: **PRD kabul kriteri (KK)**. "Kod var + test yesil" YETMEZ — GL-3/GL-4/GL-8`in hatasi
tam olarak buydu ve M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti. Kanit blogu PLAN.md`nin
`## K. Kanit Gecmisi` bolumundedir (`#### K<kod>`), tablo hucresinde DEGIL (CONVENTIONS §1.2).

## (b) Eksik olan (olculdu, 2026-09-04)

- `apps/api/src/routes/reports.ts:573` — `low_confidence: totalChats + tickets < SLA_MINIMUM_SAMPLE_CASES`,
  yalniz **SLA** blogunda uretiliyor.
- `apps/web/src/features/reports/ReportsPage.tsx:745-747` — bayrak yalniz **SLA kartinda** render ediliyor.
- Ayni kavramin ikinci bir uygulamasi `services/staffing/staffing-forecast.ts` (`lowConfidence`, :169/:402/:410)
  ve `reports.ts:1400/:1414`te var. Yani depoda **iki** dusuk-baz dili mevcut; ucuncusunu ACMA — birini
  paylasilir hale getir.
- Split kartlari (`Manual`/`Assisted`/`Automated`) ve `Total cases` bu bayragi hic almiyor.

## (c) Yapilacak (contract-first)

1. **Esik karari.** SLA `SLA_MINIMUM_SAMPLE_CASES` kullaniyor. Split kartlari icin ayni esik dogru mu?
   Kart basina ornek sayisi (ornegin yalniz `Automated` vakalari) toplamdan kucuktur; esigi toplama mi
   yoksa karta mi baglayacagini KARARLASTIR ve gerekcesini koda yaz. Yanlis esik iki yonde de zarar verir:
   cok dusuk esik uyariyi gurultuye cevirir, cok yuksek esik yanlis sayiya guven verir.
2. **Sozlesme:** `GET /reports/overview` yanitindaki split blogu `low_confidence` (ya da kart basina
   `low_confidence`) tasir. OpenAPI + `@siyahtus/types` guncellenir; `pnpm -w contract:generate` sonrasi
   `git status --short packages/contract/src/generated` BOS. **Yeni YOL acilmiyor** (mevcut yanit
   semasina alan ekleniyor) — `apps/mobile` parity sayaci bozulmaz.
3. **UI:** SLA kartinin kullandigi ayni gosterge ve ayni i18n dili (`reports.overview.sla.lowConfidence`
   deseni) split kartlarina tasinir. Ikinci bir uyari bicimi ICAT ETME.
4. Uyari metni **neden** dusuk oldugunu soylemeli ("only N cases in this range"), yalniz bir ikon degil.

## (d) Bilinen tuzaklar

- Rapor fixture`lari kor olabiliyor: tm 178.3 (M-RPT-c) tam da "kor fixture" duzeltmisti — yeni testin
  fixture`i esigin ALTINDA ve USTUNDE iki ayri durum uretmeli, yoksa test her zaman yesil kalir ve
  hicbir sey kanitlamaz.
- `low_confidence` ile `required_agents: null` (staffing) AYRI kavramlar; kopyalarken anlamini tasima.
- Rapor gun kovalari hala UTC (`report-csv.ts`, tm 182.2 notu) — bu turda o karari degistirme.

## (e) Kapsam SINIRI

YALNIZ `FR-MOD-07.3.2`. `07.3.1`/`07.4`/`07.7`/`07.8` DISARIDA. Metrik TANIMLARI degismez —
bu is yalniz "bu sayiya guvenilir mi" isaretini ekler, sayiyi degistirmez (degistirirse regresyondur).

## Kapanista yapilacak PLAN.md guncellemesi

Bu ailenin TUM alt-gorevleri bittiginde ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine
`✅ → K<kod>` olur (PLAN.md §3, satir no `grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir
numaralari asagida yazili, dosya degistikce kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa
o satiri o alt-gorev cevirir. Kanit tablo hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde
olarak eklenir: `- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Faz-0 `Must` sayaci (PLAN.md:18 kapi tablosu) her kapanan satirda guncellenir.

**Test Strategy:**

OLCULEBILIR KAPI:
1. Integration (`apps/api/test/integration/reports*.test.ts`): esigin ALTINDA ornekle `low_confidence: true`,
   USTUNDE `false` — iki ayri `it`. Baslik `(FR-MOD-07.3.2)` etiketi tasir (CONVENTIONS §7).
2. `ReportsPage.test.tsx`: `low_confidence: true` gelen split kartinda uyari render ediliyor, `false` iken YOK.
3. Regresyon: SLA kartinin mevcut davranisi degismedi; split kartlarinin SAYILARI degismedi.
4. `pnpm audit:req-coverage` ciktisinda `FR-MOD-07.3.2` etiketli gorunuyor.
DoD: `pnpm -w typecheck` · `lint` · `format:check` · `build` · `contract:generate` sonrasi generated
senkron · api integration (§1.3 parcalama) · web (`--maxWorkers=4`) · `audit:req-coverage` — hepsi exit 0.
Kapanista PLAN.md`nin `07.3.2` satiri `◐ → K07.3.2` -> `✅ → K07.3.2` olur ve kanit `#### K07.3.2`
blogunun sonuna madde olarak eklenir.
