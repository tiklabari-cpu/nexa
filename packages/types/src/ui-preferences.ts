/**
 * How one person has arranged the console, for one workspace (FR-MOD-08.1).
 *
 * Per user and per license, stored on the membership beside the notification
 * preferences — the same person may keep the Settings navigation pinned on one
 * workspace and folded away on another. Every field is required for the reason
 * `NotificationPreferences` gives: partial *writes* are `Partial<UiPreferences>`
 * at the write surface, never a partial read.
 */
import type { PanelFontPreset } from './panel-font.js';

export interface UiPreferences {
  /** The Settings side navigation is shown pinned (`true`) or folded away. */
  settings_nav_pinned: boolean;
  /**
   * The panel font this member chose (owner, 2026-10-13); `null` = follow the
   * workspace default. Whether it applies is `/auth/me`'s `appearance` answer:
   * the later of this and the workspace default wins.
   */
  font_preset: PanelFontPreset | null;
  /** When `font_preset` was chosen; read-only, `null` with no choice. */
  font_preset_set_at: string | null;
}

/** The on/off switches. `font_preset` is written alongside them, not one of them. */
export const UI_PREFERENCE_KEYS = ['settings_nav_pinned'] as const;
export type UiPreferenceKey = (typeof UI_PREFERENCE_KEYS)[number];

/** What `PUT /agents/me/ui-preferences` accepts. */
export type UiPreferencesPatch = Partial<Pick<UiPreferences, UiPreferenceKey | 'font_preset'>>;

/**
 * Pinned by default: the navigation is the only way between Settings sections,
 * so a new member sees it and folds it away rather than having to discover it.
 * Mirrors the `settings_nav_pinned` column default.
 */
export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  settings_nav_pinned: true,
  font_preset: null,
  font_preset_set_at: null,
};
