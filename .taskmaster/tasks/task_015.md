# Task ID: 15

**Title:** 01.1.6 — Trial rozeti 'N gun' + Subscribe CTA (shell)

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** AppShell'de kalan trial gunu rozeti + Subscribe CTA (billing'e yonlendirir). Trial gate zaten var (Dilim 9).

**Details:**

PRD: FR-MOD-01.1.6 · PLAN.md §3.1 · Dilim 14. apps/web/src/components/AppShell.tsx. Trial verisi /billing/subscription (trialEndsAt) veya /auth/me. Rozet kalan gunu gosterir, expired durumda dogru mesaj, CTA /billing'e gider. E2E kanit/.

**Test Strategy:**

Rozet kalan trial gununu dogru gosterir; expired/bitmis durumda dogru mesaj; Subscribe CTA /billing'e gider. Gorsel kanit kanit/<id>-*.png.
