/**
 * Marketplace grid geometry (FR-EK-B.1 / NFR-P4) — the row shape the virtualizer
 * scrolls. Pure functions, so the arithmetic that decides "what is a row" is
 * pinned here rather than inferred from a rendered tree.
 */
import { describe, expect, it } from 'vitest';
import { chunkIntoRows, columnsForWidth, GRID_GAP, MIN_CARD_WIDTH } from './app-grid.js';

describe('chunkIntoRows', () => {
  it('cuts a list into full rows of the given width', () => {
    expect(chunkIntoRows([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('leaves the last row short when the count does not divide evenly', () => {
    const rows = chunkIntoRows([1, 2, 3, 4, 5], 3);
    expect(rows).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    // The short row is a real row: 5 cards over 3 columns is 2 rows, and the
    // spacer maths depend on that count being right.
    expect(rows).toHaveLength(2);
  });

  it('yields no rows at all for an empty list', () => {
    // Not one empty row — an empty row would give the scroller a phantom
    // `rowHeight` of scrollable space with nothing in it.
    expect(chunkIntoRows([], 4)).toEqual([]);
  });

  it('puts one item per row at a single column', () => {
    expect(chunkIntoRows(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
  });

  it.each([0, -3, 0.4, Number.NaN])('falls back to one column for %s', (columns) => {
    // The caller derives `columns` from a live measurement, so a degenerate
    // value must render a column, never hang the loop.
    expect(chunkIntoRows(['a', 'b'], columns)).toEqual([['a'], ['b']]);
  });

  it('keeps every item exactly once, in order', () => {
    const items = Array.from({ length: 102 }, (_, i) => i);
    const rows = chunkIntoRows(items, 4);
    expect(rows).toHaveLength(26); // 25 full rows + a row of 2
    expect(rows.at(-1)).toEqual([100, 101]);
    expect(rows.flat()).toEqual(items);
  });

  it('does not mutate or alias the input list', () => {
    const items = [1, 2, 3, 4];
    const rows = chunkIntoRows(items, 2);
    rows[0]?.push(99);
    expect(items).toEqual([1, 2, 3, 4]);
  });
});

describe('columnsForWidth', () => {
  it('fits one card per row until a second one fits whole', () => {
    // Two columns need 2×260 + 12 = 532px; one pixel short is still one column.
    expect(columnsForWidth(MIN_CARD_WIDTH)).toBe(1);
    expect(columnsForWidth(2 * MIN_CARD_WIDTH + GRID_GAP - 1)).toBe(1);
    expect(columnsForWidth(2 * MIN_CARD_WIDTH + GRID_GAP)).toBe(2);
  });

  it('fits as many whole cards as the width allows', () => {
    expect(columnsForWidth(1200)).toBe(4); // (1200 + 12) / 272 = 4.45
    expect(columnsForWidth(1632)).toBe(6); // 6×260 + 5×12 = 1620, exactly fits
  });

  it('never drops below one column, whatever the measurement says', () => {
    // 0 is the pre-measurement (and no-layout) reading; one column windows
    // honestly instead of rendering nothing.
    expect(columnsForWidth(0)).toBe(1);
    expect(columnsForWidth(120)).toBe(1);
    expect(columnsForWidth(-40)).toBe(1);
    expect(columnsForWidth(Number.NaN)).toBe(1);
  });

  it('honours a caller-supplied card width and gap', () => {
    expect(columnsForWidth(600, 200, 0)).toBe(3);
    expect(columnsForWidth(600, 200, 50)).toBe(2); // 3 would need 700px
  });
});
