/**
 * The panel's font presets (owner, 2026-10-13): which one a member sees.
 *
 * Two layers over the built-in Inter — the workspace default only the owner
 * sets (`workspace_appearance_settings`), and the member's own choice
 * (`agent_memberships.font_preset`). Each carries the time it was made, and
 * **the later one applies**: an owner changing the default after a member
 * chose wins over that older choice, and the member choosing again wins back.
 * The older choice is never deleted, only outranked.
 *
 * The rule lives here and only here. `GET /auth/me` ships its answer, and the
 * panel paints that answer without re-deriving it.
 */
import {
  DEFAULT_PANEL_FONT_PRESET,
  isPanelFontPreset,
  type PanelAppearance,
  type PanelFontPreset,
  type WorkspaceAppearanceSettings,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** One layer's stored choice; `preset` and `setAt` are NULL together (CHECK). */
export interface FontChoice {
  preset: string | null;
  setAt: Date | null;
}

/**
 * The effective preset and where it came from.
 *
 * A stored key the catalogue no longer knows counts as no choice — the CHECK
 * keeps that from happening, and painting a name the stylesheet has no design
 * for would only fall back silently. On an exact tie the member's own choice
 * wins: it is the more specific of the two.
 */
export function resolvePanelFontPreset(input: {
  workspace: FontChoice | null;
  user: FontChoice | null;
}): Pick<PanelAppearance, 'effective_font_preset' | 'source'> {
  const workspace = usable(input.workspace);
  const user = usable(input.user);

  if (user && (!workspace || user.setAt.getTime() >= workspace.setAt.getTime())) {
    return { effective_font_preset: user.preset, source: 'user' };
  }
  if (workspace) return { effective_font_preset: workspace.preset, source: 'workspace' };
  return { effective_font_preset: DEFAULT_PANEL_FONT_PRESET, source: 'builtin' };
}

function usable(choice: FontChoice | null): { preset: PanelFontPreset; setAt: Date } | null {
  if (!choice || !isPanelFontPreset(choice.preset) || choice.setAt === null) return null;
  return { preset: choice.preset, setAt: choice.setAt };
}

function presetOrNull(value: string | null | undefined): PanelFontPreset | null {
  return isPanelFontPreset(value) ? value : null;
}

/** The whole `appearance` block of `/auth/me`. */
export function panelAppearance(input: {
  workspace: FontChoice | null;
  user: FontChoice | null;
}): PanelAppearance {
  return {
    ...resolvePanelFontPreset(input),
    workspace_font_preset: presetOrNull(input.workspace?.preset),
    workspace_font_preset_set_at: input.workspace?.setAt?.toISOString() ?? null,
    user_font_preset: presetOrNull(input.user?.preset),
    user_font_preset_set_at: input.user?.setAt?.toISOString() ?? null,
  };
}

/** The workspace layer as the settings endpoint carries it; no row = no default. */
export function serialiseWorkspaceAppearance(
  row: { fontPreset: string | null; fontPresetSetAt: Date | null } | null,
): WorkspaceAppearanceSettings {
  const preset = presetOrNull(row?.fontPreset);
  return {
    font_preset: preset,
    font_preset_set_at: preset ? (row?.fontPresetSetAt?.toISOString() ?? null) : null,
  };
}

/** Must run inside a `withTenant` transaction: RLS scopes the row to this license. */
export async function readWorkspaceFontChoice(tx: TenantClient): Promise<FontChoice | null> {
  const row = await tx.workspaceAppearanceSettings.findFirst({
    select: { fontPreset: true, fontPresetSetAt: true },
  });
  return row ? { preset: row.fontPreset, setAt: row.fontPresetSetAt } : null;
}
