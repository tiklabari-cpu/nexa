/**
 * Widget appearance — the one shape three packages have to agree on
 * (FR-MOD-11.7, "Tema/renk/konum; mobil tam ekran").
 *
 * The API stores it, the web app edits it with a live preview, and the widget
 * applies it. Keeping the type, the defaults and the normaliser here means a
 * field added in one place cannot drift out of step with the other two — and
 * the normaliser is the single gate every untrusted value passes through before
 * it is baked into a snippet or written to the database.
 *
 * The widget imports these as *types only* (erased at build) plus the two tiny
 * constants below; nothing here pulls runtime weight into its 50 KB budget.
 */

/** Corner the launcher sits in. */
export type WidgetPosition = 'bottom-right' | 'bottom-left';
export const WIDGET_POSITIONS: readonly WidgetPosition[] = ['bottom-right', 'bottom-left'];

/**
 * Colour scheme. `auto` follows the visitor's `prefers-color-scheme`; the other
 * two force the widget regardless of the host page or OS.
 */
export type WidgetTheme = 'auto' | 'light' | 'dark';
export const WIDGET_THEMES: readonly WidgetTheme[] = ['auto', 'light', 'dark'];

/**
 * The whole customisable surface of the widget. `snake_case` because it travels
 * over the API and rides in the install snippet's `window.__siyahtus`.
 */
export interface WidgetAppearance {
  /** Brand colour of the launcher, header and send button — a `#rrggbb` hex. */
  primary_color: string;
  position: WidgetPosition;
  theme: WidgetTheme;
  /** On phones, open the panel edge-to-edge rather than as a floating card. */
  mobile_fullscreen: boolean;
  /** The "Powered by SiyahTuş" footer (FR-MOD-11.5) — removable, shown by default. */
  powered_by: boolean;
}

/**
 * What the visitor's token mint carries: the appearance above plus the two
 * footer links, which are deployment facts rather than workspace choices and so
 * are not part of the editable `WidgetAppearance` (tm 257.17).
 */
export interface WidgetTokenAppearance extends WidgetAppearance {
  /** The deployment's privacy policy, or null when it publishes none. */
  privacy_policy_url: string | null;
  /**
   * Where "Powered by SiyahTuş" links to, or null for plain text (the public
   * pilot has no brand page to point at yet).
   */
  powered_by_url: string | null;
}

/**
 * The `author_id` the LLM AI Agent writes its replies under (`author_type`
 * `bot`). Rule bots and API bot tokens are also `bot` but carry their own ids,
 * so this id — not the author type — is what says "a model wrote this".
 */
export const AI_BOT_ID = 'ai-agent';

/**
 * The shipped look, mirrored from the widget's own CSS defaults. A workspace
 * that has never opened the customisation screen renders exactly this, and the
 * database column defaults match value-for-value.
 */
export const DEFAULT_WIDGET_APPEARANCE: WidgetAppearance = {
  primary_color: '#2d67fa',
  position: 'bottom-right',
  theme: 'auto',
  mobile_fullscreen: true,
  powered_by: true,
};

/**
 * A six-digit hex colour, `#` required. Deliberately strict: a value that
 * reaches CSS `color` is only ever this shape, so nothing a caller sends can
 * carry anything but a colour into the stylesheet or the snippet.
 */
export const WIDGET_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidWidgetColor(value: unknown): value is string {
  return typeof value === 'string' && WIDGET_COLOR_PATTERN.test(value);
}

/**
 * Coerce anything into a safe `WidgetAppearance`, filling every unknown or
 * invalid field from the defaults. The last line of defence before a value is
 * embedded in a snippet or applied to the DOM: an out-of-range colour, an
 * unknown position or a non-boolean flag can never survive it.
 */
export function normalizeWidgetAppearance(
  input: Partial<WidgetAppearance> | null | undefined,
): WidgetAppearance {
  const raw = input ?? {};
  return {
    primary_color: isValidWidgetColor(raw.primary_color)
      ? raw.primary_color.toLowerCase()
      : DEFAULT_WIDGET_APPEARANCE.primary_color,
    position: WIDGET_POSITIONS.includes(raw.position as WidgetPosition)
      ? (raw.position as WidgetPosition)
      : DEFAULT_WIDGET_APPEARANCE.position,
    theme: WIDGET_THEMES.includes(raw.theme as WidgetTheme)
      ? (raw.theme as WidgetTheme)
      : DEFAULT_WIDGET_APPEARANCE.theme,
    mobile_fullscreen:
      typeof raw.mobile_fullscreen === 'boolean'
        ? raw.mobile_fullscreen
        : DEFAULT_WIDGET_APPEARANCE.mobile_fullscreen,
    powered_by:
      typeof raw.powered_by === 'boolean' ? raw.powered_by : DEFAULT_WIDGET_APPEARANCE.powered_by,
  };
}
