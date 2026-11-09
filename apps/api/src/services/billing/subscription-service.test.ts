/**
 * The plan catalogue and what it grants (FR-MOD-11.5 · 11.5-a).
 *
 * `updateSubscription` needs a transaction and is covered against real Postgres
 * in `test/integration/reports-billing.test.ts`; what is unit-testable here is
 * the catalogue itself — the part every gate will read.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS } from '@siyahtus/types';
import {
  PLANS,
  PLAN_IDS,
  SELF_SERVE_PLAN_IDS,
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

// src/services/billing → apps/api → apps → repo root.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * The inline `enum` of `plan` in `PATCH /billing/subscription`'s body. A miss
 * throws rather than returning an empty list, so the check below cannot pass
 * while measuring nothing.
 */
function contractSelfServePlans(): string[] {
  const yaml = readFileSync(
    resolve(REPO_ROOT, 'packages/contract/openapi/paths/reports.yaml'),
    'utf8',
  );
  const start = yaml.indexOf('operationId: updateSubscription');
  if (start < 0) throw new Error('reports.yaml has no updateSubscription');
  const body = yaml.slice(yaml.indexOf('requestBody:', start), yaml.indexOf('responses:', start));
  const match = /\n\s+plan:\n\s+type: string\n\s+enum: \[([^\]]+)\]/.exec(body);
  if (!match) throw new Error('updateSubscription carries no inline plan enum');
  return (match[1] as string).split(',').map((value) => value.trim());
}

describe('the self-serve checkout (tm 432)', () => {
  it('sells only the listed tiers — never a quoted one', () => {
    expect(SELF_SERVE_PLAN_IDS).toEqual(['growth']);
    for (const id of SELF_SERVE_PLAN_IDS) expect(PLANS[id].pricing).toBe('listed');
    expect(SELF_SERVE_PLAN_IDS).not.toContain('enterprise');
  });

  it('is what the contract offers in the PATCH body', () => {
    expect(contractSelfServePlans()).toEqual([...SELF_SERVE_PLAN_IDS]);
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
