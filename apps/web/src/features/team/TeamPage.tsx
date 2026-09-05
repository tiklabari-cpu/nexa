/**
 * Team → Teammates (FR-MOD-04.1's first entity group) — who is on the licence
 * and how work reaches them.
 *
 * The KPI row still counts teams and chatbots alongside teammates: it is the
 * module's overview, so it stays here on the landing tab rather than
 * following those two entity groups to their own routes (`TeamAiAgentsPage.tsx`,
 * `TeamsPage.tsx`) — see `TeamTabs.tsx` for the navigation between the three,
 * and `#### K04.1` in PLAN.md for why a tab bar rather than a second sidebar.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import { Card, ErrorNotice, Kpi, KpiGrid, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { InviteTeammates, PendingInvitations } from './InviteTeammates.js';
import { AgentSkills, type Expertise } from './AgentSkills.js';
import { RoleMenu, roleAtLeast, type Role } from './RoleMenu.js';
import { TeamTabs } from './TeamTabs.js';
import { WorkSchedule } from './WorkSchedule.js';

interface Agent {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: Role;
  routing_status: 'accepting_chats' | 'not_accepting_chats' | 'offline';
  concurrent_chats_limit: number;
  two_factor_enabled: boolean;
  suspended: boolean;
  expertise: Expertise[];
}

interface Chatbot {
  id: string;
  name: string;
  active: boolean;
  avatar_url: string | null;
  skills_count: number;
}

/** Just enough of `Teams.tsx`'s `Group` shape for the KPI count below. */
interface GroupSummary {
  id: number;
}

/**
 * Suspend / reinstate an agent (FR-MOD-04.6). Invalidates both rosters so the
 * agent hops between the Teammates and Suspended lists without a manual refresh.
 */
export function useSuspension() {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      api.put(`/agents/${id}/suspension`, { suspended }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['team', 'agents'] }),
        client.invalidateQueries({ queryKey: ['team', 'suspended'] }),
      ]);
    },
  });
}

/** Translation key for each routing status — the text itself lives in the catalogue. */
const STATUS_KEY: Record<Agent['routing_status'], string> = {
  accepting_chats: 'team.status.acceptingChats',
  not_accepting_chats: 'team.status.notAccepting',
  offline: 'team.status.offline',
};

const STATUS_TONE: Record<Agent['routing_status'], StatusTone> = {
  accepting_chats: 'success',
  not_accepting_chats: 'warning',
  offline: 'neutral',
};

/** Roster filter options — every rank the roster can hold, in the order RoleMenu ranks them. */
const ROLE_OPTIONS: Role[] = ['owner', 'viceowner', 'admin', 'agent'];
const STATUS_OPTIONS: Agent['routing_status'][] = [
  'accepting_chats',
  'not_accepting_chats',
  'offline',
];
type TwoFactorFilter = '' | 'on' | 'off';

export function TeamPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const currentAgentId = useAuth((s) => s.agent?.account_id ?? null);
  const currentRole = useAuth((s) => s.agent?.role ?? null);
  const suspension = useSuspension();

  const agents = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: Agent[] }>('/agents'),
  });

  const suspended = useQuery({
    queryKey: ['team', 'suspended'],
    queryFn: () => api.get<{ items: Agent[] }>('/agents?status=suspended'),
  });

  const chatbots = useQuery({
    queryKey: ['team', 'chatbots'],
    queryFn: () => api.get<{ items: Chatbot[] }>('/ai-agents'),
  });

  const groups = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: GroupSummary[] }>('/groups'),
  });

  const items = useMemo(() => agents.data?.items ?? [], [agents.data]);
  const suspendedItems = useMemo(() => suspended.data?.items ?? [], [suspended.data]);
  const botItems = useMemo(() => chatbots.data?.items ?? [], [chatbots.data]);
  const accepting = items.filter((a) => a.routing_status === 'accepting_chats').length;
  const capacity = items
    .filter((a) => a.routing_status === 'accepting_chats')
    .reduce((sum, a) => sum + a.concurrent_chats_limit, 0);

  // Teammates search + filters (FR-MOD-04.3.2). The roster already arrives in
  // full on one request (no server paging on `/agents`), so filtering happens
  // client-side rather than round-tripping — the CustomersPage debounce timing
  // is kept for consistency (EK-A.2), not because a request is in flight.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [statusFilter, setStatusFilter] = useState<Agent['routing_status'] | ''>('');
  const [twoFactorFilter, setTwoFactorFilter] = useState<TwoFactorFilter>('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const filteredItems = useMemo(
    () =>
      items.filter((agent) => {
        if (
          debouncedSearch &&
          !`${agent.name} ${agent.email}`.toLowerCase().includes(debouncedSearch)
        ) {
          return false;
        }
        if (roleFilter && agent.role !== roleFilter) return false;
        if (statusFilter && agent.routing_status !== statusFilter) return false;
        if (twoFactorFilter && (twoFactorFilter === 'on') !== agent.two_factor_enabled) {
          return false;
        }
        return true;
      }),
    [items, debouncedSearch, roleFilter, statusFilter, twoFactorFilter],
  );

  // Who this admin may act on. The server is the final word (roles + scope), but
  // an unusable button is worse than an absent one, so the UI mirrors the rule:
  // owner/admin only, never the owner as a target, never yourself.
  const canManage = roleAtLeast(currentRole, 'admin');
  const canSuspend = (agent: Agent): boolean =>
    canManage &&
    agent.id !== currentAgentId &&
    agent.role !== 'owner' &&
    roleAtLeast(currentRole, agent.role);

  return (
    <Page
      title={t('team.page.title')}
      description={t('team.page.description')}
      actions={<TeamTabs />}
    >
      {agents.error || groups.error ? (
        <ErrorNotice message={t('team.page.loadError')} />
      ) : (
        <>
          <div className="mb-6 flex justify-end">
            <InviteTeammates />
          </div>

          <KpiGrid>
            <Kpi label={t('team.page.kpi.teammates')} value={formatCount(items.length)} />
            <Kpi
              label={t('team.page.kpi.acceptingChats')}
              value={formatCount(accepting)}
              tone={accepting === 0 ? 'warn' : 'good'}
              hint={accepting === 0 ? t('team.page.kpi.acceptingChatsHint') : undefined}
            />
            <Kpi
              label={t('team.page.kpi.combinedCapacity')}
              value={formatCount(capacity)}
              hint={t('team.page.kpi.combinedCapacityHint')}
            />
            <Kpi
              label={t('team.page.kpi.teams')}
              value={formatCount(groups.data?.items.length ?? null)}
            />
            <Kpi
              label={t('team.page.kpi.chatbots')}
              value={formatCount(chatbots.data ? botItems.length : null)}
              hint={t('team.page.kpi.chatbotsHint')}
            />
          </KpiGrid>

          <Section title={t('team.page.pendingInvitationsTitle')}>
            <Card>
              <PendingInvitations />
            </Card>
          </Section>

          <Section title={t('team.page.teammatesTitle')}>
            {!agents.isPending && items.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <span className="sr-only">{t('team.page.filters.searchLabel')}</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setSearch(event.target.value)
                    }
                    placeholder={t('team.page.filters.searchPlaceholder')}
                    className="w-64 rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-content-secondary">
                  <span className="sr-only">{t('team.page.filters.roleLabel')}</span>
                  <select
                    value={roleFilter}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setRoleFilter(event.target.value as Role | '')
                    }
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
                  >
                    <option value="">{t('team.page.filters.roleAll')}</option>
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {t(`team.role.${role}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-content-secondary">
                  <span className="sr-only">{t('team.page.filters.statusLabel')}</span>
                  <select
                    value={statusFilter}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setStatusFilter(event.target.value as Agent['routing_status'] | '')
                    }
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
                  >
                    <option value="">{t('team.page.filters.statusAll')}</option>
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {t(STATUS_KEY[status])}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-content-secondary">
                  <span className="sr-only">{t('team.page.filters.twoFactorLabel')}</span>
                  <select
                    value={twoFactorFilter}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setTwoFactorFilter(event.target.value as TwoFactorFilter)
                    }
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none"
                  >
                    <option value="">{t('team.page.filters.twoFactorAll')}</option>
                    <option value="on">{t('team.status.on')}</option>
                    <option value="off">{t('team.status.off')}</option>
                  </select>
                </label>
              </div>
            )}
            <Card>
              {agents.isPending ? (
                <ListSkeleton rows={4} />
              ) : items.length === 0 ? (
                <EmptyState
                  title={t('team.page.empty.noTeammatesTitle')}
                  description={t('team.page.empty.noTeammatesDescription')}
                />
              ) : filteredItems.length === 0 ? (
                <EmptyState
                  title={t('team.page.empty.noMatchesTitle')}
                  description={t('team.page.empty.noMatchesDescription')}
                />
              ) : (
                <VirtualTable
                  items={filteredItems}
                  rowHeight={56}
                  caption={t('team.page.table.caption')}
                  colSpan={canManage ? 7 : 6}
                  head={
                    <thead>
                      <tr className="border-b border-border text-left">
                        <Th>{t('team.page.table.name')}</Th>
                        <Th>{t('team.page.table.role')}</Th>
                        <Th>{t('team.page.table.availability')}</Th>
                        <Th align="right">{t('team.page.table.chatLimit')}</Th>
                        <Th>{t('team.page.table.twoFactor')}</Th>
                        <Th>{t('team.page.table.skills')}</Th>
                        {canManage && <Th align="right">{t('team.page.table.manage')}</Th>}
                      </tr>
                    </thead>
                  }
                  renderRow={(agent) => (
                    <tr key={agent.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={agent.name} email={agent.email} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {agent.name}
                              {agent.id === currentAgentId && (
                                <span className="ml-1.5 text-2xs text-content-tertiary">
                                  {t('team.page.you')}
                                </span>
                              )}
                            </p>
                            <p className="truncate text-2xs text-content-tertiary">{agent.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-content-secondary">
                        {t(`team.role.${agent.role}`)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusDot
                          tone={STATUS_TONE[agent.routing_status]}
                          label={t(STATUS_KEY[agent.routing_status])}
                        />
                      </td>
                      <td className="tabular px-4 py-2.5 text-right">
                        {agent.concurrent_chats_limit}
                      </td>
                      <td className="px-4 py-2.5">
                        {/* Absence of 2FA is worth surfacing, not just its presence. */}
                        <StatusDot
                          tone={agent.two_factor_enabled ? 'success' : 'warning'}
                          label={
                            agent.two_factor_enabled ? t('team.status.on') : t('team.status.off')
                          }
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <AgentSkills agent={agent} canEdit={canManage} />
                      </td>
                      {canManage && (
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-3">
                            {/* Role first, suspension second: one is a change of
                                what someone may do, the other ends their access
                                — and the destructive one reads last. */}
                            <RoleMenu
                              agent={agent}
                              actorRole={currentRole}
                              isSelf={agent.id === currentAgentId}
                            />
                            {canSuspend(agent) && (
                              <button
                                type="button"
                                onClick={() => suspension.mutate({ id: agent.id, suspended: true })}
                                disabled={suspension.isPending}
                                className="text-xs text-danger underline disabled:opacity-40"
                              >
                                {t('team.page.suspendButton')}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )}
                />
              )}
            </Card>
          </Section>

          <WorkSchedule
            agents={items}
            currentAgentId={currentAgentId}
            canManage={canManage}
            loading={agents.isPending}
          />

          <Section
            title={t('team.page.suspended.title')}
            description={t('team.page.suspended.description')}
          >
            <Card>
              {suspended.isPending ? (
                <ListSkeleton rows={2} />
              ) : suspendedItems.length === 0 ? (
                <EmptyState
                  title={t('team.page.empty.nobodySuspendedTitle')}
                  description={t('team.page.empty.nobodySuspendedDescription')}
                />
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('team.page.suspendedTable.caption')}</caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      <Th>{t('team.page.table.name')}</Th>
                      <Th>{t('team.page.table.role')}</Th>
                      {canManage && <Th align="right">{t('team.page.table.manage')}</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {suspendedItems.map((agent) => (
                      <tr key={agent.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={agent.name} email={agent.email} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{agent.name}</p>
                              <p className="truncate text-2xs text-content-tertiary">
                                {agent.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-content-secondary">
                          {t(`team.role.${agent.role}`)}
                        </td>
                        {canManage && (
                          <td className="px-4 py-2.5 text-right">
                            {roleAtLeast(currentRole, agent.role) && (
                              <button
                                type="button"
                                onClick={() =>
                                  suspension.mutate({ id: agent.id, suspended: false })
                                }
                                disabled={suspension.isPending}
                                className="text-xs text-content-brand underline disabled:opacity-40"
                              >
                                {t('team.page.reinstateButton')}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </Section>
        </>
      )}
    </Page>
  );
}

/** Shared with `TeamAiAgentsPage.tsx`'s bot table — one header cell, not two. */
export function Th({
  children,
  align = 'left',
}: {
  children: string;
  align?: 'left' | 'right';
}): ReactElement {
  return (
    <th
      scope="col"
      className={`px-4 py-2 text-xs font-medium text-content-secondary ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Avatar({ name, email }: { name: string; email: string }): ReactElement {
  const initials = (name || email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-2xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-content"
    >
      {initials}
    </span>
  );
}
