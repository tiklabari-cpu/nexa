/**
 * Team — who is on the licence and how work reaches them.
 *
 * Teams are shown next to teammates rather than on a separate screen because
 * they are the same question from two directions: an agent sees a conversation
 * *because* a team they belong to has access to it, and routing picks between
 * available agents using their priority within that team (ADR-08).
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactElement } from 'react';
import {
  Card,
  CardSkeleton,
  ErrorNotice,
  Kpi,
  KpiGrid,
  Page,
  Section,
} from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { InviteTeammates, PendingInvitations } from './InviteTeammates.js';

interface Agent {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: 'owner' | 'viceowner' | 'admin' | 'agent';
  routing_status: 'accepting_chats' | 'not_accepting_chats' | 'offline';
  concurrent_chats_limit: number;
  two_factor_enabled: boolean;
}

interface Group {
  id: number;
  name: string;
  language_code: string;
  agents: Array<{ agent_id: string; priority: 'primary' | 'first' | 'normal' | 'last' }>;
}

const STATUS_LABEL: Record<Agent['routing_status'], string> = {
  accepting_chats: 'Accepting chats',
  not_accepting_chats: 'Not accepting',
  offline: 'Offline',
};

const STATUS_TONE: Record<Agent['routing_status'], StatusTone> = {
  accepting_chats: 'success',
  not_accepting_chats: 'warning',
  offline: 'neutral',
};

/** Assignment order within a team — ADR-08 step 2. */
const PRIORITY_ORDER = ['primary', 'first', 'normal', 'last'] as const;

export function TeamPage(): ReactElement {
  const api = useApiClient();
  const currentAgentId = useAuth((s) => s.agent?.account_id ?? null);

  const agents = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: Agent[] }>('/agents'),
  });

  const groups = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Group[] }>('/groups'),
  });

  const items = useMemo(() => agents.data?.items ?? [], [agents.data]);
  const accepting = items.filter((a) => a.routing_status === 'accepting_chats').length;
  const capacity = items
    .filter((a) => a.routing_status === 'accepting_chats')
    .reduce((sum, a) => sum + a.concurrent_chats_limit, 0);

  const byId = useMemo(() => new Map(items.map((a) => [a.id, a])), [items]);

  return (
    <Page title="Team" description="Teammates, availability and the teams routing sends work to.">
      {agents.error || groups.error ? (
        <ErrorNotice message="Could not load the team. Check that the API is reachable and try again." />
      ) : (
        <>
          <div className="mb-6 flex justify-end">
            <InviteTeammates />
          </div>

          <KpiGrid>
            <Kpi label="Teammates" value={formatCount(items.length)} />
            <Kpi
              label="Accepting chats"
              value={formatCount(accepting)}
              tone={accepting === 0 ? 'warn' : 'good'}
              hint={accepting === 0 ? 'Nobody can be assigned work' : undefined}
            />
            <Kpi
              label="Combined capacity"
              value={formatCount(capacity)}
              hint="Concurrent conversations before queueing"
            />
            <Kpi label="Teams" value={formatCount(groups.data?.items.length ?? null)} />
          </KpiGrid>

          <Section title="Pending invitations">
            <Card>
              <PendingInvitations />
            </Card>
          </Section>

          <Section title="Teammates">
            <Card>
              {agents.isPending ? (
                <CardSkeleton rows={4} />
              ) : items.length === 0 ? (
                <EmptyState
                  title="No teammates yet"
                  description="Invite colleagues so conversations can be shared out."
                />
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">Agents on this licence</caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      <Th>Name</Th>
                      <Th>Role</Th>
                      <Th>Availability</Th>
                      <Th align="right">Chat limit</Th>
                      <Th>2FA</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((agent) => (
                      <tr key={agent.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={agent.name} email={agent.email} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {agent.name}
                                {agent.id === currentAgentId && (
                                  <span className="ml-1.5 text-2xs text-content-tertiary">you</span>
                                )}
                              </p>
                              <p className="truncate text-2xs text-content-tertiary">
                                {agent.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 capitalize text-content-secondary">
                          {agent.role}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusDot
                            tone={STATUS_TONE[agent.routing_status]}
                            label={STATUS_LABEL[agent.routing_status]}
                          />
                        </td>
                        <td className="tabular px-4 py-2.5 text-right">
                          {agent.concurrent_chats_limit}
                        </td>
                        <td className="px-4 py-2.5">
                          {/* Absence of 2FA is worth surfacing, not just its presence. */}
                          <StatusDot
                            tone={agent.two_factor_enabled ? 'success' : 'warning'}
                            label={agent.two_factor_enabled ? 'On' : 'Off'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </Section>

          <Section
            title="Teams"
            description="Routing fills the highest priority tier that still has capacity, then the next."
          >
            {groups.isPending ? (
              <CardSkeleton rows={3} />
            ) : (groups.data?.items.length ?? 0) === 0 ? (
              <Card>
                <EmptyState
                  title="No teams yet"
                  description="Teams decide which conversations an agent can see and who gets them first."
                />
              </Card>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                {groups.data!.items.map((group) => (
                  <Card key={group.id}>
                    <div className="border-b border-border px-4 py-2.5">
                      <h3 className="text-sm font-medium">{group.name}</h3>
                      <p className="text-2xs text-content-tertiary">
                        {group.agents.length} member{group.agents.length === 1 ? '' : 's'} ·{' '}
                        {group.language_code.toUpperCase()}
                      </p>
                    </div>

                    {group.agents.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-warning">
                        No members — conversations routed here fall through to the fallback team.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {[...group.agents]
                          .sort(
                            (a, b) =>
                              PRIORITY_ORDER.indexOf(a.priority) -
                              PRIORITY_ORDER.indexOf(b.priority),
                          )
                          .map((member) => (
                            <li
                              key={member.agent_id}
                              className="flex items-center gap-2 px-4 py-2 text-sm"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {byId.get(member.agent_id)?.name ?? 'Former teammate'}
                              </span>
                              <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs capitalize text-content-secondary">
                                {member.priority}
                              </span>
                            </li>
                          ))}
                      </ul>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}

function Th({
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
