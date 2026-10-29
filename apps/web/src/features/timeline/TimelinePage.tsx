/**
 * The conversation timeline (ID-09 · tm 334.2): everything that happened in one
 * day (`ids.thread`) or one connection (`ids.chat`) in a single list — messages,
 * internal notes, the AI's decisions, assignment, transfer, tags, rating, SLA
 * misses, tickets and the audit trail — at `/app/inbox/timeline?chat=<day>&thread=<connection>`.
 *
 * Built to be read with the browser's own find (Ctrl+F): the list is NOT
 * virtualised, a page is 200 rows, "Load more" appends the next and every
 * loaded row stays in the page. The filter box narrows the rows loaded so far
 * (and says so while more remain). Times are the workspace's clock (ID-04) with
 * the UTC instant on hover; on the day view a divider marks where each
 * connection starts. The download is the export dialog's.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TIMELINE_KINDS, type TimelineKind } from '@siyahtus/types';
import { CopyId } from '../../components/CopyId.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { Page } from '../../components/Page.js';
import { Banner } from '../../components/ui/index.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate, useLocale } from '../../lib/i18n.js';
import { timeZoneOptionLabel } from '../../lib/timezones.js';
import { useDayBoundary } from '../archive/useArchive.js';
import { actorLabel, TimelineRow } from './TimelineRow.js';
import { TimelineExportModal } from './TimelineExportModal.js';
import {
  matchesQuery,
  readAddress,
  rowSearchText,
  withDividers,
  writeKinds,
  writeThread,
} from './timeline.js';
import { useTimeline } from './useTimeline.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';

export function TimelinePage(): ReactElement {
  const t = useTranslate();
  const { locale } = useLocale();
  const [params, setParams] = useSearchParams();
  const address = useMemo(() => readAddress(params), [params]);
  const capabilities = useAuth((s) => s.agent?.capabilities);
  const zone = useDayBoundary().timezone;

  const timeline = useTimeline(address);
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  // Kinds the caller may not read are not offered: the audit trail goes for someone who cannot read the audit log.
  const kindOptions = useMemo(
    () =>
      TIMELINE_KINDS.filter((kind) => kind !== 'audit' || timeline.meta.audit !== 'not_permitted'),
    [timeline.meta.audit],
  );

  // Search text is built once per loaded row, not once per keystroke.
  const searchable = useMemo(
    () =>
      timeline.items.map((item) => ({
        item,
        text: rowSearchText(item, {
          kind: t(`timeline.kind.${item.kind}`),
          actor: actorLabel(t, item),
        }),
      })),
    [timeline.items, t],
  );
  const needle = query.trim();
  const shown = useMemo(
    () =>
      needle === ''
        ? timeline.items
        : searchable.filter((row) => matchesQuery(row.text, needle)).map((row) => row.item),
    [needle, searchable, timeline.items],
  );
  // Dividers belong to the day view: inside one connection they would all say the same thing.
  const entries = useMemo(
    () => withDividers(shown, address.threadId === null),
    [shown, address.threadId],
  );

  if (address.chatId === null) {
    return (
      <Page title={t('timeline.title')}>
        <EmptyState
          title={t('timeline.noChat.title')}
          description={t('timeline.noChat.description')}
          action={
            <Link to="/app/inbox" className={button}>
              {t('timeline.back')}
            </Link>
          }
        />
      </Page>
    );
  }
  const chatId = address.chatId;

  const toggleKind = (kind: TimelineKind): void => {
    const selected = address.kinds.length === 0 ? [...kindOptions] : [...address.kinds];
    const next = selected.includes(kind)
      ? selected.filter((candidate) => candidate !== kind)
      : [...selected, kind];
    // Every box cleared is the same as none chosen: showing nothing is not a view worth offering.
    setParams(writeKinds(params, next.length === 0 ? [] : next), { replace: true });
  };
  const isChecked = (kind: TimelineKind): boolean =>
    address.kinds.length === 0 || address.kinds.includes(kind);

  const canExport = capabilities?.['timeline.export'] === 'on';
  const canExportUnmasked = capabilities?.['timeline.export_unmasked'] === 'on';
  const notFound = timeline.error instanceof ApiClientError && timeline.error.status === 404;

  const body = ((): ReactElement => {
    if (timeline.isPending) {
      return (
        <p role="status" className="p-8 text-center text-sm text-content-secondary">
          {t('timeline.loading')}
        </p>
      );
    }
    if (notFound) {
      return (
        <EmptyState
          title={t('timeline.notFound.title')}
          description={t('timeline.notFound.description')}
          action={
            <Link to="/app/inbox" className={button}>
              {t('timeline.back')}
            </Link>
          }
        />
      );
    }
    if (timeline.isError && timeline.items.length === 0) {
      return (
        <LoadError
          title={t('timeline.error.title')}
          error={timeline.error}
          onRetry={timeline.refetch}
        />
      );
    }
    if (entries.length === 0) {
      return needle !== '' ? (
        <EmptyState
          title={t('timeline.empty.filteredTitle')}
          description={t(
            timeline.hasNext ? 'timeline.empty.filteredMore' : 'timeline.empty.filteredAll',
          )}
        />
      ) : (
        <EmptyState
          title={t('timeline.empty.title')}
          description={t('timeline.empty.description')}
        />
      );
    }
    return (
      <ol aria-label={t('timeline.list.ariaLabel')}>
        {entries.map((entry) =>
          entry.type === 'divider' ? (
            <li
              key={entry.key}
              className="flex items-center gap-3 border-b border-border bg-inset px-4 py-1.5 text-2xs text-content-secondary"
            >
              <span>{t('timeline.divider')}</span>
              <CopyId kind="chat" value={entry.threadId} className="text-2xs" />
            </li>
          ) : (
            <TimelineRow key={entry.key} item={entry.item} zone={zone} locale={locale} />
          ),
        )}
      </ol>
    );
  })();

  return (
    <Page
      title={t('timeline.title')}
      description={t('timeline.zone', { zone: timeZoneOptionLabel(zone, new Date()) })}
      actions={
        <div className="flex items-center gap-2">
          <Link to={`/app/inbox?chat=${encodeURIComponent(chatId)}`} className={button}>
            {t('timeline.back')}
          </Link>
          {canExport && (
            <button type="button" className={button} onClick={() => setExporting(true)}>
              {t('timeline.export.button')}
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <CopyId kind="thread" value={chatId} />
          {address.threadId !== null && <CopyId kind="chat" value={address.threadId} />}
          {address.threadId !== null && (
            <Link
              to={{ search: writeThread(params, null).toString() }}
              className="ml-auto text-2xs text-content-brand underline underline-offset-2"
            >
              {t('timeline.scope.day')}
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(change) => setQuery(change.target.value)}
            aria-label={t('timeline.search.label')}
            placeholder={t('timeline.search.placeholder')}
            className="w-72 max-w-full rounded-md border border-border bg-surface px-3 py-1.5 text-xs"
          />
          <p role="status" className="text-2xs text-content-secondary">
            {needle !== ''
              ? t('timeline.search.count', { shown: shown.length, loaded: timeline.items.length })
              : t('timeline.loaded', { count: timeline.items.length })}
          </p>
        </div>
        {needle !== '' && timeline.hasNext && (
          <p className="text-2xs text-content-tertiary">{t('timeline.search.loadedOnly')}</p>
        )}

        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="sr-only">{t('timeline.kinds.label')}</legend>
          {kindOptions.map((kind) => (
            <label key={kind} className="flex items-center gap-1.5 text-2xs">
              <input type="checkbox" checked={isChecked(kind)} onChange={() => toggleKind(kind)} />
              <span>{t(`timeline.kind.${kind}`)}</span>
            </label>
          ))}
        </fieldset>

        {timeline.meta.audit === 'not_permitted' && (
          <p className="text-2xs text-content-tertiary">{t('timeline.audit.notPermitted')}</p>
        )}
        {timeline.meta.audit === 'included' && timeline.meta.audit_expired === true && (
          <Banner tone="info" role="status">
            {t('timeline.audit.expired')}
          </Banner>
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface">
        {body}
        {(timeline.items.length > 0 || timeline.hasNext) && (
          <div className="flex flex-col items-center gap-2 p-3">
            {timeline.isError && (
              <p role="alert" className="text-2xs text-danger">
                {t('timeline.loadMore.error')}
              </p>
            )}
            {timeline.hasNext ? (
              <button
                type="button"
                className={button}
                disabled={timeline.isFetchingNext}
                onClick={timeline.fetchNext}
              >
                {timeline.isFetchingNext ? t('timeline.loadMore.loading') : t('timeline.loadMore')}
              </button>
            ) : (
              <p className="text-2xs text-content-tertiary">{t('timeline.end')}</p>
            )}
          </div>
        )}
      </div>

      {exporting && (
        <TimelineExportModal
          chatId={chatId}
          threadId={address.threadId}
          canExportUnmasked={canExportUnmasked}
          onClose={() => setExporting(false)}
        />
      )}
    </Page>
  );
}
