# Task ID: 223

**Title:** V8-RPT-NAV [OPUS-XHIGH] Reports sol dikey kenar cubugu + kategori gruplari (FR-MOD-07.1)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PRD dokuz ogeli bir KENAR CUBUGU (sol dikey nav) ve 'Kategoriler + grup genisleticiler' istiyor; kod duz bir yatay tablist. Export da PRD'de bir kenar cubugu ogesi, kodda sayfa basligindaki bir indirme kontrolu.

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
PRD `urun-gereksinim-dokumani-PRD.md:583`: "Reports kenar cubugu — Overview / AI Agent / Metrics
breakdown / Chat topics(NEW) / Leads / Cases / Sales / Team performance / EXPORT" · KK:
"KATEGORILER + GRUP GENISLETICILER".
Kod `apps/web/src/features/reports/ReportsPage.tsx:503` -> `role="tablist"` (duz yatay serit);
kategori grubu/akordeon YOK. `#### K07.1` (PLAN.md ~7998) denetim maddesi birebir: "PRD 'kenar
cubugu' (sol dikey nav) + KK 'Kategoriler + grup genisleticiler' istiyor; kod duz bir yatay tablist,
kategori grubu/akordeon yok. 'Export' PRD'de bir kenar cubugu ogesi olarak listeleniyor, kodda ise
sayfa basligindaki bir indirme kontrolu". PLAN satiri 332, `Should (MVP temel)`.

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/features/reports/ReportsPage.tsx` (+ `ReportsPage.test.tsx`) — nav + sekme yonlendirme.
- `apps/web/src/locales/{en,tr}/reports.ts` — kategori basliklari.
- Rapor grubu katalogu `GET /reports/groups` (`apps/api/src/routes/reports.ts`) — KATEGORI bilgisi
  yoksa katalogа eklenir (contract-first); varsa yalniz okunur.
- `apps/web` izin kapisi: `visibleReportGroups` + `GROUP_GATED_TABS` (fail-closed) — DEGISMEZ,
  yalniz yeni yerlesime tasinir.

(c) CONTRACT-FIRST SIRA: kategori bilgisinin kaynagina karar ver (sunucu katalogu mu, istemci
sabiti mi — sunucu tercih edilir, izin kapisi zaten orada) -> sozlesme -> backend + integration ->
UI + unit -> a11y -> e2e.

(d) BILINEN TUZAKLAR:
- `role="tablist"`ten dikey nav'a gecerken ARIA deseni degisir: akordeonlu bir kenar cubugu
  `tablist` + `tabpanel` mi kalacak yoksa `navigation` + baslik mi olacak — karar verilmeli ve
  `aria-controls` iliskisi KORUNMALI. Mevcut test "follows the shared role=tab/tabpanel +
  aria-controls pattern" (`ReportsPage.test.tsx:1067`) bunu KILITLIYOR; deseni degistirirsen o
  testi de bilincli guncelle ve gerekcesini yaz.
- DERIN BAGLANTI korunur: sekme URL parametresinden okunuyor; kayitli gorunumler
  (`SavedViewsControl`, `report-views.ts`) ve e2e reload testi buna dayaniyor.
- Izin kapisi FAIL-CLOSED kalmali: scope'suz token 403 DEGIL BOS KATALOG alir (`GET /reports/groups`
  davranisi) ve istemci gormedigi grubu render ETMEZ.
- Export'u kenar cubuguna tasirken mevcut `ExportControl` (csv|pdf secici) DAVRANISI degismez.

(e) KAPSAM SINIRI: rapor FIGURLERI/hesaplari DEGISMEZ · benchmark DEGISMEZ · kayitli gorunum semasi
DEGISMEZ · yeni rapor grubu EKLENMEZ (Insights tm 226'nin isi).
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 · `audit:req-coverage` exit 0 ve `FR-MOD-07.1` site sayisi ARTMIS. Birim (`apps/web`, `--maxWorkers=4`): (1) kenar cubugu PRD'nin dokuz ogesini KATEGORI gruplari altinda gosteriyor; (2) grup genisletici acilip kapaniyor ve durumu klavyeyle degistirilebiliyor; (3) ARIA iliskisi tutarli (`aria-controls`/`aria-expanded`) ve mevcut desen testi ya yesil ya gerekceli guncellenmis; (4) DERIN BAGLANTI: URL'deki grup dogrudan aciliyor (REGRESYON); (5) izin kapisi FAIL-CLOSED — gorulmeyen grup render EDILMIYOR. a11y: e2e axe iki temada blocking 0. e2e: `apps/e2e/tests/reports.spec.ts` kenar cubugu gezinme + kayitli gorunum reload testi YESIL (regresyon) + yeni kanit PNG.
