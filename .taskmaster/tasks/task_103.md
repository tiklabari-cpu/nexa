# Task ID: 103

**Title:** [SONNET-XHIGH] e2e: skills-routing.spec.ts kırılgan locator — `getByLabel('Skill')` strict-mode ihlali

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** `apps/e2e/tests/skills-routing.spec.ts:104` içindeki `skills.getByLabel('Skill')` yalnız "Skill" input'unu değil, seed'in üç uzmanlığına ait "Delete skill X" aria-label'lı butonları da eşliyor (alt dize + case-insensitive). Skills listesi render olduğunda locator 4 elemana çözülüyor ve Playwright strict-mode ihlaliyle düşüyor; henüz render olmadığında tek elemana çözülüp geçiyor — yani sonuç yükleme zamanlamasına bağlı.

**Details:**

BULUNDUĞU YER: tm 94.3 (07.9-sched-c) penceresinin DoD kapısında gözlendi; o task'ın kapsamıyla ilgisi yok (CONVENTIONS §5 gereği ayrı task).

BELİRTİ: `[chromium] › tests/skills-routing.spec.ts:76:3` →
`locator.fill: Error: strict mode violation: getByRole('region', { name: 'Skills' }).getByLabel('Skill') resolved to 4 elements` — 1) `#new-skill-name` input, 2-4) "Delete skill Billing" / "Delete skill Onboarding" / "Delete skill Technical support" butonları (seed'in üç uzmanlığı, 08.6.3-a).

KAPSAM: Locator'ı tekilleştir — `skills.getByRole('textbox', { name: 'Skill' })` ya da `skills.getByLabel('Skill', { exact: true })`. Aynı dosyada benzer alt-dize eşleşmesi taşıyan başka locator var mı diye bak. Kaynak UI'ı değiştirmek gerekmez; aria-label'lar doğru, kırılgan olan test tarafı.

KAPSAM DIŞI: e2e seed/teardown stratejisini elden geçirmek (ayrı konu — bkz. HANDOFF tm 94.3 ortam notu: `globalSetup` yalnız idempotent `db:seed` çağırıyor, tek spec'i üst üste koşturmak DB'yi kirletiyor).

NOT: Temiz durumda (integration truncate → e2e reseed) suite 80/80 geçiyor, yani bu bir regresyon değil; locator'ın zamanlamaya duyarlılığı.

**Test Strategy:**

`set -a && . ./.env && set +a && pnpm --filter @siyahtus/e2e exec playwright test tests/skills-routing.spec.ts` — üst üste 3 kez koştur, üçü de yeşil olmalı (bugün 1 geçip 2 düşüyor). Ardından `pnpm -w test:integration` → `pnpm -w test:e2e` sırasıyla tam kapı: 80/80.
