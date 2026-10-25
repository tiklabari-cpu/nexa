/**
 * Shared page furniture for the root panel's pages (tm 389.6).
 *
 * Every page the later subtasks add is a scrolling document under the shell: a title bar and
 * a stack of cards. These keep that shape consistent so Workspaces, Billing and Audit do not
 * each invent their own spacing.
 */
import type { ReactElement, ReactNode } from 'react';
import { usePageTitle } from '../lib/document-title.js';

export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  usePageTitle(title);
  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-canvas">
      {/* Wraps rather than overflows: on a narrow window the actions drop under the title. */}
      <header className="flex min-h-topbar shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-6 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {description && <p className="truncate text-xs text-content-secondary">{description}</p>}
        </div>
        {actions}
      </header>

      <div className="flex flex-col gap-6 p-6">{children}</div>
    </div>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={`rounded-lg border border-border bg-surface shadow-xs ${className}`}>
      {children}
    </div>
  );
}
