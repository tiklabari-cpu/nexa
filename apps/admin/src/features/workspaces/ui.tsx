/**
 * The small pieces the workspace pages share (tm 389.9): field and button styles, a
 * definition list, a table shell and the "nothing here" line, so eleven tabs do not each
 * invent their own spacing.
 */
import type { ReactElement, ReactNode } from 'react';

export const FIELD_CLASS =
  'mt-1 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm';
export const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50';
export const SECONDARY_BUTTON_CLASS =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
export const LINK_CLASS = 'font-medium text-content-brand underline underline-offset-2';

/** Label/value pairs; a missing value shows as an em dash rather than an empty cell. */
export function Facts({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}): ReactElement {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-content-secondary">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: string[];
  children: ReactNode;
}): ReactElement {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border text-xs text-content-secondary">
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="px-4 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({ children }: { children: ReactNode }): ReactElement {
  return <td className="px-4 py-2 align-top">{children ?? '—'}</td>;
}

export function EmptyLine({ children }: { children: string }): ReactElement {
  return <p className="p-4 text-sm text-content-secondary">{children}</p>;
}

export function Loading({ label }: { label: string }): ReactElement {
  return (
    <p role="status" className="p-4 text-sm text-content-secondary">
      {label}
    </p>
  );
}
