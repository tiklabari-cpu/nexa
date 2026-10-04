# Task ID: 216

**Title:** V8-ONBOARD [SONNET-XHIGH] Onboarding sihirbazinin eksik iki adimi — ek kanallar + sirket buyuklugu (FR-MOD-00.4)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PRD bes adim sayiyor, kod dort adim tasiyor. Kabul kriteri birebir '5 adim tamamlaninca Home checklist + ornek sample chat gosterilir' diyor; iki adim hic yazilmadi.

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
PRD `urun-gereksinim-dokumani-PRD.md:477`: "Onboarding sihirbazi (ad, website, EK KANALLAR,
SIRKET BUYUKLUGU, ekip daveti) + tohum veri (ornek sohbet, hazir KB, ornek skill)" · KK: "5 ADIM
tamamlaninca Home checklist + ornek 'sample chat' gosterilir".
Kod `apps/web/src/features/onboarding/OnboardingWizard.tsx:30-32`:
  `type StepId = 'welcome' | 'website' | 'team' | 'sample';`
  `const STEPS: readonly StepId[] = ['welcome', 'website', 'team', 'sample'];`
= DORT adim. `#### K00.4` (PLAN.md ~7903) denetim maddesi ayni seyi soyluyor: "PRD'nin 'ek kanallar'
ve 'sirket buyuklugu' adimlari yok". PLAN satiri 270 `◐ → K00.4`, oncelik `Should (MVP)`.

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/features/onboarding/OnboardingWizard.tsx` — `StepId` + `STEPS` + adim bilesenleri
  + `useStepper` + ilerleme gostergesi (`:164` `STEPS.map`).
- `apps/api/src/routes/onboarding.ts` (+ servis) — `GET/PATCH /onboarding/state`in tasidigi alanlar.
- `packages/contract/openapi/paths/onboarding.yaml` + `packages/types` — durum sozlugu.
- `apps/web/src/locales/{en,tr}/*.ts` — yeni adim metinleri; yeni bilesen eklersen
  `i18n-coverage.test.ts` `TRANSLATED_FILES` listesine EKLE (bilinen tuzak).
- `apps/api/prisma/schema.prisma` — `company_size` icin: `08.3`in `Organization` alanlari
  (`M-CO-a`, migration `20260904100324_organization_company_details`) ZATEN sirket detaylarini
  tasiyor; oraya yazilir, IKINCI BIR DOGRULUK KAYNAGI ACILMAZ. Alan yoksa genislet-only migration.

(c) CONTRACT-FIRST SIRA: sozlesme (`onboarding.yaml` + tipler) -> (gerekiyorsa) migration ->
backend + integration -> sihirbaz adimlari + unit -> e2e.

(d) BILINEN TUZAKLAR:
- Sihirbaz "kaldigi adimdan devam" ediyor (`:75` `if (state.data.demo_seeded) steps.goTo(...)`) —
  adim sayisi degisince bu mantik ve kayitli ilerleme BOZULABILIR. Eski durumla acilan bir hesap
  patlamamali (ileri-uyumluluk testi ZORUNLU).
- Home checklist ayni kaynaktan okuyor (tm 136.4 · `M-UI-GAP-d`): `GET /onboarding/state`.
  Checklist madde sayisi ile sihirbaz adim sayisi TUTARLI kalmali.
- "Ek kanallar" adimi Settings->Channels'a KOPRU kurar; kanal baglama akisini KOPYALAMAZ
  (tek dogruluk kaynagi: mevcut kanal ekrani).
- `OnboardingWizard` `lib/form.tsx` `useForm` primitifini kullanmali (EK-A.1) — kendi
  validasyonunu yazma; ama BASKA bir alanin validatorunu aynen kopyalama (form validatoru kendi
  ucunun sozlesmesiyle eslesmeli, yoksa Submit gereksiz yere kilitlenir).

(e) KAPSAM SINIRI: tohum veri (`onboarding_seed_demo` SECURITY DEFINER) DEGISMEZ · kanal baglama
akisi DEGISMEZ · Home checklist'in kendi yerlesimi DEGISMEZ (yalniz kaynak alanlar buyur) ·
07.2 survey popover (tm 139.6) AYRI bir kalemdir.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 (`typecheck` · `lint` · `format:check` · `build` · `contract:generate` sonrasi beklenmeyen diff yok · `db:check-drift` · `audit:req-coverage` exit 0 ve `FR-MOD-00.4` site sayisi ARTMIS). Birim (`apps/web`, `--maxWorkers=4`): (1) sihirbaz BES adim gosteriyor ve ilerleme gostergesi 5 diyor; (2) her yeni adim bos birakilabiliyorsa atlanabiliyor / zorunluysa Submit kilitli (KK'ya gore karar gorev icinde, testte sabitlenir); (3) ESKI durumla (dort adimlik kayitli ilerleme) acilan sihirbaz PATLAMIYOR ve dogru adima donuyor; (4) i18n-coverage yesil. Integration: `GET/PATCH /onboarding/state` yeni alanlari tasiyor + `company_size` `Organization`a yaziliyor (ikinci tabloya DEGIL) + cross-tenant negatif (A lisansinin durumu B'ye sizmaz). e2e: sihirbaz bes adim yuruyup Home checklist'i aciyor (kanit PNG).
