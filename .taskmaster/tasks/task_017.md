# Task ID: 17

**Title:** 08.7.1 — Tags kutuphanesi CRUD (grup kapsami)

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** Merkezi etiket kutuphanesi CRUD (grup kapsamli). Chat basina etiket zaten var; bu kutuphane + settings yuzeyi ve chat etiketlemeyi besleme.

**Details:**

PRD: FR-MOD-08.7.1 · PLAN.md §3.7 · Dilim 14. Tag modeli (apps/api/prisma/schema.prisma), apps/api/src/routes/settings.ts (canned/routing deseni), web apps/web/src/features/settings/SettingsPage.tsx. Kontrat-once. Lisans kapsamli + cross-tenant testi. E2E kanit/.

**Test Strategy:**

Etiket olustur/duzenle/sil grup kapsaminda; lisans kapsamli; cross-tenant baska lisansin etiketine erisemez (test zorunlu); chat etiketleme kutuphaneden besleniyor. contract-parity yesil. Gorsel kanit kanit/<id>-*.png.
