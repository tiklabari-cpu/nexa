/**
 * One row of the timeline (ID-09 · tm 334.2): when (the workspace's clock, UTC on
 * hover), what kind, who, and what — the AI's decisions with the procedure, the
 * knowledge it read and the hand-over reason beside the decision — and the row's
 * own fields behind "Details". Everything is plain text in the page, so the
 * browser's find reaches it.
 */
import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import type { TimelineItem } from '@siyahtus/types';
import { type TFunction, useTranslate } from '../../lib/i18n.js';
import { actionLabel } from '../audit/audit-labels.js';
import {
  aiFacets,
  detailString,
  detailsJson,
  formatRowTime,
  isProcedureRun,
  rowClipboardLine,
  slaNumbers,
  utcTooltip,
} from './timeline.js';

/** How long "Copied" stays up. */
const FEEDBACK_MS = 1_500;

/** Who the row is from, as a name: the author's, else what kind of author it is. */
export function actorLabel(t: TFunction, item: TimelineItem): string {
  return item.actor.name ?? t(`timeline.actor.${item.actor.type}`);
}

/** The row's sentence. Rows from the server carry English text; the ones with fields behind them are said in the panel's language. */
export function rowBody(t: TFunction, item: TimelineItem): string {
  if (item.kind === 'ai_decision') {
    if (isProcedureRun(item)) {
      return t('timeline.ai.run', {
        name: detailString(item, 'skill_name') ?? '',
        status: detailString(item, 'status') ?? '',
      });
    }
    return detailString(item, 'decision') ?? t('timeline.kind.ai_decision');
  }
  if (item.kind === 'assignment') {
    const action = detailString(item, 'action');
    if (action === 'assigned') return t('timeline.assignment.assigned');
    if (action === 'queued') return t('timeline.assignment.queued');
    if (action === 'left_queue') {
      return t('timeline.assignment.leftQueue', {
        outcome: detailString(item, 'outcome') ?? t('timeline.assignment.unknownOutcome'),
      });
    }
  }
  if (item.kind === 'sla_breach') {
    const sla = slaNumbers(item);
    if (sla) {
      return t('timeline.sla', { target: sla.target, elapsed: sla.elapsed, limit: sla.limit });
    }
  }
  if (item.kind === 'audit') return actionLabel(t, item.text ?? detailString(item, 'action') ?? '');
  if (item.text) return item.text;
  if (detailString(item, 'attachment_url')) return t('timeline.attachment');
  return '';
}

function TimelineRowView({
  item,
  zone,
  locale,
}: {
  item: TimelineItem;
  zone: string;
  locale: string | undefined;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const actor = actorLabel(t, item);
  const body = rowBody(t, item);
  const facets = item.kind === 'ai_decision' && !isProcedureRun(item) ? aiFacets(item) : [];

  const copy = (): void => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    void clipboard?.writeText(rowClipboardLine(item, actor)).then(
      () => {
        setCopied(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), FEEDBACK_MS);
      },
      () => undefined,
    );
  };

  return (
    <li
      data-kind={item.kind}
      className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-xs"
    >
      <time
        dateTime={item.at}
        title={utcTooltip(item.at)}
        className="tabular w-44 shrink-0 text-content-secondary"
      >
        {formatRowTime(item.at, zone, locale)}
      </time>
      <span className="w-28 shrink-0">
        <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
          {t(`timeline.kind.${item.kind}`)}
        </span>
      </span>
      <span
        title={item.actor.id ?? undefined}
        className="w-32 shrink-0 truncate text-content-secondary"
      >
        {actor}
      </span>
      <div className="min-w-0 flex-1 basis-64">
        <p className={`whitespace-pre-wrap break-words ${item.kind === 'note' ? 'italic' : ''}`}>
          {body}
        </p>
        {facets.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-content-secondary">
            {facets.map((facet) => (
              <li key={facet.key}>{t(`timeline.ai.${facet.key}`, facet.values)}</li>
            ))}
          </ul>
        )}
        <details className="mt-1">
          <summary className="cursor-pointer text-2xs text-content-tertiary">
            {t('timeline.row.details')}
          </summary>
          <pre
            tabIndex={0}
            className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-inset p-2 text-2xs"
          >
            {detailsJson(item)}
          </pre>
        </details>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? t('timeline.row.copied') : t('timeline.row.copy')}
        title={copied ? t('timeline.row.copied') : t('timeline.row.copy')}
        className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 text-content-tertiary hover:bg-surface-2 hover:text-content"
      >
        <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      </button>
    </li>
  );
}

/** Rows are immutable once loaded; a long list must not re-render every row on each keystroke of the filter. */
export const TimelineRow = memo(TimelineRowView);
