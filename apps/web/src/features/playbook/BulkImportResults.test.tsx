/**
 * BulkImportResults's contract (FR-MOD-06.3.2, EK-B.1): an empty envelope is
 * a meaningful empty state (never a bare table), a partial success warns and
 * names every skipped row by line number and reason, a full success reads as
 * success with no skipped row anywhere, a dry-run preview and a completed
 * import share the component and differ only by the caller's `title`, and a
 * file near the server's row ceiling still only paints a viewport's worth of
 * `<tr>`s.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BulkImportResults } from './BulkImportResults.js';
import type { KnowledgeBulkRowResult } from './types.js';

function row(overrides: Partial<KnowledgeBulkRowResult> = {}): KnowledgeBulkRowResult {
  return {
    line: 2,
    name: 'Return policy',
    type: 'article',
    status: 'imported',
    id: 'src-1',
    chunk_count: 3,
    error: null,
    ...overrides,
  };
}

describe('BulkImportResults', () => {
  it('shows a meaningful empty state for zero rows, not a bare table', () => {
    render(<BulkImportResults title="Preview" imported={0} failed={0} results={[]} />);

    expect(screen.getByText('Nothing to show yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('warns on partial success and lists every skipped row by line number and reason', () => {
    const results = [
      row({ line: 2, name: 'Return policy', status: 'imported' }),
      row({
        line: 3,
        name: null,
        type: null,
        status: 'skipped',
        id: null,
        chunk_count: null,
        error: 'type: must be one of website, file, article, faq.',
      }),
    ];
    render(<BulkImportResults title="Preview" imported={1} failed={1} results={results} />);

    expect(screen.getByRole('status')).toHaveTextContent('1 imported · 1 skipped');
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(
      screen.getByText('type: must be one of website, file, article, faq.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('reads as success with no skipped row anywhere on a full success', () => {
    const results = [row({ line: 2 }), row({ line: 3, name: 'Shipping FAQ' })];
    render(<BulkImportResults title="Preview" imported={2} failed={0} results={results} />);

    expect(screen.getByText('2 imported · 0 skipped')).toBeInTheDocument();
    expect(screen.queryByText('Skipped')).not.toBeInTheDocument();
  });

  it('renders a dry-run preview and a completed import with the same component, different title', () => {
    const results = [row({ line: 2 })];
    const { rerender } = render(
      <BulkImportResults title="Preview" imported={1} failed={0} results={results} />,
    );
    // Both the Banner heading and the table's sr-only caption carry the title,
    // so "Preview" legitimately appears twice — scope to the visible Banner.
    expect(within(screen.getByRole('status')).getByText('Preview')).toBeInTheDocument();
    expect(screen.queryByText('Import complete')).not.toBeInTheDocument();

    rerender(<BulkImportResults title="Import complete" imported={1} failed={0} results={results} />);
    expect(within(screen.getByRole('status')).getByText('Import complete')).toBeInTheDocument();
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
  });

  it('keeps only a viewport worth of rows in the DOM near the 200-row server ceiling', () => {
    const results = Array.from({ length: 200 }, (_, i) =>
      row({ line: i + 2, name: `Row ${i}` }),
    );
    render(<BulkImportResults title="Preview" imported={200} failed={0} results={results} />);

    const rendered = screen.getAllByRole('row');
    // Header row + a windowed slice — nowhere near all 200 data rows.
    expect(rendered.length).toBeLessThan(60);
    expect(screen.getByText('Row 0')).toBeInTheDocument();
    expect(screen.queryByText('Row 199')).not.toBeInTheDocument();
  });
});
