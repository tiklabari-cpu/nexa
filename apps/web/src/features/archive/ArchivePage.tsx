/**
 * The Archive (AR-01 · tm 335.2): the place to find a past conversation, apart
 * from the Inbox where the live ones are worked.
 *
 * Three panes — the list (one row per *connection*, so a player who wrote three
 * times is three rows), the connection's transcript read-only, and the player
 * panel. Below the desktop breakpoint they become tabs (GV-04). The address names
 * the open connection (`?c=`), so a pasted link opens the same conversation; the
 * searched words never go in it (GV-05).
 */
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { hasAnyScope } from '@siyahtus/types';
import type { ArchiveConversation } from '@siyahtus/types';
import { useAuth } from '../../lib/auth-store.js';
import { usePageTitle } from '../../lib/document-title.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  useArchiveSearch,
  type ArchiveSearchHit,
  type ArchiveSearchRequest,
} from '../inbox/archive-search.js';
import { ArchiveSearchBar, ArchiveSearchResults } from '../inbox/ArchiveSearch.js';
import { CONNECTION_PARAM, readGrouped, readScope, writeFlag } from './archive.js';
import { ArchivePlayer, ArchiveTranscript } from './ArchiveDetail.js';
import { ArchiveList } from './ArchiveList.js';
import { useArchiveDetail, useArchiveList, useTeamNames } from './useArchive.js';

/** Scopes under which "Reopen" is not refused outright (`routes/chats.ts` resume). */
const REOPEN_SCOPES = ['chats--all:rw', 'chats--access:rw'] as const;

type Pane = 'list' | 'transcript' | 'player';
const PANES: readonly Pane[] = ['list', 'transcript', 'player'];

export function ArchivePage(): ReactElement {
  const t = useTranslate();
  usePageTitle(t('archive.title'));

  const [params, setParams] = useSearchParams();
  const threadId = params.get(CONNECTION_PARAM) || null;
  const scope = readScope(params);
  const grouped = readGrouped(params);

  const list = useArchiveList(scope);
  const detail = useArchiveDetail(threadId);
  const teams = useTeamNames();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);

  // The message search (ID-07): component state only, never the address.
  const [searchRequest, setSearchRequest] = useState<ArchiveSearchRequest | null>(null);
  const found = useArchiveSearch(searchRequest);
  const [focus, setFocus] = useState<{ threadId: string; eventId: string; nonce: number } | null>(
    null,
  );

  // Below the desktop breakpoint one pane shows at a time; a pasted link lands on the transcript.
  const [pane, setPane] = useState<Pane>(threadId ? 'transcript' : 'list');

  const open = (id: string, at: { eventId: string } | null): void => {
    const next = new URLSearchParams(params);
    next.set(CONNECTION_PARAM, id);
    setParams(next);
    setFocus(at ? { threadId: id, eventId: at.eventId, nonce: Date.now() } : null);
    setPane('transcript');
  };
  const openRow = (row: ArchiveConversation): void => open(row.thread_id, null);
  const openHit = (hit: ArchiveSearchHit, atMessage: boolean): void =>
    open(hit.match.thread_id, atMessage ? { eventId: hit.match.event_id } : null);

  const searching = searchRequest !== null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label={t('archive.panes.ariaLabel')}
        className="flex gap-1 border-b border-border px-2 py-1.5 lg:hidden"
      >
        {PANES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pane === id}
            onClick={() => setPane(id)}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${
              pane === id
                ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                : 'text-content-secondary hover:bg-surface-2'
            }`}
          >
            {t(`archive.panes.${id}`)}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        <section
          aria-label={t('archive.list.region')}
          className={`${
            pane === 'list' ? 'flex' : 'max-lg:hidden'
          } w-list shrink-0 flex-col border-r border-border bg-surface max-lg:w-full lg:flex`}
        >
          <header className="flex h-topbar items-center justify-between gap-2 border-b border-border px-4">
            <h1 className="text-lg font-semibold">{t('archive.title')}</h1>
          </header>

          {/* Always on show: finding a past conversation is what this screen is for. */}
          <ArchiveSearchBar
            active={searchRequest}
            onSearch={setSearchRequest}
            onClear={() => setSearchRequest(null)}
          />

          {searching ? (
            <ArchiveSearchResults
              search={found}
              selectedId={detail.data?.chat_id ?? null}
              onOpen={(hit) => openHit(hit, false)}
              onGoToMessage={(hit) => openHit(hit, true)}
            />
          ) : (
            <>
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
              />
            </>
          )}
        </section>

        <div
          className={`${
            pane === 'transcript' ? 'flex' : 'max-lg:hidden'
          } min-w-0 flex-1 flex-col bg-canvas lg:flex`}
        >
          <ArchiveTranscript
            threadId={threadId}
            detail={detail}
            focus={focus}
            canReopen={hasAnyScope(scopes, REOPEN_SCOPES)}
          />
        </div>

        <div
          className={`${
            pane === 'player' ? 'flex' : 'max-lg:hidden'
          } shrink-0 flex-col max-lg:flex-1 lg:flex`}
        >
          <ArchivePlayer threadId={threadId} detail={detail} />
        </div>
      </div>
    </div>
  );
}
