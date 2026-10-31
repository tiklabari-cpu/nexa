/**
 * The ticket's first-response badge (HD-05 · tm 360): time left from the
 * server's due moment, a warning near it, "overdue" past it, and "answered
 * late" once a recorded miss is behind it — words and icons, not colour alone.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketSla } from '@siyahtus/types';
import { useLocaleStore } from '../../lib/i18n.js';
import { NOW_TICK_MS } from '../../lib/use-now.js';
import { TicketSlaBadge, ticketSlaState } from './TicketSlaBadge.js';

const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);
const MINUTE = 60_000;
const running = (minutesAhead: number): TicketSla => ({
  first_response_at: null,
  first_response_due_at: new Date(T0 + minutesAhead * MINUTE).toISOString(),
  first_response_breached: false,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  useLocaleStore.getState().setLocale('en');
});
afterEach(() => vi.useRealTimers());

describe('ticketSlaState', () => {
  it('has nothing to say when the clock is not running and nothing was missed', () => {
    expect(ticketSlaState(undefined, T0)).toBeNull();
    expect(
      ticketSlaState(
        { first_response_at: null, first_response_due_at: null, first_response_breached: false },
        T0,
      ),
    ).toBeNull();
  });

  it('warns under 30 minutes and turns overdue at the due moment', () => {
    expect(ticketSlaState(running(90), T0)).toEqual({ kind: 'running', minutes: 89, warn: false });
    expect(ticketSlaState(running(15), T0)).toEqual({ kind: 'running', minutes: 14, warn: true });
    expect(ticketSlaState(running(0), T0)).toEqual({ kind: 'overdue', minutes: 1 });
    expect(ticketSlaState(running(-20), T0)).toEqual({ kind: 'overdue', minutes: 21 });
  });

  it('reads a recorded miss on an answered ticket as answered late', () => {
    expect(
      ticketSlaState(
        {
          first_response_at: new Date(T0).toISOString(),
          first_response_due_at: null,
          first_response_breached: true,
        },
        T0,
      ),
    ).toEqual({ kind: 'answered_late' });
  });
});

describe('TicketSlaBadge', () => {
  it('counts down on the shared clock and says when it is late (HD-05)', () => {
    render(<TicketSlaBadge sla={running(31)} />);
    expect(screen.getByText('30 min left')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4 * NOW_TICK_MS);
    });
    expect(screen.getByText('29 min left')).toBeInTheDocument();
    expect(screen.getByText('⚠')).toBeInTheDocument();

    act(() => {
      // 119.5 more minutes: 89.5 past the due moment, read as 90.
      vi.advanceTimersByTime(478 * NOW_TICK_MS);
    });
    expect(screen.getByText('Overdue by 1 h 30 min')).toBeInTheDocument();
  });

  it('writes hours and minutes in Turkish', () => {
    useLocaleStore.getState().setLocale('tr');
    render(<TicketSlaBadge sla={running(185)} />);
    expect(screen.getByText('3 sa 4 dk kaldı')).toBeInTheDocument();
  });

  it('drops a zero minute part: two hours read as "2 h"', () => {
    render(<TicketSlaBadge sla={running(121)} />);
    expect(screen.getByText('2 h left')).toBeInTheDocument();
  });
});
