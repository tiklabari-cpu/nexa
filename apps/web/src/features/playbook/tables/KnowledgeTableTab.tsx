/**
 * One structured table's tab: its rows, and add / edit / delete / "Gözden
 * geçirdim", CSV import and export (tm 310.5 · AI-13).
 *
 * A row past its review date wears a "due for review" badge with the date it
 * fell due — the AI still uses it, so the badge asks for a look rather than
 * saying anything stopped. "Reviewed" is a confirmation, not an edit: it moves
 * `reviewed_at` to now and nothing the AI says changes. A row an integration
 * wrote cannot be edited by hand (the server refuses it), so its edit button
 * is not drawn; it can still be reviewed and deleted.
 *
 * Every write to these tables waits for the AI configuration's approval and
 * never takes the fast path — said in place, once, so an admin who saves a row
 * and finds the AI unchanged knows why.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { KnowledgeTable } from '@siyahtus/types';
import { EmptyState } from '../../../components/EmptyState.js';
import { LoadError } from '../../../components/LoadError.js';
import { Skeleton } from '../../../components/Skeleton.js';
import { Banner } from '../../../components/ui/Banner.js';
import { useConfirm } from '../../../components/ui/ConfirmDialog.js';
import { errorMessageKey } from '../../../lib/api-client.js';
import { useApiClient } from '../../../lib/auth-store.js';
import { formatDate } from '../../../lib/format.js';
import { useTranslate } from '../../../lib/i18n.js';
import { KnowledgeTableForm } from './KnowledgeTableForm.js';
import { KnowledgeTableImport } from './KnowledgeTableImport.js';
import { LIST_COLUMNS, cellText, segmentOf, type CellFormat, type TableRow } from './table-form.js';

/** The rows of one table — the panel and the tab read the same cache entry. */
export function useTableRows(table: KnowledgeTable) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['knowledge-tables', table],
    queryFn: () => api.get<{ items: TableRow[] }>(`/knowledge-tables/${segmentOf(table)}`),
  });
}

type Mode =
  { kind: 'idle' } | { kind: 'add' } | { kind: 'import' } | { kind: 'edit'; row: TableRow };

const BUTTON =
  'rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-60';

export function KnowledgeTableTab({
  table,
  canEdit,
  methods,
}: {
  table: KnowledgeTable;
  canEdit: boolean;
  methods: Array<{ id: string; name: string }>;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const rows = useTableRows(table);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [staleOnly, setStaleOnly] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['knowledge-tables', table] });
  const afterSave = (): void => {
    setMode({ kind: 'idle' });
    void refresh();
  };

  const review = useMutation({
    mutationFn: (row: TableRow) =>
      api.post<TableRow>(`/knowledge-tables/${segmentOf(table)}/${row.id}/review`, {}),
    onSuccess: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: (row: TableRow) => api.delete(`/knowledge-tables/${segmentOf(table)}/${row.id}`),
    onSuccess: () => void refresh(),
  });

  async function exportCsv(): Promise<void> {
    setExportError(null);
    try {
      const { blob, filename } = await api.getFile(`/knowledge-tables/${segmentOf(table)}/export`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? `${segmentOf(table)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setExportError(t(errorMessageKey(cause)));
    }
  }

  const format: CellFormat = {
    yes: t('playbook.tables.cell.yes'),
    no: t('playbook.tables.cell.no'),
    none: t('playbook.tables.cell.none'),
    date: (iso) => formatDate(iso) ?? iso,
    option: (value) => t(`playbook.tables.option.${value}`),
  };

  if (rows.isPending) {
    return (
      <div aria-hidden="true" className="flex animate-pulse flex-col gap-2 p-4">
        <Skeleton width="60%" />
        <Skeleton width="40%" />
      </div>
    );
  }
  if (rows.isError) {
    return (
      <LoadError
        title={t('playbook.tables.loadError')}
        error={rows.error}
        onRetry={() => void rows.refetch()}
      />
    );
  }

  const items = rows.data.items;
  const staleItems = items.filter((row) => row.stale);
  const visible = staleOnly ? staleItems : items;
  const columns = LIST_COLUMNS[table];

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => setMode({ kind: 'add' })}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              {t('playbook.tables.actions.add')}
            </button>
            <button
              type="button"
              aria-expanded={mode.kind === 'import'}
              onClick={() =>
                setMode(mode.kind === 'import' ? { kind: 'idle' } : { kind: 'import' })
              }
              className={BUTTON}
            >
              {t('playbook.tables.actions.import')}
            </button>
          </>
        )}
        <button type="button" onClick={() => void exportCsv()} className={BUTTON}>
          {t('playbook.tables.actions.export')}
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-2xs text-content-secondary">
          <input
            type="checkbox"
            checked={staleOnly}
            onChange={(event) => setStaleOnly(event.target.checked)}
          />
          {t('playbook.tables.filter.staleOnly', { count: staleItems.length })}
        </label>
      </div>
      {exportError && <Banner tone="danger">{exportError}</Banner>}
      <p className="text-2xs text-content-tertiary">{t('playbook.tables.approvalNote')}</p>

      {mode.kind === 'add' && (
        <KnowledgeTableForm
          table={table}
          row={null}
          methods={methods}
          onSaved={afterSave}
          onCancel={() => setMode({ kind: 'idle' })}
        />
      )}
      {mode.kind === 'edit' && (
        <KnowledgeTableForm
          key={mode.row.id}
          table={table}
          row={mode.row}
          methods={methods}
          onSaved={afterSave}
          onCancel={() => setMode({ kind: 'idle' })}
        />
      )}
      {mode.kind === 'import' && (
        <KnowledgeTableImport
          table={table}
          onImported={() => {
            void refresh();
          }}
        />
      )}

      {review.isError && <Banner tone="danger">{t(errorMessageKey(review.error))}</Banner>}
      {remove.isError && <Banner tone="danger">{t(errorMessageKey(remove.error))}</Banner>}

      {items.length === 0 ? (
        <EmptyState
          title={t(`playbook.tables.empty.${table}.title`)}
          description={t(`playbook.tables.empty.${table}.description`)}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={t('playbook.tables.empty.noneStale.title')}
          description={t('playbook.tables.empty.noneStale.description')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t(`playbook.tables.tab.${table}`)}</caption>
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-wide text-content-tertiary">
                {columns.map((column) => (
                  <th key={column} scope="col" className="px-2 py-1.5 font-medium">
                    {t(`playbook.tables.col.${column}`)}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 font-medium">
                  {t('playbook.tables.col.review')}
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  <span className="sr-only">{t('playbook.tables.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const label = cellText(columns[0]!, row, format);
                return (
                  <tr key={row.id} className="border-b border-border align-top">
                    {columns.map((column, index) => (
                      <td key={column} className={`px-2 py-2 ${index === 0 ? 'font-medium' : ''}`}>
                        {cellText(column, row, format)}
                        {index === 0 && row.source === 'integration' && (
                          <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-2xs text-content-tertiary">
                            {t('playbook.tables.badge.integration')}
                          </span>
                        )}
                        {index === 0 && row.brand_ids.length > 0 && (
                          <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-2xs text-content-tertiary">
                            {t('playbook.tables.badge.brands', { count: row.brand_ids.length })}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      {row.stale ? (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning">
                          {t('playbook.tables.badge.stale', {
                            date: formatDate(row.review_due_at) ?? row.review_due_at,
                          })}
                        </span>
                      ) : (
                        <span className="text-2xs text-content-tertiary">
                          {t('playbook.tables.reviewedOn', {
                            date: formatDate(row.reviewed_at) ?? row.reviewed_at,
                          })}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {canEdit && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {row.source !== 'integration' && (
                            <button
                              type="button"
                              aria-label={t('playbook.tables.actions.editNamed', { name: label })}
                              onClick={() => setMode({ kind: 'edit', row })}
                              className={BUTTON}
                            >
                              {t('playbook.tables.actions.edit')}
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={t('playbook.tables.actions.reviewNamed', { name: label })}
                            disabled={review.isPending}
                            onClick={() => review.mutate(row)}
                            className={BUTTON}
                          >
                            {t('playbook.tables.actions.review')}
                          </button>
                          <button
                            type="button"
                            aria-label={t('playbook.tables.actions.deleteNamed', { name: label })}
                            onClick={() =>
                              confirm({
                                title: t('playbook.tables.delete.title', { name: label }),
                                description: t('playbook.tables.delete.description'),
                                failureTitle: t('playbook.tables.delete.failure', { name: label }),
                                onConfirm: () => remove.mutateAsync(row),
                              })
                            }
                            className={`${BUTTON} text-danger`}
                          >
                            {t('playbook.tables.actions.delete')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
    </div>
  );
}
