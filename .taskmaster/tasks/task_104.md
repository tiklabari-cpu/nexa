# Task ID: 104

**Title:** fix(e2e): skills-routing.spec.ts:76 taze seed'de deterministik kırık — getByLabel('Skill') strict mode violation

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** `apps/e2e/tests/skills-routing.spec.ts:104` — `getByRole('region', { name: 'Skills' }).getByLabel('Skill')` Playwright'ta alt-dize (substring, case-insensitive) eşleşmesi yaptığı için, seed'in üç becerisinin `aria-label="Delete skill Billing|Onboarding|Technical support"` silme butonlarını da yakalıyor → strict mode violation (4 eleman) → `locator.fill` patlıyor. Locator daraltılmalı.

**Details:**

TESPİT (tm 95.2 penceresi, 2026-08-08): DoD kapısının kendi sırası bu testi her temiz koşuda kırmızıya düşürüyor. `pnpm -w test:integration` paylaşılan DB'yi TRUNCATE ediyor (apps/api/test/helpers/fixtures.ts `resetDatabase`); ardından çalışan e2e'nin `global-setup.ts` → `pnpm db:seed` adımı tenant'ı SIFIRDAN kuruyor ve seed her zaman üç expertise kaydı yaratıyor (apps/api/prisma/seed.ts:357 — Billing / Technical support / Onboarding). Settings → Skills bölgesinde bu üç kayıt için `aria-label="Delete skill <ad>"` butonları render ediliyor (apps/web/src/features/settings/SettingsPage.tsx:1159 civarı), `getByLabel('Skill')` bunları da eşliyor.

Tenant zaten varsa seed idempotent atlıyor ve beceriler tenant'a göre farklı durumda kalabildiği için hata "flaky" görünüyor; aslında DB durumuna göre DETERMİNİSTİK.

KANIT: tm 95.2 diff'i `git stash` ile çıkarılıp AYNI taze-seed DB durumunda tekrar koşuldu → birebir aynı hata, aynı satır. Yani bu kırık tm 95.2'den ÖNCE de vardı; o pencere kapsam disiplini (CONVENTIONS §5) gereği dokunmadı.

MUHTEMEL DÜZELTME (tek satır): `skills.getByLabel('Skill', { exact: true })` veya niyeti daha açık yazan `skills.getByRole('textbox', { name: 'Skill' })`. Testin geri kalanı (routing + supervisor takeover akışı) sağlam — yalnız ilk `fill` adımı hedefini bulamıyor.

DOSYA: apps/e2e/tests/skills-routing.spec.ts:104 (yalnız bu satır; ürün kodu DEĞİŞMEZ).
KAPSAM DIŞI: SettingsPage'in aria-label'larını değiştirmek (silme butonunun etiketi doğru ve erişilebilir) · seed'i değiştirmek.

**Test Strategy:**

`pnpm -w test:integration` (DB'yi truncate eder) → hemen ardından `pnpm -w test:e2e` → tam suite 82/82 yeşil olmalı. Ek olarak tek tek: `npx playwright test tests/skills-routing.spec.ts` iki ardışık koşuda da 2/2 yeşil (locator artık DB durumuna duyarsız).
