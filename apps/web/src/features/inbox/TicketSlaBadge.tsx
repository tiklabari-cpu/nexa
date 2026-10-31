/**
 * A ticket's first-response clock, on the grid row and in the ticket pane
 * (HD-05 · tm 360).
 *
 * Everything it says comes from the server's `sla` block — the due moment
 * already counts only open minutes when the workspace measures business hours,
 * so nothing is worked out here but "how far is now from it". The clock is the
 * shared one (`useNow`), so a full grid runs one interval. Each state carries a
 * word and an icon as well as a colour, so it never rests on colour alone.
 */
import type { ReactElement } from 'react';
import { slaMinutesLeft, type TicketSla } from '@siyahtus/types';
import { useTranslate } from '../../lib/i18n.js';
import { useNow } from '../../lib/use-now.js';

/** Under this many minutes left the badge turns to a warning. */
export const SLA_WARN_MINUTES = 30;

export type TicketSlaState =
  | { kind: 'running'; minutes: number; warn: boolean }
  | { kind: 'overdue'; minutes: number }
  | { kind: 'answered_late' }
  | null;

/** What the badge shows at `now`; null when there is nothing to say. */
export function ticketSlaState(sla: TicketSla | undefined, now: number): TicketSlaState {
  if (!sla) return null;
  if (sla.first_response_due_at !== null) {
    const left = slaMinutesLeft(sla.first_response_due_at, now);
    if (left < 0 || sla.first_response_breached) {
      return { kind: 'overdue', minutes: Math.max(1, -left) };
    }
    return { kind: 'running', minutes: left, warn: left < SLA_WARN_MINUTES };
  }
  return sla.first_response_breached ? { kind: 'answered_late' } : null;
}

/** "45 min", "2 h" or "3 h 10 min" — the values for the message keys below. */
function span(minutes: number): {
  key: 'minutes' | 'hours' | 'hoursExact';
  values: Record<string, number>;
} {
  if (minutes < 60) return { key: 'minutes', values: { minutes } };
  const hours = Math.floor(minutes / 60);
  if (minutes % 60 === 0) return { key: 'hoursExact', values: { hours } };
  return { key: 'hours', values: { hours, minutes: minutes % 60 } };
}

export function TicketSlaBadge({ sla }: { sla: TicketSla | undefined }): ReactElement | null {
  const t = useTranslate();
  const now = useNow();
  const state = ticketSlaState(sla, now);
  if (!state) return null;

  if (state.kind === 'answered_late') {
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <span aria-hidden="true">⛔</span>
        {t('inbox.ticketSla.answeredLate')}
      </span>
    );
  }

  const { key, values } = span(state.minutes);
  const duration = t(`inbox.ticketSla.span.${key}`, values);
  if (state.kind === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <span aria-hidden="true">⛔</span>
        {t('inbox.ticketSla.overdue', { duration })}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        state.warn ? 'text-warning' : 'text-content-secondary'
      }`}
    >
      <span aria-hidden="true">{state.warn ? '⚠' : '⏱'}</span>
      {t('inbox.ticketSla.left', { duration })}
    </span>
  );
}
