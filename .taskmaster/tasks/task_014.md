# Task ID: 14

**Title:** 10.1.6 — Billing ekrani: plan/cycle/users + summary + Enter payment (mock)

**Status:** done

**Dependencies:** 13 ✓

**Priority:** high

**Description:** BillingPage'e checkout: plan secimi, cycle toggle (Monthly/Annual + indirim), users stepper ($/user/mo x qty), subscription summary, 'Enter payment details' -> Stripe MOCK. Gercek kart girisi kapsam DISI (PRD §11.1/1).

**Details:**

PRD: FR-MOD-10.1.6 · PLAN.md §3.8 · Dilim 14. apps/web/src/features/billing/BillingPage.tsx. Backend: task 13 PATCH /billing/subscription. Ozet canli toplam; 'Enter payment details' mock akis (gercek kart YOK, ADR-13). E2E gorsel kanit kanit/.

[günlük 2026-07-24 16:23 UTC] plan: BillingPage.tsx'e checkout etkilesimi (10.1.6). Subscription arayuzune min_seats + annual_savings_cents eklenir. Yeni 'Manage plan' Section: (1) cycle toggle Monthly|Annual (annual'da tasarruf gosterir) -> mutation({billing_cycle}); (2) users stepper -/+ (min=min_seats, − min'de disabled) -> mutation({seats}); (3) canli ozet: trial'da 'Billed now $0 · trial bitince X', aktifte estimated_total; (4) 'Enter payment details' -> mock odeme paneli (ADR-13, acikca 'mocked/no charge', gercek kart TOPLANMAZ). Mutation: api.patch('/billing/subscription'), onSuccess setQueryData ile cache guncelle (aninda). isPending'de butonlar disabled. E2E: cycle degistir + stepper + payment panel gorunur, kanit/14-billing-checkout.png.

[günlük 2026-07-24 16:33 UTC] BITTI. BillingPage.tsx 'Manage plan' Section: cycle toggle (Monthly/Annual, annual'da tasarruf), users stepper (min=min_seats, − tabanda disabled), canli ozet (trial'da 'Billed now $0 · trial bitince X', aktifte total, annual'da 'Saving X/yr'), 'Enter payment details' -> mock odeme paneli (ADR-13, disabled placeholder inputlar, 'mocked/no charge', gercek kart TOPLANMAZ). Mutation api.patch('/billing/subscription') onSuccess setQueryData ile aninda cache guncelle; isPending'de butonlar disabled. E2E kanit apps/e2e/kanit/14-billing-checkout.png. Tam E2E 34/34, web birim 40/40. E2E idempotency dersi: global-setup idempotent seed subscription'i sifirlamıyor -> test annual biraktiginda ikinci kosu Annual butonu disabled'a takiliyordu; test artik durumdan bagimsiz (bilinen monthly baslangic) + kendini geri yukluyor (monthly'e restore, seat +1/−1). Demo girisi 200.

**Test Strategy:**

Ekran plan/cycle/seats gosterir ve degistirir; ozet canli toplam; 'Enter payment details' MOCK akis (gercek kart YOK, ADR-13). Trial->ucretli gecis gorunur. Gorsel kanit: E2E iddianin ardindan kanit/<id>-*.png kaydeder.
