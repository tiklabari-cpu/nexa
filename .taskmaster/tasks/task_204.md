# Task ID: 204

**Title:** V2-GOALPRED — Hedef tanim dili tek yukleme sikismis: satis/lead/cozum hunisi ifade edilemiyor (FR-MOD-13.3)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Denetim `13.3` icin "huni + hedef tanimi + rapor entegrasyonu tam calisiyor" diyor; eksik olan hedef tanim dilidir: tek yuklem `url_contains`. `GoalBuilder.tsx:35` formda yalnizca o alani sunuyor, `goal-matching.ts` baska hicbir yuklem tanimiyor ve `GoalService.evaluate` yalniz `pageUrls` aliyor. Sonuc: PRD satirinin adlandirdigi **satis/lead/cozum** hunisi bugun ifade EDILEMIYOR — bir satis hedefi `tracked_sales`i, bir lead hedefi `customers.is_lead`i, bir cozum hedefi kapanan sohbeti okumak zorunda ve ucu de URL degil.

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
| 1286 (§5.0) | 13.3 | `#### K13.3` | 204.1 · 204.2 |

**PRD (satir 715).** KK: _"3 asamali huni; hedef tanimi; rapor entegrasyonu"_. Aciklama:
_"Goals — ziyaretci→sohbet→donusum hunisi (**satis/lead/cozum**); Create goal; Reports Achieved goals"_.
Eksik KK sutunundan degil Aciklama sutunundan geliyor — tm 185`in `02.3.5`/`04.1` emsali geregi yine de
is olarak acildi.

## (c) Dokunulacak dosyalar

- `apps/api/src/services/goals/goal-matching.ts` — `urlNeedle` · `hasGoalTrigger` · `matchesGoal`
  (saf cekirdek; yeni yuklemler BURAYA gider, servise DEGIL).
- `apps/api/src/services/goals/goal-service.ts` — `evaluate` (:150, bugun yalniz `pageUrls` aliyor) ·
  `create`/`update`in `hasGoalTrigger` kapilari (:76, :113).
- `apps/web/src/features/goals/GoalBuilder.tsx` (:35) · `GoalsPage.tsx`.
- `packages/contract/openapi/` — `GoalDefinition` semasi.
- **Emsal:** kampanya tetikleme motoru (`campaign-matching.ts`) — ayni sekil, bilerek.

## (d) Bilinen tuzaklar

1. **`goal_achievements` idempotency kisiti korunur:** `UNIQUE(goal_id, customer_id)` + `skipDuplicates`.
   Yeni yuklemler bunu DEGISTIRMEZ — bir kisi bir hedefe bir kez ulasir.
2. **`campaign_sends.converted` bagi korunur:** `evaluate` yalniz GERCEKTEN yeni satir yazildiginda
   (`written.count > 0`) kampanya donusumunu isaretliyor; iki sayi birbiriyle celismemeli (`03.3.3`).
3. **`definition` serbest `jsonb` ve savunmaci okunuyor:** okunamayan bir tanim bir HATA degil, "kimsenin
   ulasamadigi bir hedef"tir (dosyanin kendi gerekcesi — bir bozuk satir o calisma alanindaki OBUR
   hedeflerin kaydini durdurmamali). Yeni yuklemler ayni sozlesmeyi tasir.
4. **VE semantigi:** bugun "set edilen her yuklem tutmali (AND)" ve "hicbir sey set edilmemisse kimse
   ulasamaz". Yeni yuklemler bu kurali bozmamali.
5. `evaluate` bugun **sayfa goruntuleme** yolundan cagriliyor. Satis/cozum yuklemleri baska bir anda
   olusur (siparis girisi, sohbet kapanisi) — tetikleme noktalarinin da eklenmesi gerekir; bu 204.1`in
   en riskli parcasidir ve gerekcesi yazilmalidir.
6. Alt-gorev sirasi: **204.1 -> 204.2** (UI, motorun kabul ettigi yuklem kumesini sunar).

## (e) Kapsam SINIRI

- YALNIZ `13.3`. `13.5` (Sales tracker) ve `03.3.3` (kampanya donusumu) zaten `✅` — okunur, degistirilmez.
- Gorsel kural/akis kurucusu YOK (`13.4` ⛔ ADR-14). Yuklemler forma alan olarak eklenir, node/edge tuvali
  YAPILMAZ.
- Yeni yuklem KUMESI PRD`nin uc huni turuyle sinirli tutulur (satis · lead · cozum); "her sey icin bir
  kural motoru" kapsam disidir.

## Kapanista yapilacak PLAN.md guncellemesi

PLAN.md §5.0 (v2 kalem envanteri) icindeki ilgili satirin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur.
Satir no `grep -n` ile bulunur — 2026-09-04 itibariyle: PLAN.md:1286 (§5.0 satiri). Kanit tablo hucresine
YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Ayrica **iki sayac** guncellenir cunku v2 kalem kuraldir, sayac degil:
(1) §5.0 basligindaki `0 ⬜ · 5 ◐ · 22 ✅ · 3 ⛔` satiri, (2) ust kapi tablosunun Faz-2 satiri (PLAN.md:22).

Kapanis dogrulamasi: `grep -n "| 13.3 " PLAN.md` cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

Aile ancak IKI alt-gorevin ikisi de kendi kapisindan gectikten sonra done.

GENEL KAPI (tum alt-gorevlerde ayni):
- TAM DoD kapisi (CONVENTIONS §1), exit code`lariyla. Test suiti §1.3 geregi parcalanabilir.
- Yeni/degisen test basliklari `(FR-MOD-...)` etiketi tasir (§7); `pnpm audit:req-coverage` exit 0.
- Kontrat degistiyse `pnpm -w contract:generate` sonrasi `git status --short packages/contract/src/generated`
  BOS. **`apps/mobile` parite testi tam uc sayisini pinliyor** — yeni bir OpenAPI yolu eklersen o sayaci
  yorumla birlikte bump et, yoksa mobil suiti kirmizi verir.
- Migration eklendiyse `pnpm -w db:check-drift` exit 0.

AILE KAPISI:
1. Uc huni turunun ucu de tanimlanabiliyor ve dogru anda kaydediliyor: **satis** (`tracked_sales`
   siparisi), **lead** (`customers.is_lead`), **cozum** (sohbet kapanisi).
2. `UNIQUE(goal_id, customer_id)` hala tutuyor: ayni kisi ayni hedefe iki kez ulasamiyor (sayi sismiyor).
3. `url_contains` hedefleri **aynen** calisiyor (regresyon) — mevcut `goal-matching.test.ts` yesil.
4. Reports "Achieved goals" yeni turleri de sayiyor.
5. `grep -n "| 13.3 " PLAN.md` §5.0 satirinda `◐` kalmamis olmali.

## Subtasks

### 204.1. V2-GOALPRED-a [OPUS-XHIGH] Matcher + tetikleme noktalari: satis/lead/cozum yuklemleri (FR-MOD-13.3)

**Status:** done  
**Dependencies:** None  

Saf cekirdege (`goal-matching.ts`) URL disi yuklemler eklenir ve bunlarin olustugu anlar `GoalService.evaluate`e baglanir. Bugun `evaluate` yalniz `pageUrls` aliyor ve yalniz sayfa goruntuleme yolundan cagriliyor — satis ve cozum baska anlarda olusur.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `goal-matching.ts` — `urlNeedle(definition)` yalniz `definition.url_contains`i okuyor;
  `hasGoalTrigger` = `urlNeedle(...) !== null`; `matchesGoal` yalniz sayfa listesine bakiyor.
- `goal-service.ts:150-156` — `evaluate(tx, tenant, customerId, pageUrls, now)`; `pageUrls` bos ise
  hemen `0` donuyor, yani sayfa goruntuleme disi hicbir olay hedef kaydedemez.
- Sonuc: PRD`nin "satis/lead/cozum" hunisi **ifade edilemiyor**.

## Yapilacak

1. **Kontrat once:** `GoalDefinition` semasi genisletilir (ornek `sale` · `lead` · `resolution`
   yuklemleri). Alan adlari `campaign-matching.ts`in bicimini izler; uydurma isim uretme.
2. `goal-matching.ts`: her yuklem icin saf bir okuyucu + `matchesGoal`a ek. **VE semantigi korunur**
   (set edilen her yuklem tutmali; hicbiri set edilmemisse kimse ulasamaz). `hasGoalTrigger` artik
   "en az bir kullanilabilir yuklem var mi" sorusunu tum yuklem kumesi uzerinden cevaplar.
3. `evaluate`in imzasi genisletilir: sayfa listesinin yani sira olayin **turu** ve baglami
   (siparis/lead/kapanan sohbet) gecilir. `pageUrls.length === 0` erken cikisi yalniz sayfa-yuklemli
   hedefler icin gecerli kalmali — aksi halde satis hedefi asla degerlendirilmez (**en olasi hata budur**).
4. Tetikleme noktalari baglanir: `tracked_sales` siparis girisi · lead isaretlenmesi · sohbet kapanisi.
   Her biri `evaluate`i **commit sonrasi** cagirir (G1`in `dispatchAgentReply` karari emsal).
5. Idempotency ve kampanya bagi AYNEN korunur (`skipDuplicates`, `written.count > 0` kosulu).

## Bilinen tuzaklar

- `definition` serbest `jsonb`: okunamayan tanim HATA degil, bos sonuctur. Bir bozuk satir obur
  hedeflerin kaydini durdurmamali (dosyanin mevcut gerekcesi).
- Migration gerekiyorsa CONVENTIONS §6.3: genislet -> tasi -> daralt; `NOT NULL` + `DEFAULT`siz YASAK.
- Yeni OpenAPI **yolu** eklersen `apps/mobile` parite sayaci kirilir (yalniz sema genisletmek guvenli).

### 204.2. V2-GOALPRED-b [SONNET-XHIGH] GoalBuilder yeni yuklemleri sunsun + Reports sayimi (FR-MOD-13.3)

**Status:** done  
**Dependencies:** None  

204.1`in motoru kabul ettigi yuklemleri kullaniciya acar: `GoalBuilder.tsx` bugun yalnizca `url_contains` alanini sunuyor, yani motor yeni yuklemleri anlasa bile hicbir admin onlari tanimlayamaz. Reports "Achieved goals" sayimi da yeni turleri kapsamali.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`apps/web/src/features/goals/GoalBuilder.tsx:35` — `initial: { name: "", url_contains: "" }`,
ve `:38` dogrulama yalniz o alani zorunlu kiliyor. `:96-98` tek girdi. Yani form, motorun
yuklem kumesiyle birebir kilitli: 204.1 bittiginde bile UI eski.

## Yapilacak

1. Form huni turunu secmeyi sunar (URL · satis · lead · cozum) ve secilen ture gore alanlari gosterir.
2. **Dogrulama sunucuyla AYNI esikte** olmali — istemci daha darsa kullanici sunucunun kabul edecegi
   bir hedefi tanimlayamaz (kayitli tuzak: form validator kendi ucuyla ayni olmali). `hasGoalTrigger`in
   kurali ("en az bir kullanilabilir yuklem") istemcide de aynen gecerli.
3. `GoalsPage` listesi hedefin turunu okunabilir bicimde gosterir (bugun `definition.url_contains`
   ham gosteriliyor); tanimsiz/eski satirlar patlamadan render olur.
4. Reports "Achieved goals" yeni turleri de sayar (`GoalsTab` / rapor grubu).
5. Metinler `en` + `tr` iki locale`e de eklenir.

## Bilinen tuzaklar

- Eski (`url_contains`) hedefler formda **duzenlenebilir** kalmali; tur secimi onlari bozmamali.
- `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.
- Gorsel akis kurucusu YAPILMAZ (`13.4` ⛔ ADR-14) — yalniz form alanlari.
