/**
 * A data table that becomes a stack of cards on a narrow window (GV-04 · tm 472.3).
 *
 * At 1024 px and wider it is a plain `<table>`. Below that, the stylesheet
 * (`styles/index.css`, `.card-table`) lays every body row out as a card: the
 * first cell is the card's title, every other cell a "column name — value"
 * line. A wide table therefore never needs a sideways scroller on a phone.
 *
 * The column names a card prints come from the table's own header: after every
 * render each body cell gets a `data-label` naming its column (spans counted),
 * which the stylesheet shows before the value. A cell that already carries a
 * `data-label` keeps it, so a caller can name a cell the header does not.
 *
 * Changing a table part's `display` drops its table semantics in some browsers,
 * so the parts are given their roles explicitly as well — the same roles they
 * already have, now independent of the layout.
 */
import { useLayoutEffect, useRef, type ReactElement, type TableHTMLAttributes } from 'react';

/** Marks the table for the stacked layout; the rules live in `styles/index.css`. */
export const CARD_TABLE_CLASS = 'card-table';

/** Marks a `data-label` this component wrote, as against one the caller set. */
const AUTO_LABEL = 'data-label-auto';

/** Read the last header row's column names, one per column (a `colSpan` repeats its name). */
function columnNames(table: HTMLTableElement): string[] {
  const rows = table.tHead?.rows;
  const last = rows && rows.length > 0 ? rows[rows.length - 1] : undefined;
  if (!last) return [];
  const names: string[] = [];
  for (const cell of Array.from(last.cells)) {
    const name = (cell.textContent ?? '').trim();
    for (let i = 0; i < Math.max(1, cell.colSpan); i += 1) names.push(name);
  }
  return names;
}

/** Name every body cell after its column and give each part its table role. */
export function labelCardTable(table: HTMLTableElement): void {
  const names = columnNames(table);
  table.setAttribute('role', 'table');
  for (const section of [table.tHead, ...Array.from(table.tBodies), table.tFoot]) {
    if (!section) continue;
    section.setAttribute('role', 'rowgroup');
    const header = section === table.tHead;
    for (const row of Array.from(section.rows)) {
      row.setAttribute('role', 'row');
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        if (cell.tagName === 'TH') {
          const scope = cell.getAttribute('scope');
          cell.setAttribute('role', header || scope === 'col' ? 'columnheader' : 'rowheader');
        } else {
          cell.setAttribute('role', 'cell');
        }
        const name = names[column];
        // A label this function wrote is rewritten (the columns may have
        // changed); one the caller wrote is left alone.
        const own = !cell.hasAttribute('data-label') || cell.hasAttribute(AUTO_LABEL);
        if (!header && own) {
          if (name) {
            cell.setAttribute('data-label', name);
            cell.setAttribute(AUTO_LABEL, '');
          } else {
            cell.removeAttribute('data-label');
            cell.removeAttribute(AUTO_LABEL);
          }
        }
        column += Math.max(1, cell.colSpan);
      }
    }
  }
}

export function CardTable({
  className,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement>): ReactElement {
  const ref = useRef<HTMLTableElement>(null);
  // No dependency list on purpose: the rows are the caller's children, and a
  // new row is a new cell with no label yet. Labelling is a few attribute
  // writes, cheaper than knowing what changed.
  useLayoutEffect(() => {
    if (ref.current) labelCardTable(ref.current);
  });
  return (
    <table
      ref={ref}
      className={className ? `${CARD_TABLE_CLASS} ${className}` : CARD_TABLE_CLASS}
      {...rest}
    >
      {children}
    </table>
  );
}
