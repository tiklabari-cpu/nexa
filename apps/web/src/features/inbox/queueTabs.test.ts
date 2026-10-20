/**
 * The Queued view's team tabs, order (tm 305.4 · AU-01): topic queues first in
 * their fixed order — whatever the teams are called — then the other teams as
 * the server listed them.
 */
import { describe, expect, it } from 'vitest';
import { orderQueueTeams } from './queueTabs.js';

describe('orderQueueTeams', () => {
  it('puts the topic queues first, in QUEUE_TOPIC_ROLES order, then the rest as listed (FR-MOD-08.6.1)', () => {
    const ordered = orderQueueTeams([
      { id: 1, name: 'General', topic_role: null },
      { id: 2, name: 'Complaints desk', topic_role: 'complaint' },
      { id: 3, name: 'Sales', topic_role: null },
      { id: 4, name: 'Money', topic_role: 'finance' },
      { id: 5, name: 'Sorumlu Oyun', topic_role: 'responsible_gambling' },
    ]);
    expect(ordered.map((team) => team.id)).toEqual([4, 5, 2, 1, 3]);
  });

  it('leaves an empty roster empty', () => {
    expect(orderQueueTeams([])).toEqual([]);
  });
});
