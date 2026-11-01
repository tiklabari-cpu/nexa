/**
 * The "vs the previous window" annotations the report tabs put under a figure
 * (FR-MOD-07.3.1) — shared by the Reports page and the queue tabs (RP-04).
 */
import type { ReactElement } from 'react';
import { formatCount, formatDuration, formatRate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';

/**
 * The change from the previous equal-length window (FR-MOD-07.3.1). Neutral by
 * design: an arrow and the magnitude, with no green/red judgement — "up" is good
 * for resolutions and bad for negative ratings, so colour here would mislead. The
 * baseline itself stays on the card, this only annotates the movement. Renders
 * nothing when either side is unknown, so an empty window shows no phantom delta.
 */
export function Delta({
  current,
  previous,
  format,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  format: (value: number | null | undefined) => string | null;
}): ReactElement | null {
  const t = useTranslate();
  if (current == null || previous == null) return null;
  const diff = Math.round((current - previous) * 1000) / 1000;
  if (diff === 0) {
    return (
      <span className="text-2xs text-content-tertiary">{t('reports.common.delta.noChange')}</span>
    );
  }
  return (
    <span className="text-2xs text-content-tertiary" title={t('reports.common.delta.tooltip')}>
      {diff > 0 ? '↑' : '↓'}{' '}
      {t('reports.common.delta.suffix', { value: format(Math.abs(diff)) ?? '' })}
    </span>
  );
}

export function CountDelta(props: {
  current: number | null;
  previous: number | null;
}): ReactElement | null {
  return <Delta {...props} format={formatCount} />;
}

export function DurationDelta(props: {
  current: number | null;
  previous: number | null;
}): ReactElement | null {
  return <Delta {...props} format={formatDuration} />;
}

export function RateDelta(props: {
  current: number | null;
  previous: number | null;
}): ReactElement | null {
  return <Delta {...props} format={formatRate} />;
}
