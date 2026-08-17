/**
 * Outgoing push — written to disk, never delivered (PLAN assumption A4, applied
 * to the mobile channel).
 *
 * APNs and FCM both want a signing key this project is not allowed to hold
 * (CLAUDE.md: no real secrets), and a network call the tests could not rely on.
 * Writing a file keeps the *shape* honest — the code that decides to notify
 * somebody calls something that takes a device, an address and a payload, and
 * swapping in a real provider means replacing one method — while making
 * delivery inspectable: the tests read the spool back rather than asserting on
 * a mock's call log, which is the only way to catch a push addressed to the
 * wrong handset.
 *
 * **The spool is partitioned by license**, `<dir>/<licenseId>/…`, and that is
 * not filing tidiness. The property this channel has to hold is that a message
 * in one workspace never reaches a device registered in another, and a flat
 * directory would make the test for it a string search over everything. With
 * one directory per license, "did tenant B's phone hear about tenant A's
 * conversation?" is a question about a *file's location*, which is far harder
 * to accidentally assert away than a field.
 *
 * This is also the one place a device token legitimately appears in writing
 * (§C-A32): the spool stands in for the provider, and the provider is who the
 * token is *for*. It is under `.data/`, which is gitignored, for the same
 * reason the mail spool is.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DevicePlatform, PushEventKind } from '@nexa/types';

/**
 * What happened, in the vocabulary the phone shows.
 *
 * Declared in `@nexa/types` since `13.7-s`, and re-exported here so the fifteen
 * call sites that already import it from this module keep working. It moved for
 * the reason `DevicePlatform` lives there: the phone reads the `kind` it writes
 * (`notifications/handler.ts`), and two hand-kept copies of a three-value union
 * are a pair that can drift. Nothing about what is sent changed.
 */
export type { PushEventKind };

/** One delivery, to one handset. */
export interface PushNotification {
  /** Whose workspace this belongs to — also the spool partition. */
  licenseId: bigint;
  /** The member being notified. */
  accountId: string;
  /** The `device_tokens` row this address came from. */
  deviceId: string;
  platform: DevicePlatform;
  /** The APNs/FCM address. Never logged, never returned by the API. */
  token: string;
  kind: PushEventKind;
  title: string;
  body: string;
  /** What to open when the notification is tapped. */
  chatId: string;
}

/** A delivery read back out of the spool. */
export interface DeliveredPush {
  license_id: string;
  account_id: string;
  device_id: string;
  platform: string;
  token: string;
  kind: PushEventKind;
  title: string;
  body: string;
  chat_id: string;
  sent_at: string;
}

export interface PushProvider {
  send(notification: PushNotification): Promise<void>;
}

/**
 * Field by field rather than a spread, and for a harder reason than tidiness:
 * `licenseId` is a `bigint`, which `JSON.stringify` throws on. Building the
 * payload explicitly means a field added to `PushNotification` later has to be
 * carried here deliberately — including one that must *not* be written down.
 */
function serialise(notification: PushNotification, sentAt: string): DeliveredPush {
  return {
    license_id: notification.licenseId.toString(),
    account_id: notification.accountId,
    device_id: notification.deviceId,
    platform: notification.platform,
    token: notification.token,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    chat_id: notification.chatId,
    sent_at: sentAt,
  };
}

export class FilePushProvider implements PushProvider {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async send(notification: PushNotification): Promise<void> {
    const dir = join(this.#dir, notification.licenseId.toString());
    await mkdir(dir, { recursive: true });
    const sentAt = new Date().toISOString();
    const stamp = sentAt.replace(/[:.]/g, '-');
    await writeFile(
      join(dir, `${stamp}-${notification.kind}-${randomUUID().slice(0, 8)}.json`),
      JSON.stringify(serialise(notification, sentAt), null, 2),
      'utf8',
    );
  }

  /**
   * What would have gone out, newest first.
   *
   * With a license, only that workspace's spool — which is how a test asks the
   * cross-tenant question as "is tenant B's directory empty?" rather than as a
   * filter over a shared list. Without one, everything, so a test can also
   * assert on the total and catch a delivery filed under a license nobody
   * expected.
   */
  async delivered(licenseId?: bigint): Promise<DeliveredPush[]> {
    const partitions = licenseId === undefined ? await this.#partitions() : [licenseId.toString()];
    const batches = await Promise.all(partitions.map((p) => this.#read(join(this.#dir, p))));
    return batches.flat().sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  }

  async #partitions(): Promise<string[]> {
    try {
      const entries = await readdir(this.#dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      // Nothing has been sent yet, so there is no spool — an empty result, not
      // an error a test has to special-case.
      return [];
    }
  }

  async #read(dir: string): Promise<DeliveredPush[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    return Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8')) as DeliveredPush),
    );
  }
}

/**
 * Discards everything.
 *
 * The test server's default, for the reason `NullMailer` is: a suite that
 * starts hundreds of chats should not leave hundreds of files behind. The
 * tests that care about delivery pass a `FilePushProvider` pointed at a
 * temporary directory.
 */
export class NullPushProvider implements PushProvider {
  async send(): Promise<void> {
    // Intentionally empty.
  }
}
