/**
 * The support desk's lookup (tm 389.9 · FR-ADMIN-10): paste what the customer quoted — a
 * Thread ID, a Chat ID, a ticket number or their email — and get the workspace it belongs to.
 *
 * The answer is a licence number and an organization name, never what was written: entering
 * the workspace to read it is impersonation (389.15), on the record — its open sessions are
 * listed below the lookup, each with End. "Nothing found" covers
 * both an unknown identifier and text that is not one; the server does not tell them apart,
 * and neither does this page. "Thread ID" and "Chat ID" stay English in every locale (ID-01-S1).
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { ApiClientError } from '../../lib/api-client.js';
import { api } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformSupportLookup } from '../../lib/platform-types.js';
import { ActiveImpersonations } from './Impersonation.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
} from '../workspaces/ui.js';

export function SupportPage(): ReactElement {
  const t = useTranslate();
  const [text, setText] = useState('');
  const lookup = useMutation({
    mutationFn: (q: string) =>
      api.get<PlatformSupportLookup>(`/support/lookup?q=${encodeURIComponent(q)}`),
  });
  const notFound = lookup.error instanceof ApiClientError && lookup.error.status === 404;

  function submit(event: FormEvent): void {
    event.preventDefault();
    const q = text.trim();
    if (q) lookup.mutate(q);
  }

  return (
    <Page title={t('nav.support')} description={t('shell.pages.support.description')}>
      <Card>
        <form role="search" onSubmit={submit} className="flex flex-col gap-2 p-4">
          <label htmlFor="support-lookup" className="text-sm font-medium">
            {t('support.lookup.label')}
          </label>
          <div className="flex gap-2">
            <input
              id="support-lookup"
              type="search"
              value={text}
              maxLength={320}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              aria-describedby="support-lookup-hint"
              className={FIELD_CLASS}
            />
            <button
              type="submit"
              className={`mt-1 ${PRIMARY_BUTTON_CLASS}`}
              disabled={lookup.isPending || !text.trim()}
            >
              {t('support.lookup.submit')}
            </button>
          </div>
          <p id="support-lookup-hint" className="text-xs text-content-secondary">
            {t('support.lookup.hint')}
          </p>
        </form>
      </Card>

      <Card>
        {lookup.isPending ? (
          <p role="status" className="p-4 text-sm text-content-secondary">
            {t('support.lookup.searching')}
          </p>
        ) : notFound ? (
          <p role="status" className="p-4 text-sm">
            {t('support.lookup.none')}
          </p>
        ) : lookup.isError ? (
          <LoadError
            title={t('support.lookup.failed')}
            error={lookup.error}
            onRetry={() => lookup.mutate(lookup.variables ?? text.trim())}
          />
        ) : lookup.data ? (
          <DataTable
            caption={t('support.lookup.results')}
            headers={[
              t('support.lookup.matched'),
              t('support.lookup.organization'),
              t('support.lookup.licence'),
            ]}
          >
            {lookup.data.data.map((match) => (
              <tr key={`${match.kind}-${match.license_id}`}>
                <Cell>{t(`support.kind.${match.kind}`)}</Cell>
                <Cell>
                  <Link to={`/workspaces/${match.license_id}`} className={LINK_CLASS}>
                    {match.organization_name}
                  </Link>
                </Cell>
                <Cell>
                  <span className="tabular-nums">{match.license_id}</span>
                </Cell>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyLine>{t('support.lookup.idle')}</EmptyLine>
        )}
      </Card>

      {/* Open "enter as the customer" sessions, each with End (tm 389.15). */}
      <ActiveImpersonations />
    </Page>
  );
}
