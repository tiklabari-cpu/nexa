/**
 * How long this player has waited, on an inbox row (IN-03 · tm 361).
 *
 * The start is the server's (`ChatSummary.waiting_since`, or `queued_at` for a
 * queued row) — never worked out here from the transcript — and the clock is
 * the shared one (`useNow`), so a 200-row list runs one interval. Under a
 * minute it reads "just now"; past the workspace's two thresholds the row
 * gains an icon and, at the second, a trailing "+", so the state never rests
 * on colour alone.
 */
import type { ReactElement } from 'react';
import {
  waitingDuration,
  waitingLevel,
  type WaitingDuration,
  type WaitingLevel,
  type WaitingThresholds,
} from '@siyahtus/types';
import { useTranslate } from '../../lib/i18n.js';
import { useNow } from '../../lib/use-now.js';

const LEVEL_ICON: Record<WaitingLevel, string | null> = { normal: null, warn: '⚠', alert: '⛔' };
const LEVEL_NOTE: Record<WaitingLevel, string | null> = {
  normal: null,
  warn: 'inbox.list.item.waiting.warn',
  alert: 'inbox.list.item.waiting.alert',
};
const LEVEL_TEXT: Record<WaitingLevel, string> = {
  normal: 'text-content-secondary',
  warn: 'text-warning',
  alert: 'text-danger',
};

/** The words for a duration, as a message key and its values. */
export function waitingDurationMessage(duration: WaitingDuration): {
  key: string;
  values: Record<string, number>;
} {
  switch (duration.kind) {
    case 'now':
      return { key: 'inbox.list.item.waiting.now', values: {} };
    case 'minutes':
      return { key: 'inbox.list.item.waiting.minutes', values: { minutes: duration.minutes } };
    case 'hours':
      return {
        key: 'inbox.list.item.waiting.hours',
        values: { hours: duration.hours, minutes: duration.minutes },
      };
  }
}

export function WaitingTimer({
  since,
  queued,
  thresholds,
}: {
  /** ISO time the wait began: `queued_at` for a queued row, else `waiting_since`. */
  since: string;
  /** The row waits in a team's queue: "in queue 3 min". */
  queued: boolean;
  thresholds: WaitingThresholds;
}): ReactElement | null {
  const t = useTranslate();
  const now = useNow();
  const start = Date.parse(since);
  if (Number.isNaN(start)) return null;

  const elapsed = Math.max(0, (now - start) / 1000);
  const level = waitingLevel(elapsed, thresholds);
  const message = waitingDurationMessage(waitingDuration(elapsed));
  const spoken = t(message.key, message.values);
  const shown =
    level === 'alert' ? t('inbox.list.item.waiting.atLeast', { duration: spoken }) : spoken;
  const label = queued ? t('inbox.list.item.waiting.queued', { duration: shown }) : shown;
  const icon = LEVEL_ICON[level];
  const note = LEVEL_NOTE[level];

  return (
    <span
      data-testid="waiting-timer"
      data-level={level}
      className={`tabular inline-flex shrink-0 items-center gap-1 rounded-sm bg-inset px-1.5 py-0.5 text-2xs ${LEVEL_TEXT[level]}`}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">
        {t(queued ? 'inbox.list.item.waiting.queuedAria' : 'inbox.list.item.waiting.aria', {
          duration: spoken,
        })}
        {note && `. ${t(note)}`}
      </span>
    </span>
  );
}
