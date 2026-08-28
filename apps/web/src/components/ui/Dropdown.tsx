/**
 * Dropdown — a hover/click menu built on `<details>` (FR-EK-C.2).
 *
 * The account menu worked out the hard parts once: a `<summary>` announced as a
 * button with its expanded state, Escape that closes and hands focus back to the
 * trigger, an outside click that dismisses, and — the bug that shipped once — a
 * panel hidden with `display` (`hidden group-open:block`) rather than trusting
 * the browser to hide a closed `<details>`'s children, which does not hold once
 * the panel is absolutely positioned. This is that behaviour, extracted so every
 * menu in the app shares it instead of re-deriving it (and re-introducing the
 * bug).
 *
 * `children` is a render prop given a `close` so an item can dismiss the menu
 * after acting. The panel `<div>` wraps those children directly, so a consumer's
 * element is a direct child of the element carrying `hidden group-open:block`.
 *
 * Once open, ArrowDown/ArrowUp/Home/End rove focus across the panel's items
 * (buttons, links, options) the way a native menu would — but only when focus
 * is already on the trigger or inside the panel, and never when it is on a
 * text-entry control (a saved-view name field, say), whose own Home/End move a
 * text cursor rather than the menu selection.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn.js';

const ITEM_SELECTOR = 'button:not([disabled]), a[href], [role="menuitem"], [role="option"]';
const ROVING_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

function isTextEntry(element: Element): boolean {
  const tag = element.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (element as HTMLElement).isContentEditable
  );
}

interface DropdownProps {
  /** Accessible name for the trigger — the menu is often icon-only. */
  label: string;
  /** Trigger content (initials, an icon, a label). */
  trigger: ReactNode;
  /** Classes for the `<summary>` trigger. */
  triggerClassName?: string;
  /** Native tooltip on the trigger. */
  triggerTitle?: string;
  /** Panel content; receives `close` to dismiss from within. */
  children: (helpers: { close: (returnFocus?: boolean) => void }) => ReactNode;
  /** Layout for the panel (position, width, padding). */
  panelClassName?: string;
  className?: string;
}

export function Dropdown({
  label,
  trigger,
  triggerClassName,
  triggerTitle,
  children,
  panelClassName,
  className,
}: DropdownProps): ReactElement {
  const ref = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = (returnFocus = false): void => {
    const details = ref.current;
    if (!details?.open) return;
    details.open = false;
    setOpen(false);
    if (returnFocus) details.querySelector('summary')?.focus();
  };

  // Escape closes it and returns focus to the trigger, as a menu should.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // A click anywhere outside dismisses, rather than leaving a stray panel open
  // over whatever the person moved on to.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const details = ref.current;
      if (!details?.open) return;
      if (event.target instanceof Node && details.contains(event.target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // Rove focus across the panel's items with the arrow keys and Home/End,
  // same as a native menu — but only while open, and only when focus is
  // already on the trigger or somewhere inside the panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!ROVING_KEYS.has(event.key)) return;
      const details = ref.current;
      const panel = panelRef.current;
      if (!details?.open || !panel) return;

      const active = document.activeElement;
      const summary = details.querySelector('summary');
      const withinPanel = active instanceof Node && panel.contains(active);
      if (active !== summary && !withinPanel) return;
      if (active instanceof Element && isTextEntry(active)) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
      if (items.length === 0) return;
      event.preventDefault();

      const currentIndex = active instanceof HTMLElement ? items.indexOf(active) : -1;
      let nextIndex: number;
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = items.length - 1;
      else if (event.key === 'ArrowDown')
        nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      else nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;

      items[nextIndex]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <details
      ref={ref}
      className={cn('group relative', className)}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        // A bare `<summary>` is announced as a plain grouping element — it states
        // neither that it opens something nor whether it is currently open.
        role="button"
        aria-expanded={open}
        aria-label={label}
        title={triggerTitle}
        className={cn('cursor-pointer list-none marker:content-none', triggerClassName)}
      >
        {trigger}
      </summary>

      <div
        ref={panelRef}
        className={cn(
          'absolute z-20 hidden rounded-lg border border-border bg-surface shadow-md group-open:block',
          panelClassName,
        )}
      >
        {children({ close })}
      </div>
    </details>
  );
}
