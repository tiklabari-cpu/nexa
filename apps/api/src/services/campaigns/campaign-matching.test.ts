import type { CampaignRule } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import {
  campaignPerformance,
  computeCampaignStatus,
  deriveActiveIntent,
  evaluateCampaign,
  hasBrowserRules,
  hasTrigger,
  matchesConditions,
  needsVisitorDetails,
  resolveCampaignStatus,
  serverRuleHolds,
  storedConditions,
  visitedPagesOf,
  visitorPageUrls,
  visitorPagesOf,
  type VisitorContext,
} from './campaign-matching.js';

describe('visitorPageUrls', () => {
  it('pulls the string urls out of a pages array', () => {
    expect(
      visitorPageUrls([
        { url: 'https://shop.example/pricing', at: 'x' },
        { url: 'https://shop.example/cart' },
      ]),
    ).toEqual(['https://shop.example/pricing', 'https://shop.example/cart']);
  });

  it('survives malformed json rather than throwing', () => {
    expect(visitorPageUrls(null)).toEqual([]);
    expect(visitorPageUrls('not-an-array')).toEqual([]);
    expect(visitorPageUrls([{ url: 42 }, {}, { url: '' }, { url: '/ok' }])).toEqual(['/ok']);
  });
});

// The single reader chat-service's Details visitor and customer-service's
// `GET /customers/:id` visits both go through (FR-MOD-13.2) — a second,
// independently written parser in either place would let the two panels
// disagree on the same visit.
describe('visitedPagesOf', () => {
  it('keeps url and, when present, at — in order', () => {
    expect(
      visitedPagesOf([
        { url: 'https://shop.example/bikes', at: '2026-07-20T10:00:00.000Z' },
        { url: 'https://shop.example/bikes/brakes' },
      ]),
    ).toEqual([
      { url: 'https://shop.example/bikes', at: '2026-07-20T10:00:00.000Z' },
      { url: 'https://shop.example/bikes/brakes' },
    ]);
  });

  it('drops an at that is not a string, keeping the entry', () => {
    expect(visitedPagesOf([{ url: '/ok', at: 12345 }])).toEqual([{ url: '/ok' }]);
  });

  it('is defensive against a manually edited or malformed row — an unreadable entry is dropped, not an error', () => {
    expect(visitedPagesOf(null)).toEqual([]);
    expect(visitedPagesOf(undefined)).toEqual([]);
    expect(visitedPagesOf('not-an-array')).toEqual([]);
    expect(visitedPagesOf({ not: 'an array' })).toEqual([]);
    expect(visitedPagesOf([{ url: 42 }, {}, null, 'garbage', { url: '/ok' }])).toEqual([
      { url: '/ok' },
    ]);
  });
});

describe('hasTrigger', () => {
  it('is true only when a condition carries something to match on', () => {
    expect(hasTrigger({ url_contains: '/pricing' })).toBe(true);
    expect(hasTrigger({})).toBe(false);
    expect(hasTrigger({ url_contains: '   ' })).toBe(false);
  });
});

describe('visitorPagesOf', () => {
  it('reads the last page as the current one and keeps the whole session', () => {
    expect(visitorPagesOf(['/withdraw', '/casino'])).toEqual({
      currentUrl: '/casino',
      sessionUrls: ['/withdraw', '/casino'],
    });
  });

  it('has no current page for a visitor with no readable page', () => {
    expect(visitorPagesOf([])).toEqual({ currentUrl: null, sessionUrls: [] });
    // An unreadable last entry is skipped by `visitorPageUrls`, so the visitor
    // is on the last page that could be read rather than nowhere.
    expect(visitorPagesOf(visitorPageUrls([{ url: '/a' }, { url: 7 }])).currentUrl).toBe('/a');
  });
});

describe('matchesConditions', () => {
  const on = (...urls: string[]) => visitorPagesOf(urls);

  it('matches when the visitor is on a page containing the needle (case-insensitive)', () => {
    expect(
      matchesConditions({ url_contains: '/Pricing' }, on('https://shop.example/pricing')),
    ).toBe(true);
  });

  it('does not match when the current page does not contain the needle', () => {
    expect(matchesConditions({ url_contains: '/pricing' }, on('https://shop.example/blog'))).toBe(
      false,
    );
  });

  it('EN-04 · looks at the current page only: /withdraw then /casino is not on /withdraw', () => {
    const conditions = { url_contains: 'withdraw' };
    expect(
      matchesConditions(
        conditions,
        on('https://shop.example/withdraw', 'https://shop.example/casino'),
      ),
    ).toBe(false);
    expect(
      matchesConditions(
        conditions,
        on('https://shop.example/casino', 'https://shop.example/withdraw'),
      ),
    ).toBe(true);
    expect(matchesConditions(conditions, on('https://shop.example/withdraw'))).toBe(true);
  });

  it('does not match a visitor with no known page', () => {
    expect(matchesConditions({ url_contains: '/pricing' }, on())).toBe(false);
  });

  it('matches nobody when there is no trigger', () => {
    // The rule that keeps "trigger required" honest: an empty predicate is not
    // "everyone", it is "not ready".
    expect(matchesConditions({}, on('https://shop.example/pricing'))).toBe(false);
    expect(matchesConditions({ url_contains: '' }, on('https://shop.example/pricing'))).toBe(false);
  });
});

describe('computeCampaignStatus', () => {
  const now = new Date('2026-07-26T12:00:00.000Z');
  const hourBefore = new Date('2026-07-26T11:00:00.000Z');
  const hourAfter = new Date('2026-07-26T13:00:00.000Z');

  it('is inactive whenever the campaign is switched off, whatever the schedule', () => {
    expect(computeCampaignStatus({ active: false, startsAt: null, endsAt: null }, now)).toBe(
      'inactive',
    );
    expect(
      computeCampaignStatus({ active: false, startsAt: hourBefore, endsAt: hourAfter }, now),
    ).toBe('inactive');
  });

  it('is scheduled while an active campaign has not started yet', () => {
    expect(computeCampaignStatus({ active: true, startsAt: hourAfter, endsAt: null }, now)).toBe(
      'scheduled',
    );
  });

  it('is ongoing once an active campaign has started and not ended', () => {
    expect(computeCampaignStatus({ active: true, startsAt: hourBefore, endsAt: null }, now)).toBe(
      'ongoing',
    );
    expect(computeCampaignStatus({ active: true, startsAt: null, endsAt: hourAfter }, now)).toBe(
      'ongoing',
    );
    expect(computeCampaignStatus({ active: true, startsAt: null, endsAt: null }, now)).toBe(
      'ongoing',
    );
  });

  it('falls back to inactive once an active campaign has ended', () => {
    expect(
      computeCampaignStatus({ active: true, startsAt: hourBefore, endsAt: hourBefore }, now),
    ).toBe('inactive');
  });
});

describe('deriveActiveIntent', () => {
  const now = new Date('2026-07-26T12:00:00.000Z');
  const hourBefore = new Date('2026-07-26T11:00:00.000Z');
  const hourAfter = new Date('2026-07-26T13:00:00.000Z');

  it('reads a stored ongoing or scheduled campaign as switched on', () => {
    expect(deriveActiveIntent({ status: 'ongoing', endsAt: null }, now)).toBe(true);
    expect(deriveActiveIntent({ status: 'scheduled', endsAt: hourAfter }, now)).toBe(true);
  });

  it('reads a stored inactive campaign as switched off', () => {
    expect(deriveActiveIntent({ status: 'inactive', endsAt: null }, now)).toBe(false);
    expect(deriveActiveIntent({ status: 'inactive', endsAt: hourAfter }, now)).toBe(false);
  });

  it('reads an inactive campaign whose end date has passed as still switched on', () => {
    // The tie-break that keeps "extend a finished campaign's schedule" working:
    // the end date explains the `inactive`, so it is not evidence of an owner
    // reaching for the toggle.
    expect(deriveActiveIntent({ status: 'inactive', endsAt: hourBefore }, now)).toBe(true);
  });
});

describe('resolveCampaignStatus', () => {
  const now = new Date('2026-07-26T12:00:00.000Z');
  const hourBefore = new Date('2026-07-26T11:00:00.000Z');
  const hourAfter = new Date('2026-07-26T13:00:00.000Z');

  it('promotes a scheduled campaign whose start time has arrived', () => {
    // The defect this whole path exists for: nothing fires at `starts_at`, so
    // the stored word stays `scheduled` for ever.
    expect(
      resolveCampaignStatus({ status: 'scheduled', startsAt: hourBefore, endsAt: null }, now),
    ).toBe('ongoing');
  });

  it('retires an ongoing campaign whose end date has passed', () => {
    expect(
      resolveCampaignStatus({ status: 'ongoing', startsAt: hourBefore, endsAt: hourBefore }, now),
    ).toBe('inactive');
  });

  it('leaves a campaign alone while the stored word is still true', () => {
    expect(
      resolveCampaignStatus({ status: 'scheduled', startsAt: hourAfter, endsAt: null }, now),
    ).toBe('scheduled');
    expect(
      resolveCampaignStatus({ status: 'ongoing', startsAt: null, endsAt: hourAfter }, now),
    ).toBe('ongoing');
  });

  it('never turns a stored inactive campaign back on', () => {
    // The invariant `fireCampaignsAtVisitor` leans on when it excludes
    // `inactive` in SQL: neither an off campaign nor a finished one can be
    // resurrected by a recompute, whatever its schedule says.
    for (const schedule of [
      { startsAt: null, endsAt: null },
      { startsAt: hourBefore, endsAt: null },
      { startsAt: hourBefore, endsAt: hourBefore },
      { startsAt: hourAfter, endsAt: null },
      { startsAt: null, endsAt: hourAfter },
    ]) {
      expect(resolveCampaignStatus({ status: 'inactive', ...schedule }, now)).toBe('inactive');
    }
  });

  it('reads an archived campaign as inactive whatever its stored word says (EN-05)', () => {
    // Belt and braces for the delivery path: archiving writes `inactive`, but a
    // row that somehow still says `ongoing` must not deliver once archived.
    for (const status of ['ongoing', 'scheduled', 'inactive']) {
      expect(
        resolveCampaignStatus(
          { status, startsAt: hourBefore, endsAt: hourAfter, archivedAt: hourBefore },
          now,
        ),
      ).toBe('inactive');
    }
    expect(
      resolveCampaignStatus(
        { status: 'ongoing', startsAt: hourBefore, endsAt: hourAfter, archivedAt: null },
        now,
      ),
    ).toBe('ongoing');
  });
});

describe('campaignPerformance', () => {
  const delivered = new Date('2026-01-01T00:00:00Z');

  it('counts displayed / chats / conversion from delivered sends (FR-MOD-03.3.3)', () => {
    expect(
      campaignPerformance([
        { deliveredAt: delivered, engaged: false, converted: false },
        { deliveredAt: delivered, engaged: true, converted: false },
        { deliveredAt: delivered, engaged: true, converted: true },
      ]),
    ).toEqual({ displayed: 3, chats: 2, conversion: 1, suppressed: 0 });
  });

  it('does not count a send that has not been delivered yet as displayed (FR-MOD-03.3.3)', () => {
    expect(
      campaignPerformance([
        { deliveredAt: delivered, engaged: false, converted: false },
        { deliveredAt: null, engaged: false, converted: false },
      ]),
    ).toEqual({ displayed: 1, chats: 0, conversion: 0, suppressed: 0 });
  });

  it('does not count an undelivered send as a conversion, even if the goal already fired (FR-MOD-03.3.3)', () => {
    // GoalService.evaluate marks every one of a customer's sends `converted`
    // on a goal hit without checking delivery (campaign-trigger.ts's M-CAMP-e
    // note) — a send can carry `converted: true` with `deliveredAt: null`.
    expect(campaignPerformance([{ deliveredAt: null, engaged: false, converted: true }])).toEqual({
      displayed: 0,
      chats: 0,
      conversion: 0,
      suppressed: 0,
    });
  });

  it('is all zeros, not NaN/Infinity, when nothing has been delivered yet (FR-MOD-03.3.3)', () => {
    expect(
      campaignPerformance([
        { deliveredAt: null, engaged: false, converted: false },
        { deliveredAt: null, engaged: false, converted: false },
      ]),
    ).toEqual({ displayed: 0, chats: 0, conversion: 0, suppressed: 0 });
  });

  it('is all zeros for a campaign that has fired at nobody', () => {
    expect(campaignPerformance([])).toEqual({
      displayed: 0,
      chats: 0,
      conversion: 0,
      suppressed: 0,
    });
  });

  it('counts the sends a risk flag held back apart from the displayed ones (EN-01 · tm 350)', () => {
    const at = new Date();
    expect(
      campaignPerformance([
        { deliveredAt: null, suppressedAt: at, engaged: false, converted: true },
        { deliveredAt: null, suppressedAt: at, engaged: false, converted: false },
        { deliveredAt: at, suppressedAt: null, engaged: true, converted: false },
        { deliveredAt: null, suppressedAt: null, engaged: false, converted: false },
      ]),
    ).toEqual({ displayed: 1, chats: 1, conversion: 0, suppressed: 2 });
  });
});

describe('evaluateCampaign — the rule engine (EN-03)', () => {
  const visitor: VisitorContext = {
    ...visitorPagesOf(['https://casino.test/home', 'https://casino.test/Deposit?step=1']),
    referrer: 'https://www.google.com/search',
    country: 'TR',
    visitorType: 'returning',
    variables: { tier: 'Gold', balance: '250.5', logged_in: 'true' },
  };
  const holds = (rule: CampaignRule, who: VisitorContext = visitor) => serverRuleHolds(rule, who);
  const unknown: VisitorContext = visitorPagesOf([]);

  it('current_url: every text operator, case-insensitive, current page only (FR-MOD-03.3.2)', () => {
    expect(holds({ field: 'current_url', op: 'contains', value: '/deposit' })).toBe(true);
    expect(holds({ field: 'current_url', op: 'contains', value: '/home' })).toBe(false);
    expect(holds({ field: 'current_url', op: 'not_contains', value: '/home' })).toBe(true);
    expect(holds({ field: 'current_url', op: 'not_contains', value: 'deposit' })).toBe(false);
    expect(
      holds({ field: 'current_url', op: 'equals', value: 'https://casino.test/deposit?step=1' }),
    ).toBe(true);
    expect(holds({ field: 'current_url', op: 'equals', value: 'https://casino.test/' })).toBe(
      false,
    );
    expect(holds({ field: 'current_url', op: 'not_equals', value: 'https://casino.test/' })).toBe(
      true,
    );
  });

  it('session_url: a positive operator wants one page, a negative one wants none (FR-MOD-03.3.2)', () => {
    expect(holds({ field: 'session_url', op: 'contains', value: '/home' })).toBe(true);
    expect(holds({ field: 'session_url', op: 'not_contains', value: '/home' })).toBe(false);
    expect(holds({ field: 'session_url', op: 'not_contains', value: '/withdraw' })).toBe(true);
    expect(holds({ field: 'session_url', op: 'equals', value: 'https://casino.test/home' })).toBe(
      true,
    );
    expect(
      holds({ field: 'session_url', op: 'not_equals', value: 'https://casino.test/home' }),
    ).toBe(false);
    expect(holds({ field: 'session_url', op: 'contains', value: '/home' }, unknown)).toBe(false);
    expect(holds({ field: 'session_url', op: 'not_contains', value: '/home' }, unknown)).toBe(true);
  });

  it('referrer, country, visitor_type: known values compare, unknown ones fail positives only', () => {
    expect(holds({ field: 'referrer', op: 'contains', value: 'google' })).toBe(true);
    expect(holds({ field: 'referrer', op: 'not_contains', value: 'google' })).toBe(false);
    expect(holds({ field: 'referrer', op: 'contains', value: 'google' }, unknown)).toBe(false);
    expect(holds({ field: 'referrer', op: 'not_contains', value: 'google' }, unknown)).toBe(true);
    expect(holds({ field: 'country', op: 'equals', value: 'tr' })).toBe(true);
    expect(holds({ field: 'country', op: 'not_equals', value: 'TR' })).toBe(false);
    expect(holds({ field: 'country', op: 'equals', value: 'TR' }, unknown)).toBe(false);
    expect(holds({ field: 'country', op: 'not_equals', value: 'TR' }, unknown)).toBe(true);
    expect(holds({ field: 'visitor_type', op: 'equals', value: 'returning' })).toBe(true);
    expect(holds({ field: 'visitor_type', op: 'equals', value: 'new' })).toBe(false);
    expect(holds({ field: 'visitor_type', op: 'not_equals', value: 'new' })).toBe(true);
  });

  it('custom_var: every operator; numbers compare as numbers, text ignores case', () => {
    const variable = (op: CampaignRule['op'], value: string | number, key = 'balance') =>
      holds({ field: 'custom_var', op, value, key });
    expect(variable('gt', 250)).toBe(true);
    expect(variable('gt', 250.5)).toBe(false);
    expect(variable('gte', '250.5')).toBe(true);
    expect(variable('lt', 251)).toBe(true);
    expect(variable('lt', 250.5)).toBe(false);
    expect(variable('lte', 250.5)).toBe(true);
    expect(variable('equals', '250.50')).toBe(true);
    expect(variable('not_equals', 250.5)).toBe(false);
    expect(variable('equals', 'gold', 'tier')).toBe(true);
    expect(variable('not_equals', 'GOLD', 'tier')).toBe(false);
    expect(variable('contains', 'ol', 'tier')).toBe(true);
    expect(variable('not_contains', 'ol', 'tier')).toBe(false);
    // A text variable never satisfies a number comparison.
    expect(variable('gt', 1, 'tier')).toBe(false);
    // A variable the site never set: positives fail, negatives hold.
    expect(variable('equals', 'x', 'missing')).toBe(false);
    expect(variable('gte', 0, 'missing')).toBe(false);
    expect(variable('not_equals', 'x', 'missing')).toBe(true);
    expect(variable('not_contains', 'x', 'missing')).toBe(true);
    // An inherited property is not a variable.
    expect(variable('equals', '[object Object]', '__proto__')).toBe(false);
  });

  const deposit: CampaignRule = { field: 'current_url', op: 'contains', value: '/deposit' };
  const turkey: CampaignRule = { field: 'country', op: 'equals', value: 'TR' };
  const thirty: CampaignRule = { field: 'time_on_page', op: 'gte', value: 30 };
  const leaving: CampaignRule = { field: 'exit_intent', op: 'equals', value: true };

  it('"TR AND /deposit AND 30 s": waits for the 30 s only when both server rules hold (FR-MOD-03.3.2)', () => {
    const conditions = { match: 'all', rules: [turkey, deposit, thirty] };
    expect(evaluateCampaign(conditions, visitor)).toEqual({
      kind: 'wait',
      showWhen: { match: 'all', rules: [thirty] },
    });
    expect(evaluateCampaign(conditions, { ...visitor, country: 'DE' })).toEqual({ kind: 'none' });
    expect(
      evaluateCampaign(conditions, { ...visitor, ...visitorPagesOf(['https://casino.test/']) }),
    ).toEqual({ kind: 'none' });
  });

  it('"any": one server rule is enough to show now; none holding waits for any browser rule (FR-MOD-03.3.2)', () => {
    const conditions = { match: 'any', rules: [turkey, deposit, thirty, leaving] };
    expect(evaluateCampaign(conditions, { ...visitor, country: 'DE' })).toEqual({ kind: 'match' });
    expect(evaluateCampaign(conditions, unknown)).toEqual({
      kind: 'wait',
      showWhen: { match: 'any', rules: [thirty, leaving] },
    });
    expect(evaluateCampaign({ match: 'any', rules: [turkey, deposit] }, unknown)).toEqual({
      kind: 'none',
    });
  });

  it('server rules alone match now; browser rules alone always wait', () => {
    expect(evaluateCampaign({ match: 'all', rules: [turkey, deposit] }, visitor)).toEqual({
      kind: 'match',
    });
    expect(evaluateCampaign({ rules: [leaving] }, unknown)).toEqual({
      kind: 'wait',
      showWhen: { match: 'all', rules: [leaving] },
    });
  });

  it('matches nobody with no rules, or with a rule it cannot read', () => {
    expect(evaluateCampaign({ match: 'any', rules: [] }, visitor)).toEqual({ kind: 'none' });
    expect(
      evaluateCampaign(
        { rules: [deposit, { field: 'country', op: 'contains', value: 'TR' }] },
        visitor,
      ),
    ).toEqual({ kind: 'none' });
    expect(
      evaluateCampaign({ rules: [deposit, { field: 'weather', op: 'equals' }] }, visitor),
    ).toEqual({ kind: 'none' });
    expect(hasTrigger({ rules: [{ field: 'country', op: 'equals', value: 'TUR' }] })).toBe(false);
    expect(hasTrigger({ rules: [turkey] })).toBe(true);
  });

  it('reads an old campaign exactly as before the rules existed (EN-04 regression)', () => {
    expect(evaluateCampaign({ url_contains: '/Deposit' }, visitor)).toEqual({ kind: 'match' });
    expect(evaluateCampaign({ url_contains: '/home' }, visitor)).toEqual({ kind: 'none' });
  });

  it('knows which campaigns need more than the pages, and which wait for the browser', () => {
    expect(needsVisitorDetails({ url_contains: '/x' })).toBe(false);
    expect(needsVisitorDetails({ rules: [deposit, thirty] })).toBe(false);
    expect(needsVisitorDetails({ rules: [deposit, turkey] })).toBe(true);
    expect(hasBrowserRules({ rules: [deposit, turkey] })).toBe(false);
    expect(hasBrowserRules({ rules: [deposit, leaving] })).toBe(true);
  });
});

describe('storedConditions (EN-03)', () => {
  it('stores rules, trimmed, the country upper-cased, and mirrors url_contains only for the first shape', () => {
    expect(storedConditions({ url_contains: ' /x ' })).toEqual({
      match: 'all',
      rules: [{ field: 'current_url', op: 'contains', value: '/x' }],
      url_contains: '/x',
    });
    expect(
      storedConditions({
        match: 'any',
        rules: [
          { field: 'country', op: 'equals', value: ' tr ' },
          { field: 'custom_var', op: 'equals', value: ' gold ', key: ' tier ' },
        ],
      }),
    ).toEqual({
      match: 'any',
      rules: [
        { field: 'country', op: 'equals', value: 'TR' },
        { field: 'custom_var', op: 'equals', value: 'gold', key: 'tier' },
      ],
    });
  });
});
