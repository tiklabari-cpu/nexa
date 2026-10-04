# Task ID: 217

**Title:** V8-SHELL-MENU [SONNET-XHIGH] Logo bir menu/uygulama secici acsin (FR-MOD-01.1.1)

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** Kabul kriterinin iki yarisindan biri eksik: 'Menu/uygulama secici acilir; nav pin/unpin'. Pin/unpin tam ve erisilebilir; logodan acilan bir menu yok.

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
PRD `urun-gereksinim-dokumani-PRD.md:483`: "Logo/Hamburger — marka + nav daraltma/genisletme" ·
KK: "MENU/UYGULAMA SECICI ACILIR; nav pin/unpin".
Kod `apps/web/src/components/AppShell.tsx`: `:198` `<NavPinToggle pinned={pinned} .../>` (logo
konumundaki dugme YALNIZ rayi pinliyor/acıyor; `:294` tanimi — `aria-expanded`/`aria-controls` +
Enter/Space, erisilebilirlik TAM) · `:200` `<BrandSwitcher />` (`:577` tanimi) ve o da TEK LISANS
ICINDEKI MARKALARI degistiriyor — PRDnin sordugu "uygulama/menu secici" DEGIL.
`#### K01.1` (PLAN.md ~6540) denetim maddesi birebir: "logo bir menu acmiyor: 'Menu/uygulama secici
acilir' karsiligi yok. Shelldeki tek secici BrandSwitcher ve o da tek license icindeki markalari..."
PLAN satiri 280, oncelik `Should/Could`.

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/components/AppShell.tsx` — `NavPinToggle` + `BrandSwitcher` cevresi.
- `apps/web/src/components/ui/Dropdown.tsx` — MEVCUT primitif; klavye roving / Escape /
  disari-tiklama orada kanitli. Ucuncu-parti bagimlilik EKLEME (tm 189.5 emsali).
- `apps/web/src/locales/{en,tr}/*.ts` + gerekiyorsa `i18n-coverage.test.ts` `TRANSLATED_FILES`.

(c) SIRA: menunun ICERIGINE karar ver (workspace/marka secimi + hesap kisayollari; yeni uc
GEREKMIYORSA ACMA) -> `Dropdown` ile kur -> `BrandSwitcher`i menunun ICINE al (KALDIRMA) ->
unit + a11y.

(d) BILINEN TUZAKLAR:
- `NavPinToggle`in `aria-expanded`/`aria-controls`i RAYA aittir; menunun kendi `aria-expanded`i
  AYRIDIR. Ikisini ayni dugmede birlestirirsen ekran okuyucu icin anlam bozulur — pin/unpin ve
  menu acma AYRI etkilesimler olmali (ya ayri dugmeler ya acik bir birincil/ikincil ayrimi).
- Menu icindeki bir baglantinin etiketi baska bir dugmenin `aria-label`iyle CAKISIRSA
  `getByRole`/`getByLabelText` sorgulari baska testlerde kirilir (bilinen tuzak).
- `hover:underline` tasiyan metin-ici baglantilar axe `link-in-text-block` kuralini dusurur.

(e) KAPSAM SINIRI: `BrandSwitcher`in marka degistirme DAVRANISI degismez · yeni backend uc
ACILMAZ · komut paleti (⌘K, 01.1.3) DEGISMEZ · nav pin/unpin davranisi DEGISMEZ.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 · `audit:req-coverage` exit 0 ve `FR-MOD-01.1.1` site sayisi ARTMIS. Birim (`apps/web`, `--maxWorkers=4`): (1) logo/menu tetikleyicisi `aria-expanded` tasiyor ve tiklaninca `true` oluyor; (2) klavye: Enter/Space acar, ok tuslari gezer, Escape kapatir ve odak tetikleyiciye DONER; (3) disari tiklama kapatir; (4) `BrandSwitcher`in mevcut marka degistirme testi YESIL kalir (regresyon); (5) pin/unpin testi degismeden yesil. a11y: e2e axe kosusunda iki temada da blocking ihlal 0 (ozellikle `link-in-text-block` ve `aria-*` kurallari). e2e: menu acilip bir ogeye gidildigi kanit PNG'siyle.
