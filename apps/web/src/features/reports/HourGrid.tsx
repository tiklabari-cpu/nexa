/**
 * The weekday × hour table both grid reports draw (Staffing's gap grid and the
 * missed-chats heat map, RP-02 · tm 369.2): one row per weekday, one column per
 * hour, the cell body left to the caller.
 *
 * The shell is shared; what a cell *means* is not. Staffing's rows are UTC
 * weekdays and its cells a gap; the heat map's rows are weekdays in the
 * workspace's zone (ID-04) and its cells a count. So the caller names the rows
 * and the zone caption, and this file never decides a zone.
 */
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { formatWeekday, type Weekday } from '../../lib/format.js';
import { getLocale, useTranslate } from '../../lib/i18n.js';

export const GRID_HOURS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);

/** Monday first, the order of the missed-chats heat map (ISO weekday 1 … 7). */
export const MONDAY_FIRST_WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export function HourGrid({
  caption,
  weekdays,
  renderCell,
}: {
  caption: string;
  /** The rows, top to bottom. */
  weekdays: readonly Weekday[];
  /** The `<td>` of one cell; `row` indexes `weekdays`. */
  renderCell: (row: number, hour: number) => ReactNode;
}): ReactElement {
  const t = useTranslate();
  const locale = getLocale();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="px-2 py-1.5 text-2xs font-medium text-content-secondary">
              {t('reports.common.dayColumn')}
            </th>
            {GRID_HOURS.map((hour) => (
              <th
                key={hour}
                scope="col"
                className="w-8 px-1 py-1.5 text-center text-2xs font-medium text-content-secondary"
              >
                {String(hour).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekdays.map((day, row) => (
            <tr key={day} className="border-b border-border last:border-0">
              <th
                scope="row"
                className="px-2 py-1.5 text-left text-2xs font-medium text-content-secondary"
              >
                {formatWeekday(day, locale, 'short')}
              </th>
              {GRID_HOURS.map((hour) => (
                <Fragment key={hour}>{renderCell(row, hour)}</Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
