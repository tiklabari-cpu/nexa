# Task ID: 13

**Title:** 10.1.1-.3 — Abonelik/checkout API (plan · cycle · seats)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Plan degistirme, faturalama dongusu (Monthly/Annual + indirim) ve koltuk (users stepper) icin abonelik mutasyonu. Stripe MOCK (ADR-13, A5) — dis cagri yok.

**Details:**

PRD: FR-MOD-10.1.1/.2/.3 · PLAN.md §3.8 · Dilim 14. Mevcut: apps/api/src/routes/reports.ts (GET /billing/subscription, /billing/usage), apps/api/src/services/billing/metering.ts, Subscription modeli (apps/api/prisma/schema.prisma). Yapilacak: PATCH /billing/subscription (plan/billingCycle/seats) — yillik indirim ve unitPriceCents ADR-13 (9900), toplam yeniden hesap. Kontrat-once: packages/contract/openapi (yeni billing.yaml veya reports.yaml). Lisans kapsamli; cross-tenant degistirilemez.

**Test Strategy:**

Plan/cycle/seats degisikligi subscription'a yansir; yillik indirim uygulanir; toplam ADR-13 (unitPriceCents=9900) ile dogru. Lisans kapsamli — cross-tenant baska lisansin abonligini degistiremez (test zorunlu). Stripe MOCK: dis cagri yok (A5), subscriptions lokal.
