import { describe, expect, it } from 'vitest';
import {
  chatInactivityOrderProblem,
  UNANSWERED_ALERT_REASONS,
  UNRESPONSIVE_TRANSFER_LIMIT,
  type ChatInactivityWindows,
} from './chat-inactivity.js';
import { RTM_PUSH_ACTIONS } from './rtm.js';

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

describe('the inactivity sweep vocabulary (WG-03 · tm 340.2)', () => {
  it('is pushed on actions the gateway knows', () => {
    expect(RTM_PUSH_ACTIONS).toContain('chat_unanswered_alert');
    expect(RTM_PUSH_ACTIONS).toContain('chat_inactivity_changed');
  });

  it('passes a connection on twice before it waits for the lead', () => {
    expect(UNRESPONSIVE_TRANSFER_LIMIT).toBe(2);
    expect(UNANSWERED_ALERT_REASONS).toEqual(['no_agent', 'transfer_limit', 'unclaimed']);
  });
});

describe('chatInactivityOrderProblem with the e-mail request window (WG-08)', () => {
  const withAsk = (
    ask: number | null,
    ...rest: [number | null, number | null, number | null]
  ): ChatInactivityWindows => ({ ...windows(...rest), askEmailSeconds: ask });

  it('accepts ask < transfer < inactive < auto-close, and any of them off', () => {
    expect(chatInactivityOrderProblem(withAsk(120, 180, 600, 1800))).toBeNull();
    expect(chatInactivityOrderProblem(withAsk(120, null, null, null))).toBeNull();
    expect(chatInactivityOrderProblem(withAsk(null, 180, 600, 1800))).toBeNull();
    // A caller that does not know the window leaves it out: off.
    expect(chatInactivityOrderProblem(windows(180, 600, 1800))).toBeNull();
  });

  it('refuses a request window at or past the transfer, inactive or auto-close one', () => {
    expect(chatInactivityOrderProblem(withAsk(180, 180, 600, 1800))).toBe(
      'ask_email_not_before_transfer',
    );
    expect(chatInactivityOrderProblem(withAsk(600, null, 600, 1800))).toBe(
      'ask_email_not_before_inactive',
    );
    expect(chatInactivityOrderProblem(withAsk(1800, null, null, 1800))).toBe(
      'ask_email_not_before_timeout',
    );
  });
});
