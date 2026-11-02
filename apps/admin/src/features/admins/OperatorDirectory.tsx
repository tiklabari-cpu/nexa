/**
 * The operator directory (tm 391 · FR-ADMIN-04): who can sign in to this panel, in which role,
 * with what state — and, for a superadmin, the actions on each (invite, role, disable/enable,
 * second-factor reset, session revocation) and the invitations still waiting.
 *
 * Reading is `admins.read`; every button appears only for `admins.manage`, the server enforcing
 * it either way. There is no "delete operator": an operator who leaves is disabled, and keeps
 * their name on every audit entry they wrote.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { Banner } from '../../components/ui/index.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformAdmin, PlatformInvite } from '../../lib/platform-types.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  Loading,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import {
  InviteDialog,
  OperatorActionDialog,
  OperatorActionsMenu,
  RevokeInviteDialog,
  type DirectoryNotice,
  type OperatorActionKey,
} from './OperatorActions.js';
import { useAdmins, useInvites } from './queries.js';

type Dialog =
  | { kind: 'invite' }
  | { kind: 'operator'; action: OperatorActionKey; admin: PlatformAdmin }
  | { kind: 'revokeInvite'; invite: PlatformInvite };

export function OperatorDirectory(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'admins.manage');
  const admins = useAdmins();
  const invites = useInvites();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // `seq` keys the banner: a dismissed banner stays dismissed, and the next notice is a new one.
  const [shown, setShown] = useState<{ notice: DirectoryNotice; seq: number } | null>(null);
  const notice = shown?.notice;
  const setNotice = (next: DirectoryNotice): void =>
    setShown((previous) => ({ notice: next, seq: (previous?.seq ?? 0) + 1 }));

  const emailOf = (id: string | null): string =>
    (id && admins.data?.data.find((admin) => admin.id === id)?.email) || '—';

  return (
    <>
      {notice && (
        <Banner key={shown?.seq} tone={notice.tone} dismissible>
          <span>{notice.message}</span>
          {notice.link && (
            <code className="mt-1 block select-all break-all text-xs">{notice.link}</code>
          )}
        </Banner>
      )}

      <section aria-labelledby="admins-directory">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="admins-directory" className="text-sm font-semibold">
            {t('admins.dir.heading')}
          </h2>
          {canManage && (
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS}
              onClick={() => setDialog({ kind: 'invite' })}
            >
              {t('admins.dir.invite')}
            </button>
          )}
        </div>
        <Card>
          <Frame query={admins} loading={t('admins.dir.loading')} error={t('admins.dir.loadError')}>
            <p className="px-4 pt-4 text-sm text-content-secondary">{t('admins.dir.intro')}</p>
            <DataTable
              caption={t('admins.dir.heading')}
              headers={[
                t('admins.dir.col.email'),
                t('admins.dir.col.role'),
                t('admins.dir.col.status'),
                t('admins.dir.col.twoFactor'),
                t('admins.dir.col.sessions'),
                t('admins.dir.col.lastSeen'),
                ...(canManage ? [t('admins.dir.col.actions')] : []),
              ]}
            >
              {admins.data?.data.map((admin) => (
                <tr key={admin.id}>
                  <Cell>
                    {admin.email}
                    {admin.id === me?.admin.id && (
                      <span className="ml-2 text-xs text-content-secondary">
                        {t('admins.dir.you')}
                      </span>
                    )}
                  </Cell>
                  <Cell>{t(`shell.role.${admin.role}`)}</Cell>
                  <Cell>
                    {admin.disabled_at === null
                      ? t('admins.dir.status.active')
                      : t('admins.dir.status.disabled', {
                          date: formatDateTime(admin.disabled_at) ?? '—',
                        })}
                  </Cell>
                  <Cell>
                    {admin.totp_enrolled
                      ? t('admins.dir.twoFactor.on')
                      : t('admins.dir.twoFactor.off')}
                  </Cell>
                  <Cell>{admin.active_sessions}</Cell>
                  <Cell>
                    {admin.last_seen_at
                      ? formatDateTime(admin.last_seen_at)
                      : t('admins.dir.never')}
                  </Cell>
                  {canManage && (
                    <Cell>
                      <OperatorActionsMenu
                        admin={admin}
                        onSelect={(action) => setDialog({ kind: 'operator', action, admin })}
                      />
                    </Cell>
                  )}
                </tr>
              ))}
            </DataTable>
          </Frame>
        </Card>
      </section>

      <section aria-labelledby="admins-invites">
        <h2 id="admins-invites" className="mb-3 text-sm font-semibold">
          {t('admins.invites.heading')}
        </h2>
        <Card>
          <Frame
            query={invites}
            loading={t('admins.dir.loading')}
            error={t('admins.invites.loadError')}
          >
            {invites.data?.data.length === 0 ? (
              <EmptyLine>{t('admins.invites.empty')}</EmptyLine>
            ) : (
              <DataTable
                caption={t('admins.invites.heading')}
                headers={[
                  t('admins.dir.col.email'),
                  t('admins.dir.col.role'),
                  t('admins.invites.col.invitedBy'),
                  t('admins.invites.col.expires'),
                  ...(canManage ? [t('admins.dir.col.actions')] : []),
                ]}
              >
                {invites.data?.data.map((invite) => (
                  <tr key={invite.id}>
                    <Cell>{invite.email}</Cell>
                    <Cell>{t(`shell.role.${invite.role}`)}</Cell>
                    <Cell>{emailOf(invite.invited_by)}</Cell>
                    <Cell>{formatDateTime(invite.expires_at)}</Cell>
                    {canManage && (
                      <Cell>
                        <button
                          type="button"
                          className={SECONDARY_BUTTON_CLASS}
                          aria-label={t('admins.invites.revokeLabel', { email: invite.email })}
                          onClick={() => setDialog({ kind: 'revokeInvite', invite })}
                        >
                          {t('admins.invites.revoke')}
                        </button>
                      </Cell>
                    )}
                  </tr>
                ))}
              </DataTable>
            )}
          </Frame>
        </Card>
      </section>

      {dialog?.kind === 'invite' && (
        <InviteDialog onClose={() => setDialog(null)} onNotice={setNotice} />
      )}
      {dialog?.kind === 'operator' && (
        <OperatorActionDialog
          action={dialog.action}
          admin={dialog.admin}
          onClose={() => setDialog(null)}
          onNotice={setNotice}
        />
      )}
      {dialog?.kind === 'revokeInvite' && (
        <RevokeInviteDialog
          invite={dialog.invite}
          onClose={() => setDialog(null)}
          onNotice={setNotice}
        />
      )}
    </>
  );
}

/** The three states a read can be in; `children` is the answered one. */
function Frame({
  query,
  loading,
  error,
  children,
}: {
  query: { isError: boolean; isPending: boolean; error: unknown; refetch: () => unknown };
  loading: string;
  error: string;
  children: ReactNode;
}): ReactElement {
  if (query.isError) {
    return <LoadError title={error} error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.isPending) return <Loading label={loading} />;
  return <>{children}</>;
}
