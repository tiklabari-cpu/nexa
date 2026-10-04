# Task ID: 187

**Title:** V2-REOPEN (PRD §5.3) — v2`nin yeniden acilan 8 kaleminin triyaji + kalem kurali celiskisinin cozumu [OPUS-XHIGH]

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** tm 184.4 sonrasi Faz-2`nin kalem kurali kapisi ❌ ACIK (0 ⬜ · 8 ◐ · 19 ✅). Bu gorev once kapinin ic celiskisini cozer (`08.9.2/.3/.5` paydadan "zaten ✅" diye cikarilmisti ama .3 ve .5 artik `◐`), sonra 8 kalemin her biri icin "tamamla / kapsami daralt" kararini verir ve isi Task Master`a aktarir. Kod yazilmaz.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §4. Sinirlar `CLAUDE.md`.

## (a) Bu gorevi doguran gerekce ve kanit

Panelin saglik taramasi 2026-09-04`te run-loop.sh`in secilebilir gorev bulamadigini bildirdi.
Teshis (olculdu, bu turda): `.taskmaster/tasks/tasks.json`da 184 ust gorevin ve 497 alt gorevin
HEPSI `done`. blocked/deferred YOK · bagimlilik dongusu YOK · var olmayan id`ye bagimlilik YOK
(0 kirik referans) · PLAN.md §G duz tablolarinin 184 tm referansinin hepsi aktarilmis (0 eksik).
Yani graf bozuk DEGIL, backlog TUKENDI.

Ama is bitmedi. tm 184.4 (M-TRACE-d · commit `cf9ad43`) PLAN.md damgalarini
`prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci + 12 curutucu ajan) karsi yeniden okudu ve
UC FAZ KAPISINI yeniden acti (PLAN.md satir 18-22 kapi tablosu + satir 36-66 guncelleme
paragraflari). O tur kararini BILEREK bir sonraki tura birakti — PLAN.md:48-50 birebir:
"28 kalemin `tamamla mi, kapsami daralt + yeni kaleme mi ayir` karari (§F.00`in iki yolu)
bilerek bu turda verilMEDI — bir sonraki tur, ya tek tek kapatarak (M-TEAM/M-CAMP/M-UI
ailelerinin izledigi desen) ya da formel bir GL turu acarak."

Bu gorev O turdur.

Bu gorevin payi: **v2 / Faz 2 (PRD §5.3)**. v2`de `Must` YOKTUR (PRD`de v2 kalemlerinin hepsi
`Should`/`Could`) -> §F.00`in *sayac* kurali uygulanamaz, yerine **kalem kurali** gecerlidir:
"23 acik kalemin hepsi ✅ oldugunda Faz-2 kapanir" (PLAN.md:3567-3570). tm 184.4 sonrasi durum
**0 ⬜ · 8 ◐ · 19 ✅** (PLAN.md satir 20 + §5.0).

## (b) Dokunulacak dosyalar

- `.taskmaster/tasks/tasks.json` — asil cikti.
- `PLAN.md` §5.0 (satir 1133-2164) — damga YALNIZCA "kapsami daralt" kararinda degisir.
- `PLAN.md` satir 20 (kapi tablosu Faz-2 satiri) + satir 3567-3570 (kalem kurali) — asagidaki
  celiski cozuldugunde ikisi de guncellenir.
- `HANDOFF.md` — tur girisi.
- KOD/MIGRATION/TEST YAZILMAZ.

## Triyaj edilecek 8 acik kalem (PLAN.md §5.0 · satir no 2026-09-04 itibariyle)

| PLAN satir | Kod | Kanit blogu |
| --- | --- | --- |
| 1158 | 07.7 | `#### K07.7-b` |
| 1160 | 08.5.7 | `#### K08.5.7` |
| 1165 | 08.9.3 | `#### K08.9.3` |
| 1166 | 08.9.5 | `#### K08.9.5` |
| 1169 | 09.2 | `#### K09.2-b` |
| 1171 | 09.4 | `#### K09.4` |
| 1174 | 13.2 | `#### K13.2` |
| 1175 | 13.3 | `#### K13.3` |

## ONCE COZULECEK CELISKI (bu turun ilk isi)

PLAN.md:3567-3570`teki v2 kalem kurali soyle diyor: "`13.4` ⛔ (ADR-14) ve **`08.9.2/.3/.5` ✅
(GL-5/6/7) sayima girmez**." Ama tm 184.4 tam da `08.9.3` ve `08.9.5`i `◐`ye indirdi. Yani
kapinin paydasindan "zaten ✅" diye cikarilan iki kalem artik ✅ degil. Bu ic celiski KARAR
ISTER ve 8 kalemin triyajindan ONCE cozulmelidir:
  (i) ikisi sayima geri girer -> payda 23`ten 25`e cikar, ya da
  (ii) GL-5/6/7`nin o gun kapattigi pay ile denetimin actigi pay farkli seylerdir ve ayri
       kalem olarak yazilir (§F.00`in "kapsami daralt + yeni kaleme ayir" yolu).
Hangisi secilirse secilsin gerekce `#### K08.9.3` / `#### K08.9.5` bloklarina ve §5.0`a yazilir;
karar verilmeden kalan 6 kalem triyaj edilmez (payda yanlis kalir).

## (c) contract-first sira

Bu bir PLANLAMA gorevidir, kod yazilmaz — contract-first sira (sozlesme -> migration ->
backend+unit -> frontend+typed client -> E2E) BU turda degil, bu turun ACTIGI gorevlerin
ICINDE gecerlidir. Her acilan gorevin `details` alani kendi contract-first sirasini tasimali.

## (d) Bilinen tuzaklar

1. PLAN.md ~770 KB / 5900+ satir. BASTAN SONA OKUMA — tur butceni yakar. Hedef satiri
   `grep -n` ile bul, yalniz cevresindeki ~30 satiri oku.
2. KANIT tabloda DEGIL. Gereksinim satiri yalniz damga + referans tasir (`◐ → K02.6`); kanit
   metni `## K. Kanit Gecmisi` altindaki `#### K02.6` blogundadir (CONVENTIONS §1.2).
   Kullanim: `grep -n "^#### K02.6" PLAN.md` -> o satirdan itibaren oku.
3. KARARI PRD KABUL KRITERINE KARSI VER. GL-3/GL-4/GL-8`in hatasi tam olarak buydu: "kod var +
   test yesil"i kabul kriteri sandilar. M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti.
   Kaynak: `prd-uyum-denetimi.md` (134 KB; Ek A`da 247 madde, 4 ad alani).
4. SIRALAMA TUZAGI (184.4 bunu bir kez yasadi): denetimden SONRA duzeltilen aileler yeniden
   dusurulmemeli. tm 175-184 (M-TEAM/M-CAMP/M-STORE/M-RPT/M-COUNT/M-READY/M-UI/M-CO/M-CHOBS/
   M-TRACE) denetimden sonra kapatildi ve 17 katalog kodu bu yuzden sweep`ten haric tutuldu.
   Bir kalemi ise donusturmeden once Task Master`da o kodu zaten kapatan bir gorev var mi bak.
5. ACILAN GOREVLERIN PRIORITY`SI `critical` OLAMAZ. `critical` yalnizca panelin saglik
   taramasindan dogan duzeltme gorevlerine ayrilmistir (bu gorevin KENDISI oyle). Bu turda
   acilacak is gorevleri K7`ye uyar — asagidaki (e) maddesinde her faz icin yazili. Kural
   bozulursa oncelik sirasi tamamen anlamsizlasir.
6. §2 (Modul -> Faz Matrisi, PLAN.md:142-180) 184.4`te BILEREK dokunulmadi ve BAYAT olabilir
   (HANDOFF 184.4 notu, madde 2). Oradan durum okuma.
7. Yeni gorev id`leri: mevcut en buyuk id + 1. tm 1-26 dokunulmaz (BUILD-BLUEPRINT §0 · K1).
   Tag: `master` (K2). Sonunda `metadata.taskCount` guncellenir.
8. Basliktaki `[MODEL-EFOR]` etiketi run-loop.sh`in model/efor secimidir (PLAN §5.1.1):
   `[SONNET-XHIGH]` · `[SONNET-MAX]` · `[OPUS-XHIGH]` · `[OPUS-MAX]`. Etiketsiz = opus+high.
9. `tasks.json` 2-bosluk girintili, LF, SONUNDA NEWLINE YOK. `JSON.parse` -> degistir ->
   `JSON.stringify(d, null, 2)` bu turda bayt-bayt ayni ciktiyi veriyor (dogrulandi);
   tum dosyayi yeniden bicimlendirme.

## (e) Kapsam SINIRI

- YALNIZ v2 §5.0`in yukaridaki 8 satiri. Faz-0`in 28`i **tm 185**, v1`in 11`i **tm 186**.
- `13.4` ⛔ (ADR-14 · kilitli karar) — ACMA, tartisma.
- Acilan is gorevlerinin priority`si: v2 kalemleri PRD`de `Should`/`Could` -> **`medium`**
  (K7: v1 Should = medium · v2/v3 = low; v2`nin acik kapi kalemleri kapiyi bloklamalari nedeniyle
  `medium`, dolgu isi degil). `critical` YASAK (tuzak 5).
- Resmi §F.00 kapanis turu bu gorev DEGILDIR.

**Test Strategy:**

Bu gorev ancak asagidakilerin HEPSI dogruyken done:

1. KALEM KURALI CELISKISI cozuldu: PLAN.md:3567-3570 ile §5.0 ve satir 20 birbiriyle tutarli;
   yeni payda (23 mi 25 mi) yazili ve gerekcesi `#### K08.9.3` / `#### K08.9.5` bloklarinda.
2. KAPSAMA: 8 satirin her biri icin ya yeni bir `pending` gorev var, ya da damga gerekceli
   olarak degisti + gerekce `#### K<kod>` blogunda. KAPSANMAYAN SATIR = 0, sayilarak kanitlanir.
3. Her yeni gorev K3 semasinin (a)-(e) alanlarini tasir + olculebilir `testStrategy`.

GENEL KAPI (uc gorevde de ayni):
- `tasks.json` `JSON.parse` ediliyor + `metadata.taskCount` yeni toplamla birebir esit.
- Task Master `validate_dependencies` exit 0 (kirik/donen bagimlilik yok).
- Acilan hicbir gorevin priority`si `critical` DEGIL (grep ile dogrula).
- Kod/test dosyasi degismedigi icin DoD kapisinin test/integration/e2e ayaklari KOSULMAZ
  (tm 184.4 emsali, HANDOFF`ta yazili). Kosulacaklar: `pnpm -w typecheck` · `pnpm -w lint` ·
  `pnpm -w build` · `pnpm audit:req-coverage` — hepsi exit 0. `format:check` PLAN.md`yi zaten
  disliyor (§1.2 satir-uzunlugu invarianti).
- `git diff --stat` yalnizca `PLAN.md` · `.taskmaster/tasks/tasks.json` · `HANDOFF.md` gostermeli.
