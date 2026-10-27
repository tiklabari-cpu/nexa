/**
 * Impersonation sessions on the Security page (tm 389.16 · FR-ADMIN-22): every operator's "enter
 * as the customer" sessions, newest first — who entered which workspace as whom, in which mode,
 * and how it ended. Read-only here; opening and ending one is the support desk's
 * (`features/support`, tm 389.15).
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { Cell, DataTable, EmptyLine, LINK_CLASS } from '../workspaces/ui.js';
import { useSecurityImpersonations } from './queries.js';
import { LoadMore, Section } from './ui.js';

export function ImpersonationsSection(): ReactElement {
  const t = useTranslate();
  const [activeOnly, setActiveOnly] = useState(false);
  const query = useSecurityImpersonations(activeOnly);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Section
      id="security-impersonations"
      title={t('security.impersonations.heading')}
      query={query}
      hasData={query.data !== undefined}
      actions={
        <label className="flex items-center gap-2 text-xs text-content-secondary">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(event) => setActiveOnly(event.target.checked)}
          />
          {t('security.impersonations.activeOnly')}
        </label>
      }
    >
      {rows.length === 0 ? (
        <EmptyLine>
          {activeOnly ? t('security.impersonations.noneActive') : t('security.impersonations.none')}
        </EmptyLine>
      ) : (
        <DataTable
          caption={t('security.impersonations.caption')}
          headers={[
            t('security.impersonations.col.workspace'),
            t('security.impersonations.col.member'),
            t('security.impersonations.col.operator'),
            t('security.impersonations.col.mode'),
            t('security.impersonations.col.started'),
            t('security.impersonations.col.state'),
          ]}
        >
          {rows.map((session) => (
            <tr key={session.id}>
              <Cell>
                <Link to={`/workspaces/${session.license_id}`} className={LINK_CLASS}>
                  {session.organization_name ?? session.license_id}
                </Link>
              </Cell>
              <Cell>{session.account_email ?? session.account_id}</Cell>
              <Cell>{session.admin_email ?? session.admin_id}</Cell>
              <Cell>{t(`support.impersonate.modes.${session.mode}`)}</Cell>
              <Cell>{formatDateTime(session.started_at)}</Cell>
              <Cell>
                {session.active
                  ? t('security.impersonations.state.open', {
                      time: formatDateTime(session.ends_at) ?? session.ends_at,
                    })
                  : session.end_reason
                    ? t(`security.impersonations.state.${session.end_reason}`)
                    : t('security.impersonations.state.expired')}
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <LoadMore
        visible={query.hasNextPage}
        pending={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      />
    </Section>
  );
}
