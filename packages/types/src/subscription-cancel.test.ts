import { describe, expect, it } from 'vitest';
import {
  CANCEL_EXPORT_DAYS,
  cancellationDeletionAt,
  cancellationExportUntil,
  cancellationTakesEffectAt,
  isCancelReason,
} from './subscription-cancel.js';

const DAY = 86_400_000;
const ENDED = new Date('2026-12-01T00:00:00Z');

describe('subscription cancellation dates (tm 384 · BL-03)', () => {
  it('takes effect at the end of the paid term when one is on file', () => {
    const end = new Date('2026-12-15T10:00:00Z');
    expect(cancellationTakesEffectAt(end, new Date('2026-11-20T08:00:00Z'))).toEqual(end);
  });

  it('takes effect at the end of the UTC month without a term', () => {
    expect(cancellationTakesEffectAt(null, new Date('2026-11-20T08:00:00Z'))).toEqual(
      new Date('2026-12-01T00:00:00Z'),
    );
    expect(cancellationTakesEffectAt(null, new Date('2026-12-31T23:59:00Z'))).toEqual(
      new Date('2027-01-01T00:00:00Z'),
    );
  });

  it('keeps the workspace exportable for thirty days after the period ends', () => {
    expect(CANCEL_EXPORT_DAYS).toBe(30);
    expect(cancellationExportUntil(ENDED).getTime() - ENDED.getTime()).toBe(30 * DAY);
  });

  it('deletes after the export window unless a longer retention was chosen', () => {
    const at = (window: string | null) => cancellationDeletionAt(ENDED, window);
    expect(at(null)!.getTime() - ENDED.getTime()).toBe(30 * DAY);
    expect(at('30d')!.getTime() - ENDED.getTime()).toBe(30 * DAY);
    expect(at('60d')!.getTime() - ENDED.getTime()).toBe(60 * DAY);
    expect(at('365d')!.getTime() - ENDED.getTime()).toBe(365 * DAY);
    expect(at('unlimited')).toBeNull();
    // A tier this build does not know is no choice, not "keep for ever".
    expect(at('730d')!.getTime() - ENDED.getTime()).toBe(30 * DAY);
  });

  it('knows its reasons and nothing else', () => {
    expect(isCancelReason('too_expensive')).toBe(true);
    expect(isCancelReason('other')).toBe(true);
    expect(isCancelReason('because')).toBe(false);
    expect(isCancelReason(null)).toBe(false);
  });
});
