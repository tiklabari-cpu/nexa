/**
 * The panel's font presets (owner, 2026-10-13).
 *
 * Two layers sit over the built-in look: a workspace default only the owner
 * sets, and each member's own preference. Whichever was chosen **last** applies
 * — the rule lives on the server (`resolvePanelFontPreset`, apps/api) and the
 * panel only paints what `GET /auth/me` says. With neither set, the panel keeps
 * its built-in Inter.
 *
 * A closed list, like `COMPANY_SIZES`: the keys are stored (CHECK
 * `*_font_preset_check`) and each one names a design the stylesheet
 * (`apps/web/src/styles/tokens.css`, `html[data-font=…]`) already carries.
 * Keep the three in step.
 */
export const PANEL_FONT_PRESETS = [
  'inter',
  'plus-jakarta',
  'manrope-dm-sans',
  'nunito',
  'figtree',
] as const;

export type PanelFontPreset = (typeof PANEL_FONT_PRESETS)[number];

/** The panel's own look — what nobody choosing anything sees. */
export const DEFAULT_PANEL_FONT_PRESET: PanelFontPreset = 'inter';

export function isPanelFontPreset(value: unknown): value is PanelFontPreset {
  return typeof value === 'string' && (PANEL_FONT_PRESETS as readonly string[]).includes(value);
}

/** Where the font the panel shows came from. */
export const PANEL_FONT_SOURCES = ['builtin', 'workspace', 'user'] as const;
export type PanelFontSource = (typeof PANEL_FONT_SOURCES)[number];

/**
 * One preset's design values — what `tokens.css` sets for it. Kept here so a
 * test can hold the stylesheet to them and the pickers can render each option
 * in its own face.
 */
export interface PanelFontDesign {
  /** CSS family stack for headings and KPI numbers. */
  heading: string;
  /** CSS family stack for body text. */
  body: string;
  /** Body size, as the stylesheet writes it. */
  bodySize: string;
  /** Letter spacing for body text / headings. */
  letterSpacingBody: string;
  letterSpacingHeading: string;
  /** `font-feature-settings` for body text. */
  features: string;
  /** Weight of the KPI numbers. */
  kpiWeight: number;
}

const FALLBACK = "-apple-system, 'Segoe UI', system-ui, sans-serif";
const INTER = `'Inter Variable', 'Inter var', Inter, ${FALLBACK}`;

/**
 * `inter` is the stylesheet's built-in values, unchanged (13 px body, 700 KPI,
 * −0.011em headings), so the default renders exactly as it did before presets
 * existed.
 */
export const PANEL_FONT_DESIGNS: Record<PanelFontPreset, PanelFontDesign> = {
  inter: {
    heading: INTER,
    body: INTER,
    bodySize: '0.8125rem',
    letterSpacingBody: 'normal',
    letterSpacingHeading: '-0.011em',
    features: "'cv11' 1, 'ss03' 1, 'cv02' 1",
    kpiWeight: 700,
  },
  'plus-jakarta': {
    heading: `'Plus Jakarta Sans Variable', ${FALLBACK}`,
    body: `'Plus Jakarta Sans Variable', ${FALLBACK}`,
    bodySize: '0.84375rem',
    letterSpacingBody: '0.002em',
    letterSpacingHeading: '-0.015em',
    features: 'normal',
    kpiWeight: 700,
  },
  'manrope-dm-sans': {
    heading: `'Manrope Variable', ${FALLBACK}`,
    body: `'DM Sans Variable', ${FALLBACK}`,
    bodySize: '0.84375rem',
    letterSpacingBody: '0.004em',
    letterSpacingHeading: '-0.02em',
    features: 'normal',
    kpiWeight: 700,
  },
  nunito: {
    heading: `'Nunito Variable', ${FALLBACK}`,
    body: `'Nunito Sans Variable', ${FALLBACK}`,
    bodySize: '0.875rem',
    letterSpacingBody: '0.003em',
    letterSpacingHeading: '-0.01em',
    features: 'normal',
    kpiWeight: 750,
  },
  figtree: {
    heading: `'Figtree Variable', ${FALLBACK}`,
    body: `'Figtree Variable', ${FALLBACK}`,
    bodySize: '0.84375rem',
    letterSpacingBody: '0.002em',
    letterSpacingHeading: '-0.012em',
    features: 'normal',
    kpiWeight: 700,
  },
};

/** The workspace layer, as `GET`/`PUT /settings/appearance` carry it. */
export interface WorkspaceAppearanceSettings {
  font_preset: PanelFontPreset | null;
  font_preset_set_at: string | null;
}

/** What `GET /auth/me` says the panel should paint, and why. */
export interface PanelAppearance {
  effective_font_preset: PanelFontPreset;
  source: PanelFontSource;
  workspace_font_preset: PanelFontPreset | null;
  workspace_font_preset_set_at: string | null;
  user_font_preset: PanelFontPreset | null;
  user_font_preset_set_at: string | null;
}
