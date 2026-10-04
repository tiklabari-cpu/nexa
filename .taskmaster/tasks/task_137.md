# Task ID: 137

**Title:** A11Y — axe kapsamı kalan rotalara: public auth + onboarding · home/traffic/campaigns/goals · billing/playbook/audit-log/developers (bugün 7 rota + 2 dış yüzey ölçülü, ~yarısı ölçülmemiş) — NFR-A11Y ◐→✅

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** 2026-08-17 denetimi: `a11y.spec.ts` sign-in/inbox/customers/reports/team/settings/apps + widget + public KB tarar; ölçülmeyen: /app/home, /app/customers/{real-time,campaigns,goals}, /app/billing, /app/playbook, /app/settings/audit-log, /app/developers, /app/onboarding ve dört public auth sayfası (signup/forgot/reset/join). WCAG AA "widget + panel" iddiası panelin yarısı için ölçülmemiş → §7.2 satırı bu turda ◐. Bu görev kalan rotaları ölçer ve ihlalleri kaynağında düzeltir.

**Details:**

BULGU (§D113/K11): KA11Y kendisi "9 yüzey" der; ölçülmeyen 13 rota. Üç alt-görev (rota grupları),
her biri: rotayı a11y.spec'e ekle → koştur → ihlalleri düzelt → yeşil. §7.2 `A11Y1–6` satırı bu turda
`◐ → KA11Y`; 137.3 bitince `✅`.
ORTAK: `apps/e2e/tests/a11y.spec.ts` + `a11y.ts` (axe-core, wcag2a/2aa/21a/21aa, serious/critical = kapı,
IKI TEMA, focus/hover kapıları) mevcut desenle rota ekle; bulunan ihlaller (çoğunlukla `color-contrast`
token katmanında — KA11Y'nin ilk ölçümü 7/8 ekranı düşürmüştü) KAYNAĞINDA düzeltilir (token/bileşen),
testte muaf tutulmaz; `aria-label`/isim eksikleri bileşende. Kanıt: kanit PNG gerekmez (a11y.spec üretmiyor);
HANDOFF'a ihlal sayısı önce/sonra.

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-A11Y1–6 (WCAG 2.1 AA — panel yarısı ölçülmemiş)**. Gereksinim satırı: `grep -n '| A11Y1–6' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KA11Y' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev `done`; `pnpm -w test:e2e` (a11y.spec tüm rotalar, iki tema, exit 0) · web unit regresyonsuz · typecheck/lint/build; PLAN §7.2 `A11Y1–6` `✅ → KA11Y`; KA11Y'de üç madde (rota + önce/sonra ihlal sayısı).

## Subtasks

### 137.1. A11Y-b [SONNET-XHIGH] Public auth sayfaları (signup/forgot/reset/join) + /app/onboarding sihirbazı axe’e eklenir, ihlaller kaynağında düzeltilir

**Status:** done  
**Dependencies:** None  

Kayıt hunisi ve sihirbaz WCAG AA ile ölçülür.

**Details:**

NE YAPILACAK: a11y.spec.ts'e 5 rota (oturumsuz sayfalar için signIn fixture'ı atlanır; onboarding için taze
kiracı — `onboarding.spec.ts`'in kurulumunu paylaş); iki tema; ihlalleri düzelt (form etiketleri, hata
mesajı `aria-describedby`, kontrast). ORTAK: `apps/e2e/tests/a11y.spec.ts` + `a11y.ts` (axe-core, wcag2a/2aa/21a/21aa, serious/critical = kapı,
IKI TEMA, focus/hover kapıları) mevcut desenle rota ekle; bulunan ihlaller (çoğunlukla `color-contrast`
token katmanında — KA11Y'nin ilk ölçümü 7/8 ekranı düşürmüştü) KAYNAĞINDA düzeltilir (token/bileşen),
testte muaf tutulmaz; `aria-label`/isim eksikleri bileşende. Kanıt: kanit PNG gerekmez (a11y.spec üretmiyor);
HANDOFF'a ihlal sayısı önce/sonra.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-A11Y1–6 (WCAG 2.1 AA — panel yarısı ölçülmemiş)**. Gereksinim satırı: `grep -n '| A11Y1–6' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KA11Y' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 137.2. A11Y-c [SONNET-XHIGH] /app/home · /app/customers/real-time · /app/customers/campaigns · /app/customers/goals axe’e eklenir, ihlaller düzeltilir

**Status:** done  
**Dependencies:** None  

Home ve Engage yüzeyleri ölçülür.

**Details:**

NE YAPILACAK: 4 rota (+ campaigns builder açık hâli, goals create modalı açık hâli — hover/focus kapıları
mevcut yardımcıyla); ihlalleri düzelt. ORTAK: `apps/e2e/tests/a11y.spec.ts` + `a11y.ts` (axe-core, wcag2a/2aa/21a/21aa, serious/critical = kapı,
IKI TEMA, focus/hover kapıları) mevcut desenle rota ekle; bulunan ihlaller (çoğunlukla `color-contrast`
token katmanında — KA11Y'nin ilk ölçümü 7/8 ekranı düşürmüştü) KAYNAĞINDA düzeltilir (token/bileşen),
testte muaf tutulmaz; `aria-label`/isim eksikleri bileşende. Kanıt: kanit PNG gerekmez (a11y.spec üretmiyor);
HANDOFF'a ihlal sayısı önce/sonra.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-A11Y1–6 (WCAG 2.1 AA — panel yarısı ölçülmemiş)**. Gereksinim satırı: `grep -n '| A11Y1–6' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KA11Y' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 137.3. A11Y-d [SONNET-XHIGH] /app/billing · /app/playbook (editör açık) · /app/settings/audit-log · /app/developers axe’e eklenir, ihlaller düzeltilir; PLAN satırı ✅

**Status:** done  
**Dependencies:** 137.1, 137.2  

Kalan dört rota ölçülür; NFR-A11Y satırı kapanır.

**Details:**

NE YAPILACAK: 4 rota (+ SkillEditor açık hâli, DeveloperPortal PAT oluşturma diyaloğu); ihlalleri düzelt;
a11y.spec'in "tüm uygulama rotaları" iddiasını bir listeyle pinle (App.tsx rotaları ↔ spec rotaları eşitliği
— yeni rota eklenince test uyarır); PLAN §7.2 `A11Y1–6` → `✅ → KA11Y`. ORTAK: `apps/e2e/tests/a11y.spec.ts` + `a11y.ts` (axe-core, wcag2a/2aa/21a/21aa, serious/critical = kapı,
IKI TEMA, focus/hover kapıları) mevcut desenle rota ekle; bulunan ihlaller (çoğunlukla `color-contrast`
token katmanında — KA11Y'nin ilk ölçümü 7/8 ekranı düşürmüştü) KAYNAĞINDA düzeltilir (token/bileşen),
testte muaf tutulmaz; `aria-label`/isim eksikleri bileşende. Kanıt: kanit PNG gerekmez (a11y.spec üretmiyor);
HANDOFF'a ihlal sayısı önce/sonra.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-A11Y1–6 (WCAG 2.1 AA — panel yarısı ölçülmemiş)**. Gereksinim satırı: `grep -n '| A11Y1–6' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KA11Y' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
