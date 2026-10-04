# Task ID: 231

**Title:** V8-HOME [SONNET-XHIGH] Home'un iki eksik kabul kriteri — kisisellestirilmis karsilama + Performance overview (FR-MOD-13.1)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Uc kabul kriterinden ikisi eksik: sayfa basligi sabit 'Home' / 'Your workspace at a glance', ajanin adini kullanan bir karsilama satiri hicbir yerde uretilmiyor; Performance overview PRD'nin dortlusunu tasimiyor. Onboarding checklist payi VAR.

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
PRD `:713`: "Home dashboard (dolu hal) — KISISELLESTIRILMIS KARSILAMA + onboarding checklist +
PERFORMANCE OVERVIEW (Total chats/Satisfaction/Response time/Efficiency, 'Updated every Monday') +
Real time overview (Customers online / Ongoing chats / Logged in agents) + Last 7 days".
Kod `apps/web/src/locales/en/home.ts:12-13`:
  `'home.page.title': 'Home',` · `'home.page.description': 'Your workspace at a glance',`
= sabit; ad kullanan karsilama YOK.
`#### K13.1` (PLAN.md ~6279) denetim maddesi birebir: "Uc kabul kriterinin ikisi eksik.
(1) 'Kisisellestirilmis karsilama' yok: sayfa basligi sabit 'Home' / 'Your workspace at a glance'
(locales/en/home.ts:11-12); ajanin adini kullanan bir karsilama satiri hicbir yerde uretilmiyor.
(2) Performance overview PRD'ni[n dortlusunu]…". PLAN satiri 671, `Should (v1)`.
Checklist payi VAR: tm 136.4 (`M-UI-GAP-d`) `GET /onboarding/state`ten okuyor.

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/features/home/` (Home sayfasi) + `locales/{en,tr}/home.ts`.
- Ad kaynagi: oturum baglami — `AppShell` presence/hesap avatari zaten ajanin adini biliyor
  (`PresenceAvatars.tsx` · hesap menusu). YENI UC ACILMAZ.
- Dort figur: `/reports/overview` sozlugu (`apps/api/src/routes/reports.ts`). IKINCI BIR METRIK
  KAYNAGI ACILMAZ — mevcut rapor alanlarindan okunur.
- `i18n-coverage.test.ts` `TRANSLATED_FILES` — yeni bilesen eklenirse KAYDET (bilinen tuzak).

(c) CONTRACT-FIRST SIRA: dort figurun `/reports/overview`da KARSILIGI VAR MI diye bak; eksikse
sozlesme -> backend -> `contract:generate`; sonra web + unit -> e2e.

(d) BILINEN TUZAKLAR:
- "Updated every Monday" bir ZAMAN IDDIASIDIR: figurler haftalik pencereden mi geliyor, yoksa
  metin mi yaniltici — karara bagla ve `#### K13.1`e yaz. Yanlis bir tazelik iddiasi yazma.
- Ad bilinmiyorsa (yeni hesap, ad alani bos) karsilama BOZULMAMALI — nazik bir fallback
  ("Welcome back" gibi) ve testi.
- Ad kullanici verisidir: sayfa basligi `document.title`a yazilirsa tarayici gecmisine ve
  ekran paylasimina duser. Baslikta mi govdede mi — karari yaz.
- i18n: karsilama cumlesi INTERPOLASYON gerektirir (`{name}`); mevcut `t()` yardimcisinin
  interpolasyon destegi VAR MI kontrol et, yoksa string birlestirme YAPMA (RTL/dil sirasi bozulur).
- Bos/ince veri: dort figur sifir baz durumunda NaN gostermemeli.

(e) KAPSAM SINIRI: onboarding checklist (tm 136.4) DEGISMEZ · Real time overview ve Last 7 days
bloklari MEVCUT haliyle kalir (kapsam disi birakilirsa gerekcesi yazilir) · rapor hesaplari
DEGISMEZ · 07.2 survey popover DEGISMEZ.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 · `audit:req-coverage` exit 0 ve `FR-MOD-13.1` site sayisi ARTMIS. Birim (`apps/web`, `--maxWorkers=4`): (1) karsilama satiri ajanin ADINI iceriyor; (2) ad yoksa nazik fallback render ediliyor, patlamiyor; (3) Performance overview PRD'nin DORT figurunu (Total chats / Satisfaction / Response time / Efficiency) gosteriyor; (4) sifir-baz durumunda NaN/Infinity YOK; (5) onboarding checklist REGRESYON yesil (tm 136.4 kaynagi degismedi); (6) `i18n-coverage.test.ts` yesil ve karsilama cumlesi interpolasyonla (string birlestirmeyle DEGIL) kuruluyor — `tr` locale'de dogru siralaniyor. Integration: dort figur `/reports/overview` sozlugunden geliyor, ikinci bir kaynak YOK + cross-tenant. e2e: giris -> Home'da ad gorunuyor + dort kart (kanit PNG). "Updated every Monday" iddiasinin dogrulugu `#### K13.1`e yazili.
