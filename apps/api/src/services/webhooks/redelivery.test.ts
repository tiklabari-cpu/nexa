/**
 * The queue's decision layer (M-SCHED-e).
 *
 * `WebhookRedeliverer` itself is proven against real rows, real RLS and the
 * real CHECK constraints in `test/integration/webhook-redelivery.test.ts` —
 * nothing here stubs a database to assert something the database is the
 * authority on. What this file covers is the two pure functions the sweep and
 * the request burst *share*, because that sharing is the whole reason a
 * delivery cannot be both "given up on" and "still queued": if the two paths
 * ever computed a state differently, the disagreement would show up as a lost
 * or a duplicated webhook, not as a failing assertion anywhere else.
 */
import { describe, expect, it } from 'vitest';
import {
  deliveryState,
  redeliveryBackoffMs,
  writeableAttempt,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_REDELIVERY_BACKOFF_CAP_MS,
  WEBHOOK_REQUEST_ATTEMPTS,
} from './webhook-dispatcher.js';

const MAX = WEBHOOK_MAX_ATTEMPTS;

describe('deliveryState', () => {
  it('calls a successful attempt delivered, whichever attempt it was', () => {
    for (const attempt of [1, WEBHOOK_REQUEST_ATTEMPTS, MAX]) {
      expect(deliveryState({ ok: true, attempt, maxAttempts: MAX })).toBe('delivered');
      // Even the last attempt of a burst: success ends the delivery.
      expect(deliveryState({ ok: true, attempt, maxAttempts: MAX, moreInThisPass: true })).toBe(
        'delivered',
      );
    }
  });

  it('leaves a failure that the same pass will retry as history, not a queue entry', () => {
    // Attempts 1 and 2 of the request burst: the caller is about to try again
    // itself, so queueing them would put two entries in for one event.
    expect(deliveryState({ ok: false, attempt: 1, maxAttempts: MAX, moreInThisPass: true })).toBe(
      'failed',
    );
    expect(deliveryState({ ok: false, attempt: 2, maxAttempts: MAX, moreInThisPass: true })).toBe(
      'failed',
    );
  });

  it('queues the failure the pass is handing on', () => {
    // The last attempt of the request burst — the row the scheduler inherits.
    expect(deliveryState({ ok: false, attempt: WEBHOOK_REQUEST_ATTEMPTS, maxAttempts: MAX })).toBe(
      'pending',
    );
    // And every scheduled attempt short of the cap, which is always a pass of one.
    expect(deliveryState({ ok: false, attempt: MAX - 1, maxAttempts: MAX })).toBe('pending');
  });

  it('exhausts at the cap, and stays exhausted past it', () => {
    expect(deliveryState({ ok: false, attempt: MAX, maxAttempts: MAX })).toBe('exhausted');
    // A cap lowered under rows queued at the old one: they end, they do not
    // silently keep their old allowance.
    expect(deliveryState({ ok: false, attempt: MAX + 3, maxAttempts: MAX })).toBe('exhausted');
    expect(deliveryState({ ok: false, attempt: 4, maxAttempts: 2 })).toBe('exhausted');
  });

  it('exhausts rather than queues even when the pass has more attempts to give', () => {
    // A burst configured longer than the cap must not spend attempts the
    // deployment has said it will not honour.
    expect(deliveryState({ ok: false, attempt: 2, maxAttempts: 2, moreInThisPass: true })).toBe(
      'exhausted',
    );
  });
});

describe('redeliveryBackoffMs', () => {
  it('doubles, starting a minute-scale curve where the burst left off', () => {
    // The burst ends at attempt 3; four hours of curve from there to attempt 8.
    expect(redeliveryBackoffMs(3)).toBe(4 * 60_000);
    expect(redeliveryBackoffMs(4)).toBe(8 * 60_000);
    expect(redeliveryBackoffMs(5)).toBe(16 * 60_000);
    expect(redeliveryBackoffMs(6)).toBe(32 * 60_000);
    expect(redeliveryBackoffMs(7)).toBe(64 * 60_000);
  });

  it('never returns a wait that is zero, negative or unbounded', () => {
    // Attempt numbers come from a row, so the function is defensive about them.
    for (const attempt of [0, 1, 2, 50]) {
      const wait = redeliveryBackoffMs(attempt);
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(WEBHOOK_REDELIVERY_BACKOFF_CAP_MS);
    }
    expect(redeliveryBackoffMs(50)).toBe(WEBHOOK_REDELIVERY_BACKOFF_CAP_MS);
  });
});

describe('writeableAttempt', () => {
  const webhook = { id: 'e1e0e6b0-0000-4000-8000-000000000001', action: 'chat_started' };
  const base = {
    eventId: 'aaaaaaaa-0000-4000-8000-000000000001',
    attempt: 3,
    body: '{"action":"chat_started","data":{"chat_id":"X"}}',
    now: new Date('2026-08-18T12:00:00.000Z'),
  };

  it('carries the body and a due time only while another try is owed', () => {
    const row = writeableAttempt(7n, webhook, {
      ...base,
      result: { ok: false, statusCode: 503, error: 'http_503' },
      state: 'pending',
    });

    expect(row.payload).toBe(base.body);
    expect(row.nextAttemptAt).toEqual(new Date(base.now.getTime() + redeliveryBackoffMs(3)));
    expect(row.state).toBe('pending');
    expect(row.permanent).toBe(false);
    // History is recorded exactly as the send reported it.
    expect(row).toMatchObject({ licenseId: 7n, attempt: 3, ok: false, statusCode: 503 });
  });

  it('drops the payload the moment the delivery settles, whichever way', () => {
    for (const state of ['delivered', 'failed', 'exhausted'] as const) {
      const row = writeableAttempt(7n, webhook, {
        ...base,
        result: state === 'delivered' ? { ok: true, statusCode: 200 } : { ok: false },
        state,
      });
      // A customer payload is not kept in a log nothing will ever re-send.
      expect(row.payload).toBeNull();
      expect(row.nextAttemptAt).toBeNull();
    }
  });

  it('sets permanent exactly when the state is exhausted', () => {
    const exhausted = writeableAttempt(7n, webhook, {
      ...base,
      result: { ok: false, error: 'http_500' },
      state: 'exhausted',
    });
    expect(exhausted.permanent).toBe(true);

    for (const state of ['pending', 'delivered', 'failed'] as const) {
      const row = writeableAttempt(7n, webhook, {
        ...base,
        result: { ok: state === 'delivered' },
        state,
      });
      expect(row.permanent).toBe(false);
    }
  });
});
