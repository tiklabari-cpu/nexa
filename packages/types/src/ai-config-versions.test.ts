import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_OPEN_VERSION_STATUSES,
  AI_CONFIG_VERSION_STATUSES,
  aiConfigVersionLabel,
} from './ai-config-versions.js';

describe('AI configuration versions (AI-20)', () => {
  it('names a version "v12" and a fast-path minor "v12.1"', () => {
    expect(aiConfigVersionLabel({ number: 1, minor: 0 })).toBe('v1');
    expect(aiConfigVersionLabel({ number: 12, minor: 0 })).toBe('v12');
    expect(aiConfigVersionLabel({ number: 12, minor: 1 })).toBe('v12.1');
  });

  it('the open statuses are the two awaiting publication', () => {
    expect(AI_CONFIG_OPEN_VERSION_STATUSES).toEqual(['in_review', 'approved']);
    for (const status of AI_CONFIG_OPEN_VERSION_STATUSES) {
      expect(AI_CONFIG_VERSION_STATUSES).toContain(status);
    }
  });
});
