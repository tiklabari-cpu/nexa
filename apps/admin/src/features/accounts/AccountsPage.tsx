/**
 * The account search (tm 389.11 · FR-ADMIN-11): one box — an address, the start of one, the
 * start of a name, or an id — over a keyset-paged table. Applied on submit, not per keystroke:
 * each search runs across every account.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { formatCount, formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  LINK_CLASS,
  Loading,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import { useAccountSearch } from './queries.js';

export function AccountsPage(): ReactElement {
  const t = useTranslate();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const query = useAccountSearch(q);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  function search(event: FormEvent): void {
    event.preventDefault();
    setQ(text.trim());
  }

  return (
    <Page title={t('nav.accounts')} description={t('shell.pages.accounts.description')}>
      <Card>
        <form
          role="search"
          aria-label={t('accounts.search.label')}
          onSubmit={search}
          className="p-4"
        >
          <label htmlFor="accounts-q" className="text-xs font-medium">
            {t('accounts.search.q')}
          </label>
          <div className="flex max-w-xl gap-2">
            <input
              id="accounts-q"
              type="search"
              value={text}
              maxLength={320}
              onChange={(event) => setText(event.target.value)}
              className={FIELD_CLASS}
              aria-describedby="accounts-q-hint"
            />
            <button type="submit" className={`mt-1 ${PRIMARY_BUTTON_CLASS}`}>
              {t('accounts.search.submit')}
            </button>
          </div>
          <p id="accounts-q-hint" className="mt-1 text-xs text-content-secondary">
            {t('accounts.search.hint')}
          </p>
        </form>
      </Card>

      <Card>
        {query.isError ? (
          <LoadError
            title={t('accounts.list.loadError')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <Loading label={t('accounts.loading')} />
        ) : rows.length === 0 ? (
          <EmptyLine>{t('accounts.list.empty')}</EmptyLine>
        ) : (
          <>
            <DataTable
              caption={t('accounts.list.caption')}
              headers={[
                t('accounts.list.name'),
                t('accounts.list.email'),
                t('accounts.list.verified'),
                t('accounts.list.state'),
                t('accounts.list.memberships'),
                t('accounts.list.created'),
              ]}
            >
              {rows.map((row) => (
                <tr key={row.id}>
                  <Cell>
                    <Link to={row.id} className={LINK_CLASS}>
                      {row.name}
                    </Link>
                  </Cell>
                  <Cell>{row.email}</Cell>
                  <Cell>{row.email_verified_at ? t('accounts.yes') : t('accounts.no')}</Cell>
                  <Cell>
                    {row.platform_suspended_at
                      ? t('accounts.state.suspended')
                      : t('accounts.state.active')}
                  </Cell>
                  <Cell>{formatCount(row.membership_count)}</Cell>
                  <Cell>{formatDate(row.created_at)}</Cell>
                </tr>
              ))}
            </DataTable>
            {query.hasNextPage && (
              <div className="border-t border-border p-3 text-center">
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t('accounts.list.more')}
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </Page>
  );
}
