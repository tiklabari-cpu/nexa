/**
 * The Archive's list pane (AR-01 · tm 335.2): one row per connection, newest end
 * first. Loading, a failed read, an empty archive and the rows are four different
 * screens — a failure never falls through to "nothing here yet", and a skeleton
 * is only ever what a request in flight looks like.
 *
 * A row is conversation content (the player's first words) around a few facts the
 * connection owns: who had it, its tags, how it was rated, who answered.
 */
import type { ReactElement } from 'react';
import type { ArchiveConversation } from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { formatCount, formatDateTime, formatTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { groupByDay } from './archive.js';
import type { ArchiveListResult } from './useArchive.js';

/** How close to the bottom of the loaded rows asks for the next page. */
const END_OF_LIST_PX = 240;

export function ArchiveList({
  list,
  selectedId,
  onSelect,
  grouped,
  teams,
  filtered,
  blocked,
  onClearFilters,
}: {
  list: ArchiveListResult;
  /** The open connection's number, from the address. */
  selectedId: string | null;
  onSelect: (row: ArchiveConversation) => void;
  /** Fold the connections of one day under a heading (AR-01-S1). */
  grouped: boolean;
  teams: ReadonlyMap<number, string>;
  /** A filter narrows the list: an empty page is "nothing matches", not "no archive yet". */
  filtered: boolean;
  /** The filters cannot be asked for as they are (dates run backwards); no list was requested. */
  blocked: boolean;
  onClearFilters: () => void;
}): ReactElement {
  const t = useTranslate();
  const loaded = list.pages.length > 0;
  const days = grouped ? groupByDay(list.items) : null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < END_OF_LIST_PX) list.fetchNext();
      }}
    >
      {blocked ? (
        <EmptyState
          title={t('archive.filter.blocked.title')}
          description={t('archive.filter.blocked.description')}
        />
      ) : list.isError && !loaded ? (
        <LoadError
          title={t('archive.list.error.title')}
          error={list.error}
          onRetry={list.refetch}
        />
      ) : list.isPending ? (
        <ListSkeleton />
      ) : list.items.length === 0 && filtered ? (
        <EmptyState
          title={t('archive.filter.empty.title')}
          description={t('archive.filter.empty.description')}
          action={
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded-md border border-border bg-inset px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:text-content"
            >
              {t('archive.filter.clearAll')}
            </button>
          }
        />
      ) : list.items.length === 0 ? (
        <EmptyState title={t('archive.empty.title')} description={t('archive.empty.description')} />
      ) : (
        <>
          <p
            role="status"
            className="border-b border-border px-4 py-2 text-2xs text-content-tertiary"
          >
            {list.totalCapped
              ? t('archive.list.totalCapped', { total: formatCount(list.total) ?? '' })
              : t('archive.list.total', { count: list.total ?? list.items.length })}
          </p>
          {list.isError && (
            <p role="alert" className="px-4 py-2 text-2xs text-danger">
              {t('archive.list.error.more')}
            </p>
          )}
          {days ? (
            <ul aria-label={t('archive.list.ariaLabel')}>
              {days.map((day) => (
                <li key={day.chatId} className="border-b border-border">
                  <DayHeading rows={day.rows} t={t} />
                  <ul>
                    {day.rows.map((row) => (
                      <ArchiveRow
                        key={row.thread_id}
                        row={row}
                        selected={selectedId === row.thread_id}
                        onSelect={onSelect}
                        teams={teams}
                        inDay
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <ul aria-label={t('archive.list.ariaLabel')}>
              {list.items.map((row) => (
                <ArchiveRow
                  key={row.thread_id}
                  row={row}
                  selected={selectedId === row.thread_id}
                  onSelect={onSelect}
                  teams={teams}
                />
              ))}
            </ul>
          )}
          {list.hasNext && (
            <div className="flex justify-center border-t border-border p-3">
              <button
                type="button"
                onClick={list.fetchNext}
                disabled={list.isFetchingNext}
                className="rounded-md border border-border bg-inset px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:text-content disabled:opacity-60"
              >
                {list.isFetchingNext ? t('archive.list.loading') : t('archive.list.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The heading over one member's day: who, which day, how many connections of it are loaded. */
function DayHeading({ rows, t }: { rows: ArchiveConversation[]; t: TFunction }): ReactElement {
  const first = rows[0]!;
  return (
    <p className="flex items-center gap-2 bg-surface-2 px-4 py-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate font-medium">
        {first.customer.name ?? t('inbox.list.item.visitorFallback')}
      </span>
      <span className="tabular shrink-0 rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
        {t('archive.group.connections', { count: rows.length })}
      </span>
    </p>
  );
}

function ArchiveRow({
  row,
  selected,
  onSelect,
  teams,
  inDay = false,
}: {
  row: ArchiveConversation;
  selected: boolean;
  onSelect: (row: ArchiveConversation) => void;
  teams: ReadonlyMap<number, string>;
  /** Under a day heading: the name is already said, so the row opens with the time. */
  inDay?: boolean;
}): ReactElement {
  const t = useTranslate();
  const open = row.ended_at === null;
  const when = open ? row.started_at : row.ended_at;
  const teamNames = row.group_ids
    .map((id) => teams.get(id))
    .filter((name): name is string => name !== undefined);
  const facts = [
    inDay ? formatTime(when) : formatDateTime(when),
    row.assignee?.name ?? t('archive.row.unassigned'),
    teamNames.length > 0 ? teamNames.join(', ') : null,
    t('archive.row.messages', { count: row.message_count }),
  ].filter((part): part is string => Boolean(part));

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => onSelect(row)}
        aria-current={selected ? 'true' : undefined}
        className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors ${
          selected ? 'bg-brand-100 dark:bg-brand-950' : 'hover:bg-surface-2'
        }`}
      >
        <span className="flex items-center gap-2">
          {!inDay && (
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {row.customer.name ?? t('inbox.list.item.visitorFallback')}
            </span>
          )}
          {inDay && <span className="flex-1" />}
          {open && (
            <span className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-warning">
              {t('archive.row.open')}
            </span>
          )}
          {row.rating && (
            <span
              className={`shrink-0 rounded-sm bg-inset px-1.5 py-0.5 text-2xs ${
                row.rating.value === 'bad' ? 'text-danger' : 'text-success'
              }`}
            >
              {t(`archive.rating.${row.rating.value}`)}
            </span>
          )}
          {row.risk_flags.length > 0 && (
            <span
              className="shrink-0 rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-danger"
              title={row.risk_flags.map((flag) => t(`inbox.risk.type.${flag}`)).join(', ')}
            >
              {t('archive.row.riskFlags', { count: row.risk_flags.length })}
            </span>
          )}
        </span>
        <span className="line-clamp-2 break-words text-xs text-content-secondary">
          {row.first_customer_message ?? t('archive.row.noMessage')}
        </span>
        <span className="text-2xs text-content-tertiary">{facts.join(' · ')}</span>
        {(row.tags.length > 0 || row.handled_by !== null) && (
          <span className="flex flex-wrap gap-1">
            {row.handled_by !== null && (
              <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
                {t(`archive.handledBy.${row.handled_by}`)}
              </span>
            )}
            {row.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-tertiary"
              >
                {tag.name}
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}
