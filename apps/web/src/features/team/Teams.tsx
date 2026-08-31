/**
 * Team → Teams (FR-MOD-04.5 — the write half's console screen).
 *
 * `GET /groups` had shipped alone: a workspace could see the teams it had but
 * had no way to make one, so a freshly opened workspace — no team, no
 * membership — had nowhere to route a conversation (`routes/agents.ts`'s own
 * comment on the write endpoints it later grew). This is the console side of
 * that fix: create a team, rename or retire one, and — through `TeamMembers` —
 * decide who is in it and in what order routing tries them (ADR-08 step 2's
 * priority tiers).
 *
 * Shares the `['team', 'groups']` query key with `TeamPage.tsx`'s own KPI
 * fetch on purpose: React Query dedupes identical keys, so mounting both never
 * doubles the request, and an edit here invalidating the key redraws the KPI
 * too without either side knowing about the other.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GROUP_PRIORITIES, type GroupPriority } from '@nexa/types';
import { Card, CardSkeleton, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { TeamEditor } from './TeamEditor.js';
import { TeamMembers } from './TeamMembers.js';

export interface Group {
  id: number;
  name: string;
  language_code: string;
  agents: Array<{ agent_id: string; priority: GroupPriority }>;
}

interface TeamsProps {
  agents: Array<{ id: string; name: string }>;
  /** Holds `groups--all:rw` (`routes/agents.ts`) — write controls are hidden
   *  for a read-only viewer, the same courtesy `RoleMenu`/`AgentSkills` pay. */
  canManage: boolean;
}

export function Teams({ agents, canManage }: TeamsProps): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const list = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Group[] }>('/groups'),
  });

  const byId = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const groups = list.data?.items ?? [];

  // `null` closed, `'new'` the create form, a group the edit form.
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const [managing, setManaging] = useState<Group | null>(null);

  const newTeamButton = (
    <button
      type="button"
      onClick={() => setEditing('new')}
      className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white"
    >
      {t('team.teams.newButton')}
    </button>
  );

  return (
    <Section title={t('team.page.teams.title')} description={t('team.page.teams.description')}>
      {canManage && !list.isPending && groups.length > 0 && (
        <div className="flex justify-end">{newTeamButton}</div>
      )}

      {list.isPending ? (
        <CardSkeleton rows={3} />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            title={t('team.page.empty.noTeamsTitle')}
            description={t('team.page.empty.noTeamsDescription')}
            action={canManage ? newTeamButton : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {groups.map((group) => (
            <Card key={group.id}>
              <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-2.5">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium">{group.name}</h3>
                  <p className="text-2xs text-content-tertiary">
                    {t('team.page.memberCount', { count: group.agents.length })} ·{' '}
                    {group.language_code.toUpperCase()}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(group)}
                      aria-label={t('team.teams.card.editAriaLabel', { name: group.name })}
                      className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary hover:bg-surface-2"
                    >
                      {t('team.teams.card.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setManaging(group)}
                      aria-label={t('team.teams.card.manageMembersAriaLabel', { name: group.name })}
                      className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary hover:bg-surface-2"
                    >
                      {t('team.teams.card.manageMembers')}
                    </button>
                  </div>
                )}
              </div>

              {group.agents.length === 0 ? (
                <p className="px-4 py-3 text-xs text-warning">{t('team.page.noMembers')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {[...group.agents]
                    .sort(
                      (a, b) =>
                        GROUP_PRIORITIES.indexOf(a.priority) - GROUP_PRIORITIES.indexOf(b.priority),
                    )
                    .map((member) => (
                      <li
                        key={member.agent_id}
                        className="flex items-center gap-2 px-4 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {byId.get(member.agent_id)?.name ?? t('team.page.formerTeammate')}
                        </span>
                        <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
                          {t(`team.priority.${member.priority}`)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {editing !== null && (
        <TeamEditor
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDeleted={() => setEditing(null)}
        />
      )}

      {managing && (
        <TeamMembers group={managing} agents={agents} onClose={() => setManaging(null)} />
      )}
    </Section>
  );
}
