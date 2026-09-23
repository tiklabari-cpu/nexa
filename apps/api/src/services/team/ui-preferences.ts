/**
 * Reading and writing a member's console layout preferences (FR-MOD-08.1).
 *
 * The columns live on `agent_memberships`, next to the notification
 * preferences (`services/notifications/preferences.ts`), for the same reason:
 * a preference is per user **and** per license.
 */
import type { UiPreferences } from '@nexa/types';
import { DEFAULT_UI_PREFERENCES } from '@nexa/types';
import type { TenantClient } from '../../lib/tenant.js';

const UI_PREFERENCE_SELECT = { settingsNavPinned: true } as const;

function serialise(row: { settingsNavPinned: boolean } | null): UiPreferences {
  // No membership (a bot, an app principal) reads as the defaults — the same
  // answer a fresh membership gets.
  if (!row) return { ...DEFAULT_UI_PREFERENCES };
  return { settings_nav_pinned: row.settingsNavPinned };
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
  input: { licenseId: bigint; agentId: string; patch: Partial<UiPreferences> },
): Promise<UiPreferences> {
  const row = await tx.agentMembership.update({
    where: { licenseId_agentId: { licenseId: input.licenseId, agentId: input.agentId } },
    data: {
      ...(input.patch.settings_nav_pinned !== undefined
        ? { settingsNavPinned: input.patch.settings_nav_pinned }
        : {}),
    },
    select: UI_PREFERENCE_SELECT,
  });
  return serialise(row);
}
