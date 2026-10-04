# Task ID: 168

**Title:** GL-12 · F6-KAPAT [OPUS-MAX] Faz-6 §F.00 kapanış turu: §6C tablosu SAYILARAK + §F.1 in 10 maddesi tam sürüm + tam DoD kapısı + tam e2e + §F.2 proje geneli final rapor (üçüncü)

**Status:** done

**Dependencies:** 159 ✓, 160 ✓, 161 ✓, 162 ✓, 163 ✓, 164 ✓, 165 ✓, 166 ✓, 167 ✓

**Priority:** low

**Description:** Faz-6 nın kapanış turu. §F.00 un KALEM kuralı uygulanır (Faz-6 da Must yoktur): §6C tablosunun GL-12 dışındaki DOKUZ satırının tamamı ✅ olmalı. Sayım SAYILARAK yapılır (öncü damga; naif glif sayımı DEĞİL). §F.1 in 10 maddesi TAM SÜRÜM koşulur ve §F.2 nin proje geneli final raporu ÜÇÜNCÜ kez üretilir.

**Details:**

NE YAPILACAK (§F.00 + §F.1 + §F.2, sıra önemli):
1. SAYAÇ: §6C tablosunun GL-12 dışındaki 9 satırının ÖNCÜ damgası sayılır. Hepsi ✅ değilse faz
   KAPANMAZ — ya tamamlanır ya kapsam daraltılıp kalanı gerekçeli yeni kaleme ayrılır (§F.00).
2. §F.1 in 10 maddesi TAM SÜRÜM: kapsam süpürmesi (pnpm audit:sweep) · faz sızıntısı · NFR kapıları
   ÖLÇÜLEREK (bu turda P1/P2/P8 için tm 161 in GERÇEK sayıları var — kullan) · şema artıkları
   (pnpm audit:schema-consumers) · kontrat bütünlüğü (contract-parity) · sessiz borç
   (pnpm audit:silent-debt) · ölü kod (pnpm audit:dead-code + audit:endpoint-ui) · doküman tazeliği ·
   temiz kurulum provası (make dev + make demo) · kapsam dışı doğrulaması.
3. TAM DoD KAPISI + TAM E2E: typecheck · lint · format:check · test · test:integration · build ·
   test:e2e (tam süit) · db:check-drift · contract:generate sonrası git status temiz.
4. DAMGALAR: üst faz özet tablosunun Faz-6 satırı ⬜ AÇIK → ✅ KAPALI · §6C ye kapanış paragrafı
   · §F.00 a Faz-6 kapısı paragrafı · §KGL-12 bloğu.
5. §F.2 PROJE GENELİ FİNAL RAPOR (üçüncü sürüm) HANDOFF a: tamamlanan kapsam faz faz ·
   yarım kalan işler (PRD kimliği + neden + kalan iş tahmini) · bilinçli yapılmayanlar (⛔/🔒/⛔-süreç) ·
   sessiz borç · sapmalar · karar bekleyen açık sorular (PRD §11.2 ile karşılaştırmalı).
   RAPORDA AÇIKÇA YAZ: mock sağlayıcılar hâlâ mock tur (kullanıcı kararıyla kapsam dışıydı) ve
   gerçek bir dağıtım YAPILMAMIŞTIR — manifestler yazıldı, uygulanmadı.

ÜRÜN KODU YAZILMAZ (CONVENTIONS §5) — diff yalnız PLAN.md · HANDOFF.md · .taskmaster.
Bir kalem eksikse onu BU pencerede yapma; sayacı dürüstçe yaz ve kapatma.

KAPI KOŞMA NOTU (CONVENTIONS §1.3): tek komut olarak pnpm -w test bir pencerenin komut tavanını
aşar (~15 dk). Parçala ve her parçanın exit code unu yaz; parçaların birleşimi dosya sayısıyla
birebir olmalı. Kapı komutlarını ARKA PLANA ATMA.

SONRASI (§F.3): Faz-6 bu turun son fazıdır. Kapanıştan sonra ne yapılacağı KULLANICININ SEÇİMİDİR;
kendiliğinden açılacak görev YOKTUR ve run-loop bu noktada durmalıdır. İlk aday: mock → gerçek
sağlayıcı geçişi (LLM · SMTP · S3 · Stripe · push · SIEM · AV · beş kanal) — bu turda bilinçli olarak
kapsam dışı bırakılmıştı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **GL-12** (türetilmiş — §F.00 faz kapanış kapısı). Gereksinim satırı: `grep -n "| GL-12" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KGL-12" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

- §6C tablosunun 9 satırı SAYILARAK ✅ (sayım yöntemi HANDOFF ta yazılı).
- §F.1 in 10 maddesinin her biri FİİLEN koşuldu ve çıktısı HANDOFF ta.
- Tam DoD kapısı + TAM e2e süiti yeşil, exit code larla.
- §F.2 final raporu üretildi ve mock/deploy sınırlarını açıkça yazıyor.
- git diff --stat: ürün kodu SIFIR.
