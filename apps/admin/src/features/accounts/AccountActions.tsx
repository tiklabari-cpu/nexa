/**
 * What an operator can do to one account (tm 389.11 · FR-ADMIN-11): the detail page's "Actions"
 * menu and the dialog each action opens.
 *
 * Every action goes through `ReasonDialog` — a reason for the audit chain, and a fresh
 * authenticator code where the server wants one (second-factor reset, erasure). Erasure also
 * wants the address typed out; the export downloads the document the server answers with.
 *
 * The menu offers what the operator's role may do and what the account's state allows; the
 * server decides both again (403, 409 `platform_account_state`), and its refusal is shown in
 * the dialog in words that name the state.
 */
import { useRef, useState, type ReactElement } from 'react';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { ApiClientError } from '../../lib/api-client.js';
import { api, hasPermission, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type {
  PlatformAccount,
  PlatformAccountActionResult,
  PlatformAccountErased,
  PlatformAccountExport,
} from '../../lib/platform-types.js';
import { FIELD_CLASS, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';
import { useAccountAction, useForgetAccount } from './queries.js';

export const ACCOUNT_ACTIONS = [
  'resendVerification',
  'forcePasswordReset',
  'revokeSessions',
  'revokeTokens',
  'resetTwoFactor',
  'suspend',
  'unsuspend',
  'export',
  'erase',
] as const;
export type AccountActionKey = (typeof ACCOUNT_ACTIONS)[number];

type Permission = 'accounts.support' | 'accounts.manage';

/** Who may, and from which state — the menu's courtesy copy of the server's rules. */
const RULES: Record<
  AccountActionKey,
  { permission: Permission; when: (account: PlatformAccount) => boolean; danger?: boolean }
> = {
  resendVerification: { permission: 'accounts.support', when: (a) => a.email_verified_at === null },
  forcePasswordReset: { permission: 'accounts.support', when: () => true },
  revokeSessions: { permission: 'accounts.support', when: (a) => a.credentials.sessions > 0 },
  revokeTokens: {
    permission: 'accounts.support',
    when: (a) => a.credentials.sessions + a.credentials.personal_tokens > 0,
  },
  resetTwoFactor: { permission: 'accounts.manage', when: (a) => a.two_factor.enabled },
  suspend: {
    permission: 'accounts.manage',
    when: (a) => a.platform_suspended_at === null,
    danger: true,
  },
  unsuspend: { permission: 'accounts.manage', when: (a) => a.platform_suspended_at !== null },
  export: { permission: 'accounts.manage', when: () => true },
  erase: { permission: 'accounts.manage', when: () => true, danger: true },
};

/** The actions that want a code from the authenticator no older than five minutes. */
const FRESH_CODE: ReadonlySet<AccountActionKey> = new Set(['resetTwoFactor', 'erase']);

/** The actions this operator may take on this account now, in menu order. */
export function availableAccountActions(
  permissions: (permission: string) => boolean,
  account: PlatformAccount,
): AccountActionKey[] {
  return ACCOUNT_ACTIONS.filter(
    (key) => permissions(RULES[key].permission) && RULES[key].when(account),
  );
}

export interface AccountNotice {
  tone: 'success' | 'info' | 'warning';
  message: string;
}

export function AccountActionsMenu({
  account,
  onSelect,
}: {
  account: PlatformAccount;
  onSelect: (action: AccountActionKey) => void;
}): ReactElement | null {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const actions = availableAccountActions((p) => hasPermission(me, p), account);
  if (actions.length === 0) return null;
  return (
    <Dropdown
      label={t('accounts.actions.menu')}
      trigger={t('accounts.actions.menu')}
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
              RULES[key].danger ? 'text-danger' : ''
            }`}
          >
            {t(`accounts.actions.${key}.label`)}
          </button>
        ))
      }
    </Dropdown>
  );
}

/** Hand the export to the browser as a file; a test environment without object URLs skips it. */
function download(document_: PlatformAccountExport, accountId: string): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `account-${accountId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function AccountActionDialog({
  action,
  account,
  onClose,
  onNotice,
  onErased,
}: {
  action: AccountActionKey;
  account: PlatformAccount;
  onClose: () => void;
  onNotice: (notice: AccountNotice) => void;
  onErased: () => void;
}): ReactElement {
  const t = useTranslate();
  const id = account.id;
  const mutation = useAccountAction(id);
  const forget = useForgetAccount();
  const result = useRef<PlatformAccountActionResult | null>(null);
  const [typed, setTyped] = useState('');

  const describeError = (error: unknown): string | null => {
    if (!(error instanceof ApiClientError)) return null;
    const reason = error.details?.['reason'];
    if (error.type === 'platform_account_state' && reason === 'account_is_sole_owner') {
      return t('accounts.actions.state.account_is_sole_owner');
    }
    if (error.type === 'validation' && reason === 'confirm_email_mismatch') {
      return t('accounts.actions.erase.mismatch');
    }
    return null;
  };

  const label = t(`accounts.actions.${action}.label`);
  const common = {
    title: t(`accounts.actions.${action}.title`),
    description: t(`accounts.actions.${action}.body`, { email: account.email }),
    confirmLabel: t(`accounts.actions.${action}.confirm`),
    requireTotp: FRESH_CODE.has(action),
    onCancel: onClose,
    describeError,
  };

  if (action === 'export') {
    return (
      <ReasonDialog
        {...common}
        onConfirm={async ({ reason }) => {
          download(await api.post<PlatformAccountExport>(`/accounts/${id}/export`, { reason }), id);
        }}
        onDone={() => {
          onNotice({ tone: 'success', message: t('accounts.actions.done', { action: label }) });
          onClose();
        }}
      />
    );
  }

  if (action === 'erase') {
    return (
      <ReasonDialog
        {...common}
        confirmDisabled={typed.trim().toLowerCase() !== account.email.toLowerCase()}
        extraDirty={typed !== ''}
        onConfirm={async ({ reason }) => {
          await api.post<PlatformAccountErased>(`/accounts/${id}/erase`, {
            confirm_email: typed,
            reason,
          });
        }}
        onDone={() => {
          forget(id);
          onErased();
        }}
      >
        <div>
          <label htmlFor="erase-email" className="text-sm font-medium">
            {t('accounts.actions.erase.confirmEmail')}
          </label>
          <input
            id="erase-email"
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            aria-describedby="erase-email-hint"
            className={FIELD_CLASS}
          />
          <p id="erase-email-hint" className="mt-1 text-xs text-content-secondary">
            {t('accounts.actions.erase.confirmHint', { email: account.email })}
          </p>
        </div>
      </ReasonDialog>
    );
  }

  const send = (reason: string): Promise<PlatformAccountActionResult> => {
    switch (action) {
      case 'resendVerification':
        return api.post(`/accounts/${id}/resend-verification`, { reason });
      case 'forcePasswordReset':
        return api.post(`/accounts/${id}/force-password-reset`, { reason });
      case 'revokeSessions':
        return api.post(`/accounts/${id}/revoke-sessions`, { reason });
      case 'revokeTokens':
        return api.post(`/accounts/${id}/revoke-tokens`, { reason });
      case 'resetTwoFactor':
        return api.post(`/accounts/${id}/reset-two-factor`, { reason });
      case 'suspend':
        return api.post(`/accounts/${id}/suspend`, { reason });
      case 'unsuspend':
        return api.post(`/accounts/${id}/unsuspend`, { reason });
    }
  };

  return (
    <ReasonDialog
      {...common}
      onConfirm={async ({ reason }) => {
        result.current = await mutation.mutateAsync(() => send(reason));
      }}
      onDone={() => {
        const answer = result.current;
        if (answer?.unchanged) {
          onNotice({ tone: 'info', message: t('accounts.actions.unchanged', { action: label }) });
        } else if (answer?.mail === 'failed') {
          onNotice({
            tone: 'warning',
            message: t('accounts.actions.mailFailed', { action: label }),
          });
        } else {
          onNotice({ tone: 'success', message: t('accounts.actions.done', { action: label }) });
        }
        onClose();
      }}
    />
  );
}
