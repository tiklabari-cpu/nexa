/**
 * The sign-up blocklist (tm 389.16 · FR-ADMIN-22): the table of what is refused at sign-up, a
 * form to add an address, a domain (and its subdomains) or an IP range, and "Lift" on each row.
 *
 * Both writes go through `ReasonDialog` — the reason lands in the audit chain and on the entry.
 * Reading is open to support and read-only operators; the buttons appear only for the role that
 * may write (`security.manage`), the server enforcing it either way.
 */
import { useState, type ReactElement } from 'react';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/index.js';
import { ApiClientError } from '../../lib/api-client.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { PlatformBlocklistEntry, PlatformBlocklistKind } from '../../lib/platform-types.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import { useAddBlocklistEntry, useBlocklist, useRemoveBlocklistEntry } from './queries.js';
import { LoadMore, Section } from './ui.js';

const KINDS: readonly PlatformBlocklistKind[] = ['email', 'domain', 'ip'];

/** A refusal of the value itself, worded for its kind — the rest fall back to the error's own. */
function describeAddError(
  t: TFunction,
  error: unknown,
  kind: PlatformBlocklistKind,
): string | null {
  if (!(error instanceof ApiClientError) || error.type !== 'validation') return null;
  const reason = error.details?.['reason'];
  if (reason === 'already_listed') return t('security.blocklist.add.alreadyListed');
  if (reason === 'invalid_value') return t(`security.blocklist.add.invalid.${kind}`);
  return null;
}

export function BlocklistSection(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canWrite = hasPermission(me, 'security.manage');
  const [kind, setKind] = useState<PlatformBlocklistKind | ''>('');
  const [search, setSearch] = useState('');
  const query = useBlocklist(kind, search.trim().toLowerCase());
  const add = useAddBlocklistEntry();
  const remove = useRemoveBlocklistEntry();
  const [adding, setAdding] = useState(false);
  const [lifting, setLifting] = useState<PlatformBlocklistEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Section
      id="security-blocklist"
      title={t('security.blocklist.heading')}
      query={query}
      hasData={query.data !== undefined}
      actions={
        canWrite && (
          <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={() => setAdding(true)}>
            {t('security.blocklist.add')}
          </button>
        )
      }
    >
      <div className="flex flex-col">
        <p className="px-4 pt-4 text-sm text-content-secondary">{t('security.blocklist.intro')}</p>
        {notice && (
          <div className="p-4 pb-0">
            <Banner tone="success" dismissible>
              {notice}
            </Banner>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label htmlFor="blocklist-kind" className="text-xs text-content-secondary">
              {t('security.blocklist.filter.kind')}
            </label>
            <select
              id="blocklist-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as PlatformBlocklistKind | '')}
              className={FIELD_CLASS}
            >
              <option value="">{t('security.blocklist.filter.allKinds')}</option>
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`security.kind.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor="blocklist-search" className="text-xs text-content-secondary">
              {t('security.blocklist.filter.search')}
            </label>
            <input
              id="blocklist-search"
              type="search"
              value={search}
              maxLength={320}
              onChange={(event) => setSearch(event.target.value)}
              className={FIELD_CLASS}
            />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyLine>
            {kind !== '' || search.trim() !== ''
              ? t('security.blocklist.noMatch')
              : t('security.blocklist.empty')}
          </EmptyLine>
        ) : (
          <DataTable
            caption={t('security.blocklist.caption')}
            headers={[
              t('security.blocklist.col.kind'),
              t('security.blocklist.col.value'),
              t('security.blocklist.col.reason'),
              t('security.blocklist.col.added'),
              ...(canWrite ? [t('security.blocklist.col.actions')] : []),
            ]}
          >
            {rows.map((entry) => (
              <tr key={entry.id}>
                <Cell>{t(`security.kind.${entry.kind}`)}</Cell>
                <Cell>
                  <code className="break-all text-xs">{entry.value}</code>
                </Cell>
                <Cell>{entry.reason}</Cell>
                <Cell>
                  <span className="block">{formatDateTime(entry.created_at)}</span>
                  <span className="block text-xs text-content-secondary">
                    {entry.created_by_email ?? '—'}
                  </span>
                </Cell>
                {canWrite && (
                  <Cell>
                    <button
                      type="button"
                      className={SECONDARY_BUTTON_CLASS}
                      aria-label={t('security.blocklist.liftLabel', { value: entry.value })}
                      onClick={() => setLifting(entry)}
                    >
                      {t('security.blocklist.lift')}
                    </button>
                  </Cell>
                )}
              </tr>
            ))}
          </DataTable>
        )}
        <LoadMore
          visible={query.hasNextPage}
          pending={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        />
      </div>

      {adding && (
        <AddDialog
          onAdd={async (input) => {
            const entry = await add.mutateAsync(input);
            setNotice(t('security.blocklist.added', { value: entry.value }));
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {lifting && (
        <ReasonDialog
          title={t('security.blocklist.lift.title', { value: lifting.value })}
          description={t('security.blocklist.lift.description')}
          confirmLabel={t('security.blocklist.lift')}
          onConfirm={async ({ reason }) => {
            await remove.mutateAsync({ id: lifting.id, reason });
            setNotice(t('security.blocklist.lifted', { value: lifting.value }));
          }}
          onDone={() => setLifting(null)}
          onCancel={() => setLifting(null)}
        />
      )}
    </Section>
  );
}

function AddDialog({
  onAdd,
  onClose,
}: {
  onAdd: (input: {
    kind: PlatformBlocklistKind;
    value: string;
    reason: string;
  }) => Promise<unknown>;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const [kind, setKind] = useState<PlatformBlocklistKind>('domain');
  const [value, setValue] = useState('');

  return (
    <ReasonDialog
      title={t('security.blocklist.add.title')}
      description={t('security.blocklist.add.description')}
      confirmLabel={t('security.blocklist.add.confirm')}
      confirmDisabled={value.trim() === ''}
      extraDirty={value !== ''}
      describeError={(error) => describeAddError(t, error, kind)}
      onConfirm={({ reason }) => onAdd({ kind, value, reason })}
      onDone={onClose}
      onCancel={onClose}
    >
      <div>
        <label htmlFor="blocklist-add-kind" className="text-sm font-medium">
          {t('security.blocklist.add.kind')}
        </label>
        <select
          id="blocklist-add-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as PlatformBlocklistKind)}
          className={FIELD_CLASS}
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {t(`security.kind.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="blocklist-add-value" className="text-sm font-medium">
          {t('security.blocklist.add.value')}
        </label>
        <input
          id="blocklist-add-value"
          type="text"
          value={value}
          maxLength={320}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="blocklist-add-hint"
          onChange={(event) => setValue(event.target.value)}
          className={FIELD_CLASS}
        />
        <p id="blocklist-add-hint" className="mt-1 text-xs text-content-secondary">
          {t(`security.blocklist.add.hint.${kind}`)}
        </p>
      </div>
    </ReasonDialog>
  );
}
