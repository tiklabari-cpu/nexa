/**
 * The single knowledge list's scope rules (tm 309.3 · AI-14): what a row says
 * about who uses it, when a review is late, how the controls above the list
 * narrow it, and which scope fields a create / edit request carries.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPE_CONTROLS,
  applyScopeControls,
  audienceKindOf,
  countNeedingReview,
  hasActiveScopeControls,
  hasEnded,
  isValidReviewInterval,
  needsReview,
  scopeCreateBody,
  scopePatchOf,
  scopeValueOf,
  validUntilOf,
} from './knowledge-scope.js';
import type { KnowledgeSource } from './types.js';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function source(over: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 's1',
    ai_agent_id: 'a1',
    name: 'Refunds',
    type: 'article',
    status: 'ready',
    source_url: null,
    chunk_count: 3,
    updated_at: '2026-05-01T00:00:00.000Z',
    added_by_name: null,
    refresh_after_days: null,
    next_refresh_at: null,
    last_refresh_error: null,
    ...over,
  };
}

describe('audienceKindOf', () => {
  it('reads the three sets the store keeps, and a row that names none as both', () => {
    expect(audienceKindOf(source({ audiences: ['ai_agent', 'copilot'] }))).toBe('both');
    expect(audienceKindOf(source({ audiences: ['ai_agent'] }))).toBe('ai_agent');
    expect(audienceKindOf(source({ audiences: ['copilot'] }))).toBe('agents_only');
    expect(audienceKindOf(source())).toBe('both');
    expect(audienceKindOf(source({ audiences: [] }))).toBe('both');
  });
});

describe('needsReview / hasEnded (AI-14-S3)', () => {
  it('uses the server’s review_due_at as sent', () => {
    expect(needsReview({ review_due_at: '2026-05-31T00:00:00.000Z' }, NOW)).toBe(true);
    expect(needsReview({ review_due_at: '2026-06-02T00:00:00.000Z' }, NOW)).toBe(false);
  });

  it('works the due moment out from reviewed_at + interval when only those are sent', () => {
    // 90 days from 2026-01-01 is 2026-04-01 — long past by NOW.
    expect(needsReview({ reviewed_at: '2026-01-01T00:00:00.000Z' }, NOW)).toBe(true);
    expect(
      needsReview({ reviewed_at: '2026-05-20T00:00:00.000Z', review_interval_days: 30 }, NOW),
    ).toBe(false);
  });

  it('has nothing to be late on without either, and ends a source only at valid_until', () => {
    expect(needsReview({}, NOW)).toBe(false);
    expect(hasEnded({ valid_until: null }, NOW)).toBe(false);
    expect(hasEnded({}, NOW)).toBe(false);
    expect(hasEnded({ valid_until: '2026-05-31T00:00:00.000Z' }, NOW)).toBe(true);
    expect(hasEnded({ valid_until: '2026-06-30T00:00:00.000Z' }, NOW)).toBe(false);
  });

  it('counts the late sources for the filter label', () => {
    const late = { review_due_at: '2026-01-01T00:00:00.000Z' };
    const fresh = { review_due_at: '2027-01-01T00:00:00.000Z' };
    expect(countNeedingReview([late, fresh, late], NOW)).toBe(2);
  });
});

describe('applyScopeControls', () => {
  const both = source({ id: 'both', audiences: ['ai_agent', 'copilot'] });
  const agentsOnly = source({ id: 'agents', audiences: ['copilot'], owner_id: 'u1' });
  const brandA = source({ id: 'brand-a', brand_ids: ['A'], owner_id: 'u2' });
  const late = source({ id: 'late', review_due_at: '2026-01-01T00:00:00.000Z' });
  const all = [both, agentsOnly, brandA, late];
  const ids = (list: KnowledgeSource[]) => list.map((item) => item.id);

  it('changes nothing with no control set', () => {
    expect(hasActiveScopeControls(DEFAULT_SCOPE_CONTROLS)).toBe(false);
    expect(applyScopeControls(all, DEFAULT_SCOPE_CONTROLS, NOW)).toEqual(all);
  });

  it('narrows by who uses the source', () => {
    const result = applyScopeControls(
      all,
      { ...DEFAULT_SCOPE_CONTROLS, audience: 'agents_only' },
      NOW,
    );
    expect(ids(result)).toEqual(['agents']);
  });

  it('keeps a picked brand’s sources and the every-brand ones — what that brand’s chats read', () => {
    const result = applyScopeControls(all, { ...DEFAULT_SCOPE_CONTROLS, brand: 'A' }, NOW);
    expect(ids(result)).toEqual(['both', 'agents', 'brand-a', 'late']);
    const other = applyScopeControls(all, { ...DEFAULT_SCOPE_CONTROLS, brand: 'B' }, NOW);
    expect(ids(other)).toEqual(['both', 'agents', 'late']);
  });

  it('lists only the every-brand sources on request', () => {
    const result = applyScopeControls(all, { ...DEFAULT_SCOPE_CONTROLS, brand: 'every' }, NOW);
    expect(ids(result)).toEqual(['both', 'agents', 'late']);
  });

  it('narrows by owner, unowned included', () => {
    expect(ids(applyScopeControls(all, { ...DEFAULT_SCOPE_CONTROLS, owner: 'u2' }, NOW))).toEqual([
      'brand-a',
    ]);
    expect(ids(applyScopeControls(all, { ...DEFAULT_SCOPE_CONTROLS, owner: 'none' }, NOW))).toEqual(
      ['both', 'late'],
    );
  });

  it('lists the sources due a review, and composes with the rest', () => {
    const controls = { ...DEFAULT_SCOPE_CONTROLS, needsReview: true };
    expect(hasActiveScopeControls(controls)).toBe(true);
    expect(ids(applyScopeControls(all, controls, NOW))).toEqual(['late']);
    expect(ids(applyScopeControls(all, { ...controls, owner: 'u1' }, NOW))).toEqual([]);
  });
});

describe('the scope a form holds', () => {
  it('starts a new source at what the server would pick anyway, so a quiet form sends nothing', () => {
    const value = scopeValueOf();
    expect(value).toEqual({
      audiences: ['ai_agent', 'copilot'],
      brandIds: [],
      validUntil: '',
      ownerId: '',
      language: '',
      reviewIntervalDays: '90',
    });
    expect(scopeCreateBody(value)).toEqual({});
  });

  it('sends only what differs from those defaults on create', () => {
    const body = scopeCreateBody({
      audiences: ['copilot'],
      brandIds: ['A'],
      validUntil: '2026-12-31',
      ownerId: 'u1',
      language: ' tr ',
      reviewIntervalDays: '30',
    });
    expect(body).toMatchObject({
      audiences: ['copilot'],
      brand_ids: ['A'],
      owner_id: 'u1',
      language: 'tr',
      review_interval_days: 30,
    });
    expect(typeof body['valid_until']).toBe('string');
  });

  it('ends a source at the close of the chosen local day, so "until the 31st" still answers on the 31st', () => {
    const end = new Date(validUntilOf('2026-12-31') as string);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
    expect(end.getHours()).toBe(23);
    expect(validUntilOf('')).toBeNull();
    expect(validUntilOf('not a date')).toBeNull();
  });

  it('round-trips a stored end date back into the date input', () => {
    const stored = source({ valid_until: new Date(2026, 11, 31, 23, 59, 59).toISOString() });
    expect(scopeValueOf(stored).validUntil).toBe('2026-12-31');
  });

  it('patches only the fields that changed — an empty patch is a 400', () => {
    const stored = source({
      audiences: ['ai_agent', 'copilot'],
      brand_ids: ['A'],
      owner_id: 'u1',
      review_interval_days: 90,
    });
    expect(scopePatchOf(stored, scopeValueOf(stored), { scope: true })).toEqual({});

    const edited = {
      ...scopeValueOf(stored),
      audiences: ['copilot' as const],
      brandIds: [],
      ownerId: '',
      reviewIntervalDays: '30',
    };
    expect(scopePatchOf(stored, edited, { scope: true })).toEqual({
      audiences: ['copilot'],
      brand_ids: [],
      owner_id: null,
      review_interval_days: 30,
    });
  });

  it('leaves the reach fields out for a Knowledge Base article’s source — they are the article’s', () => {
    const stored = source({ kb_article_id: 'kb-1', audiences: ['ai_agent', 'copilot'] });
    const edited = { ...scopeValueOf(stored), audiences: ['copilot' as const], ownerId: 'u9' };
    expect(scopePatchOf(stored, edited, { scope: false })).toEqual({ owner_id: 'u9' });
  });

  it('accepts a review interval of 1 to 365 whole days and nothing else', () => {
    for (const ok of ['1', '90', '365']) expect(isValidReviewInterval(ok)).toBe(true);
    for (const bad of ['', '0', '366', '1.5', '-3', 'abc']) {
      expect(isValidReviewInterval(bad)).toBe(false);
    }
  });
});
