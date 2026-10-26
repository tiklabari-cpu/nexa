/**
 * "Enter as the customer" in the root panel (tm 389.15 · FR-ADMIN-21 · design.md §G).
 *
 * - **Enter** (a workspace's header): pick a live member, a mode and a reason. `read_only` is
 *   the default and every support operator's; `full` is a superadmin's and wants a fresh code
 *   — the dialog asks for it up front, and `ReasonDialog` asks again if the window closed
 *   meanwhile. The server answers a one-time link (60 seconds, used once); it is shown as a
 *   link the operator opens in a new tab — a click, not a pop-up a browser would block — and
 *   it lives in this dialog's state only.
 * - **Active sessions** (the Support page): every open session, with "End" behind a reason.
 *   Ending one closes every token it was traded for at once.
 *
 * The workspace's Founders are mailed when a session opens; the dialog says whether the mail
 * went.
 */
import { useRef, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Modal } from '../../components/ui/Modal.js';
import { ApiClientError } from '../../lib/api-client.js';
import { api, hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type {
  PlatformImpersonation,
  PlatformImpersonationList,
  PlatformImpersonationStarted,
  PlatformWorkspace,
  PlatformWorkspaceMemberList,
} from '../../lib/platform-types.js';
import { useWorkspaceTab } from '../workspaces/queries.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  LINK_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';

type Mode = 'read_only' | 'full';

const ACTIVE_KEY = ['support', 'impersonations', 'active'] as const;

/** A workspace nobody can sign in to cannot be entered either (`workspace_closed`). */
const CLOSED_STATUSES = new Set(['suspended', 'canceled']);

export function ImpersonateButton({
  workspace,
}: {
  workspace: PlatformWorkspace;
}): ReactElement | null {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState<PlatformImpersonationStarted | null>(null);
  if (!hasPermission(me, 'support.impersonate')) return null;
  if (CLOSED_STATUSES.has(workspace.license.status)) return null;
  return (
    <>
      <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setOpen(true)}>
        {t('support.impersonate.open')}
      </button>
      {open && (
        <ImpersonateDialog
          workspace={workspace}
          onCancel={() => setOpen(false)}
          onStarted={(result) => {
            setOpen(false);
            setStarted(result);
          }}
        />
      )}
      {started && <HandoffDialog started={started} onClose={() => setStarted(null)} />}
    </>
  );
}

function ImpersonateDialog({
  workspace,
  onCancel,
  onStarted,
}: {
  workspace: PlatformWorkspace;
  onCancel: () => void;
  onStarted: (started: PlatformImpersonationStarted) => void;
}): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const queryClient = useQueryClient();
  const canFull = hasPermission(me, 'support.impersonate_full');
  const licenseId = workspace.license_id;
  const members = useWorkspaceTab(licenseId, 'members', () =>
    api.get<PlatformWorkspaceMemberList>(`/workspaces/${licenseId}/members`),
  );
  const live = (members.data?.data ?? []).filter((member) => !member.suspended);
  const [accountId, setAccountId] = useState('');
  const [mode, setMode] = useState<Mode>('read_only');
  // A ref, not state: `onDone` runs in the same submit as `onConfirm`, before a re-render.
  const result = useRef<PlatformImpersonationStarted | null>(null);

  return (
    <ReasonDialog
      title={t('support.impersonate.title', { workspace: workspace.organization.name })}
      description={t('support.impersonate.description')}
      confirmLabel={t('support.impersonate.confirm')}
      requireTotp={mode === 'full'}
      confirmDisabled={accountId === ''}
      extraDirty={accountId !== '' || mode !== 'read_only'}
      describeError={(error) => describeStartError(t, error)}
      onConfirm={async ({ reason }) => {
        const started = await api.post<PlatformImpersonationStarted>('/support/impersonations', {
          license_id: licenseId,
          account_id: accountId,
          mode,
          reason,
        });
        result.current = started;
        void queryClient.invalidateQueries({
          queryKey: ['workspaces', licenseId, 'impersonations'],
        });
        void queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
      }}
      onDone={() => {
        if (result.current) onStarted(result.current);
      }}
      onCancel={onCancel}
    >
      <div>
        <label htmlFor="impersonate-member" className="text-sm font-medium">
          {t('support.impersonate.member')}
        </label>
        {members.isError ? (
          <p role="alert" className="mt-1 text-sm text-danger">
            {t('support.impersonate.membersFailed')}
          </p>
        ) : (
          <select
            id="impersonate-member"
            value={accountId}
            disabled={members.isPending}
            onChange={(event) => setAccountId(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">{t('support.impersonate.chooseMember')}</option>
            {live.map((member) => (
              <option key={member.account_id} value={member.account_id}>
                {`${member.email} — ${t(`workspaces.roles.${member.role}`)}`}
              </option>
            ))}
          </select>
        )}
      </div>
      <fieldset>
        <legend className="text-sm font-medium">{t('support.impersonate.mode')}</legend>
        <div className="mt-1 flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="impersonate-mode"
              value="read_only"
              checked={mode === 'read_only'}
              onChange={() => setMode('read_only')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{t('support.impersonate.modes.read_only')}</span>
              <span className="block text-xs text-content-secondary">
                {t('support.impersonate.modes.read_only.hint')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="impersonate-mode"
              value="full"
              checked={mode === 'full'}
              disabled={!canFull}
              onChange={() => setMode('full')}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">{t('support.impersonate.modes.full')}</span>
              <span className="block text-xs text-content-secondary">
                {canFull
                  ? t('support.impersonate.modes.full.hint')
                  : t('support.impersonate.modes.full.superadminOnly')}
              </span>
            </span>
          </label>
        </div>
      </fieldset>
    </ReasonDialog>
  );
}

function describeStartError(t: ReturnType<typeof useTranslate>, error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null;
  const reason = error.details?.['reason'];
  if (error.type === 'platform_account_state' && reason === 'account_suspended') {
    return t('support.impersonate.errors.accountSuspended');
  }
  if (error.type === 'platform_workspace_state' && reason === 'workspace_closed') {
    return t('support.impersonate.errors.workspaceClosed');
  }
  if (error.status === 404) return t('support.impersonate.errors.notAMember');
  return null;
}

/** The one-time link, once. Opened by a click, in a tab of its own. */
function HandoffDialog({
  started,
  onClose,
}: {
  started: PlatformImpersonationStarted;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const session = started.impersonation;
  return (
    <Modal onClose={onClose} title={t('support.impersonate.ready.title')}>
      <div className="flex flex-col gap-3 text-sm" data-testid="impersonation-handoff">
        <p>
          {t(
            session.mode === 'read_only'
              ? 'support.impersonate.ready.readOnly'
              : 'support.impersonate.ready.full',
            { email: session.account_email ?? session.account_id },
          )}
        </p>
        <p className="text-content-secondary">
          {t('support.impersonate.ready.once', {
            time: formatDateTime(started.handoff_expires_at) ?? '',
            ends: formatDateTime(session.ends_at) ?? '',
          })}
        </p>
        <p className="text-content-secondary">
          {t(`support.impersonate.ready.mail.${started.mail}`)}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={onClose}>
            {t('support.impersonate.ready.close')}
          </button>
          <a
            href={started.handoff_url}
            target="_blank"
            rel="noopener noreferrer"
            className={PRIMARY_BUTTON_CLASS}
            onClick={onClose}
          >
            {t('support.impersonate.ready.open')}
          </a>
        </div>
      </div>
    </Modal>
  );
}

/** Every open session, newest first, each with "End". */
export function ActiveImpersonations(): ReactElement {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ACTIVE_KEY,
    queryFn: () => api.get<PlatformImpersonationList>('/support/impersonations?active=true'),
  });
  const [ending, setEnding] = useState<PlatformImpersonation | null>(null);
  const end = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/support/impersonations/${id}/end`, { reason }),
    onSuccess: (_result, { id }) => {
      const session = query.data?.data.find((row) => row.id === id);
      void queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
      if (session) {
        void queryClient.invalidateQueries({
          queryKey: ['workspaces', session.license_id, 'impersonations'],
        });
      }
    },
  });

  return (
    <Card>
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
        {t('support.impersonations.title')}
      </h2>
      {query.isError ? (
        <LoadError
          title={t('support.impersonations.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <p role="status" className="p-4 text-sm text-content-secondary">
          {t('support.impersonations.loading')}
        </p>
      ) : query.data.data.length === 0 ? (
        <EmptyLine>{t('support.impersonations.none')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('support.impersonations.title')}
          headers={[
            t('support.impersonations.workspace'),
            t('support.impersonations.member'),
            t('support.impersonations.operator'),
            t('support.impersonations.mode'),
            t('support.impersonations.ends'),
            t('support.impersonations.actions'),
          ]}
        >
          {query.data.data.map((session) => (
            <tr key={session.id}>
              <Cell>
                <Link to={`/workspaces/${session.license_id}`} className={LINK_CLASS}>
                  {session.organization_name ?? session.license_id}
                </Link>
              </Cell>
              <Cell>{session.account_email ?? session.account_id}</Cell>
              <Cell>{session.admin_email ?? session.admin_id}</Cell>
              <Cell>{t(`support.impersonate.modes.${session.mode}`)}</Cell>
              <Cell>{formatDateTime(session.ends_at)}</Cell>
              <Cell>
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  onClick={() => setEnding(session)}
                >
                  {t('support.impersonations.end')}
                </button>
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
      {ending && (
        <ReasonDialog
          title={t('support.impersonations.endTitle', {
            email: ending.account_email ?? ending.account_id,
          })}
          description={t('support.impersonations.endDescription')}
          confirmLabel={t('support.impersonations.end')}
          onConfirm={({ reason }) => end.mutateAsync({ id: ending.id, reason })}
          onDone={() => setEnding(null)}
          onCancel={() => setEnding(null)}
        />
      )}
    </Card>
  );
}
