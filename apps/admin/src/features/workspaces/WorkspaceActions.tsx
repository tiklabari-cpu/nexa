/**
 * What an operator can do to one workspace (tm 389.10 · FR-ADMIN-09): the detail page's
 * "Actions" menu, the banners that say a workspace is suspended or about to be deleted, the
 * dialog each action opens, and the list of scheduled deletions.
 *
 * Every action goes through `ReasonDialog` — a reason for the audit chain, and a fresh
 * authenticator code where the server wants one (suspension, ownership, deletion). The ones
 * that need more than a reason put their fields above it and hold the confirm button until
 * those are complete: a number of days, a plan, the override row, the new owner and the
 * identity checklist, the workspace's name typed out.
 *
 * The menu offers what the operator's role may do and what the workspace's state allows; the
 * server decides both again (403, 409 `platform_workspace_state`), and its refusal is shown in
 * the dialog in words that name the state.
 */
import { useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ENTITLEMENTS, type Entitlement } from '@siyahtus/types';
import { Card } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/Banner.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { ApiClientError } from '../../lib/api-client.js';
import { api, hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type {
  PlatformWorkspace,
  PlatformWorkspaceActionResult,
  PlatformWorkspaceMemberList,
} from '../../lib/platform-types.js';
import {
  usePurgeQueue,
  useWorkspaceAction,
  useWorkspaceOverrides,
  useWorkspaceTab,
} from './queries.js';
import { DataTable, FIELD_CLASS, LINK_CLASS, SECONDARY_BUTTON_CLASS } from './ui.js';

export const WORKSPACE_ACTIONS = [
  'extendTrial',
  'activate',
  'setPlan',
  'overrides',
  'resendVerification',
  'sandboxReset',
  'setReadOnly',
  'setActive',
  'cancelSubscription',
  'resumeSubscription',
  'suspend',
  'unsuspend',
  'transfer',
  'delete',
  'cancelDeletion',
] as const;
export type WorkspaceActionKey = (typeof WORKSPACE_ACTIONS)[number];

type Permission = 'workspaces.support' | 'workspaces.billing' | 'workspaces.lifecycle';

/** Who may, and from which state — the menu's courtesy copy of the server's rules. */
const RULES: Record<
  WorkspaceActionKey,
  { permission: Permission; when: (workspace: PlatformWorkspace) => boolean; danger?: boolean }
> = {
  extendTrial: { permission: 'workspaces.support', when: (w) => w.license.status === 'trialing' },
  activate: {
    permission: 'workspaces.billing',
    when: (w) => ['trialing', 'read_only', 'past_due'].includes(w.license.status),
  },
  setPlan: { permission: 'workspaces.billing', when: (w) => !closed(w) },
  overrides: { permission: 'workspaces.billing', when: () => true },
  resendVerification: {
    permission: 'workspaces.support',
    when: (w) => w.owner !== null && w.owner.email_verified_at === null,
  },
  sandboxReset: { permission: 'workspaces.support', when: () => true },
  setReadOnly: {
    permission: 'workspaces.lifecycle',
    when: (w) => ['trialing', 'active', 'past_due'].includes(w.license.status),
  },
  setActive: {
    permission: 'workspaces.lifecycle',
    when: (w) => ['read_only', 'past_due'].includes(w.license.status),
  },
  cancelSubscription: { permission: 'workspaces.lifecycle', when: () => true },
  resumeSubscription: { permission: 'workspaces.lifecycle', when: () => true },
  suspend: {
    permission: 'workspaces.lifecycle',
    when: (w) => w.license.status !== 'suspended',
    danger: true,
  },
  unsuspend: {
    permission: 'workspaces.lifecycle',
    when: (w) => w.license.status === 'suspended' && w.license.purge_scheduled_at === null,
  },
  transfer: { permission: 'workspaces.lifecycle', when: () => true, danger: true },
  delete: {
    permission: 'workspaces.lifecycle',
    when: (w) => w.license.purge_scheduled_at === null,
    danger: true,
  },
  cancelDeletion: {
    permission: 'workspaces.lifecycle',
    when: (w) => w.license.purge_scheduled_at !== null,
  },
};

/** The actions that want a code from the authenticator no older than five minutes. */
const FRESH_CODE: ReadonlySet<WorkspaceActionKey> = new Set([
  'suspend',
  'unsuspend',
  'transfer',
  'delete',
]);

const STATE_REASONS = [
  'not_trialing',
  'workspace_closed',
  'trialing',
  'purge_scheduled',
  'no_subscription',
  'no_owner',
  'no_sandbox',
  'not_a_member',
  'member_suspended',
] as const;

const DAY_MS = 86_400_000;

function closed(workspace: PlatformWorkspace): boolean {
  return ['suspended', 'canceled'].includes(workspace.license.status);
}

/** The actions this operator may take on this workspace now, in menu order. */
export function availableActions(
  permissions: (permission: string) => boolean,
  workspace: PlatformWorkspace,
): WorkspaceActionKey[] {
  return WORKSPACE_ACTIONS.filter(
    (key) => permissions(RULES[key].permission) && RULES[key].when(workspace),
  );
}

/** Whole days until `iso`, never below zero. */
export function daysUntil(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / DAY_MS));
}

export interface ActionNotice {
  tone: 'success' | 'info' | 'warning';
  message: string;
}

// --- The menu -----------------------------------------------------------------------------

export function WorkspaceActionsMenu({
  workspace,
  onSelect,
}: {
  workspace: PlatformWorkspace;
  onSelect: (action: WorkspaceActionKey) => void;
}): ReactElement | null {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const actions = availableActions((p) => hasPermission(me, p), workspace);
  if (actions.length === 0) return null;
  return (
    <Dropdown
      label={t('workspaces.actions.menu')}
      trigger={t('workspaces.actions.menu')}
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
            {t(`workspaces.actions.${key}.label`)}
          </button>
        ))
      }
    </Dropdown>
  );
}

// --- The banners --------------------------------------------------------------------------

export function WorkspaceStateBanners({
  workspace,
  onSelect,
}: {
  workspace: PlatformWorkspace;
  onSelect: (action: WorkspaceActionKey) => void;
}): ReactElement | null {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const { license } = workspace;
  const canCancel = hasPermission(me, 'workspaces.lifecycle');
  if (license.purge_scheduled_at !== null) {
    return (
      <Banner
        tone="danger"
        title={t('workspaces.banner.purgeTitle')}
        cta={
          canCancel ? (
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS}
              onClick={() => onSelect('cancelDeletion')}
            >
              {t('workspaces.actions.cancelDeletion.label')}
            </button>
          ) : undefined
        }
      >
        {t('workspaces.banner.purge', {
          date: formatDate(license.purge_scheduled_at) ?? '',
          days: daysUntil(license.purge_scheduled_at),
        })}
      </Banner>
    );
  }
  if (license.status === 'suspended') {
    return (
      <Banner tone="warning" title={t('workspaces.banner.suspendedTitle')}>
        {t('workspaces.banner.suspended', { when: formatDateTime(license.suspended_at) ?? '' })}
        {license.suspended_reason && (
          <> {t('workspaces.banner.suspendedReason', { reason: license.suspended_reason })}</>
        )}
      </Banner>
    );
  }
  return null;
}

// --- The dialogs --------------------------------------------------------------------------

type Send = (reason: string) => Promise<PlatformWorkspaceActionResult>;

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-content-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}

/** A positive whole number typed into a box, or null for an empty box; NaN when it is neither. */
function parseCount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return /^\d+$/.test(trimmed) && Number(trimmed) >= 1 ? Number(trimmed) : Number.NaN;
}

export function WorkspaceActionDialog({
  action,
  workspace,
  onClose,
  onNotice,
}: {
  action: WorkspaceActionKey;
  workspace: PlatformWorkspace;
  onClose: () => void;
  onNotice: (notice: ActionNotice) => void;
}): ReactElement {
  const t = useTranslate();
  const id = workspace.license_id;
  const mutation = useWorkspaceAction(id);
  const result = useRef<PlatformWorkspaceActionResult | null>(null);

  const describeError = (error: unknown): string | null => {
    if (!(error instanceof ApiClientError)) return null;
    const reason = error.details?.['reason'];
    if (
      error.type === 'platform_workspace_state' &&
      typeof reason === 'string' &&
      (STATE_REASONS as readonly string[]).includes(reason)
    ) {
      return t(`workspaces.actions.state.${reason}`);
    }
    if (error.type === 'validation' && reason === 'confirm_name_mismatch') {
      return t('workspaces.actions.delete.mismatch');
    }
    return null;
  };

  const run =
    (send: Send) =>
    async ({ reason }: { reason: string }) => {
      result.current = await mutation.mutateAsync(() => send(reason));
    };
  const done = () => {
    const answer = result.current;
    const label = t(`workspaces.actions.${action}.label`);
    if (answer?.unchanged) {
      onNotice({ tone: 'info', message: t('workspaces.actions.unchanged', { action: label }) });
    } else if (answer?.mail === 'failed') {
      onNotice({ tone: 'warning', message: t('workspaces.actions.mailFailed', { action: label }) });
    } else {
      onNotice({ tone: 'success', message: t('workspaces.actions.done', { action: label }) });
    }
    onClose();
  };
  const common = {
    title: t(`workspaces.actions.${action}.title`),
    description: t(`workspaces.actions.${action}.body`, { name: workspace.organization.name }),
    confirmLabel: t(`workspaces.actions.${action}.confirm`),
    requireTotp: FRESH_CODE.has(action),
    onDone: done,
    onCancel: onClose,
    describeError,
  };

  switch (action) {
    case 'extendTrial':
      return <ExtendTrialDialog common={common} licenseId={id} run={run} />;
    case 'setPlan':
      return (
        <SetPlanDialog common={common} licenseId={id} run={run} current={workspace.license.plan} />
      );
    case 'overrides':
      return <OverridesDialog common={common} licenseId={id} run={run} />;
    case 'transfer':
      return <TransferDialog common={common} licenseId={id} run={run} />;
    case 'delete':
      return (
        <DeleteDialog common={common} licenseId={id} run={run} name={workspace.organization.name} />
      );
    case 'activate':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/activate`, { reason }),
          )}
        />
      );
    case 'resendVerification':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/resend-owner-verification`, {
              reason,
            }),
          )}
        />
      );
    case 'sandboxReset':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/sandbox/reset`, { reason }),
          )}
        />
      );
    case 'setReadOnly':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/set-read-only`, { reason }),
          )}
        />
      );
    case 'setActive':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/set-active`, { reason }),
          )}
        />
      );
    case 'cancelSubscription':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/subscription/cancel`, {
              reason,
            }),
          )}
        />
      );
    case 'resumeSubscription':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/subscription/resume`, {
              reason,
            }),
          )}
        />
      );
    case 'suspend':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/suspend`, { reason }),
          )}
        />
      );
    case 'unsuspend':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/unsuspend`, { reason }),
          )}
        />
      );
    case 'cancelDeletion':
      return (
        <ReasonDialog
          {...common}
          onConfirm={run((reason) =>
            api.post<PlatformWorkspaceActionResult>(`/workspaces/${id}/delete/cancel`, { reason }),
          )}
        />
      );
  }
}

type Common = Omit<Parameters<typeof ReasonDialog>[0], 'onConfirm'>;
type Run = (send: Send) => (input: { reason: string }) => Promise<void>;

function ExtendTrialDialog({
  common,
  licenseId,
  run,
}: {
  common: Common;
  licenseId: string;
  run: Run;
}): ReactElement {
  const t = useTranslate();
  const [days, setDays] = useState('7');
  const value = parseCount(days);
  const valid = value !== null && !Number.isNaN(value) && value <= 90;
  return (
    <ReasonDialog
      {...common}
      confirmDisabled={!valid}
      extraDirty={days !== '7'}
      onConfirm={run((reason) =>
        api.post<PlatformWorkspaceActionResult>(`/workspaces/${licenseId}/extend-trial`, {
          days: value,
          reason,
        }),
      )}
    >
      <Field
        id="action-days"
        label={t('workspaces.actions.extendTrial.days')}
        hint={t('workspaces.actions.extendTrial.daysHint')}
      >
        <input
          id="action-days"
          type="number"
          min={1}
          max={90}
          inputMode="numeric"
          value={days}
          onChange={(event) => setDays(event.target.value)}
          aria-describedby="action-days-hint"
          className={`${FIELD_CLASS} w-32`}
        />
      </Field>
    </ReasonDialog>
  );
}

function SetPlanDialog({
  common,
  licenseId,
  run,
  current,
}: {
  common: Common;
  licenseId: string;
  run: Run;
  current: string;
}): ReactElement {
  const t = useTranslate();
  const [plan, setPlan] = useState(current === 'enterprise' ? 'growth' : 'enterprise');
  return (
    <ReasonDialog
      {...common}
      confirmDisabled={plan === current}
      onConfirm={run((reason) =>
        api.post<PlatformWorkspaceActionResult>(`/workspaces/${licenseId}/set-plan`, {
          plan,
          reason,
        }),
      )}
    >
      <Field
        id="action-plan"
        label={t('workspaces.actions.setPlan.plan')}
        hint={t('workspaces.actions.setPlan.current', { plan: t(`workspaces.plan.${current}`) })}
      >
        <select
          id="action-plan"
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          aria-describedby="action-plan-hint"
          className={FIELD_CLASS}
        >
          {['growth', 'enterprise'].map((value) => (
            <option key={value} value={value}>
              {t(`workspaces.plan.${value}`)}
            </option>
          ))}
        </select>
      </Field>
    </ReasonDialog>
  );
}

type Tri = 'plan' | 'on' | 'off';

function OverridesDialog({
  common,
  licenseId,
  run,
}: {
  common: Common;
  licenseId: string;
  run: Run;
}): ReactElement {
  const t = useTranslate();
  const query = useWorkspaceOverrides(licenseId);
  const stored = query.data?.overrides;
  if (!stored) {
    return (
      <ReasonDialog {...common} confirmDisabled onConfirm={async () => undefined}>
        <p role="status" className="text-sm text-content-secondary">
          {query.isError ? t('workspaces.tab.loadError') : t('workspaces.loading')}
        </p>
      </ReasonDialog>
    );
  }
  return <OverridesForm common={common} licenseId={licenseId} run={run} stored={stored} />;
}

function OverridesForm({
  common,
  licenseId,
  run,
  stored,
}: {
  common: Common;
  licenseId: string;
  run: Run;
  stored: NonNullable<ReturnType<typeof useWorkspaceOverrides>['data']>['overrides'];
}): ReactElement {
  const t = useTranslate();
  const initial = useMemo(
    () => ({
      seat: stored.seat_ceiling === null ? '' : String(stored.seat_ceiling),
      mail: stored.mail_daily_cap === null ? '' : String(stored.mail_daily_cap),
      expires: stored.expires_at ? stored.expires_at.slice(0, 10) : '',
      entitlements: Object.fromEntries(
        ENTITLEMENTS.map((key) => {
          const value = (stored.entitlements as Partial<Record<Entitlement, boolean>>)[key];
          return [key, value === undefined ? 'plan' : value ? 'on' : 'off'];
        }),
      ) as Record<Entitlement, Tri>,
    }),
    [stored],
  );
  const [seat, setSeat] = useState(initial.seat);
  const [mail, setMail] = useState(initial.mail);
  const [expires, setExpires] = useState(initial.expires);
  const [entitlements, setEntitlements] = useState(initial.entitlements);
  const seatValue = parseCount(seat);
  const mailValue = parseCount(mail);
  const valid = !Number.isNaN(seatValue) && !Number.isNaN(mailValue);
  const dirty =
    seat !== initial.seat ||
    mail !== initial.mail ||
    expires !== initial.expires ||
    ENTITLEMENTS.some((key) => entitlements[key] !== initial.entitlements[key]);

  return (
    <ReasonDialog
      {...common}
      confirmDisabled={!valid || !dirty}
      extraDirty={dirty}
      onConfirm={run((reason) =>
        api.put<PlatformWorkspaceActionResult>(`/workspaces/${licenseId}/overrides`, {
          entitlements: Object.fromEntries(
            ENTITLEMENTS.filter((key) => entitlements[key] !== 'plan').map((key) => [
              key,
              entitlements[key] === 'on',
            ]),
          ),
          seat_ceiling: seatValue,
          mail_daily_cap: mailValue,
          expires_at: expires ? `${expires}T23:59:59.999Z` : null,
          reason,
        }),
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="override-seats"
          label={t('workspaces.actions.overrides.seatCeiling')}
          hint={t('workspaces.actions.overrides.emptyHint')}
        >
          <input
            id="override-seats"
            inputMode="numeric"
            value={seat}
            onChange={(event) => setSeat(event.target.value)}
            aria-invalid={Number.isNaN(seatValue) ? 'true' : undefined}
            aria-describedby="override-seats-hint"
            className={FIELD_CLASS}
          />
        </Field>
        <Field
          id="override-mail"
          label={t('workspaces.actions.overrides.mailCap')}
          hint={t('workspaces.actions.overrides.emptyHint')}
        >
          <input
            id="override-mail"
            inputMode="numeric"
            value={mail}
            onChange={(event) => setMail(event.target.value)}
            aria-invalid={Number.isNaN(mailValue) ? 'true' : undefined}
            aria-describedby="override-mail-hint"
            className={FIELD_CLASS}
          />
        </Field>
      </div>
      <Field
        id="override-expires"
        label={t('workspaces.actions.overrides.expiresAt')}
        hint={t('workspaces.actions.overrides.expiresHint')}
      >
        <input
          id="override-expires"
          type="date"
          value={expires}
          onChange={(event) => setExpires(event.target.value)}
          aria-describedby="override-expires-hint"
          className={`${FIELD_CLASS} w-48`}
        />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium">
          {t('workspaces.actions.overrides.entitlements')}
        </legend>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2">
          {ENTITLEMENTS.map((key) => (
            <div key={key}>
              <label htmlFor={`override-${key}`} className="text-xs text-content-secondary">
                {t(`workspaces.entitlements.${key}`)}
              </label>
              <select
                id={`override-${key}`}
                value={entitlements[key]}
                onChange={(event) =>
                  setEntitlements({ ...entitlements, [key]: event.target.value as Tri })
                }
                className={FIELD_CLASS}
              >
                <option value="plan">{t('workspaces.actions.overrides.fromPlan')}</option>
                <option value="on">{t('workspaces.actions.overrides.granted')}</option>
                <option value="off">{t('workspaces.actions.overrides.withheld')}</option>
              </select>
            </div>
          ))}
        </div>
      </fieldset>
    </ReasonDialog>
  );
}

function TransferDialog({
  common,
  licenseId,
  run,
}: {
  common: Common;
  licenseId: string;
  run: Run;
}): ReactElement {
  const t = useTranslate();
  const members = useWorkspaceTab(licenseId, 'members', () =>
    api.get<PlatformWorkspaceMemberList>(`/workspaces/${licenseId}/members`),
  );
  const candidates = (members.data?.data ?? []).filter(
    (member) => member.role !== 'owner' && !member.suspended,
  );
  const [to, setTo] = useState('');
  const [ticket, setTicket] = useState('');
  const [signed, setSigned] = useState(false);
  const [phone, setPhone] = useState(false);
  const complete = to !== '' && ticket.trim() !== '' && signed && phone;

  return (
    <ReasonDialog
      {...common}
      confirmDisabled={!complete}
      extraDirty={to !== '' || ticket !== '' || signed || phone}
      onConfirm={run((reason) =>
        api.post<PlatformWorkspaceActionResult>(
          `/workspaces/${licenseId}/force-ownership-transfer`,
          {
            to_account_id: to,
            verification_checklist: {
              ticket_id: ticket.trim(),
              signed_request: signed,
              phone_verified: phone,
            },
            reason,
          },
        ),
      )}
    >
      <Field
        id="transfer-to"
        label={t('workspaces.actions.transfer.to')}
        hint={
          members.isSuccess && candidates.length === 0
            ? t('workspaces.actions.transfer.none')
            : t('workspaces.actions.transfer.toHint')
        }
      >
        <select
          id="transfer-to"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          aria-describedby="transfer-to-hint"
          className={FIELD_CLASS}
        >
          <option value="">{t('workspaces.actions.transfer.choose')}</option>
          {candidates.map((member) => (
            <option key={member.account_id} value={member.account_id}>
              {`${member.name} · ${member.email} · ${t(`workspaces.roles.${member.role}`)}`}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">
          {t('workspaces.actions.transfer.checklist')}
        </legend>
        <Field id="transfer-ticket" label={t('workspaces.actions.transfer.ticket')}>
          <input
            id="transfer-ticket"
            value={ticket}
            maxLength={100}
            onChange={(event) => setTicket(event.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Check
          id="transfer-signed"
          label={t('workspaces.actions.transfer.signed')}
          checked={signed}
          onChange={setSigned}
        />
        <Check
          id="transfer-phone"
          label={t('workspaces.actions.transfer.phone')}
          checked={phone}
          onChange={setPhone}
        />
      </fieldset>
    </ReasonDialog>
  );
}

function DeleteDialog({
  common,
  licenseId,
  run,
  name,
}: {
  common: Common;
  licenseId: string;
  run: Run;
  name: string;
}): ReactElement {
  const t = useTranslate();
  const [typed, setTyped] = useState('');
  return (
    <ReasonDialog
      {...common}
      confirmDisabled={typed.trim() !== name.trim()}
      extraDirty={typed !== ''}
      onConfirm={run((reason) =>
        api.post<PlatformWorkspaceActionResult>(`/workspaces/${licenseId}/delete`, {
          confirm_name: typed,
          reason,
        }),
      )}
    >
      <Field
        id="delete-name"
        label={t('workspaces.actions.delete.confirmName')}
        hint={t('workspaces.actions.delete.confirmHint', { name })}
      >
        <input
          id="delete-name"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
          aria-describedby="delete-name-hint"
          className={FIELD_CLASS}
        />
      </Field>
    </ReasonDialog>
  );
}

// --- The purge queue ----------------------------------------------------------------------

/** Every scheduled deletion — shown on the workspace list while there is one. */
export function PurgeQueueCard(): ReactElement | null {
  const t = useTranslate();
  const query = usePurgeQueue();
  const rows = query.data?.data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">
        {t('workspaces.purgeQueue.title')}
      </h2>
      <DataTable
        caption={t('workspaces.purgeQueue.title')}
        headers={[
          t('workspaces.list.organization'),
          t('workspaces.list.licence'),
          t('workspaces.purgeQueue.deletesOn'),
          t('workspaces.purgeQueue.daysLeft'),
        ]}
      >
        {rows.map((row) => (
          <tr key={row.license_id}>
            <td className="px-4 py-2">
              <Link to={`/workspaces/${row.license_id}`} className={LINK_CLASS}>
                {row.organization_name}
              </Link>
            </td>
            <td className="tabular px-4 py-2">{row.license_id}</td>
            <td className="px-4 py-2">{formatDate(row.purge_scheduled_at)}</td>
            <td className="tabular px-4 py-2">{daysUntil(row.purge_scheduled_at)}</td>
          </tr>
        ))}
      </DataTable>
    </Card>
  );
}
