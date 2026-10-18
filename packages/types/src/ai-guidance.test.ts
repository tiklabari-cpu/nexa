import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_QUESTIONS_PER_MESSAGE,
  maxQuestionsOf,
  NO_PERSONA_STYLE,
  readGuidanceScope,
  readPersonaStyle,
} from './index.js';

describe('readPersonaStyle (tm 299.1 · AI-07)', () => {
  it('reads the three settings from the persona JSON', () => {
    expect(
      readPersonaStyle({ addressForm: 'siz', emoji: 'none', maxQuestionsPerMessage: 1, tone: 'x' }),
    ).toEqual({ addressForm: 'siz', emoji: 'none', maxQuestionsPerMessage: 1 });
  });

  it('anything outside the closed sets reads as unset', () => {
    expect(
      readPersonaStyle({ addressForm: 'Siz', emoji: 'lots', maxQuestionsPerMessage: 4 }),
    ).toEqual(NO_PERSONA_STYLE);
    expect(readPersonaStyle({ maxQuestionsPerMessage: 1.5 }).maxQuestionsPerMessage).toBeNull();
    expect(readPersonaStyle(null)).toEqual(NO_PERSONA_STYLE);
    expect(readPersonaStyle([])).toEqual(NO_PERSONA_STYLE);
  });

  it('an unset question count is the default, 2', () => {
    expect(maxQuestionsOf(readPersonaStyle({}))).toBe(DEFAULT_MAX_QUESTIONS_PER_MESSAGE);
    expect(maxQuestionsOf(undefined)).toBe(2);
    expect(maxQuestionsOf(readPersonaStyle({ maxQuestionsPerMessage: 3 }))).toBe(3);
  });
});

describe('readGuidanceScope', () => {
  it('reads one of the three shapes', () => {
    expect(readGuidanceScope({ all: true })).toEqual({ all: true });
    expect(readGuidanceScope({ skill_ids: ['a'] })).toEqual({ skill_ids: ['a'] });
    expect(readGuidanceScope({ brand_ids: ['b'] })).toEqual({ brand_ids: ['b'] });
  });

  it('anything else applies nowhere', () => {
    expect(readGuidanceScope({ all: false })).toBeNull();
    expect(readGuidanceScope({ skill_ids: [] })).toBeNull();
    expect(readGuidanceScope({ skill_ids: ['a'], brand_ids: ['b'] })).toBeNull();
    expect(readGuidanceScope({ skill_ids: [1] })).toBeNull();
    expect(readGuidanceScope('all')).toBeNull();
    expect(readGuidanceScope(null)).toBeNull();
  });
});
