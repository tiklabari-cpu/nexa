# Task ID: 201

**Title:** V2-RPTSALES — Sales rapor grubu bos: `tracked_sales` bagli degil (FR-MOD-07.7)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Reports > Sales sekmesi her zaman "not set up" okuyor. `buildSalesReport` (reports.ts:948-965) sabit `configured:false` iskeleti donduruyor; oysa AYNI dosyadaki `trackedSalesBlock` (:810-833) ayni pencerede ayni `tracked_sales` tablosundan gercek figur okuyabiliyor. Yani veri var, rapor grubu baglanmamis — kullanici Reviews sekmesinde satis rakami gorup Sales sekmesinde "yapilandirilmamis" okuyabiliyor. Denetim 07.7 icin "Iki eksik" diyor ama metin kaynaginda kesik; okunabilen birincisi budur, ikincisi 201.3`te PRD satirindan yeniden turetilecek.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## (a) Bu isi doguran gerekce

tm 184.4 (M-TRACE-d · `cf9ad43`) PLAN.md damgalarini `prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci +
12 curutucu ajan, iki tur adversaryal) karsi yeniden okudu ve v2 §5.0`in 8 satirini `✅`ten `◐`ye indirdi;
v2`de `Must` OLMADIGI icin §F.00`in *sayac* kurali degil **kalem kurali** gecerlidir ("23 acik kalemin
hepsi ✅ oldugunda Faz-2 kapanir") ve kapi `❌ ACIK`a dondu. tm 187 (V2-REOPEN) once kalem kuralinin ic
celiskisini cozdu (payda **23 SABIT**; `08.9.2/.3/.5` paydanin disindadir ve ucu de gercekten ✅ — G1
`3127638` denetimin D1 bulgusunu denetim gunu kapatmisti), sonra 8 kalemi triyaj etti: **3 kalem** yanlis
dusurulmustu (`08.5.7` · `08.9.3` · `08.9.5`, SIRALAMA tuzagi) ve `✅`e geri alindi, **5 kalem** is
gorevine donusturuldu. Bu gorev o gorevlerden biridir.

Kapanis kosulu tek: **PRD kabul kriteri (KK)**. "Kod var + test yesil" YETMEZ — GL-3/GL-4/GL-8`in hatasi
tam olarak buydu ve M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti. Kanit blogu PLAN.md`nin
`## K. Kanit Gecmisi` bolumundedir (`#### K<kod>`), tablo hucresinde DEGIL (CONVENTIONS §1.2).

**Denetim metni KAYNAGINDA KIRIK — ona guvenme.** `prd-uyum-denetimi.md` Ek A`nin "Eksik olan" hucresi
`…` ile kesiliyor. Asagidaki maddeler tm 187 turunda `grep`/`sed` ile KODA KARSI dogrulandi,
denetimden kopyalanmadi.

## (b) Kapsanan PLAN satiri

| PLAN satir (2026-09-04) | Kod | Kanit blogu | Alt-gorev |
| --- | --- | --- | --- |
| 1269 (§5.0) | 07.7 | `#### K07.7-b` | 201.1 · 201.2 · 201.3 |

**PRD KK (satir 591):** _"Izin bazli gorunurluk; export; benchmark karsilastirma"_. Aciklama sutunu yedi
parca sayiyor: Leads · Cases · Sales · Team performance · Export (CSV/PDF) · benchmark · Save view.

## (c) Dokunulacak dosyalar

- `apps/api/src/routes/reports.ts` — `buildSalesReport` (:948), emsal `trackedSalesBlock` (:810),
  `withBenchmark` sarmali, `?format=csv|pdf` dali (:1703).
- `apps/api/src/routes/reports-export.ts` — `REPORT_GROUPS` (`{id:"sales"}` :49 ZATEN VAR), `buildGroupCsv`.
- `apps/web/src/features/reports/ReportsPage.tsx` — `ReportsSales` arayuzu (:208) ve `SalesTab` (:539).
  Dosyanin kendi yorumu (:203-206) bugunku durumu dogru anlatiyor; **duzeltilince o yorum da guncellenir.**
- `packages/contract/openapi/` — yanit sekli degisirse (`configured` artik dinamik).

## (d) Bilinen tuzaklar

1. **`tracked_sales` lisans-kapsamli ve RLS altinda.** `trackedSalesSummary` deseni birebir izlenir;
   para birimi siparisten DEGIL `sales_tracker_settings`ten okunur (`amount_cents` yalniz tek kod
   altinda toplanabilir — `:829-832` gerekcesi).
2. **`configured:false` YOK EDILMEZ.** Sales tracker kapaliysa rapor durustce "kurulmamis" demeye devam
   etmeli; degisen sey, ACIKKEN de oyle demesi.
3. `buildSalesReport` `withBenchmark` icinde: onceki pencere karsilastirmasi (PRD KK "benchmark") gercek
   figurlerle de calismali, yalniz `null`larla degil.
4. Alt-gorev sirasi: **201.1 -> 201.2 -> 201.3.** 201.2 web sekmesini 201.1`in donduruguyle besliyor.

## (e) Kapsam SINIRI

- YALNIZ `07.7`. `13.5` (Sales tracker`in kendisi) zaten `✅` — damgasina DOKUNMA.
- Odeme/kart/gercek magaza entegrasyonu YOK (CLAUDE.md siniri); kaynak var olan `tracked_sales` tablosudur.

## Kapanista yapilacak PLAN.md guncellemesi

PLAN.md §5.0 (v2 kalem envanteri) icindeki ilgili satirin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur.
Satir no `grep -n` ile bulunur — 2026-09-04 itibariyle: PLAN.md:1269 (§5.0 satiri). Kanit tablo hucresine
YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Ayrica **iki sayac** guncellenir cunku v2 kalem kuraldir, sayac degil:
(1) §5.0 basligindaki `0 ⬜ · 5 ◐ · 22 ✅ · 3 ⛔` satiri, (2) ust kapi tablosunun Faz-2 satiri (PLAN.md:22).

Kapanis dogrulamasi: `grep -n "| 07.7 " PLAN.md` cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

Aile ancak UC alt-gorevin hepsi kendi kapisindan gectikten sonra done.

GENEL KAPI (tum alt-gorevlerde ayni):
- TAM DoD kapisi (CONVENTIONS §1), exit code`lariyla. Test suiti §1.3 geregi parcalanabilir.
- Yeni/degisen test basliklari `(FR-MOD-...)` etiketi tasir (§7); `pnpm audit:req-coverage` exit 0.
- Kontrat degistiyse `pnpm -w contract:generate` sonrasi `git status --short packages/contract/src/generated`
  BOS. **`apps/mobile` parite testi tam uc sayisini pinliyor** — yeni bir OpenAPI yolu eklersen o sayaci
  yorumla birlikte bump et, yoksa mobil suiti kirmizi verir.
- Migration eklendiyse `pnpm -w db:check-drift` exit 0.

AILE KAPISI:
1. `pnpm --filter @siyahtus/api test` icinde: sales tracker ACIKKEN `GET /reports/sales` `configured:true`
   ve `tracked_sales`/`attributed_revenue_cents` degerleri ayni pencerede `GET /reports/reviews`in
   `ecommerce` blogundaki degerlerle **birebir esit** (iki yuzeyin ayni tablodan ayni cevabi vermesi
   bu kalemin asil iddiasi).
2. `?format=csv` ve `?format=pdf` sales grubu icin bos degil, satir sayisi rapor gövdesiyle tutarli.
3. `pnpm --filter @siyahtus/web test`: `SalesTab` gercek figur render ediyor; sales tracker kapaliyken
   "not configured" bos-durumu KORUNUYOR (regresyon).
4. `grep -n "| 07.7 " PLAN.md` durum-damgali satirlarinda `◐` kalmamis olmali.

## Subtasks

### 201.1. V2-RPTSALES-a [SONNET-XHIGH] `buildSalesReport` gercek figur dondursun (FR-MOD-07.7)

**Status:** done  
**Dependencies:** None  

`buildSalesReport` `tracked_sales`i okusun: sales tracker acikken `configured:true` + gercek `tracked_sales` / `attributed_revenue_cents` / `currency`, kapaliyken bugunku durust "kurulmamis" iskeleti. `conversions` alani da doldurulur (bugun her zaman `null`).

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`apps/api/src/routes/reports.ts:948-965` — `buildSalesReport` `withBenchmark` sarmalinin icine
SABIT bir nesne veriyor: `configured:false, tracked_sales:null, attributed_revenue_cents:null,
currency:null, conversions:null`. `tx` parametresi gövdede hic kullanilmiyor.

## Yapilacak

1. Emsal `trackedSalesBlock` (`:810-833`): `tx.salesTrackerSettings.findFirst()` -> `enabled` degilse
   bugunku iskelet; acikken `trackedSalesSummary(tx, licenseId, from, to)` + `settings.currency`.
   AYNI deseni kullan, ikinci bir okuma yolu YAZMA — iki yuzeyin ayrisma riski tam da bu kalemin konusu.
2. `conversions`: `goal_achievements`in ayni penceredeki sayimi (`achieved_at` araligi, lisans-kapsamli).
   `GoalAchievement` `UNIQUE(goal_id, customer_id)` tasidigi icin sayim sisirilmez.
3. `withBenchmark` onceki pencereyi de gercek figurle karsilastirsin (PRD KK "benchmark").
4. Kontrat: `configured` artik dinamik; `packages/contract/openapi/` yanit semasi bunu zaten
   nullable tipliyorsa yeni yol/alan GEREKMEZ — degisiklik varsa `contract:generate` + generated senkron.

## Bilinen tuzaklar

- Para birimi **ayarlardan** okunur, siparisten degil (`:829-832` gerekcesi).
- `tracked_sales` RLS altinda lisans-kapsamli; `withTenant` disina cikma.
- `reports.ts` cok buyuk; `buildSalesReport` disina tasma (07.4/07.5 fonksiyonlarina dokunma).

### 201.2. V2-RPTSALES-b [SONNET-XHIGH] Sales sekmesi + CSV/PDF export gercek figuru gostersin (FR-MOD-07.7)

**Status:** done  
**Dependencies:** None  

201.1 gercek figur donduruyor; bu alt-gorev onu kullaniciya ulastirir — `SalesTab` render eder, `buildGroupCsv`in `sales` dali ve `?format=pdf` bos olmayan tablo uretir.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`apps/web/src/features/reports/ReportsPage.tsx:203-206` yorumu bugunku gercegi anlatiyor:
_"No sales/order source exists yet, so `configured` is always `false`"_. `SalesTab` (:539) bu
varsayimla yazilmis. `REPORT_GROUPS`ta `{id:"sales"}` (`reports-export.ts:49`) ZATEN var, yani
export yolu aciktir — donen govde bos oldugu icin ciktisi anlamsizdir.

## Yapilacak

1. `ReportsSales` arayuzu 201.1`in yanitiyla hizalanir (typed client uzerinden, elle tip YAZMA).
2. `SalesTab`: acikken KPI kartlari (tracked sales · attributed revenue · conversions) + benchmark
   karsilastirmasi; KAPALIYKEN bugunku `salesNotConfigured` bos-durumu + Settings kisayolu KORUNUR.
3. `buildGroupCsv`in `sales` dali: sutun basliklari `cases`/`leads` dallarinin bicimini izler.
4. `?format=pdf` sales icin `toPdf(group.label, headers, rows)` ile bos olmayan tablo uretir.
5. Dosya basindaki (:203-206) yorum guncellenir — bayat bir yorum bir sonraki pencereyi yaniltir.
6. Metinler `en` + `tr` iki locale`e de eklenir (eksik anahtar testte yakalanir).

## Bilinen tuzaklar

- `GROUP_GATED_TABS` (:306) `sales`i zaten iceriyor — izin kapisi ikinci katman, KALDIRMA.
- `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.
- Para birimi bicimlendirmesi locale`e gore degisir; sabit `$` yazma.

### 201.3. V2-RPTSALES-c [OPUS-XHIGH] 07.7`nin okunamayan ikinci payini PRD satirindan yeniden turet

**Status:** done  
**Dependencies:** None  

Denetim 07.7 icin "Iki eksik" diyor ama metin kaynaginda `…` ile kesik ve tam hali belgede YOK. Bu alt-gorev kalan payi denetimden degil **PRD satirindan** yeniden turetir, koda karsi dogrular ve ya kapatir ya da gerekceyle `◐` birakir. `✅` UYDURULMAZ.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Neden ayri bir alt-gorev

tm 185 ayni durumu `194.2` (`FR-MOD-10.2`) icin yasadi ve ayni bicimde cozdu: kesik gerekce, KK`ya
karsi yeniden turetme, ihlal bulunamayinca `✅` uydurmama. Emsal odur.

## Yapilacak

1. PRD satiri (`urun-gereksinim-dokumani-PRD.md`:591) yedi parcaya ayrilir ve **her biri** koda karsi
   tek tek dogrulanir: Leads · Cases · Sales · Team performance · Export (CSV/PDF) · benchmark ·
   Save view. KK sutunu: _"Izin bazli gorunurluk; export; benchmark karsilastirma"_.
2. tm 187 turunda ZATEN dogrulanmis olanlar (tekrar etme, yalniz regresyon kontrolu):
   PDF export `reports.ts:1703-1713` **var** · Save view `ReportsPage.tsx` **var** ·
   Cases/Leads/Team performance rapor gruplari `REPORT_GROUPS`ta **var** · Sales -> 201.1/201.2.
3. Kalan supheli tek parca **benchmark**tir: `withBenchmark` her grup icin mi calisiyor, yoksa
   yalniz bazilarinda mi? PRD KK`si "benchmark karsilastirma"yi kosulsuz istiyor.
4. Bir ihlal bulunursa: ya bu pencerede kapat (kucukse), ya da yeni bir gorev ac ve `◐` birak.
   Ihlal bulunmazsa damgayi `✅`e cevir ve **neyin arandigini** `#### K07.7-b`ye yaz — bir sonraki
   denetim ayni kesik metni gorup ayni soruyu sifirdan sormasin.

## Bilinen tuzaklar

- Denetim metnine guvenme, KESIK. Olcut PRD KK sutunu + kod.
- `07.7`nin bir de v1 satiri var (`PLAN.md:651`, `◐ → K07.7`) — o v1 payidir, **bu gorevin kapsaminda
  DEGIL** (v1 triyaji tm 186`da yapildi ve o satir `Must` olmadigi icin kapi bloklamiyor). Dokunma.
