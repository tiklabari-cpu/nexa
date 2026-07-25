import { describe, expect, it } from 'vitest';
import { shouldEmailAssignee } from './assignee-email.js';

describe('shouldEmailAssignee', () => {
  it('e-mails a human assignee who has the channel on and an address', () => {
    expect(shouldEmailAssignee({ email: 'agent@example.test', emailEnabled: true })).toBe(true);
  });

  it('does not e-mail when there is no human assignee (queued / AI-only chat)', () => {
    // The route passes null when the active thread has no assignee — nobody to
    // write to.
    expect(shouldEmailAssignee(null)).toBe(false);
  });

  it('does not e-mail when the agent has turned the channel off (FR-MOD-08.2)', () => {
    // The negative the whole preference exists for.
    expect(shouldEmailAssignee({ email: 'agent@example.test', emailEnabled: false })).toBe(false);
  });

  it('does not e-mail an assignee with no deliverable address', () => {
    expect(shouldEmailAssignee({ email: null, emailEnabled: true })).toBe(false);
    expect(shouldEmailAssignee({ email: '', emailEnabled: true })).toBe(false);
  });

  it('narrows email to a string on a positive decision', () => {
    // The type guard lets the caller send without a non-null assertion; this
    // pins the runtime side of that promise.
    const channel = { email: 'agent@example.test', emailEnabled: true };
    if (shouldEmailAssignee(channel)) {
      expect(channel.email.length).toBeGreaterThan(0);
    } else {
      throw new Error('expected a positive decision');
    }
  });
});
