import { describe, expect, it } from 'vitest';
import { ACTIVITY } from './TrafficPage.js';
import type { TrafficActivity } from './types.js';

const ALL_ACTIVITIES: TrafficActivity[] = [
  'browsing',
  'queued',
  'waiting',
  'chatting',
  'supervised',
  'invited',
];

describe('ACTIVITY', () => {
  it.each(ALL_ACTIVITIES)('gives %s a tone and a label', (activity) => {
    expect(ACTIVITY[activity].tone).toBeTruthy();
    expect(ACTIVITY[activity].label).toBeTruthy();
  });
});
