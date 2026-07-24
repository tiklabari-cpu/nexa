# Task ID: 14

**Title:** 10.1.6 — Billing ekrani: plan/cycle/users + summary + Enter payment (mock)

**Status:** pending

**Dependencies:** 13

**Priority:** high

**Description:** BillingPage'e checkout: plan secimi, cycle toggle (Monthly/Annual + indirim), users stepper ($/user/mo x qty), subscription summary, 'Enter payment details' -> Stripe MOCK. Gercek kart girisi kapsam DISI (PRD §11.1/1).

**Details:**

PRD: FR-MOD-10.1.6 · PLAN.md §3.8 · Dilim 14. apps/web/src/features/billing/BillingPage.tsx. Backend: task 13 PATCH /billing/subscription. Ozet canli toplam; 'Enter payment details' mock akis (gercek kart YOK, ADR-13). E2E gorsel kanit kanit/.

**Test Strategy:**

Ekran plan/cycle/seats gosterir ve degistirir; ozet canli toplam; 'Enter payment details' MOCK akis (gercek kart YOK, ADR-13). Trial->ucretli gecis gorunur. Gorsel kanit: E2E iddianin ardindan kanit/<id>-*.png kaydeder.
