# Task ID: 143

**Title:** GL-10 · F4-KAPAT [OPUS-MAX] Faz-4 §F.00 kapanış turu: §6A tablosu SAYILARAK (tüm kalemler ✅) + §F.1’in 10 maddesi tam sürüm + tam DoD kapısı + tam e2e + §F.2 proje geneli final rapor (ikinci) — ürün kodu yazılmaz

**Status:** done

**Dependencies:** 128 ✓, 129 ✓, 130 ✓, 131 ✓, 132 ✓, 133 ✓, 134 ✓, 135 ✓, 136 ✓, 137 ✓, 138 ✓, 139 ✓, 140 ✓, 141 ✓, 142 ✓

**Priority:** low

**Description:** Faz-4’ün kapanış turu (GL-3/4/8/9 emsali). Kalem kuralı: §6A tablosundaki her kalem ✅ (Should/Could/türetilmiş; Must yok). §F.1’in 10 maddesi TAM sürüm koda karşı koşulur (kapsam süpürmesi 138 FR-MOD + §7.2 NFR satırları · faz sızıntısı · NFR ölçümü · şema artıkları · contract-parity · sessiz borç · ölü kod/istemcisiz uç (audit script’leri) · doküman tazeliği · temiz kurulum provası (make dev + make demo) · kapsam dışı doğrulaması); tam DoD kapısı + tam e2e exit 0; §F.2 final raporu HANDOFF’a; üst tablo Faz-4 satırı ✅ KAPALI; §D kaydı. Ürün kodu YAZILMAZ (CONVENTIONS §5) — bulgu çıkarsa görev açılır ya da gerekçeli §D.

**Details:**

SIRA (GL-9 · tm 126'nın HANDOFF bloğu birebir emsal — `grep -n '^## 126 — GL-9' HANDOFF.md` ile oku):
1) Bağımlılık kontrolü: tm 128–142'nin TAMAMI `done` (Task Master); değilse bu görev BLOCKED — erken kapatma yok.
2) §6A tablosunu SAYARAK oku (öncü damga; naif glif sayımı değil — §D68–§D77 dersi): 15 kalem ✅ · 0 ◐ · 0 ⬜ olmalı (14 iş kalemi + M-SEC denetimi; GL-10 satırının kendisi sayılmaz);
   §7.2'de bu turda açılan türetilmiş satırlar (M-GATE · M-SCHED · M-ENV · M-CI · M-UI-GAP · M-CONTAINER · M-SEED ·
   M-SEC) + ◐'ye çekilen I18N1/2 · A11Y1–6 hepsi ✅; PLAN.md:572 `13.7` ✅.
3) §F.1'in 10 maddesi TAM sürüm — her biri kanıtla (komut çıktısı/sayı): `pnpm audit:*` script'leri (tm 132.4)
   ile kapsam süpürmesi + sessiz borç + ölü kod + şema tüketicileri + istemcisiz uç; NFR ölçümü (P2/P3 bundle/
   a11y/i18n); `contract-parity` 5/5; temiz kurulum: `make dev` + `make demo` (tm 140) + e2e demo akışı;
   §9 kapsam dışı taraması (sk_live/ivr/reactflow/…).
4) Tam DoD kapısı: typecheck · lint · format:check · test (3 ardışık — tm 129 sonrası deterministik olmalı) ·
   test:integration · build · test:e2e (tam) · db:check-drift · codegen diff — hepsi exit 0, sayılar rapora.
5) PLAN: üst tablo Faz-4 satırı `✅ KAPALI` + sayaç; §6A başlığı altına kapanış paragrafı; §F.00'a Faz-4 kapısı;
   §D'ye `D11x` (kapanış + bulgular); §E test sayacı; §K'ya `#### KGL-10`? (GL-9 nasıl yaptıysa aynen — bak).
6) HANDOFF: GL-10 bloğu + §F.2 PROJE GENELİ FİNAL RAPOR (ikinci sürüm): tamamlanan kapsam faz faz · yarım kalan
   (beklenen: 0 — değilse ismen) · bilinçli yapılmayanlar (⛔/⛔-süreç, PRD 🔒 kalmadıysa söyle) · sessiz borç ·
   sapmalar · karar bekleyen sorular (Q1/Q2/Q5-TR/Q8/Q9/Q12 — bu depodan cevaplanamaz).
7) Task Master: 143 done; kuyruk boş → HANDOFF "sonraki adım kullanıcının seçimidir; kendiliğinden açılacak görev yok".

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **GL-10 (Faz-4 kapanış turu — §F.00/§F.1/§F.2)**. Gereksinim satırı: `grep -n 'Faz 4 — Bütünleme' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KGL' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
Bu görev PLAN §6A başlığının altındaki "Faz-4 §F.00 kapısı" paragrafını ve üst tablo satırını yazar.
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

- Tam DoD kapısı + tam e2e exit 0 (sayılar HANDOFF'ta); `pnpm -w test` 3 ardışık yeşil.
- §6A sayacı 15/15 ✅ (sayılarak; GL-10 hariç); §7.2 türetilmiş satırlar ✅; PLAN.md:572 ✅.
- §F.1 10 maddenin her biri kanıtlı; §F.2 raporu HANDOFF'ta; üst tablo Faz-4 `✅ KAPALI`.
- Ürün kodu diff'i 0 (yalnız PLAN/HANDOFF/.taskmaster).
