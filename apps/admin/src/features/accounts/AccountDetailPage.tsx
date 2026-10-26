/**
 * One account (tm 389.11 · FR-ADMIN-11): who the person is, how they sign in, which workspaces
 * they belong to and in what role — identities and counts, never a workspace's content. The
 * header's "Actions" menu acts on the account; a suspension shows as a banner with the
 * operator's reason (which only the panel ever shows).
 */
import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { Banner } from '../../components/ui/Banner.js';
import { ApiClientError } from '../../lib/api-client.js';
import { formatCount, formatDate, formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformAccount } from '../../lib/platform-types.js';
import { Cell, DataTable, EmptyLine, Facts, LINK_CLASS, Loading } from '../workspaces/ui.js';
import {
  AccountActionDialog,
  AccountActionsMenu,
  type AccountActionKey,
  type AccountNotice,
} from './AccountActions.js';
import { useAccount } from './queries.js';

export function AccountDetailPage(): ReactElement {
  const t = useTranslate();
  const accountId = useParams()['accountId'] ?? '';
  const query = useAccount(accountId);
  const [action, setAction] = useState<AccountActionKey | null>(null);
  const [notice, setNotice] = useState<AccountNotice | null>(null);
  const [erased, setErased] = useState(false);

  if (erased) {
    return (
      <Page title={t('nav.accounts')}>
        <Banner tone="success" role="status">
          {t('accounts.detail.erased')}
        </Banner>
        <p>
          <Link to="/accounts" className={LINK_CLASS}>
            {t('accounts.detail.back')}
          </Link>
        </p>
      </Page>
    );
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiClientError && query.error.status === 404;
    return (
      <Page title={t('nav.accounts')}>
        <Card>
          {notFound ? (
            <div className="p-6">
              <h2 className="text-sm font-semibold">{t('accounts.detail.notFound.title')}</h2>
              <p className="mt-1 text-sm text-content-secondary">
                {t('accounts.detail.notFound.body')}
              </p>
            </div>
          ) : (
            <LoadError
              title={t('accounts.detail.loadError')}
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )}
        </Card>
      </Page>
    );
  }

  const account = query.data?.account;
  return (
    <Page
      title={account?.name ?? t('nav.accounts')}
      description={account?.email}
      actions={
        account ? (
          <AccountActionsMenu
            account={account}
            onSelect={(next) => {
              setNotice(null);
              setAction(next);
            }}
          />
        ) : null
      }
    >
      {account?.platform_suspended_at && (
        <Banner tone="warning" title={t('accounts.banner.suspendedTitle')}>
          {t('accounts.banner.suspended', {
            when: formatDateTime(account.platform_suspended_at) ?? '',
          })}
          {account.platform_suspended_reason && (
            <> {t('accounts.banner.reason', { reason: account.platform_suspended_reason })}</>
          )}
        </Banner>
      )}
      {notice && (
        <Banner tone={notice.tone} role="status" dismissible onDismiss={() => setNotice(null)}>
          {notice.message}
        </Banner>
      )}
      {account && action && (
        <AccountActionDialog
          action={action}
          account={account}
          onClose={() => setAction(null)}
          onNotice={setNotice}
          onErased={() => {
            setAction(null);
            setErased(true);
          }}
        />
      )}
      {account ? (
        <AccountBody account={account} />
      ) : (
        <Card>
          <Loading label={t('accounts.loading')} />
        </Card>
      )}
    </Page>
  );
}

function AccountBody({ account }: { account: PlatformAccount }): ReactElement {
  const t = useTranslate();
  const yesNo = (value: boolean) => (value ? t('accounts.yes') : t('accounts.no'));
  return (
    <>
      <Card>
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          {t('accounts.detail.profile')}
        </h2>
        <Facts
          items={[
            {
              label: t('accounts.detail.id'),
              value: <span className="break-all">{account.id}</span>,
            },
            { label: t('accounts.detail.created'), value: formatDate(account.created_at) },
            {
              label: t('accounts.detail.verified'),
              value: account.email_verified_at
                ? formatDateTime(account.email_verified_at)
                : t('accounts.detail.unverified'),
            },
            {
              label: t('accounts.detail.lastSignIn'),
              value: formatDateTime(account.last_sign_in_at),
            },
            { label: t('accounts.detail.lastSeen'), value: formatDateTime(account.last_seen_at) },
            { label: t('accounts.detail.password'), value: yesNo(account.password_set) },
            {
              label: t('accounts.detail.twoFactor'),
              value: account.two_factor.enabled
                ? t('accounts.detail.twoFactorOn', {
                    left: account.two_factor.recovery_codes_left,
                  })
                : t('accounts.detail.twoFactorOff'),
            },
            {
              label: t('accounts.detail.sessions'),
              value: formatCount(account.credentials.sessions),
            },
            {
              label: t('accounts.detail.personalTokens'),
              value: formatCount(account.credentials.personal_tokens),
            },
          ]}
        />
      </Card>
      <Card>
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
          {t('accounts.detail.memberships')}
        </h2>
        {account.memberships.length === 0 ? (
          <EmptyLine>{t('accounts.detail.noMemberships')}</EmptyLine>
        ) : (
          <DataTable
            caption={t('accounts.detail.memberships')}
            headers={[
              t('accounts.membership.workspace'),
              t('accounts.membership.licence'),
              t('accounts.membership.role'),
              t('accounts.membership.workspaceStatus'),
              t('accounts.membership.member'),
              t('accounts.membership.twoFactorRequired'),
              t('accounts.membership.joined'),
            ]}
          >
            {account.memberships.map((m) => (
              <tr key={m.license_id}>
                <Cell>
                  <Link to={`/workspaces/${m.license_id}`} className={LINK_CLASS}>
                    {m.organization_name}
                  </Link>
                  {m.sandbox && (
                    <span className="ml-2 text-xs text-content-secondary">
                      {t('accounts.membership.sandbox')}
                    </span>
                  )}
                </Cell>
                <Cell>
                  <span className="tabular-nums">{m.license_id}</span>
                </Cell>
                <Cell>{t(`workspaces.roles.${m.role}`)}</Cell>
                <Cell>{t(`workspaces.status.${m.license_status}`)}</Cell>
                <Cell>
                  {m.suspended
                    ? t('accounts.membership.suspended')
                    : m.awaiting_approval
                      ? t('accounts.membership.awaiting')
                      : t('accounts.membership.active')}
                </Cell>
                <Cell>{yesNo(m.two_factor_required)}</Cell>
                <Cell>{formatDate(m.joined_at)}</Cell>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </>
  );
}
