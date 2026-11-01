/**
 * The workspace default behind the summary e-mails (RP-05 · tm 372): which
 * roles receive the daily and the weekly one until a member chooses for
 * themselves.
 *
 * One row per workspace, written on its first save (`digest_settings`); a
 * workspace that never saved reads `DEFAULT_DIGEST_ROLES`. A role list is what
 * is stored — not a per-member roster — so a member added tomorrow, or promoted
 * to Administrator, follows the default without anybody touching a setting.
 */
import {
  AGENT_ROLES,
  DEFAULT_DIGEST_ROLES,
  type AgentRole,
  type DigestFrequency,
  type DigestSettings,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** The two role lists as the code reads them: by frequency. */
export type DigestRoles = Readonly<Record<DigestFrequency, readonly string[]>>;

/** Keep only the roles the database CHECK accepts, once each, in the canonical order. */
function knownRoles(values: readonly string[] | null | undefined): AgentRole[] {
  const held = new Set(values ?? []);
  return AGENT_ROLES.filter((role) => held.has(role));
}

export function serialiseDigestSettings(
  row: { dailyRoles: string[]; weeklyRoles: string[] } | null | undefined,
): DigestSettings {
  if (!row) {
    return {
      daily_roles: [...DEFAULT_DIGEST_ROLES.daily],
      weekly_roles: [...DEFAULT_DIGEST_ROLES.weekly],
    };
  }
  return { daily_roles: knownRoles(row.dailyRoles), weekly_roles: knownRoles(row.weeklyRoles) };
}

/** The workspace default, by frequency — what `effectiveDigestSwitch` takes. */
export async function readDigestRoles(tx: TenantClient, licenseId: bigint): Promise<DigestRoles> {
  const row = await tx.digestSettings.findUnique({
    where: { licenseId },
    select: { dailyRoles: true, weeklyRoles: true },
  });
  const settings = serialiseDigestSettings(row);
  return { daily: settings.daily_roles, weekly: settings.weekly_roles };
}

export async function readDigestSettings(
  tx: TenantClient,
  licenseId: bigint,
): Promise<DigestSettings> {
  const row = await tx.digestSettings.findUnique({
    where: { licenseId },
    select: { dailyRoles: true, weeklyRoles: true },
  });
  return serialiseDigestSettings(row);
}

/**
 * Save the default. A list left out keeps what is stored — or the shipped
 * default for a workspace that has never saved — and the row is created on the
 * first save, so reading before any write never needs a row.
 */
export async function writeDigestSettings(
  tx: TenantClient,
  input: {
    licenseId: bigint;
    patch: { daily_roles?: readonly AgentRole[]; weekly_roles?: readonly AgentRole[] };
  },
): Promise<{ before: DigestSettings; after: DigestSettings }> {
  const before = await readDigestSettings(tx, input.licenseId);
  const after: DigestSettings = {
    daily_roles: input.patch.daily_roles ? knownRoles(input.patch.daily_roles) : before.daily_roles,
    weekly_roles: input.patch.weekly_roles
      ? knownRoles(input.patch.weekly_roles)
      : before.weekly_roles,
  };
  await tx.digestSettings.upsert({
    where: { licenseId: input.licenseId },
    create: {
      licenseId: input.licenseId,
      dailyRoles: after.daily_roles,
      weeklyRoles: after.weekly_roles,
    },
    update: { dailyRoles: after.daily_roles, weeklyRoles: after.weekly_roles },
  });
  return { before, after };
}
