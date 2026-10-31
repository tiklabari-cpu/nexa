/**
 * The waiting counter on an inbox row (IN-03 · tm 361): the server's start,
 * the shared clock, the thresholds, and the words that never rest on colour
 * alone.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAITING_DEFAULT_THRESHOLDS } from '@siyahtus/types';
import { useLocaleStore } from '../../lib/i18n.js';
import { NOW_TICK_MS } from '../../lib/use-now.js';
import { WaitingTimer } from './WaitingTimer.js';

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const since = (secondsAgo: number) => new Date(T0 - secondsAgo * 1000).toISOString();
const DEFAULTS = WAITING_DEFAULT_THRESHOLDS;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  useLocaleStore.getState().setLocale('en');
});
afterEach(() => vi.useRealTimers());

function timer() {
  return screen.getByTestId('waiting-timer');
}

describe('WaitingTimer', () => {
  it('says "just now" under a minute and whole minutes after (IN-03)', () => {
    const { rerender } = render(
      <WaitingTimer since={since(20)} queued={false} thresholds={DEFAULTS} />,
    );
    expect(timer().textContent).toContain('just now');
    rerender(<WaitingTimer since={since(100)} queued={false} thresholds={DEFAULTS} />);
    expect(timer().textContent).toContain('1 min');
  });

  it('reads hours and minutes past an hour (IN-03)', () => {
    render(<WaitingTimer since={since(3600 + 5 * 60)} queued={false} thresholds={DEFAULTS} />);
    expect(timer().textContent).toContain('1 h 5 min');
  });

  it('turns to a warning and an alert with an icon and words, not colour alone (IN-03)', () => {
    const { rerender } = render(
      <WaitingTimer since={since(60)} queued={false} thresholds={DEFAULTS} />,
    );
    expect(timer().dataset['level']).toBe('normal');
    expect(timer().textContent).not.toContain('⚠');

    rerender(<WaitingTimer since={since(150)} queued={false} thresholds={DEFAULTS} />);
    expect(timer().dataset['level']).toBe('warn');
    expect(timer().textContent).toContain('⚠');
    expect(timer().textContent).toContain('Waiting longer than usual');

    rerender(<WaitingTimer since={since(360)} queued={false} thresholds={DEFAULTS} />);
    expect(timer().dataset['level']).toBe('alert');
    expect(timer().textContent).toContain('⛔');
    expect(timer().textContent).toContain('6 min+');
    expect(timer().textContent).toContain('Waiting far too long');
  });

  it("follows the workspace's own thresholds (IN-03)", () => {
    render(
      <WaitingTimer
        since={since(70)}
        queued={false}
        thresholds={{ warn_seconds: 60, alert_seconds: 600 }}
      />,
    );
    expect(timer().dataset['level']).toBe('warn');
  });

  it('shows the queue time on a queued row (IN-03)', () => {
    render(<WaitingTimer since={since(3 * 60)} queued thresholds={DEFAULTS} />);
    expect(timer().textContent).toContain('in queue 3 min');
    expect(timer().textContent).toContain('Waiting in the queue: 3 min');
  });

  it('counts on from one shared clock, not one timer per row (IN-03)', () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const { container } = render(
      <>
        {Array.from({ length: 200 }, (_, i) => (
          <WaitingTimer key={i} since={since(30)} queued={false} thresholds={DEFAULTS} />
        ))}
      </>,
    );
    expect(intervals).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('just now');

    act(() => {
      vi.advanceTimersByTime(NOW_TICK_MS * 4);
    });
    expect(container.textContent).toContain('1 min');
    expect(container.textContent).not.toContain('just now');
  });

  it('draws nothing for a start it cannot read', () => {
    const { container } = render(
      <WaitingTimer since="not a time" queued={false} thresholds={DEFAULTS} />,
    );
    expect(container.textContent).toBe('');
  });
});
