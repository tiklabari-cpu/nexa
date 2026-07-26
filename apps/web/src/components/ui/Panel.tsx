/**
 * Panel — a persistent side panel and its collapsible sections (FR-EK-C.2).
 *
 * The inbox details pane and the customer detail pane are the same shape: an
 * `<aside>` with an accessible name, a fixed-height header carrying a title and
 * an optional collapse control, and a stack of collapsible sections below. Each
 * had spelled that out itself. This is the shared frame — the caller supplies
 * width and borders through `className` so one panel can sit on the left and
 * another on the right, but the header, the collapse affordance and the section
 * rhythm come from here.
 */
import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn.js';

interface PanelProps {
  /** Accessible name for the region. */
  label: string;
  /** Visible header title. */
  title: ReactNode;
  children: ReactNode;
  /** When present, the header shows a control that hides the panel. */
  onCollapse?: () => void;
  collapseLabel?: string;
  /** Header control(s) shown before the collapse affordance. */
  headerAction?: ReactNode;
  /** Width, borders, overflow — whatever places this panel in its layout. */
  className?: string;
}

export function Panel({
  label,
  title,
  children,
  onCollapse,
  collapseLabel = 'Collapse panel',
  headerAction,
  className,
}: PanelProps): ReactElement {
  return (
    <aside aria-label={label} className={cn('flex flex-col bg-surface', className)}>
      <header className="flex h-topbar items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {(headerAction || onCollapse) && (
          <div className="flex items-center gap-1">
            {headerAction}
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label={collapseLabel}
                className="rounded-md p-1 text-content-tertiary hover:bg-surface-2 hover:text-content"
              >
                <span aria-hidden="true">⇥</span>
              </button>
            )}
          </div>
        )}
      </header>
      {children}
    </aside>
  );
}

/**
 * One collapsible section inside a Panel. Open by default — an agent working a
 * queue collapses the ones they are not reading; the panel does not decide for
 * them.
 */
export function PanelSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}): ReactElement {
  return (
    <details {...(defaultOpen ? { open: true } : {})} className="border-b border-border">
      <summary className="cursor-pointer px-4 py-3 text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
        {title}
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-4">{children}</div>
    </details>
  );
}
