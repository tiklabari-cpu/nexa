# Task ID: 224

**Title:** V8-RPT-SHARE [OPUS-XHIGH] Paylasilabilir rapor baglantisi — "Share export/link"in eksik yarisi (FR-MOD-07.3.1)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Kabul kriteri 'Range -> tum metrik yeniden hesap; custom takvim; Share export/link' diyor. Export yarisi tam (/reports/export csv|pdf); LINK yarisi yok — features/reports/ altinda Share kontrolu ya da token'li rapor URL'i ureten bir uc bulunmuyor.

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
PRD `:585`: "Overview header — range tabs (7/30/90/365 + custom) + vs previous period + SHARE" ·
KK: "Range -> tum metrik yeniden hesap; custom takvim; SHARE EXPORT/LINK".
`grep -rn "share" apps/web/src/features/reports/*.tsx` -> yalniz test metinlerinde ve
`share: number | null` alan adinda geciyor; SHARE KONTROLU YOK.
`#### K07.3.1` (PLAN.md ~8002) denetim maddesi birebir: "KK'daki 'Share export/link'in yalniz
'export' yarisi var. Paylasilabilir bir rapor baglantisi (share link / paylasim kontrolu) kodda yok:
apps/web/src/features/reports/ altinda Share adinda bir kontrol veya token'li rapor URL'i ureten
bir uc bulunmuyor". PLAN satiri 333, `Should`.
Mevcut export: `/reports/export` `format=csv|pdf` (`reports-export.ts` `toCsv`/`toPdf`),
UI'da `ExportControl`.

(b) DOKUNULACAK DOSYALAR:
- `packages/contract/openapi/paths/reports.yaml` — paylasim baglantisi uclari (olustur/iptal/oku).
- `apps/api/src/routes/reports.ts` + yeni `services/reports/report-share.ts`.
- `apps/api/prisma/schema.prisma` + genislet-only migration — paylasim kaydi (hash + kapsam +
  son kullanma + iptal damgasi).
- `apps/web/src/features/reports/ReportsPage.tsx` — Share kontrolu (mevcut `ExportControl`
  yaninda).
- EMSAL: PAT deseni (`routes/auth.ts` + `PersonalAccessTokens.tsx`, tm 181.2) — bir kez gosterilir,
  `Cache-Control: no-store`, satirda YALNIZ hash + son dort.

(c) CONTRACT-FIRST SIRA: sozlesme -> migration -> backend + integration (negatifler ONCE) ->
`contract:generate` -> web + unit -> e2e.

(d) BILINEN TUZAKLAR — BU GOREVIN RISKI GUVENLIKTIR:
- KIMLIKSIZ GENEL ERISIM ACILMAZ. Baglanti SURELI ve KAPSAM-SINIRLI olmali; NFR-S5 (IDOR) siniri
  gorev metnindedir. Paylasim token'i BASKA bir lisansin verisini ASLA acmamali.
- Token URL'de tasiniyorsa log/referrer sizintisi riski vardir: token log'a DUSMEMELI
  (`req.url` maskeleme deseni `server.ts` redact listesinde) ve audit metadata'sina yazilmamali.
- Ham token SAKLANMAZ — `hashToken` (PAT deseni), satirda yalniz hash. Bir kez gosterilir.
- Yeni OpenAPI YOLU eklendiginde `apps/mobile` parite testi TAM uc sayisini pinliyor — sayaci
  yorumla birlikte bump et (bilinen tuzak).
- Iptal (revoke) ve son kullanma ikisi de ISLEMELI; suresi dolmus token 401/404 (karar gorev
  icinde, sizinti yapmayan tarafi sec).

(e) KAPSAM SINIRI: rapor FIGURLERI DEGISMEZ · export bicimleri (csv/pdf) DEGISMEZ · e-posta ile
gonderim (zamanlanmis raporlar) DEGISMEZ · genel/anonim "public dashboard" ACILMAZ.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0, `contract:generate` sonrasi `git status --short packages/contract/src/generated` BOS, `db:check-drift` "no drift" · `audit:req-coverage` exit 0 ve `FR-MOD-07.3.1` site sayisi ARTMIS. Integration — NEGATIFLER ONCE: (1) CROSS-TENANT: A lisansinin paylasim token'i B'nin verisini ACMAZ (ZORUNLU); (2) suresi dolmus token erisemez; (3) iptal edilmis token erisemez; (4) token kapsami disindaki rapor grubu erisilemez (fail-closed); (5) ham token YANITTA ve SATIRDA yok (yalniz hash + son dort), `LOG_LEVEL=trace` altinda log'da yok, audit metadata'sinda yok — sizinti negatifi ZORUNLU; SONRA pozitif: gecerli token dogru raporu okur. Web unit: Share kontrolu token'i BIR KEZ gosteriyor, kopyalama var, ikinci acilista tekrar GOSTERMIYOR. e2e: baglanti uret -> ac -> iptal et -> erisilemez (kanit PNG). `apps/mobile` parite sayaci yorumla bumplandi.
