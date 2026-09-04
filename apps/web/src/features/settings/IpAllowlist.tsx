/**
 * IP allowlist and session policy (FR-MOD-08.9.6) + the `require_two_factor`
 * switch (S11-2FA-h).
 *
 * Three controls that share one `security_settings` row: the allowlist is its
 * own CRUD resource (`/settings/ip-allowlist`, one row per entry), while
 * enforcement, the two session limits and two-factor enforcement are columns
 * on the same settings row `FileSharing` and `BannedCustomerIps` read — so a
 * save here goes through that same `['settings','security']` cache and every
 * screen stays in step. All validation, self-lockout rejection and
 * enforcement happen server-side (08.9.6-c/d/e/g, S11-2FA-e); this screen only
 * lists, submits and shows what the server says.
 *
 * Turning `require_two_factor` on is confirmed, off is not — `SsoConnection.tsx`'s
 * `enforced` toggle sets the precedent (asymmetric because only one direction
 * closes a door on somebody). Unlike that toggle there is no server-side
 * self-lockout guard here: enforcement never signs anybody out, it only asks
 * for a factor at the *next* sign-in (S11-2FA-e's `enrollment_required`), so
 * the confirmation exists to inform, not to gate a rejection — the roster
 * count comes from `GET /agents`, the same call `TeamPage.tsx` renders.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, optional, required, useForm, type Validator } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

interface IpAllowlistEntry {
  id: string;
  entry: string;
  label: string | null;
  created_at: string;
}

interface SecuritySettings {
  banned_customer_ips: string[];
  file_sharing_enabled: boolean;
  allowed_file_types: string[];
  max_file_size_bytes: number;
  spam_filter_enabled: boolean;
  require_two_factor: boolean;
  ip_allowlist_enforced: boolean;
  session_idle_timeout_seconds: number | null;
  max_concurrent_sessions: number | null;
  updated_at: string | null;
}

export function IpAllowlist({ canEdit }: { canEdit: boolean }): ReactElement {
  return (
    <>
      <IpAllowlistEntries canEdit={canEdit} />
      <SessionPolicy canEdit={canEdit} />
    </>
  );
}

// --- Allowlist entries --------------------------------------------------------

function IpAllowlistEntries({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'ip-allowlist'],
    queryFn: () => api.get<{ items: IpAllowlistEntry[] }>('/settings/ip-allowlist'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'ip-allowlist'] });

  const add = useMutation({
    mutationFn: (body: { entry: string; label: string | null }) =>
      api.post<IpAllowlistEntry>('/settings/ip-allowlist', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/ip-allowlist/${id}`),
    onSuccess: invalidate,
  });

  const form = useForm({
    initial: { entry: '', label: '' },
    validators: { entry: required(t('settings.ipAllowlist.entryRequiredError')) },
    onSubmit: async (values, { reset }) => {
      try {
        await add.mutateAsync({ entry: values.entry.trim(), label: values.label.trim() || null });
        reset();
      } catch {
        // Surfaced below via the shared `add.isError` banner, including the
        // self-lockout guard's deliberately untranslated, name-the-exact-fix
        // message (08.9.6-g) — nothing extra to do here.
      }
    },
  });
  const entryError = form.errorFor('entry');

  return (
    <Section
      title={t('settings.ipAllowlist.title')}
      description={t('settings.ipAllowlist.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.ipAllowlist.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-allowlist-entry" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.ipAllowlist.entryLabel')}
                </span>
                <input
                  id="new-allowlist-entry"
                  value={form.values.entry}
                  onChange={(event) => form.setValue('entry', event.target.value)}
                  onBlur={() => form.blur('entry')}
                  aria-invalid={entryError ? true : undefined}
                  aria-describedby={entryError ? 'new-allowlist-entry-error' : undefined}
                  placeholder="10.0.0.0/24"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="new-allowlist-entry-error" message={entryError} />
              </label>

              <label htmlFor="new-allowlist-label" className="flex w-48 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.ipAllowlist.labelLabel')}
                </span>
                <input
                  id="new-allowlist-label"
                  value={form.values.label}
                  onChange={(event) => form.setValue('label', event.target.value)}
                  placeholder="Office VPN"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              <button
                type="submit"
                disabled={!form.canSubmit}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? t('settings.adding') : t('settings.ipAllowlist.addButton')}
              </button>

              {add.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {add.error instanceof ApiClientError
                    ? // i18n-ignore — self-lockout guard names the exact fix; genericizing would strand the one person who can act on it (08.9.6-g).
                      add.error.message
                    : t(errorMessageKey(add.error))}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.ipAllowlist.empty.title')}
              description={t('settings.ipAllowlist.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm">
                    {item.entry}
                    {item.label && (
                      <span className="ml-2 font-sans text-2xs text-content-tertiary">
                        {item.label}
                      </span>
                    )}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      {t('settings.remove')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

// --- Session policy ------------------------------------------------------------

function positiveMinutes(message: string): Validator {
  return (value) => {
    const minutes = Number(value.trim());
    return Number.isFinite(minutes) && minutes >= 1 ? null : message;
  };
}

function positiveSessionCount(message: string): Validator {
  return (value) => {
    const sessions = Number(value.trim());
    return Number.isInteger(sessions) && sessions >= 1 ? null : message;
  };
}

function SessionPolicy({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  /** Set only while the "turn two-factor on" confirmation is open. */
  const [confirmTwoFactor, setConfirmTwoFactor] = useState(false);

  const settings = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () => api.get<SecuritySettings>('/settings/security'),
  });

  // Only fetched for the confirmation copy ("N of M teammates…") — a
  // read-only viewer never sees the checkbox that would open it.
  const roster = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: Array<{ two_factor_enabled: boolean }> }>('/agents'),
    enabled: canEdit,
  });
  const rosterItems = roster.data?.items ?? [];
  const missingTwoFactor = rosterItems.filter((agent) => !agent.two_factor_enabled).length;

  const save = useMutation({
    mutationFn: (body: Partial<SecuritySettings>) =>
      api.patch<SecuritySettings>('/settings/security', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'security'], data);
      setConfirmTwoFactor(false);
    },
  });

  function handleRequireTwoFactorChange(checked: boolean): void {
    // Only the "on" direction needs confirming — switching off reopens a
    // door instead of closing one, nobody regrets that at 2am.
    if (checked) setConfirmTwoFactor(true);
    else save.mutate({ require_two_factor: false });
  }

  if (settings.error)
    return <ErrorNotice message={t('settings.ipAllowlist.sessionPolicyLoadError')} />;

  const current = settings.data;

  return (
    <Section
      title={t('settings.ipAllowlist.sessionPolicyTitle')}
      description={t('settings.ipAllowlist.sessionPolicyDescription')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : !canEdit ? (
          <div className="flex flex-col gap-2 p-4 text-sm text-content-secondary">
            <p className="flex items-center gap-2">
              {t('settings.ipAllowlist.enforceLabel')}
              <StatusDot
                tone={current!.ip_allowlist_enforced ? 'success' : 'neutral'}
                label={current!.ip_allowlist_enforced ? t('settings.on') : t('settings.off')}
              />
            </p>
            <p className="flex items-center gap-2">
              {t('settings.ipAllowlist.requireTwoFactorLabel')}
              <StatusDot
                tone={current!.require_two_factor ? 'success' : 'neutral'}
                label={current!.require_two_factor ? t('settings.on') : t('settings.off')}
              />
            </p>
            <p>
              {t('settings.ipAllowlist.idleTimeoutSummary', {
                value:
                  current!.session_idle_timeout_seconds != null
                    ? t('settings.ipAllowlist.minutesValue', {
                        count: Math.round(current!.session_idle_timeout_seconds / 60),
                      })
                    : t('settings.off'),
              })}
            </p>
            <p>
              {t('settings.ipAllowlist.maxSessionsSummary', {
                value:
                  current!.max_concurrent_sessions ?? t('settings.ipAllowlist.defaultMaxSessions'),
              })}
            </p>
          </div>
        ) : (
          <SessionPolicyForm
            current={current!}
            save={save}
            confirmTwoFactor={confirmTwoFactor}
            onRequireTwoFactorChange={handleRequireTwoFactorChange}
          />
        )}
      </Card>

      {confirmTwoFactor && (
        <Modal
          onClose={() => setConfirmTwoFactor(false)}
          title={t('settings.ipAllowlist.requireTwoFactorConfirmTitle')}
          description={t('settings.ipAllowlist.requireTwoFactorConfirmDescription')}
        >
          {!roster.isPending && !roster.error && (
            <p className="text-sm text-content-secondary">
              {t('settings.ipAllowlist.requireTwoFactorMissingCount', {
                count: missingTwoFactor,
                total: rosterItems.length,
              })}
            </p>
          )}
          {save.isError && (
            <p role="alert" className="mt-2 text-2xs text-danger">
              {t(errorMessageKey(save.error))}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmTwoFactor(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="button"
              onClick={() => save.mutate({ require_two_factor: true })}
              disabled={save.isPending}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {save.isPending
                ? t('settings.saving')
                : t('settings.ipAllowlist.requireTwoFactorConfirmButton')}
            </button>
          </div>
        </Modal>
      )}
    </Section>
  );
}

/**
 * Mounted only once the settings have loaded, so `useForm`'s `initial` is the
 * real saved values on the very first render (`SlaPolicy`'s reasoning). The two
 * checkboxes save immediately on change, outside `useForm`'s value state —
 * only the idle-timeout/max-sessions pair goes through the submit button.
 */
function SessionPolicyForm({
  current,
  save,
  confirmTwoFactor,
  onRequireTwoFactorChange,
}: {
  current: SecuritySettings;
  save: UseMutationResult<SecuritySettings, unknown, Partial<SecuritySettings>>;
  confirmTwoFactor: boolean;
  onRequireTwoFactorChange: (checked: boolean) => void;
}): ReactElement {
  const t = useTranslate();

  const form = useForm({
    initial: {
      idleMinutes:
        current.session_idle_timeout_seconds != null
          ? String(Math.round(current.session_idle_timeout_seconds / 60))
          : '',
      maxSessions:
        current.max_concurrent_sessions != null ? String(current.max_concurrent_sessions) : '',
    },
    validators: {
      idleMinutes: optional(positiveMinutes(t('settings.ipAllowlist.idleTimeoutError'))),
      maxSessions: optional(positiveSessionCount(t('settings.ipAllowlist.maxSessionsError'))),
    },
    onSubmit: async (values) => {
      try {
        await save.mutateAsync({
          session_idle_timeout_seconds:
            values.idleMinutes.trim() === '' ? null : Math.round(Number(values.idleMinutes) * 60),
          max_concurrent_sessions:
            values.maxSessions.trim() === '' ? null : Number(values.maxSessions),
        });
      } catch {
        // Surfaced below via the shared `save.isError` banner — the same
        // mutation the two checkboxes and the confirmation modal use.
      }
    },
  });
  const idleError = form.errorFor('idleMinutes');
  const maxSessionsError = form.errorFor('maxSessions');

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4 p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={current.ip_allowlist_enforced}
          disabled={save.isPending}
          onChange={(event) => save.mutate({ ip_allowlist_enforced: event.target.checked })}
        />
        <span className="flex-1 text-sm">
          {t('settings.ipAllowlist.enforceCheckboxLabel')}
          <span className="block text-2xs text-content-tertiary">
            {t('settings.ipAllowlist.enforceHint')}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={current.require_two_factor}
          disabled={save.isPending}
          onChange={(event) => onRequireTwoFactorChange(event.target.checked)}
        />
        <span className="flex-1 text-sm">
          {t('settings.ipAllowlist.requireTwoFactorCheckboxLabel')}
          <span className="block text-2xs text-content-tertiary">
            {t('settings.ipAllowlist.requireTwoFactorHint')}
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="idle-timeout" className="flex w-40 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.ipAllowlist.idleTimeoutLabel')}
          </span>
          <input
            id="idle-timeout"
            type="number"
            min={1}
            value={form.values.idleMinutes}
            onChange={(event) => form.setValue('idleMinutes', event.target.value)}
            onBlur={() => form.blur('idleMinutes')}
            aria-invalid={idleError ? true : undefined}
            aria-describedby={idleError ? 'idle-timeout-error' : undefined}
            placeholder={t('settings.off')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <FieldError id="idle-timeout-error" message={idleError} />
        </label>

        <label htmlFor="max-sessions" className="flex w-40 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.ipAllowlist.maxSessionsLabel')}
          </span>
          <input
            id="max-sessions"
            type="number"
            min={1}
            value={form.values.maxSessions}
            onChange={(event) => form.setValue('maxSessions', event.target.value)}
            onBlur={() => form.blur('maxSessions')}
            aria-invalid={maxSessionsError ? true : undefined}
            aria-describedby={maxSessionsError ? 'max-sessions-error' : undefined}
            placeholder={t('settings.ipAllowlist.defaultMaxSessions')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <FieldError id="max-sessions-error" message={maxSessionsError} />
        </label>

        <button
          type="submit"
          disabled={!form.canSubmit}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {form.isSubmitting ? t('settings.saving') : t('settings.save')}
        </button>
      </div>

      {save.isError && !confirmTwoFactor && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(save.error))}
        </p>
      )}
    </form>
  );
}
