# Task ID: 212

**Title:** V8-TRIAGE-NFR [OPUS-MAX] §7.2'nin 11 acik NFR satiri kayitli kararlara karsi okunur (KOD YAZILMAZ)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** PLAN §7.2 (NFR kapilari) 11 satirda `◐` tasiyor ve hicbirinin acik gorevi yok: tm 185/186/187 triyajlarinin ucu de §3/§4/§5.0 tablolarina bakiyordu, §7.2ye kimse bakmadi. En az ucunun KAYITLI bir kullanici/sahip karari var ve tm 184.4un mekanik supurmesi onun uzerinden gecmis.

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
`grep -n "◐ → K" PLAN.md` ile §7.2 tablosunda (PLAN.md ~3475-3520) on bir satir cikiyor:
`P1` · `P2` (-> `KM-LOAD`) · `P3` (-> `KM-GUARD`) · `P4/P6` (-> `KP4`) · `P8` (-> `KM-LOAD`) ·
`S6` (-> `KS6`) · `I18N1/2` (-> `KI18N1-2`) · `C1/C2/C8` (-> `KC1-C2-C8`) · `M4` (-> `KM4`) ·
`M5` (-> `KM5`) · `M-STORE` (-> `KM-STORE`).
Hepsi tm 184.4un (2026-09-04) supurmesinde `✅` -> `◐` indirildi. Uc tanesinin KAYITLI KARARI VAR
ve supurme onun uzerinden gecti — bu turun en pahali bulgusu budur:

- `I18N1/2` -> **§D129** (kullanici karari, 2026-08-24): "45+ dile genisletme YAPILMAYACAK; §7.2
  `I18N1/2` satiri `✅` KALIR (damga yalniz kod payini iddia eder) — `◐` YAZILMADI cunku
  '`◐` + kuyrukta acik gorev yok' §F.00i bloklar". 184.4 satiri yine `◐` yapti ve TAM DA §D129un
  uyardigi duruma soktu. KOD/ICERIK ayrimi: kod payi = i18n mekanizmasi + RTL + "N'inci dil kod
  degisikligi GEREKTIRMEZ" nobetcisi (`i18n.ts`, tm 26/117 testleri); icerik payi = kalan 37 katalog.
- `M4` ve `P8` -> **§D130** (kullanici karari, 2026-08-24): yuk ayagi Faz-6 `M-LOAD`a (tm 161)
  atandi ve ODENDI; kayit birebir "`M4` **`✅ → KM4`** (besinci ayak doldu) · `P8` **`◐ → KM-LOAD`**
  (yatay olcek payi tm 162de acik)" diyor. tm 162 bugun `done`.
- `C1/C2/C8` -> `#### KC1-C2-C8` icinde SAHIP KARARI (2026-08-31): "kapsam disi, owner karari:
  KVKK/VERBIS ve Turkiye pazari..."; §7Cnin "Kapsam disi (sahip karari, 2026-08-31)" paragrafi
  ayni seyi yaziyor. `pnpm audit:req-coverage` de bunlari `non-code` siniflandiriyor
  ("DPA + SCC + UK Addendum hukuki metinlerdir" · "KVKK/VERBIS bir tescildir, davranis degil").

Kalan sekiz satirin (`P1` `P2` `P3` `P4/P6` `S6` `M5` `M-STORE`) denetim metni PLANda `…` ile
KESIKTIR; olcut denetim degil PRD §7 maddesi + koddur.

(b) DOKUNULACAK DOSYALAR:
- `PLAN.md` §7.2 tablosu — on bir satirin damga hucresi.
- `PLAN.md` `#### K<kod>` bloklari — her degisen satira BU TURUN maddesi (append-only).
- `PLAN.md` §6D tablosu — bu satirin kapanis notu.
- `.taskmaster/tasks/tasks.json` — gercek boslук cikan satir icin YENI GOREV (bu gorev onu YAPMAZ).
- `HANDOFF.md`. KOD / MIGRATION / TEST YAZILMAZ.

(c) SIRA — her satir icin UC SORU, bu sirayla:
1. KAYITLI KARAR VAR MI? `grep -n "D1[0-9][0-9] (" PLAN.md` + `#### K<kod>` blogunun SON maddesi +
   §7Cnin "Kapsam disi" paragrafi + `pnpm audit:req-coverage` ciktisindaki `product-decision` /
   `non-code` siniflari. Varsa: damga o karara gore duzeltilir, gerekce yazilir, GOREV ACILMAZ.
2. Yoksa: PRD §7nin ilgili NFR maddesi BUGUNKU koda karsi okunur (dosya:satir kaniti zorunlu).
3. Kalan gercek boslук gorevlesecek kadar KOD isi mi, yoksa `⛔`/`non-code` mu?

(d) BILINEN TUZAKLAR:
- `## K` blogundaki `◐` glifleri TARIHCEDIR. `KM-LOAD` uc `◐` madde (M-LOAD-a/b/c) + iki `✅`
  tasir; §6Cnin kapanis paragrafi bunu ismen uyariyor: "Bu ayrimi kacran bir sonraki pencere
  KM-LOADa bakip 'uc yarim kalem var' diye YANLIS bir bulgu acardi."
- §D129un uyarisi mekaniktir ve bu gorev icin de gecerlidir: "`◐` + kuyrukta acik gorev yok"
  kombinasyonu §F.00i bloklar. Bir satiri `◐` birakacaksan ya gorev ac ya `⛔` yaz.
- `P3` icin PLAN §7.2 hucresi olculmus degeri tasiyor (18.484 B / 51.200 B); §D143/8 bunu
  "dokuman tazeligi" duzeltmesi olarak zaten guncellemisti — sayiyi yeniden uydurmadan once oku.
- `M-STORE` §7Cnin (Faz-7) kalemidir, tm 177; oradaki alt-gorevlerin durumu once okunur.

(e) KAPSAM SINIRI:
- Urun kodu, migration, test, sozlesme, k6 senaryosu YAZILMAZ; olcum YENIDEN KOSULMAZ ("olctum"
  denmez — §D143/3un kurali: sahibi ve tarihi yazilir).
- §3/§4/§5.0nin FR satirlari BU GOREVIN DEGIL — onlar tm 211dedir.

(f) KAPANIS: commit + push + Task Master `done`.

**Test Strategy:**

Olcut BELGE tutarliligidir. Kapanis kriterleri: (1) §7.2de GEREKCESIZ `◐` sayisi SIFIR — kalan her `◐` ya bir acik tm gorevine ya bir §D/K kararina isaret ediyor; (2) her degisen satirin `#### K<kod>` blogunda bu turun maddesi var (append-only, eski maddeler silinmedi); (3) §D129/§D130/sahip-2026-08-31 kararlarina uyan satirlar ismen listelendi ve damgalari o karara hizalandi; (4) `pnpm audit:req-coverage` exit 0; (5) `pnpm -w format:check` temiz. Urun kaynagi diffi SIFIR dosya: `git diff --name-only` yalniz PLAN.md · HANDOFF.md · .taskmaster gostermeli.
