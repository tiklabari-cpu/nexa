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
  /**
   * The workspace's welcome message (owner, 2026-10-13): a bold first line and
   * the text under it, shown as the team's first bubble when the panel opens.
   * Null keeps the widget's built-in line. Server-delivered only — never baked
   * into the install snippet, so editing it needs no re-install.
   */
  welcome_title: string | null;
  welcome_text: string | null;
}

/** Upper bounds for the welcome message, shared by the API, the DB and the form. */
export const WIDGET_WELCOME_TITLE_MAX = 120;
export const WIDGET_WELCOME_TEXT_MAX = 500;

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
  theme: 'light',
  mobile_fullscreen: true,
  powered_by: true,
  welcome_title: null,
  welcome_text: null,
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
    welcome_title: normalizeWelcome(raw.welcome_title, WIDGET_WELCOME_TITLE_MAX),
    welcome_text: normalizeWelcome(raw.welcome_text, WIDGET_WELCOME_TEXT_MAX),
  };
}

/**
 * A welcome field as it may be stored: trimmed, at most `max` characters, and
 * null when there is nothing left — an empty box means "use the built-in line",
 * never "show an empty bubble".
 */
export function normalizeWelcome(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : [...trimmed].slice(0, max).join('');
}
