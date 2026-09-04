/**
 * The address-based half of banning a visitor (FR-MOD-08.9.2).
 *
 * Banning a *customer* from the directory travels with their identity; a visitor
 * who clears cookies comes back as someone new. Blocking the IP closes that: an
 * address on this list is refused a widget token and cannot open or continue a
 * chat. Stored on the same `SecuritySettings` row as file sharing, so it shares
 * that query — a save here returns the whole record and both screens stay in
 * step.
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-j, tm
 * 133.10) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

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

export function BannedCustomerIps({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () => api.get<SecuritySettings>('/settings/security'),
  });

  const save = useMutation({
    mutationFn: (banned_customer_ips: string[]) =>
      api.patch<SecuritySettings>('/settings/security', { banned_customer_ips }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'security'], data);
    },
  });

  const banned = settings.data?.banned_customer_ips ?? [];

  const form = useForm({
    initial: { ip: '' },
    validators: { ip: required(t('settings.bannedIps.ipRequiredError')) },
    onSubmit: async (values, { reset }) => {
      const value = values.ip.trim();
      // The server validates and dedupes; skipping an obvious duplicate here just
      // avoids a pointless round-trip that would come back unchanged.
      if (banned.includes(value)) return;
      try {
        await save.mutateAsync([...banned, value]);
        reset();
      } catch {
        // Surfaced below via the shared `save.isError` banner — the same
        // mutation the remove buttons use, so both paths report through it.
      }
    },
  });
  const ipError = form.errorFor('ip');

  return (
    <Section
      title={t('settings.bannedIps.title')}
      description={t('settings.bannedIps.description')}
    >
      {settings.error ? (
        <ErrorNotice message={t('settings.bannedIps.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-banned-ip" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.bannedIps.ipLabel')}
                </span>
                <input
                  id="new-banned-ip"
                  value={form.values.ip}
                  disabled={settings.isPending}
                  onChange={(event) => form.setValue('ip', event.target.value)}
                  onBlur={() => form.blur('ip')}
                  aria-invalid={ipError ? true : undefined}
                  aria-describedby={ipError ? 'new-banned-ip-error' : undefined}
                  placeholder="203.0.113.5"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                />
                <span className="text-2xs text-content-tertiary">
                  {t('settings.bannedIps.ipHint')}
                </span>
                <FieldError id="new-banned-ip-error" message={ipError} />
              </label>

              <button
                type="submit"
                disabled={!form.canSubmit || settings.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {save.isPending ? t('settings.saving') : t('settings.bannedIps.blockButton')}
              </button>

              {save.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {t(errorMessageKey(save.error))}
                </p>
              )}
            </form>
          )}

          {settings.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : banned.length === 0 ? (
            <EmptyState
              title={t('settings.bannedIps.empty.title')}
              description={t('settings.bannedIps.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {banned.map((entry) => (
                <li key={entry} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm">{entry}</span>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() => save.mutate(banned.filter((value) => value !== entry))}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
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
