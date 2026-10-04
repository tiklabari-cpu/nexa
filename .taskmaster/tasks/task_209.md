# Task ID: 209

**Title:** GL-14 [OPUS-MAX] V1-KAPAT2 — Faz-1 §F.00 kapanis turu (v1 Must tumu)

**Status:** done

**Dependencies:** 208 ✓

**Priority:** high

**Description:** Faz-1'in (v1) `❌ ACIK (yeniden)` damgasini resmi bir kapanis turuyla karara baglar. Must sayaci ZATEN `20 ✅ · 0 ◐ · 0 ⬜` — eksik olan sayi degil, §F.1'in 10 maddesinin yeniden kosulmasi.

**Details:**

(a) GEREKCE + KANIT — bu gorev neden var:
PLAN.md ust kapi tablosu satir 21 (Faz 1 — v1) su an `❌ ACIK (yeniden)` damgasi tasiyor. Hikaye:
GL-4 (tm 88, 2026-07-31) v1'i kapatmisti; tm 184.4 (2026-09-04, M-TRACE-d) `prd-uyum-denetimi.md`
(2026-08-30) denetimine karsi 11 `Must (v1)` satirini `◐`ye indirdi ve kapiyi ACIK'a dondurdu.
tm 186 (V1-REOPEN) o 11 kalemi triyaj etti: `08.5.5` SIRALAMA duzeltmesiyle `✅`ye geri alindi
(G1 `3127638` denetim tarihinden SONRA kapatmisti), `05.1`+`05.3` ADR-14 geregi KAPSAM DARALTMA ile
`✅` oldu, kalan 8 kalem tm 196-200 olarak acildi. O 8'in HEPSI `done`.
BU TURDA (2026-09-07) SAYAC KODA/PLAN'A KARSI DOGRULANDI: `Must (v1)` satirlari `20 ✅ · 0 ◐`,
tm 186'nin listesinde ismen gecmeyen iki kalem (`06.2.1` satir 624, `06.3.2` satir 630) de `✅`.
Yani v1'in §F.00 SAYAC kapisi KARSILANIYOR — eksik olan yalnizca resmi turdur.
PLAN'in kendi metni (satir ~99, tm 186 triyaj blokunun sonu) bu gorevi ismen soz veriyor:
"**Bu tur da resmi bir §F.00 kapanis turu (GL-tarzi, §F.1'in 10 maddesi) DEGILDIR.** Kapanis turu,
8 kalem `◐`'den ciktiktan sonra AYRICA ACILIR." — bu gorev o soz verilen turdur.
NOT: bu gorev, otonom dongunun "secilebilir gorev kalmadi" ile durmasindan dogan onarim turunda
acildi — PLAN kapanis turunu soz veriyordu ama Task Master'a AKTARILMAMISTI.

(b) ON KOSUL (dependencies, gercek — bos birakilmadi):
tm 208 (GL-13, Faz-0 kapanis turu). Gerekce ikili: (1) PRD §5'in faz sirasi Faz 0 -> Faz 1'dir ve
§G'nin kendi tablosu ayni zinciri kuruyor — `GL-4 | V1-KAPAT | ... | GL-3` satiri v1 kapanisini
Faz-0 kapanisina bagliyordu; bu tur o emsali izler. (2) Faz-0 ve v1 ayni kod tabanini paylasiyor;
GL-13'un §F.1 supurmesinden cikan her bulgu (sessiz borc, olu kod, kontrat kaymasi) v1'in kapisini
da ilgilendirir — ters sirada iki kez sifirdan supurulurdu.

(c) YAPILACAK IS — §F.1'in 10 maddesi, KODA KARSI (PLAN.md satir 5922; bu dosyanin iddiasina karsi
DEGIL). Sirasiyla: 1) Kapsam supurmesi (PRD §6'nin 138 `FR-MOD` satiri; v1 kapsamindakiler ✅ veya
gerekceli ⛔/🔒) · 2) Faz sizintisi (§1.3'teki hatanin tekrari) · 3) NFR kapilari (§7.2, olculur) ·
4) Sema artiklari · 5) Kontrat butunlugu (`contract-parity`) · 6) Sessiz borc taramasi · 7) Olu kod
& erisilemez ekran · 8) Dokuman tazeligi · 9) Temiz kurulum provasi · 10) Kapsam disi dogrulamasi.
Cikti: §F.2 formatinda TEK bir Turkce rapor (PLAN.md satir 5947) + PLAN ust tablo satir 21'in
`Kapanis` hucresi karara baglanir.

(d) BILINEN TUZAKLAR:
1. SAYAC ZATEN YESIL — ISI "SAYIYI DUZELTMEK" SANMA. v1'in `Must` sayaci `20 ✅ · 0 ◐ · 0 ⬜`.
   Bu turun isi §F.1'in 10 maddesini KOSMAK ve raporu uretmektir; sayaci yeniden yazmak degil.
   Eger supurme yeni bir `◐` bulursa damga cevrilmez, kalan is YENI KALEM olarak acilir.
2. ADR-14 KAPSAM DARALTMASI GERI ALINMAZ. `05.1`/`05.3`'un tek acik yarisi "Workspace workflow"du ve
   ADR-14 (PLAN §0, satir 121) kilitli: "Tek paradigma = Skill (adim listesi). `workflows` tablosu
   semada kalir, **UI YOK**". Dis denetim ADR'yi bilmez; ADR-14 altinda Workspace kovasi KALICI
   olarak bostur — bu kusur degil, kilitli kararin sonucudur. Ayni sekilde `13.4` `⛔ ADR-14`.
3. `06.3.2-bulk` BILINCLI v2 PAYIDIR ve tm 97.x'te teslim edildi; tm 198 yalnizca v1 payini
   (`file` turu) kapsadi. v1'in kapisinda bulk aranmaz.
4. `13.7` / `13.8-push` (mobil) `Should` ve Faz 3'e ATANDI (§D60) — v1 sayacina hic girmiyordu;
   eski "§11.1/8" atfi YANLISTI (o madde masaustu native app'i kapsar). v1 kapisinda aranmaz.
5. DAMGA INDIRMEDEN ONCE TARIHE BAK — denetim metni 2026-08-30 tarihli; o tarihten SONRA kapatilmis
   bir boslugu denetime dayanarak `◐`ye indirme. Bu hata bu depoda alti kez oldu, dordu tek bir
   commit'e (G1 `3127638`) dayaniyor. `git log --since` + PLAN'in kendi kapsam kaydini oku.
6. DENETIM BULGULARI KAYNAKTA KESIK (`…`); karari PRD'nin KABUL KRITERI sutununa gore ver.
7. `make` BU MAKINEDE KURULU DEGIL — §F.1 madde 9'un `make dev`/`make demo` recetelerini elle ac.
8. TAM e2e SUITI: ~55 `kanit` PNG'si yeniden yazilir (churn) ve paylasilan tohumlu DB'de birikmis
   durum bu turla ILGISIZ kirmizilar verebilir (bkz. HANDOFF tm 204.1). Once seed'i tazele;
   4000/4001/5173/5174 bos olsun; `docker compose down -v` KULLANMA.

(e) KAPSAM SINIRI — neye DOKUNULMAYACAK:
- Faz-0 (tm 208) ve Faz-2 (tm 210) kapanis turlari BU GOREVIN ISI DEGIL. Yalnizca ust tablo
  satir 21 karara baglanir; satir 20 ve 22'ye DOKUNMA.
- Faz 3/4/5/6 `✅ KAPALI` — yeniden okunmaz.
- §7.2'nin NFR `◐` satirlari faz kapisi degil NFR kapisidir; ayri tur ister.
- v1'in `Should` kalemleri kapiyi BLOKLAMAZ (§F.00) — §4'te `Must` OLMAYAN 14 `◐ → K` satiri PLAN
  satir ~104'te ismen listeli (`05.4`·`06.5`·`02.1.4`·`02.3.2`·`07.7`·`07.8`·`08.7.5`·`08.7.7`·
  `09.1`·`09.2`·`10.3`·`11.7`·`13.1`·`13.7`). Kapanis karari icin SAYILMAZLAR.
- Yeni URUN OZELLIGI yazilmaz; cikan is yeni kalem olarak acilir (K7: high/medium/low —
  `critical` planlamaya kapalidir, CONVENTIONS §4.1).

**Test Strategy:**

Iki kapi birden. (1) MEKANIK KAPI — tam DoD kapisi (CONVENTIONS §1) exit 0: `pnpm -w typecheck` · `lint` · `format:check` · `build` · `contract:generate` sonrasi diff yok · `pnpm db:check-drift` · `pnpm audit:req-coverage` exit 0 · `pnpm -w test` · `turbo run test:integration --concurrency=1` · TAM e2e suiti (GL-4/GL-8 emsali: bir kapanis turu tam surum ister). (2) SAYIM KAPISI — PLAN §4.1/4.2/4.3'un `Must (v1)` satirlari ELLE DEGIL SAYILARAK okunur ve sonuc `20 ✅ · 0 ◐ · 0 ⬜` olmali (komut: `grep '^| [0-9]' PLAN.md | awk -F'|' '$4 ~ /Must \(v1\)/ {t++; if($5 ~ /◐/) p++} END {print t, p}'` — `p` BOS/0). Gorev ancak §F.2 formatinda Turkce rapor uretildiginde ve PLAN ust tablo satir 21'in `Kapanis` hucresi ya `✅ KAPALI` yapildiginda YA DA kalan her kalem icin gerekce + yeni Task Master kalemi acildiginda biter. `✅` UYDURULMAZ: §F.1'in 10 maddesinden biri bile kosulmadiysa damga cevrilmez.
