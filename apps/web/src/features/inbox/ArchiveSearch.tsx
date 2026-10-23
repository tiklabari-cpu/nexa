/**
 * The Archive view's message search (ID-07 · tm 333.4): an always-visible bar,
 * an optional day range, and the conversations whose messages hold every word —
 * each with the message that matched, marked, and a way to open the
 * conversation at that very message.
 *
 * The searched words are component state and nothing else: they are not written
 * to the address bar, the history or storage (GV-05). A snippet is conversation
 * content, so — like the transcript — it is shown as written and not translated.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  MESSAGE_SEARCH_MAX_DAYS,
  MESSAGE_SEARCH_MAX_WORDS,
  MESSAGE_SEARCH_MIN_QUERY_LENGTH,
  MESSAGE_SEARCH_MIN_RUN,
  type MessageSearchHighlight,
} from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { PagedQueryResult } from '../../lib/paged-query.js';
import {
  archiveSearchReason,
  checkArchiveSearch,
  splitSnippet,
  type ArchiveSearchHit,
  type ArchiveSearchRefusal,
  type ArchiveSearchRequest,
} from './archive-search.js';

/** How close to the bottom of the loaded rows asks for the next page (see InboxPage). */
const END_OF_LIST_PX = 240;

/** The sentence for a refusal — the server's `details.reason` and the bar's own checks share it. */
export function refusalText(t: TFunction, reason: ArchiveSearchRefusal | string): string {
  return t(`inbox.archiveSearch.reason.${reason}`, {
    chars: MESSAGE_SEARCH_MIN_QUERY_LENGTH,
    run: MESSAGE_SEARCH_MIN_RUN,
    words: MESSAGE_SEARCH_MAX_WORDS,
    days: MESSAGE_SEARCH_MAX_DAYS,
  });
}

/**
 * The search form. It asks on submit rather than per keystroke: a search is a
 * query against every message in the window, held to a request budget, and a
 * half-typed word is the one thing guaranteed not to be worth it.
 */
export function ArchiveSearchBar({
  active,
  onSearch,
  onClear,
}: {
  /** The search in force, or null while the view shows its ordinary list. */
  active: ArchiveSearchRequest | null;
  onSearch: (request: ArchiveSearchRequest) => void;
  onClear: () => void;
}): ReactElement {
  const t = useTranslate();
  const [query, setQuery] = useState(active?.query ?? '');
  const [dateFrom, setDateFrom] = useState(active?.dateFrom ?? '');
  const [dateTo, setDateTo] = useState(active?.dateTo ?? '');
  const [refusal, setRefusal] = useState<ArchiveSearchRefusal | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const request = { query: query.replace(/\s+/gu, ' ').trim(), dateFrom, dateTo };
    // Nothing typed is a way back to the list, not a refusal to explain.
    if (request.query === '') {
      setRefusal(null);
      onClear();
      return;
    }
    const broken = checkArchiveSearch(request);
    setRefusal(broken);
    if (!broken) onSearch(request);
  };

  const clear = (): void => {
    setQuery('');
    setDateFrom('');
    setDateTo('');
    setRefusal(null);
    onClear();
  };

  return (
    <form
      role="search"
      aria-label={t('inbox.archiveSearch.ariaLabel')}
      onSubmit={submit}
      // The bar names the broken rule itself; the browser's own bubble over a date
      // input's min/max would speak instead, in its own language, and block the submit.
      noValidate
      className="flex flex-col gap-1.5 border-b border-border px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('inbox.archiveSearch.inputLabel')}
          aria-invalid={refusal !== null && refusal !== 'range_order' ? true : undefined}
          placeholder={t('inbox.archiveSearch.placeholder')}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-border bg-inset px-2 py-1 text-xs text-content placeholder:text-content-tertiary"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-600"
        >
          {t('inbox.archiveSearch.submit')}
        </button>
      </div>
      <div className="flex items-center gap-1 text-2xs text-content-secondary">
        <label className="flex min-w-0 flex-1 items-center gap-1">
          <span className="sr-only">{t('inbox.archiveSearch.fromLabel')}</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => setDateFrom(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border bg-inset px-1.5 py-0.5 text-content"
          />
        </label>
        <span aria-hidden="true">→</span>
        <label className="flex min-w-0 flex-1 items-center gap-1">
          <span className="sr-only">{t('inbox.archiveSearch.toLabel')}</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border bg-inset px-1.5 py-0.5 text-content"
          />
        </label>
        {(active || query !== '' || dateFrom !== '' || dateTo !== '') && (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-content-secondary hover:text-content"
          >
            {t('inbox.archiveSearch.clear')}
          </button>
        )}
      </div>
      {refusal && (
        <p role="alert" className="text-2xs text-danger">
          {refusalText(t, refusal)}
        </p>
      )}
    </form>
  );
}

/** A snippet with the query's words marked. */
export function HighlightedSnippet({
  snippet,
  highlights,
}: {
  snippet: string;
  highlights: readonly MessageSearchHighlight[];
}): ReactElement {
  return (
    <>
      {splitSnippet(snippet, highlights).map((part, index) =>
        part.marked ? (
          <mark
            key={index}
            className="rounded-sm bg-brand-100 px-0.5 font-semibold text-content dark:bg-brand-900"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The search's answer, in the list pane's place: loading, a failure the server
 * explained (or the type's own sentence), nothing found, or the conversations —
 * newest match first, paged as the reader nears the end.
 */
export function ArchiveSearchResults({
  search,
  selectedId,
  onOpen,
  onGoToMessage,
}: {
  search: PagedQueryResult<ArchiveSearchHit>;
  selectedId: string | null;
  /** Opens the conversation at its newest message. */
  onOpen: (hit: ArchiveSearchHit) => void;
  /** Opens it at the message that matched ("Bu mesaja git"). */
  onGoToMessage: (hit: ArchiveSearchHit) => void;
}): ReactElement {
  const t = useTranslate();
  const loaded = search.pages.length > 0;
  const reason = search.isError ? archiveSearchReason(search.error) : null;

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < END_OF_LIST_PX) search.fetchNext();
      }}
    >
      {search.isError && !loaded ? (
        reason ? (
          // A refusal the agent can act on: say which rule, not "something went wrong".
          <div role="alert" className="flex flex-col gap-1 p-6 text-center">
            <p className="text-sm font-medium">{t('inbox.archiveSearch.error.title')}</p>
            <p className="text-xs text-content-secondary">{refusalText(t, reason)}</p>
          </div>
        ) : (
          <LoadError
            title={t('inbox.archiveSearch.error.title')}
            error={search.error}
            onRetry={search.refetch}
          />
        )
      ) : search.isPending ? (
        <ListSkeleton />
      ) : search.items.length === 0 ? (
        <EmptyState
          title={t('inbox.archiveSearch.empty.title')}
          description={t('inbox.archiveSearch.empty.description')}
        />
      ) : (
        <>
          <p
            role="status"
            className="border-b border-border px-4 py-2 text-2xs text-content-tertiary"
          >
            {t('inbox.archiveSearch.total', { count: search.total ?? search.items.length })}
          </p>
          {search.isError && (
            <p role="alert" className="px-4 py-2 text-2xs text-danger">
              {t(errorMessageKey(search.error))}
            </p>
          )}
          <ul>
            {search.items.map((hit) => (
              <li key={hit.id} className="border-b border-border">
                <button
                  type="button"
                  onClick={() => onOpen(hit)}
                  aria-current={selectedId === hit.id ? 'true' : undefined}
                  className={`flex w-full flex-col gap-1 px-4 pb-1 pt-3 text-left transition-colors ${
                    selectedId === hit.id ? 'bg-brand-100 dark:bg-brand-950' : 'hover:bg-surface-2'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm font-medium">
                      {hit.customer_name ?? t('inbox.list.item.visitorFallback')}
                    </span>
                    {hit.match.internal && (
                      <span className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-warning">
                        {t('inbox.archiveSearch.internalNote')}
                      </span>
                    )}
                    {hit.match.match_count > 1 && (
                      <span className="tabular shrink-0 rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
                        {t('inbox.archiveSearch.matches', { count: hit.match.match_count })}
                      </span>
                    )}
                  </span>
                  <span className="break-words text-xs text-content-secondary">
                    <HighlightedSnippet
                      snippet={hit.match.snippet}
                      highlights={hit.match.highlights}
                    />
                  </span>
                  <span className="text-2xs text-content-tertiary">
                    {formatDateTime(hit.match.created_at)}
                  </span>
                </button>
                <div className="px-4 pb-2">
                  <button
                    type="button"
                    onClick={() => onGoToMessage(hit)}
                    className="rounded-md px-1 text-2xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                  >
                    {t('inbox.archiveSearch.goToMessage')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {search.isFetchingNext && (
            <p className="px-4 py-2 text-2xs text-content-tertiary">{t('inbox.list.loading')}</p>
          )}
        </>
      )}
    </div>
  );
}
