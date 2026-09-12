/**
 * Public knowledge base — the on/off switch and its public address
 * (PUBKB-b · PRD §5.3, tm 246).
 *
 * `PUT /kb-settings` has existed and been tested since the public KB shipped,
 * but nothing in the console ever called it — `KbArticleEditor` only *reads*
 * the setting, to grey out authoring while it is off. So the one screen that
 * knows the KB is off is the one that was blocked by it, with no door back to
 * turn it on. This is that door.
 *
 * The write is `minimumRole: 'admin'` on the server, on top of the same
 * `agents-bot--all:rw` scope the rest of the Playbook edits with — enabling a
 * public-facing surface is a bigger decision than editing a skill, so the
 * button is hidden below that rank the same courtesy way `Compliance.tsx`
 * hides its own admin-gated control. The route stays the real boundary
 * either way.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

interface KbSettingsData {
  enabled: boolean;
  public_slug: string | null;
  site_title: string | null;
  updated_at: string | null;
}

/** Mirrors the server's `minimumRole: 'admin'` gate on `PUT /kb-settings`. */
const EDITOR_ROLES = new Set(['admin', 'viceowner', 'owner']);

export function KbSettings({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const role = useAuth((s) => s.agent?.role ?? null);
  const canWrite = canEdit && role !== null && EDITOR_ROLES.has(role);

  const settings = useQuery({
    queryKey: ['playbook', 'kb-settings'],
    queryFn: () => api.get<KbSettingsData>('/kb-settings'),
  });

  const [enabled, setEnabled] = useState(false);
  const [publicSlug, setPublicSlug] = useState('');
  const [siteTitle, setSiteTitle] = useState('');
  // Tracks whether the fields below hold an edit in progress, so a refetch
  // that lands mid-edit (another admin's change, a background revalidation)
  // does not overwrite what this admin just typed.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!settings.data || touched) return;
    setEnabled(settings.data.enabled);
    setPublicSlug(settings.data.public_slug ?? '');
    setSiteTitle(settings.data.site_title ?? '');
  }, [settings.data, touched]);

  const save = useMutation({
    mutationFn: () =>
      api.put<KbSettingsData>('/kb-settings', {
        enabled,
        public_slug: publicSlug.trim(),
        site_title: siteTitle.trim() === '' ? null : siteTitle.trim(),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['playbook', 'kb-settings'], data);
      setTouched(false);
    },
  });

  // The server requires a public address the first time the KB is configured,
  // and accepts any string it can normalise afterwards — so the one thing
  // knowable client-side, without duplicating that normalisation, is that
  // turning the switch on needs *something* typed here.
  const slugMissing = enabled && publicSlug.trim() === '';
  const canSave = touched && !slugMissing && !save.isPending;

  return (
    <Section
      title={t('playbook.kbSettings.title')}
      description={t('playbook.kbSettings.description')}
    >
      {settings.error ? (
        <ErrorNotice message={t('playbook.kbSettings.loadError')} />
      ) : (
        <Card>
          {settings.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('playbook.kbSettings.loading')}</p>
          ) : (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <StatusDot
                  tone={settings.data?.enabled ? 'success' : 'neutral'}
                  label={
                    settings.data?.enabled
                      ? t('playbook.kbSettings.on')
                      : t('playbook.kbSettings.off')
                  }
                />
                {canWrite && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => {
                        setTouched(true);
                        setEnabled(event.target.checked);
                      }}
                    />
                    {t('playbook.kbSettings.enableLabel')}
                  </label>
                )}
              </div>

              {!canWrite && canEdit && (
                <p className="text-2xs text-content-tertiary">
                  {t('playbook.kbSettings.restricted')}
                </p>
              )}

              {canWrite && (
                <>
                  {/* Sibling label, not a wrapper: a label that also wraps the
                      error span below folds that sentence into the input's
                      accessible name, breaking `getByLabelText`. */}
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="kb-settings-slug"
                      className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                    >
                      {t('playbook.kbSettings.publicSlugLabel')}
                    </label>
                    <input
                      id="kb-settings-slug"
                      value={publicSlug}
                      onChange={(event) => {
                        setTouched(true);
                        setPublicSlug(event.target.value);
                      }}
                      placeholder={t('playbook.kbSettings.publicSlugPlaceholder')}
                      className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                    />
                    {slugMissing && (
                      <span className="text-2xs text-danger">
                        {t('playbook.kbSettings.publicSlugRequired')}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="kb-settings-title"
                      className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                    >
                      {t('playbook.kbSettings.siteTitleLabel')}
                    </label>
                    <input
                      id="kb-settings-title"
                      value={siteTitle}
                      onChange={(event) => {
                        setTouched(true);
                        setSiteTitle(event.target.value);
                      }}
                      placeholder={t('playbook.kbSettings.siteTitlePlaceholder')}
                      className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={!canSave}
                      onClick={() => save.mutate()}
                      className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                    >
                      {save.isPending
                        ? t('playbook.kbSettings.saving')
                        : t('playbook.kbSettings.save')}
                    </button>
                    {save.isError && (
                      <span role="alert" className="text-2xs text-danger">
                        {t(errorMessageKey(save.error))}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}
