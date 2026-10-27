import { describe, expect, it } from 'vitest';
import {
  AI_QA_RUBRIC,
  CRISIS_DRAFT_COUNTRIES_MAX,
  PLATFORM_CRISIS_TEXT_MAX,
  TIMEZONE_COUNTRIES,
  countryOfTimezone,
  crisisDraftLangOf,
  isCrisisTextDrafts,
  pickCrisisTextDraft,
} from './ai-catalogs.js';
import { AI_TEST_JUDGE_CRITERIA } from './ai-testing.js';

describe('crisis text drafts', () => {
  const drafts = {
    TR: { en: 'Call 183.', tr: '183 numaralı hattı arayın.' },
    GB: { en: 'Call 0808.' },
  };

  it('accepts the stored shape and refuses anything else', () => {
    expect(isCrisisTextDrafts({})).toBe(true);
    expect(isCrisisTextDrafts(drafts)).toBe(true);
    expect(isCrisisTextDrafts(null)).toBe(false);
    expect(isCrisisTextDrafts([])).toBe(false);
    expect(isCrisisTextDrafts({ tr: { en: 'x' } })).toBe(false); // country must be upper case
    expect(isCrisisTextDrafts({ TUR: { en: 'x' } })).toBe(false);
    expect(isCrisisTextDrafts({ TR: { de: 'x' } })).toBe(false);
    expect(isCrisisTextDrafts({ TR: { en: '' } })).toBe(false);
    expect(isCrisisTextDrafts({ TR: { en: 'x'.repeat(PLATFORM_CRISIS_TEXT_MAX + 1) } })).toBe(
      false,
    );
    expect(isCrisisTextDrafts({ TR: { en: 'x'.repeat(PLATFORM_CRISIS_TEXT_MAX) } })).toBe(true);
    expect(isCrisisTextDrafts({ TR: 'x' })).toBe(false);
  });

  it('bounds the number of countries', () => {
    const many = Object.fromEntries(
      Array.from({ length: CRISIS_DRAFT_COUNTRIES_MAX + 1 }, (_, i) => [
        `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
        { en: 'x' },
      ]),
    );
    expect(isCrisisTextDrafts(many)).toBe(false);
  });

  it('picks the preferred language, then the other, then nothing', () => {
    expect(pickCrisisTextDraft(drafts, 'TR', 'tr')).toBe('183 numaralı hattı arayın.');
    expect(pickCrisisTextDraft(drafts, 'TR', 'en')).toBe('Call 183.');
    expect(pickCrisisTextDraft(drafts, 'GB', 'tr')).toBe('Call 0808.');
    expect(pickCrisisTextDraft(drafts, 'DE', 'en')).toBeNull();
    expect(pickCrisisTextDraft(drafts, null, 'en')).toBeNull();
    expect(pickCrisisTextDraft('garbage', 'TR', 'en')).toBeNull();
    expect(pickCrisisTextDraft(null, 'TR', 'en')).toBeNull();
  });

  it('reads Turkish from the first Accept-Language tag only', () => {
    expect(crisisDraftLangOf('tr')).toBe('tr');
    expect(crisisDraftLangOf('tr-TR,tr;q=0.9,en;q=0.8')).toBe('tr');
    expect(crisisDraftLangOf('en-US,tr;q=0.9')).toBe('en');
    expect(crisisDraftLangOf(undefined)).toBe('en');
    expect(crisisDraftLangOf('trx')).toBe('en');
  });
});

describe('countryOfTimezone', () => {
  it('maps the served zones and leaves the rest unknown', () => {
    expect(countryOfTimezone('Europe/Istanbul')).toBe('TR');
    expect(countryOfTimezone('Europe/London')).toBe('GB');
    expect(countryOfTimezone('UTC')).toBeNull();
    expect(countryOfTimezone('Mars/Olympus')).toBeNull();
    expect(countryOfTimezone(null)).toBeNull();
    expect(countryOfTimezone('')).toBeNull();
    // `__proto__` and friends are not zones.
    expect(countryOfTimezone('__proto__')).toBeNull();
    expect(countryOfTimezone('constructor')).toBeNull();
  });

  it('names only upper-case two-letter countries', () => {
    for (const country of Object.values(TIMEZONE_COUNTRIES)) expect(country).toMatch(/^[A-Z]{2}$/);
  });
});

describe('the QA rubric', () => {
  it('lists the judge criteria in the judge order', () => {
    expect(AI_QA_RUBRIC.map((criterion) => criterion.key)).toEqual([...AI_TEST_JUDGE_CRITERIA]);
  });

  it('marks only the two hand-over criteria as hand-over only', () => {
    expect(AI_QA_RUBRIC.filter((c) => c.handoff_only).map((c) => c.key)).toEqual([
      'handoff_timing',
      'handoff_summary',
    ]);
  });
});
