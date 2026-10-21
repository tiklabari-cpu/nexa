/**
 * The "Tablolar" view of the AI Agent page (tm 310.5 · AI-13): the four
 * structured knowledge tables — payment methods, bonuses, KYC documents,
 * limits and rules — and the access information card (K13) beside them.
 *
 * The tab labels carry two counts an admin scans for: how many rows the table
 * holds and how many of them are past their review date. The review state is
 * the server's (`stale`, `review_due_at`), read with the rows, so the badge is
 * as live as the list and there is no second place to keep it.
 */
import { useState, type ReactElement } from 'react';
import type { KnowledgeTable } from '@siyahtus/types';
import { useAuth } from '../../../lib/auth-store.js';
import { useTranslate } from '../../../lib/i18n.js';
import { AccessInfoCard } from './AccessInfoCard.js';
import { KnowledgeTableTab, useTableRows } from './KnowledgeTableTab.js';
import { TABLE_TABS, staleCount } from './table-form.js';

function TabLabel({ table }: { table: KnowledgeTable }): ReactElement {
  const t = useTranslate();
  const rows = useTableRows(table);
  const items = rows.data?.items ?? [];
  const stale = staleCount(items);
  return (
    <>
      <span>{t(`playbook.tables.tab.${table}`)}</span>
      {rows.isSuccess && (
        <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-2xs text-content-secondary">
          {items.length}
        </span>
      )}
      {stale > 0 && (
        <span
          className="ml-1 rounded-full bg-warning/15 px-1.5 text-2xs font-medium text-warning"
          title={t('playbook.tables.tabStale', { count: stale })}
        >
          {t('playbook.tables.tabStaleBadge', { count: stale })}
        </span>
      )}
    </>
  );
}

export function TablesPanel(): ReactElement {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canEdit = scopes.includes('agents-bot--all:rw');
  const [table, setTable] = useState<KnowledgeTable>('payment_methods');
  // A bonus may exclude payment methods; the form offers the ones that exist.
  const methods = useTableRows('payment_methods');
  const methodOptions = (methods.data?.items ?? []).map((row) => ({
    id: row.id,
    name: String(row['name'] ?? row.id),
  }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-content-secondary">{t('playbook.tables.description')}</p>

      <div className="rounded-lg border border-border bg-surface">
        <div
          role="tablist"
          aria-label={t('playbook.tables.tabsLabel')}
          className="flex flex-wrap gap-1 border-b border-border px-2"
        >
          {TABLE_TABS.map((id) => {
            const active = table === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tables-tab-${id}`}
                aria-selected={active}
                aria-controls="tables-tabpanel"
                onClick={() => setTable(id)}
                className={`-mb-px flex items-center border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-brand-500 text-content'
                    : 'border-transparent text-content-secondary hover:text-content'
                }`}
              >
                <TabLabel table={id} />
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id="tables-tabpanel" aria-labelledby={`tables-tab-${table}`}>
          <KnowledgeTableTab key={table} table={table} canEdit={canEdit} methods={methodOptions} />
        </div>
      </div>

      <AccessInfoCard canEdit={canEdit} />
    </div>
  );
}
