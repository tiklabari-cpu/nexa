import { describe, expect, it } from 'vitest';
import { readPendingChecks, withPendingChecks } from './pending-checks.js';

describe('pending checks in the conversation signals (AI-28 · tm 321)', () => {
  const deposit = { tool: 'deposit_lookup', step_id: 'sorgu', inputs: { user_id: 'kullanici' } };

  it('adds a check once per tool and step, keeping the other signals', () => {
    const signals = { repeat_same_day: true };
    const once = withPendingChecks(signals, [deposit]);
    expect(once).toEqual({ repeat_same_day: true, pending_checks: [deposit] });
    const again = withPendingChecks(once, [
      { ...deposit, inputs: { user_id: 'uye_no' } },
      { tool: 'kyc_status', step_id: 'kyc', inputs: {} },
    ]);
    expect(again['pending_checks']).toEqual([
      { ...deposit, inputs: { user_id: 'uye_no' } },
      { tool: 'kyc_status', step_id: 'kyc', inputs: {} },
    ]);
  });

  it('returns the very same signals when the turn left nothing to check', () => {
    const signals = { pending_checks: [deposit] };
    expect(withPendingChecks(signals, [])).toBe(signals);
  });

  it('reads an older bare key, and drops what is not a check', () => {
    expect(
      readPendingChecks({
        pending_checks: [
          'kyc_status',
          { tool: 'deposit_lookup', inputs: { user_id: 'kullanici', amount: 7 } },
          { step_id: 'x' },
          null,
          [],
        ],
      }),
    ).toEqual([
      { tool: 'kyc_status', step_id: '', inputs: {} },
      { tool: 'deposit_lookup', step_id: '', inputs: { user_id: 'kullanici' } },
    ]);
    expect(readPendingChecks({ pending_checks: 'deposit_lookup' })).toEqual([]);
    expect(readPendingChecks({})).toEqual([]);
  });
});
