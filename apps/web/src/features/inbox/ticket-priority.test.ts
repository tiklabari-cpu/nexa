/**
 * The priority scale (FR-MOD-13.6): an arbitrary stored integer must always snap
 * to one of the four named levels, and a value exactly between two levels resolves
 * to the more urgent one so nothing quietly loses attention.
 */
import { describe, expect, it } from 'vitest';
import { TICKET_PRIORITIES, hasElevatedPriority, nearestPriority } from './ticket-priority.js';

describe('nearestPriority', () => {
  it('maps the exact level values to their own level', () => {
    expect(nearestPriority(100).label).toBe('Urgent');
    expect(nearestPriority(50).label).toBe('High');
    expect(nearestPriority(0).label).toBe('Normal');
    expect(nearestPriority(-50).label).toBe('Low');
  });

  it('snaps an in-between value to the closest level', () => {
    expect(nearestPriority(80).label).toBe('Urgent'); // 20 from Urgent, 30 from High
    expect(nearestPriority(-40).label).toBe('Low'); // 10 from Low, 40 from Normal
  });

  it('breaks a tie toward the more urgent level', () => {
    // 25 is equidistant from Normal (0) and High (50); High wins.
    expect(nearestPriority(25).label).toBe('High');
    // -25 is equidistant from Normal (0) and Low (-50); Normal wins.
    expect(nearestPriority(-25).label).toBe('Normal');
  });

  it('clamps values past the ends to the nearest extreme level', () => {
    expect(nearestPriority(1000).label).toBe('Urgent');
    expect(nearestPriority(-1000).label).toBe('Low');
  });
});

describe('hasElevatedPriority', () => {
  it('is false only for the default', () => {
    expect(hasElevatedPriority(0)).toBe(false);
    expect(hasElevatedPriority(50)).toBe(true);
    expect(hasElevatedPriority(-50)).toBe(true);
  });
});

describe('TICKET_PRIORITIES', () => {
  it('is ordered most urgent first', () => {
    const values = TICKET_PRIORITIES.map((level) => level.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});
