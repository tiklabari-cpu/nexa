/**
 * Shared page furniture for the non-inbox modules.
 *
 * The inbox is a 3-pane app; everything else is a scrolling document. These
 * pieces keep that second shape consistent so Reports, Team and Billing do not
 * each invent their own spacing (design-brief §4).
 */
import type { ReactElement, ReactNode } from 'react';
import { Skeleton } from './Skeleton.js';

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
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-canvas">
      <header className="flex min-h-topbar shrink-0 items-center gap-4 border-b border-border bg-surface px-6 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {description && <p className="truncate text-xs text-content-secondary">{description}</p>}
        </div>
        {actions}
      </header>

      <div className="flex flex-col gap-6 p-6">{children}</div>
    </div>
  );
}

export function Section({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  /** Optional anchor target, for in-page links such as "Customize widget". */
  id?: string;
}): ReactElement {
  const headingId = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section id={id} aria-labelledby={headingId} className="flex flex-col gap-3">
      <div>
        <h2 id={headingId} className="text-sm font-semibold">
          {title}
        </h2>
        {description && <p className="text-xs text-content-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xs">
      {children}
    </div>
  );
}

/**
 * A single headline number.
 *
 * `value` is deliberately `string | null` rather than a number: several metrics
 * are genuinely unknown rather than zero (an unrated period, a window in which
 * nothing closed), and the caller decides which. Rendering `null` as "—" keeps
 * "no data" visually distinct from "zero", which are different facts.
 */
export function Kpi({
  label,
  value,
  hint,
  delta,
  tone = 'neutral',
}: {
  label: string;
  value: string | null;
  hint?: string;
  /**
   * Optional change-since-previous line, rendered under the value. A node rather
   * than a string so a caller can colour or annotate it (Reports' vs-previous
   * badge); omit it and the card looks exactly as it did before.
   */
  delta?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn';
}): ReactElement {
  const valueColour =
    tone === 'good' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-content';

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </span>
      <span className={`tabular text-2xl font-bold ${valueColour}`}>
        {value ?? <span className="text-content-tertiary">—</span>}
      </span>
      {delta}
      {hint && <span className="text-2xs text-content-tertiary">{hint}</span>}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">{children}</div>
  );
}

/** Loading placeholder matching the height of what replaces it, to avoid jump. */
export function CardSkeleton({ rows = 3 }: { rows?: number }): ReactElement {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse rounded-lg border border-border bg-surface p-4"
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={`${90 - i * 15}%`} className="mb-2 last:mb-0" />
      ))}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }): ReactElement {
  return (
    <div role="alert" className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-danger">{message}</p>
    </div>
  );
}
