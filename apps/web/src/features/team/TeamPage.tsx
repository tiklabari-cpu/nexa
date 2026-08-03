/**
 * Team — who is on the licence and how work reaches them.
 *
 * Teams are shown next to teammates rather than on a separate screen because
 * they are the same question from two directions: an agent sees a conversation
 * *because* a team they belong to has access to it, and routing picks between
 * available agents using their priority within that team (ADR-08).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { InviteTeammates, PendingInvitations } from './InviteTeammates.js';
import { TeamAiPerformance } from './TeamAiPerformance.js';
import { CopilotKnowledge } from './CopilotKnowledge.js';
import { AgentSkills, type Expertise } from './AgentSkills.js';

type Role = 'owner' | 'viceowner' | 'admin' | 'agent';

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

interface Group {
  id: number;
  name: string;
  language_code: string;
  agents: Array<{ agent_id: string; priority: 'primary' | 'first' | 'normal' | 'last' }>;
}

/** Roles are coarse ranks; the server enforces the same order (ROLE_RANK). */
const ROLE_RANK: Record<Role, number> = { owner: 3, viceowner: 2, admin: 1, agent: 0 };

function roleAtLeast(role: string | null, minimum: Role): boolean {
  return role != null && role in ROLE_RANK && ROLE_RANK[role as Role] >= ROLE_RANK[minimum];
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
    queryFn: () => api.get<{ items: Group[] }>('/groups'),
  });

  const items = useMemo(() => agents.data?.items ?? [], [agents.data]);
  const suspendedItems = useMemo(() => suspended.data?.items ?? [], [suspended.data]);
  const botItems = useMemo(() => chatbots.data?.items ?? [], [chatbots.data]);
  const accepting = items.filter((a) => a.routing_status === 'accepting_chats').length;
  const capacity = items
    .filter((a) => a.routing_status === 'accepting_chats')
    .reduce((sum, a) => sum + a.concurrent_chats_limit, 0);

  const byId = useMemo(() => new Map(items.map((a) => [a.id, a])), [items]);

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
            <Kpi
              label="Chatbots"
              value={formatCount(chatbots.data ? botItems.length : null)}
              hint="Free — bots never use a seat"
            />
          </KpiGrid>

          <Section title="Pending invitations">
            <Card>
              <PendingInvitations />
            </Card>
          </Section>

          <Section title="Teammates">
            <Card>
              {agents.isPending ? (
                <ListSkeleton rows={4} />
              ) : items.length === 0 ? (
                <EmptyState
                  title="No teammates yet"
                  description="Invite colleagues so conversations can be shared out."
                />
              ) : (
                <VirtualTable
                  items={items}
                  rowHeight={56}
                  caption="Agents on this licence"
                  colSpan={canManage ? 7 : 6}
                  head={
                    <thead>
                      <tr className="border-b border-border text-left">
                        <Th>Name</Th>
                        <Th>Role</Th>
                        <Th>Availability</Th>
                        <Th align="right">Chat limit</Th>
                        <Th>2FA</Th>
                        <Th>Skills</Th>
                        {canManage && <Th align="right">Manage</Th>}
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
                                <span className="ml-1.5 text-2xs text-content-tertiary">you</span>
                              )}
                            </p>
                            <p className="truncate text-2xs text-content-tertiary">{agent.email}</p>
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
                      <td className="px-4 py-2.5">
                        <AgentSkills agent={agent} canEdit={canManage} />
                      </td>
                      {canManage && (
                        <td className="px-4 py-2.5 text-right">
                          {canSuspend(agent) && (
                            <button
                              type="button"
                              onClick={() =>
                                suspension.mutate({ id: agent.id, suspended: true })
                              }
                              disabled={suspension.isPending}
                              className="text-xs text-danger underline disabled:opacity-40"
                            >
                              Suspend
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )}
                />
              )}
            </Card>
          </Section>

          <Section
            title="Chatbots"
            description="Bot accounts answer on their own. They are free — a bot never uses a seat (FR-MOD-04.6)."
          >
            <Card>
              {chatbots.isPending ? (
                <ListSkeleton rows={2} />
              ) : botItems.length === 0 ? (
                <EmptyState
                  title="No chatbots yet"
                  description="Create an AI agent in the Playbook to answer common questions automatically."
                />
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">Bot accounts on this licence</caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      <Th>Name</Th>
                      <Th>Status</Th>
                      <Th align="right">Skills</Th>
                      <Th align="right">Seat cost</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {botItems.map((bot) => (
                      <tr key={bot.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-medium">{bot.name}</td>
                        <td className="px-4 py-2.5">
                          <StatusDot
                            tone={bot.active ? 'success' : 'neutral'}
                            label={bot.active ? 'Active' : 'Off'}
                          />
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-content-secondary">
                          {formatCount(bot.skills_count)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-2xs font-medium text-success">
                          Free
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </Section>

          {/* AI agents (team side) — per-agent performance + Copilot knowledge
              management, the two AI entries the Team screen owns (FR-MOD-04.2). */}
          <TeamAiPerformance />

          <CopilotKnowledge />

          <Section
            title="Suspended"
            description="Suspended agents keep their teams and history but cannot sign in, take chats or use a seat until reinstated."
          >
            <Card>
              {suspended.isPending ? (
                <ListSkeleton rows={2} />
              ) : suspendedItems.length === 0 ? (
                <EmptyState
                  title="Nobody is suspended"
                  description="Suspend a teammate from the list above when they should no longer be assigned work."
                />
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">Suspended agents</caption>
                  <thead>
                    <tr className="border-b border-border text-left">
                      <Th>Name</Th>
                      <Th>Role</Th>
                      {canManage && <Th align="right">Manage</Th>}
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
                        <td className="px-4 py-2.5 capitalize text-content-secondary">
                          {agent.role}
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
                                className="text-xs text-brand-600 underline disabled:opacity-40 dark:text-brand-400"
                              >
                                Reinstate
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
