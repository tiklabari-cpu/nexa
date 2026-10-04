# Task ID: 138

**Title:** M4 — Web’in en ince kapsamlı iki yüzeyi test kazanır: ReportsPage (2 test / 2317 satır) ve BillingPage (1 test / 1205 satır) — §D113/K12

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** 2026-08-17 denetimi: `apps/web/src/features/` 18 dizin / 94 test dosyası; ancak reports 2 test (2317 satırlık sayfa) ve billing 1 test (1205 satır) — kapsam/yüzey oranı en zayıf ikisi. Regresyon riski en yüksek yerler bunlar (§D82/§D87 tarihçesi: bu iki alan flake ve locale kusurlarını üretmişti). Bu görev anlamlı unit testler ekler; ürün kodu değişmez (test edilirken bulunan kusur ayrı görev/nota).

**Details:**

BULGU (§D113/K12). İki SONNET alt-görevi. Kural: davranış testleri (kullanıcı ne görür/ne yapar), snapshot
DEĞİL; `renderWithLocale` (tm 133.1 yazdıysa) ile locale açıkça `en`; MSW/fetch mock deseni mevcut testlerdeki
gibi. Bulunan ürün kusuru → düzeltme bu görevin kapsamı DIŞI: HANDOFF + Task Master notu (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-M4 test piramidi (ince kapsam: Reports 2 test/2317 satır · Billing 1 test/1205 satır)**. Gereksinim satırı: `grep -n '| M4 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM4' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
PLAN §7.2 `M4` satırı ✅ kalır (piramit var); KM4 bloğuna iki madde (test sayıları önce/sonra).
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

İki alt-görev `done`; `pnpm --filter @siyahtus/web test` exit 0; reports ≥ +12, billing ≥ +10 test; typecheck/lint; KM4'e iki madde.

## Subtasks

### 138.1. M4-b [SONNET-XHIGH] ReportsPage testleri: sekme geçişleri · KPI kartları · düşük-baz uyarısı · SLA hedefsiz "—" · export/CSV · zamanlanmış rapor formu · reviews/topics boş durumları · benchmark

**Status:** done  
**Dependencies:** None  

Raporlar yüzeyi davranış testleri kazanır.

**Details:**

NE YAPILACAK: `features/reports/ReportsPage.test.tsx` (+ alt bileşen testleri) ≥ 12 senaryo — yukarıdaki
liste; sahte API yanıtları şema-geçerli (mobil `ReportsScreen.test.tsx` sıfır-veri gövdesi emsal). tm 133.6
aynı dosyayı çeviriyor olabilir — çakışırsa önce onun `t()` düzenine uy.
DOSYALAR: `features/reports/*.test.tsx`.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-M4 test piramidi (ince kapsam: Reports 2 test/2317 satır · Billing 1 test/1205 satır)**. Gereksinim satırı: `grep -n '| M4 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM4' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 138.2. M4-c [SONNET-XHIGH] BillingPage testleri: plan/koltuk/döngü değişimi · trial/read-only banner · AI resolutions meter + stepper · API paketi satın alma (mock) · fatura listesi · ödeme yöntemi (mock, "No card is charged") · entitlement rozetleri

**Status:** done  
**Dependencies:** None  

Faturalama yüzeyi davranış testleri kazanır.

**Details:**

NE YAPILACAK: `features/billing/BillingPage.test.tsx` ≥ 10 senaryo — yukarıdaki liste; §D82 dersi: locale
testte açıkça pinlenir (`setFormatLocale`/renderWithLocale). tm 133.7 ile çakışırsa önce onun düzenine uy.
DOSYALAR: `features/billing/*.test.tsx`.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-M4 test piramidi (ince kapsam: Reports 2 test/2317 satır · Billing 1 test/1205 satır)**. Gereksinim satırı: `grep -n '| M4 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM4' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
