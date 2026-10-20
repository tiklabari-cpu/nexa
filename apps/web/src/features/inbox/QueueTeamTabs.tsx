/**
 * The Queued view's team tabs (AU-01 · ADR-08a §2.1) — "Inbox kuyruk sekmeleri".
 *
 * One tab per team the agent can see (`GET /groups`: every team for a
 * manager, their own for an agent), topic queues first (`queueTabs.ts`). Each
 * tab's number is the server's `total` for that team's queue — its own list
 * read, the way every rail counter is (`useViewCounts`), so a busy team's tab
 * cannot stop at the first page. The open tab's rows are `InboxPage`'s list,
 * read with the same filter.
 *
 * Nothing renders while the teams cannot be read: the Queued view still lists
 * every queue, it just is not split.
 */
import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdapterChannelType } from '@siyahtus/types';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { DEFAULT_CHAT_SORT } from './chat-sort.js';
import { orderQueueTeams, type QueueTeam } from './queueTabs.js';
import { useChatList } from './useInbox.js';

interface QueueTeamTabsProps {
  /** The open team tab, or null for every team's queue. */
  selected: number | null;
  onSelect: (groupId: number | null) => void;
  /** The channel view in force — a tab counts the conversations its click shows. */
  channel: AdapterChannelType | null;
  /** The whole Queued view's count, for the "All teams" tab. */
  total: number | null | undefined;
  /** How a count is drawn — `InboxPage`'s, so a failed read reads the same here. */
  renderCount: (count: number | null | undefined) => ReactNode;
}

export function QueueTeamTabs({
  selected,
  onSelect,
  channel,
  total,
  renderCount,
}: QueueTeamTabsProps): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();

  // The Team › Teams screen's key: one read, and a team renamed there is
  // renamed here.
  const groups = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: QueueTeam[] }>('/groups'),
    staleTime: 60_000,
  });
  const teams = useMemo(() => orderQueueTeams(groups.data?.items ?? []), [groups.data]);

  // A team deleted (or left) while its tab was open: back to every queue,
  // rather than a filter the agent can no longer see or clear.
  useEffect(() => {
    if (selected !== null && groups.data && !teams.some((team) => team.id === selected)) {
      onSelect(null);
    }
  }, [selected, groups.data, teams, onSelect]);

  if (!groups.data || teams.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={t('inbox.list.queueTeams.ariaLabel')}
      className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5"
    >
      <QueueTab
        label={t('inbox.list.queueTeams.all')}
        active={selected === null}
        onClick={() => onSelect(null)}
        count={renderCount(total)}
      />
      {teams.map((team) => (
        <TeamTab
          key={team.id}
          team={team}
          active={selected === team.id}
          onClick={() => onSelect(team.id)}
          channel={channel}
          renderCount={renderCount}
        />
      ))}
    </div>
  );
}

function TeamTab({
  team,
  active,
  onClick,
  channel,
  renderCount,
}: {
  team: QueueTeam;
  active: boolean;
  onClick: () => void;
  channel: AdapterChannelType | null;
  renderCount: (count: number | null | undefined) => ReactNode;
}): ReactElement {
  // The default sort, like the rail's counters: the number does not depend on
  // the order, and the open tab at that sort shares this very read.
  const list = useChatList('queued', DEFAULT_CHAT_SORT, channel, team.id);
  return (
    <QueueTab
      label={team.name}
      active={active}
      onClick={onClick}
      count={renderCount(list.isError ? null : list.total)}
    />
  );
}

function QueueTab({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
        active
          ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
          : 'text-content-secondary hover:bg-surface-2'
      }`}
    >
      <span className="max-w-[10rem] truncate">{label}</span>
      <span
        aria-hidden="true"
        className={`tabular rounded-sm px-1 text-2xs ${
          active ? 'bg-brand-200 dark:bg-brand-900' : 'bg-inset text-content-tertiary'
        }`}
      >
        {count}
      </span>
    </button>
  );
}
