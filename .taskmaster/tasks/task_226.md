# Task ID: 226

**Title:** V8-RPT-INSIGHT [OPUS-XHIGH] Reviews/Ratings'in Insights payi (FR-MOD-07.8)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PRD satiri dort sey sayiyor: rated good/bad; iki donem karsilastirma; Ecommerce/Tracked sales; INSIGHTS. Ilk ucu var, dorduncusu yok — apps/web/src ve apps/api/src genelinde 'insight' gecen tek bir dosya/bilesen bulunmuyor.

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
PRD `:592`: "Reviews / Ratings (rated good/bad; iki donem karsilastirma; Ecommerce/Tracked sales;
INSIGHTS)" · KK: "CSAT donut; gunluk bar; e-ticaret satis izleme".
`grep -rln "insight" apps/web/src apps/api/src` -> SIFIR eslesme (bu turda olculdu).
`#### K07.8` (PLAN.md ~8107) denetim maddesi birebir: "PRD satirinin 'Insights' kalemi kodda yok:
apps/web/src ve apps/api/src genelinde 'insight' gecen tek bir dosya/bilesen[…]". PLAN satiri 652,
`Should (v1)`. Diger uc pay VAR: CSAT donut + gunluk bar (`ReviewsTab`), iki donem karsilastirma
(`withBenchmark` `reviews` grubu), tracked sales (`13.5` ailesi + tm 201.1/201.2).

(b) DOKUNULACAK DOSYALAR:
- ILK IS: "Insights" bu urunde NE DEMEK — PRD satirindan turetilir, §C'ye (Assumptions) yazilir.
  Denetim metni kesik oldugu icin olcut PRD satiri + KK sutunudur (tm 187'nin `194.2` emsali).
- `apps/api/src/services/reports/` — yeni SAF turetim modulu (tablo testiyle).
- `apps/api/src/routes/reports.ts` + `packages/contract/openapi/paths/reports.yaml` — rapor
  grubuna alan/satir.
- `apps/api/src/services/reports/report-csv.ts` — CSV export satiri.
- `apps/web/src/features/reports/ReportsPage.tsx` + `locales/{en,tr}/reports.ts`.

(c) CONTRACT-FIRST SIRA: tanim (§C) -> saf modul + tablo testi -> sozlesme -> backend +
integration -> `contract:generate` -> web + unit -> CSV -> e2e.

(d) BILINEN TUZAKLAR:
- LLM CAGRISI ACILMAZ. "Insight" deterministik bir turetim olmali (esik/oran/trend kurallari),
  yoksa test edilemez ve DoD kapisindan gecmez. Emsal: GL-7'nin spam filtresi karari
  ("deterministik kural motoru; LLM yok — test edilebilirlik + yanlis-pozitif denetimi").
- Ince ornek tuzagi: az sayida derecelendirmede "trend" uydurmak yaniltir — dusuk-baz uyarisi
  ("shares may not be reliable" deseni) ZORUNLU.
- Rapor grubu eklenirse izin kapisi (`visibleReportGroups` · `GROUP_GATED_TABS`) FAIL-CLOSED
  kalmali ve `GET /reports/groups` katalogu ile senkron olmali.
- Yeni OpenAPI yolu eklersen `apps/mobile` parite sayacini yorumla bump et.

(e) KAPSAM SINIRI: CSAT hesabi DEGISMEZ · tracked sales (13.5) DEGISMEZ · benchmark altyapisi
DEGISMEZ · yeni AI saglayicisi/model ACILMAZ · Reports kenar cubugu yerlesimi tm 223'un isi.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0, `contract:generate` sonrasi beklenmeyen diff YOK · `audit:req-coverage` exit 0 ve `FR-MOD-07.8` site sayisi ARTMIS. Kapanis olcusu: `grep -rln "insight" apps/web/src apps/api/src` artik SIFIR DEGIL. Birim: saf turetim modulu TABLO testiyle — (1) bilinen girdi -> bilinen insight (deterministik, ayni girdi ayni cikti); (2) ince ornekte dusuk-baz uyarisi doner, trend UYDURMAZ; (3) bos veride patlamaz. Integration: rapor grubu yaniti insight satirini tasiyor + izin kapisi FAIL-CLOSED (scope'suz token grubu GORMEZ) + cross-tenant. CSV: export satiri var. Web unit + e2e (kanit PNG). §C'ye yazilan tanim bu gorevin BELGE kabul kriteridir — tanim yazilmadan gorev kapanmaz.
