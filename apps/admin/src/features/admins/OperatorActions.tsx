/**
 * What a superadmin can do to one operator or one invitation (tm 391 · FR-ADMIN-04): the row's
 * "Actions" menu and the dialog each action opens.
 *
 * Every action goes through `ReasonDialog` — a reason for the audit chain, and a fresh
 * authenticator code where the server wants one (`recentTotp`: invite, role, disable, enable,
 * second-factor reset). Resetting a second factor also asks the operator to tick that the
 * person's identity was checked first (runbook §3.4): the code gives access to everything the
 * operator may do, so handing out a reset on an e-mail request alone is not a thing the panel
 * makes easy.
 *
 * Operators are disabled, never deleted. The menu offers what the row's state allows; the server
 * decides again, and a refusal is shown in the dialog — the last active superadmin in words that
 * say what to do instead.
 */
import { useRef, useState, type ReactElement } from 'react';
import { PLATFORM_ROLES } from '@siyahtus/types';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { ApiClientError } from '../../lib/api-client.js';
import { api } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type {
  PlatformAdmin,
  PlatformEndedCount,
  PlatformInvite,
  PlatformInviteCreated,
  PlatformRole,
} from '../../lib/platform-types.js';
import { FIELD_CLASS, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';
import { useRefreshDirectory } from './queries.js';

export const OPERATOR_ACTIONS = [
  'role',
  'disable',
  'enable',
  'resetTwoFactor',
  'revokeSessions',
] as const;
export type OperatorActionKey = (typeof OPERATOR_ACTIONS)[number];

/** The operator actions this row's state allows, in menu order. */
export function availableOperatorActions(admin: PlatformAdmin): OperatorActionKey[] {
  return OPERATOR_ACTIONS.filter((key) => {
    switch (key) {
      case 'role':
        return true;
      case 'disable':
        return admin.disabled_at === null;
      case 'enable':
        return admin.disabled_at !== null;
      case 'resetTwoFactor':
        return admin.totp_enrolled;
      case 'revokeSessions':
        return admin.active_sessions > 0;
    }
  });
}

/** The actions that want a code from the authenticator no older than five minutes. */
const FRESH_CODE: ReadonlySet<OperatorActionKey> = new Set([
  'role',
  'disable',
  'enable',
  'resetTwoFactor',
]);

export interface DirectoryNotice {
  tone: 'success' | 'info' | 'warning';
  message: string;
  /** A link the inviter must hand over themselves (the mail did not go). */
  link?: string;
}

/** A refusal worded for what the operator should do next; null falls back to the type's sentence. */
function useDescribeError(): (error: unknown) => string | null {
  const t = useTranslate();
  return (error) => {
    if (error instanceof ApiClientError && error.type === 'platform_last_superadmin') {
      return t('admins.error.lastSuperadmin');
    }
    return null;
  };
}

export function OperatorActionsMenu({
  admin,
  onSelect,
}: {
  admin: PlatformAdmin;
  onSelect: (action: OperatorActionKey) => void;
}): ReactElement | null {
  const t = useTranslate();
  const actions = availableOperatorActions(admin);
  return (
    <Dropdown
      label={t('admins.dir.actions.for', { email: admin.email })}
      trigger={t('admins.dir.actions.menu')}
      triggerClassName={`${SECONDARY_BUTTON_CLASS} cursor-pointer list-none`}
      panelClassName="absolute right-0 z-20 mt-1 w-64 rounded-md border border-border bg-surface p-1 shadow-md"
      className="relative"
    >
      {({ close }) =>
        actions.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              close();
              onSelect(key);
            }}
            className={`block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-surface-2 ${
              key === 'disable' ? 'text-danger' : ''
            }`}
          >
            {t(`admins.action.${key}.label`)}
          </button>
        ))
      }
    </Dropdown>
  );
}

export function OperatorActionDialog({
  action,
  admin,
  onClose,
  onNotice,
}: {
  action: OperatorActionKey;
  admin: PlatformAdmin;
  onClose: () => void;
  onNotice: (notice: DirectoryNotice) => void;
}): ReactElement {
  const t = useTranslate();
  const refresh = useRefreshDirectory();
  const describeError = useDescribeError();
  const [role, setRole] = useState<PlatformRole>(admin.role);
  const [verified, setVerified] = useState(false);
  const ended = useRef(0);
  const id = admin.id;

  const send = async (reason: string): Promise<void> => {
    switch (action) {
      case 'role':
        await api.post(`/admins/${id}/role`, { role, reason });
        return;
      case 'disable':
        await api.post(`/admins/${id}/disable`, { reason });
        return;
      case 'enable':
        await api.post(`/admins/${id}/enable`, { reason });
        return;
      case 'resetTwoFactor':
        await api.post(`/admins/${id}/reset-two-factor`, { reason });
        return;
      case 'revokeSessions':
        ended.current = (
          await api.post<PlatformEndedCount>(`/admins/${id}/revoke-sessions`, { reason })
        ).ended;
        return;
    }
  };

  return (
    <ReasonDialog
      title={t(`admins.action.${action}.title`)}
      description={t(`admins.action.${action}.body`, { email: admin.email })}
      confirmLabel={t(`admins.action.${action}.confirm`)}
      requireTotp={FRESH_CODE.has(action)}
      confirmDisabled={
        (action === 'role' && role === admin.role) || (action === 'resetTwoFactor' && !verified)
      }
      extraDirty={(action === 'role' && role !== admin.role) || verified}
      describeError={describeError}
      onConfirm={({ reason }) => send(reason)}
      onDone={() => {
        void refresh();
        onNotice({
          tone: 'success',
          message: t(`admins.action.${action}.done`, {
            email: admin.email,
            role: t(`shell.role.${role}`),
            count: ended.current,
          }),
        });
        onClose();
      }}
      onCancel={onClose}
    >
      {action === 'role' && (
        <div>
          <label htmlFor="operator-role" className="text-sm font-medium">
            {t('admins.field.role')}
          </label>
          <select
            id="operator-role"
            value={role}
            onChange={(event) => setRole(event.target.value as PlatformRole)}
            className={FIELD_CLASS}
          >
            {PLATFORM_ROLES.map((value) => (
              <option key={value} value={value}>
                {t(`shell.role.${value}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      {action === 'resetTwoFactor' && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={verified}
            onChange={(event) => setVerified(event.target.checked)}
            className="mt-1"
          />
          <span>{t('admins.action.resetTwoFactor.verified', { email: admin.email })}</span>
        </label>
      )}
    </ReasonDialog>
  );
}

export function InviteDialog({
  onClose,
  onNotice,
}: {
  onClose: () => void;
  onNotice: (notice: DirectoryNotice) => void;
}): ReactElement {
  const t = useTranslate();
  const refresh = useRefreshDirectory();
  const describeError = useDescribeError();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PlatformRole>('support');
  const created = useRef<PlatformInviteCreated | null>(null);
  const address = email.trim();

  return (
    <ReasonDialog
      title={t('admins.invite.title')}
      description={t('admins.invite.body')}
      confirmLabel={t('admins.invite.confirm')}
      requireTotp
      confirmDisabled={!/^\S+@\S+\.\S+$/.test(address)}
      extraDirty={email !== ''}
      describeError={describeError}
      onConfirm={async ({ reason }) => {
        created.current = await api.post<PlatformInviteCreated>('/admins/invites', {
          email: address,
          role,
          reason,
        });
      }}
      onDone={() => {
        void refresh();
        const result = created.current;
        if (result?.mail === 'failed' && result.accept_url) {
          onNotice({
            tone: 'warning',
            message: t('admins.invite.mailFailed', { email: address }),
            link: result.accept_url,
          });
        } else {
          onNotice({ tone: 'success', message: t('admins.invite.sent', { email: address }) });
        }
        onClose();
      }}
      onCancel={onClose}
    >
      <div>
        <label htmlFor="invite-email" className="text-sm font-medium">
          {t('admins.field.email')}
        </label>
        <input
          id="invite-email"
          type="email"
          value={email}
          maxLength={320}
          autoComplete="off"
          onChange={(event) => setEmail(event.target.value)}
          className={FIELD_CLASS}
        />
      </div>
      <div>
        <label htmlFor="invite-role" className="text-sm font-medium">
          {t('admins.field.role')}
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(event) => setRole(event.target.value as PlatformRole)}
          className={FIELD_CLASS}
        >
          {PLATFORM_ROLES.map((value) => (
            <option key={value} value={value}>
              {t(`shell.role.${value}`)}
            </option>
          ))}
        </select>
      </div>
    </ReasonDialog>
  );
}

export function RevokeInviteDialog({
  invite,
  onClose,
  onNotice,
}: {
  invite: PlatformInvite;
  onClose: () => void;
  onNotice: (notice: DirectoryNotice) => void;
}): ReactElement {
  const t = useTranslate();
  const refresh = useRefreshDirectory();
  return (
    <ReasonDialog
      title={t('admins.revokeInvite.title')}
      description={t('admins.revokeInvite.body', { email: invite.email })}
      confirmLabel={t('admins.revokeInvite.confirm')}
      onConfirm={async ({ reason }) => {
        await api.post(`/admins/invites/${invite.id}/revoke`, { reason });
      }}
      onDone={() => {
        void refresh();
        onNotice({
          tone: 'success',
          message: t('admins.revokeInvite.done', { email: invite.email }),
        });
        onClose();
      }}
      onCancel={onClose}
    />
  );
}
