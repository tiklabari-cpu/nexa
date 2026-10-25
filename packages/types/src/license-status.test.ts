import { describe, expect, it } from 'vitest';
import { isLicenseClosed, LICENSE_CLOSED_STATUSES, SUBSCRIPTION_STATUSES } from './domain.js';

describe('isLicenseClosed (tm 389.2)', () => {
  it('closes exactly canceled and suspended', () => {
    expect(SUBSCRIPTION_STATUSES.filter((status) => isLicenseClosed(status))).toEqual([
      'canceled',
      'suspended',
    ]);
  });

  it('names only statuses the licence can hold', () => {
    for (const status of LICENSE_CLOSED_STATUSES) expect(SUBSCRIPTION_STATUSES).toContain(status);
  });

  it('leaves the open states — read_only included — open', () => {
    for (const status of ['trialing', 'active', 'past_due', 'read_only', '', 'Canceled']) {
      expect(isLicenseClosed(status)).toBe(false);
    }
  });
});
