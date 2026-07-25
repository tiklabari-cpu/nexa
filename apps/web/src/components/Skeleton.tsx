/**
 * Loading placeholders (design-brief §1.5 + component inventory).
 *
 * A loading list holds the shape of the rows that will replace it rather than a
 * spinner or a blank box: the page must not jump when data lands, and a bare
 * rectangle reads as broken. Every Must list — Contacts, Teammates, Tickets,
 * Inbox — showed its own hand-rolled placeholder before this; they now share
 * one row skeleton so "loading" looks like a single product, not four.
 *
 * Skeletons are `aria-hidden`: they are a visual courtesy, not content. A screen
 * reader should hear the real rows once they arrive, never a list of empty ones,
 * and `getByRole('list' | 'table' | 'row')` must keep matching only real data —
 * so the list/table role never lands on the placeholder.
 */
import type { CSSProperties, ReactElement } from 'react';

/**
 * One shimmer bar — the design-system `Skeleton` atom. `width` and `height` take
 * any CSS length; compose a few to sketch whatever is loading. It carries no
 * `animate-pulse` of its own so a parent can pulse a whole group in unison.
 */
export function Skeleton({
  width = '100%',
  height = '0.75rem',
  className = '',
}: {
  width?: string;
  height?: string;
  className?: string;
}): ReactElement {
  const style: CSSProperties = { width, height };
  return <div className={`rounded-sm bg-inset ${className}`.trim()} style={style} />;
}

/**
 * Row-shaped placeholder for the Must lists. Renders `rows` two-line rows that
 * mirror a real list/table row — a title bar over a subtitle bar — inside one
 * `aria-hidden`, `animate-pulse` list. It fills whatever container (a `<Card>`
 * body, the inbox list pane) would otherwise flash empty while the first page
 * of a keyset query loads.
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }): ReactElement {
  return (
    <ul aria-hidden="true" className="animate-pulse">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="border-b border-border px-4 py-3 last:border-0">
          <Skeleton width="45%" className="mb-2" />
          <Skeleton width="70%" />
        </li>
      ))}
    </ul>
  );
}
