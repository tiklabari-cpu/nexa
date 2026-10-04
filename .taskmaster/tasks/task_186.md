# Task ID: 186

**Title:** V1-REOPEN (PRD §5.2) — v1`in yeniden acilan 11 `Must` kaleminin triyaji + backlog`a aktarimi [OPUS-XHIGH]

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Faz-0 ile ayni bulgu, v1 payi: tm 184.4 sonrasi v1`in §F.00 kapisi ❌ ACIK (sayac 9 ✅ · 11 ◐ · 0 ⬜). Bu gorev 11 kalemin her biri icin "tamamla / kapsami daralt" kararini verir ve "tamamla" cikanlari Task Master`a is gorevi olarak aktarir. Kod yazilmaz.

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

Bu gorevin payi: **v1 / Faz 1 (PRD §5.2)**. v1 `Must` sayaci simdi **9 ✅ · 11 ◐ · 0 ⬜**
(PLAN.md satir 19 kapi tablosu + satir 61-66 guncelleme paragrafi). Gerekce Faz-0 ile ayni,
PLAN.md:61-66 "11 kalemin kapanis karari (tamamla / kapsam daralt) bu turun kapsami disi,
bir sonraki tura birakildi" diyor.

## (b) Dokunulacak dosyalar

- `.taskmaster/tasks/tasks.json` — asil cikti.
- `PLAN.md` §4.1/4.2/4.3 (satir 527-1113) — damga YALNIZCA "kapsami daralt" kararinda degisir.
- `PLAN.md` satir 19 (kapi tablosu v1 satiri) — sayac degistiyse.
- `HANDOFF.md` — tur girisi.
- KOD/MIGRATION/TEST YAZILMAZ.

## Triyaj edilecek 11 `Must ◐` kalem (PLAN.md §4 · satir no 2026-09-04 itibariyle)

| PLAN satir | Kod | Kanit blogu |
| --- | --- | --- |
| 538 | 05.1 | `#### K05.1` |
| 540 | 05.3 | `#### K05.3` |
| 542 | 05.5 | `#### K05.5` |
| 549 | 06.2.1 | `#### K06.2.1` |
| 550 | 06.2.2 | `#### K06.2.2` |
| 552 | 06.2.4 | `#### K06.2.4` |
| 555 | 06.3.2 | `#### K06.3.2` |
| 556 | 06.3.3 | `#### K06.3.3` |
| 557 | 06.4 | `#### K06.4` |
| 579 | 08.5.5 | `#### K08.5.5` |
| 590 | 10.1.4 | `#### K10.1.4` |

DIKKAT — bilinen kapsam kararlari, yeniden tartisma:
- `06.3.2-bulk` (bulk/CSV) v1`de BILINCLI v2 payidir (PLAN.md:63-64 · §5.1). `06.3.2`yi
  triyaj ederken bu ayrimi koru: v1 payi ile v2`ye birakilan bulk payi ayni satirda degildir.
- `13.7` / `13.8-push` (mobil) `Should` ve **Faz 3`e atandi** (§D60) — sayaca girmiyor.

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

- YALNIZ v1 §4`un yukaridaki 11 `Must ◐` satiri. Faz-0`in 28`i **tm 185**, v2`nin 8`i **tm 187**.
- §4`te `Must` OLMAYAN 14 `◐ → K` satiri (05.4 · 06.5 · 02.1.4 · 02.3.2 · 07.7 · 07.8 · 08.7.5 ·
  08.7.7 · 09.1 · 09.2 · 10.3 · 11.7 · 13.1 · 13.7) kapiyi bloklamaz -> kapsam disi; triyaj
  ciktisinda ismen listelensin.
- Acilan is gorevlerinin priority`si: v1 `Must` = **`high`** (K7). `critical` YASAK (tuzak 5).
- Resmi §F.00 kapanis turu bu gorev DEGILDIR.

**Test Strategy:**

Bu gorev ancak asagidakilerin HEPSI dogruyken done:

1. KAPSAMA: PLAN.md §4.1/4.2/4.3`un 11 `Must ◐` satirinin her biri icin ya yeni bir `pending`
   gorev var, ya da damga gerekceli olarak degisti + gerekce `#### K<kod>` blogunda.
   KAPSANMAYAN SATIR = 0, sayilarak kanitlanir.
2. `06.3.2` karari v1 payi ile v2`ye birakilan bulk/CSV payini ayri tutar (details madde).
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
