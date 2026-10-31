/**
 * Reading and writing a member's notification preferences (FR-MOD-13.8 ·
 * FR-MOD-08.2), in one place because three surfaces need the same answer.
 *
 * `/auth/me` returns them with the profile, `/agents/me/notification-preferences`
 * reads and writes them, and `13.7-d` will consult them before addressing a
 * handset. Serialising the row in each of those would be three chances for the
 * defaults to disagree — and the disagreement that matters is not cosmetic: a
 * surface that reads a missing preference as *off* silently stops interrupting
 * somebody who never asked for quiet.
 *
 * The columns live on `agent_memberships`, so a preference is per user **and**
 * per license. That is FR-MOD-08.2's rule, and it is why nothing here takes an
 * account id on its own.
 */
import type { NotificationPreferences, NotificationPreferencesPatch } from '@siyahtus/types';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_EVENTS,
  readNotificationEvents,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/**
 * The membership columns the preferences are made of.
 *
 * Exported as a Prisma `select` so a caller that is already fetching the
 * membership — `/auth/me` fetches it for `routing_status` — can add these to
 * its own query instead of paying for a second round trip.
 */
export const NOTIFICATION_PREFERENCE_SELECT = {
  notifyEnabled: true,
  notifySound: true,
  notifyDesktop: true,
  notifyPush: true,
  notifyEmail: true,
  notifyEvents: true,
  notifyRepeatSound: true,
} as const;

export interface NotificationPreferenceRow {
  notifyEnabled: boolean;
  notifySound: boolean;
  notifyDesktop: boolean;
  notifyPush: boolean;
  notifyEmail: boolean;
  /** The stored events object (IN-10); keys it lacks read as the defaults. */
  notifyEvents: unknown;
  notifyRepeatSound: boolean;
}

/**
 * A membership row as the contract's preference object.
 *
 * `null` — no membership, which a bot or an app principal always is — yields
 * the defaults rather than throwing. The caller in that position is asking "how
 * would this person be reached?", and the honest answer for somebody with no
 * membership is the same one a fresh membership gets.
 */
export function serialiseNotificationPreferences(
  row: NotificationPreferenceRow | null | undefined,
): NotificationPreferences {
  if (!row) {
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      events: { ...DEFAULT_NOTIFICATION_PREFERENCES.events },
    };
  }
  return {
    enabled: row.notifyEnabled,
    sound: row.notifySound,
    desktop: row.notifyDesktop,
    push: row.notifyPush,
    email: row.notifyEmail,
    // Every key present: a stored object only holds what the member changed,
    // and a missing key reads as the event's default (`readNotificationEvents`).
    events: readNotificationEvents(row.notifyEvents),
    repeat_sound: row.notifyRepeatSound,
  };
}

/**
 * A partial write, in the column names the membership actually stores.
 *
 * `events` is merged into the stored object by the caller (`writeNotificationPreferences`),
 * which has to read it first — a patch of one event must not drop the others.
 */
export function toPreferenceColumns(patch: NotificationPreferencesPatch): {
  notifyEnabled?: boolean;
  notifySound?: boolean;
  notifyDesktop?: boolean;
  notifyPush?: boolean;
  notifyEmail?: boolean;
  notifyRepeatSound?: boolean;
} {
  return {
    ...(patch.repeat_sound !== undefined ? { notifyRepeatSound: patch.repeat_sound } : {}),
    ...(patch.enabled !== undefined ? { notifyEnabled: patch.enabled } : {}),
    ...(patch.sound !== undefined ? { notifySound: patch.sound } : {}),
    ...(patch.desktop !== undefined ? { notifyDesktop: patch.desktop } : {}),
    ...(patch.push !== undefined ? { notifyPush: patch.push } : {}),
    ...(patch.email !== undefined ? { notifyEmail: patch.email } : {}),
  };
}

/**
 * This member's preferences, as the contract states them.
 *
 * Must run inside a `withTenant` transaction: the read is RLS-scoped, so a
 * membership in another workspace is invisible rather than forbidden.
 */
export async function readNotificationPreferences(
  tx: TenantClient,
  input: { licenseId: bigint; agentId: string },
): Promise<NotificationPreferences> {
  const row = await tx.agentMembership.findUnique({
    where: { licenseId_agentId: { licenseId: input.licenseId, agentId: input.agentId } },
    select: NOTIFICATION_PREFERENCE_SELECT,
  });
  return serialiseNotificationPreferences(row);
}

/**
 * Apply a partial change and return the whole resulting set.
 *
 * Returning everything rather than the changed keys is what lets a client hold
 * one object it trusts: a screen that toggled `sound` also learns that a colleague
 * (or its own other tab) turned `push` off since it loaded.
 */
export async function writeNotificationPreferences(
  tx: TenantClient,
  input: { licenseId: bigint; agentId: string; patch: NotificationPreferencesPatch },
): Promise<NotificationPreferences> {
  const where = { licenseId_agentId: { licenseId: input.licenseId, agentId: input.agentId } };
  const changed = Object.entries(input.patch.events ?? {}).filter(
    ([event, on]) => (NOTIFICATION_EVENTS as readonly string[]).includes(event) && on !== undefined,
  );
  let notifyEvents: Record<string, boolean> | undefined;
  if (changed.length > 0) {
    // The stored object holds only what the member has set; merge into it under
    // a row lock so two tabs toggling two events do not lose one of them.
    const [current] = await tx.$queryRaw<Array<{ events: unknown }>>`
      SELECT notify_events AS events FROM agent_memberships
      WHERE license_id = ${input.licenseId} AND agent_id = ${input.agentId}::uuid
      FOR NO KEY UPDATE`;
    const stored =
      typeof current?.events === 'object' && current.events !== null
        ? (current.events as Record<string, boolean>)
        : {};
    notifyEvents = { ...stored, ...Object.fromEntries(changed) } as Record<string, boolean>;
  }
  const row = await tx.agentMembership.update({
    where,
    data: {
      ...toPreferenceColumns(input.patch),
      ...(notifyEvents ? { notifyEvents } : {}),
    },
    select: NOTIFICATION_PREFERENCE_SELECT,
  });
  return serialiseNotificationPreferences(row);
}
