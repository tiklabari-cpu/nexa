/**
 * Team → AI agents (FR-MOD-04.1's second entity group; FR-MOD-04.2).
 *
 * Bot accounts, per-agent AI performance and Copilot's own knowledge base —
 * the AI-flavoured sections `TeamPage.tsx` used to carry inline, lifted out so
 * `/app/team/ai-agents` is a real deep-linkable route (`TeamTabs.tsx`) rather
 * than a scroll position on the Teammates page. Nothing else changed: same
 * queries, same markup, same `Th` header cell `TeamPage.tsx` already exports.
 */
import { useMemo, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { Th } from './TeamPage.js';
import { TeamAiPerformance } from './TeamAiPerformance.js';
import { CopilotKnowledge } from './CopilotKnowledge.js';
import { TeamTabs } from './TeamTabs.js';

interface Chatbot {
  id: string;
  name: string;
  active: boolean;
  avatar_url: string | null;
  skills_count: number;
}

export function TeamAiAgentsPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const chatbots = useQuery({
    queryKey: ['team', 'chatbots'],
    queryFn: () => api.get<{ items: Chatbot[] }>('/ai-agents'),
  });
  const botItems = useMemo(() => chatbots.data?.items ?? [], [chatbots.data]);

  return (
    <Page
      title={t('team.page.title')}
      description={t('team.aiAgentsPage.description')}
      actions={<TeamTabs />}
    >
      <Section
        title={t('team.page.chatbots.title')}
        description={t('team.page.chatbots.description')}
      >
        <Card>
          {chatbots.isPending ? (
            <ListSkeleton rows={2} />
          ) : botItems.length === 0 ? (
            <EmptyState
              title={t('team.page.empty.noChatbotsTitle')}
              description={t('team.page.empty.noChatbotsDescription')}
            />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t('team.page.botTable.caption')}</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <Th>{t('team.page.table.name')}</Th>
                  <Th>{t('team.page.botTable.status')}</Th>
                  <Th align="right">{t('team.page.table.skills')}</Th>
                  <Th align="right">{t('team.page.botTable.seatCost')}</Th>
                </tr>
              </thead>
              <tbody>
                {botItems.map((bot) => (
                  <tr key={bot.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{bot.name}</td>
                    <td className="px-4 py-2.5">
                      <StatusDot
                        tone={bot.active ? 'success' : 'neutral'}
                        label={bot.active ? t('team.page.botActive') : t('team.status.off')}
                      />
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-content-secondary">
                      {formatCount(bot.skills_count)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-2xs font-medium text-success">
                      {t('team.page.free')}
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
    </Page>
  );
}
