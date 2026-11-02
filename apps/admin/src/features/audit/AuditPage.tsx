/**
 * Audit (tm 391 · FR-ADMIN-05/06): the platform's own signed trail — every operator action,
 * newest first, filterable by operator, action, workspace and time; plus "Verify the chain" and
 * the signed NDJSON export (`ChainSection`).
 *
 * A workspace's own trail is the Audit tab of its detail page (it reads the per-workspace
 * route); this page is the operators' side of the record, where the same action also carries the
 * workspace it concerned. Read-only for every role that holds `audit.read`.
 */
import { useState, type ReactElement } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { AUDIT_ACTIONS } from '../../lib/audit-actions.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformAuditEntry } from '../../lib/platform-types.js';
import { useAdmins } from '../admins/queries.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  Loading,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import { ChainSection } from './ChainSection.js';
import { EMPTY_AUDIT_FILTER, useAuditEntries, type AuditFilter } from './queries.js';

export function AuditPage(): ReactElement {
  const t = useTranslate();
  return (
    <Page title={t('nav.audit')} description={t('shell.pages.audit.description')}>
      <ChainSection />
      <EntriesSection />
    </Page>
  );
}

function EntriesSection(): ReactElement {
  const t = useTranslate();
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_AUDIT_FILTER);
  // The workspace number is typed; only a whole number is sent (the server refuses anything else).
  const licenseValid = filter.licenseId === '' || /^[1-9]\d{0,18}$/.test(filter.licenseId);
  const rangeValid = filter.from === '' || filter.to === '' || filter.from <= filter.to;
  const query = useAuditEntries({
    ...filter,
    licenseId: licenseValid ? filter.licenseId : '',
    ...(rangeValid ? {} : { from: '', to: '' }),
  });
  const admins = useAdmins();
  const operators = admins.data?.data ?? [];
  const entries = query.data?.pages.flatMap((page) => page.data) ?? [];
  const filtered = JSON.stringify(filter) !== JSON.stringify(EMPTY_AUDIT_FILTER);

  const set = <K extends keyof AuditFilter>(key: K, value: AuditFilter[K]): void =>
    setFilter((previous) => ({ ...previous, [key]: value }));

  const emailOf = (id: string | null): string =>
    id === null ? t('audit.entries.nobody') : (operators.find((a) => a.id === id)?.email ?? id);

  return (
    <section aria-labelledby="audit-entries">
      <h2 id="audit-entries" className="mb-3 text-sm font-semibold">
        {t('audit.entries.heading')}
      </h2>
      <Card>
        <form
          aria-label={t('audit.filter.label')}
          onSubmit={(event) => event.preventDefault()}
          className="flex flex-wrap items-end gap-3 p-4"
        >
          <div>
            <label htmlFor="audit-admin" className="text-xs text-content-secondary">
              {t('audit.filter.admin')}
            </label>
            <select
              id="audit-admin"
              value={filter.adminId}
              onChange={(event) => set('adminId', event.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">{t('audit.filter.anyAdmin')}</option>
              {operators.map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="audit-action" className="text-xs text-content-secondary">
              {t('audit.filter.action')}
            </label>
            <select
              id="audit-action"
              value={filter.action}
              onChange={(event) => set('action', event.target.value as AuditFilter['action'])}
              className={FIELD_CLASS}
            >
              <option value="">{t('audit.filter.anyAction')}</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="audit-license" className="text-xs text-content-secondary">
              {t('audit.filter.workspace')}
            </label>
            <input
              id="audit-license"
              inputMode="numeric"
              value={filter.licenseId}
              maxLength={19}
              autoComplete="off"
              aria-invalid={licenseValid ? undefined : 'true'}
              onChange={(event) => set('licenseId', event.target.value.trim())}
              className={`${FIELD_CLASS} w-36`}
            />
          </div>
          <div>
            <label htmlFor="audit-from" className="text-xs text-content-secondary">
              {t('audit.filter.from')}
            </label>
            <input
              id="audit-from"
              type="date"
              value={filter.from}
              onChange={(event) => set('from', event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label htmlFor="audit-to" className="text-xs text-content-secondary">
              {t('audit.filter.to')}
            </label>
            <input
              id="audit-to"
              type="date"
              value={filter.to}
              onChange={(event) => set('to', event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          {filtered && (
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => setFilter(EMPTY_AUDIT_FILTER)}
            >
              {t('audit.filter.clear')}
            </button>
          )}
        </form>
        {(!licenseValid || !rangeValid) && (
          <p role="alert" className="px-4 pb-3 text-xs text-danger">
            {!licenseValid ? t('audit.filter.workspaceInvalid') : t('audit.filter.rangeInvalid')}
          </p>
        )}
        <p className="px-4 pb-3 text-xs text-content-secondary">{t('audit.filter.utc')}</p>

        {query.isError ? (
          <LoadError
            title={t('audit.entries.loadError')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <Loading label={t('audit.entries.loading')} />
        ) : entries.length === 0 ? (
          <EmptyLine>{filtered ? t('audit.entries.noMatch') : t('audit.entries.empty')}</EmptyLine>
        ) : (
          <DataTable
            caption={t('audit.entries.heading')}
            headers={[
              t('audit.col.seq'),
              t('audit.col.at'),
              t('audit.col.admin'),
              t('audit.col.action'),
              t('audit.col.target'),
              t('audit.col.workspace'),
              t('audit.col.reason'),
            ]}
          >
            {entries.map((entry) => (
              <EntryRow key={entry.chain_seq} entry={entry} operator={emailOf(entry.admin_id)} />
            ))}
          </DataTable>
        )}
        {query.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('audit.entries.more')}
            </button>
          </div>
        )}
      </Card>
    </section>
  );
}

function EntryRow({
  entry,
  operator,
}: {
  entry: PlatformAuditEntry;
  operator: string;
}): ReactElement {
  return (
    <tr>
      <Cell>
        <code className="text-xs">{entry.chain_seq}</code>
      </Cell>
      <Cell>{formatDateTime(entry.created_at)}</Cell>
      <Cell>{operator}</Cell>
      <Cell>
        <code className="text-xs">{entry.action}</code>
      </Cell>
      <Cell>
        <span className="block">{entry.target_type}</span>
        {entry.target_id && (
          <code className="block break-all text-xs text-content-secondary">{entry.target_id}</code>
        )}
      </Cell>
      <Cell>{entry.license_id}</Cell>
      <Cell>{entry.reason}</Cell>
    </tr>
  );
}
