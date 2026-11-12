/**
 * The direct matches above the archive search's text hits (ID-06 · tm 468):
 * the conversation a pasted number names, and the players an address or a name
 * names, each with their newest conversations. See `archive-lookup.ts`.
 *
 * A row shows the number it matched, so the agent can see the paste landed on
 * the right record before opening it — as plain text: the row is one button,
 * and the number's copy button lives on the opened conversation's header.
 */
import { useId, type ReactElement } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SearchResult } from '@siyahtus/types';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { ArchiveSearchRequest } from '../inbox/archive-search.js';
import {
  lookupConversations,
  lookupPlayers,
  lookupTarget,
  useArchiveLookup,
  usePlayerConversations,
  type LookupTarget,
} from './archive-lookup.js';

const ROW_CLASS = 'flex w-full flex-col gap-0.5 px-4 py-2 text-left transition-colors';

function rowTone(selected: boolean): string {
  return selected ? 'bg-brand-100 dark:bg-brand-950' : 'hover:bg-surface-2';
}

/** The glossary's name of the number a conversation row matched (ID-01). */
const ID_LABEL = {
  chat: 'ids.thread.label',
  connection: 'ids.chat.label',
  event: 'ids.event.label',
};

/**
 * The lookup for the bar's request, as `ArchiveSearchResults` takes it: the
 * section to draw, whether it found anything, and whether it has answered.
 */
export function useArchiveLookupSection(
  request: ArchiveSearchRequest | null,
  selectedThreadId: string | null,
  onOpen: (target: LookupTarget) => void,
): { node: ReactElement; found: boolean; settled: boolean } {
  const lookup = useArchiveLookup(request?.query ?? null);
  const items = lookup.data ?? [];
  return {
    node: (
      <ArchiveLookupResults lookup={lookup} selectedThreadId={selectedThreadId} onOpen={onOpen} />
    ),
    found: lookupConversations(items).length + lookupPlayers(items).length > 0,
    settled: lookup.isSuccess || lookup.isError,
  };
}

export function ArchiveLookupResults({
  lookup,
  selectedThreadId,
  onOpen,
}: {
  lookup: UseQueryResult<SearchResult[]>;
  /** The connection open beside the list, marked as current. */
  selectedThreadId: string | null;
  onOpen: (target: LookupTarget) => void;
}): ReactElement | null {
  const t = useTranslate();
  const headingId = useId();
  if (lookup.isError) {
    return (
      <p role="alert" className="border-b border-border px-4 py-2 text-2xs text-danger">
        {t('archive.lookup.error')}
      </p>
    );
  }
  const items = lookup.data ?? [];
  const conversations = lookupConversations(items);
  const players = lookupPlayers(items);
  if (conversations.length === 0 && players.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="archive-lookup"
      className="border-b border-border"
    >
      <p
        id={headingId}
        className="px-4 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary"
      >
        {t('archive.lookup.title')}
      </p>
      <ul>
        {conversations.map((item) => {
          const target = lookupTarget(item);
          const number =
            item.kind === 'event'
              ? item.event_id
              : item.kind === 'chat'
                ? item.chat_id
                : item.thread_id;
          const selected = target.threadId !== null && target.threadId === selectedThreadId;
          return (
            <li key={`${item.kind}:${number ?? ''}`}>
              <button
                type="button"
                data-lookup-kind={item.kind}
                onClick={() => onOpen(target)}
                aria-current={selected ? 'true' : undefined}
                className={`${ROW_CLASS} ${rowTone(selected)}`}
              >
                <span className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium">
                    {item.title ?? t('inbox.list.item.visitorFallback')}
                  </span>
                  <span className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
                    {t(ID_LABEL[item.kind as keyof typeof ID_LABEL])}
                  </span>
                </span>
                <span className="text-2xs text-content-tertiary">
                  <span className="font-mono text-content-secondary">{number}</span>
                  {item.at ? ` · ${formatDateTime(item.at)}` : ''}
                </span>
              </button>
            </li>
          );
        })}
        {players.map((player) => (
          <PlayerConversations
            key={player.customer_id}
            player={player}
            selectedThreadId={selectedThreadId}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

/** A player the lookup found, and their newest connections — each one opens in place. */
function PlayerConversations({
  player,
  selectedThreadId,
  onOpen,
}: {
  player: SearchResult;
  selectedThreadId: string | null;
  onOpen: (target: LookupTarget) => void;
}): ReactElement {
  const t = useTranslate();
  const list = usePlayerConversations(player.customer_id ?? '');
  const name = player.title ?? t('inbox.list.item.visitorFallback');
  const rows = list.data?.items ?? [];
  return (
    <li data-lookup-player={player.customer_id} className="flex flex-col pb-1">
      <p className="flex items-baseline gap-2 px-4 pt-1.5 text-xs">
        <span className="truncate font-medium">{name}</span>
        {player.subtitle && (
          <span className="truncate text-2xs text-content-tertiary">{player.subtitle}</span>
        )}
      </p>
      {list.isPending ? (
        <p className="px-4 py-1 text-2xs text-content-tertiary">{t('inbox.list.loading')}</p>
      ) : list.isError ? (
        <p role="alert" className="px-4 py-1 text-2xs text-danger">
          {t('archive.lookup.playerError')}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-1 text-2xs text-content-tertiary">{t('archive.lookup.playerNone')}</p>
      ) : (
        <ul aria-label={t('archive.lookup.playerConversations', { name })}>
          {rows.map((row) => {
            const selected = row.thread_id === selectedThreadId;
            return (
              <li key={row.thread_id}>
                <button
                  type="button"
                  onClick={() =>
                    onOpen({ chatId: row.chat_id, threadId: row.thread_id, eventId: null })
                  }
                  aria-current={selected ? 'true' : undefined}
                  className={`${ROW_CLASS} pl-6 ${rowTone(selected)}`}
                >
                  <span className="text-2xs text-content-tertiary">
                    {formatDateTime(row.started_at)}
                    {' · '}
                    <span className="font-mono text-content-secondary">{row.thread_id}</span>
                  </span>
                  {row.first_customer_message && (
                    <span className="truncate text-xs text-content-secondary">
                      {row.first_customer_message}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
