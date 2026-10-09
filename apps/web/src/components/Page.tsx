/**
 * Shared page furniture for the non-inbox modules.
 *
 * The inbox is a 3-pane app; everything else is a scrolling document. These
 * pieces keep that second shape consistent so Reports, Team and Billing do not
 * each invent their own spacing (design-brief §4).
 */
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePageTitle } from '../lib/document-title.js';
import { Skeleton } from './Skeleton.js';

/**
 * Is this element scrolling right now? (tm 259.21 · O16)
 *
 * `Page` is the module's scroll container. When its content outgrows the
 * viewport — a phone, a long settings card — a keyboard user can only scroll it
 * if something inside takes focus; a page of plain text has nothing to Tab to
 * (axe `scrollable-region-focusable`, Compliance on mobile). The page becomes a
 * tab stop exactly while it overflows, so a page that fits adds no stop. The
 * content's own size is observed too: the container's box is fixed by the
 * layout and does not change when its children grow.
 */
function useIsScrolling(): {
  ref: RefObject<HTMLDivElement>;
  scrolling: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setScrolling(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  return { ref, scrolling };
}

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
  const { ref, scrolling } = useIsScrolling();
  return (
    <div
      ref={ref}
      // The ring is drawn inside: the shell around the page clips an outer one.
      tabIndex={scrolling ? 0 : undefined}
      // The page is the containing block of its `sr-only` labels and captions
      // (they are `position: absolute`), so one sitting far down the page
      // scrolls with it instead of lengthening the document. tm 259.25 did this
      // below the desktop breakpoint only, for the sideways case (O6); on a
      // desktop the same caption — Reports' "chats handled per agent" table —
      // still hung below the shell and the window scrolled ~220 px past the
      // console into empty canvas (2026-10-09). Every width, then.
      className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-canvas focus-visible:-outline-offset-2"
    >
      {/* Wraps rather than overflows: on a narrow window the actions (tabs, a
          search box) drop under the title instead of pushing the page sideways
          (tm 259.25 · O6). The title keeps a readable basis before they do. */}
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
  // The heading gets its own id namespace (always `-heading`-suffixed) so it can
  // never alias the caller's anchor `id`. Channels and Website widgets both pass
  // `id="section-<slug>"` — identical to the old heading id — which made
  // `aria-labelledby` resolve the section to itself: its accessible name then
  // became the whole subtree (every channel card's text, "Reply to text messages
  // over Twilio." included), so `getByLabel('Reply')` matched the section too. (tm 100)
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const headingId = `${id ?? `section-${slug}`}-heading`;
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

/**
 * The standard surface. `className` is appended, not replaced — it exists for
 * callers that have to control the card's *box* (a fixed-height grid cell needs
 * `h-full`, 09.2-v2-g) without restating the chrome and letting it drift.
 */
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-border bg-surface shadow-xs${
        className ? ` ${className}` : ''
      }`}
    >
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
