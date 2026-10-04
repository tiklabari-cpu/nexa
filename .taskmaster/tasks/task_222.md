# Task ID: 222

**Title:** V8-AIPERF-KPI [SONNET-XHIGH] AI Performance KPI kartlari PRD'nin dort metrigiyle hizalansin (FR-MOD-06.5)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PRD 'Resolution rate, AI chats, CSAT, Transferred %' sayiyor; kod ikinci kart olarak 'AI chats resolved' (= cozulen sohbet SAYISI) gosteriyor. Iki metrik PRD'nin sordugu sey degil.

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
PRD `:576`: "Performance (AI analitigi) — Resolution rate, AI CHATS, CSAT, TRANSFERRED %" ·
KK: "KPI kartlari; DUSUK-BAZ UYARISI; AI OFF IKEN ARSIV AYRIMI".
Kod `apps/web/src/features/playbook/performance.ts`: `:17` `resolution_rate` · `:19`
`transfer_rate` · `:52` `key: 'resolution_rate'` · `:65` `key: 'csat'` · `:72` `key: 'transfer_rate'`
ve ikinci kart `report.resolutions` (SAYI) uzerinden "AI chats resolved".
`#### K06.5` (PLAN.md ~6039) denetim maddesi: "Dort KPI karti PRD'nin saydigi dort metrigi
karsilamiyor ... 'AI chats resolved' (= report.resolutions, yani cozulen sohbet SAYISI) ... yani iki[si]".
PLAN satiri 633, `Should (v1)`. Ekran: `AiPerformance.tsx` (`PlaybookPage` `view==='performance'`).

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/features/playbook/performance.ts` (+ `performance.test.ts`) — saf `performanceKpis`
  / `isLowBase`.
- `apps/web/src/features/playbook/AiPerformance.tsx` (+ testi).
- `apps/api/src/routes/reports.ts` — `/reports/ai-agent` yaniti; alan adi degisiyorsa
  `packages/contract/openapi/paths/reports.yaml` + `contract:generate`.
- `apps/mobile` salt-okur Reports yuzeyi AYNI sozlugu okur — parite testini kir.
- `apps/web/src/locales/{en,tr}/playbook.ts` — kart etiketleri.

(c) CONTRACT-FIRST SIRA: "AI chats" metriginin TANIMINA karar ver (PRD satiri + KK; ADR-09
"automated" tanimiyla CELISMEMELI) -> sozlesme (gerekiyorsa) -> backend + integration -> saf
fonksiyon + tablo testi -> UI + unit -> mobil parite.

(d) BILINEN TUZAKLAR:
- ADR-09 "automated" tanimi KORUNUR; "AI chats" onunla ayni sey mi, degil mi — karari
  `#### K06.5`e YAZ. 07.4 (AI Agent raporu) ve 07.3.2 (Manual/Assisted/Automated) AYNI kaynaktan
  besleniyor; birini degistirirken otekini kirma (`reports-billing.test.ts` bunu kapiyor).
- KK'nin iki ek payi ayrica DOGRULANIR: `isLowBase` (dusuk-baz uyarisi) VAR mi ve esigi PRD ile
  tutarli mi · "AI off iken arsiv ayrimi" davranisi VAR mi. Yoksa bu gorevin kapsamindadir.
- Alan adi degisirse mobil parite testi ve OpenAPI yol sayaci etkilenir; yol EKLENMIYORSA sayac
  degismez, ama alan degisimi mobil tipleri kirar.

(e) KAPSAM SINIRI: ADR-09 tanimi DEGISMEZ · 07.4/07.3.2 raporlarinin figurleri DEGISMEZ ·
benchmark (vs-onceki donem) altyapisi DEGISMEZ · CSAT hesabi DEGISMEZ.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 (sozlesme degistiyse `contract:generate` sonrasi `git status --short packages/contract/src/generated` BOS) · `audit:req-coverage` exit 0 ve `FR-MOD-06.5` site sayisi ARTMIS. Birim: `performance.test.ts` — dort kartin dordu de PRD'nin adlandirdigi metrigi doner (ikinci kart artik ham SAYI degil PRD'nin "AI chats" tanimi) · `isLowBase` esigi tablo testiyle sabit · sifir-baz durumunda NaN/Infinity DONMEZ. Integration: `/reports/ai-agent` yaniti yeni sozlugu tasiyor + `reports-billing.test.ts` REGRESYON yesil (07.4 ve 07.3.2 figurleri DEGISMEDI) + cross-tenant. Web unit: `AiPerformance.tsx` dort karti dogru etiketle render ediyor, dusuk-baz uyarisi gorunuyor, "AI off" durumunda arsiv ayrimi davranisi testli. `apps/mobile` parite testi yesil.
