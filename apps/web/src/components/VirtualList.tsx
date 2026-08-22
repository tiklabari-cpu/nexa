/**
 * Virtualized list primitive (FR-EK-B.1 / NFR-P4).
 *
 * The lists keyset-paginate on the server (P6), but every returned row still
 * entered the DOM — so a 10k-row directory painted 10k nodes and could not hold
 * 60fps (P4). This windows them: only the rows inside the scroll viewport, plus
 * a small overscan, are ever in the tree. Above and below sit two empty spacer
 * elements sized to the rows that are *not* rendered, so the scrollbar and
 * scroll position match a full list.
 *
 * Two surfaces share one windowing core because two of the four Must lists are
 * semantic tables (Contacts, Teammates — their columns and `getByRole('table')`
 * contract must survive) and two are flat lists (Skills, Tickets):
 *   - `VirtualTable`  — renders `<table>` with spacer `<tr>`s; caller keeps its
 *     `<thead>` and returns a `<tr>` per row.
 *   - `VirtualList`   — renders a `role="list"` scroller with spacer `<div>`s.
 *
 * Fixed row height. The spacers are computed from `rowHeight × count`, so rows
 * must be uniform for the scrollbar to stay honest; overscan absorbs the small
 * variance real rows have. Variable-height measurement is a later concern (v1
 * grids), deliberately out of scope here.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from 'react';

/** Overscan hides the seam: rows kept mounted just past the viewport edges. */
const DEFAULT_OVERSCAN = 6;

/** Cap that turns the list into its own scroller; short lists stay shorter. */
const DEFAULT_MAX_HEIGHT = '70vh';

/**
 * Viewport height used before the container is measured (and in environments
 * with no layout, e.g. jsdom). Erring large renders a few extra rows rather
 * than too few — a blank list is a worse failure than a cheap one.
 */
const FALLBACK_VIEWPORT = 640;

export interface VirtualWindow {
  /** First row index to render (inclusive). */
  startIndex: number;
  /** One past the last row index to render (exclusive). */
  endIndex: number;
  /** Height of the un-rendered rows above the window. */
  paddingTop: number;
  /** Height of the un-rendered rows below the window. */
  paddingBottom: number;
  /** Full scroll height the list would have with every row rendered. */
  totalHeight: number;
}

/**
 * Pure window maths — no DOM, so the slicing is unit-testable on its own.
 * `endIndex` is exclusive to match `Array.prototype.slice`.
 */
export function computeVirtualWindow(
  count: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan: number,
): VirtualWindow {
  const total = Math.max(0, count) * rowHeight;

  if (count <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0, totalHeight: total };
  }

  const clampedScroll = Math.min(Math.max(0, scrollTop), Math.max(0, total - viewportHeight));
  const firstVisible = Math.floor(clampedScroll / rowHeight);
  const lastVisible = Math.ceil((clampedScroll + viewportHeight) / rowHeight);

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(count, lastVisible + overscan);

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: (count - endIndex) * rowHeight,
    totalHeight: total,
  };
}

/**
 * Tracks scroll position and viewport height for one scroll container, and
 * derives the visible window. When `viewportHeight` is given it is used
 * verbatim and measurement is skipped — that keeps tests deterministic and lets
 * a caller pin the height. Otherwise the container is measured, live, via
 * `ResizeObserver` where available.
 */
function useVirtualRows(
  count: number,
  rowHeight: number,
  overscan: number,
  viewportHeight: number | undefined,
): {
  containerRef: RefObject<HTMLDivElement>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  window: VirtualWindow;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measured, setMeasured] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (viewportHeight != null) return;
    const el = containerRef.current;
    if (!el) return;

    const measure = (): void => setMeasured(el.clientHeight > 0 ? el.clientHeight : null);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewportHeight]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const effectiveHeight = viewportHeight ?? measured ?? FALLBACK_VIEWPORT;
  const window = computeVirtualWindow(count, rowHeight, effectiveHeight, scrollTop, overscan);

  return { containerRef, onScroll, window };
}

interface CommonProps<T> {
  items: T[];
  /** Uniform row height in px; drives the spacers and the window size. */
  rowHeight: number;
  /** Renders one row. Must return an element carrying its own React `key`. */
  renderRow: (item: T, index: number) => ReactNode;
  overscan?: number;
  /** Pins the viewport height (px); omit to measure the container. */
  viewportHeight?: number;
  /** Max scroller height; a CSS length. Defaults to `70vh`. */
  maxHeight?: number | string;
}

export interface VirtualListProps<T> extends CommonProps<T> {
  /** Accessible name for the `role="list"` scroller. */
  label?: string;
  className?: string;
}

/**
 * Flat virtualized list. The scroller carries `role="list"`; rows should carry
 * `role="listitem"`. Spacers are `aria-hidden`, so a screen reader and
 * `getByRole('listitem')` see only the real rows.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  overscan = DEFAULT_OVERSCAN,
  viewportHeight,
  maxHeight = DEFAULT_MAX_HEIGHT,
  label,
  className,
}: VirtualListProps<T>): ReactElement {
  const { containerRef, onScroll, window } = useVirtualRows(
    items.length,
    rowHeight,
    overscan,
    viewportHeight,
  );
  const visible = items.slice(window.startIndex, window.endIndex);

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      role="list"
      aria-label={label}
      className={`overflow-y-auto${className ? ` ${className}` : ''}`}
      style={{ maxHeight }}
    >
      {window.paddingTop > 0 && <div aria-hidden="true" style={{ height: window.paddingTop }} />}
      {visible.map((item, i) => renderRow(item, window.startIndex + i))}
      {window.paddingBottom > 0 && (
        <div aria-hidden="true" style={{ height: window.paddingBottom }} />
      )}
    </div>
  );
}

export interface VirtualTableProps<T> extends CommonProps<T> {
  /** The `<thead>` element; kept by the caller so columns stay theirs. */
  head: ReactNode;
  /** Column count, for the spacer cell's `colSpan`. */
  colSpan: number;
  /** Rendered as `<caption class="sr-only">`; this is the table's a11y name. */
  caption?: string;
  tableClassName?: string;
}

/**
 * Virtualized `<table>`. The window's un-rendered rows become two `aria-hidden`
 * spacer `<tr>`s, so the table keeps its structure and accessible name while
 * only the visible `<tr>`s exist. `renderRow` must return a `<tr>`.
 */
export function VirtualTable<T>({
  items,
  rowHeight,
  renderRow,
  overscan = DEFAULT_OVERSCAN,
  viewportHeight,
  maxHeight = DEFAULT_MAX_HEIGHT,
  head,
  colSpan,
  caption,
  tableClassName = 'w-full text-sm',
}: VirtualTableProps<T>): ReactElement {
  const { containerRef, onScroll, window } = useVirtualRows(
    items.length,
    rowHeight,
    overscan,
    viewportHeight,
  );
  const visible = items.slice(window.startIndex, window.endIndex);

  return (
    // `tabIndex={0}` is WCAG 2.1.1: once the list grows past `maxHeight` this
    // div becomes the actual scroller, and unlike `VirtualList` its rows are
    // plain text cells, not buttons — no descendant is focusable, so without
    // this a keyboard user has no way to reach the rows scrolled out of view
    // (axe `scrollable-region-focusable`, caught scanning the Audit log table,
    // tm 137.3).
    <div
      ref={containerRef}
      onScroll={onScroll}
      tabIndex={0}
      className="overflow-y-auto"
      style={{ maxHeight }}
    >
      <table className={tableClassName}>
        {caption != null && <caption className="sr-only">{caption}</caption>}
        {head}
        <tbody>
          {window.paddingTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={colSpan} style={{ height: window.paddingTop, padding: 0 }} />
            </tr>
          )}
          {visible.map((item, i) => renderRow(item, window.startIndex + i))}
          {window.paddingBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={colSpan} style={{ height: window.paddingBottom, padding: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
