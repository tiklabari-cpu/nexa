/**
 * Marketplace grid geometry (FR-EK-B.1 / NFR-P4).
 *
 * `VirtualList` windows a *flat* list of uniform rows, but the marketplace is a
 * multi-column card grid: 102 catalogue cards painted straight into a CSS
 * `auto-fill` grid put every one of them in the DOM, which is exactly what P4
 * ("only the visible row is in the DOM") forbids. Windowing a grid means
 * deciding what a "row" is, so that decision lives here, in two pure functions
 * with no DOM and no React:
 *
 *   - `columnsForWidth` reproduces what `grid-cols-[repeat(auto-fill,minmax(260px,1fr))]`
 *     used to work out by itself — how many cards fit across a measured width.
 *   - `chunkIntoRows` cuts the cards into rows of that many, and those rows are
 *     what the virtualizer scrolls.
 *
 * This is the single source of truth for the row shape: the component measures a
 * width and renders, it does not do arithmetic of its own.
 */

/**
 * Narrowest a card may get, in px — the `minmax(260px, 1fr)` the flat grid used,
 * kept so the windowed grid breaks at the same widths it always did.
 */
export const MIN_CARD_WIDTH = 260;

/** Gutter between cards, in px — Tailwind's `gap-3`. */
export const GRID_GAP = 12;

/**
 * How many cards fit across `width`, the way `auto-fill` would: n columns need
 * `n × minCardWidth + (n - 1) × gap` px, so `n = ⌊(width + gap) / (minCardWidth + gap)⌋`.
 *
 * Never returns 0: one card per row is the floor even in a container narrower
 * than a card (and in an environment with no layout at all, where the measured
 * width is 0 — a single column then windows honestly rather than rendering
 * nothing).
 */
export function columnsForWidth(
  width: number,
  minCardWidth: number = MIN_CARD_WIDTH,
  gap: number = GRID_GAP,
): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

/**
 * Cuts `items` into rows of `columns` cards, in order. The last row is short
 * when the count does not divide evenly, and an empty list yields no rows at all
 * (not one empty row) — a row is only ever created for cards that exist, so the
 * virtualizer's `rowHeight × rows` spacer maths stay honest.
 *
 * A `columns` value below 1 (or not a number) falls back to 1 rather than
 * looping forever: the caller derives it from a live measurement, so it must not
 * be able to hang the render.
 */
export function chunkIntoRows<T>(items: readonly T[], columns: number): T[][] {
  const perRow = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow));
  }
  return rows;
}
