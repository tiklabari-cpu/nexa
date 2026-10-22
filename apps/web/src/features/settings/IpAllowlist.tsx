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
import { FormSaveBar } from '../../components/settings/FormSaveBar.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, optional, required, useForm, type Validator } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { reasonMessage } from '../../lib/reason-message.js';

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
              className="flex flex-wrap items-start gap-3 border-b border-border p-4"
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
                  placeholder={t('settings.ipAllowlist.labelPlaceholder')}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              <button
                type="submit"
                disabled={!form.canSubmit}
                className="mt-5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? t('settings.adding') : t('settings.ipAllowlist.addButton')}
              </button>

              {add.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {/* The self-lockout guard names the exact fix, so it keeps its own
                      sentence — worded from the server's `details.reason`, not its prose. */}
                  {reasonMessage(t, add.error, 'settings.reason') ?? t(errorMessageKey(add.error))}
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
  /**
   * The save waiting on the "turn two-factor on" confirmation — set only while
   * it is open; Confirm sends it, Cancel drops it and the draft stays as typed.
   */
  const [pending, setPending] = useState<Partial<SecuritySettings> | null>(null);
  const confirmTwoFactor = pending !== null;

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
      setPending(null);
    },
  });

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
            onConfirmTwoFactor={setPending}
          />
        )}
      </Card>

      {confirmTwoFactor && (
        <Modal
          onClose={() => setPending(null)}
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
              onClick={() => setPending(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="button"
              onClick={() => pending && save.mutate(pending)}
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
 * real saved values on the very first render (`SlaPolicy`'s reasoning).
 *
 * All four controls are one draft written by the SaveBar (tm 323.2 · GV-06).
 * The two checkboxes used to write the moment they were ticked — for the whole
 * workspace, one of them able to turn a sign-in away. Turning two-factor *on*
 * still asks first: Save opens the confirmation with the body it will send.
 * Only the "on" direction needs confirming — switching off reopens a door
 * instead of closing one, nobody regrets that at 2am.
 */
function SessionPolicyForm({
  current,
  save,
  confirmTwoFactor,
  onConfirmTwoFactor,
}: {
  current: SecuritySettings;
  save: UseMutationResult<SecuritySettings, unknown, Partial<SecuritySettings>>;
  confirmTwoFactor: boolean;
  onConfirmTwoFactor: (body: Partial<SecuritySettings>) => void;
}): ReactElement {
  const t = useTranslate();
  // The session-policy Save changes nothing on screen (the inputs already hold
  // what was typed), so success has to say so (tm 259.9). Cleared on the next
  // edit or save: "Saved." must never sit beside a value that was not.
  const [saved, setSaved] = useState(false);

  const initial = {
    enforced: String(current.ip_allowlist_enforced),
    twoFactor: String(current.require_two_factor),
    idleMinutes:
      current.session_idle_timeout_seconds != null
        ? String(Math.round(current.session_idle_timeout_seconds / 60))
        : '',
    maxSessions:
      current.max_concurrent_sessions != null ? String(current.max_concurrent_sessions) : '',
  };
  const form = useForm({
    initial,
    validators: {
      idleMinutes: optional(positiveMinutes(t('settings.ipAllowlist.idleTimeoutError'))),
      maxSessions: optional(positiveSessionCount(t('settings.ipAllowlist.maxSessionsError'))),
    },
    onSubmit: async (values) => {
      setSaved(false);
      // Only what moved: the audit entry names the fields written.
      const body: Partial<SecuritySettings> = {};
      if (values.enforced !== initial.enforced) {
        body.ip_allowlist_enforced = values.enforced === 'true';
      }
      if (values.twoFactor !== initial.twoFactor) {
        body.require_two_factor = values.twoFactor === 'true';
      }
      if (values.idleMinutes !== initial.idleMinutes) {
        body.session_idle_timeout_seconds =
          values.idleMinutes.trim() === '' ? null : Math.round(Number(values.idleMinutes) * 60);
      }
      if (values.maxSessions !== initial.maxSessions) {
        body.max_concurrent_sessions =
          values.maxSessions.trim() === '' ? null : Number(values.maxSessions);
      }
      if (body.require_two_factor === true) {
        onConfirmTwoFactor(body);
        return;
      }
      try {
        await save.mutateAsync(body);
        setSaved(true);
      } catch {
        // Surfaced below via the shared `save.isError` banner — the same
        // mutation the confirmation modal uses.
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
          checked={form.values.enforced === 'true'}
          onChange={(event) => {
            setSaved(false);
            form.setValue('enforced', String(event.target.checked));
          }}
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
          checked={form.values.twoFactor === 'true'}
          onChange={(event) => {
            setSaved(false);
            form.setValue('twoFactor', String(event.target.checked));
          }}
        />
        <span className="flex-1 text-sm">
          {t('settings.ipAllowlist.requireTwoFactorCheckboxLabel')}
          <span className="block text-2xs text-content-tertiary">
            {t('settings.ipAllowlist.requireTwoFactorHint')}
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-start gap-3">
        <label htmlFor="idle-timeout" className="flex w-40 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.ipAllowlist.idleTimeoutLabel')}
          </span>
          <input
            id="idle-timeout"
            type="number"
            min={1}
            value={form.values.idleMinutes}
            onChange={(event) => {
              setSaved(false);
              form.setValue('idleMinutes', event.target.value);
            }}
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
            onChange={(event) => {
              setSaved(false);
              form.setValue('maxSessions', event.target.value);
            }}
            onBlur={() => form.blur('maxSessions')}
            aria-invalid={maxSessionsError ? true : undefined}
            aria-describedby={maxSessionsError ? 'max-sessions-error' : undefined}
            placeholder={t('settings.ipAllowlist.defaultMaxSessions')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <FieldError id="max-sessions-error" message={maxSessionsError} />
        </label>
      </div>

      {save.isError && !confirmTwoFactor && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(save.error))}
        </p>
      )}
      {saved && !save.isError && (
        <p role="status" className="text-2xs text-content-secondary">
          {t('settings.ipAllowlist.savedNote')}
        </p>
      )}
      {/* The rejection is the banner above, shared with the confirmation; the
          bar does not repeat it. Saving covers the wait on the confirmation. */}
      <FormSaveBar
        form={{ ...form, isSubmitting: form.isSubmitting || save.isPending || confirmTwoFactor }}
        error={null}
      />
    </form>
  );
}
