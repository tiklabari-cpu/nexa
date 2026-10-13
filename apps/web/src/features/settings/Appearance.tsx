/**
 * Settings → Appearance (owner, 2026-10-13): the workspace's default panel font.
 *
 * Five cards, each in its own face with one line of sample text, so the owner
 * picks by sight. Only the owner may save (`PUT /settings/appearance` is
 * owner-only on the server too); anyone else who reaches the section sees it
 * read-only, with a line saying who can change it.
 *
 * A saved default repaints every member whose own choice is older — the rule
 * is the server's (`resolvePanelFontPreset`), so after a save this screen
 * re-reads the caller's resolved font rather than guessing it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import {
  PANEL_FONT_DESIGNS,
  PANEL_FONT_PRESETS,
  type PanelFontPreset,
  type WorkspaceAppearanceSettings,
} from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { fontNameKey, fontSourceText, loadAllFontFiles, useFontStore } from '../../lib/font.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';

const QUERY_KEY = ['settings', 'appearance'] as const;

export function Appearance({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const settings = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<WorkspaceAppearanceSettings>('/settings/appearance'),
  });

  useEffect(() => {
    void loadAllFontFiles();
  }, []);

  if (settings.error) return <ErrorNotice message={t('settings.appearance.loadError')} />;

  return (
    <Section
      id="section-appearance"
      title={t('settings.appearance.title')}
      description={t('settings.appearance.description')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <AppearanceForm saved={settings.data} canEdit={canEdit} />
        )}
      </Card>
    </Section>
  );
}

function AppearanceForm({
  saved,
  canEdit,
}: {
  saved: WorkspaceAppearanceSettings;
  canEdit: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refreshAppearance = useAuth((s) => s.refreshAppearance);
  const appearance = useFontStore((s) => s.appearance);
  const [selected, setSelected] = useState<PanelFontPreset>(saved.font_preset ?? 'inter');
  const [note, setNote] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (font_preset: PanelFontPreset | null) =>
      api.put<WorkspaceAppearanceSettings>('/settings/appearance', { font_preset }),
    onSuccess: async (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      setNote(t(data.font_preset ? 'settings.appearance.saved' : 'settings.appearance.removed'));
      if (!data.font_preset) setSelected('inter');
      // The owner's own panel follows the rule like everyone else's.
      await refreshAppearance().catch(() => undefined);
    },
  });

  const current = saved.font_preset
    ? t('settings.appearance.current.set', {
        font: t(fontNameKey(saved.font_preset)),
        date: formatDate(saved.font_preset_set_at) ?? '',
      })
    : t('settings.appearance.current.none');

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm text-content-secondary">{current}</p>

      <fieldset disabled={!canEdit} className="m-0 border-0 p-0">
        <legend className="mb-2 text-sm font-medium text-content">
          {t('settings.appearance.legend')}
        </legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {PANEL_FONT_PRESETS.map((preset) => {
            const design = PANEL_FONT_DESIGNS[preset];
            const checked = selected === preset;
            return (
              <label
                key={preset}
                className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 transition-colors has-[:disabled]:cursor-default ${
                  checked
                    ? 'border-brand-500 bg-brand-100 dark:bg-brand-950'
                    : 'border-border hover:bg-surface-2'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="workspace-font"
                    value={preset}
                    checked={checked}
                    onChange={() => {
                      setSelected(preset);
                      setNote(null);
                    }}
                  />
                  <span
                    lang="en"
                    className="text-base font-semibold text-content"
                    style={{
                      fontFamily: design.heading,
                      letterSpacing: design.letterSpacingHeading,
                    }}
                  >
                    {t(fontNameKey(preset))}
                  </span>
                </span>
                <span
                  className="text-sm text-content"
                  style={{
                    fontFamily: design.body,
                    fontFeatureSettings: design.features,
                    letterSpacing: design.letterSpacingBody,
                  }}
                >
                  {t('settings.appearance.sample')}
                </span>
                <span className="text-2xs text-content-tertiary">
                  {t(`${fontNameKey(preset)}.description`)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={save.isPending || selected === saved.font_preset}
            onClick={() => save.mutate(selected)}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {t('settings.appearance.save')}
          </button>
          <button
            type="button"
            disabled={save.isPending || saved.font_preset === null}
            onClick={() => save.mutate(null)}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
          >
            {t('settings.appearance.remove')}
          </button>
          {note && (
            <p role="status" className="text-sm text-success">
              {note}
            </p>
          )}
          {save.error && (
            <p role="alert" className="text-sm text-danger">
              {t(errorMessageKey(save.error))}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-content-secondary">{t('settings.appearance.ownerOnly')}</p>
      )}

      <p className="text-2xs text-content-tertiary">
        {t('settings.appearance.yours', { source: fontSourceText(t, appearance) })}
      </p>
    </div>
  );
}
