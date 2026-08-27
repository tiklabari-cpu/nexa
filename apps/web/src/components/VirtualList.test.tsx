/**
 * The one property that matters for NFR-P4: however many rows the data has, only
 * the rows inside the viewport (plus overscan) are ever in the DOM. Everything
 * else here defends that — the pure window maths, the two surfaces that share
 * it, and a 10k-row budget check that stands in for "60fps": paint cost tracks
 * node count, so a bounded node count is the measurable proxy a unit test can
 * hold.
 *
 * jsdom has no layout, so the viewport height is pinned via the `viewportHeight`
 * prop and scrolling is driven by overriding `scrollTop` before dispatching the
 * event — the component reads exactly those, keeping the window deterministic.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { computeVirtualWindow, VirtualList, VirtualTable } from './VirtualList.js';

interface Row {
  id: number;
  label: string;
}

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, label: `Row ${i}` }));
}

const ROW = 40;
const VIEWPORT = 400;
const OVERSCAN = 4;

function scrollTo(container: HTMLElement, top: number): void {
  Object.defineProperty(container, 'scrollTop', { configurable: true, value: top });
  fireEvent.scroll(container);
}

describe('computeVirtualWindow', () => {
  it('renders every row when they all fit, with no padding', () => {
    const w = computeVirtualWindow(5, ROW, VIEWPORT, 0, OVERSCAN);
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(5);
    expect(w.paddingTop).toBe(0);
    expect(w.paddingBottom).toBe(0);
    expect(w.totalHeight).toBe(5 * ROW);
  });

  it('windows a long list and pads for the rows left out', () => {
    const w = computeVirtualWindow(10_000, ROW, VIEWPORT, 0, OVERSCAN);
    // firstVisible 0, lastVisible 10, minus/plus overscan 4 → [0, 14).
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(14);
    expect(w.paddingTop).toBe(0);
    expect(w.paddingBottom).toBe((10_000 - 14) * ROW);
    expect(w.totalHeight).toBe(10_000 * ROW);
  });

  it('moves the window with scrollTop', () => {
    const w = computeVirtualWindow(10_000, ROW, VIEWPORT, 9000 * ROW, OVERSCAN);
    expect(w.startIndex).toBe(8996);
    expect(w.endIndex).toBe(9014);
    expect(w.paddingTop).toBe(8996 * ROW);
  });

  it('is safe for empty and zero-height inputs', () => {
    expect(computeVirtualWindow(0, ROW, VIEWPORT, 0, OVERSCAN)).toMatchObject({
      startIndex: 0,
      endIndex: 0,
    });
    expect(computeVirtualWindow(10, 0, VIEWPORT, 0, OVERSCAN)).toMatchObject({ endIndex: 0 });
  });
});

describe('VirtualList', () => {
  it('keeps only the visible window in the DOM for a 10k-row list', () => {
    render(
      <VirtualList
        items={makeRows(10_000)}
        rowHeight={ROW}
        viewportHeight={VIEWPORT}
        overscan={OVERSCAN}
        label="Rows"
        renderRow={(row) => (
          <div key={row.id} role="listitem" data-testid="vrow">
            {row.label}
          </div>
        )}
      />,
    );

    // 14 rows for 10,000 items — the whole point of the primitive.
    expect(screen.getAllByTestId('vrow')).toHaveLength(14);
    expect(screen.getByText('Row 0')).toBeInTheDocument();
    expect(screen.queryByText('Row 9000')).not.toBeInTheDocument();
  });

  it('swaps the window as the container scrolls', () => {
    render(
      <VirtualList
        items={makeRows(10_000)}
        rowHeight={ROW}
        viewportHeight={VIEWPORT}
        overscan={OVERSCAN}
        label="Rows"
        renderRow={(row) => (
          <div key={row.id} role="listitem" data-testid="vrow">
            {row.label}
          </div>
        )}
      />,
    );

    scrollTo(screen.getByRole('list'), 9000 * ROW);

    expect(screen.getByText('Row 9000')).toBeInTheDocument();
    expect(screen.queryByText('Row 0')).not.toBeInTheDocument();
    // Still bounded after scrolling — no row leak.
    expect(screen.getAllByTestId('vrow').length).toBeLessThan(30);
  });

  it('renders all rows and no spacers when the list fits', () => {
    const { container } = render(
      <VirtualList
        items={makeRows(5)}
        rowHeight={ROW}
        viewportHeight={VIEWPORT}
        overscan={OVERSCAN}
        label="Rows"
        renderRow={(row) => (
          <div key={row.id} role="listitem" data-testid="vrow">
            {row.label}
          </div>
        )}
      />,
    );

    expect(screen.getAllByTestId('vrow')).toHaveLength(5);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });
});

describe('VirtualTable', () => {
  it('windows rows while keeping the table role, name and columns', () => {
    render(
      <VirtualTable
        items={makeRows(10_000)}
        rowHeight={ROW}
        viewportHeight={VIEWPORT}
        overscan={OVERSCAN}
        caption="People"
        colSpan={1}
        head={
          <thead>
            <tr>
              <th scope="col">Label</th>
            </tr>
          </thead>
        }
        renderRow={(row) => (
          <tr key={row.id} data-testid="trow">
            <td>{row.label}</td>
          </tr>
        )}
      />,
    );

    // The table keeps its accessible name (E2E reaches it by that name).
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();

    // getByRole('row') excludes the aria-hidden spacer rows: header + window only.
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeLessThan(30);
    expect(screen.getAllByTestId('trow')).toHaveLength(14);
    expect(screen.getByText('Row 0')).toBeInTheDocument();
    expect(screen.queryByText('Row 9000')).not.toBeInTheDocument();
  });

  it('reveals deep rows on scroll without leaking earlier ones', () => {
    render(
      <VirtualTable
        items={makeRows(10_000)}
        rowHeight={ROW}
        viewportHeight={VIEWPORT}
        overscan={OVERSCAN}
        caption="People"
        colSpan={1}
        head={
          <thead>
            <tr>
              <th scope="col">Label</th>
            </tr>
          </thead>
        }
        renderRow={(row) => (
          <tr key={row.id} data-testid="trow">
            <td>{row.label}</td>
          </tr>
        )}
      />,
    );

    // The table's own scroll container is the div wrapping it.
    const scroller = screen.getByRole('table').parentElement as HTMLElement;
    scrollTo(scroller, 9000 * ROW);

    expect(screen.getByText('Row 9000')).toBeInTheDocument();
    expect(screen.queryByText('Row 0')).not.toBeInTheDocument();
  });
});

describe('onEndReached', () => {
  function listOf(
    count: number,
    onEndReached: () => void,
    endReachedThreshold?: number,
  ): ReactElement {
    return (
      <VirtualList
        items={makeRows(count)}
        rowHeight={ROW}
        viewportHeight={VIEWPORT}
        overscan={OVERSCAN}
        label="Rows"
        onEndReached={onEndReached}
        {...(endReachedThreshold != null ? { endReachedThreshold } : {})}
        renderRow={(row) => (
          <div key={row.id} role="listitem" data-testid="vrow">
            {row.label}
          </div>
        )}
      />
    );
  }

  function renderList(
    count: number,
    onEndReached: () => void,
    endReachedThreshold?: number,
  ): ReturnType<typeof render> {
    return render(listOf(count, onEndReached, endReachedThreshold));
  }

  /** scrollTop that puts the very last row of `count` at the bottom edge. */
  function bottomOf(count: number): number {
    return count * ROW - VIEWPORT;
  }

  /** The scroller of one render, for tests that mount two lists side by side. */
  function scrollerOf(result: ReturnType<typeof render>): HTMLElement {
    return result.container.querySelector('[role="list"]') as HTMLElement;
  }

  it('stays quiet until the window comes within the threshold of the end', () => {
    const onEndReached = vi.fn();
    renderList(100, onEndReached);

    expect(onEndReached).not.toHaveBeenCalled();

    scrollTo(screen.getByRole('list'), bottomOf(100));
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('asks once per row count, not once per scroll event', () => {
    const onEndReached = vi.fn();
    renderList(100, onEndReached);
    const list = screen.getByRole('list');

    // Three more events, all still inside the trailing zone: the same page must
    // not be requested again just because the reader kept dragging.
    scrollTo(list, bottomOf(100));
    scrollTo(list, bottomOf(100) - ROW);
    scrollTo(list, bottomOf(100) - 2 * ROW);
    scrollTo(list, bottomOf(100));

    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('re-arms once the window leaves the trailing zone', () => {
    const onEndReached = vi.fn();
    renderList(100, onEndReached);
    const list = screen.getByRole('list');

    scrollTo(list, bottomOf(100));
    expect(onEndReached).toHaveBeenCalledTimes(1);

    scrollTo(list, 0);
    scrollTo(list, bottomOf(100));
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

  it('keeps asking until the loaded rows outgrow the viewport', () => {
    const onEndReached = vi.fn();
    const { rerender } = renderList(10, onEndReached);

    // 10 rows do not fill 400px: the whole list is the window, so the end is
    // already reached and a second page is genuinely needed.
    expect(onEndReached).toHaveBeenCalledTimes(1);

    // A page landed: 20 rows, window still ends at 14 — within 8 of the end.
    rerender(listOf(20, onEndReached));
    expect(onEndReached).toHaveBeenCalledTimes(2);

    // 30 rows finally push the end out of reach, and the chain stops on its own.
    rerender(listOf(30, onEndReached));
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

  it('honours the threshold: a wider one fires earlier', () => {
    const eager = vi.fn();
    const lazy = vi.fn();
    const eagerList = scrollerOf(renderList(100, eager, 40));
    const lazyList = scrollerOf(renderList(100, lazy));

    // Same scroll position for both: 40 rows from the end, so inside the wide
    // threshold and well outside the default 8.
    scrollTo(eagerList, 50 * ROW);
    scrollTo(lazyList, 50 * ROW);

    expect(eager).toHaveBeenCalledTimes(1);
    expect(lazy).not.toHaveBeenCalled();
  });

  it('is inert for an empty list', () => {
    const onEndReached = vi.fn();
    renderList(0, onEndReached);
    expect(onEndReached).not.toHaveBeenCalled();
  });

  it('works the same on VirtualTable', () => {
    const onEndReached = vi.fn();
    render(
      <VirtualTable
        items={makeRows(100)}
        rowHeight={ROW}
        viewportHeight={VIEWPORT}
        overscan={OVERSCAN}
        caption="People"
        colSpan={1}
        onEndReached={onEndReached}
        head={
          <thead>
            <tr>
              <th scope="col">Label</th>
            </tr>
          </thead>
        }
        renderRow={(row) => (
          <tr key={row.id} data-testid="trow">
            <td>{row.label}</td>
          </tr>
        )}
      />,
    );

    expect(onEndReached).not.toHaveBeenCalled();

    const scroller = screen.getByRole('table').parentElement as HTMLElement;
    scrollTo(scroller, bottomOf(100));
    scrollTo(scroller, bottomOf(100) - ROW);

    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});

describe('NFR-P4 budget', () => {
  it('paints a bounded node count for 10,000 rows (60fps proxy)', () => {
    const start = performance.now();
    const { container } = render(
      <VirtualList
        items={makeRows(10_000)}
        rowHeight={ROW}
        viewportHeight={VIEWPORT}
        overscan={OVERSCAN}
        label="Rows"
        renderRow={(row) => (
          <div key={row.id} role="listitem" data-testid="vrow">
            {row.label}
          </div>
        )}
      />,
    );
    const elapsed = performance.now() - start;

    const domRows = container.querySelectorAll('[data-testid="vrow"]').length;
    // Evidence for HANDOFF: with 10,000 data rows only a viewport's worth exist.
    console.log(`[NFR-P4] 10000 data rows → ${domRows} DOM rows, render ${elapsed.toFixed(1)}ms`);

    expect(domRows).toBeLessThanOrEqual(20);
  });
});
