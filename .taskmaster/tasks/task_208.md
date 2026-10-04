# Task ID: 208

**Title:** GL-13 [OPUS-MAX] F0-KAPAT2 — Faz-0 §F.00 kapanis turu (Faz-0 Must tumu)

**Status:** done

**Dependencies:** 205 ✓, 206 ✓, 207 ✓

**Priority:** high

**Description:** Faz-0'in `❌ ACIK (yeniden)` damgasini resmi bir kapanis turuyla karara baglar. tm 205/206/207 son uc `Must ◐`yi kapattiktan sonra §F.1'in 10 maddesi koda karsi yeniden kosulur ve damga ya `✅ KAPALI` olur ya da kalan is gerekceli olarak yeni kalem acar.

**Details:**

(a) GEREKCE + KANIT — bu gorev neden var:
PLAN.md ust kapi tablosu satir 20 (Faz 0 — MVP) su an `❌ ACIK (yeniden)` damgasi tasiyor. Hikaye:
GL-3 (tm 87, 2026-07-31) Faz-0'i kapatmisti; tm 184.4 (2026-09-04, M-TRACE-d) `prd-uyum-denetimi.md`
(2026-08-30) denetimine karsi damgalari yeniden okudu ve kapiyi ACIK'a dondurdu. tm 185 (F0-REOPEN)
28 kalemi triyaj etti: 3'u SIRALAMA duzeltmesiyle `✅`ye geri alindi, 25'i "tamamla" yoluna gitti ve
tm 188-195 olarak acildi. O 25'in HEPSI `done`.
PLAN'in kendi metni (satir ~77, tm 185 triyaj blokunun sonu) bu gorevi ismen soz veriyor:
"**Bu tur da resmi bir §F.00 kapanis turu (GL-tarzi, §F.1'in 10 maddesi) DEGILDIR.** Kapanis turu,
25 kalem `◐`'den ciktiktan sonra AYRICA ACILIR." — bu gorev o soz verilen turdur.
Ayni sozu Faz-1 icin tm 186, Faz-2 icin HANDOFF'un tm 204.2 maddesi veriyor (sirasiyla tm 209, 210).
NOT: bu gorev, otonom dongunun "secilebilir gorev kalmadi" ile durmasindan dogan onarim turunda
acildi — PLAN uc ayri yerde bir kapanis turu soz veriyordu ama hicbiri Task Master'a AKTARILMAMISTI.

(b) ON KOSUL (dependencies, gercek — bos birakilmadi):
tm 205 (02.3.5) · tm 206 (02.8) · tm 207 (03.2.3). §F.00'in kurali mekanik: "bir faz ancak Must
kapsaminda 0 ◐ ve 0 ⬜ kaldiginda kapanir". Bu tur baslarken PLAN ust tablo satir 20 `48 ✅ · 3 ◐`
diyordu ve o 3 ◐ tam olarak bu uc gorevdir. Ucu bitmeden bu tur ACILAMAZ — acilirsa kendi kapisini
karsilamadigini bulur ve pahali bir pencereyi bosa yakar.

(c) YAPILACAK IS — §F.1'in 10 maddesi, KODA KARSI (PLAN.md satir 5922; bu dosyanin iddiasina karsi
DEGIL). Sirasiyla: 1) Kapsam supurmesi (PRD §6'nin 138 `FR-MOD` satiri; Faz-0 kapsamindakiler ✅ veya
gerekceli ⛔/🔒, `◐` KALMAMALI) · 2) Faz sizintisi · 3) NFR kapilari (§7.2, olculur, tahmin edilmez:
gecikme, bundle, a11y taramasi, cross-tenant negatifleri) · 4) Sema artiklari (tuketicisi olmayan
tablo) · 5) Kontrat butunlugu (`contract-parity`) · 6) Sessiz borc taramasi (TODO/FIXME/XXX/
`@ts-expect-error`/`skip(`/`only(`/kapatilmis lint kurali) · 7) Olu kod & erisilemez ekran ·
8) Dokuman tazeligi (PLAN/HANDOFF/README; test ve endpoint sayilari en cok bayatlayan yerler) ·
9) Temiz kurulum provasi · 10) Kapsam disi dogrulamasi (§9'un 10 maddesi).
Cikti: §F.2 formatinda TEK bir Turkce rapor (PLAN.md satir 5947) + PLAN ust tablo satir 20'nin
`Kapanis` hucresi karara baglanir.

(d) BILINEN TUZAKLAR:
1. `make` BU MAKINEDE KURULU DEGIL. §F.1 madde 9 "sifirdan `make dev` -> migrate -> seed -> demo"
   diyor; README'nin `make dev`/`make demo` recetelerini ELLE komutlara acmak zorundasin.
2. NAIF GLIF SAYIMI YANLIS SONUC VERIR. PLAN satir ~73'te kayitli bilinen tablo kusuru: `02.4.1-.6`
   satirinin **Nerede** hucresi de bir damga tasiyor (`✅ → K02.4.1-.6`), yani yanlis sutunu okuyan
   bir sayac sasar. Sayarken DURUM sutununu oku.
3. DAMGA INDIRMEDEN ONCE TARIHE BAK. Bu depoda alti kez yanlis damga indirmesi oldu; dordu tek bir
   commit'e (G1, `3127638`, 2026-08-30) dayaniyor. Denetim metni 2026-08-30 tarihlidir — o tarihten
   SONRA kapatilmis bir boslugu denetime dayanarak `◐`ye indirme (tm 185'in `08.6.1`/`08.8.2`/`11.2`,
   tm 186'nin `08.5.5` duzeltmeleri bu hatanin ta kendisiydi). `git log --since` + PLAN'in kendi
   kapsam kaydini (ADR'ler dahil) oku.
4. DENETIM BULGULARI KAYNAKTA KESIK. `prd-uyum-denetimi.md`'nin "Eksik olan" sutunu `…` ile bitiyor;
   karari denetimin nesrine gore degil PRD'nin KABUL KRITERI sutununa gore ver (tm 185/186'nin
   "tuzak 3" dedigi sey).
5. ADR'LER YENIDEN TARTISILMAZ. Ozellikle ADR-14 (tek paradigma = Skill; `workflows` tablosu semada
   kalir, UI YOK) — `05.1`/`05.3` tam bu yuzden `✅` (tm 186), `13.4` tam bu yuzden `⛔`. Dis bir
   denetim ADR'yi bilmez; PLAN §0 bilir.
6. TAM e2e SUITI PAHALI VE GURULTULU: ~55 `kanit` PNG'sini yeniden yazar (churn, regresyon degil) ve
   paylasilan tohumlu DB'de birikmis durum yuzunden bu turla ILGISIZ kirmizilar verebilir
   (`command-palette` · `entitlements` · `skills-routing` · `team` — hepsi izole kosuda yesil; bkz.
   HANDOFF tm 204.1). Kosacaksan ONCE seed'i tazele; bir kirmiziyi bu tura yazmadan once
   `test-results/*/error-context.md` oku ve stash'lenmis temiz agacta tekrarlanip tekrarlanmadigina bak.
7. Bayat dev sunucu (5173) tum suiti karartir; kosmadan once 4000/4001/5173/5174 bos olsun. Docker
   ayakta olmali; `docker compose down -v` KULLANMA (proje kapsamli).
8. SAHIPSIZ KOMSU BOSLUK — KARAR BU TURUN ISI: `#### K02.3.5`te yazili ama hicbir goreve baglanmamis
   bir bosluk var — `apps/widget/src/widget.ts` mesaj metnini `span.textContent = marked` (~satir
   1549) ile basiyor, yani bir ajan `**kalin**` yazinca musteri tarafinda yildizlar HARFIYEN gorunuyor
   (tm 189.5'in zengin metni yalnizca `apps/web` tarafini kapsiyordu). Bu turda karara baglanir:
   kapat · ayri kalem ac · ya da gerekceli `⛔`. SESSIZCE GECME.

(e) KAPSAM SINIRI — neye DOKUNULMAYACAK:
- Faz 1 ve Faz 2'nin kapanis turlari BU GOREVIN ISI DEGIL (sirasiyla tm 209 ve tm 210). Yalnizca
  Faz-0'in damgasi karara baglanir; ust tablonun 21. ve 22. satirlarina DOKUNMA.
- Faz 3/4/5/6 `✅ KAPALI` — yeniden okunmaz, yeniden acilmaz.
- §7.2'nin 11 NFR `◐` satiri (`P1`·`P2`·`P3`·`P4/P6`·`P8`·`S6`·`I18N1/2`·`C1/C2/C8`·`M4`·`M5`·
  `M-STORE`) faz kapisi DEGIL **NFR kapisidir** (PLAN satir ~66); ayri bir tur ister, bu turda
  kapatilmaz — yalnizca §F.1 madde 3 kapsaminda Faz-0'a dusen paylari OLCULUR.
- Yeni URUN OZELLIGI yazilmaz. Bu bir denetim + karar turudur; cikan is yeni kalem olarak acilir
  (K7 onceligi: high/medium/low — `critical` planlamaya kapalidir, CONVENTIONS §4.1).

**Test Strategy:**

Iki kapi birden. (1) MEKANIK KAPI — tam DoD kapisi (CONVENTIONS §1) exit 0: `pnpm -w typecheck` · `lint` · `format:check` · `build` · `contract:generate` sonrasi diff yok · `pnpm db:check-drift` · `pnpm audit:req-coverage` exit 0 · `pnpm -w test` · `turbo run test:integration --concurrency=1` · TAM e2e suiti (§F.1 bir kapanis turu icin tam surum ister; GL-3/GL-8 emsali). (2) SAYIM KAPISI — PLAN §3'un `Must (MVP)` satirlari ELLE DEGIL SAYILARAK okunur ve sonuc `0 ◐ · 0 ⬜` olmali; bu turun baslangicindaki taban `50 ✅ · 3 ◐` (bu tur acilirken tm 205/206/207 ile `53 ✅ · 0 ◐` olmus olmali — komut: `grep '^| [0-9EK]' PLAN.md | awk -F'|' '$4 ~ /Must \(MVP/ {t++; if($5 ~ /◐/) p++} END {print t, p}'`, `p` BOS/0 olmali). Gorev ancak §F.2 formatinda Turkce rapor uretildiginde ve PLAN ust tablo satir 20'nin `Kapanis` hucresi ya `✅ KAPALI` yapildiginda YA DA kalan her kalem icin gerekce + yeni Task Master kalemi acildiginda biter. `✅` UYDURULMAZ: §F.1'in 10 maddesinden biri bile kosulmadiysa damga cevrilmez.
