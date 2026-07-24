# Task ID: 15

**Title:** 01.1.6 — Trial rozeti 'N gun' + Subscribe CTA (shell)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** AppShell'de kalan trial gunu rozeti + Subscribe CTA (billing'e yonlendirir). Trial gate zaten var (Dilim 9).

**Details:**

PRD: FR-MOD-01.1.6 · PLAN.md §3.1 · Dilim 14. apps/web/src/components/AppShell.tsx. Trial verisi /billing/subscription (trialEndsAt) veya /auth/me. Rozet kalan gunu gosterir, expired durumda dogru mesaj, CTA /billing'e gider. E2E kanit/.

[günlük 2026-07-24 16:38 UTC] plan: Trial rozeti (01.1.6) AppShell'de ince ust banner. Rail 56px cok dar -> banner. AppShell flex-col'e restructure: <TrialBanner/> + <div flex row>(rail+Outlet). TrialBanner: useQuery(['billing','subscription']) — BillingPage ile paylasimli cache; access trialing -> 'N gun kaldi', read_only -> 'trial bitti, abone ol', active -> null. retry:false (dusuk-scope ajan 403 -> banner yok, graceful). Subscribe NavLink -> /app/billing. Owner/admin reports_read+billing_manage'e sahip (ADMIN_SCOPES). E2E: banner gorunur 'days left' + Subscribe tikla -> /app/billing, kanit/15-trial-badge.png.

**Test Strategy:**

Rozet kalan trial gununu dogru gosterir; expired/bitmis durumda dogru mesaj; Subscribe CTA /billing'e gider. Gorsel kanit kanit/<id>-*.png.
