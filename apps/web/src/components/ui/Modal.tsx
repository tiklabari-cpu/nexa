/**
 * Modal — the one dialog overlay (FR-EK-C.2).
 *
 * Every modal in the app had hand-rolled the same overlay: `role="dialog"`,
 * `aria-modal`, a darkened backdrop. What they did *not* share was behaviour.
 * Some closed on Escape and a backdrop click; the invite dialog closed on
 * neither. Focus went unmanaged. This gives all of them one consistent
 * dismissal contract:
 *
 * - Escape and a backdrop click both call `onClose`. A mousedown that starts on
 *   the panel is stopped, so a drag that ends outside is not read as a dismiss.
 * - `onClose` is the single close path, so a caller can route it through the
 *   shared dirty guard and have Escape, the backdrop and its own Cancel button
 *   all ask before discarding — one gate, every exit.
 * - Focus moves into the dialog on open unless the content already claimed it
 *   (an `autoFocus`ed field keeps it), and returns to the trigger on close.
 * - Tab is trapped inside the panel: it cycles through the panel's own
 *   focusable elements rather than escaping to the page behind the backdrop.
 */
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn.js';

// Elements a Tab press can land on. `[tabindex]:not([tabindex="-1"])` picks up
// anything a caller made focusable without an intervening element; the panel
// itself carries `tabindex="-1"` (focus target, not a Tab stop) so it is
// deliberately excluded here rather than matched and filtered out.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface ModalProps {
  onClose: () => void;
  /** Visible heading; also names the dialog for assistive tech. */
  title?: ReactNode;
  /** Accessible name when there is no visible title. */
  label?: string;
  /** Optional line under the title. */
  description?: ReactNode;
  children: ReactNode;
  /** Classes for the dialog panel (width, etc.). */
  className?: string;
  /** Vertically centre (default) or pin near the top for long, list-like content. */
  align?: 'center' | 'top';
}

export function Modal({
  onClose,
  title,
  label,
  description,
  children,
  className,
  align = 'center',
}: ModalProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useId();

  // Escape is a dismissal path like any other — routed through the same
  // `onClose` so a dirty guard covers it too. Tab is trapped in the same
  // handler: cycling past either end of the panel's focusable elements wraps
  // back around instead of reaching the page behind the backdrop.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        // Nothing to cycle through — keep focus pinned on the panel itself.
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Move focus into the dialog on open, but never steal it from content that
  // already asked for it (an `autoFocus`ed input). Hand it back on close.
  useEffect(() => {
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      panel.focus();
    }
    return () => returnFocusRef.current?.focus?.();
  }, []);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-black/40 p-6',
        align === 'top' ? 'items-start pt-[12vh]' : 'items-center',
      )}
      // A mousedown on the backdrop dismisses; stopped on the panel so a drag
      // ending outside is not counted as a dismiss.
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : label}
        aria-labelledby={title ? headingId : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          'w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-md outline-none',
          className,
        )}
      >
        {title && (
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
        )}
        {description && <p className="mt-1 text-xs text-content-secondary">{description}</p>}
        {(title || description) && <div className="mt-4" />}
        {children}
      </div>
    </div>
  );
}
