/**
 * The frame every Security section shares (tm 389.16): a heading, a card, and the three states a
 * read can be in — loading, failed (with a retry) and answered. A section that fails says so in
 * its own card; the others carry on, the way the Operations page's do.
 */
import type { ReactElement, ReactNode } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { formatCount } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformCounted } from '../../lib/platform-types.js';
import { Cell, DataTable, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';

export function Section({
  id,
  title,
  actions,
  query,
  hasData,
  children,
}: {
  id: string;
  title: string;
  /** Beside the heading — shown once there is something to act on. */
  actions?: ReactNode;
  query: { isError: boolean; error: unknown; refetch: () => unknown };
  hasData: boolean;
  children: ReactNode;
}): ReactElement {
  const t = useTranslate();
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {hasData && actions}
      </div>
      <Card>
        {query.isError ? (
          <LoadError
            title={t('security.loadError.title')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : !hasData ? (
          <p role="status" className="p-4 text-sm text-content-secondary">
            {t('security.loading')}
          </p>
        ) : (
          children
        )}
      </Card>
    </section>
  );
}

/** A figure and its label, for the small count grids. */
export function Figures({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}): ReactElement {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-content-secondary">{item.label}</dt>
          <dd className="tabular mt-0.5 break-words text-lg font-semibold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A small keyed tally — an address or a licence number and how many. */
export function CountTable({
  caption,
  keyHeader,
  rows,
  empty,
  keyLabel,
}: {
  caption: string;
  keyHeader: string;
  rows: PlatformCounted[];
  empty: string;
  keyLabel?: (key: string) => ReactNode;
}): ReactElement {
  const t = useTranslate();
  if (rows.length === 0) {
    return <p className="px-4 pb-4 text-sm text-content-secondary">{empty}</p>;
  }
  return (
    <DataTable caption={caption} headers={[keyHeader, t('security.col.count')]}>
      {rows.map((row) => (
        <tr key={row.key}>
          <Cell>{keyLabel ? keyLabel(row.key) : <code className="text-xs">{row.key}</code>}</Cell>
          <Cell>{formatCount(row.count)}</Cell>
        </tr>
      ))}
    </DataTable>
  );
}

/** "Load more" under a keyset-paged list. */
export function LoadMore({
  visible,
  pending,
  onClick,
}: {
  visible: boolean;
  pending: boolean;
  onClick: () => void;
}): ReactElement | null {
  const t = useTranslate();
  if (!visible) return null;
  return (
    <div className="border-t border-border p-3">
      <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={pending} onClick={onClick}>
        {t('security.loadMore')}
      </button>
    </div>
  );
}

/** The span picker the counters share: a few fixed spans, the chosen one pressed. */
export function SpanPicker({
  label,
  spans,
  value,
  onChange,
  format,
}: {
  label: string;
  spans: readonly number[];
  value: number;
  onChange: (span: number) => void;
  format: (span: number) => string;
}): ReactElement {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {spans.map((span) => (
        <button
          key={span}
          type="button"
          aria-pressed={span === value}
          onClick={() => onChange(span)}
          className={`rounded-md border px-2.5 py-1 text-xs ${
            span === value
              ? 'border-brand-600 bg-surface-2 font-medium'
              : 'border-border text-content-secondary hover:bg-surface-2'
          }`}
        >
          {format(span)}
        </button>
      ))}
    </div>
  );
}
