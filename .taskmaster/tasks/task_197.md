# Task ID: 197

**Title:** V1-SKILLEDIT — Skill editorunun uc kapali kalemi (FR-MOD-06.2.1 · 06.2.2 · 06.2.4)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim v1`in uc skill-editor kalemini KISMI buldu; ucu de ayni dosyada (`apps/web/src/features/playbook/SkillEditor.tsx`) ve ucu de PRD kabul kriterinde ismen yazili: (1) ust barda Run log paneli / Skill active toggle / kaydedilmemiste cikis uyarisi yok, (2) bos isim istemci tarafinda engellenmiyor, (3) editor adim YAZAMIYOR — adim eklenemiyor, silinemiyor, turu degistirilemiyor ve `transfer_to_team` disindaki bes adim tipinin parametreleri duzenlenemiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## (a) Bu isi doguran gerekce

tm 184.4 (M-TRACE-d · `cf9ad43`) PLAN.md damgalarini `prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci +
12 curutucu ajan) karsi yeniden okudu ve v1`in 11 `Must` satirini `✅`ten `◐`ye indirdi; §F.00`in mekanik
kurali geregi ("bir faz ancak `Must` kapsaminda 0 ◐ ve 0 ⬜ kaldiginda kapanir") v1 kapisi `❌ ACIK`a dondu.
tm 186 o 11 kalemi tek tek triyaj etti: `08.5.5` denetimden SONRA kapanmisti (G1), `05.1` ve `05.3`in
kalan bosluklari **ADR-14 ile kapsam disi** cikti (damga `✅`e alindi), kalan 8 kalem is gorevine
donusturuldu. Bu gorev o gorevlerden biridir.

Kapanis kosulu tek: **PRD kabul kriteri (KK)**. "Kod var + test yesil" YETMEZ — GL-3/GL-4/GL-8`in hatasi
tam olarak buydu ve M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti. Kanit blogu PLAN.md`nin
`## K. Kanit Gecmisi` bolumundedir (`#### K<kod>`), tablo hucresinde DEGIL (CONVENTIONS §1.2).

**Denetim metni KIRIK — ona guvenme.** `prd-uyum-denetimi.md` Ek A`nin "Eksik olan" hucresi kaynagında
`…` ile kesiliyor (ornek: `FR-MOD-06.2.4` "Eksikler…"). Karar PRD`nin KK sutununa + koda karsi verilir;
asagidaki "Eksik olan" maddeleri tm 186 turunda `grep`/`sed` ile FIILEN dogrulandi, denetimden
kopyalanmadi.

## (b) Kapsanan PLAN satirlari

| PLAN satir (2026-09-04) | Kod | Kanit blogu | Alt-gorev |
| --- | --- | --- | --- |
| 580 | 06.2.1 | `#### K06.2.1` | 197.2 |
| 581 | 06.2.2 | `#### K06.2.2` | 197.1 |
| 583 | 06.2.4 | `#### K06.2.4` | 197.3 |

## (c) Dokunulacak dosyalar

- `apps/web/src/features/playbook/SkillEditor.tsx` — UCUNUN DE tek dosyasi.
- `apps/web/src/features/playbook/step-reorder.ts` — saf adim mantigi (`moveStep`/`stepIssues`);
  yeni saf yardimcilar (ekle/sil/tur degistir) buraya gider, bilesene DEGIL.
- `apps/api/src/routes/playbook.ts` — `GET /skills/:skillId/runs` (:447) zaten VAR ve testli;
  `PATCH /skills/:skillId` (active toggle) ve `requireValidSteps` da var.
- `apps/web/src/features/playbook/types.ts` — `SkillStep` / `SkillLogEntry`.

## (d) SIRA KISITI — bu bir tercih degil

Uc alt-gorev de ayni dosyayi buyuk olcude yeniden yaziyor. **Id sirasinda kos: 197.1 -> 197.2 -> 197.3.**
197.1 en kucuk (tek satirlik kapi + test), 197.3 en buyuk (adim listesinin tamami). Tersten koşulursa
197.3`un yeniden yazdigi bolge 197.1/197.2`nin degisikligini yutar ve iki pencere ayni isi iki kez yapar.

## Kapsam SINIRI

`06.2.3` (talimat textarea) ve `06.2.5` (Preview) zaten `✅` — damgalarina DOKUNMA, ama `06.2.5`in
preview akisi 197.3`te adim listesi degisince REGRESYONA girebilir: `SkillEditor.test.tsx`in mevcut
preview testleri yesil kalmali.

## Kapanista yapilacak PLAN.md guncellemesi

Ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur (PLAN.md §4.1/4.2/4.3; satir no
`grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir numaralari yukarida yazili, dosya degistikce
kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa o satiri o alt-gorev cevirir. Kanit tablo
hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
v1 `Must` sayaci (PLAN.md:19 kapi tablosu) her kapanan satirda guncellenir.

Kapanis dogrulamasi: `grep -n "| 06.2.1 \|| 06.2.2 \|| 06.2.4 " PLAN.md`
cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

Aile ancak uc alt-gorevin ucu de DoD kapisindan gectiginde done. Her alt-gorevin kendi olculebilir kriteri kendi `testStrategy`sinde. Kapanista `grep -n "| 06.2.1 \|| 06.2.2 \|| 06.2.4 " PLAN.md` cikan durum-damgali satirlarda `◐` KALMAMALI.

## Subtasks

### 197.1. V1-SKILLEDIT-a [SONNET-XHIGH] Bos isim kaydedilemesin — istemci kapisi (FR-MOD-06.2.2)

**Status:** done  
**Dependencies:** None  

PRD KK tek cumle: "Bos isim kaydedilemez". Sunucu bunu zaten reddediyor (`z.string().trim().min(1)`), ama web editorunde `canSave` isim alanina hic bakmiyor — ismi silen admin AKTIF bir Save butonu goruyor, basiyor ve 400 aliyor. Kabul kriteri "kaydedilemez" diyor; bugunku davranis "kaydedilir gibi durur, sonra patlar".

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`SkillEditor.tsx:174` — `const canSave = dirty && issues.length === 0 && !save.isPending;`
`name` bu ifadede hic gecmiyor. `dirty` (:166-167) ismin DEGISTIGINI goruyor, BOS oldugunu degil.

## Yapilacak

1. `canSave` isim kapisini da tasisin: `name.trim().length > 0`. Esik SUNUCUYLA AYNI olmali —
   `createSkillBody`/`updateSkillBody` `z.string().trim().min(1)` diyor, yani `trim` sonrasi bos.
   Istemci sunucudan DAHA DAR olursa kullanici sunucunun kabul edecegi bir ismi yazamaz (bu tuzagin
   kayitli emsali var: "form validator kendi ucuyla ayni olmali").
2. Neden devre disi oldugu gorunur olsun: adim sorunlari icin zaten `role="alert"` bir ozet var
   (`playbook.editor.fixIssues`, :244-248). Bos isim icin de ayni desende bir uyari cikar —
   sessizce devre disi bir buton a11y acisindan aciklanamayan bir cikmaz sokaktir.
3. Metin `en` + `tr` iki locale`e de eklenir (depo kurali; eksik anahtar testte yakalanir).

## Bilinen tuzaklar

- Yalnizca `disabled` koymak yetmez: ekran okuyucu icin sebep okunabilir olmali.
- `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.

## Kapsam SINIRI

Yalniz isim kapisi. Ust bar (197.2) ve adim yazarligi (197.3) bu alt-gorevin disinda.

### 197.2. V1-SKILLEDIT-b [OPUS-XHIGH] Editor ust bari: Run log paneli + Skill active toggle + kaydedilmemiste cikis uyarisi (FR-MOD-06.2.1)

**Status:** done  
**Dependencies:** None  

PRD satiri ust barin icerigini sayiyor: "Run log (N run ▾) + Skill active toggle + … + Save changes", KK ise "Dirty/saving/saved; kaydedilmemiste cikis uyarisi; run log denetim". Bugun ust barda yalniz Compile + Save var. Run log ucu (`GET /skills/:skillId/runs`) VAR ve testli ama webde TEK TUKETICISI YOK; active toggle yalniz liste satirinda; kaydedilmemiste cikis uyarisi hic yok.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- **Run log paneli YOK.** `apps/api/src/routes/playbook.ts:447` `GET /skills/:skillId/runs`
  calisiyor ve `apps/web`de tek cagiran yok. Run log yalniz mobilde salt-okunur gosteriliyor.
- **Active toggle editorde YOK.** Liste satirinda canli toggle var (`PlaybookPage.tsx`), editorde
  yok — admin bir skill`i acip duzenledikten sonra acmak icin listeye geri donmek zorunda.
- **Kaydedilmemiste cikis uyarisi YOK.** `SkillEditor.tsx`te `beforeunload` ya da rota-birakma
  engeli gecen tek satir yok; `dirty` (:166) hesaplaniyor ama yalniz `canSave`i besliyor.

## Yapilacak

1. **Run log paneli.** Ust barda "N run ▾" — acilinca son kosular: zaman, sonuc
   (`answered`/`handed_off`/`skipped`), tetikleyen sohbete baglanti. Ucun donen alanlarini
   `playbook.ts:447-480`ten oku, YENI UC ACMA. Bos durum ("bu skill hic kosmadi") ayrica render
   edilir — bos dikdortgen birakma (EK-B.1 deseni).
2. **Active toggle.** Ayni `PATCH /skills/:skillId` ile; listedeki toggle`in davranisiyla BIREBIR
   ayni olmali (ayni iyimser guncelleme, ayni hata geri alma). Iki farkli davranis ayni urunde iki
   toggle demektir. `readiness` kapisi (bilgi + aktif skill sarti, `dafda3c`) burada da gecerli:
   liste hangi kosulda toggle`i blokluyorsa editor de bloklar.
3. **Kaydedilmemiste cikis uyarisi.** `dirty === true` iken sayfadan/rotadan ayrilma uyarisi.
   Tarayici `beforeunload` + uygulama ici rota degisimi AYRI iki yol — ikisi de kapatilir, yoksa
   uyari yalniz sekme kapatmada cikar ve asil kayip (baska module tiklama) sessizce olur.

## Bilinen tuzaklar

- `beforeunload` jsdom`da guvenilir test edilmez; uyari mantigini SAF bir yardimciya ayir
  (`shouldWarnOnLeave(dirty, saving)`) ve onu test et, dinleyicinin kaydini ayrica iddia et.
- Run log bir polling kaynagi ekliyorsa `staleTime` ver; her acilista yeniden cekme editorun altinda
  gorunmez bir istek firtinasi yaratir.
- Kosu satirindaki sohbet baglantisi arsivlenmis bir sohbete gidebilir — 404 degil, arsiv gorunumu.
- `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.

## Kapsam SINIRI

Yalniz ust bar. Adim listesi 197.3`un isi. `…` (fazla) menusunun ICERIGI (kopyala/sil) PRD`de
sayilmamis — acma; acarsan `#### K06.2.1` blogunda gerekcesini yaz.

### 197.3. V1-SKILLEDIT-c [OPUS-XHIGH] Adim yazarligi: akordeon + adim ekle/sil/tur degistir + tipe ozel parametreler (FR-MOD-06.2.4)

**Status:** done  
**Dependencies:** None  

En agir kalem. PRD satiri "Ordered steps (akordeon, reorder) — detect-intent / request-info / tag / summarize / send-message / transfer-to-team". Reorder (surukle + ↑/↓ + aria-live) ve zorunlu-parametre kapisi VAR ve testli. Eksik olan YAZARLIK: editor adim EKLEYEMIYOR, SILEMIYOR, TURUNU DEGISTIREMIYOR ve `transfer_to_team` disindaki bes tipin parametrelerini duzenleyemiyor. Sonuc: "New skill" `steps: []` ile aciliyor (playbook.ts:322) ve UI`dan ASLA adim kazanamiyor — Ordered steps yuzeyi yeni bir skill icin fiilen kullanilamaz.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `SkillEditor.tsx:296-378` adim listesini render ediyor: surukle-birak, ↑/↓, sira numarasi,
  `describeStepText`, `entry.step.type` etiketi. Duzenlenebilen TEK alan `transfer_to_team`in
  `group`u (:326-345). Diger bes tipin parametreleri (`intent`/`phrases`, `field`/`prompt`, `tag`,
  `source`/`text`) SALT OKUNUR.
- Ekle/sil butonu yok; tur degistirme yok; akordeon (ac/kapa) yok — her adim tek satirlik ozet.
- `POST /skills` `steps: body.steps ? requireValidSteps(body.steps) : []` (playbook.ts:303) —
  UI govdede `steps` gondermiyor, yani her yeni skill BOS adimla dogar.
- `PATCH /skills/:id` govdesi `{ name, instruction, steps }` (SkillEditor.tsx:162) ve `steps`
  yalnizca `moveStep`in yeniden siraladigi AYNI kumedir.

## Yapilacak

1. **Akordeon.** Her adim acilip kapanir; kapaliyken bugunku ozet satiri, acikken o tipin
   parametre formu. Ac/kapa klavyeyle erisilebilir ve `aria-expanded` tasir.
2. **Ekle / sil / tur degistir.** Alti tip icin "adim ekle" (tip secimi); her satirda sil.
   Tur degisince o tipin gerektirmedigi alanlar DUSURULUR — yoksa `requireValidSteps` sunucuda
   reddeder ve kullanici sebebini goremez.
3. **Tipe ozel parametre formlari.** Kaynak: `packages/types` `SkillStep` + `apps/api`
   `requireValidSteps`. Istemci kapisi (`stepIssues`) sunucunun kabul ettiginden DAHA DAR olmamali.
4. Saf mantik `step-reorder.ts` yaninda saf yardimcilara gider (`addStep`/`removeStep`/`changeStepType`),
   bilesene degil — mevcut `moveStep`/`stepIssues` deseni aynen surdurulur.

## Bilinen tuzaklar

- **Surukle-birak + akordeon catisir.** Acik bir adimin ici surukleme baslatmamali; `draggable`
  yalnizca tutamacta olmali, yoksa metin secmek satiri suruklemeye baslar.
- **Klavye alternatifi korunmali (NFR-A11Y4).** ↑/↓ butonlari ve `aria-live` duyurusu bugun VAR ve
  testli; yeniden yazarken kaybolmasi bir regresyondur.
- **`06.2.5` Preview regresyonu.** `SkillEditor.test.tsx`in preview testleri (tm 181.9) yesil kalmali.
- Adim id`leri (`entry.id`) React anahtaridir; ekleme/silmede yeniden kullanilirsa liste karisir.
- `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.

## Kapsam SINIRI

Alti adim tipi PRD ile birebir — YEDINCI TIP EKLEME. Dogal dil -> adim derlemesi (`compile`) zaten
var ve `06.2.3`un isi; ona dokunma.
