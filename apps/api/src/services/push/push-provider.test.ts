/**
 * The mock provider (13.7-d).
 *
 * Worth its own test for one property: the spool is partitioned by license.
 * Every cross-tenant assertion the integration test makes rests on a delivery
 * for workspace A being *unable* to appear in workspace B's directory, so if
 * the partitioning were ever flattened those assertions would keep passing
 * while proving nothing.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPushProvider,
  FilePushProvider,
  NullPushProvider,
  PUSH_PROVIDERS,
  type PushNotification,
} from './push-provider.js';

function notification(overrides: Partial<PushNotification> = {}): PushNotification {
  return {
    licenseId: 7n,
    accountId: '33333333-3333-4333-8333-333333333333',
    deviceId: '44444444-4444-4444-8444-444444444444',
    platform: 'ios',
    token: 'apns-token',
    kind: 'message',
    title: 'New message',
    body: 'A visitor replied in one of your chats.',
    chatId: 'CHAT1',
    ...overrides,
  };
}

describe('FilePushProvider', () => {
  let dir: string;
  let provider: FilePushProvider;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-push-'));
    provider = new FilePushProvider(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a delivery that can be read back', async () => {
    await provider.send(notification());

    const [delivered] = await provider.delivered();
    expect(delivered).toMatchObject({
      // A bigint that `JSON.stringify` would have thrown on — the reason the
      // payload is built field by field rather than spread.
      license_id: '7',
      device_id: '44444444-4444-4444-8444-444444444444',
      platform: 'ios',
      token: 'apns-token',
      kind: 'message',
      chat_id: 'CHAT1',
    });
    expect(delivered!.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('files each license separately', async () => {
    await provider.send(notification({ licenseId: 7n, token: 'for-seven' }));
    await provider.send(notification({ licenseId: 8n, token: 'for-eight' }));

    expect((await provider.delivered(7n)).map((d) => d.token)).toEqual(['for-seven']);
    expect((await provider.delivered(8n)).map((d) => d.token)).toEqual(['for-eight']);
    expect(await provider.delivered()).toHaveLength(2);
  });

  it('reports an empty spool rather than failing', async () => {
    // Nothing has been sent, so the directory does not exist. A test asserting
    // "workspace B received nothing" hits this path every time it passes.
    expect(await provider.delivered()).toEqual([]);
    expect(await provider.delivered(99n)).toEqual([]);
  });

  it('keeps both deliveries when two land in the same millisecond', async () => {
    // Two handsets belonging to one person are notified in a loop; the file name
    // is a timestamp, so without the random suffix the second would overwrite
    // the first and the agent's tablet would look unreachable.
    await Promise.all([
      provider.send(notification({ deviceId: 'a', token: 'phone' })),
      provider.send(notification({ deviceId: 'b', token: 'tablet' })),
    ]);

    const tokens = (await provider.delivered(7n)).map((d) => d.token).sort();
    expect(tokens).toEqual(['phone', 'tablet']);
  });
});

describe('NullPushProvider', () => {
  it('accepts a delivery and keeps nothing', async () => {
    await expect(new NullPushProvider().send()).resolves.toBeUndefined();
  });
});

/**
 * `PUSH_PROVIDER` selects a provider (M-PROV-a · §D113/K3).
 *
 * A new key: this channel arrived after the others had theirs and `server.ts`
 * chose its implementation off `NODE_ENV` instead, so an operator had no way to
 * say "spool nothing" short of lying about the environment. Each case asserts
 * what the value promises on disk rather than which class came back, for the
 * reason `mailer.test.ts` gives.
 */
describe('createPushProvider', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-push-factory-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('spools the delivery under PUSH_DIR for "file"', async () => {
    const provider = createPushProvider('file', { dir });
    expect(provider).toBeInstanceOf(FilePushProvider);

    await provider.send(notification());

    expect(await (provider as FilePushProvider).delivered(7n)).toHaveLength(1);
  });

  it('keeps nothing for "null"', async () => {
    const provider = createPushProvider('null', { dir });
    expect(provider).toBeInstanceOf(NullPushProvider);

    await provider.send(notification());

    // The licence partition the file provider would have created is absent, so
    // this cannot pass by having spooled somewhere else.
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('has an implementation for every value the vocabulary allows', () => {
    for (const provider of PUSH_PROVIDERS) {
      expect(createPushProvider(provider, { dir })).toBeDefined();
    }
    expect(PUSH_PROVIDERS).toEqual(['file', 'null']);
  });
});
