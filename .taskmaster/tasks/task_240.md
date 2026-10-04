# Task ID: 240

**Title:** V8-NFR-P4 [SONNET-XHIGH] "10.000+ satirda 60 fps" OLCULMUYOR — nobetci kendini "60fps proxy" diye adlandiriyor

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** PLAN §7.2 `P4/P6` satiri `◐ → KP4` kaliyor. tm 212 triyaji NFR-P4'un DOM yarisini tam ve testli buldu (10.000 satirda DOM'da ≤ 20 satir), "60 fps" yarisini ise hic olculmemis buldu: `VirtualList.test.tsx:364` testinin KENDI basligi bunu durustce "60fps proxy" diyor ve dosya basligi gerekcesini yaziyor — jsdom'da duzen yok, kare suresi orada olculemez.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §3. Sinirlar `CLAUDE.md`.
PLAN satiri: §7.2 `| P4/P6 |` (`grep -n '^| P4/P6' PLAN.md`) · kanit blogu `#### KP4`.
PLAN.md ~2,3 MB — BASTAN SONA OKUMA.

(a) OLCULEN BULGU (tm 212 · 2026-09-07):
PRD `urun-gereksinim-dokumani-PRD.md`:745 → `NFR-P4 | Liste render (virtualization) |
10.000+ satirda **60 fps**; yalniz gorunur satir DOM'da`.
- TESLIM olan yari: `apps/web/src/components/VirtualList.test.tsx:364`
  ("paints a bounded node count for 10,000 rows (60fps proxy)") — 10.000 veri satirinda DOM'daki
  satir sayisi ≤ 20, spacer yuksekligi 10.000 x rowHeight olarak dogrulanmis.
- EKSIK olan yari: kare suresi. Dosya basligi (satir 1-12) gerekcesini durustce yaziyor:
  "paint cost tracks node count, so a bounded node count is the measurable proxy a unit test can
  hold" + "jsdom has no layout". Yani bu bir kacamak degil, bir ARAC sinirridir — ve o sinir
  `apps/e2e` (Playwright/chromium) ile asilabilir.

(b) YAPILACAK IS — gercek tarayicida olc:
- `apps/e2e` altinda 10.000+ satirlik bir listeyi FIILEN suren bir senaryo. Iki tuketici var,
  ikisi de ayni `VirtualList`i paylasiyor: `VirtualList` ve `VirtualTable`
  (`apps/web/src/features/inbox/TicketGrid.tsx` yorumu "a directory's worth of tickets at 60fps"
  diyor). Hangisinin surulecegi bu gorevin karari; seed maliyeti gerekceye girer.
- Kare suresini olcmenin makul yolu: `page.evaluate` icinde `requestAnimationFrame` ornekleyip
  p95/p99 kare araligi cikarmak, ya da CDP `Performance`/trace ile `frames` toplamak. Esik
  16,7 ms'lik ideal DEGIL — makine yuku altinda kirilgan olur; PRD'nin "60 fps"i bir HEDEFTIR,
  esigi ve toleransi bu gorev yazar ve GEREKCESIYLE `#### KP4`ye kaydeder (emsal: `apps/load`in
  `lib/thresholds.js` deseni — esik PRD satirindan TURETILIR, elle yazilmaz).

(c) BILINEN TUZAKLAR:
- `apps/e2e` sabit portlarda gercek sunucular ve tohumlu `siyahtus` veritabani kullanir; iki pencere
  ayni anda e2e kosamaz (CONVENTIONS §1.1 istisnasi). `set -a && . ./.env && set +a` sart.
- Bir e2e turu ~84 `apps/e2e/kanit/*.png` yeniden yazar — beklenen churn, geri al.
- Yuk altinda olculen kare suresi CPU cekismesine duyarlidir (CONVENTIONS §1.3'un `apps/web`
  `--maxWorkers=4` dersi). Kirilgan bir esik bu depoda bir kazanc degil, kalici bir kirmizidir:
  ya toleransli bir esik yaz ya da olcumu kaydedip esigi gerekceyle GEVSEK birak.
- 10.000 satirlik seed'i paylasilan tohuma EKLEME — baska suitlerin sayimlarini bozar; senaryo
  kendi verisini kursun ve toplasin.

(d) KAPSAM SINIRI:
- Yalniz NFR-P4'un fps ayagi. `NFR-P6`nin sabit-zaman ayagi AYRI gorevdir (tm 239).
- Urun kodu degismesi BEKLENMIYOR; olcum bir regresyon gosterirse o ayri bir karardir
  (once olc, sonra tartis — §D122).

(e) KAPANIS: §7.2 `P4/P6` satiri ancak tm 239 DA bittiginde `✅` olur; bu gorev kendi ayagini
`#### KP4` blogua append eder. commit + push + Task Master `done`.

**Test Strategy:**

Olcut: (1) gercek chromium'da 10.000+ satirlik bir liste surulurken kare araligi ornekleniyor ve p95 sayisi `#### KP4`ye YAZILIYOR (sahibi + tarihi + kosu kosullariyla — §D143/3); (2) esik PRD satirindan turetiliyor, elle yazilmiyor, ve toleransi gerekcesiyle kayitli; (3) nobetci bos degil: senaryo virtualizasyon kapatilarak (ya da overscan sonsuza cekilerek) bir kez KIRMIZI gosteriliyor; (4) mevcut `VirtualList.test.tsx` bozulmadan yesil ve "60fps proxy" testi SILINMIYOR — birim seviyesindeki nobetci ucuz ve hizli, e2e olcumu onun yerine degil yanina geliyor; (5) tam e2e suiti taban degerinde kaliyor; (6) tam DoD kapisi (CONVENTIONS §1) exit code'lariyla.
