/**
 * Playbook › Geçmiş (tm 315 · SiyahTuş analysis AI-21): every change of the
 * AI's configuration, newest first — who, when, which entity, which fields —
 * and, opened, the change side by side (`ChangeDiff`). The same list,
 * narrowed to one entity, is an editor's "Geçmiş" drawer (`entityId`).
 *
 * What a reader sees is the server's answer (`visibility`): the Founder and
 * the Administrator the whole history, a Team Lead their own changes and the
 * publish history. The CSV export is drawn only for the whole history — the
 * server refuses it to anyone else anyway.
 *
 * `?change=<id>` opens one change: the audit log's `ai.*` rows link here, so
 * the trail's field names lead to the values behind them.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  AI_CONFIG_CHANGE_ACTIONS,
  AI_CONFIG_ENTITY_TYPES,
  type AiConfigChangeAction,
  type AiConfigEntityType,
} from '@siyahtus/types';
import { Card } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  EMPTY_HISTORY_FILTERS,
  historyKeys,
  historyQuery,
  type AiConfigChange,
  type AiConfigChangeDetail,
  type AiConfigChangeList,
  type HistoryFilters,
} from './ai-changes.js';
import { ChangeDiff } from './ChangeDiff.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const field = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary';

function linkedChange(): string | null {
  return new URLSearchParams(window.location.search).get('change');
}

export function History({
  entityId = null,
  compact = false,
}: {
  /** One entity's history — an editor's drawer. */
  entityId?: string | null;
  compact?: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(() => (entityId ? null : linkedChange()));
  const [exportError, setExportError] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: historyKeys.list(entityId, filters),
    queryFn: ({ pageParam }) =>
      api.get<AiConfigChangeList>(
        `/ai/changes${historyQuery(filters, entityId, pageParam ? { cursor: pageParam } : {})}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

  const set = <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  async function exportCsv(): Promise<void> {
    setExportError(null);
    try {
      const { blob, filename } = await api.getFile(
        `/ai/changes/export${historyQuery(filters, entityId)}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? 'siyahtus-ai-changes.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setExportError(t(errorMessageKey(cause)));
    }
  }

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const visibility = list.data?.pages[0]?.visibility ?? 'own';

  return (
    <section
      aria-label={t('playbook.history.title')}
      data-testid="ai-history"
      className="flex flex-col gap-4"
    >
      {!compact && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{t('playbook.history.title')}</h2>
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {visibility === 'all'
                ? t('playbook.history.description.all')
                : t('playbook.history.description.own')}
            </p>
          </div>
          {visibility === 'all' && (
            <button type="button" className={button} onClick={() => void exportCsv()}>
              {t('playbook.history.export')}
            </button>
          )}
        </div>
      )}
      {exportError && (
        <p role="alert" className="text-2xs text-danger">
          {exportError}
        </p>
      )}

      {openId && !items.some((change) => change.id === openId) && (
        <ChangeDetail id={openId} onClose={() => setOpenId(null)} />
      )}

      {!compact && (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3 px-4 py-3"
            aria-label={t('playbook.history.filters.title')}
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="flex flex-col gap-1 text-2xs text-content-secondary">
              {t('playbook.history.filters.entity')}
              <select
                value={filters.entityType}
                onChange={(event) => set('entityType', event.target.value as AiConfigEntityType)}
                className={field}
              >
                <option value="">{t('playbook.history.filters.any')}</option>
                {AI_CONFIG_ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`playbook.history.entity.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-2xs text-content-secondary">
              {t('playbook.history.filters.action')}
              <select
                value={filters.action}
                onChange={(event) => set('action', event.target.value as AiConfigChangeAction)}
                className={field}
              >
                <option value="">{t('playbook.history.filters.any')}</option>
                {AI_CONFIG_CHANGE_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {t(`playbook.history.action.${action}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-2xs text-content-secondary">
              {t('playbook.history.filters.from')}
              <input
                type="date"
                value={filters.from}
                onChange={(event) => set('from', event.target.value)}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-2xs text-content-secondary">
              {t('playbook.history.filters.to')}
              <input
                type="date"
                value={filters.to}
                onChange={(event) => set('to', event.target.value)}
                className={field}
              />
            </label>
          </form>
        </Card>
      )}

      {list.isPending ? (
        <ListSkeleton rows={4} />
      ) : list.isError ? (
        <LoadError
          title={t('playbook.history.loadError')}
          error={list.error}
          onRetry={() => void list.refetch()}
          compact={compact}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('playbook.history.empty.title')}
          description={t('playbook.history.empty.description')}
        />
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
          {items.map((change) => (
            <ChangeRow
              key={change.id}
              change={change}
              open={openId === change.id}
              onOpen={() => setOpenId(openId === change.id ? null : change.id)}
              onClose={() => setOpenId(null)}
            />
          ))}
        </ol>
      )}

      {list.hasNextPage && (
        <button
          type="button"
          className={`${button} self-start`}
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('playbook.history.more')}
        </button>
      )}
    </section>
  );
}

function actorLabel(change: AiConfigChange, t: ReturnType<typeof useTranslate>): string {
  if (change.actor.type === 'system') return t('playbook.history.actor.system');
  const name = change.actor.name ?? t('playbook.history.actor.unknown');
  return change.actor.role ? `${name} · ${t(`team.role.${change.actor.role}`)}` : name;
}

function ChangeRow({
  change,
  open,
  onOpen,
  onClose,
}: {
  change: AiConfigChange;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <li className="flex flex-col gap-1 px-4 py-3" data-testid="ai-history-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">{t(`playbook.history.action.${change.action}`)}</span>{' '}
          <span className="text-content-secondary">
            {t(`playbook.history.entity.${change.entity_type}`)}
            {change.entity_name ? ` · ${change.entity_name}` : ''}
          </span>
        </p>
        <time dateTime={change.at} className="text-2xs text-content-tertiary">
          {formatDateTime(change.at) ?? change.at}
        </time>
      </div>
      <p className="text-2xs text-content-tertiary">
        {actorLabel(change, t)}
        {change.fields.length > 0 &&
          ` · ${t('playbook.history.fields', { fields: change.fields.join(', ') })}`}
        {change.note ? ` · ${t(`playbook.history.note.${change.note}`)}` : ''}
        {change.version_id
          ? ` · ${t('playbook.history.version', { id: change.version_id.slice(0, 8) })}`
          : ''}
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={onOpen}
        className="self-start text-2xs text-brand-600 hover:underline"
      >
        {open ? t('playbook.history.hide') : t('playbook.history.show')}
      </button>
      {open && <ChangeDetail id={change.id} onClose={onClose} />}
    </li>
  );
}

function ChangeDetail({ id, onClose }: { id: string; onClose: () => void }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const detail = useQuery({
    queryKey: historyKeys.detail(id),
    queryFn: () => api.get<AiConfigChangeDetail>(`/ai/changes/${encodeURIComponent(id)}`),
  });
  return (
    <Card>
      <div className="flex flex-col gap-3 px-4 py-3" data-testid="ai-history-detail">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {detail.data
              ? `${t(`playbook.history.action.${detail.data.action}`)} · ${t(
                  `playbook.history.entity.${detail.data.entity_type}`,
                )}${detail.data.entity_name ? ` · ${detail.data.entity_name}` : ''}`
              : t('playbook.history.detail.title')}
          </h3>
          <button type="button" className={button} onClick={onClose}>
            {t('playbook.history.detail.close')}
          </button>
        </div>
        {detail.isPending ? (
          <ListSkeleton rows={2} />
        ) : detail.isError ? (
          <LoadError
            title={t('playbook.history.detail.loadError')}
            error={detail.error}
            onRetry={() => void detail.refetch()}
            compact
          />
        ) : (
          <>
            <p className="text-2xs text-content-tertiary">
              {actorLabel(detail.data, t)} · {formatDateTime(detail.data.at) ?? detail.data.at}
            </p>
            <ChangeDiff diff={detail.data.diff} />
          </>
        )}
      </div>
    </Card>
  );
}
