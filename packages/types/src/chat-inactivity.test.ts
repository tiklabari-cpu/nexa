import { describe, expect, it } from 'vitest';
import { chatInactivityOrderProblem, type ChatInactivityWindows } from './chat-inactivity.js';

const windows = (
  unansweredTransferSeconds: number | null,
  inactiveAfterSeconds: number | null,
  chatTimeoutSeconds: number | null,
): ChatInactivityWindows => ({
  unansweredTransferSeconds,
  inactiveAfterSeconds,
  chatTimeoutSeconds,
});

describe('chatInactivityOrderProblem (WG-03)', () => {
  it('accepts transfer < inactive < auto-close, and any of them off', () => {
    expect(chatInactivityOrderProblem(windows(180, 600, 1800))).toBeNull();
    expect(chatInactivityOrderProblem(windows(null, null, null))).toBeNull();
    expect(chatInactivityOrderProblem(windows(180, null, null))).toBeNull();
    expect(chatInactivityOrderProblem(windows(null, 600, null))).toBeNull();
    expect(chatInactivityOrderProblem(windows(180, null, 1800))).toBeNull();
    expect(chatInactivityOrderProblem(windows(null, 600, 1800))).toBeNull();
  });

  it('refuses a transfer window at or past the inactive one', () => {
    expect(chatInactivityOrderProblem(windows(600, 600, null))).toBe(
      'transfer_not_before_inactive',
    );
    expect(chatInactivityOrderProblem(windows(900, 600, 1800))).toBe(
      'transfer_not_before_inactive',
    );
  });

  it('refuses a transfer window at or past the auto-close one, inactive off', () => {
    expect(chatInactivityOrderProblem(windows(1800, null, 1800))).toBe(
      'transfer_not_before_timeout',
    );
  });

  it('refuses an inactive window at or past the auto-close one', () => {
    expect(chatInactivityOrderProblem(windows(null, 1800, 1800))).toBe(
      'inactive_not_before_timeout',
    );
    expect(chatInactivityOrderProblem(windows(180, 3600, 1800))).toBe(
      'inactive_not_before_timeout',
    );
  });
});
