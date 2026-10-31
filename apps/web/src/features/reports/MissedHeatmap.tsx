/**
 * The missed-chats heat map (RP-02 · tm 369.2): 168 cells, weekday × hour in the
 * workspace's time zone (`ReportsMissed.timezone`, ID-04), shaded by how many
 * connections were missed in that hour.
 *
 * Shade is relative to the busiest cell of the window and carries no meaning of
 * its own: every cell prints its count, so the grid reads without colour.
 */
import type { ReactElement } from 'react';
import { formatCount } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { HourGrid, MONDAY_FIRST_WEEKDAYS } from './HourGrid.js';

export interface MissedHeatCell {
  /** ISO weekday, 1 Monday … 7 Sunday. */
  weekday: number;
  hour: number;
  missed: number;
}

/** Five steps, written out so the class names are visible to Tailwind. */
function shadeClass(missed: number, max: number): string {
  if (missed <= 0 || max <= 0) return 'text-content-tertiary';
  const ratio = missed / max;
  if (ratio > 0.75) return 'bg-danger/60 font-semibold text-content';
  if (ratio > 0.5) return 'bg-danger/40 font-semibold text-content';
  if (ratio > 0.25) return 'bg-danger/25 text-content';
  return 'bg-danger/10 text-content';
}

export function MissedHeatmap({
  cells,
  timezone,
}: {
  cells: readonly MissedHeatCell[];
  timezone: string;
}): ReactElement {
  const t = useTranslate();
  const byKey = new Map<string, number>();
  let max = 0;
  for (const cell of cells) {
    byKey.set(`${cell.weekday}-${cell.hour}`, cell.missed);
    if (cell.missed > max) max = cell.missed;
  }
  return (
    <HourGrid
      caption={t('reports.missed.heatmap.caption', { timezone })}
      weekdays={MONDAY_FIRST_WEEKDAYS}
      renderCell={(row, hour) => {
        const missed = byKey.get(`${row + 1}-${hour}`) ?? 0;
        return (
          <td
            title={t('reports.missed.heatmap.cellTitle', { count: formatCount(missed) ?? '0' })}
            className={`tabular px-1 py-1.5 text-center ${shadeClass(missed, max)}`}
          >
            {formatCount(missed)}
          </td>
        );
      }}
    />
  );
}
