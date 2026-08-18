/**
 * Campaigns — proactive, targeted messages (FR-MOD-03.3).
 *
 * The Customers area's third face, beside Contacts and the live board: create a
 * trigger-plus-message campaign and, while it runs, it reaches the visitors on a
 * matching page. Status sub-tabs (FR-MOD-03.3.1) split the list into Ongoing,
 * Scheduled and Inactive; each card carries the campaign's Displayed / Chats /
 * Conversion numbers and an on/off toggle (FR-MOD-03.3.3).
 *
 * Creating and toggling are `customers:rw`; an agent with only `customers:ro`
 * sees the list and its numbers but not the controls that change them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Page } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { Banner } from '../../components/ui/index.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { CustomersTabs } from '../customers/CustomersTabs.js';
import { CampaignBuilder } from './CampaignBuilder.js';
import {
  CAMPAIGN_TABS,
  campaignCounts,
  conversionRate,
  filterCampaigns,
  isCampaignActive,
} from './campaigns.js';
import type { Campaign, CampaignStatus, CampaignStatusFilter } from '@nexa/types';

const STATUS_TONE: Record<CampaignStatus, StatusTone> = {
  ongoing: 'success',
  scheduled: 'warning',
  inactive: 'neutral',
};

/** `CAMPAIGN_STATUS_LABEL`/`CAMPAIGN_TABS[].label` are English-only (see campaigns.ts). */
const STATUS_LABEL_KEY: Record<CampaignStatus, string> = {
  ongoing: 'campaigns.status.ongoing',
  scheduled: 'campaigns.status.scheduled',
  inactive: 'campaigns.status.inactive',
};

const TAB_LABEL_KEY: Record<CampaignStatusFilter, string> = {
  all: 'campaigns.tab.all',
  ongoing: 'campaigns.tab.ongoing',
  scheduled: 'campaigns.tab.scheduled',
  inactive: 'campaigns.tab.inactive',
};

export function CampaignsPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes) ?? [];
  const canWrite = scopes.includes('customers:rw');

  const [filter, setFilter] = useState<CampaignStatusFilter>('all');
  // `null` closed, `'new'` the create form, a campaign the edit form.
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<{ items: Campaign[]; total: number }>('/campaigns'),
  });
  const campaigns = query.data?.items ?? [];
  const counts = campaignCounts(campaigns);
  const visible = filterCampaigns(campaigns, filter);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  };

  const toggle = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      api.patch<Campaign>(`/campaigns/${input.id}`, { active: input.active }),
    onSuccess: (campaign, input) => {
      invalidate();
      if (input.active && campaign.performance.displayed > 0) {
        setNotice(
          t('campaigns.page.notice.reached', {
            name: campaign.name,
            count: campaign.performance.displayed,
            formatted: formatCount(campaign.performance.displayed) ?? '0',
          }),
        );
      }
    },
  });

  return (
    <Page
      title={t('customers.page.title')}
      description={t('campaigns.page.description')}
      actions={<CustomersTabs />}
    >
      {notice && (
        <div className="mb-3">
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t('campaigns.page.statusAriaLabel')} className="flex flex-wrap gap-1">
          {CAMPAIGN_TABS.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-brand-100 font-medium text-brand-700 dark:bg-brand-950 dark:text-content'
                    : 'text-content-secondary hover:bg-surface-2'
                }`}
              >
                {t(TAB_LABEL_KEY[tab.id])}
                <span className="ml-1.5 text-2xs text-content-tertiary">{counts[tab.id]}</span>
              </button>
            );
          })}
        </nav>

        {canWrite && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white"
          >
            {t('campaigns.page.new')}
          </button>
        )}
      </div>

      {query.error ? (
        <ErrorNotice message={t('campaigns.page.loadError')} />
      ) : query.isPending ? (
        <Card>
          <ListSkeleton />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title={
              filter === 'all'
                ? t('campaigns.page.empty.allTitle')
                : t('campaigns.page.empty.filteredTitle', { status: t(TAB_LABEL_KEY[filter]) })
            }
            description={t(
              canWrite
                ? 'campaigns.page.empty.writeDescription'
                : 'campaigns.page.empty.readDescription',
            )}
            action={
              canWrite && filter === 'all' ? (
                <button
                  type="button"
                  onClick={() => setEditing('new')}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white"
                >
                  {t('campaigns.page.new')}
                </button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3">
          {visible.map((campaign) => (
            <li key={campaign.id}>
              <CampaignCard
                campaign={campaign}
                canWrite={canWrite}
                busy={toggle.isPending}
                onEdit={() => setEditing(campaign)}
                onToggle={() =>
                  toggle.mutate({ id: campaign.id, active: !isCampaignActive(campaign) })
                }
              />
            </li>
          ))}
        </ul>
      )}

      {editing && canWrite && (
        <CampaignBuilder
          campaign={editing === 'new' ? null : editing}
          api={api}
          onClose={() => setEditing(null)}
          onSaved={({ campaign, reached }) => {
            setEditing(null);
            invalidate();
            if (reached > 0) {
              setNotice(
                t('campaigns.page.notice.reached', {
                  name: campaign.name,
                  count: reached,
                  formatted: formatCount(reached) ?? '0',
                }),
              );
            }
          }}
        />
      )}
    </Page>
  );
}

function CampaignCard({
  campaign,
  canWrite,
  busy,
  onEdit,
  onToggle,
}: {
  campaign: Campaign;
  canWrite: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
}): ReactElement {
  const t = useTranslate();
  const active = isCampaignActive(campaign);
  const { displayed, chats, conversion } = campaign.performance;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium">{campaign.name}</h3>
            <StatusDot
              tone={STATUS_TONE[campaign.status]}
              label={t(STATUS_LABEL_KEY[campaign.status])}
            />
          </div>
          <p className="mt-1 truncate text-xs text-content-secondary">
            {t('campaigns.page.whenUrlContains')}{' '}
            <code className="rounded-sm bg-inset px-1 py-0.5 text-2xs">
              {campaign.conditions.url_contains ?? '—'}
            </code>
          </p>
          {(campaign.starts_at || campaign.ends_at) && (
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {campaign.starts_at
                ? t('campaigns.page.fromDate', { date: formatDate(campaign.starts_at) ?? '' })
                : t('campaigns.page.fromNow')}
              {campaign.ends_at
                ? t('campaigns.page.untilDate', { date: formatDate(campaign.ends_at) ?? '' })
                : ''}
            </p>
          )}
        </div>

        {canWrite && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary hover:bg-surface-2"
            >
              {t('campaigns.page.edit')}
            </button>
            <button
              type="button"
              onClick={onToggle}
              disabled={busy}
              aria-pressed={active}
              className={`rounded-md border px-2 py-1 text-2xs font-medium transition-colors disabled:opacity-40 ${
                active
                  ? 'border-border text-content-secondary hover:bg-surface-2'
                  : 'border-brand-500 text-content-brand hover:bg-brand-50 dark:hover:bg-brand-950'
              }`}
            >
              {active ? t('campaigns.page.turnOff') : t('campaigns.page.turnOn')}
            </button>
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
        <Stat label={t('campaigns.page.stat.displayed')} value={formatCount(displayed) ?? '0'} />
        <Stat label={t('campaigns.page.stat.chats')} value={formatCount(chats) ?? '0'} />
        <Stat
          label={t('campaigns.page.stat.conversion')}
          value={formatCount(conversion) ?? '0'}
          hint={displayed > 0 ? `${conversionRate(campaign.performance)}%` : undefined}
        />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): ReactElement {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </dt>
      <dd className="tabular text-lg font-semibold">
        {value}
        {hint && <span className="ml-1 text-2xs font-normal text-content-tertiary">{hint}</span>}
      </dd>
    </div>
  );
}
