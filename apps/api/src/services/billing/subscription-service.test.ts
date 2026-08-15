/**
 * The plan catalogue and what it grants (FR-MOD-11.5 · 11.5-a).
 *
 * `updateSubscription` needs a transaction and is covered against real Postgres
 * in `test/integration/reports-billing.test.ts`; what is unit-testable here is
 * the catalogue itself — the part every gate will read.
 */
import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS } from '@nexa/types';
import {
  PLANS,
  PLAN_IDS,
  entitlementsForPlan,
  isPlanId,
  priceSeats,
  pricingForPlan,
} from './subscription-service.js';

describe('plan catalogue', () => {
  it('offers the self-serve tier and Enterprise', () => {
    expect([...PLAN_IDS].sort()).toEqual(['enterprise', 'growth']);
  });

  it("keeps growth on ADR-13's numbers", () => {
    // $99 per user per month, 200 AI resolutions — the PRD's §5.3
    // differentiator. A change here changes what customers are quoted.
    expect(PLANS.growth).toMatchObject({
      pricing: 'listed',
      unitPriceCents: 9900,
      aiResolutionsIncluded: 200,
    });
  });

  it('gives Enterprise no invented price or allowance', () => {
    // The PRD names Enterprise capabilities and never an Enterprise price.
    // Numbers here would be this repo making one up.
    expect(PLANS.enterprise.pricing).toBe('quoted');
    expect(PLANS.enterprise.unitPriceCents).toBeNull();
    expect(PLANS.enterprise.aiResolutionsIncluded).toBeNull();
  });

  it('grants nothing on growth and every capability on Enterprise', () => {
    expect(PLANS.growth.entitlements).toEqual([]);
    expect([...PLANS.enterprise.entitlements].sort()).toEqual([...ENTITLEMENTS].sort());
  });

  it('recognises its own ids and nothing else', () => {
    expect(isPlanId('growth')).toBe(true);
    expect(isPlanId('enterprise')).toBe(true);
    expect(isPlanId('platinum')).toBe(false);
    expect(isPlanId(undefined)).toBe(false);
    expect(isPlanId(7)).toBe(false);
  });
});

describe('entitlementsForPlan', () => {
  it('answers every key for every plan, so nothing is ever undefined', () => {
    for (const id of PLAN_IDS) {
      const map = entitlementsForPlan(id);
      expect(Object.keys(map).sort()).toEqual([...ENTITLEMENTS].sort());
    }
  });

  it('denies the Enterprise capabilities on the self-serve tier', () => {
    expect(entitlementsForPlan('growth')).toEqual({
      white_label: false,
      sandbox: false,
      sla: false,
      sso: false,
      hipaa: false,
      siem_export: false,
    });
  });

  it('grants them on Enterprise', () => {
    expect(entitlementsForPlan('enterprise')).toEqual({
      white_label: true,
      sandbox: true,
      sla: true,
      sso: true,
      hipaa: true,
      siem_export: true,
    });
  });

  it('grants nothing for a plan the catalogue does not know', () => {
    // `plan` is a free-form column; a row saying `platinum` must fail closed,
    // not fall through to allow.
    for (const unknown of ['platinum', '', 'GROWTH', null, undefined]) {
      expect(Object.values(entitlementsForPlan(unknown))).toEqual(ENTITLEMENTS.map(() => false));
    }
  });
});

describe('pricingForPlan', () => {
  it('reports how each tier is priced, and treats an unknown plan as listed', () => {
    expect(pricingForPlan('growth')).toBe('listed');
    expect(pricingForPlan('enterprise')).toBe('quoted');
    // A row with a plan nobody recognises still carries real amounts written by
    // whoever put it there — reporting them as negotiable would be a guess.
    expect(pricingForPlan('platinum')).toBe('listed');
    expect(pricingForPlan(null)).toBe('listed');
  });
});

describe('priceSeats', () => {
  it('bills the seats once on monthly, with nothing to save', () => {
    expect(priceSeats(9900, 3, 'monthly')).toEqual({
      seatChargeCents: 3 * 9900,
      annualSavingsCents: 0,
    });
  });

  it('bills ten months on annual and saves two', () => {
    expect(priceSeats(9900, 3, 'annual')).toEqual({
      seatChargeCents: 3 * 9900 * 10,
      annualSavingsCents: 3 * 9900 * 2,
    });
  });
});
