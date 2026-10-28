/**
 * The conversation under review (tm 319.3 · AI-24): the masked excerpt the
 * queue kept when the connection was queued — the AI's part and the first
 * human messages after a hand-over. A responsible-gaming conversation's text
 * is the Responsible Gaming team's and the administrators': anyone else gets
 * the messages with their texts emptied, and this says so instead of drawing
 * empty bubbles.
 *
 * `highlighted` is the pre-score's evidence the reviewer asked to see.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { Banner } from '../../../components/ui/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { useTranslate } from '../../../lib/i18n.js';
import type { QaExcerptMessage } from './qa.js';

export function QaExcerpt({
  excerpt,
  restricted,
  highlighted = null,
}: {
  excerpt: readonly QaExcerptMessage[];
  restricted: boolean;
  highlighted?: string | null;
}): ReactElement {
  const t = useTranslate();
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!highlighted) return;
    const rows = Array.from(list.current?.children ?? []) as HTMLElement[];
    const row = rows.find((element) => element.dataset['eventId'] === highlighted);
    // jsdom draws no layout and has no `scrollIntoView`.
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  if (excerpt.length === 0) {
    return <p className="text-xs text-content-tertiary">{t('reports.qa.excerpt.empty')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {restricted && (
        <Banner tone="warning" title={t('reports.qa.excerpt.restrictedTitle')}>
          {t('reports.qa.excerpt.restrictedBody')}
        </Banner>
      )}
      <ol ref={list} className="flex flex-col gap-1.5">
        {excerpt.map((message) => {
          const marked = message.event_id === highlighted;
          return (
            <li
              key={message.event_id}
              data-event-id={message.event_id}
              data-highlighted={marked ? 'true' : undefined}
              className={`rounded-md border px-2.5 py-1.5 text-xs ${
                marked ? 'border-brand-500 bg-brand-500/10' : 'border-border'
              }`}
            >
              <span className="mr-1.5 font-medium">
                {message.is_ai
                  ? t('reports.qa.author.ai')
                  : t(`reports.qa.author.${message.author_type}`)}
              </span>
              <span className="tabular text-content-tertiary">
                {formatDateTime(message.created_at)}
              </span>
              {restricted ? (
                <p className="mt-0.5 italic text-content-tertiary">
                  {t('reports.qa.excerpt.hidden')}
                </p>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap break-words">{message.text}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
