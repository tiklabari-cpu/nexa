/**
 * Reading and writing a member's console layout preferences (FR-MOD-08.1).
 *
 * The columns live on `agent_memberships`, next to the notification
 * preferences (`services/notifications/preferences.ts`), for the same reason:
 * a preference is per user **and** per license.
 */
import type { UiPreferences, UiPreferencesPatch } from '@siyahtus/types';
import { DEFAULT_UI_PREFERENCES, isPanelFontPreset } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

const UI_PREFERENCE_SELECT = {
  settingsNavPinned: true,
  fontPreset: true,
  fontPresetSetAt: true,
} as const;

function serialise(
  row: {
    settingsNavPinned: boolean;
    fontPreset: string | null;
    fontPresetSetAt: Date | null;
  } | null,
): UiPreferences {
  // No membership (a bot, an app principal) reads as the defaults — the same
  // answer a fresh membership gets.
  if (!row) return { ...DEFAULT_UI_PREFERENCES };
  const fontPreset = isPanelFontPreset(row.fontPreset) ? row.fontPreset : null;
  return {
    settings_nav_pinned: row.settingsNavPinned,
    font_preset: fontPreset,
    font_preset_set_at: fontPreset ? (row.fontPresetSetAt?.toISOString() ?? null) : null,
  };
}

/** Must run inside a `withTenant` transaction: the read is RLS-scoped. */
export async function readUiPreferences(
  tx: TenantClient,
  input: { licenseId: bigint; agentId: string },
): Promise<UiPreferences> {
  const row = await tx.agentMembership.findUnique({
    where: { licenseId_agentId: { licenseId: input.licenseId, agentId: input.agentId } },
    select: UI_PREFERENCE_SELECT,
  });
  return serialise(row);
}

/** Apply a partial change and return the whole resulting set. */
export async function writeUiPreferences(
  tx: TenantClient,
  input: { licenseId: bigint; agentId: string; patch: UiPreferencesPatch; now?: Date },
): Promise<UiPreferences> {
  const row = await tx.agentMembership.update({
    where: { licenseId_agentId: { licenseId: input.licenseId, agentId: input.agentId } },
    data: {
      ...(input.patch.settings_nav_pinned !== undefined
        ? { settingsNavPinned: input.patch.settings_nav_pinned }
        : {}),
      // A font choice is stamped with when it was made — that time is what
      // "latest wins" orders against the workspace default. Clearing it
      // clears the time too (the CHECK holds the two together).
      ...(input.patch.font_preset !== undefined
        ? {
            fontPreset: input.patch.font_preset,
            fontPresetSetAt: input.patch.font_preset === null ? null : (input.now ?? new Date()),
          }
        : {}),
    },
    select: UI_PREFERENCE_SELECT,
  });
  return serialise(row);
}
