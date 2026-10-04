# Task ID: 232

**Title:** GL-16 [OPUS-MAX] F8-KAPAT — Faz-8 §F.00 kapanis turu (kalem kurali 21/21)

**Status:** done

**Dependencies:** 211 ✓, 212 ✓, 213 ✓, 214 ✓, 215 ✓, 216 ✓, 217 ✓, 218 ✓, 219 ✓, 220 ✓, 221 ✓, 222 ✓, 223 ✓, 224 ✓, 225 ✓, 226 ✓, 227 ✓, 228 ✓, 229 ✓, 230 ✓, 231 ✓

**Priority:** low

**Description:** Faz-8'in (§6D) damgasini resmi bir kapanis turuyla karara baglar: §F.1'in 10 maddesi tam surum kosulur, §6D tablosunun 21 satiri dort bagimsiz kaynaga karsi SAYILIR ve damga ya `✅ KAPALI` ya gerekceli `❌ ACIK` olur.

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
PLAN.md §6D tablosu 22 satir tasiyor; GL-16 disindaki 21'i is/triyaj kalemidir. Faz-8'de `Must`
YOKTUR -> §F.00'in SAYAC kurali yerine KALEM kurali gecerlidir (Faz-3/4/5/6 emsali): "21 satirin
tamami `✅` oldugunda faz kapanir". Payda 21 SABIT — tm 211/212'nin triyaji bir satiri `⛔`ye
cevirirse payda DUSMEZ, o satir "⛔ sayilarak" kapanmis sayilir.

(b) DOKUNULACAK DOSYALAR:
- `PLAN.md` ust kapi tablosu (Faz 8 satiri) · §6D kapanis paragrafi · §F.00'a Faz-8 kapisi ·
  yeni `#### KGL-16` blogu.
- `HANDOFF.md` — §F.2 raporu.
- KOD YAZILMAZ (kapanis turu; §D143'un kurali: `git diff --name-only` urun kaynagi SIFIR dosya).

(c) SIRA — GL-11/GL-12'nin DORT BAGIMSIZ KAYNAK yontemi, her satir icin:
1. Task Master durumu `done` (+ varsa alt-gorevlerin tamami `done`);
2. §6D tablosunun damgasi;
3. `## K` blogunda o kalem icin EN AZ BIR kanit maddesi;
4. Kanitin ADLANDIRDIGI dosyanin diskte FIILEN var olmasi.
Damga ancak DORDU DE yesilken cevrilir. Naif glif sayimi yapma; damgayi once cevirip sonra saymak
DONGUSELDIR.

(d) BILINEN TUZAKLAR:
- `## K` blogundaki `◐` glifleri TARIHCEDIR, sayaca girmez (§6C kapanis paragrafinin kurali).
- Tablo tur basinda BAYAT damga tasiyor olabilir — GL-11 sekiz satirin sekizinde de `⬜` buldu,
  GL-12 dortte. "Faz kapanmaz" sonucu once bu ihtimale karsi test edilir.
- `✅` UYDURULMAZ (§F.00). Kalan is varsa gerekceli `❌ ACIK` yazilir ve yeni kalem acilir.
- DoD kapisi §1.3 geregi PARCALANARAK kosulur ve `--force` ile (cache yok); `test` gate'i
  unit-only DEGILDIR ve uc gate bir Bash timeout'unu asar — arka plana al, blocking bekle.
- `test:e2e` ~55 `kanit` PNG'sini YENIDEN YAZAR; bu beklenen bir diff'tir.
- Bayat bir Vite sunucusu (port 5173) e2e'yi TOPLUCA dusurur — kod kusuru degildir, once onu ele.

(e) KAPSAM SINIRI: urun kodu/migration/test YAZILMAZ · Faz-0/1/2 kapanis turlari (tm 208/209/210)
BU GOREVIN DEGIL · yeni kalem acmak serbesttir ama YAPILMAZ (yalniz acilir).

(f) KAPANIS: commit + push + Task Master `done`.

**Test Strategy:**

§F.1'in 10 maddesi TAM SURUM kosulur ve her biri exit code'uyla kanitlanir: (1) kapsam supurmesi `pnpm audit:sweep`; (2) faz sizintisi kontrolu; (3) NFR olcumleri (P3 bundle butcesi · P5 `audit:unpaged-lists` UNPAGED 0 · A11Y e2e axe blocking 0; P1/P2/P8 icin OLCUM YENIDEN KOSULMAZ — sahibi ve tarihi yazilir, §D143/3); (4) `pnpm audit:schema-consumers`; (5) `contract-parity`; (6) `pnpm audit:silent-debt`; (7) `pnpm audit:dead-code` + `audit:endpoint-ui` (tm 215'ten sonra METOT bazli); (8) dokuman tazeligi; (9) temiz kurulum provasi; (10) kapsam disi dogrulamasi. Tam DoD: `typecheck` · `lint` · `format:check` · `build` · test §1.3 geregi PARCALANARAK `--force` · integration `turbo run test:integration --concurrency=1` · `contract:generate` sonrasi `git status --short packages/contract/src/generated` BOS · `db:check-drift` "no drift" · `test:e2e` yesil. Kapanis kriteri: §6D'nin 21 satiri DORT BAGIMSIZ KAYNAGA karsi sayildi ve sayim handoff'ta madde madde yazili; damga `✅ KAPALI` ya da GEREKCELI `❌ ACIK`. Urun kaynagi diffi SIFIR dosya.
