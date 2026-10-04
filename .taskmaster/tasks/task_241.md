# Task ID: 241

**Title:** V8-NFR-C8 [OPUS-MAX] Retention penceresi kiraci basina ayarlanamiyor + "right to erasure" ucu yok

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PLAN §7.2 `C1/C2/C8` satiri `◐ → KC1-C2-C8` kaliyor ve satirin UC maddesinden yalniz `C8` acik: `C1` (GDPR sozlesme metinleri) ve `C2` (KVKK/VERBIS) 2026-08-31 sahip karariyla kapsam disi. `C8` gercek bosluk: PRD "yapilandirilabilir (30/60/365/sinirsiz)" diyor, kod pencereleri YALNIZ ortamdan okuyor (dagitim geneli, kiraci basina degil) ve "right to erasure" (GDPR Md.17) ucu hic yok. Ikisini de kodun kendi yorumu "separate, later work" diye yazmis ama hicbir goreve baglamamis — sessiz borc.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §3. Sinirlar `CLAUDE.md`.
Contract-first sira ZORUNLU (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend +
unit test -> frontend + typed client -> E2E.
PLAN satiri: §7.2 `| C1/C2/C8 |` · kanit blogu `#### KC1-C2-C8`. PLAN.md ~2,3 MB — BASTAN SONA
OKUMA.

(a) OLCULEN BULGU (tm 212 · 2026-09-07):
PRD `urun-gereksinim-dokumani-PRD.md`:820 → `NFR-C8 | Veri saklama (retention) |
Yapilandirilabilir (30/60/365/sinirsiz) + gercek hard-delete + "right to erasure" API
(GDPR Md.17), yedekler dahil | Kaynakta 60 gun (Starter) / sinirsiz; "erisim ≠ silme" gerilimi
giderilir`.
- TESLIM olan: gercek hard-delete. `apps/api/src/services/retention/` — RLS altinda kiraci
  kiraci, batch'li, yas yuklemi zorunlu (`cutoffFor` sifir/negatif pencereyi REDDEDIYOR),
  `audit_log` icin append-only invaryantini bozmadan tek SECURITY DEFINER fonksiyonuyla,
  dry-run varsayilan (`--apply` ile siler), her supurme kendi audit satirini yaziyor
  (`data.retention_pruned`). Buna DOKUNMA.
- EKSIK olan iki sey, ikisi de `apps/api/src/services/retention/policy.ts`in kendi baslik
  yorumunda ADIYLA yazili: "Per-tenant overrides (a column on `security_settings`) and the
  'right to erasure' API (GDPR Art. 17, a targeted single-subject delete) are separate, later
  work". Yani tasarim yonu zaten kayitli, sahibi yoktu.
  1. Pencereler yalnizca `apps/api/src/config/env.ts:358-362`ten okunuyor
     (`RETENTION_THREAD_DAYS` / `_VISIT_DAYS` / `_MAIL_DAYS` / `_AUDIT_DAYS`) — bir dagitimdaki
     TUM kiracilar ayni pencereyi paylasiyor. Denetim de bunu yaziyor: "settings.ts'in 46
     route'unun hicbiri..." (metin `…` ile kesik; olcut PRD + koddur).
  2. Hedeflenmis tek-ozne silme ucu yok: `grep -rni 'erasure' apps/api/src` yalniz iki YORUM
     donduruyor (`routes/customers.ts:249` · `policy.ts:8`), rota yok.

(b) SINIRLAR — bunlari bozma:
- **HIPAA tavani.** `capRetentionForHipaa` / `HIPAA_RETENTION_CEILING` (NFR-C4 · C4-e): HIPAA
  kapsamindaki bir workspace serbestce secemez. Kiraci basina override bu tavanin ALTINDA
  kalmali; tavani asan bir ayar sessizce kabul EDILMEMELI.
- **"sinirsiz" secenegi.** PRD dort deger sayiyor (30/60/365/sinirsiz). `cutoffFor` sifir ya da
  negatif pencereyi reddediyor — "sinirsiz"i 0 diye kodlamak o korumayi tam ters yone cevirir.
  Ayri bir "kapali" durumu (NULL / sentinel) gerekir ve testi yazilir.
- **"erisim ≠ silme" gerilimi.** PRD'nin kendi cumlesi; silme ucu bir okuma yetkisiyle
  acilamaz — kendi scope'u + `minimumRole` + audit satiri olmali (emsal: `settings.ts`in
  `organization--my:rw` + `minimumRole: admin` deseni, `CompanyDetails` turu).
- **`RETENTION_ENABLED` varsayilani `false`** her ortamda ve OYLE KALMALI (README "Background
  jobs": zamanlanmis bir gecisin soracak operatoru yok). Kiraci ayari bu bayragi ezmez.

(c) KAPSAM SINIRI:
- YALNIZ `C8`. `C1`/`C2` kapsam disidir (sahip karari 2026-08-31, PLAN §7C "Kapsam disi"
  paragrafi; `audit:req-coverage` ikisini `non-code` muafiyetiyle paydanin disinda tutuyor) —
  bu gorev onlara DOKUNMAZ, hukuki metin YAZMAZ.
- "yedekler dahil" ifadesi bir yedekleme politikasi isidir (`#### KM-BACKUP` · tm 165); bu gorev
  yedek icerigini SILMEZ, yalnizca sinirini `#### KC1-C2-C8`ye yazar.

(d) KAPANIS: §7.2 `C1/C2/C8` satiri bu gorev bitince `✅` olur (C1/C2 kapsam disi gerekcesi
zaten blokta yazili). Kanit `#### KC1-C2-C8` blogua APPEND edilir. commit + push + `done`.

**Test Strategy:**

Olcut PRD NFR-C8'in dort parcasidir: (1) kiraci basina pencere GERCEKTEN ayri — iki workspace farkli pencere secip supurme kosuldugunda biri budaniyor, oteki durum degistirmiyor (entegrasyon testi, RLS altinda); (2) dort deger de kabul ediliyor (30/60/365/sinirsiz) ve "sinirsiz" bir SILME KAPALI durumudur, 0 gun DEGIL — `cutoffFor`un sifir/negatif reddi bozulmadan yesil kaliyor; (3) HIPAA tavani ustunlugunu koruyor: tavani asan bir kiraci ayari reddediliyor ya da tavana kirpiliyor ve bu testle kilitli; (4) "right to erasure" ucu tek ozneyi siliyor, capraz-kiraci negatifi var, kendi audit satirini yaziyor ve salt-okuma yetkisiyle CAGRILAMIYOR; (5) migration `pnpm -w db:check-drift` exit 0 + CONVENTIONS §6.3 prova; (6) kontrat degistigi icin `pnpm -w contract:generate` sonrasi `git status --short packages/contract/src/generated` BOS; (7) tam DoD kapisi exit code'lariyla.
