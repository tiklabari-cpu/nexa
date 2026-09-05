/**
 * Team → Teams (FR-MOD-04.1's third entity group; console screen FR-MOD-04.5).
 *
 * Lifted out of `TeamPage.tsx` so `/app/team/teams` is a real deep-linkable
 * route (`TeamTabs.tsx`) rather than a scroll position on the Teammates page.
 * Nothing about `Teams.tsx` itself changed — same query key
 * (`['team','groups']`), same props — only where it is mounted.
 */
import { useMemo, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Page } from '../../components/Page.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { TeamTabs } from './TeamTabs.js';
import { Teams } from './Teams.js';

interface Agent {
  id: string;
  name: string;
}

export function TeamsPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const scopes = useAuth((s) => s.agent?.scopes) ?? [];
  const canManageTeams = scopes.includes('groups--all:rw');

  // Shares `['team', 'agents']` with `TeamPage.tsx`'s own roster read — React
  // Query dedupes the key, so switching tabs never doubles the request once
  // both have been visited in the same session.
  const agents = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: Agent[] }>('/agents'),
  });
  const items = useMemo(() => agents.data?.items ?? [], [agents.data]);

  return (
    <Page
      title={t('team.page.title')}
      description={t('team.teamsPage.description')}
      actions={<TeamTabs />}
    >
      <Teams agents={items} canManage={canManageTeams} />
    </Page>
  );
}
