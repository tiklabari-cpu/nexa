/**
 * Banner — the one page-level notice (FR-EK-C.2).
 *
 * Trial countdowns, read-only warnings, "this ticket was merged" notes: the app
 * had grown a different hand-rolled `<div role="status">` for each, with its own
 * padding, its own idea of where the action sits, and — where it mattered most —
 * no shared, persistent way to dismiss one. This is the single abstraction they
 * share. A `tone` picks the segment (info / success / warning / danger / brand /
 * neutral), the colour never carries meaning alone (design-brief §3) so each
 * tone pairs with an icon, and an optional `cta` keeps the action in a
 * consistent place.
 *
 * Dismissal is the part that had been missing. A `dismissible` banner with a
 * stable `id` remembers being closed across reloads through `localStorage`, so a
 * notice a person has acknowledged does not reappear on every navigation. Drop
 * the `id` for a dismiss that lasts only the session, and if storage is
 * unavailable the banner still closes — it simply forgets by the next load
 * rather than throwing.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { useTranslate } from '../../lib/i18n.js';
import { cn } from './cn.js';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger' | 'brand' | 'neutral';

interface ToneStyle {
  container: string;
  icon: string;
  glyph: string;
  defaultRole: 'status' | 'alert';
}

const TONES: Record<BannerTone, ToneStyle> = {
  info: {
    container: 'border-info/30 bg-info/10',
    icon: 'text-info',
    glyph: 'ℹ',
    defaultRole: 'status',
  },
  success: {
    container: 'border-success/30 bg-success/10',
    icon: 'text-success',
    glyph: '✓',
    defaultRole: 'status',
  },
  warning: {
    container: 'border-warning/30 bg-warning/10',
    icon: 'text-warning',
    glyph: '⚠',
    defaultRole: 'status',
  },
  danger: {
    container: 'border-danger/30 bg-danger/10',
    icon: 'text-danger',
    glyph: '⚠',
    defaultRole: 'alert',
  },
  brand: {
    container: 'border-brand-500/30 bg-brand-500/10',
    icon: 'text-content-brand',
    glyph: '◈',
    defaultRole: 'status',
  },
  neutral: {
    container: 'border-border bg-surface-2',
    icon: 'text-content-tertiary',
    glyph: '•',
    defaultRole: 'status',
  },
};

const STORE_PREFIX = 'nexa.banner.dismissed.';

/** The `localStorage` key a persistent dismissal is remembered under. */
export function bannerDismissKey(id: string): string {
  return `${STORE_PREFIX}${id}`;
}

function readDismissed(id: string | undefined): boolean {
  if (!id || typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(bannerDismissKey(id)) === '1';
  } catch {
    // Storage blocked (private mode, disabled cookies): treat as not dismissed.
    return false;
  }
}

function persistDismissed(id: string): void {
  try {
    localStorage.setItem(bannerDismissKey(id), '1');
  } catch {
    // Storage unavailable — the dismiss still holds for this session via state.
  }
}

interface BannerProps {
  /** Segment: chooses colour + icon. Colour never stands alone (design-brief §3). */
  tone?: BannerTone;
  /** Optional bold lead line above the message. */
  title?: ReactNode;
  children: ReactNode;
  /** Action(s) shown at the trailing edge — a link, a button, a small cluster. */
  cta?: ReactNode;
  /** Show the dismiss control. */
  dismissible?: boolean;
  /**
   * Stable identifier. When present, a dismissal is remembered across reloads;
   * omit it for a dismiss that only lasts the current session.
   */
  id?: string;
  onDismiss?: () => void;
  /** Overrides the tone's default (`alert` for danger, `status` otherwise). */
  role?: 'status' | 'alert';
  /** Replace the tone glyph, or pass `false` to omit the icon. */
  icon?: ReactNode | false;
  /** Accessible name for the dismiss control; defaults to the catalogue's "Dismiss". */
  dismissLabel?: string;
  className?: string;
}

export function Banner({
  tone = 'info',
  title,
  children,
  cta,
  dismissible = false,
  id,
  onDismiss,
  role,
  icon,
  dismissLabel,
  className,
}: BannerProps): ReactElement | null {
  const t = useTranslate();
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed(id));
  const style = TONES[tone];

  if (dismissed) return null;

  const dismiss = (): void => {
    setDismissed(true);
    if (id) persistDismissed(id);
    onDismiss?.();
  };

  return (
    <div
      role={role ?? style.defaultRole}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm text-content',
        style.container,
        className,
      )}
    >
      {icon !== false && (
        <span aria-hidden="true" className={cn('mt-0.5 shrink-0 leading-5', style.icon)}>
          {icon ?? style.glyph}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        <div className={cn('text-content-secondary', title ? 'mt-0.5' : undefined)}>{children}</div>
      </div>

      {cta && <div className="flex shrink-0 items-center gap-2">{cta}</div>}

      {dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={dismissLabel ?? t('common.actions.dismiss')}
          className="-mr-1 shrink-0 rounded-md p-1 text-content-tertiary hover:bg-black/5 hover:text-content dark:hover:bg-white/10"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
