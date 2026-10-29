/**
 * Widget texts (tm 344 · WG-05) — a brand's own wording for the widget's
 * offline notice, queue lines, message box placeholder and the rest of
 * `WIDGET_PHRASE_KEYS`, one language at a time.
 *
 * Each field starts empty with the widget's own text as its placeholder
 * (`WIDGET_PHRASE_DEFAULTS`, the same copy the widget ships): an empty field is
 * the default, so "Reset to default" just empties it. The rules the server
 * enforces — the key's length, plain single-line text, only the placeholders
 * the key lists — are checked here as the admin types, from the same
 * `@siyahtus/types` function, so Save is never a surprise.
 *
 * On the shared `SaveBar` (tm 323.2 · GV-06): the draft is the whole language;
 * switching language, brand or section with unsaved edits asks first.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import {
  WIDGET_PHRASE_DEFAULTS,
  WIDGET_PHRASE_KEYS,
  WIDGET_PHRASE_RULES,
  WIDGET_UI_LOCALES,
  widgetPhraseProblem,
  type WidgetPhraseKey,
  type WidgetPhraseProblem,
  type WidgetUiLocale,
} from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../../components/Page.js';
import { useSettingsLeaveGuard } from '../../../components/settings/FormSaveBar.js';
import { SaveBar } from '../../../components/settings/SaveBar.js';
import { ApiClientError } from '../../../lib/api-client.js';
import { useApiClient, useBrand } from '../../../lib/auth-store.js';
import { confirmDiscard } from '../../../lib/dirty-guard.js';
import { useLocale, useTranslate } from '../../../lib/i18n.js';
import { LANGUAGE_NAMES } from '../WidgetCustomization.js';

type PhraseMap = Partial<Record<WidgetPhraseKey, string>>;

interface WidgetPhrases {
  brand_id: string;
  locale: WidgetUiLocale;
  phrases: PhraseMap;
  updated_at: string | null;
}

/** Only what differs from an empty field: the texts a brand actually wrote. */
function written(map: PhraseMap): PhraseMap {
  const out: PhraseMap = {};
  for (const key of WIDGET_PHRASE_KEYS) {
    const text = map[key]?.trim();
    if (text) out[key] = text;
  }
  return out;
}

function sameTexts(a: PhraseMap, b: PhraseMap): boolean {
  return WIDGET_PHRASE_KEYS.every((key) => (a[key]?.trim() ?? '') === (b[key]?.trim() ?? ''));
}

export function WidgetPhrasesSettings({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { brandId } = useBrand();
  const { locale: consoleLocale } = useLocale();
  const [locale, setLocale] = useState<WidgetUiLocale>(
    (WIDGET_UI_LOCALES as readonly string[]).includes(consoleLocale)
      ? (consoleLocale as WidgetUiLocale)
      : 'en',
  );
  const [draft, setDraft] = useState<PhraseMap | null>(null);

  // Another brand is another set of texts; a draft never crosses over.
  useEffect(() => setDraft(null), [brandId]);

  const queryKey = ['settings', 'widget-phrases', brandId, locale];
  const saved = useQuery({
    queryKey,
    queryFn: () => api.get<WidgetPhrases>(`/settings/widget/phrases?locale=${locale}`),
  });

  const save = useMutation({
    mutationFn: (phrases: PhraseMap) =>
      api.put<WidgetPhrases>(`/settings/widget/phrases?locale=${locale}`, { phrases }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setDraft(null);
    },
  });

  const stored = saved.data?.phrases ?? {};
  const value: PhraseMap = draft ?? stored;
  const dirty = draft !== null && !sameTexts(draft, stored);
  useSettingsLeaveGuard(dirty, save.isPending);

  const problems = new Map<WidgetPhraseKey, WidgetPhraseProblem>();
  for (const key of WIDGET_PHRASE_KEYS) {
    const text = value[key]?.trim();
    if (!text) continue;
    const problem = widgetPhraseProblem(key, text);
    if (problem) problems.set(key, problem);
  }

  const set = (key: WidgetPhraseKey, text: string): void =>
    setDraft((prev) => ({ ...(prev ?? stored), [key]: text }));

  const switchLocale = (next: WidgetUiLocale): void => {
    if (next === locale) return;
    if (!confirmDiscard(dirty, t('ui.save.leaveMessage'))) return;
    save.reset();
    setDraft(null);
    setLocale(next);
  };

  // The server names the field it refused; say which, in words.
  const refused =
    save.error instanceof ApiClientError && typeof save.error.details?.['key'] === 'string'
      ? String(save.error.details['key'])
      : null;

  if (saved.error) return <ErrorNotice message={t('settings.widgetPhrases.loadError')} />;

  return (
    <Section
      id="widget-phrases"
      title={t('settings.widgetPhrases.title')}
      description={t('settings.widgetPhrases.description')}
    >
      <Card>
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canEdit && dirty && problems.size === 0 && !save.isPending) {
              save.mutate(written(value));
            }
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="widget-phrases-locale" className="text-xs font-medium">
              {t('settings.widgetPhrases.languageLabel')}
            </label>
            <select
              id="widget-phrases-locale"
              value={locale}
              onChange={(event) => switchLocale(event.target.value as WidgetUiLocale)}
              className="w-56 rounded-md border border-border bg-inset px-3 py-2 text-sm"
            >
              {WIDGET_UI_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_NAMES[code]}
                </option>
              ))}
            </select>
            <p className="text-2xs text-content-tertiary">{t('settings.widgetPhrases.hint')}</p>
          </div>

          {saved.isPending ? (
            <p className="text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : (
            <fieldset disabled={!canEdit} className="flex flex-col gap-4 border-0 p-0">
              {WIDGET_PHRASE_KEYS.map((key) => (
                <PhraseField
                  key={key}
                  phraseKey={key}
                  locale={locale}
                  value={value[key] ?? ''}
                  problem={problems.get(key) ?? null}
                  canEdit={canEdit}
                  onChange={(text) => set(key, text)}
                />
              ))}
            </fieldset>
          )}

          {canEdit && (
            <SaveBar
              submit
              dirty={dirty}
              saving={save.isPending}
              valid={problems.size === 0}
              error={
                refused
                  ? t('settings.widgetPhrases.refused', {
                      field: t(`settings.widgetPhrases.key.${refused}`),
                    })
                  : save.error
              }
              onDiscard={() => {
                save.reset();
                setDraft(null);
              }}
            />
          )}
        </form>
      </Card>
    </Section>
  );
}

function PhraseField({
  phraseKey,
  locale,
  value,
  problem,
  canEdit,
  onChange,
}: {
  phraseKey: WidgetPhraseKey;
  locale: WidgetUiLocale;
  value: string;
  problem: WidgetPhraseProblem | null;
  canEdit: boolean;
  onChange: (next: string) => void;
}): ReactElement {
  const t = useTranslate();
  const rule = WIDGET_PHRASE_RULES[phraseKey];
  const id = `widget-phrase-${phraseKey.replace(/\./g, '-')}`;
  const placeholders = rule.placeholders.map((name) => `{${name}}`).join(', ');
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium">
          {t(`settings.widgetPhrases.key.${phraseKey}`)}
        </label>
        {canEdit && value !== '' && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-2xs text-content-brand hover:underline"
          >
            {t('settings.widgetPhrases.reset')}
          </button>
        )}
      </div>
      <input
        id={id}
        type="text"
        value={value}
        // The widget's own text: what the visitor reads while the field is empty.
        placeholder={WIDGET_PHRASE_DEFAULTS[locale][phraseKey]}
        dir={locale === 'ar' ? 'rtl' : undefined}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${errorId} ${hintId}` : hintId}
        className="rounded-md border border-border bg-inset px-3 py-2 text-sm"
      />
      <p id={hintId} className="text-2xs text-content-tertiary">
        {placeholders
          ? t('settings.widgetPhrases.placeholders', { list: placeholders, max: rule.max })
          : t('settings.widgetPhrases.limit', { max: rule.max })}
      </p>
      {problem && (
        <p id={errorId} role="alert" className="text-2xs text-danger">
          {t(`settings.widgetPhrases.problem.${problem}`, { max: rule.max, list: placeholders })}
        </p>
      )}
    </div>
  );
}
