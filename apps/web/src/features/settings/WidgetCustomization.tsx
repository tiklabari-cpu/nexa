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
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import {
  DEFAULT_WIDGET_APPEARANCE,
  WIDGET_COLOR_PATTERN,
  type WidgetAppearance,
  type WidgetPosition,
  type WidgetTheme,
} from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';

interface WidgetSettings extends WidgetAppearance {
  updated_at: string | null;
}

/** The editable subset — everything but the read-only `updated_at`. */
type Edits = Partial<WidgetAppearance>;

export function WidgetCustomization({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Edits>({});

  const settings = useQuery({
    queryKey: ['settings', 'widget'],
    queryFn: () => api.get<WidgetSettings>('/settings/widget'),
  });

  const save = useMutation({
    mutationFn: (body: Edits) => api.put<WidgetSettings>('/settings/widget', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'widget'], data);
      // The install snippet bakes these values in, so a saved change must show
      // up the next time an admin copies the code.
      void queryClient.invalidateQueries({ queryKey: ['settings', 'websites'] });
      setEdits({});
    },
  });

  if (settings.error) return <ErrorNotice message="Could not load widget appearance." />;

  // The unsaved draft: server values with the pending edits laid over them, or
  // the shipped defaults until the first load resolves.
  const current = settings.data;
  const value: WidgetAppearance = {
    ...DEFAULT_WIDGET_APPEARANCE,
    ...(current ?? {}),
    ...edits,
  };
  const dirty = Object.keys(edits).length > 0;
  const set = <K extends keyof WidgetAppearance>(key: K, next: WidgetAppearance[K]): void =>
    setEdits((prev) => ({ ...prev, [key]: next }));

  const colorValid = WIDGET_COLOR_PATTERN.test(value.primary_color);

  return (
    <Section
      id="widget-customization"
      title="Widget appearance"
      description="How the chat widget looks on your sites. Changes are baked into the install snippet and applied the next time the widget loads."
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">Loading…</p>
        ) : (
          <div className="grid gap-6 p-4 md:grid-cols-2">
            {/* --- Controls --- */}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canEdit && dirty && colorValid) save.mutate(edits);
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
                  legend="Position"
                  hint="Which corner the launcher sits in."
                  name="widget-position"
                  value={value.position}
                  options={POSITIONS}
                  onChange={(next) => set('position', next)}
                />

                <ChoiceControl
                  legend="Colour scheme"
                  hint="Auto follows each visitor's device; the others force it."
                  name="widget-theme"
                  value={value.theme}
                  options={THEMES}
                  onChange={(next) => set('theme', next)}
                />

                <ToggleControl
                  label="Full screen on mobile"
                  hint="Open edge-to-edge on phones rather than as a floating card."
                  checked={value.mobile_fullscreen}
                  onChange={(next) => set('mobile_fullscreen', next)}
                />

                <ToggleControl
                  label="Show “Powered by Nexa”"
                  hint="A small credit in the widget footer. Turn it off to remove it."
                  checked={value.powered_by}
                  onChange={(next) => set('powered_by', next)}
                />
              </fieldset>

              {canEdit && (
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={!dirty || !colorValid || save.isPending}
                    className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                  >
                    {save.isPending ? 'Saving…' : 'Save appearance'}
                  </button>
                  {dirty && (
                    <button
                      type="button"
                      onClick={() => setEdits({})}
                      className="rounded-md border border-border px-3 py-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      Reset
                    </button>
                  )}
                  {save.isError && (
                    <p role="alert" className="text-2xs text-danger">
                      {save.error instanceof ApiClientError
                        ? save.error.message
                        : 'Could not save the appearance.'}
                    </p>
                  )}
                </div>
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

const POSITIONS: ReadonlyArray<{ value: WidgetPosition; label: string }> = [
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
];

const THEMES: ReadonlyArray<{ value: WidgetTheme; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

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
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        Brand colour
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Brand colour swatch"
          // The native picker only understands full hex; feed it the last valid
          // value so an in-progress edit in the text box does not blank it.
          value={valid ? value : DEFAULT_WIDGET_APPEARANCE.primary_color}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-inset"
        />
        <input
          type="text"
          aria-label="Brand colour hex"
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
          spellCheck={false}
          aria-invalid={valid ? undefined : true}
          aria-describedby={valid ? undefined : 'widget-color-error'}
          placeholder="#2f6bff"
          className="w-28 rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none"
        />
      </div>
      {!valid && (
        <p id="widget-color-error" role="alert" className="text-2xs text-danger">
          Enter a hex colour such as #2f6bff.
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
                ? 'border-brand-500 bg-brand-100 text-content'
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

// --- Live preview ------------------------------------------------------------

/**
 * A miniature of the widget rendered from the draft values. `dark` treats
 * `auto` as its light surface — the picker's own theme is not the visitor's — so
 * the preview shows a concrete, readable result rather than guessing.
 */
function WidgetPreview({ appearance }: { appearance: WidgetAppearance }): ReactElement {
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
        Preview
      </span>
      <div
        // A neutral "page" the widget sits on, so the surface stands out whether
        // it is light or dark.
        className="relative flex min-h-72 flex-col overflow-hidden rounded-lg border border-border bg-[repeating-linear-gradient(45deg,rgba(120,120,120,.06)_0,rgba(120,120,120,.06)_10px,transparent_10px,transparent_20px)] p-3"
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
              N
            </span>
            <span className="text-xs font-semibold">Chat with us</span>
          </div>
          <div className="flex flex-col gap-1.5 p-3">
            <span
              className="max-w-[80%] self-start rounded-lg px-2.5 py-1.5 text-[11px]"
              style={{ background: agentBubble, color: text }}
            >
              Hi! How can we help?
            </span>
            <span
              className="max-w-[80%] self-end rounded-lg px-2.5 py-1.5 text-[11px] text-white"
              style={{ background: appearance.primary_color }}
            >
              I have a question
            </span>
          </div>
          {appearance.powered_by && (
            <p className="pb-1.5 text-center text-[10px]" style={{ color: muted }}>
              Powered by Nexa
            </p>
          )}
        </div>

        {/* The launcher, in its chosen corner */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={`absolute bottom-3 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg ${left ? 'left-3' : 'right-3'}`}
          style={{ background: appearance.primary_color }}
        >
          <span className="text-lg leading-none">💬</span>
        </button>
      </div>
      <p className="text-2xs text-content-tertiary">
        {appearance.theme === 'auto'
          ? 'Auto shows light or dark to match each visitor’s device — light shown here.'
          : appearance.mobile_fullscreen
            ? 'On phones the panel opens full screen.'
            : 'On phones the panel opens as a floating card.'}
      </p>
    </div>
  );
}
