# Task ID: 158

**Title:** GL-11 · F5-KAPAT [OPUS-MAX] Faz-5 §F.00 kapanış turu: §6B tablosu SAYILARAK + §F.1 in 10 maddesi tam sürüm + tam DoD kapısı + tam e2e + §F.2 raporu

**Status:** done

**Dependencies:** 150 ✓, 151 ✓, 152 ✓, 153 ✓, 154 ✓, 155 ✓, 156 ✓, 157 ✓

**Priority:** low

**Description:** Faz-5 in kapanış turu. §F.00 un KALEM kuralı uygulanır (Faz-5 te Must yoktur): §6B tablosunun GL-11 dışındaki SEKİZ satırının tamamı ✅ olmalı. Sayım SAYILARAK yapılır (öncü damga; naif glif sayımı DEĞİL — §D68-§D77 nin beş turluk yanlış-pozitif tarihçesi). §F.1 in 10 maddesi TAM SÜRÜM koşulur ve §F.2 raporu HANDOFF a yazılır.

**Details:**

NE YAPILACAK (§F.00 + §F.1 + §F.2, sıra önemli):
1. SAYAÇ: §6B tablosunun GL-11 dışındaki 8 satırının ÖNCÜ damgası sayılır. Hepsi ✅ değilse faz
   KAPANMAZ — ya tamamlanır ya kapsam daraltılıp kalanı gerekçeli yeni kaleme ayrılır (§F.00).
2. §F.1 in 10 maddesi TAM SÜRÜM (mini sürüm yetmez): kapsam süpürmesi (pnpm audit:sweep) · faz sızıntısı
   · NFR kapıları ÖLÇÜLEREK · şema artıkları (pnpm audit:schema-consumers) · kontrat bütünlüğü
   (contract-parity) · sessiz borç (pnpm audit:silent-debt) · ölü kod (pnpm audit:dead-code +
   audit:endpoint-ui) · doküman tazeliği · temiz kurulum provası · kapsam dışı doğrulaması.
3. TAM DoD KAPISI + TAM E2E: typecheck · lint · format:check · test · test:integration · build ·
   test:e2e (tam süit) · db:check-drift · contract:generate sonrası git status temiz.
4. DAMGALAR: üst faz özet tablosunun Faz-5 satırı ⬜ AÇIK → ✅ KAPALI · §6B ye kapanış paragrafı
   · §F.00 a Faz-5 kapısı paragrafı · §KGL-11 bloğu.
5. §F.2 raporu HANDOFF a: tamamlanan kapsam · yarım kalan işler (PRD kimliği + neden + kalan iş tahmini)
   · bilinçli yapılmayanlar · sessiz borç · sapmalar · karar bekleyen açık sorular.

ÜRÜN KODU YAZILMAZ (CONVENTIONS §5) — bu bir kapanış turudur; diff yalnız PLAN.md · HANDOFF.md ·
.taskmaster. Bir kalem eksikse onu BU pencerede yapma, sayacı dürüstçe yaz ve kapatma.

KAPI KOŞMA NOTU (CONVENTIONS §1.3): tek komut olarak pnpm -w test bir pencerenin komut tavanını
aşar (~15 dk). Parçala ve her parçanın exit code unu yaz; parçaların birleşimi dosya sayısıyla
birebir olmalı. Kapı komutlarını ARKA PLANA ATMA.

FAZ-6 YA GEÇİŞ: Faz-6 (tm 159-168) Faz-5 e teknik olarak BAĞLI DEĞİLDİR; bu kapanış Faz-6 yı
açmaz, yalnız Faz-5 i kapatır. Kuyruk Faz-6 ile devam eder.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **GL-11** (türetilmiş — §F.00 faz kapanış kapısı). Gereksinim satırı: `grep -n "| GL-11" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KGL-11" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

- §6B tablosunun 8 satırı SAYILARAK ✅ (sayım yöntemi HANDOFF ta yazılı).
- §F.1 in 10 maddesinin her biri FİİLEN koşuldu ve çıktısı HANDOFF ta (rapor "tamamlandı" diyorsa
  onu ölçen komut koşulmuş olmalı — §F.2 nin uyarısı).
- Tam DoD kapısı + TAM e2e süiti yeşil, exit code larla.
- git diff --stat: ürün kodu SIFIR.
