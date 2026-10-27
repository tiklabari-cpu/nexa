/**
 * The frame every Operations section shares (tm 389.14): a heading, a card, and the three states
 * a read can be in — loading, failed (with a retry) and answered. A section that fails says so
 * in its own card; the others carry on, the way the dashboard's do.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';

export function QuerySection<T>({
  id,
  title,
  query,
  actions,
  children,
}: {
  id: string;
  title: string;
  query: UseQueryResult<T>;
  /** Buttons beside the heading — shown once there is something to act on. */
  actions?: ReactNode;
  children: (data: T) => ReactNode;
}): ReactElement {
  const t = useTranslate();
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {query.data !== undefined && actions}
      </div>
      <Card>
        {query.isError ? (
          <LoadError
            title={t('operations.loadError.title')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : query.data === undefined ? (
          <p role="status" className="p-4 text-sm text-content-secondary">
            {t('operations.loading')}
          </p>
        ) : (
          children(query.data)
        )}
      </Card>
    </section>
  );
}

/** A figure and its label, for the small count grids (webhooks, SIEM, sign-ups). */
export function Figures({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}): ReactElement {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-content-secondary">{item.label}</dt>
          <dd className="tabular mt-0.5 break-words text-lg font-semibold">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Bytes as KB / MB / GB — units that read the same in every language. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
