# Task ID: 185

**Title:** F0-REOPEN (PRD §5.1) — Faz-0`in yeniden acilan 28 `Must` kaleminin triyaji + backlog`a aktarimi [OPUS-MAX]

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** tm 184.4 PLAN.md damgalarini `prd-uyum-denetimi.md`ye karsi yeniden okuyunca Faz-0`in §F.00 kapisi ❌ ACIK`a dondu: §3`un 28 `Must` satiri `✅`ten `◐`ye indi (sayac 23 ✅ · 28 ◐ · 0 ⬜). Bu gorev o 28 kalemin her biri icin §F.00`in iki yolundan birini secer (tamamla / kapsami daralt + yeni kaleme ayir) ve "tamamla" cikanlari Task Master`a is gorevi olarak aktarir. Kod yazilmaz.

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

Bu gorevin payi: **Faz-0 (PRD §5.1)**. §F.00`in mekanik kurali "bir faz ancak `Must` kapsaminda
0 ◐ ve 0 ⬜ kaldiginda kapanir" — Faz-0`in `Must` sayaci simdi **23 ✅ · 28 ◐ · 0 ⬜**.

## (b) Dokunulacak dosyalar

- `.taskmaster/tasks/tasks.json` — asil cikti: "tamamla" karari cikan her kalem icin yeni gorev.
- `PLAN.md` §3 (satir 181-526) — damga hucresi YALNIZCA karar "kapsami daralt" yonundeyse
  degisir (`◐ → ⛔` ya da `Must` -> `Should` indirimi), gerekcesi ilgili `#### K<kod>` blogunda.
  "Tamamla" karari damgayi DEGISTIRMEZ — `◐` kalir, is Task Master gorevine doner.
- `PLAN.md` satir 18 (kapi tablosu Faz-0 satiri) — sayac degistiyse guncellenir.
- `HANDOFF.md` — tur girisi (newest-first, en uste).
- KOD/MIGRATION/TEST YAZILMAZ.

## Triyaj edilecek 28 `Must ◐` kalem (PLAN.md §3 · satir no 2026-09-04 itibariyle)

| PLAN satir | Kod | Kanit blogu |
| --- | --- | --- |
| 203 | 01.2 | `#### K01.2` |
| 204 | 01.3 | `#### K01.3` |
| 212 | 02.1.1 | `#### K02.1.1` |
| 213 | 02.1.3 | `#### K02.1.3` |
| 214 | 02.2.2 | `#### K02.2.2` |
| 216 | 02.3.3 | `#### K02.3.3` |
| 218 | 02.3.5 | `#### K02.3.5` |
| 219 | 02.3.6 | `#### K02.3.6` |
| 220 | 02.4.1–.6 | `#### K02.4.1-.6` |
| 221 | 02.6 | `#### K02.6` |
| 222 | 02.8 | `#### K02.8` |
| 231 | 03.2.1 | `#### K03.2.1` |
| 232 | 03.2.3 | `#### K03.2.3` |
| 239 | 04.1 | `#### K04.1` |
| 240 | 04.3.1 | `#### K04.3.1` |
| 242 | 04.3.4 | `#### K04.3.4` |
| 243 | 04.4 | `#### K04.4` |
| 259 | 07.3.2 | `#### K07.3.2` |
| 270 | 08.5.3 | `#### K08.5.3` |
| 272 | 08.6.1 | `#### K08.6.1` |
| 274 | 08.7.2 | `#### K08.7.2` |
| 275 | 08.8.2 | `#### K08.8.2` |
| 283 | 10.1.1 | `#### K10.1.1` |
| 287 | 10.2 | `#### K10.2` |
| 293 | 11.1 | `#### K11.1` |
| 294 | 11.2 | `#### K11.2` |
| 296 | 11.4 | `#### K11.4` |
| 297 | 11.6 | `#### K11.6` |

Uretilmesi gereken (bu listeyi kendin dogrula, kopyalama):
`node -e "const L=require(`fs`).readFileSync(`PLAN.md`,`utf8`).split(/\r?\n/); for(let i=180;i<526;i++) if(L[i].includes(`◐ → K`) && /Must/.test(L[i])) console.log(i+1, L[i].split(`|`)[1].trim());"`

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

- YALNIZ Faz-0 §3`un yukaridaki 28 `Must ◐` satiri. v1`in 11 kalemi **tm 186**, v2`nin 8 kalemi
  **tm 187** gorevindedir — onlara DOKUNMA.
- §7.2`nin (PLAN.md:3355-3407) 11 `◐ → K` NFR satiri HICBIRININ kapsaminda degil: onlar faz
  kapisi degil NFR kapisi, ayri bir tur ister. Triyaj notunda ismen anilir, is acilmaz.
- §3`te `Must` OLMAYAN 6 `◐ → K` satiri (00.4 · 01.1.1/.4/.5 · vb.) kapiyi bloklamaz -> kapsam
  disi; ama triyaj ciktisinda ismen listelensin ki bir sonraki pencere onlari kayip sanmasin.
- Acilan is gorevlerinin priority`si: Faz-0 `Must` = **`high`** (K7). `critical` YASAK (tuzak 5).
- Bu gorev resmi bir §F.00 kapanis turu (GL-tarzi, §F.1`in 10 maddesi) DEGILDIR. O tur, 28 kalem
  `◐`den ciktiktan SONRA ayrica acilir. Bu gorev yalnizca karari verir ve isi gorev haline getirir.
- Onerilen calisma sirasi tm 185 -> 186 -> 187 (secici en kucuk id`yi sectigi icin kendiliginden
  olusur). `dependencies` BILEREK bos: her ucu tek basina calisabilir, biri digerini beklemez.

**Test Strategy:**

Bu gorev ancak asagidakilerin HEPSI dogruyken done:

1. KAPSAMA: PLAN.md §3`un 28 `Must ◐` satirinin her biri icin ya (i) Task Master`da o kodu
   basliginda ya da `details`inde ismen anan yeni bir `pending` gorev var, ya da (ii) satirin
   damgasi gerekceli olarak degisti (`⛔` / `Should`a indirim) ve gerekce ilgili `#### K<kod>`
   blogunda yazili. KAPSANMAYAN SATIR = 0. Bu, sayilarak kanitlanir (kod uretilir ve ciktisi
   HANDOFF girisine yazilir), goz karariyla degil.
2. Her yeni gorev "hic tanimayan temiz bir pencere baska hicbir sey okumadan yapabilir"
   testini gecer: K3 semasinin (a)-(e) alanlari dolu, PRD kodu baslikta, `testStrategy`
   olculebilir bir komut/exit-code.

GENEL KAPI (uc gorevde de ayni):
- `tasks.json` `JSON.parse` ediliyor + `metadata.taskCount` yeni toplamla birebir esit.
- Task Master `validate_dependencies` exit 0 (kirik/donen bagimlilik yok).
- Acilan hicbir gorevin priority`si `critical` DEGIL (grep ile dogrula).
- Kod/test dosyasi degismedigi icin DoD kapisinin test/integration/e2e ayaklari KOSULMAZ
  (tm 184.4 emsali, HANDOFF`ta yazili). Kosulacaklar: `pnpm -w typecheck` · `pnpm -w lint` ·
  `pnpm -w build` · `pnpm audit:req-coverage` — hepsi exit 0. `format:check` PLAN.md`yi zaten
  disliyor (§1.2 satir-uzunlugu invarianti).
- `git diff --stat` yalnizca `PLAN.md` · `.taskmaster/tasks/tasks.json` · `HANDOFF.md` gostermeli.
