import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_ASSIGNMENT_MODE,
  GROUP_ASSIGNMENT_MODES,
  QUEUE_TOPIC_ROLES,
  RESPONSIBLE_GAMBLING_ROLE,
  assignmentModeAllowed,
} from './team-queues.js';

describe('team assignment modes (WG-07 · tm 346)', () => {
  it('is automatic or manual, automatic by default', () => {
    expect(GROUP_ASSIGNMENT_MODES).toEqual(['auto', 'manual']);
    expect(DEFAULT_GROUP_ASSIGNMENT_MODE).toBe('auto');
  });

  it('never lets the Responsible Gambling team be manual, and lets every other team', () => {
    expect(assignmentModeAllowed(RESPONSIBLE_GAMBLING_ROLE, 'manual')).toBe(false);
    expect(assignmentModeAllowed(RESPONSIBLE_GAMBLING_ROLE, 'auto')).toBe(true);
    for (const role of QUEUE_TOPIC_ROLES.filter((r) => r !== RESPONSIBLE_GAMBLING_ROLE)) {
      expect(assignmentModeAllowed(role, 'manual')).toBe(true);
    }
    expect(assignmentModeAllowed(null, 'manual')).toBe(true);
  });
});
