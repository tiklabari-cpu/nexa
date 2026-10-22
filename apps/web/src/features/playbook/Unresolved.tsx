/**
 * Playbook › Analiz › Çözülemeyen sorular (tm 317.3 · AI-22): the questions the
 * AI could not resolve, grouped by what they ask.
 *
 *   - **The list** is the open clusters of the AI agent by the last seven days'
 *     count; hand-over and abandon rates, a "new" badge for the first 48 hours
 *     and the reason the AI gave up are beside each. An ignored cluster is
 *     still counted but is not in this view until asked for (`status`).
 *   - **Filters** — time, brand, reason, language — keep the clusters that have
 *     such a message and say how many.
 *   - **The surge alarm** (AI-22-S2): the number of messages one cluster
 *     gathers in an hour that tells the workspace's admins; set here.
 *   - A row opens `ClusterDetail`: the masked examples and the moves.
 *
 * Who: the tab is drawn for whoever may read the AI's configuration
 * (`agents-bot--all:ro`/`:rw`, PlaybookPage); a team member has neither.
 * Acting — ignore, fix, merge, add knowledge, the threshold — needs `:rw`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  UNRESOLVED_LIST_SORTS,
  UNRESOLVED_LIST_STATUSES,
  UNRESOLVED_NEW_HOURS,
  UNRESOLVED_REASONS,
  UNRESOLVED_SPIKE_THRESHOLD_MAX,
  UNRESOLVED_SPIKE_THRESHOLD_MIN,
  UNRESOLVED_SPIKE_WINDOW_MINUTES,
  type UnresolvedListSort,
  type UnresolvedListStatus,
  type UnresolvedReason,
} from '@siyahtus/types';
import { Card, CardSkeleton } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatCount, formatDate, formatRate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  DEFAULT_UNRESOLVED_FILTERS,
  languageFilterOf,
  spikeThresholdOf,
  unresolvedFiltersActive,
  unresolvedKeys,
  unresolvedListPath,
  type UnresolvedClusterList,
  type UnresolvedFilters,
  type UnresolvedSettings,
} from './ai-unresolved.js';
import { CLUSTER_STATUS_TONE, ClusterDetail } from './ClusterDetail.js';
import type { Skill } from './types.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';
const field = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary';

interface BrandOption {
  id: string;
  name: string;
}

export function Unresolved({
  agentId,
  skills,
  canEdit,
}: {
  agentId: string;
  skills: readonly Pick<Skill, 'id' | 'name' | 'mode' | 'locked' | 'ai_agent_id'>[];
  canEdit: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [filters, setFilters] = useState<UnresolvedFilters>(DEFAULT_UNRESOLVED_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: unresolvedKeys.list(agentId, filters),
    queryFn: () => api.get<UnresolvedClusterList>(unresolvedListPath(agentId, filters)),
  });
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<{ items: BrandOption[] }>('/brands'),
    staleTime: 60_000,
  });

  const set = <K extends keyof UnresolvedFilters>(key: K, value: UnresolvedFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  if (openId) {
    return (
      <ClusterDetail
        key={openId}
        agentId={agentId}
        clusterId={openId}
        clusters={list.data?.clusters ?? []}
        skills={skills}
        canEdit={canEdit}
        onClose={() => setOpenId(null)}
      />
    );
  }

  const clusters = list.data?.clusters ?? [];
  const filtered = unresolvedFiltersActive(filters);
  const languageInvalid =
    filters.language.trim() !== '' && languageFilterOf(filters.language) === null;

  return (
    <section
      aria-label={t('playbook.unresolved.title')}
      data-testid="ai-unresolved"
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-sm font-semibold">{t('playbook.unresolved.title')}</h2>
        <p className="mt-0.5 text-2xs text-content-tertiary">
          {t('playbook.unresolved.description', { hours: UNRESOLVED_NEW_HOURS })}
        </p>
      </div>

      <Card>
        <form
          className="flex flex-wrap items-end gap-3 px-4 py-3"
          aria-label={t('playbook.unresolved.filters.title')}
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.unresolved.filters.status')}
            <select
              value={filters.status}
              onChange={(event) => set('status', event.target.value as UnresolvedListStatus)}
              className={field}
            >
              {UNRESOLVED_LIST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`playbook.unresolved.filters.statusOption.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.unresolved.filters.sort')}
            <select
              value={filters.sort}
              onChange={(event) => set('sort', event.target.value as UnresolvedListSort)}
              className={field}
            >
              {UNRESOLVED_LIST_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {t(`playbook.unresolved.filters.sortOption.${sort}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.unresolved.filters.reason')}
            <select
              value={filters.reason}
              onChange={(event) => set('reason', event.target.value as UnresolvedReason | '')}
              className={field}
            >
              <option value="">{t('playbook.unresolved.filters.any')}</option>
              {UNRESOLVED_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {t(`playbook.unresolved.reason.${reason}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.unresolved.filters.brand')}
            <select
              value={filters.brandId}
              onChange={(event) => set('brandId', event.target.value)}
              className={field}
            >
              <option value="">{t('playbook.unresolved.filters.any')}</option>
              {(brands.data?.items ?? []).map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.unresolved.filters.language')}
            <input
              value={filters.language}
              maxLength={2}
              placeholder={t('playbook.unresolved.filters.languagePlaceholder')}
              aria-invalid={languageInvalid}
              onChange={(event) => set('language', event.target.value)}
              className={`${field} w-20`}
            />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.unresolved.filters.from')}
            <input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => set('from', event.target.value)}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.unresolved.filters.to')}
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => set('to', event.target.value)}
              className={field}
            />
          </label>
          {filtered && (
            <button
              type="button"
              className={button}
              onClick={() => setFilters(DEFAULT_UNRESOLVED_FILTERS)}
            >
              {t('playbook.unresolved.filters.clear')}
            </button>
          )}
        </form>
      </Card>

      <Card>
        {list.isPending ? (
          <CardSkeleton rows={4} />
        ) : list.isError ? (
          <LoadError
            compact
            title={t('playbook.unresolved.loadFailed')}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
        ) : clusters.length === 0 ? (
          <EmptyState
            title={t(
              filtered
                ? 'playbook.unresolved.emptyFilteredTitle'
                : 'playbook.unresolved.emptyTitle',
            )}
            description={t(
              filtered
                ? 'playbook.unresolved.emptyFilteredDescription'
                : 'playbook.unresolved.emptyDescription',
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{t('playbook.unresolved.title')}</caption>
              <thead className="text-2xs text-content-tertiary">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('playbook.unresolved.col.question')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t('playbook.unresolved.col.count7d')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t('playbook.unresolved.col.total')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t('playbook.unresolved.col.handoff')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t('playbook.unresolved.col.abandon')}
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    {t('playbook.unresolved.col.firstSeen')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('playbook.unresolved.col.status')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {clusters.map((cluster) => (
                  <tr key={cluster.id}>
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <button
                        type="button"
                        className="text-left text-sm font-medium text-content-primary underline-offset-2 hover:underline"
                        onClick={() => setOpenId(cluster.id)}
                      >
                        {cluster.label}
                      </button>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-content-tertiary">
                        {cluster.is_new && <span>{t('playbook.unresolved.badge.new')}</span>}
                        {cluster.reasons[0] && (
                          <span>
                            {t(`playbook.unresolved.reason.${cluster.reasons[0].reason}`)}
                          </span>
                        )}
                        {cluster.matching_count !== null && (
                          <span>
                            {t('playbook.unresolved.matching', {
                              count: formatCount(cluster.matching_count) ?? '0',
                            })}
                          </span>
                        )}
                      </span>
                    </th>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCount(cluster.count_7d)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatCount(cluster.item_count)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatRate(cluster.handoff_rate)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatRate(cluster.abandon_rate)}
                    </td>
                    <td className="px-2 py-2">{formatDate(cluster.first_seen)}</td>
                    <td className="px-4 py-2">
                      <StatusDot
                        tone={CLUSTER_STATUS_TONE[cluster.status]}
                        label={t(`playbook.unresolved.status.${cluster.status}`)}
                      />
                      {cluster.status === 'resolved' && cluster.post_fix_count > 0 && (
                        <span className="ml-2 text-2xs text-content-tertiary">
                          {t('playbook.unresolved.afterFix', {
                            count: formatCount(cluster.post_fix_count) ?? '0',
                          })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.unclustered_count > 0 && (
          <p className="border-t border-border px-4 py-2 text-2xs text-content-tertiary">
            {t('playbook.unresolved.unclustered', {
              count: formatCount(list.data.unclustered_count) ?? '0',
            })}
          </p>
        )}
      </Card>

      <SpikeThreshold agentId={agentId} canEdit={canEdit} />
    </section>
  );
}

/** The surge alarm's number (AI-22-S2). */
function SpikeThreshold({
  agentId,
  canEdit,
}: {
  agentId: string;
  canEdit: boolean;
}): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: unresolvedKeys.settings,
    queryFn: () => api.get<UnresolvedSettings>('/ai/unresolved/settings'),
  });
  const save = useMutation({
    mutationFn: (value: number) =>
      api.put<UnresolvedSettings>('/ai/unresolved/settings', { spike_threshold: value }),
    onSuccess: (saved) => {
      queryClient.setQueryData(unresolvedKeys.settings, saved);
      void queryClient.invalidateQueries({ queryKey: unresolvedKeys.all(agentId) });
      setDraft(null);
    },
  });

  if (!settings.data) return null;
  const value = draft ?? String(settings.data.spike_threshold);
  const parsed = spikeThresholdOf(value);

  return (
    <Card>
      <form
        aria-label={t('playbook.unresolved.alarm.title')}
        className="flex flex-col gap-2 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed !== null) save.mutate(parsed);
        }}
      >
        <h3 className="text-xs font-semibold">{t('playbook.unresolved.alarm.title')}</h3>
        <p className="text-2xs text-content-tertiary">
          {t('playbook.unresolved.alarm.description', {
            minutes: UNRESOLVED_SPIKE_WINDOW_MINUTES,
          })}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.unresolved.alarm.threshold')}
            <input
              inputMode="numeric"
              value={value}
              disabled={!canEdit}
              aria-invalid={parsed === null}
              onChange={(event) => setDraft(event.target.value)}
              className={`${field} w-24`}
            />
          </label>
          {canEdit && (
            <button
              type="submit"
              className={primaryButton}
              disabled={save.isPending || parsed === null || draft === null}
            >
              {t('playbook.unresolved.alarm.save')}
            </button>
          )}
          <p className="text-2xs text-content-tertiary">
            {t('playbook.unresolved.alarm.range', {
              min: UNRESOLVED_SPIKE_THRESHOLD_MIN,
              max: UNRESOLVED_SPIKE_THRESHOLD_MAX,
              default: settings.data.default_threshold,
            })}
          </p>
        </div>
        {save.isError && (
          <p role="alert" className="text-2xs text-danger">
            {t(errorMessageKey(save.error))}
          </p>
        )}
      </form>
    </Card>
  );
}
