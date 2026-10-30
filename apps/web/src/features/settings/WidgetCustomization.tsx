/**
 * Widget customization (FR-MOD-11.7) — appearance, position, mobile and the
 * removable "Powered by" footer, with a live preview beside the controls.
 *
 * The preview is a faithful re-creation rather than the real iframe: embedding
 * the widget here would need a trusted domain and a customer token for a chat
 * nobody is having. So it mirrors the same primitives — launcher, header, a
 * customer bubble, the footer — from the very values being edited, and updates
 * as the admin drags the colour or flips a corner. What ships is what they see.
 *
 * The settings are a per-license singleton the API upserts on first save; every
 * value here also rides in the install snippet (WebsiteWidgets) and is applied
 * by the widget at load, so this screen, the snippet and the widget describe one
 * appearance.
 *
 * Its controls hold a draft (`edits`) until Save, on the shared `SaveBar`
 * (tm 323.2 · GV-06); leaving the section — or switching brand, which drops
 * the draft — with unsaved edits asks first.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import {
  DEFAULT_WIDGET_APPEARANCE,
  DEFAULT_WIDGET_AVAILABILITY_MODE,
  WIDGET_AVAILABILITY_MODES,
  WIDGET_COLOR_PATTERN,
  WIDGET_UI_LOCALES,
  WIDGET_WELCOME_TEXT_MAX,
  WIDGET_WELCOME_TITLE_MAX,
  type WidgetAppearance,
  type WidgetAvailabilityMode,
  type WidgetLanguage,
  type WidgetPosition,
  type WidgetUiLocale,
  type WidgetLauncherVisibility,
  type WidgetTheme,
} from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';
import { SaveBar } from '../../components/settings/SaveBar.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useBrand } from '../../lib/auth-store.js';
import { useEntitlementNote } from '../../lib/entitlement-note.js';
import { useTranslate } from '../../lib/i18n.js';

/** The appearance plus when visitors may start a chat (WG-09), which the widget does not render. */
type WidgetForm = WidgetAppearance & { availability_mode: WidgetAvailabilityMode };

interface WidgetSettings extends WidgetForm {
  updated_at: string | null;
}

/** The editable subset — everything but the read-only `updated_at`. */
type Edits = Partial<WidgetForm>;

export function WidgetCustomization({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const entitlementNote = useEntitlementNote();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { brandId } = useBrand();
  const [edits, setEdits] = useState<Edits>({});

  // A brand switch is a different license-scoped row server-side (or the
  // license default when no brand is selected); an unsaved draft from the
  // previous brand must not be carried over and applied to this one.
  useEffect(() => setEdits({}), [brandId]);

  useSettingsLeaveGuard(Object.keys(edits).length > 0, false);

  const settings = useQuery({
    queryKey: ['settings', 'widget', brandId],
    queryFn: () => api.get<WidgetSettings>('/settings/widget'),
  });

  // For the section title only — which brand's appearance is being edited.
  const brands = useQuery({
    queryKey: ['settings', 'brands'],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>('/brands'),
    enabled: brandId !== null,
    staleTime: 60_000,
  });
  const brandName = brandId ? brands.data?.items.find((b) => b.id === brandId)?.name : undefined;

  const save = useMutation({
    mutationFn: (body: Edits) => api.put<WidgetSettings>('/settings/widget', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'widget', brandId], data);
      // The install snippet bakes these values in, so a saved change must show
      // up the next time an admin copies the code.
      void queryClient.invalidateQueries({ queryKey: ['settings', 'websites'] });
      setEdits({});
    },
  });

  if (settings.error) return <ErrorNotice message={t('settings.widgetCustomization.loadError')} />;

  // The unsaved draft: server values with the pending edits laid over them, or
  // the shipped defaults until the first load resolves.
  const current = settings.data;
  const value: WidgetForm = {
    ...DEFAULT_WIDGET_APPEARANCE,
    availability_mode: DEFAULT_WIDGET_AVAILABILITY_MODE,
    ...(current ?? {}),
    ...edits,
  };
  const dirty = Object.keys(edits).length > 0;
  const set = <K extends keyof WidgetForm>(key: K, next: WidgetForm[K]): void =>
    setEdits((prev) => ({ ...prev, [key]: next }));

  const colorValid = WIDGET_COLOR_PATTERN.test(value.primary_color);
  // The plan gate answers `not_allowed` with `details.entitlement` (api
  // `entitlementDenied`), and ADR-06's generic sentence for that type — "That
  // is not allowed here." — turns an upsell into an unexplained refusal. Named
  // here the way Sandbox.tsx and SlaPolicy.tsx already name theirs.
  const saveError =
    save.error instanceof ApiClientError && save.error.details?.['entitlement'] === 'white_label'
      ? entitlementNote('settings.widgetCustomization.entitlementError')
      : save.error;

  return (
    <Section
      id="widget-customization"
      title={
        brandName
          ? t('settings.widgetCustomization.titleWithBrand', { brand: brandName })
          : t('settings.widgetCustomization.title')
      }
      description={t('settings.widgetCustomization.description')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <div className="grid gap-6 p-4 md:grid-cols-2">
            {/* --- Controls --- */}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canEdit && dirty && colorValid && !save.isPending) save.mutate(edits);
              }}
              className="flex flex-col gap-5"
            >
              <fieldset disabled={!canEdit} className="flex flex-col gap-5 border-0 p-0">
                <ColorControl
                  value={value.primary_color}
                  valid={colorValid}
                  onChange={(next) => set('primary_color', next)}
                />

                <ChoiceControl
                  legend={t('settings.widgetCustomization.positionLegend')}
                  hint={t('settings.widgetCustomization.positionHint')}
                  name="widget-position"
                  value={value.position}
                  options={POSITIONS.map((option) => ({
                    value: option,
                    label: t(`settings.widgetCustomization.position.${option}`),
                  }))}
                  onChange={(next) => set('position', next)}
                />

                <ChoiceControl
                  legend={t('settings.widgetCustomization.themeLegend')}
                  hint={t('settings.widgetCustomization.themeHint')}
                  name="widget-theme"
                  value={value.theme}
                  options={THEMES.map((option) => ({
                    value: option,
                    label: t(`settings.widgetCustomization.theme.${option}`),
                  }))}
                  onChange={(next) => set('theme', next)}
                />

                <LanguageControl
                  language={value.language}
                  fallback={value.fallback_language}
                  onLanguageChange={(next) => set('language', next)}
                  onFallbackChange={(next) => set('fallback_language', next)}
                />

                <ToggleControl
                  label={t('settings.widgetCustomization.mobileFullscreenLabel')}
                  hint={t('settings.widgetCustomization.mobileFullscreenHint')}
                  checked={value.mobile_fullscreen}
                  onChange={(next) => set('mobile_fullscreen', next)}
                />

                <LauncherControl
                  value={value.launcher_visibility}
                  onChange={(next) => set('launcher_visibility', next)}
                />

                <ToggleControl
                  label={t('settings.widgetCustomization.showLogoLabel')}
                  hint={t('settings.widgetCustomization.showLogoHint')}
                  checked={value.show_logo}
                  onChange={(next) => set('show_logo', next)}
                />

                <ToggleControl
                  label={t('settings.widgetCustomization.poweredByLabel')}
                  hint={t('settings.widgetCustomization.poweredByHint')}
                  checked={value.powered_by}
                  onChange={(next) => set('powered_by', next)}
                />

                <WelcomeControl
                  title={value.welcome_title ?? ''}
                  text={value.welcome_text ?? ''}
                  onTitleChange={(next) => set('welcome_title', next)}
                  onTextChange={(next) => set('welcome_text', next)}
                />

                <AvailabilityControl
                  value={value.availability_mode}
                  onChange={(next) => set('availability_mode', next)}
                />
              </fieldset>

              {canEdit && (
                <SaveBar
                  submit
                  dirty={dirty}
                  saving={save.isPending}
                  valid={colorValid}
                  error={saveError}
                  onDiscard={() => {
                    save.reset();
                    setEdits({});
                  }}
                />
              )}
            </form>

            {/* --- Live preview --- */}
            <WidgetPreview appearance={value} />
          </div>
        )}
      </Card>
    </Section>
  );
}

/** Each language in its own name — a picker reads the same in every panel language. */
export const LANGUAGE_NAMES: Record<WidgetUiLocale, string> = {
  en: 'English',
  tr: 'Türkçe',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  ar: 'العربية',
};

const POSITIONS: readonly WidgetPosition[] = ['bottom-right', 'bottom-left'];
const THEMES: readonly WidgetTheme[] = ['auto', 'light', 'dark'];
const LAUNCHER_MODES: readonly WidgetLauncherVisibility[] = ['always', 'until_opened', 'never'];

// --- Controls ----------------------------------------------------------------

function ColorControl({
  value,
  valid,
  onChange,
}: {
  value: string;
  valid: boolean;
  onChange: (next: string) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('settings.widgetCustomization.colorLabel')}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={t('settings.widgetCustomization.colorSwatchAriaLabel')}
          // The native picker only understands full hex; feed it the last valid
          // value so an in-progress edit in the text box does not blank it.
          value={valid ? value : DEFAULT_WIDGET_APPEARANCE.primary_color}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-inset"
        />
        <input
          type="text"
          aria-label={t('settings.widgetCustomization.colorHexAriaLabel')}
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
          spellCheck={false}
          aria-invalid={valid ? undefined : true}
          aria-describedby={valid ? undefined : 'widget-color-error'}
          placeholder="#2d67fa"
          className="w-28 rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none"
        />
      </div>
      {!valid && (
        <p id="widget-color-error" role="alert" className="text-2xs text-danger">
          {t('settings.widgetCustomization.colorError')}
        </p>
      )}
    </div>
  );
}

function ChoiceControl<T extends string>({
  legend,
  hint,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  hint: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}): ReactElement {
  return (
    <fieldset className="flex flex-col gap-1.5 border-0 p-0">
      <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
              value === option.value
                ? 'border-brand-500 bg-brand-100 text-content dark:bg-brand-950'
                : 'border-border text-content-secondary hover:bg-surface-2'
            }`}
          >
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      <span className="text-2xs text-content-tertiary">{hint}</span>
    </fieldset>
  );
}

/**
 * When the chat bubble is drawn (WG-10). The two hidden modes hand the opening
 * to the site's own button, so they say how to wire it — and `never` says what
 * happens when that button breaks, because then nobody can reach support.
 */
function LauncherControl({
  value,
  onChange,
}: {
  value: WidgetLauncherVisibility;
  onChange: (next: WidgetLauncherVisibility) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-2">
      <ChoiceControl
        legend={t('settings.widgetCustomization.launcherLegend')}
        hint={t('settings.widgetCustomization.launcherHint')}
        name="widget-launcher"
        value={value}
        options={LAUNCHER_MODES.map((option) => ({
          value: option,
          label: t(`settings.widgetCustomization.launcher.${option}`),
        }))}
        onChange={onChange}
      />
      {value !== 'always' && (
        <p className="text-2xs text-content-secondary" data-testid="launcher-own-button">
          {t('settings.widgetCustomization.launcherOwnButton')}{' '}
          <code className="rounded bg-surface-2 px-1">siyahtus('open')</code>
        </p>
      )}
      {value === 'never' && (
        <p
          role="note"
          className="rounded-md border border-warning px-2.5 py-1.5 text-2xs text-warning"
          data-testid="launcher-never-risk"
        >
          {t('settings.widgetCustomization.launcherNeverRisk')}
        </p>
      )}
    </div>
  );
}

function ToggleControl({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): ReactElement {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <span className="text-sm">
        {label}
        <span className="block text-2xs text-content-tertiary">{hint}</span>
      </span>
    </label>
  );
}

/**
 * When visitors may start a chat (WG-09): two choices, each with what it
 * does, so the admin reads the consequence before saving rather than finding
 * out from a player at night.
 */
function AvailabilityControl({
  value,
  onChange,
}: {
  value: WidgetAvailabilityMode;
  onChange: (next: WidgetAvailabilityMode) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <fieldset
      className="flex flex-col gap-2 border-0 p-0"
      aria-describedby="widget-availability-hint"
    >
      <legend className="mb-1 text-sm font-medium">
        {t('settings.widgetCustomization.availabilityLegend')}
      </legend>
      <p id="widget-availability-hint" className="text-2xs text-content-tertiary">
        {t('settings.widgetCustomization.availabilityHint')}
      </p>
      {WIDGET_AVAILABILITY_MODES.map((mode) => (
        <label
          key={mode}
          className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm transition-colors ${
            value === mode
              ? 'border-brand-500 bg-brand-100 dark:bg-brand-950'
              : 'border-border hover:bg-surface-2'
          }`}
        >
          <input
            type="radio"
            name="widget-availability"
            value={mode}
            checked={value === mode}
            onChange={() => onChange(mode)}
            className="mt-1"
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium text-content">
              {t(`settings.widgetCustomization.availability.${mode}`)}
            </span>
            <ul className="list-disc pl-4 text-2xs text-content-secondary">
              <li>{t(`settings.widgetCustomization.availability.${mode}What1`)}</li>
              <li>{t(`settings.widgetCustomization.availability.${mode}What2`)}</li>
            </ul>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The widget's language (WG-02): Automatic, or one of the eight, and what
 * Automatic falls back to. Two native `<select>`s: Enter inside one does not
 * submit the surrounding form, which a text field would. The snippet note is
 * always shown — a language written into the install snippet beats this
 * setting, and the admin is the one who can find that line.
 */
function LanguageControl({
  language,
  fallback,
  onLanguageChange,
  onFallbackChange,
}: {
  language: WidgetLanguage;
  fallback: WidgetUiLocale;
  onLanguageChange: (next: WidgetLanguage) => void;
  onFallbackChange: (next: WidgetUiLocale) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-sm font-medium">
        {t('settings.widgetCustomization.languageLegend')}
      </legend>
      <div className="flex flex-col gap-1">
        <label htmlFor="widget-language" className="text-xs font-medium">
          {t('settings.widgetCustomization.languageLabel')}
        </label>
        <select
          id="widget-language"
          value={language}
          aria-describedby="widget-language-hint widget-language-snippet-note"
          onChange={(event) => onLanguageChange(event.target.value as WidgetLanguage)}
          className="rounded-md border border-border bg-inset px-3 py-2 text-sm"
        >
          <option value="auto">{t('settings.widgetCustomization.language.auto')}</option>
          {WIDGET_UI_LOCALES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
        <p id="widget-language-hint" className="text-2xs text-content-tertiary">
          {t('settings.widgetCustomization.languageHint')}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="widget-fallback-language" className="text-xs font-medium">
          {t('settings.widgetCustomization.fallbackLanguageLabel')}
        </label>
        <select
          id="widget-fallback-language"
          value={fallback}
          disabled={language !== 'auto'}
          aria-describedby="widget-fallback-language-hint"
          onChange={(event) => onFallbackChange(event.target.value as WidgetUiLocale)}
          className="rounded-md border border-border bg-inset px-3 py-2 text-sm disabled:opacity-50"
        >
          {WIDGET_UI_LOCALES.map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
        <p id="widget-fallback-language-hint" className="text-2xs text-content-tertiary">
          {t('settings.widgetCustomization.fallbackLanguageHint')}
        </p>
      </div>
      <p id="widget-language-snippet-note" className="text-2xs text-content-tertiary">
        {t('settings.widgetCustomization.languageSnippetNote')}
      </p>
    </fieldset>
  );
}

/**
 * The welcome message (owner, 2026-10-13): a title and the text under it, which
 * the widget shows as the team's first bubble. An empty box is sent as `''`,
 * which the API stores as null — "no welcome, use the built-in line". The
 * hints sit outside the `<label>`s and are wired by `aria-describedby`, so a
 * field's accessible name stays just "Title" / "Message".
 */
function WelcomeControl({
  title,
  text,
  onTitleChange,
  onTextChange,
}: {
  title: string;
  text: string;
  onTitleChange: (next: string) => void;
  onTextChange: (next: string) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-sm font-medium">
        {t('settings.widgetCustomization.welcomeLegend')}
      </legend>
      <p id="widget-welcome-hint" className="-mt-1 text-2xs text-content-tertiary">
        {t('settings.widgetCustomization.welcomeHint')}
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="widget-welcome-title" className="text-xs font-medium">
          {t('settings.widgetCustomization.welcomeTitleLabel')}
        </label>
        <input
          id="widget-welcome-title"
          type="text"
          value={title}
          maxLength={WIDGET_WELCOME_TITLE_MAX}
          aria-describedby="widget-welcome-hint"
          onChange={(event) => onTitleChange(event.target.value)}
          className="rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="widget-welcome-text" className="text-xs font-medium">
          {t('settings.widgetCustomization.welcomeTextLabel')}
        </label>
        <textarea
          id="widget-welcome-text"
          value={text}
          rows={3}
          maxLength={WIDGET_WELCOME_TEXT_MAX}
          aria-describedby="widget-welcome-hint widget-welcome-text-hint"
          onChange={(event) => onTextChange(event.target.value)}
          className="resize-y rounded-md border border-border bg-inset px-3 py-2 text-sm"
        />
        <p id="widget-welcome-text-hint" className="text-2xs text-content-tertiary">
          {t('settings.widgetCustomization.welcomeTextHint')}
        </p>
      </div>
    </fieldset>
  );
}

// --- Live preview ------------------------------------------------------------

/**
 * A miniature of the widget rendered from the draft values. `dark` treats
 * `auto` as its light surface — the picker's own theme is not the visitor's — so
 * the preview shows a concrete, readable result rather than guessing.
 */
function WidgetPreview({ appearance }: { appearance: WidgetAppearance }): ReactElement {
  const t = useTranslate();
  const dark = appearance.theme === 'dark';
  const surface = dark ? '#121829' : '#ffffff';
  const text = dark ? '#edf0f6' : '#111726';
  const muted = dark ? '#a6b0c4' : '#4a5468';
  const border = dark ? '#232c44' : '#dde1e9';
  const agentBubble = dark ? '#1e2740' : '#eff1f5';
  const left = appearance.position === 'bottom-left';

  return (
    <div className="flex flex-col gap-2">
      <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('settings.widgetCustomization.previewLabel')}
      </span>
      <div
        // A neutral "page" the widget sits on, so the surface stands out whether
        // it is light or dark.
        // `font-preset-reset`: the preview stands for the visitor's widget, so
        // the panel's font preset stops at its edge.
        className="font-preset-reset relative flex min-h-72 flex-col overflow-hidden rounded-lg border border-border bg-[repeating-linear-gradient(45deg,rgba(120,120,120,.06)_0,rgba(120,120,120,.06)_10px,transparent_10px,transparent_20px)] p-3"
        data-testid="widget-preview"
      >
        {/* The open panel */}
        <div
          className={`flex w-56 flex-col overflow-hidden rounded-xl shadow-lg ${left ? 'self-start' : 'self-end'}`}
          style={{ background: surface, color: text, border: `1px solid ${border}` }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2 text-white"
            style={{ background: appearance.primary_color }}
          >
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
              style={{ background: 'rgba(255,255,255,.25)' }}
              aria-hidden="true"
            >
              S
            </span>
            {appearance.show_logo && (
              <span
                className="flex h-5 items-center rounded bg-white/25 px-1 text-[9px] font-semibold"
                data-testid="preview-logo"
                aria-hidden="true"
              >
                {t('settings.widgetCustomization.previewLogo')}
              </span>
            )}
            <span className="text-xs font-semibold">
              {t('settings.widgetCustomization.previewChatWithUs')}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 p-3">
            <span
              className="max-w-[80%] self-start rounded-lg px-2.5 py-1.5 text-[11px]"
              style={{ background: agentBubble, color: text }}
            >
              {t('settings.widgetCustomization.previewGreeting')}
            </span>
            <span
              className="max-w-[80%] self-end rounded-lg px-2.5 py-1.5 text-[11px] text-white"
              style={{ background: appearance.primary_color }}
            >
              {t('settings.widgetCustomization.previewCustomerMessage')}
            </span>
          </div>
          {appearance.powered_by && (
            <p className="pb-1.5 text-center text-[10px]" style={{ color: muted }}>
              {t('settings.widgetCustomization.previewPoweredBy')}
            </p>
          )}
        </div>

        {/* The launcher, in its chosen corner — absent while the site opens the panel itself */}
        {appearance.launcher_visibility === 'always' && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={`absolute bottom-3 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg ${left ? 'left-3' : 'right-3'}`}
            style={{ background: appearance.primary_color }}
          >
            <span className="text-lg leading-none">💬</span>
          </button>
        )}
      </div>
      <p className="text-2xs text-content-tertiary">
        {t('settings.widgetCustomization.previewLanguageNote')}
      </p>
      <p className="text-2xs text-content-tertiary">
        {appearance.theme === 'auto'
          ? t('settings.widgetCustomization.previewAutoNote')
          : appearance.mobile_fullscreen
            ? t('settings.widgetCustomization.previewFullscreenNote')
            : t('settings.widgetCustomization.previewFloatingNote')}
      </p>
    </div>
  );
}
