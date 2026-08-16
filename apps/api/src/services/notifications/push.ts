/**
 * The push channel — who may be buzzed, on which handset, and about what
 * (FR-MOD-13.7 · 13.7-d; the preference is FR-MOD-08.2).
 *
 * This is the code that crosses the tenant boundary. Everything else in the
 * notification story addresses a person by something they gave us — an e-mail
 * address on their own account — but a push is addressed to a *device row*, and
 * picking the wrong row delivers one workspace's customer conversation to a
 * phone in another workspace's pocket. So the selection is deliberately small
 * and deliberately layered:
 *
 *   1. RLS. The read runs inside `withTenant`, so another license's device is
 *      invisible rather than merely unselected.
 *   2. An explicit `licenseId` in the WHERE clause. Redundant with RLS on
 *      purpose — the same physical handset may legitimately be registered in
 *      two workspaces (the unique index is license-scoped precisely so it can
 *      be), and "the account id matched" is not enough to tell those rows
 *      apart.
 *   3. The account id. RLS would not separate *colleagues*; they share a
 *      license.
 *   4. `revokedAt`, applied twice — in the query and again in the pure
 *      selection below — so a query that someday forgets it still cannot reach
 *      a handset somebody signed out of.
 *
 * **No conversation content goes into the payload.** A push travels through
 * Apple's or Google's infrastructure, and this product masks card numbers out
 * of message text (`lib/cc-mask.ts`) and personal data out of its own logs; it
 * would be incoherent to hand a visitor's sentence to a third party for the
 * sake of a preview. The notification says what *kind* of thing happened and
 * carries the chat id; the app fetches the conversation over the authenticated
 * API once the person taps it. That also means nothing here needs masking, and
 * the spool cannot become a second, unredacted transcript store.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DevicePlatform, NotificationPreferences } from '@nexa/types';
import { isDevicePlatform, pushAllowed } from '@nexa/types';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { PushEventKind, PushProvider } from '../push/push-provider.js';
import { NOTIFICATION_PREFERENCE_SELECT, serialiseNotificationPreferences } from './preferences.js';

/** A `device_tokens` row, as much of it as the decision needs. */
export interface PushDevice {
  id: string;
  platform: string;
  token: string;
  revokedAt: Date | null;
}

/** A handset that may be addressed, with the address. */
export interface PushTarget {
  deviceId: string;
  platform: DevicePlatform;
  token: string;
}

/** What the phone is being told about. */
export interface PushEvent {
  kind: PushEventKind;
  chatId: string;
}

/**
 * Which of this member's handsets may be addressed for this event.
 *
 * Pure, and separated from the query for the same reason `shouldEmailAssignee`
 * is: the cases worth proving are the *negatives* — the person who turned push
 * off, the person who silenced everything, the handset that was signed out, the
 * row with a platform this build cannot address — and a pure function is the
 * only way to prove them without a database and a provider.
 */
export function deliverablePushTargets(
  prefs: NotificationPreferences,
  devices: readonly PushDevice[],
): PushTarget[] {
  // The master switch and the channel, in one place shared with the console and
  // the phone's own settings screen, so the three cannot disagree about what
  // "notifications off" means (FR-MOD-08.2 · `pushAllowed`).
  if (!pushAllowed(prefs)) return [];

  return devices.flatMap((device) => {
    // Signed out. The query filters these too; this is the second lock.
    if (device.revokedAt !== null) return [];
    // A platform this build has no transport for. Dropping it is the
    // fail-closed answer — the database CHECK means it should be unreachable,
    // and a row that got past it is not one to guess about.
    if (!isDevicePlatform(device.platform)) return [];
    return [{ deviceId: device.id, platform: device.platform, token: device.token }];
  });
}

/**
 * The member's preferences and live handsets, read under the tenant's RLS.
 *
 * Must run inside a `withTenant` transaction — see the four layers in the file
 * header; this function supplies three of them and the transaction supplies the
 * first.
 */
export async function readPushTargets(
  tx: TenantClient,
  input: { licenseId: bigint; accountId: string },
): Promise<PushTarget[]> {
  const [membership, devices] = await Promise.all([
    tx.agentMembership.findUnique({
      where: { licenseId_agentId: { licenseId: input.licenseId, agentId: input.accountId } },
      select: NOTIFICATION_PREFERENCE_SELECT,
    }),
    tx.deviceToken.findMany({
      where: { licenseId: input.licenseId, accountId: input.accountId, revokedAt: null },
      select: { id: true, platform: true, token: true, revokedAt: true },
    }),
  ]);

  // No membership means this account is not a member of this workspace, and the
  // honest answer to "may I dial their handset?" is no. Note this is the
  // *opposite* default from `serialiseNotificationPreferences(null)`, which
  // answers a display question ("how would this person be reached?") where
  // falling back to the defaults is right. Here the question is
  // authorisation-shaped, so it fails closed. The composite foreign key from
  // `device_tokens` to `agent_memberships` should make the case unreachable;
  // this is what happens if it ever is not.
  if (!membership) return [];

  return deliverablePushTargets(serialiseNotificationPreferences(membership), devices);
}

/**
 * What the handset shows.
 *
 * Derived from the kind alone — see the header on why no conversation content
 * travels. Kept beside the selection because the two together are the whole of
 * "what does this person receive", and a caller that could pass its own strings
 * would be a caller that could paste a visitor's message in.
 */
export function renderPush(kind: PushEventKind): { title: string; body: string } {
  switch (kind) {
    case 'new_chat':
      return { title: 'New conversation', body: 'A visitor started a chat assigned to you.' };
    case 'assignment':
      return { title: 'Chat assigned to you', body: 'A conversation was handed to you.' };
    case 'message':
      return { title: 'New message', body: 'A visitor replied in one of your chats.' };
  }
}

export interface PushDeps {
  db: PrismaClient;
  provider: PushProvider;
  log: FastifyBaseLogger;
}

/**
 * Notify one member's handsets. Best-effort, and never throws.
 *
 * Best-effort for the reason the assignee e-mail is: by the time this runs the
 * event is committed and already on its way over realtime, so a spool that is
 * full or a provider that is down must not turn a visitor's message into a 500.
 * The failure is logged with the chat id and without the token.
 *
 * A member with no registered handset, push turned off, or nothing but revoked
 * devices all take the same silent path — none of them is an error, and a log
 * line for each would bury the ones that are.
 */
export async function pushToAgentDevices(
  deps: PushDeps,
  tenant: TenantContext,
  input: { accountId: string; event: PushEvent },
): Promise<void> {
  try {
    const targets = await withTenant(deps.db, tenant, (tx) =>
      readPushTargets(tx, { licenseId: tenant.licenseId, accountId: input.accountId }),
    );
    if (targets.length === 0) return;

    const content = renderPush(input.event.kind);
    for (const target of targets) {
      await deps.provider.send({
        licenseId: tenant.licenseId,
        accountId: input.accountId,
        deviceId: target.deviceId,
        platform: target.platform,
        token: target.token,
        kind: input.event.kind,
        chatId: input.event.chatId,
        ...content,
      });
    }
  } catch (error) {
    deps.log.warn(
      { err: error, chatId: input.event.chatId, accountId: input.accountId },
      'push notification failed',
    );
  }
}
