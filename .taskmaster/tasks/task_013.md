# Task ID: 13

**Title:** 10.1.1-.3 — Abonelik/checkout API (plan · cycle · seats)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Plan degistirme, faturalama dongusu (Monthly/Annual + indirim) ve koltuk (users stepper) icin abonelik mutasyonu. Stripe MOCK (ADR-13, A5) — dis cagri yok.

**Details:**

PRD: FR-MOD-10.1.1/.2/.3 · PLAN.md §3.8 · Dilim 14. Mevcut: apps/api/src/routes/reports.ts (GET /billing/subscription, /billing/usage), apps/api/src/services/billing/metering.ts, Subscription modeli (apps/api/prisma/schema.prisma). Yapilacak: PATCH /billing/subscription (plan/billingCycle/seats) — yillik indirim ve unitPriceCents ADR-13 (9900), toplam yeniden hesap. Kontrat-once: packages/contract/openapi (yeni billing.yaml veya reports.yaml). Lisans kapsamli; cross-tenant degistirilemez.

[günlük 2026-07-24 16:18 UTC] BITTI. PATCH /billing/subscription (10.1.1-.3): plan/cycle/seats mutasyonu. Yeni servis services/billing/subscription-service.ts (PLANS tek plan 'growth' ADR-13 9900/200; priceSeats yillik=10 ay=2 ay bedava ~%16.7 PRD %15-17 icinde; updateSubscription). GET refactor: buildSubscriptionView paylasimli — PATCH sonrasi gercek GET dondurur; seats=satin alinan (subscription.seats), min_seats=aktif ajan tabani, cycle-farkinda toplam + annual_savings. Sozlesme-once: SubscriptionView bilesen semasi + patch operasyonu, generate. allowWhenReadOnly:true (read-only'de abone olunabilir). BILLING_WRITE_SCOPES (billing_manage/admin; reports_read okuma, kabul edilmez). Downgrade guard yalniz gercek plan DEGISIMINDE (tek planla inert, ayni-plan seat degisimini yanlislikla bloklamaz — bug bulundu+duzeltildi). Testler: 513/513 API (10 yeni checkout: seats satin alma+GET, yillik fiyat+tasarruf, monthly'e donus, seat tabani 400, bilinmeyen plan/cycle/bos 400, billing scope 403, cross-tenant izolasyon, read-only'de yazilabilir). Not: seats semantigi aktif-sayidan satin-alinan'a degisti — mevcut GET testleri hala yesil (subscription.seats=aktif=2 ortusuyor).

**Test Strategy:**

Plan/cycle/seats degisikligi subscription'a yansir; yillik indirim uygulanir; toplam ADR-13 (unitPriceCents=9900) ile dogru. Lisans kapsamli — cross-tenant baska lisansin abonligini degistiremez (test zorunlu). Stripe MOCK: dis cagri yok (A5), subscriptions lokal.
