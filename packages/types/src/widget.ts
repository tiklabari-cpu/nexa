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
 * When the launcher (the chat bubble) is drawn (WG-10).
 *
 *   always       the bubble is there from the first paint — what every install did before.
 *   until_opened the bubble stays away until the host page opens the panel itself
 *                (`siyahtus('open')`); from then on it is shown like `always`.
 *   never        no bubble at all; the panel opens only through the page's own button
 *                (`siyahtus('open')`) and closes with its own ×.
 *
 * `never` is a real risk: if the page's button breaks, the visitor has no way to
 * reach support — the settings screen says so.
 */
export type WidgetLauncherVisibility = 'always' | 'until_opened' | 'never';
export const WIDGET_LAUNCHER_VISIBILITIES: readonly WidgetLauncherVisibility[] = [
  'always',
  'until_opened',
  'never',
];

export function isWidgetLauncherVisibility(value: unknown): value is WidgetLauncherVisibility {
  return (WIDGET_LAUNCHER_VISIBILITIES as readonly unknown[]).includes(value);
}

/**
 * The languages the widget UI ships in (WG-02, K25: eight, no more). Mirrors the
 * catalogue keys in `apps/widget/src/locales/index.ts` — a widget test holds
 * the two lists together — and is what the `widget_settings` CHECKs, the
 * settings endpoint and the panel's picker all draw from.
 */
export type WidgetUiLocale = 'en' | 'tr' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'ar';
export const WIDGET_UI_LOCALES: readonly WidgetUiLocale[] = [
  'en',
  'tr',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'ar',
];

/** The panel's "Language" choice: a fixed language, or `auto` = the visitor's browser. */
export type WidgetLanguage = 'auto' | WidgetUiLocale;

export function isWidgetUiLocale(value: unknown): value is WidgetUiLocale {
  return typeof value === 'string' && WIDGET_UI_LOCALES.includes(value as WidgetUiLocale);
}

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
  /**
   * The widget's language (WG-02): `auto` follows the visitor's browser, any
   * other value pins it. A language written into the install snippet still
   * wins over this. Server-delivered only — never baked into the snippet, so
   * the snippet cannot freeze the panel's choice.
   */
  language: WidgetLanguage;
  /** What `auto` falls back to when the browser speaks none of the eight. */
  fallback_language: WidgetUiLocale;
  /**
   * When the launcher is drawn (WG-10). Server-delivered only, like the
   * language: it is never baked into the install snippet, so changing it needs
   * no re-install.
   */
  launcher_visibility: WidgetLauncherVisibility;
  /** Show the brand's logo in the panel header (WG-10), when the brand has one. */
  show_logo: boolean;
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
  /**
   * The brand's logo for the panel header (WG-10), or null — either none is
   * set, `show_logo` is off, or the stored address is not one the widget may
   * load (`brandLogoUrl`). Read from the brand's record at every mint.
   */
  logo_url: string | null;
  /** The brand's name: the logo's alternative text. Null with `logo_url`. */
  brand_name: string | null;
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
  language: 'auto',
  // New workspaces fall back to Turkish (04 default); rows that existed before
  // WG-02 keep the column default `en` and so read exactly as they used to.
  fallback_language: 'tr',
  launcher_visibility: 'always',
  // Opt-in: a brand that already had a logo on file must not suddenly wear it
  // in the widget the day this ships.
  show_logo: false,
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
    language:
      raw.language === 'auto' || isWidgetUiLocale(raw.language)
        ? raw.language
        : DEFAULT_WIDGET_APPEARANCE.language,
    fallback_language: isWidgetUiLocale(raw.fallback_language)
      ? raw.fallback_language
      : DEFAULT_WIDGET_APPEARANCE.fallback_language,
    launcher_visibility: isWidgetLauncherVisibility(raw.launcher_visibility)
      ? raw.launcher_visibility
      : DEFAULT_WIDGET_APPEARANCE.launcher_visibility,
    show_logo:
      typeof raw.show_logo === 'boolean' ? raw.show_logo : DEFAULT_WIDGET_APPEARANCE.show_logo,
  };
}

/** The longest logo address the widget will follow; the brand column allows 2048. */
export const WIDGET_LOGO_URL_MAX = 2048;

/**
 * The address the widget may load a brand logo from (WG-10), or null.
 *
 * The widget document is served under a strict CSP and the logo is an image
 * fetched from wherever the workspace pointed it, so only an `https:` URL
 * without credentials passes. A path under the API's own `/uploads/` is
 * refused too: that route answers a session, which an `<img>` in the visitor's
 * frame does not have, so it would only ever draw a broken image. `http:`,
 * `data:`, `javascript:` and protocol-relative addresses never parse as https.
 */
export function brandLogoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '' || raw.length > WIDGET_LOGO_URL_MAX) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    return url.href;
  } catch {
    return null;
  }
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

// --- Pre-chat form: the four built-in fields (WG-01, tm 279) ----------------

/**
 * The fields the widget's own pre-chat form is built from, in the order it
 * shows them. Fixed by the widget, unlike the workspace's custom questions
 * (`pre_chat` custom fields, FR-MOD-08.7.7), which ride alongside them.
 */
export type PrechatFieldKey = 'name' | 'username' | 'email' | 'message';
export const PRECHAT_FIELD_KEYS: readonly PrechatFieldKey[] = [
  'name',
  'username',
  'email',
  'message',
];

/** Whether a built-in field is asked at all, and whether it must be answered. */
export interface PrechatFieldRule {
  visible: boolean;
  /** Only meaningful while `visible` — a hidden field is never required. */
  required: boolean;
}

/**
 * A brand's pre-chat form (WG-01): whether it opens at all, and how each of
 * the four built-in fields behaves. Stored on `widget_settings`, edited on
 * Settings › Chat forms, handed to the widget at token mint.
 */
export interface PrechatConfig {
  enabled: boolean;
  fields: Record<PrechatFieldKey, PrechatFieldRule>;
}

/**
 * Today's behaviour (owner, 2026-10-14): the form opens and all four fields
 * are shown and required. A workspace that has never saved the setting gets
 * exactly this, so nobody's widget changes until they change it.
 */
export const DEFAULT_PRECHAT_CONFIG: PrechatConfig = {
  enabled: true,
  fields: {
    name: { visible: true, required: true },
    username: { visible: true, required: true },
    email: { visible: true, required: true },
    message: { visible: true, required: true },
  },
};

/**
 * Coerce anything into a valid `PrechatConfig`. A missing or malformed field
 * falls back to its default; `required ⇒ visible` is enforced by dropping the
 * requirement of a hidden field, never by showing it — hiding is the explicit
 * choice. Used on every read path (token mint, settings read, widget) so a
 * stored value or a wire value of an older shape can never reach a form raw.
 */
export function normalizePrechatConfig(input: unknown): PrechatConfig {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as {
    enabled?: unknown;
    fields?: unknown;
  };
  const rawFields = (
    typeof raw.fields === 'object' && raw.fields !== null ? raw.fields : {}
  ) as Partial<Record<PrechatFieldKey, unknown>>;
  const fields = {} as Record<PrechatFieldKey, PrechatFieldRule>;
  for (const key of PRECHAT_FIELD_KEYS) {
    const fallback = DEFAULT_PRECHAT_CONFIG.fields[key];
    const rule = (
      typeof rawFields[key] === 'object' && rawFields[key] !== null ? rawFields[key] : {}
    ) as { visible?: unknown; required?: unknown };
    const visible = typeof rule.visible === 'boolean' ? rule.visible : fallback.visible;
    const required = typeof rule.required === 'boolean' ? rule.required : fallback.required;
    fields[key] = { visible, required: visible && required };
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_PRECHAT_CONFIG.enabled,
    fields,
  };
}

/**
 * Whether a `PrechatConfig` asks anything of the visitor: the form is on and
 * at least one built-in field is shown, or the workspace has custom pre-chat
 * questions. A form with nothing to fill in is, in effect, off.
 */
export function prechatAsksAnything(config: PrechatConfig, customFieldCount: number): boolean {
  if (!config.enabled) return false;
  return customFieldCount > 0 || PRECHAT_FIELD_KEYS.some((key) => config.fields[key].visible);
}
