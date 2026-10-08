import type { ReactElement } from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const GLYPH: Record<StatusTone, string> = {
  success: '●',
  warning: '◐',
  danger: '○',
  info: 'ⓘ',
  neutral: '·',
};

const COLOUR: Record<StatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-content-tertiary',
};

/**
 * Status shown as glyph **and** text, not colour alone (NFR-A11Y2).
 *
 * Colour-only status fails colour-blind users, and it also fails everyone else
 * on a washed-out screen or at a glance — which is exactly when an agent checks
 * whether their inbox is still live.
 */
export function StatusDot({
  tone,
  label,
  compact = false,
}: {
  tone: StatusTone;
  label: string;
  /** Glyph only on screen, the word kept for a screen reader — for a header with no room. */
  compact?: boolean;
}): ReactElement {
  return (
    <span className={`inline-flex items-center gap-1.5 text-2xs font-medium ${COLOUR[tone]}`}>
      <span aria-hidden="true">{GLYPH[tone]}</span>
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}
