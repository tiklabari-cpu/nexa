# Task ID: 225

**Title:** V8-RPT-BENCH [SONNET-XHIGH] Chats bolumu kartlari karsilastirmali olsun + eksik iki kart (FR-MOD-07.3.3)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Kabul kriteri 'Donemsel + karsilastirmali'; uc kart yalniz donemsel — benchmark blogu bu uc figuru hic olcmuyor, dolayisiyla UI'da vs-previous rozeti yok. PRD ayrica response times ve satisfaction kartlarini da sayiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §4. Sinirlar `CLAUDE.md`.
Bu gorev PLAN.md §6D (FAZ 8 — Kalan Gereksinim Borclari, §D149) kaleminin Task Master karsiligidir.
DIKKAT: PLAN.md ~2,3 MB — BASTAN SONA OKUMA. Hedef satiri `grep -n` ile bul, cevresindeki ~30
satiri oku. Kanit metni tablo hucresinde DEGIL, `## K. Kanit Gecmisi` altindaki `#### K<kod>`
blogundadir (CONVENTIONS §1.2) — ve gecerli olan blogun SON maddesidir, ortadaki `◐` glifleri
tarihcedir.
KAYITLI KARAR ARAMASI (§D149un dersi): damgayi degistirmeden once `grep -n "D1[0-9][0-9] (" PLAN.md`
ile ilgili kodu ara ve `git log --oneline --since=2026-08-30` ile denetimden SONRA is yapilmis mi bak.
NUMARALANDIRMA: bu faz **8**dir — `Faz-7` §7Cnindir (tm 175-184). Onek `V8-`, `V7-` KULLANMA.

(a) GEREKCE + KANIT:
PRD `:587`: "Chats bolumu kartlari — automated chats/hour, durations, RESPONSE TIMES, SATISFACTION" ·
KK: "Donemsel + KARSILASTIRMALI".
Kod `apps/api/src/routes/reports.ts:596-599` — `automated_per_hour` pencere blogunda hesaplaniyor;
`withBenchmark` sarmali bu uc figuru olcmuyor, dolayisiyla `previous_period` karsiligi yok ve UI
rozet render etmiyor.
`#### K07.3.3` (PLAN.md ~8011) denetim maddesi birebir: "KK 'Donemsel + karsilastirmali' diyor;
Chats bolumunun uc karti (automated/hour, automated avg duration, total duration) yalniz donemsel —
benchmark blogu bu uc figuru hic olcmuyor ... dolayisiyla UI'da da vs-previous rozeti yok. Respon[se]…"
PLAN satiri 335, `Should`.

(b) DOKUNULACAK DOSYALAR:
- `apps/api/src/routes/reports.ts` — `withBenchmark` / `splitBenchmark` sarmali + Chats blogu.
- `apps/api/src/services/reports/report-csv.ts` — CSV export satirlari.
- `packages/contract/openapi/paths/reports.yaml` — `previous_period` alanlarinin sozlugu.
- `apps/web/src/features/reports/ReportsPage.tsx` — `CountDelta` rozetleri.
- EMSAL: tm 201.3 (Team performance) — `splitBenchmark`in AYNISI istenen pencereye uygulandi,
  sekme `CountDelta` deseninde bes rozet gosterdi. AYNI deseni izle, yeni rozet dili ICAT ETME.

(c) CONTRACT-FIRST SIRA: sozlesme (`previous_period` alanlari) -> backend + integration ->
`contract:generate` -> web + unit -> CSV export satiri -> e2e.

(d) BILINEN TUZAKLAR:
- `previous_period` sozlesmede ZORUNLU olabilir: tm 201.3'un ihlali tam da "API gonderiyordu,
  CSV tasiyordu, ama istemcinin tipi tanimiyordu ve rozet render edilmiyordu" idi. Uc katmanin
  UCU de (API + CSV + web tipi) hizali olmali.
- ORTALAMA figurlerin (durations, response times) karsilastirmasi SAYIM degil ORAN/SURE farkidir;
  `CountDelta` bilesenini oldugu gibi kullanmadan once birim uyumuna bak (saniye mi yuzde mi).
- Dusuk baz uyarisi: ince ornekte yuzde farki yaniltir — mevcut `isLowBase`/"shares may not be
  reliable" deseni bu kartlara da uygulanmali mi, karara bagla ve yaz.
- Yeni iki kart (response times · satisfaction) icin veri KAYNAGI zaten var mi bak
  (`/reports/overview` ve CSAT yolu); yoksa kapsam buyur — gorev icinde SINIRI yaz.

(e) KAPSAM SINIRI: ADR-09 "automated" tanimi DEGISMEZ · 07.3.2 KPI kartlari (Manual/Assisted/
Automated + Total cases) DEGISMEZ · benchmark ALTYAPISI (`withBenchmark`) yeniden yazilmaz,
yalniz kapsami buyur · rapor grubu EKLENMEZ.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0, `contract:generate` sonrasi beklenmeyen diff YOK · `audit:req-coverage` exit 0 ve `FR-MOD-07.3.3` site sayisi ARTMIS. Integration (`reports-billing.test.ts`): (1) Chats blogunun UC figuru de `previous_period` esini tasiyor; (2) eksik iki kart (response times · satisfaction) donemsel VE karsilastirmali geliyor; (3) bos/ince pencerede NaN/Infinity DONMEZ; (4) mevcut benchmark gruplarinin (overview · breakdown · ai-agent · reviews · topics · cases · leads · sales · goals · team-performance) hepsi REGRESYON yesil; (5) cross-tenant. Web unit: bes kartta da `CountDelta` rozeti render ediliyor ve birim (saniye/yuzde) dogru bicimleniyor; istemci tipi `previous_period`i TANIYOR. CSV: export satirlari yeni figurleri tasiyor. e2e: `reports.spec.ts` rozetlerin gorunurlugu (kanit PNG).
