/**
 * One agent's day as a strip (RP-03 · tm 370): the segments of
 * `GET /reports/agent-activity` laid along the workspace day, with the saved
 * work schedule drawn as a band underneath.
 *
 * Colour-blind friendly by construction: every state has its own *pattern*
 * as well as its own colour (solid, diagonal stripes, cross-hatch, plain
 * grey, dotted), and the legend draws the same swatches. The bar itself is
 * decoration for sighted readers — the same segments are listed in a
 * screen-reader table with their times, so nothing is carried by colour or
 * position alone.
 */
import type { CSSProperties, ReactElement } from 'react';
import { formatDuration } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';

export type ActivityState = 'accepting' | 'not_accepting' | 'offline' | 'disconnected' | 'unknown';

export interface ActivitySegmentView {
  state: ActivityState;
  source: string | null;
  from: string;
  to: string;
}

export const ACTIVITY_STATE_ORDER: readonly ActivityState[] = [
  'accepting',
  'not_accepting',
  'offline',
  'disconnected',
  'unknown',
];

export const ACTIVITY_STATE_LABEL_KEYS: Record<ActivityState, string> = {
  accepting: 'reports.activity.state.accepting',
  not_accepting: 'reports.activity.state.notAccepting',
  offline: 'reports.activity.state.offline',
  disconnected: 'reports.activity.state.disconnected',
  unknown: 'reports.activity.state.unknown',
};

/** Colour + pattern per state; CSS variables so the dark theme follows. */
const STATE_STYLE: Record<ActivityState, CSSProperties> = {
  accepting: { backgroundColor: 'var(--success)' },
  not_accepting: {
    backgroundImage: 'repeating-linear-gradient(45deg, var(--warning) 0 4px, transparent 4px 8px)',
    backgroundColor: 'color-mix(in srgb, var(--warning) 20%, transparent)',
  },
  offline: { backgroundColor: 'var(--border-strong)' },
  disconnected: {
    backgroundImage:
      'repeating-linear-gradient(45deg, var(--danger) 0 2px, transparent 2px 6px), repeating-linear-gradient(-45deg, var(--danger) 0 2px, transparent 2px 6px)',
  },
  unknown: {
    backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1.5px)',
    backgroundSize: '6px 6px',
  },
};

const PLANNED_STYLE: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(90deg, var(--info) 0 6px, transparent 6px 9px)',
};

function timeFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  });
}

/** A swatch in a state's colour and pattern — the legend and the table share it. */
export function StateSwatch({ state }: { state: ActivityState }): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-state={state}
      className="inline-block h-3 w-5 shrink-0 rounded-sm border border-border"
      style={STATE_STYLE[state]}
    />
  );
}

export function ActivityLegend({ showPlan }: { showPlan: boolean }): ReactElement {
  const t = useTranslate();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary">
      {ACTIVITY_STATE_ORDER.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <StateSwatch state={state} />
          {t(ACTIVITY_STATE_LABEL_KEYS[state])}
        </li>
      ))}
      {showPlan && (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-5 shrink-0 rounded-sm"
            style={PLANNED_STYLE}
          />
          {t('reports.activity.planned')}
        </li>
      )}
    </ul>
  );
}

export function ActivityStrip({
  label,
  segments,
  planned,
  range,
  timezone,
}: {
  label: string;
  segments: readonly ActivitySegmentView[];
  planned: ReadonlyArray<{ from: string; to: string }> | null;
  range: { from: string; to: string };
  timezone: string;
}): ReactElement {
  const t = useTranslate();
  const start = Date.parse(range.from);
  const span = Math.max(1, Date.parse(range.to) - start);
  const place = (from: string, to: string): CSSProperties => {
    const left = ((Date.parse(from) - start) / span) * 100;
    const width = ((Date.parse(to) - Date.parse(from)) / span) * 100;
    return { left: `${Math.max(0, left)}%`, width: `${Math.max(0, width)}%` };
  };
  const time = timeFormatter(timezone);
  const at = (iso: string) => time.format(new Date(iso));
  const ticks = Array.from({ length: 5 }, (_, index) => start + (span * index) / 4);

  return (
    <div className="min-w-0">
      <div
        aria-hidden="true"
        className="relative h-5 overflow-hidden rounded border border-border bg-surface"
      >
        {segments.map((segment) => (
          <span
            key={`${segment.from}-${segment.state}`}
            data-state={segment.state}
            title={`${t(ACTIVITY_STATE_LABEL_KEYS[segment.state])} · ${at(segment.from)}–${at(segment.to)}`}
            className="absolute inset-y-0"
            style={{ ...STATE_STYLE[segment.state], ...place(segment.from, segment.to) }}
          />
        ))}
      </div>
      <div aria-hidden="true" className="relative mt-0.5 h-1.5">
        {(planned ?? []).map((interval) => (
          <span
            key={interval.from}
            data-planned="true"
            className="absolute inset-y-0 rounded-sm"
            style={{ ...PLANNED_STYLE, ...place(interval.from, interval.to) }}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="mt-0.5 flex justify-between text-[10px] text-content-tertiary"
      >
        {ticks.map((tick) => (
          <span key={tick} className="tabular">
            {time.format(new Date(tick))}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{t('reports.activity.stripCaption', { name: label, timezone })}</caption>
        <thead>
          <tr>
            <th scope="col">{t('reports.activity.column.state')}</th>
            <th scope="col">{t('reports.activity.column.from')}</th>
            <th scope="col">{t('reports.activity.column.to')}</th>
            <th scope="col">{t('reports.activity.column.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => (
            <tr key={`${segment.from}-${segment.state}`}>
              <td>{t(ACTIVITY_STATE_LABEL_KEYS[segment.state])}</td>
              <td>{at(segment.from)}</td>
              <td>{at(segment.to)}</td>
              <td>
                {formatDuration((Date.parse(segment.to) - Date.parse(segment.from)) / 1000) ?? ''}
              </td>
            </tr>
          ))}
          {(planned ?? []).map((interval) => (
            <tr key={`plan-${interval.from}`}>
              <td>{t('reports.activity.planned')}</td>
              <td>{at(interval.from)}</td>
              <td>{at(interval.to)}</td>
              <td>
                {formatDuration((Date.parse(interval.to) - Date.parse(interval.from)) / 1000) ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
