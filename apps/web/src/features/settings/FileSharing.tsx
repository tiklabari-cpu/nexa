/**
 * The rules every upload is checked against, on both sides of a conversation.
 *
 * They were in the schema from the start but had no screen, so every workspace
 * ran on the shipped defaults — three file types and 10 MiB — whether or not
 * those suited it, and nobody could see what the limits were.
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-j, tm
 * 133.10) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated. Not exported from
 * `SettingsPage.tsx` (never was): no test imports it directly, coverage comes
 * from the targeted `settings.spec.ts` e2e.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
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

export function FileSharing({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [types, setTypes] = useState<string | null>(null);
  const [sizeMb, setSizeMb] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () => api.get<SecuritySettings>('/settings/security'),
  });

  const save = useMutation({
    mutationFn: (body: Partial<SecuritySettings>) =>
      api.patch<SecuritySettings>('/settings/security', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'security'], data);
      setTypes(null);
      setSizeMb(null);
    },
  });

  if (settings.error) return <ErrorNotice message={t('settings.fileSharing.loadError')} />;

  const current = settings.data;
  // `?? current` throughout: the inputs are uncontrolled drafts until touched,
  // so an unsaved edit survives a background refetch.
  const typesDraft = types ?? (current ? current.allowed_file_types.join(', ') : '');
  const sizeDraft =
    sizeMb ?? (current ? String(Math.round(current.max_file_size_bytes / 1048576)) : '');

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!current) return;

    const parsedTypes = typesDraft
      .split(',')
      .map((type) => type.trim().toLowerCase())
      .filter(Boolean);
    const megabytes = Number(sizeDraft);
    if (!Number.isFinite(megabytes) || megabytes < 1) return;

    save.mutate({
      allowed_file_types: parsedTypes,
      max_file_size_bytes: Math.round(megabytes * 1048576),
    });
  }

  return (
    <Section
      title={t('settings.fileSharing.title')}
      description={t('settings.fileSharing.description')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <div className="divide-y divide-border">
            <label className="flex items-center gap-3 p-4">
              <input
                type="checkbox"
                checked={current!.file_sharing_enabled}
                disabled={!canEdit || save.isPending}
                onChange={(event) => save.mutate({ file_sharing_enabled: event.target.checked })}
              />
              <span className="flex-1 text-sm">
                {t('settings.fileSharing.allowLabel')}
                <span className="block text-2xs text-content-tertiary">
                  {t('settings.fileSharing.allowHint')}
                </span>
              </span>
              <StatusDot
                tone={current!.file_sharing_enabled ? 'success' : 'neutral'}
                label={current!.file_sharing_enabled ? t('settings.on') : t('settings.off')}
              />
            </label>

            <form onSubmit={submit} className="flex flex-wrap items-end gap-3 p-4">
              <label htmlFor="allowed-types" className="flex min-w-64 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.fileSharing.allowedTypesLabel')}
                </span>
                <input
                  id="allowed-types"
                  value={typesDraft}
                  disabled={!canEdit}
                  onChange={(event) => setTypes(event.target.value)}
                  placeholder="image/png, application/pdf"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                />
                <span className="text-2xs text-content-tertiary">
                  {t('settings.fileSharing.allowedTypesHint')}
                </span>
              </label>

              <label htmlFor="max-size" className="flex w-32 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.fileSharing.maxSizeLabel')}
                </span>
                <input
                  id="max-size"
                  type="number"
                  min={1}
                  max={100}
                  value={sizeDraft}
                  disabled={!canEdit}
                  onChange={(event) => setSizeMb(event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                />
              </label>

              {canEdit && (
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {save.isPending ? t('settings.saving') : t('settings.save')}
                </button>
              )}

              {save.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {t(errorMessageKey(save.error))}
                </p>
              )}
            </form>
          </div>
        )}
      </Card>
    </Section>
  );
}
