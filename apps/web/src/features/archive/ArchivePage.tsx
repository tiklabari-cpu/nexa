/**
 * The Archive (AR-01 · tm 335.2): the place to find a past conversation, apart
 * from the Inbox where the live ones are worked.
 *
 * Three panes — the list (one row per *connection*, so a player who wrote three
 * times is three rows), the connection's transcript read-only, and the player
 * panel. Below the desktop breakpoint the list fills the screen and an opened
 * connection replaces it, with a way back (GV-04 · tm 472.3). The address names
 * the open connection (`?c=`), so a pasted link opens the same conversation; the
 * searched words never go in it (GV-05).
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { hasAnyScope } from '@siyahtus/types';
import type { ArchiveConversation } from '@siyahtus/types';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { usePageTitle } from '../../lib/document-title.js';
import { useTranslate } from '../../lib/i18n.js';
import { isNarrowLayout, useViewportLayout } from '../../lib/viewport.js';
import {
  textSearchRequest,
  useArchiveSearch,
  type ArchiveSearchHit,
  type ArchiveSearchRequest,
} from '../inbox/archive-search.js';
import type { ChatDetail } from '../inbox/types.js';
import { ArchiveSearchBar, ArchiveSearchResults } from '../inbox/ArchiveSearch.js';
import { CONNECTION_PARAM, readGrouped, readScope, writeFlag } from './archive.js';
import {
  NO_FILTERS,
  findConflicts,
  isFiltered,
  readFilters,
  writeFilters,
  type ArchiveFilters as Filters,
} from './archive-filters.js';
import { ArchiveFilters } from './ArchiveFilters.js';
import { ArchivePlayer, ArchiveTranscript } from './ArchiveDetail.js';
import { ArchiveList } from './ArchiveList.js';
import { useArchiveLookupSection } from './ArchiveLookup.js';
import type { LookupTarget } from './archive-lookup.js';
import { useArchiveDetail, useArchiveList, useTeamNames } from './useArchive.js';

/** Scopes under which "Reopen" is not refused outright (`routes/chats.ts` resume). */
const REOPEN_SCOPES = ['chats--all:rw', 'chats--access:rw'] as const;

type DetailPane = 'transcript' | 'player';
const DETAIL_PANES: readonly DetailPane[] = ['transcript', 'player'];

export function ArchivePage(): ReactElement {
  const t = useTranslate();
  usePageTitle(t('archive.title'));

  const [params, setParams] = useSearchParams();
  const threadId = params.get(CONNECTION_PARAM) || null;
  const scope = readScope(params);
  const grouped = readGrouped(params);
  const filters = useMemo(() => readFilters(params), [params]);
  // Dates that run backwards are refused by the server (400); the bar says so instead.
  const datesBackwards = findConflicts(filters).includes('date_order');

  const list = useArchiveList(scope, filters, !datesBackwards);
  const detail = useArchiveDetail(threadId);
  const teams = useTeamNames();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);

  // The message search (ID-07): component state only, never the address.
  const [searchRequest, setSearchRequest] = useState<ArchiveSearchRequest | null>(null);
  const found = useArchiveSearch(textSearchRequest(searchRequest));
  const api = useApiClient();
  const navigate = useNavigate();
  const [focus, setFocus] = useState<{ threadId: string; eventId: string; nonce: number } | null>(
    null,
  );

  // Below the desktop breakpoint (GV-04 · tm 472.3) the list fills the screen
  // and an opened connection replaces it, under a way back; the connection's
  // transcript and its player panel take turns. A pasted link lands on the transcript.
  const narrow = isNarrowLayout(useViewportLayout());
  const [pane, setPane] = useState<DetailPane>('transcript');
  const showList = !narrow || threadId === null;
  const showDetail = !narrow || threadId !== null;

  const open = (id: string, at: { eventId: string } | null): void => {
    const next = new URLSearchParams(params);
    next.set(CONNECTION_PARAM, id);
    setParams(next);
    setFocus(at ? { threadId: id, eventId: at.eventId, nonce: Date.now() } : null);
    setPane('transcript');
  };
  const changeFilters = (next: Filters): void =>
    setParams(writeFilters(params, next), { replace: true });
  const openRow = (row: ArchiveConversation): void => open(row.thread_id, null);
  const openHit = (hit: ArchiveSearchHit, atMessage: boolean): void =>
    open(hit.match.thread_id, atMessage ? { eventId: hit.match.event_id } : null);

  // A direct match (tm 468): a connection opens here; a day found by its
  // number (`ids.thread`) opens at its newest connection, which the day's own read names.
  const openTarget = (target: LookupTarget): void => {
    if (target.threadId) {
      open(target.threadId, target.eventId ? { eventId: target.eventId } : null);
      return;
    }
    // The day is still reachable where every day opens: the inbox.
    const inInbox = (): void => {
      void navigate(`/app/inbox?chat=${encodeURIComponent(target.chatId)}`);
    };
    api
      .get<ChatDetail>(`/chats/${encodeURIComponent(target.chatId)}`)
      .then((chat) => (chat.thread ? open(chat.thread.id, null) : inInbox()), inInbox);
  };
  const lookup = useArchiveLookupSection(searchRequest, threadId, openTarget);

  const searching = searchRequest !== null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1">
        {showList && (
          <section
            aria-label={t('archive.list.region')}
            className="flex w-list shrink-0 flex-col border-r border-border bg-surface max-lg:w-full max-lg:border-r-0"
          >
            <header className="flex h-topbar items-center justify-between gap-2 border-b border-border px-4">
              <h1 className="text-lg font-semibold">{t('archive.title')}</h1>
            </header>

            {/* Always on show: finding a past conversation is what this screen is for. */}
            <ArchiveSearchBar
              active={searchRequest}
              onSearch={setSearchRequest}
              onClear={() => setSearchRequest(null)}
              lookup
            />

            {searching ? (
              <ArchiveSearchResults
                search={found}
                selectedId={detail.data?.chat_id ?? null}
                onOpen={(hit) => openHit(hit, false)}
                onGoToMessage={(hit) => openHit(hit, true)}
                lookup={lookup}
                textSearched={textSearchRequest(searchRequest) !== null}
              />
            ) : (
              <>
                <ArchiveFilters filters={filters} onChange={changeFilters} teams={teams} />
                <div className="flex flex-col gap-1 border-b border-border px-4 py-2 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={scope === 'all'}
                      onChange={(event) =>
                        setParams(writeFlag(params, 'scope', event.target.checked))
                      }
                    />
                    <span>{t('archive.filter.includeOpen')}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={grouped}
                      onChange={(event) =>
                        setParams(writeFlag(params, 'group', event.target.checked))
                      }
                    />
                    <span>{t('archive.filter.groupByDay')}</span>
                  </label>
                </div>
                <ArchiveList
                  list={list}
                  selectedId={threadId}
                  onSelect={openRow}
                  grouped={grouped}
                  teams={teams}
                  filtered={isFiltered(filters)}
                  blocked={datesBackwards}
                  onClearFilters={() => changeFilters(NO_FILTERS)}
                />
              </>
            )}
          </section>
        )}

        {showDetail && (
          <div className="flex min-w-0 flex-1 flex-col">
            {narrow && (
              <DetailBar
                pane={pane}
                onPane={setPane}
                onBack={() => {
                  const next = new URLSearchParams(params);
                  next.delete(CONNECTION_PARAM);
                  setParams(next);
                }}
              />
            )}
            <div className="flex min-h-0 min-w-0 flex-1">
              {(!narrow || pane === 'transcript') && (
                <div className="flex min-w-0 flex-1 flex-col bg-canvas">
                  <ArchiveTranscript
                    threadId={threadId}
                    detail={detail}
                    focus={focus}
                    canReopen={hasAnyScope(scopes, REOPEN_SCOPES)}
                  />
                </div>
              )}
              {(!narrow || pane === 'player') && (
                <div className="flex shrink-0 flex-col max-lg:min-w-0 max-lg:flex-1">
                  <ArchivePlayer threadId={threadId} detail={detail} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The bar over an opened connection on a narrow window: back to the list, and
 * which half of the connection is on screen. Every target is finger-sized (44 px).
 */
function DetailBar({
  pane,
  onPane,
  onBack,
}: {
  pane: DetailPane;
  onPane: (next: DetailPane) => void;
  onBack: () => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-2 py-1">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-content-secondary hover:bg-surface-2 hover:text-content"
      >
        <span aria-hidden="true">‹</span>
        {t('archive.back')}
      </button>
      <div role="tablist" aria-label={t('archive.panes.ariaLabel')} className="ml-auto flex gap-1">
        {DETAIL_PANES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pane === id}
            onClick={() => onPane(id)}
            className={`min-h-11 rounded-md px-3 text-sm transition-colors ${
              pane === id
                ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                : 'text-content-secondary hover:bg-surface-2'
            }`}
          >
            {t(`archive.panes.${id}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
