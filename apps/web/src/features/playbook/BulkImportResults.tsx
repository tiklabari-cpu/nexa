/**
 * Bulk import results (FR-MOD-06.3.2, EK-B.1 empty state).
 *
 * `KnowledgeBulkResult` — whether it came back from a dry run or a real
 * import — becomes one row-by-row table here: line number, the title/type the
 * row read as, a status badge, and (for a skipped row) why. The two calls
 * that produce this envelope (`dry_run: true` vs `false`, bulk-c) differ only
 * in whether anything was actually written, so one component renders both;
 * `BulkImportForm` supplies the `title` that says which. A CSV with zero data
 * rows returns an empty `results` array — that is `EmptyState`'s job, not a
 * table with a header and no `<tr>`s. The row list sits on `VirtualTable`
 * (EK-B.1) so a file near the server's row ceiling never paints one DOM node
 * per row.
 */
import type { ReactElement } from 'react';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Banner } from '../../components/ui/Banner.js';
import { VirtualTable } from '../../components/VirtualList.js';
import type { KnowledgeBulkRowResult } from './types.js';

const ROW_HEIGHT = 40;

export function BulkImportResults({
  title,
  imported,
  failed,
  results,
}: {
  /** What produced this envelope, e.g. "Preview" vs "Import complete" — the one thing that differs between a dry run and a real import (bulk-f scope). */
  title: string;
  imported: number;
  failed: number;
  results: KnowledgeBulkRowResult[];
}): ReactElement {
  if (results.length === 0) {
    return (
      <EmptyState
        title="Nothing to show yet"
        description="Pick a CSV file with at least one data row to see its rows here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Banner tone={failed > 0 ? 'warning' : 'success'} title={title}>
        {imported} imported · {failed} skipped
      </Banner>

      <VirtualTable
        items={results}
        rowHeight={ROW_HEIGHT}
        caption={title}
        colSpan={5}
        head={
          <thead>
            <tr className="border-b border-border text-left">
              <Th align="right">Row</Th>
              <Th>Title</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Reason</Th>
            </tr>
          </thead>
        }
        renderRow={(row) => (
          <tr key={row.line} className="border-b border-border last:border-0">
            <td className="tabular px-4 py-2 text-right text-content-secondary">{row.line}</td>
            <td className="px-4 py-2">{row.name ?? '—'}</td>
            <td className="px-4 py-2 text-content-secondary">{row.type ?? '—'}</td>
            <td className="px-4 py-2">
              <StatusDot
                tone={row.status === 'imported' ? 'success' : 'warning'}
                label={row.status === 'imported' ? 'Imported' : 'Skipped'}
              />
            </td>
            <td className="px-4 py-2 text-content-secondary">{row.error ?? '—'}</td>
          </tr>
        )}
      />
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: string;
  align?: 'left' | 'right';
}): ReactElement {
  return (
    <th
      scope="col"
      className={`px-4 py-2 text-xs font-medium text-content-secondary ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}
