/**
 * The Reviews tab's comments card (WG-11 · tm 337): what players wrote with
 * their ratings in the report's window, newest first, a page at a time
 * (`GET /reports/reviews/comments`). Good, bad or both; each row names the
 * player, the connection (its `thread_id`, which opens it in the archive) and who
 * had it. The comment is plain text, shortened until opened.
 *
 * The server decides which comments the reader sees (`ratings.view`): an Ekip
 * Üyesi given the reports reads their own connections' only.
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { RatingValue, ReviewComment } from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { Card, Section } from '../../components/Page.js';
import { RatingBadge, RatingComment } from '../../components/RatingBadge.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { usePagedQuery } from '../../lib/paged-query.js';

const PAGE = 20;

type ValueFilter = RatingValue | 'all';

export function reviewCommentsUrl(
  range: { from: string; to: string },
  value: ValueFilter,
  pageId: string | undefined,
): string {
  const params = new URLSearchParams({ from: range.from, to: range.to, limit: String(PAGE) });
  if (value !== 'all') params.set('value', value);
  if (pageId) params.set('page_id', pageId);
  return `/reports/reviews/comments?${params.toString()}`;
}

export function ReviewComments({
  range,
  rangeKey,
}: {
  range: { from: string; to: string } | null;
  rangeKey: string;
}): ReactElement {
  const t = useTranslate();
  const [value, setValue] = useState<ValueFilter>('all');
  const query = usePagedQuery<ReviewComment>({
    queryKey: ['reports', 'review-comments', rangeKey, value],
    buildUrl: (pageId) => reviewCommentsUrl(range ?? { from: '', to: '' }, value, pageId),
    enabled: range !== null,
  });

  return (
    <Section
      title={t('reports.reviews.comments.title')}
      description={t('reports.reviews.comments.description')}
    >
      <Card>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 self-start text-xs text-content-secondary">
            {t('reports.reviews.comments.filter')}
            <select
              value={value}
              onChange={(event) => setValue(event.target.value as ValueFilter)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-content"
            >
              <option value="all">{t('reports.reviews.comments.all')}</option>
              <option value="bad">{t('reports.reviews.comments.bad')}</option>
              <option value="good">{t('reports.reviews.comments.good')}</option>
            </select>
          </label>
          {query.isError ? (
            <p role="alert" className="text-sm text-danger">
              {t('reports.reviews.comments.error')}
            </p>
          ) : query.isPending ? (
            <p className="text-sm text-content-secondary">
              {t('reports.reviews.comments.loading')}
            </p>
          ) : query.items.length === 0 ? (
            <EmptyState
              title={t('reports.reviews.comments.emptyTitle')}
              description={t('reports.reviews.comments.emptyDescription')}
            />
          ) : (
            <ul data-testid="review-comments" className="flex flex-col divide-y divide-border">
              {query.items.map((item) => (
                <li key={item.rating_id} className="flex flex-col gap-1 py-2">
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <RatingBadge value={item.value} hasComment />
                    <span className="font-medium">
                      {item.customer.name ?? t('inbox.list.item.visitorFallback')}
                    </span>
                    <Link
                      to={`/app/archive?c=${encodeURIComponent(item.thread_id)}`}
                      className="font-mono text-2xs text-content-brand underline underline-offset-2"
                    >
                      {item.thread_id}
                    </Link>
                    <span className="text-2xs text-content-tertiary">
                      {formatDateTime(item.rated_at)}
                      {item.assignee
                        ? ` · ${t('reports.reviews.comments.handledBy', { name: item.assignee.name })}`
                        : ''}
                    </span>
                  </span>
                  <RatingComment comment={item.comment} />
                </li>
              ))}
            </ul>
          )}
          {query.hasNext && (
            <button
              type="button"
              onClick={query.fetchNext}
              disabled={query.isFetchingNext}
              className="self-start rounded-md border border-border px-3 py-1 text-xs hover:bg-surface-2 disabled:opacity-60"
            >
              {t('reports.reviews.comments.more')}
            </button>
          )}
        </div>
      </Card>
    </Section>
  );
}
