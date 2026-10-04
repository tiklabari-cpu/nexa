# Task ID: 210

**Title:** GL-15 [OPUS-MAX] V2-KAPAT2 — Faz-2 §F.00 kapanis turu (v2 kalem kurali 23/23)

**Status:** done

**Dependencies:** 209 ✓

**Priority:** low

**Description:** Faz-2nin (v2) `❌ ACIK (yeniden)` damgasini resmi bir kapanis turuyla karara baglar. Kalem kurali ZATEN karsilaniyor (23 acik kalemin 23u ✅, payda SABIT) — eksik olan §F.1in 10 maddesinin yeniden kosulmasi.

**Details:**

(a) GEREKCE + KANIT — bu gorev neden var:
PLAN.md ust kapi tablosu satir 22 (Faz 2 — v2) su an `❌ ACIK (yeniden)` damgasi tasiyor. Hikaye:
GL-8 (tm 114, 2026-08-11) v2yi kapatmisti; tm 184.4 (2026-09-04) `prd-uyum-denetimi.md`
(2026-08-30) denetimine karsi kapiyi ACIKa dondurdu (15 ✅ + 8 ◐). tm 187 (V2-REOPEN) triyaji
payda celiskisini cozdu ve **paydayi 23te SABITLEDI** (30 kalem − 3 ⛔ − 3 [08.9.2/.3/.5, GL-5/6/7
+ G1 `3127638`] − 1 [06.2.3, v1de teslim] = 23). Sonra sirasiyla: tm 187 triyaji 18 ✅ + 5 ◐ ->
tm 201.3 `07.7` ✅ -> tm 202.2 `09.2` ✅ -> tm 202.3 `09.4` ✅ -> tm 203.2 `13.2` ✅ ->
tm 204.2 `13.3` ✅ = **23 ✅ + 0 ◐**. Yani v2nin KALEM kurali KARSILANIYOR.
HANDOFFun tm 204.2 maddesi bu gorevi ismen soz veriyor: "Faz-2 satirinin kendi `❌ ACIK (yeniden)`
damgasi BILEREK DEGISTIRILMEDI — GL-8/GL-9 emsali (tm 114/126) bir fazi yalniz ilerleme sayaclariyla
degil AYRI, KAPSAMLI bir 'kapanis turu' (tam PRD supurmesi + §F.1in 10 maddesinin yeniden
kosulmasi) ile kapatiyordu; bu pencerenin kapsami yalniz `13.3` idi. Sonraki pencere isterse payda
23/23 ✅ oldugu icin bir kapanis turu (GL-10?) AYRI GOREV olarak acabilir." — bu gorev odur.
NUMARA DUZELTMESI: HANDOFF "GL-10?" diyor ama GL-10 ZATEN KULLANILMIS (Faz-4 kapanisi, tm 143).
GL-11 = Faz-5 (tm 158), GL-12 = Faz-6 (tm 168). Bu yuzden bu tur **GL-15**tir (GL-13 = Faz-0/tm 208,
GL-14 = Faz-1/tm 209).
NOT: bu gorev, otonom dongunun "secilebilir gorev kalmadi" ile durmasindan dogan onarim turunda
acildi — HANDOFF kapanis turunu soz veriyordu ama Task Mastera AKTARILMAMISTI.

(b) ON KOSUL (dependencies, gercek — bos birakilmadi):
tm 209 (GL-14, Faz-1 kapanis turu). Gerekce: PRD §5in faz sirasi Faz 0 -> 1 -> 2dir ve §Gnin
kendi zinciri (`GL-3 -> GL-4 -> GL-5/6/7`) ayni sirayi kuruyor. Uc faz da ayni kod tabanini
paylasiyor; GL-13/GL-14un §F.1 supurmesinden cikan bulgular (sessiz borc, olu kod, kontrat kaymasi,
sema artiklari) v2nin kapisini da ilgilendirir — ters sirada ayni supurme uc kez tekrarlanirdi.

(c) YAPILACAK IS — §F.1in 10 maddesi, KODA KARSI (PLAN.md satir 5922). Sirasiyla: 1) Kapsam
supurmesi (PRD §6; v2 kapsamindakiler ✅ veya gerekceli ⛔) · 2) Faz sizintisi · 3) NFR kapilari
(§7.2, olculur) · 4) Sema artiklari · 5) Kontrat butunlugu (`contract-parity`) · 6) Sessiz borc
taramasi · 7) Olu kod & erisilemez ekran · 8) Dokuman tazeligi · 9) Temiz kurulum provasi ·
10) Kapsam disi dogrulamasi (§9).
Cikti: §F.2 formatinda TEK bir Turkce rapor (PLAN.md satir 5947) + PLAN ust tablo satir 22nin
`Kapanis` hucresi karara baglanir + §5.0 sayaci ile tutarli birakilir.

(d) BILINEN TUZAKLAR:
1. PAYDA 23 SABITTIR — DEGISTIRME. tm 187 bunu acikca karara bagladi: "Denominatoru degistirmek
   (25e cikarmak) YANLIS olurdu: kalem kuralinin paydasi 'v2nin ACIK kalemleri'dir, GL-5/6/7nin
   v2den ONCE kapattigi uc kalem hicbir zaman o kumede degildi." `08.9.2`/`08.9.3`/`08.9.5` ✅ ve
   paydadan cikarilmalari DOGRU (kanit: G1 `3127638`, 2026-08-30 20:52 — `ChannelService.ingestInbound`
   gelen metni once `maskCardNumbers` `channel-service.ts:275`, sonra `evaluateSpam` `:300` kapisindan
   geciriyor). `06.2.3` v1de teslim edildi, `13.4` ⛔ ADR-14.
2. v2de `Must` YOK — PRDde v2 kalemlerinin hepsi `Should`/`Could`. §F.00in SAYAC kurali v2de
   UYGULANAMAZ; gecerli olan KALEM kuralidir (23 acik kalemin hepsi ✅). Sayac aramaya calisma.
3. `13.4` (gorsel akis kurucusu) `⛔ ADR-14` ile KAPALI ve oyle KALIR — ADRler yeniden tartisilmaz.
   Hedefi ADR-uyumlu bir ikameyle (`05.6-tmpl31`) onurlandirilmisti. HANDOFF tm 204.2 bunu "bu tur da
   yapmadi, kapsam disiydi" diye not ediyor; `⛔` bir eksik degil, kilitli kararin sonucudur.
4. DAMGA INDIRMEDEN ONCE TARIHE BAK — denetim metni 2026-08-30 tarihli; tm 201-204 turlarinin HEPSI
   ondan SONRA (2026-09-06/07). Denetime dayanarak bu bes kalemi (`07.7`·`09.2`·`09.4`·`13.2`·`13.3`)
   yeniden `◐`ye indirme; `git log --since=2026-08-30` ve `## K.` bloklari gercegi soyluyor.
5. DENETIM BULGULARI KAYNAKTA KESIK (`…`) — ornegin `09.2`nin ikinci boslugu okunamiyordu ve
   tm 202.2 karari PRD satiri 665e (`urun-gereksinim-dokumani-PRD.md`) gore verdi. Ayni yontemi izle.
6. `make` BU MAKINEDE KURULU DEGIL — §F.1 madde 9un recetelerini elle ac.
7. TAM e2e SUITI: ~55 `kanit` PNGsi yeniden yazilir (churn, regresyon degil) ve paylasilan tohumlu
   DBde birikmis durum bu turla ILGISIZ kirmizilar verir — HANDOFF tm 204.1 bunu KANITLADI:
   `command-palette.spec.ts:175` stashlenmis TEMIZ agacta da ayni sekilde dusuyor; `command-palette:131`
   · `entitlements:99` · `skills-routing:149` · `team:447` de ayni sebeple. Dordu de izole kosuda yesil.
   ONCE seedi tazele; 4000/4001/5173/5174 bos olsun; `docker compose down -v` KULLANMA.
8. `08.8.4` DAVRANIS DEGISIKLIGI BILINIYOR — tm 202.3ten beri elle kaydedilmis (app_idsiz)
   webhooklar da atesleniyor. Bu kasitliydi, regresyon degil (HANDOFF tm 202.3, not 2).

(e) KAPSAM SINIRI — neye DOKUNULMAYACAK:
- Faz-0 (tm 208) ve Faz-1 (tm 209) kapanis turlari BU GOREVIN ISI DEGIL. Yalnizca ust tablo
  satir 22 karara baglanir; satir 20 ve 21e DOKUNMA.
- Faz 3/4/5/6 `✅ KAPALI` — yeniden okunmaz, yeniden acilmaz.
- §7.2nin NFR `◐` satirlari faz kapisi degil NFR kapisidir; ayri tur ister.
- Yeni URUN OZELLIGI yazilmaz. Bu bir denetim + karar turudur; cikan is yeni kalem olarak acilir
  (K7 onceligi: high/medium/low — `critical` planlamaya kapalidir, CONVENTIONS §4.1).
- MASTER-PROMPT §5 siniri gecerli: dis servisler MOCK kalir; bagli bir kartin gosterdigi
  deterministik stub veri (`appChatData`) bir eksik SAYILMAZ (tm 202.2, not 2a).

**Test Strategy:**

Iki kapi birden. (1) MEKANIK KAPI — tam DoD kapisi (CONVENTIONS §1) exit 0: `pnpm -w typecheck` ·
`lint` · `format:check` · `build` · `contract:generate` sonrasi diff yok · `pnpm db:check-drift` ·
`pnpm audit:req-coverage` exit 0 · `pnpm -w test` · `turbo run test:integration --concurrency=1` ·
TAM e2e suiti (GL-8 emsali). (2) KALEM KAPISI — §5.0in 23 acik v2 kalemi ELLE DEGIL SAYILARAK
okunur; sonuc `23 ✅ · 0 ◐` olmali ve PAYDA 23 DEGISMEMELI. §5.0 sayaci ile ust tablo satir 22
birbiriyle TUTARLI birakilir (bu depoda ikisinin ayrisma gecmisi var — tm 184.4un payda celiskisi).
Gorev ancak §F.2 formatinda Turkce rapor uretildiginde ve PLAN ust tablo satir 22nin `Kapanis`
hucresi ya `✅ KAPALI` yapildiginda YA DA kalan her kalem icin gerekce + yeni Task Master kalemi
acildiginda biter. `✅` UYDURULMAZ: §F.1in 10 maddesinden biri bile kosulmadiysa damga cevrilmez.
