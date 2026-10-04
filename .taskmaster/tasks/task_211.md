# Task ID: 211

**Title:** V8-TRIAGE-FR [OPUS-MAX] Supheli FR damgasi triyaji — 06.6 · 07.7(v1) · 09.2(v1) · 11.7 · 13.7 (KOD YAZILMAZ)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Faz-8'in paydasini kucultebilecek ilk is: bes PLAN satirinin `◐`/`⬜` damgasi 2026-09-07 okumasinda supheli cikti. Ikisinin ikiz v2 satiri zaten `✅`, birinin kayitli bir kullanici karari var, biri PRD ile celisen bir kapsam iddiasi tasiyor, biri `⛔-surec`. Cikti bir karar + damga; urun kodu YAZILMAZ.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §4. Sinirlar `CLAUDE.md`.
Bu gorev PLAN.md §6D (FAZ 8 — Kalan Gereksinim Borclari, §D149) kaleminin Task Master karsiligidir.
DIKKAT: PLAN.md ~2,3 MB — BASTAN SONA OKUMA. Hedef satiri `grep -n` ile bul, cevresindeki ~30
satiri oku. Kanit metni tablo hucresinde DEGIL, `## K. Kanit Gecmisi` altindaki `#### K<kod>`
blogundadir (CONVENTIONS §1.2).
NUMARALANDIRMA: bu faz **8**dir, 7 degil — `Faz-7` §7Cnindir (PRD uyum duzeltmesi, tm 175-184).
Gorev kodu oneki `V8-`; `V7-` §7Cnin dilim adidir, KULLANMA.

(a) GEREKCE + KANIT — bu gorev neden var:
Panelin saglik taramasi 19 kez `tm-plan-conflict` bildirdi: satir `◐`, bu PRD kodunu kapsayan tm
gorevlerinin TAMAMI kapali, acik baska gorev yok. Bes tanesi bu turda koda karsi okununca SUPHELI
cikti — yani muhtemelen kod degil DAMGA isi:

1) `07.7` v1 satiri — PLAN.md §4.3 (`grep -n "| 07.7 |" PLAN.md`), kanit `#### K07.7`.
   Denetimin (1) numarali boslugu: "buildSalesReport sabit configured:false iskeleti donduruyor".
   BUGUN: `apps/api/src/routes/reports.ts` `buildSalesReport` -> `salesReportFigures(tx, licenseId,
   from, to)` cagiriyor, yani boslук KAPANMIS (tm 201.1). Ikiz v2 satiri (`#### K07.7-b`, PLAN §5.0)
   tm 201.3te YEDI PARCA sayilarak `✅` oldu; v1 satiri guncellenmedi.
2) `09.2` v1 satiri — kanit `#### K09.2`. Okunabilen boslugu (1) tm 202.1de kapandi
   (`connectWithApiKey` + `POST /settings/apps/{appId}/connect`), okunamayan (2) tm 202.2ye
   verildi; 202.2 ikiz v2 satirini (`#### K09.2-b`) `✅` yapti ama `K09.2`ye hicbir madde yazmadi.
3) `11.7` — kanit `#### K11.7`. Denetimin TEK bulgusu DIL ayagiydi (widget 8 locale);
   renk/tema/konum/mobil-tam-ekran/RTL/reduced-motion GERCEK bulundu. Dil payi §D129un KAYITLI
   KULLANICI KARARINA tabidir: "45+ dile genisletme YAPILMAYACAK" (2026-08-24). Yani bu satirin
   `◐`si bir kod isi degil damga isidir.
4) `06.6` `⬜` — PLAN.md ~satir 326, kanit `#### K06.6`. PRD satiri (urun-gereksinim-dokumani-PRD.md
   :577) "Chatbot (kural-tabanli bot) — deterministik akis/bot (AI Agentdan ayri, LLMsiz)", KK
   "Kural bazli bot; gruplara priority ile atanir", Sema sutunu "§8 bots". Kodda `bots` tablosu YOK
   (grep: `@@map("bots")` ve `model Bot ` sonucsuz). PLAN satirinin "Nerede" hucresi ise "onе
   cekilen v1 AI Agent bu payi karsiliyor" diyor — bu bir KAPSAM IDDIASIDIR ve PRDnin kendi satiriyla
   CELISIR. Karar: ya PRDnin istedigi ayri bot yazilir (yeni gorev), ya `⛔` + gerekce (owner karari
   gerekir mi, gorev icinde degerlendir), ya "v1 AI Agent karsiliyor" iddiasi KK maddeleriyle kanitlanir.
5) `13.7` — kanit `#### K13.7` (76 satir). Kalan tek pay magaza gonderimi (`⛔-surec`, §D110) +
   denetimin "tam modul paritesi" bulgusu (dort yuzey de bilincli daraltilmis: CRM salt-okunur,
   duzenleme/ban/custom field yok). Damga `◐` mi `⛔ sayilarak` mi olmali.

(b) DOKUNULACAK DOSYALAR:
- `PLAN.md` — bes tablo satirinin damga hucresi + ilgili `#### K<kod>` bloguna BU TURUN maddesi
  (append-only, CONVENTIONS §1.2: kanit bloga, tabloya DEGIL).
- `PLAN.md` §6D tablosu — payda karari degistiyse islenir (21 SABIT; `⛔` cikan satir
  "⛔ sayilarak" kapanmis sayilir, payda DUSMEZ).
- `.taskmaster/tasks/tasks.json` — gercek boslук cikan satir icin YENI GOREV (bu gorev onu YAPMAZ).
- `HANDOFF.md` — tur girisi (newest-first, en uste).
- KOD / MIGRATION / TEST / SOZLESME YAZILMAZ.

(c) SIRA (kod yok, ama sira var):
1. Her satir icin KAYITLI KARAR ARAMASI — bu turun dersi budur:
   `grep -n "D1[0-9][0-9] (" PLAN.md` icinde ilgili kodu ara · `#### K<kod>` blogunu SONUNDAN oku
   (gecerli olan en alttaki maddedir) · `git log --oneline --since=2026-08-30 -- <ilgili dosya>`.
2. Sonra PRD satiri + Kabul Kriteri sutunu koda karsi MADDE MADDE sayilir.
3. Karar yazilir: `✅` (hak edilmis) / `⛔ + gerekce` / "gercek boslук -> yeni gorev".

(d) BILINEN TUZAKLAR:
- Denetim alintilari PLANda `…` ile KESIKTIR. Okunamayan bir iddia uzerine gorev ACMA — olcut
  denetim degil PRD satiri + KK sutunudur (tm 187nin `194.2` emsali).
- `## K` blogundaki `◐` glifleri TARIHCEDIR, sayaca girmez; satirin durumu TABLODADIR (§6Cnin
  kapanis paragrafindaki kural). Bir blogun ortasindaki `◐` "bugun acik is" demek DEGILDIR.
- SIRALAMA tuzagi (tm 185te uc, tm 186da bir kez cikti): denetim 2026-08-30 tarihlidir; bosluk
  denetimden SONRA kapatilmis olabilir. Once tarihe bak.
- `07.7`/`09.2`nin v1 ve v2 satirlari AYRI bloklara isaret eder (`K07.7` vs `K07.7-b`,
  `K09.2` vs `K09.2-b`). Yanlis blogu guncelleme.

(e) KAPSAM SINIRI — neye DOKUNULMAYACAK:
- Urun kodu, migration, test, sozlesme. Bu tur YALNIZ karar + damga + (gerekirse) yeni gorev uretir.
- §7.2nin NFR satirlari BU GOREVIN DEGIL — onlar tm 212dedir.
- Faz-0/1/2 kapanis turlari (tm 208/209/210) ve tm 205-207 bu gorevden ETKILENMEZ.

(f) KAPANIS: commit + push (Conventional Commit; PLAN.md/HANDOFF.md ayni commite girer) +
Task Master `done`. Hicbir dosyaya dokunmadiysan bunu ACIKCA soyle ve commit etme.

**Test Strategy:**

Bu gorev kod yazmaz, olcut BELGE tutarliligidir. Kapanis kriterleri: (1) bes satirin besinde de tablo damgasi ile `#### K<kod>` blogunun son maddesi AYNI seyi soyluyor; (2) her satir icin kayitli karar aramasi yapildigi kanitli (§D / K blogu / `git log --since=2026-08-30` referansi handoff notunda ismen); (3) `⛔` cikan her satirda gerekce yazili; (4) "gercek boslук" cikan her satir icin acilan yeni tm gorevinin id'si PLAN §6D tablosuna islendi; (5) `pnpm audit:req-coverage` exit 0; (6) `pnpm -w format:check` temiz. Urun kaynagi diffi SIFIR dosya olmali: `git diff --name-only` yalniz PLAN.md · HANDOFF.md · .taskmaster gostermeli.
